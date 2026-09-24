// Resuelve un frame de vídeo (mediabunny CanvasSink) o imagen (HTMLImageElement)
// para un clip en un instante dado. Comparte videoCache + urlBlobCache entre
// preview y export. El mediaId es estable por archivo (para que varios clips del
// mismo vídeo compartan el sink).
import type { TimelineClip } from "@/types";
import { mapClipLocalToSource } from "@/lib/clip-time";
import { videoCache } from "./video-cache/service";
import { urlBlobCache } from "./video-cache/url-blob-cache";
import { getObjectImage, isImageReady } from "./composite/object-media";

export interface ResolvedFrame {
  source: CanvasImageSource;
  sw: number;
  sh: number;
}

function defaultMediaIdFor(clip: TimelineClip, url: string): string {
  return clip.mediaFileId || url;
}

/**
 * Devuelve el frame del clip de vídeo en el instante `time` (tiempo del timeline).
 * `trimStart` = editState.trimStart ?? 0 (necesario para mapClipLocalToSource).
 */
export async function getVideoClipFrame(
  clip: TimelineClip,
  url: string,
  time: number,
  trimStart: number,
): Promise<ResolvedFrame | null> {
  const clipLocalTime = time - clip.startTime;
  if (clipLocalTime < 0 || clipLocalTime >= clip.duration) return null;
  const { sourceTime } = mapClipLocalToSource(clip, clipLocalTime, trimStart);

  const mediaId = defaultMediaIdFor(clip, url);
  const blob = await urlBlobCache.get(url);
  const frame = await videoCache.getFrameAt({ mediaId, file: blob, time: sourceTime });
  if (!frame) return null;
  const canvas = frame.canvas as OffscreenCanvas | HTMLCanvasElement;
  return { source: canvas, sw: canvas.width, sh: canvas.height };
}

/** Devuelve la imagen de un clip de pista image, lista para dibujar. */
export function getImageClipFrame(
  url: string,
): ResolvedFrame | null {
  const img = getObjectImage(url);
  if (!isImageReady(img)) return null;
  return { source: img, sw: img.naturalWidth, sh: img.naturalHeight };
}

/**
 * Probe del tamaño natural del vídeo principal (para CropNode). Decodifica un
 * frame en t=0 y devuelve sus dimensiones. Si no hay clip de vídeo, usa el
 * tamaño del canvas como fallback (sin barras).
 */
export async function probeMainVideoSize(
  clip: TimelineClip | null,
  url: string,
): Promise<{ w: number; h: number } | null> {
  if (!clip || !url) return null;
  try {
    const mediaId = defaultMediaIdFor(clip, url);
    const blob = await urlBlobCache.get(url);
    const frame = await videoCache.getFrameAt({ mediaId, file: blob, time: 0 });
    if (frame) {
      const c = frame.canvas as OffscreenCanvas | HTMLCanvasElement;
      return { w: c.width, h: c.height };
    }
  } catch (e) {
    console.warn("probeMainVideoSize falló:", e);
  }
  return null;
}