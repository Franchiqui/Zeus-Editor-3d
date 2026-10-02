// scene-exporter: exportación frame-a-frame del scene graph a vídeo vía mediabunny
// (WebCodecs). Portado casi verbatim de Motor-Render/services/renderer/scene-exporter.ts.
// Sin ffmpeg: mediabunny produce MP4 (avc) o WebM (vp9) directamente. El audio va en
// Fase 4 (audio-mixer.ts); por ahora shouldIncludeAudio=false.
import EventEmitter from "eventemitter3";
import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  CanvasSource,
  AudioBufferSource,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
} from "mediabunny";
import type { RootNode } from "./nodes/root-node";
import { CanvasRenderer } from "./canvas-renderer";

export type ExportFormat = "mp4" | "webm";
export type ExportQuality = "low" | "medium" | "high" | "very_high";

type ExportParams = {
  width: number;
  height: number;
  fps: number;
  format: ExportFormat;
  quality: ExportQuality;
  shouldIncludeAudio?: boolean;
  audioBuffer?: AudioBuffer;
  /** Si true, exporta con canal alpha (fondo transparente). Fuerza WebM/VP9
   *  (MP4/AVC no soporta alpha) y pasa alpha:'keep' al CanvasSource de mediabunny
   *  (por defecto descarta alpha → vídeo opaco). El CanvasRenderer se crea con
   *  alpha:true para que clear() deje transparente y el VideoFrame lleve alpha. */
  alpha?: boolean;
};

const qualityMap = {
  low: QUALITY_LOW,
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  very_high: QUALITY_VERY_HIGH,
};

export type SceneExporterEvents = {
  progress: [progress: number];
  complete: [buffer: ArrayBuffer];
  error: [error: Error];
  cancelled: [];
};

export class SceneExporter extends EventEmitter<SceneExporterEvents> {
  private renderer: CanvasRenderer;
  private format: ExportFormat;
  private quality: ExportQuality;
  private shouldIncludeAudio: boolean;
  private audioBuffer?: AudioBuffer;
  private alpha: boolean;

  isCancelled = false;

  constructor({
    width,
    height,
    fps,
    format,
    quality,
    shouldIncludeAudio,
    audioBuffer,
    alpha,
  }: ExportParams) {
    super();
    // alpha:true sólo tiene sentido con WebM/VP9 (MP4/AVC no soporta transparencia).
    // Si piden alpha con mp4, se fuerza webm.
    const useAlpha = !!alpha;
    this.format = useAlpha && format === "mp4" ? "webm" : format;
    this.renderer = new CanvasRenderer({ width, height, fps, alpha: useAlpha });
    this.quality = quality;
    this.shouldIncludeAudio = shouldIncludeAudio ?? false;
    this.audioBuffer = audioBuffer;
    this.alpha = useAlpha;
  }

  cancel(): void {
    this.isCancelled = true;
  }

  async export({ rootNode }: { rootNode: RootNode }): Promise<ArrayBuffer | null> {
    const { fps } = this.renderer;
    const frameCount = Math.ceil(rootNode.duration * fps);

    const outputFormat =
      this.format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();

    const output = new Output({
      format: outputFormat,
      target: new BufferTarget(),
    });

    const videoSource = new CanvasSource(this.renderer.canvas, {
      codec: this.format === "webm" ? "vp9" : "avc",
      bitrate: qualityMap[this.quality],
      // alpha:'keep' emite el canal alpha (side data en VP9). Por defecto
      // mediabunny descarta alpha → vídeo opaco. Sólo aplica si pedimos alpha.
      alpha: this.alpha ? "keep" : "discard",
    });

    // NOTA: NO pasamos { frameRate: fps } a addVideoTrack a propósito.
    // mediabunny asocia trackOptions.frameRate → encodingConfig.transform.frameRate,
    // lo que activa la normalización de frame rate en encoder.add(): clona el sample
    // cada fotograma (para no mutar el del usuario) pero SÓLO cierra el clon, no el
    // VideoSample original → su VideoFrame se filtra y la FinalizationRegistry de
    // mediabunny escupe "A VideoSample was garbage collected without first being
    // closed". Como ya alimentamos timestamps regulares (i/fps) y duración 1/fps vía
    // videoSource.add(), la salida sigue siendo CFR a `fps` sin necesidad de la
    // normalización. El muxer deriva el frame rate de las duraciones de sample
    // (WebM omite DefaultDuration, MP4 usa GLOBAL_TIMESCALE); ambos válidos.
    output.addVideoTrack(videoSource);

    let audioSource: AudioBufferSource | null = null;
    if (this.shouldIncludeAudio && this.audioBuffer) {
      let audioCodec: "aac" | "opus" = this.format === "webm" ? "opus" : "aac";

      if (audioCodec === "aac" && typeof AudioEncoder !== "undefined") {
        const { supported } = await AudioEncoder.isConfigSupported({
          codec: "mp4a.40.2",
          sampleRate: this.audioBuffer.sampleRate,
          numberOfChannels: this.audioBuffer.numberOfChannels,
          bitrate: 192000,
        });
        if (!supported) audioCodec = "opus";
      }

      audioSource = new AudioBufferSource({
        codec: audioCodec,
        bitrate: qualityMap[this.quality],
      });
      output.addAudioTrack(audioSource);
    }

    await output.start();

    if (audioSource && this.audioBuffer) {
      await audioSource.add(this.audioBuffer);
      audioSource.close();
    }

    for (let i = 0; i < frameCount; i++) {
      if (this.isCancelled) {
        await output.cancel();
        this.emit("cancelled");
        return null;
      }

      const time = i / fps;
      await this.renderer.render({ node: rootNode, time });
      await videoSource.add(time, 1 / fps);

      this.emit("progress", i / frameCount);
    }

    if (this.isCancelled) {
      await output.cancel();
      this.emit("cancelled");
      return null;
    }

    videoSource.close();
    await output.finalize();
    this.emit("progress", 1);

    const buffer = output.target.buffer;
    if (!buffer) {
      this.emit("error", new Error("Failed to export video"));
      return null;
    }

    this.emit("complete", buffer);
    return buffer;
  }
}