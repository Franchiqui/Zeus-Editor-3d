// Portado casi verbatim de Motor-Render/services/video-cache/service.ts.
// Decodifica el vídeo a frames de canvas bajo demanda vía mediabunny (WebCodecs).
// Es random-access: canvases(time) permite saltar a cualquier timestamp sin play(),
// lo que soporta clips reversed (sourceTime decreciente) y export frame-a-frame.
import {
  Input,
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Logging,
  LogLevel,
  type WrappedCanvas,
} from "mediabunny";

// Filtra el ruido de GC de mediabunny: en los vídeos con transparencia (alpha)
// mediabunny usa dual-decode color+alpha fusionados en un worker; al interrumpir
// el iterador en un seek (normal al hacer scrubbing / cambiar de clip) puede quedar
// un VideoSample huérfano que el GC recoge sin .close() → escupe
// "A VideoSample was garbage collected without first being closed". Es BENIGNO:
// la propia FinalizationRegistry de mediabunny cierra el VideoFrame subyacente
// (sample.js), así que no hay fuga de VRAM. Para no alarmar al usuario ni ensuciar
// la consola, silenciamos el logging de mediabunny y reenviamos nosotros todo
// EXCEPTO ese mensaje de GC (errores reales de codec/decodability/carga doble se
// siguen viendo). Se hace a nivel de módulo para que cubra preview y export.
Logging.level = LogLevel.Silent;
const GC_RE = /was garbage collected without first being closed/;
Logging.on("error", (args) => {
  const msg = args.map((a) => (typeof a === "string" ? a : "")).join(" ");
  if (GC_RE.test(msg)) return;
  console.error("[mediabunny]", ...(args as unknown[]));
});
Logging.on("warn", (args) => console.warn("[mediabunny]", ...(args as unknown[])));
Logging.on("info", (args) => console.info("[mediabunny]", ...(args as unknown[])));

interface VideoSinkData {
  /** Input de mediabunny; se mantiene para poder dispose() al limpiar y liberar
   *  los readers del blob (evita que un demux posterior del mismo blob falle). */
  input: Input;
  sink: CanvasSink;
  iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null;
  currentFrame: WrappedCanvas | null;
  nextFrame: WrappedCanvas | null;
  lastTime: number;
  prefetching: boolean;
  prefetchPromise: Promise<void> | null;
  /** Ancho de decodificación (downscale). undefined = nativo. */
  decodeWidth?: number;
  /** True si un seek/decode falló tras inicializar (p.ej. webm de MediaRecorder
   *  que pasa canDecode() pero falla al decodificar frames). Marcado en el 1er
   *  error → getFrameAt devuelve null y el caller cae al fallback DOM sin
   *  reintentar a 60fps ni re-spamear warnings. */
  decodeFailed?: boolean;
}

/** Clave del sink: un mismo medio puede tener un sink nativo (export) y otro
 *  downscaleado (preview) sin pisarse entre sí. */
function sinkKey(mediaId: string, decodeWidth?: number): string {
  return `${mediaId}::${decodeWidth ?? "native"}`;
}

export class VideoCache {
  private sinks = new Map<string, VideoSinkData>();
  private initPromises = new Map<string, Promise<void>>();
  /** Sinks cuyo demux falló (formato no reconocido, etc.). Se saltan sin re-intentar
   *  cada frame (evita bucles de demux fallido a 60fps). Se limpian al borrar el
   *  clip / cambiar de proyecto, para reintentar si el medio vuelve a estar disponible. */
  private failedKeys = new Set<string>();
  /** Mutex por mediaId: serializa el demux para que los buckets (preview ::ancho y
   *  export ::nativo) no intenten demuxar el mismo blob a la vez. Un demux concurrente
   *  del mismo stream puede hacer que uno lea un stream vacío/parcial y mediabunny
   *  reporte "Input has an unsupported or unrecognizable format". */
  private demuxLocks = new Map<string, Promise<unknown>>();

