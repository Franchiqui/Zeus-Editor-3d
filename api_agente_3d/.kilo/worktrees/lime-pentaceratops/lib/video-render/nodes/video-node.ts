// VideoNode: dibuja un clip de vídeo (frame decodificado vía mediabunny) contain-fit
// en el canvas. Calcula y publica el área de vídeo (renderer.state.videoArea) para
// que texto/objetos/selección se posicionen relativo a ella. Solo dibuja dentro de
// su rango standalone (excluyendo ventanas de transición que lo cubren).
import type { CanvasRenderer } from "../canvas-renderer";
import { BaseNode } from "./base-node";
import type { VideoNodeParams } from "../types";
import { mapClipLocalToSource } from "@/lib/clip-time";
import { videoCache } from "../video-cache/service";
import { urlBlobCache } from "../video-cache/url-blob-cache";
import { containFit, drawVideoFit } from "../composite/draw-video-fit";
import { getObjectImage, isImageReady, looksLikeImage } from "../composite/object-media";

/** Multiplicador de fade in/out del clip en el instante clipLocalTime. */
export function clipFadeMultiplier(
  clip: VideoNodeParams["clip"],
  clipLocalTime: number,
): number {
  const fadeInDur = clip.fadeInDuration || 0;
  const fadeOutDur = clip.fadeOutDuration || 0;
  if (fadeInDur > 0 && clipLocalTime < fadeInDur) {
    return clipLocalTime / fadeInDur;
  }
  if (fadeOutDur > 0 && clipLocalTime > clip.duration - fadeOutDur) {
    return (clip.duration - clipLocalTime) / fadeOutDur;
  }
  return 1;
}

export class VideoNode extends BaseNode<VideoNodeParams> {
  async render({
    renderer,
    time,
  }: {
    renderer: CanvasRenderer;
    time: number;
  }): Promise<void> {
    await super.render({ renderer, time });

    const { clip, url, mediaId, trimStart, sourceStart, standaloneStart, standaloneEnd, isMainReference } =
      this.params;
    if (time < standaloneStart || time >= standaloneEnd) return;

    // sourceStart = inicio efectivo. Para un clip normal = clip.startTime. Si es el
    // destino (B) de una transición del clip anterior, = windowStart (solapamiento):
    // así B reproduce fluido desde su cabeza durante la transición y continúa tras
    // ella sin saltos ni doble reproducción de la cabeza. El fade se mide sobre el
    // tiempo local efectivo (time - sourceStart), no sobre el startTime crudo.
    const clipLocalTime = time - sourceStart;
    if (clipLocalTime < 0 || clipLocalTime >= clip.duration) return;

    // Imagen en la pista de vídeo (PNG/JPG/etc. colocada como clip de fondo, sin
    // overlayKind): mediabunny no demuxea imágenes ( UnsupportedInputFormatError) y
    // videoCache la marcaría fallida con ruido. Se dibuja como estática contain-fit,
    // igual que un frame de vídeo congelado durante todo el clip, y publica el
    // videoArea para que texto/objetos/selección se posicionen sobre ella.
    if (looksLikeImage(url)) {
      const img = getObjectImage(url);
      if (!isImageReady(img)) {
        await new Promise<void>((resolve) => {
          const done = () => {
            img.removeEventListener("load", done);
            img.removeEventListener("error", done);
            resolve();
          };
          img.addEventListener("load", done);
          img.addEventListener("error", done);
          setTimeout(done, 5000);
        });
      }
      const sw = img.naturalWidth || 1;
      const sh = img.naturalHeight || 1;
      if (sw <= 1 && sh <= 1) return;
      const { dx, dy, dw, dh } = containFit(sw, sh, renderer.width, renderer.height);
      renderer.state.videoArea = { dx, dy, dw, dh, sw, sh };
      if (isMainReference) {
        renderer.state.mainVideoArea = { dx, dy, dw, dh, sw, sh };
      }
      const fade = Math.max(0, Math.min(1, clipFadeMultiplier(clip, clipLocalTime)));
      drawVideoFit(renderer.context, img, sw, sh, renderer.width, renderer.height, fade, undefined, !!clip.mirrored);
      return;
    }

    const { sourceTime } = mapClipLocalToSource(clip, clipLocalTime, trimStart);
    const blob = await urlBlobCache.get(url);
    const frame = await videoCache.getFrameAt({ mediaId, file: blob, time: sourceTime, decodeWidth: renderer.previewDecodeWidth });
    if (!frame) return;

    const canvas = frame.canvas as OffscreenCanvas | HTMLCanvasElement;
    const sw = canvas.width;
    const sh = canvas.height;
    const { dx, dy, dw, dh } = containFit(sw, sh, renderer.width, renderer.height);

    // Publicar el área de vídeo para texto/objetos/selección. El último clip activo
    // en dibujar gana (igual que getActiveVideoInfo: último match del array).
    renderer.state.videoArea = { dx, dy, dw, dh, sw, sh };
    if (isMainReference) {
      renderer.state.mainVideoArea = { dx, dy, dw, dh, sw, sh };
    }

    const fade = Math.max(0, Math.min(1, clipFadeMultiplier(clip, clipLocalTime)));
    drawVideoFit(renderer.context, canvas, sw, sh, renderer.width, renderer.height, fade, undefined, !!clip.mirrored);
  }
}