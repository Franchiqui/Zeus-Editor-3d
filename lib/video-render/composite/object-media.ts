// Cache de imágenes para ObjectNode (PNG overlays) y frames GIF. Portado del
// objectImageCache + gifFramesCache de VideoEditor.tsx (export) pero como
// servicio compartido entre preview y export. Las imágenes se cargan con
// crossOrigin='anonymous' para no taint el canvas (ver memoria image-editor-canvas-taint).
import { deconstructGIF, type FrameData } from "@/lib/gif-utils";

/** ¿El src corresponde a un vídeo (objeto vídeo)? */
export function isVideoSrc(src: string): boolean {
  return (
    src.startsWith("data:video/") ||
    /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(src)
  );
}

/** ¿El src es claramente una imagen? Se usa para desambiguar src sin extensión
 *  (p. ej. `blob:...` de "Crear capa con la selección" tipo vídeo): un objeto con
 *  `mediaType:'video'` cuyo src NO es una imagen evidente se trata como vídeo.
 *  Esto preserva los overlays de la pista de efectos, que llevan mediaType:'video'
 *  hardcodeado pero su src es un PNG (media://.../x.png o data:image/png): al ser
 *  una imagen evidente, NO se tratan como vídeo y siguen por la rama de imagen. */
export function looksLikeImage(src: string): boolean {
  return (
    src.startsWith("data:image/") ||
    /\.(png|jpe?g|gif|bmp|webp|svg|avif|tiff?)(\?|#|$)/i.test(src)
  );
}

const imageCache = new Map<string, HTMLImageElement>();

export function getObjectImage(src: string): HTMLImageElement {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    imageCache.set(src, img);
  }
  return img;
}

/** ¿La imagen ya está cargada (complete y sin error)? */
export function isImageReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

// <video> DOM por src para el fallback de captura de frames de objetos vídeo.
// El decoder nativo del navegador reproduce CUALQUIER formato que el preview
// muestre (incluidos los webm de MediaRecorder de "Crear capa con selección",
// que mediabunny a veces no puede demuxar).
const domVideoCache = new Map<string, HTMLVideoElement>();

/** Captura el frame de un vídeo con un <video> DOM (decoder nativo del navegador).
 *  Fallback cuando videoCache (mediabunny/WebCodecs) no puede decodificar el
 *  medio. Devuelve un canvas con el frame en `time`, o null si no se pudo. */
export async function getDomVideoFrame(
  src: string,
  time: number,
  blob?: Blob | null,
): Promise<HTMLCanvasElement | null> {
  try {
    let video = domVideoCache.get(src);
    if (!video) {
      video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      // media:// responde Access-Control-Allow-Origin: * — sin crossOrigin el
      // canvas se taintaría y el export (WebCodecs) fallaría al encodificar.
      video.crossOrigin = "anonymous";
      // El <video> con media:// puede colgarse en el stack de medios de Chromium
      // (protocolo custom + Range); cargarlo como blob: es fiable. Reutiliza el
      // blob ya descargado (urlBlobCache) si viene.
      let url = src;
      if (!src.startsWith("blob:") && !src.startsWith("data:")) {
        try {
          const b = blob && blob.size > 0 ? blob : await (await fetch(src)).blob();
          if (b && b.size > 0) url = URL.createObjectURL(b);
        } catch { /* si falla, se intenta con el src original */ }
      }
      video.src = url;
      // Adjuntar al DOM (fuera de pantalla) es NECESARIO para que el decoder
      // produzca frames al hacer seek: un <video> detached (sin appendChild) en
      // Chromium muchas veces no decodifica frames concretos tras un seek →
      // drawImage dibujaría un frame stale/negro. Igual que createOffscreenVideo
      // (lib/track/primitives.ts). El vídeo se cachea y reutiliza entre frames
      // del export, así que se adjunta una sola vez.
      video.style.position = "fixed";
      video.style.left = "-99999px";
      video.style.top = "0";
      video.style.width = "2px";
      video.style.height = "2px";
      document.body.appendChild(video);
      domVideoCache.set(src, video);
    }

    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        const onReady = () => {
          video!.removeEventListener("loadeddata", onReady);
          resolve();
        };
        video!.addEventListener("loadeddata", onReady);
        if (video!.readyState >= 2) {
          resolve();
          return;
        }
        video!.load();
        // Fallback de tiempo: si en 5 s no carga, seguimos (el seek resolverá
        // igualmente con su propio fallback y dibujará lo que haya).
        setTimeout(() => {
          video!.removeEventListener("loadeddata", onReady);
          resolve();
        }, 5000);
      });
    }

    // Seek robusto (propio del export, NO el seekTo compartido de 400 ms): un webm
    // de MediaRecorder con keyframes dispersos obliga al decoder a decodificar hacia
    // adelante desde el keyframe previo, lo que puede tardar >400 ms. Esperamos
    // hasta 2 s el evento 'seeked' (el frame ya decodificado y listo para dibujar).
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        video!.removeEventListener("seeked", finish);
        resolve();
      };
      video!.addEventListener("seeked", finish);
      setTimeout(finish, 2000);
      try {
        const d = video!.duration;
        const tt = isFinite(d) && d > 0 ? Math.min(Math.max(0, time), d - 0.001) : time;
        video!.currentTime = tt;
      } catch {
        finish();
      }
    });

    const cw = video.videoWidth || 1;
    const ch = video.videoHeight || 1;
    if (cw <= 1 && ch <= 1) return null;
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas;
  } catch {
    return null;
  }
}