  /** Serializa `fn` por mediaId. */
  private async withDemuxLock<T>(mediaId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.demuxLocks.get(mediaId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => { release = r; });
    this.demuxLocks.set(mediaId, next);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async getFrameAt({
    mediaId,
    file,
    time,
    decodeWidth,
  }: {
    mediaId: string;
    file: Blob;
    time: number;
    /** Ancho de decodificación (downscale). Si se omite, decodifica a resolución
     *  nativa. El preview pasa el ancho de su canvas (≤1280) para reducir ~6× el
     *  decode de un 4K; el export omite → nativo. */
    decodeWidth?: number;
  }): Promise<WrappedCanvas | null> {
    const key = sinkKey(mediaId, decodeWidth);
    // Si ya falló el demux de este bucket, no insista (evita spam de errores a 60fps).
    if (this.failedKeys.has(key)) return null;
    await this.ensureSink({ key, mediaId, file, decodeWidth });

    const sinkData = this.sinks.get(key);
    if (!sinkData) return null;

    // Bucket marcado como fallido tras un error de decode (no de demux): no
    // insista en mediabunny a 60fps; deja que el caller caiga al fallback DOM.
    if (sinkData.decodeFailed) {
      this.failedKeys.add(key);
      return null;
    }

    if (sinkData.nextFrame && sinkData.nextFrame.timestamp <= time) {
      sinkData.currentFrame = sinkData.nextFrame;
      sinkData.nextFrame = null;
      this.startPrefetch({ sinkData });
    }

    if (
      sinkData.currentFrame &&
      this.isFrameValid({ frame: sinkData.currentFrame, time })
    ) {
      if (!sinkData.nextFrame && !sinkData.prefetching) {
        this.startPrefetch({ sinkData });
      }
      return sinkData.currentFrame;
    }

    if (
      sinkData.iterator &&
      sinkData.currentFrame &&
      time >= sinkData.lastTime &&
      time < sinkData.lastTime + 2.0
    ) {
      const frame = await this.iterateToTime({ sinkData, targetTime: time });
      if (frame) {
        if (!sinkData.nextFrame && !sinkData.prefetching) {
          this.startPrefetch({ sinkData });
        }
        return frame;
      }
    }

    const frame = await this.seekToTime({ sinkData, time });
    if (frame && !sinkData.nextFrame && !sinkData.prefetching) {
      this.startPrefetch({ sinkData });
    }
    return frame;
  }

  private isFrameValid({
    frame,
    time,
  }: {
    frame: WrappedCanvas;
    time: number;
  }): boolean {
    return time >= frame.timestamp && time < frame.timestamp + frame.duration;
  }

  private async iterateToTime({
    sinkData,
    targetTime,
  }: {
    sinkData: VideoSinkData;
    targetTime: number;
  }): Promise<WrappedCanvas | null> {
    if (!sinkData.iterator) return null;

    try {
      while (true) {
        if (sinkData.prefetching && sinkData.prefetchPromise) {
          await sinkData.prefetchPromise;
        }

        if (
          sinkData.nextFrame &&
          sinkData.nextFrame.timestamp <= targetTime + 0.05
        ) {
          sinkData.currentFrame = sinkData.nextFrame;
          sinkData.nextFrame = null;
        } else {
          const { value: frame, done } = await sinkData.iterator.next();

          if (done || !frame) break;

          sinkData.currentFrame = frame;
        }

        const frame = sinkData.currentFrame;
        if (!frame) break;

        sinkData.lastTime = frame.timestamp;

        if (this.isFrameValid({ frame, time: targetTime })) {
          return frame;
        }

        if (frame.timestamp > targetTime + 1.0) break;
      }
    } catch (error) {
      console.warn("Iterator failed, will restart:", error);
      sinkData.iterator = null;
    }

    return null;
  }

  private async seekToTime({
    sinkData,
    time,
  }: {
    sinkData: VideoSinkData;
    time: number;
  }): Promise<WrappedCanvas | null> {
    try {
      if (sinkData.prefetching && sinkData.prefetchPromise) {
        await sinkData.prefetchPromise;
      }

      if (sinkData.iterator) {
        await sinkData.iterator.return();
        sinkData.iterator = null;
      }

      sinkData.nextFrame = null;
      sinkData.iterator = sinkData.sink.canvases(time);
      sinkData.lastTime = time;

      const { value: frame } = await sinkData.iterator.next();

      if (frame) {
        sinkData.currentFrame = frame;

        try {
          const { value: next } = await sinkData.iterator.next();
          if (next) {
            sinkData.nextFrame = next;
          }
        } catch (e) {
          console.warn("Failed to pre-fetch next frame on seek:", e);
        }

        return frame;
      }
    } catch (error) {
      console.warn("Failed to seek video:", error);
      // Decodificación fallida (p.ej. webm de MediaRecorder que pasa canDecode()
      // pero falla al decodificar frames concretos). Marca el bucket como fallido
      // para que las próximas llamadas pasen al fallback DOM sin reintentar, y
      // suelta el iterador SIN llamar a .return(): el decoder ya está en error y
      // mediabunny lo cierra internamente; un .return() intentaría close() otra
      // vez → "Cannot call 'close' on a closed codec". Se deja la limpieza a GC
      // (FinalizationRegistry cierra el VideoFrame) y a input.dispose() al borrar.
      sinkData.decodeFailed = true;
      sinkData.iterator = null;
      sinkData.currentFrame = null;
      sinkData.nextFrame = null;
      sinkData.prefetching = false;
      sinkData.prefetchPromise = null;
    }

    return null;
  }

  private startPrefetch({ sinkData }: { sinkData: VideoSinkData }): void {
    if (sinkData.prefetching || !sinkData.iterator || sinkData.nextFrame) {
      return;
    }

    sinkData.prefetching = true;
    sinkData.prefetchPromise = this.prefetchNextFrame({ sinkData });
  }

  private async prefetchNextFrame({
    sinkData,
  }: {
    sinkData: VideoSinkData;
  }): Promise<void> {
    if (!sinkData.iterator) {
      sinkData.prefetching = false;
      sinkData.prefetchPromise = null;
      return;
    }

    try {
      const { value: frame, done } = await sinkData.iterator.next();

      if (done || !frame) {
        sinkData.prefetching = false;
        sinkData.prefetchPromise = null;
        return;
      }

      sinkData.nextFrame = frame;
      sinkData.prefetching = false;
      sinkData.prefetchPromise = null;
    } catch (error) {
      console.warn("Prefetch failed:", error);
      sinkData.prefetching = false;
      sinkData.prefetchPromise = null;
      sinkData.iterator = null;
    }
  }

  private async ensureSink({
    key,
    mediaId,
    file,
    decodeWidth,
  }: {
    key: string;
    mediaId: string;
    file: Blob;
    decodeWidth?: number;
  }): Promise<void> {
    if (this.sinks.has(key) || this.failedKeys.has(key)) return;

    if (this.initPromises.has(key)) {
      await this.initPromises.get(key);
      return;
    }

    // Serializa el demux por mediaId para que los buckets (preview/export) no
    // demuxen el mismo blob a la vez. Las llamadas concurrentes del mismo bucket
    // esperan el initPromise compartido (arriba).
    await this.withDemuxLock(mediaId, async () => {
      // Re-comprobar tras adquirir el lock: otro llamador pudo inicializarlo.
      if (this.sinks.has(key) || this.failedKeys.has(key)) return;
      if (this.initPromises.has(key)) {
        await this.initPromises.get(key);
        return;
      }

      const initPromise = this.initializeSink({ key, mediaId, file, decodeWidth });
      this.initPromises.set(key, initPromise);

      try {
        await initPromise;
      } catch {
        // Demux/decode fallido (formato no reconocido, códec no soportado, etc.).
        // Marca el bucket como fallido para no reintentar a 60fps; se limpia al
        // borrar el clip / cambiar de proyecto. No relanzar: getFrameAt devolverá
        // null y el preview saltará ese clip sin propagar el error (sin popup).
        this.failedKeys.add(key);
      } finally {
        this.initPromises.delete(key);
      }
    });
  }

  private async initializeSink({
    key,
    mediaId,
    file,
    decodeWidth,
  }: {
    key: string;
    mediaId: string;
    file: Blob;
    decodeWidth?: number;
  }): Promise<void> {
    try {
      const input = new Input({
        source: new BlobSource(file),
        formats: ALL_FORMATS,
      });

      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        throw new Error("No video track found");
      }

      const canDecode = await videoTrack.canDecode();
      if (!canDecode) {
        throw new Error("Video codec not supported for decoding");
      }

      // Si el vídeo puede contener alpha (p.ej. WebM/VP9 exportado con transparencia
      // desde el lazo), el CanvasSink debe crearse con alpha:true para que el canvas
      // decodificado CONSERVE la transparencia en vez de composite sobre negro. Sin
      // esto, al sobreponer el vídeo transparente la zona "vacía" se vería negra en
      // vez de dejar ver el vídeo de atrás. Para vídeos opacos canBeTransparent()=false
      // → alpha:false (comportamiento histórico, sin cambios).
      let alphaSink = false;
      try {
        alphaSink = await videoTrack.canBeTransparent();
      } catch {
        alphaSink = false;
      }

      // Con decodeWidth (preview) se decodifica downscaleado a ese ancho; la altura
      // se deduce por aspect ratio (sin letterbox). Sin decodeWidth, nativo (export).
      // decoderOptions: hardwareAcceleration 'prefer-hardware' + optimizeForLatency.
      // Por defecto mediabunny deja hardwareAcceleration undefined → el navegador
      // a menudo elige decode por SOFTWARE → no da abasto a 30fps en 4K/códecs
      // pesados → preview a tirones ("frenado"). Forzar HW + baja latencia hace el
      // decode en GPU y con menos frames en cola → preview fluido. El export
      // comparte el sink y también sale más rápido (sin contraindicación).
      const sink = new CanvasSink(videoTrack, {
        poolSize: 3,
        fit: "contain",
        alpha: alphaSink,
        decoderOptions: {
          hardwareAcceleration: "prefer-hardware",
          optimizeForLatency: true,
        },
        ...(decodeWidth ? { width: decodeWidth } : {}),
      });

      this.sinks.set(key, {
        input,
        sink,
        iterator: null,
        currentFrame: null,
        nextFrame: null,
        lastTime: -1,
        prefetching: false,
        prefetchPromise: null,
        decodeWidth,
      });
    } catch (error) {
      //warn (no error) para no disparar el overlay de dev con un fallo de demux
      // puntual; el bucket queda marcado como fallido en ensureSink.
      console.warn(`videoCache: no se pudo inicializar el sink de ${mediaId}:`, error);
      throw error;
    }
  }

