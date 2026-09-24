// ImageNode: dibuja un clip de la pista de imagen contain-fit. Se añade DESPUÉS
// de los VideoNodes para que su área prevalezca si ambos están activos (mismo
// orden/precedencia que getActiveVideoInfo, donde la imagen va última). La imagen
// se carga con crossOrigin='anonymous' (no taint el canvas).
import type { CanvasRenderer } from "../canvas-renderer";
import { BaseNode } from "./base-node";
import type { ImageNodeParams } from "../types";
import { getObjectImage, isImageReady } from "../composite/object-media";
import { containFit, drawVideoFit } from "../composite/draw-video-fit";

export class ImageNode extends BaseNode<ImageNodeParams> {
  async render({
    renderer,
    time,
  }: {
    renderer: CanvasRenderer;
    time: number;
  }): Promise<void> {
    await super.render({ renderer, time });

    const { clip, url } = this.params;
    if (time < clip.startTime || time >= clip.startTime + clip.duration) return;

    const img = getObjectImage(url);
    if (!isImageReady(img)) return;

    const sw = img.naturalWidth;
    const sh = img.naturalHeight;
    const { dx, dy, dw, dh } = containFit(sw, sh, renderer.width, renderer.height);
    // La imagen gana sobre el vídeo (mismo orden que getActiveVideoInfo).
    renderer.state.videoArea = { dx, dy, dw, dh, sw, sh };

    drawVideoFit(renderer.context, img, sw, sh, renderer.width, renderer.height, 1, undefined, !!clip.mirrored);
  }
}