// Cache de frames GIF por obj.id. Cada frame se materializa en un canvas la
// primera vez que se dibuja (putImageData) — igual que en el export original.
const gifFramesCache = new Map<string, FrameData[]>();

export function hasGifFrames(id: string): boolean {
  return gifFramesCache.has(id);
}

export function getGifFrames(id: string): FrameData[] | undefined {
  return gifFramesCache.get(id);
}

/** Carga y deconstruye un GIF (si es GIF) y guarda sus frames. No-op si no es GIF. */
export async function ensureGifFrames(
  id: string,
  src: string,
): Promise<FrameData[] | null> {
  if (gifFramesCache.has(id)) return gifFramesCache.get(id)!;
  const isGif =
    src.toLowerCase().includes(".gif") || src.startsWith("data:image/gif");
  if (!isGif) return null;
  try {
    const response = await fetch(src);
    const blob = await response.blob();
    const frames = await deconstructGIF(blob);
    if (frames && frames.length > 1) {
      gifFramesCache.set(id, frames);
      return frames;
    }
  } catch (e) {
    console.error("Error cargando GIF:", src, e);
  }
  return null;
}

/** Devuelve el canvas del frame GIF correspondiente al instante clipLocalTime (s). */
export function getGifFrameCanvas(
  frames: FrameData[],
  clipLocalTime: number,
): { canvas: HTMLCanvasElement; w: number; h: number } | null {
  if (!frames || frames.length === 0) return null;
  const elapsedMs = clipLocalTime * 1000;
  let totalGifDuration = 0;
  for (const f of frames) totalGifDuration += f.duration || 100;
  if (totalGifDuration <= 0) totalGifDuration = 100 * frames.length;
  const loopTime = elapsedMs % totalGifDuration;

  let idx = 0;
  let sum = 0;
  for (let i = 0; i < frames.length; i++) {
    const fdur = frames[i].duration || 100;
    if (loopTime >= sum && loopTime < sum + fdur) {
      idx = i;
      break;
    }
    sum += fdur;
  }

  const frame = frames[idx];
  const anyFrame = frame as unknown as { canvas?: HTMLCanvasElement };
  if (!anyFrame.canvas) {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = frame.imageData.width;
    tempCanvas.height = frame.imageData.height;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx?.putImageData(frame.imageData, 0, 0);
    anyFrame.canvas = tempCanvas;
  }
  return {
    canvas: anyFrame.canvas,
    w: frame.imageData.width,
    h: frame.imageData.height,
  };
}

// Duración de los vídeos de objeto (para el bucle en export). Se obtiene con un
// <video> oculto preload='metadata' (sólo lee cabeceras, no decodifica frames).
const videoDurationCache = new Map<string, number>();

/** Duración (s) de un vídeo de objeto. Fallback 1 si aún no se puede medir. */
export function getObjectVideoDuration(src: string): Promise<number> {
  const cached = videoDurationCache.get(src);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    const finish = (d: number) => {
      const valid = Number.isFinite(d) && d > 0 ? d : 1;
      videoDurationCache.set(src, valid);
      try { video.remove(); } catch {}
      resolve(valid);
    };
    video.onloadedmetadata = () => {
      const d = video.duration;
      // Los webm de MediaRecorder reportan a menudo Infinity en loadedmetadata
      // (no almacenan la duración en los metadatos). Seek al final y leer
      // currentTime devuelve la duración real del medio.
      if (!Number.isFinite(d) || d <= 0) {
        let done = false;
        const onSeeked = () => {
          if (done) return;
          done = true;
          video.removeEventListener("seeked", onSeeked);
          finish(video.currentTime);
        };
        video.addEventListener("seeked", onSeeked);
        try { video.currentTime = Number.MAX_SAFE_INTEGER; } catch { finish(1); }
        // Salvaguarda si el 'seeked' no llega.
        setTimeout(() => { if (!done) { done = true; finish(video.currentTime); } }, 1500);
        return;
      }
      finish(d);
    };
    video.onerror = () => finish(1);
    video.src = src;
  });
}