  /** Libera un sink concreto (mediaId + decodeWidth). */
  clearVideo({ mediaId, decodeWidth }: { mediaId: string; decodeWidth?: number }): void {
    const key = sinkKey(mediaId, decodeWidth);
    const sinkData = this.sinks.get(key);
    if (sinkData) {
      if (sinkData.iterator) {
        void sinkData.iterator.return().catch(() => {});
      }
      // dispose del Input libera los readers del blob → un demux posterior del
      // mismo blob no choca con readers residuales.
      try { sinkData.input.dispose(); } catch {}

      this.sinks.delete(key);
    }

    this.initPromises.delete(key);
    this.failedKeys.delete(key);
  }

  /** Libera TODOS los sinks de un medio (nativo + cualquier ancho de preview) y
   *  limpia su marca de fallido para que vuelva a intentarse si el medio reaparece.
   *  Se llama al borrar un clip del timeline para no retener decoders. */
  clearMedia(mediaId: string): void {
    const prefix = `${mediaId}::`;
    for (const key of Array.from(this.sinks.keys())) {
      if (key.startsWith(prefix)) {
        const sinkData = this.sinks.get(key);
        if (sinkData?.iterator) {
          void sinkData.iterator.return().catch(() => {});
        }
        try { sinkData?.input.dispose(); } catch {}
        this.sinks.delete(key);
        this.initPromises.delete(key);
      }
    }
    for (const key of Array.from(this.failedKeys)) {
      if (key.startsWith(prefix)) this.failedKeys.delete(key);
    }
  }

  /** Libera los sinks nativos (decodeWidth undefined). Útil tras un export para
   *  no acumular decoders a resolución completa que el preview no reutiliza. */
  clearNativeSinks(): void {
    for (const key of Array.from(this.sinks.keys())) {
      if (key.endsWith("::native")) {
        const sinkData = this.sinks.get(key);
        if (sinkData?.iterator) {
          void sinkData.iterator.return().catch(() => {});
        }
        try { sinkData?.input.dispose(); } catch {}
        this.sinks.delete(key);
        this.initPromises.delete(key);
      }
    }
    for (const key of Array.from(this.failedKeys)) {
      if (key.endsWith("::native")) this.failedKeys.delete(key);
    }
  }

  clearAll(): void {
    for (const key of Array.from(this.sinks.keys())) {
      const sinkData = this.sinks.get(key);
      if (sinkData?.iterator) {
        void sinkData.iterator.return().catch(() => {});
      }
      try { sinkData?.input.dispose(); } catch {}
      this.sinks.delete(key);
    }
    this.initPromises.clear();
    this.failedKeys.clear();
  }

  getStats() {
    return {
      totalSinks: this.sinks.size,
      activeSinks: Array.from(this.sinks.values()).filter((s) => s.iterator)
        .length,
      cachedFrames: Array.from(this.sinks.values()).filter(
        (s) => s.currentFrame,
      ).length,
    };
  }
}

export const videoCache = new VideoCache();