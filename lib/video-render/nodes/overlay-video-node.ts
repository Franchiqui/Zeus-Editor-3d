// OverlayVideoNode: dibuja un vídeo superpuesto (VideoOverlay) a pantalla completa
// sobre la escena, con opacidad y zoom. Decodifica frames vía mediabunny (random-
// access, mismo cache que VideoNode). En export se reproduce en sincronía con el
// tiempo principal desde overlay.seekOffset, en bucle dentro de sourceDuration.
import type { CanvasRenderer } from "../canvas-renderer";
import { BaseNode } from "./base-node";
import type { OverlayVideoNodeParams } from "../types";
import { videoCache } from "../video-cache/service";
import { urlBlobCache } from "../video-cache/url-blob-cache";
import { drawVideoFit } from "../composite/draw-video-fit";

export class OverlayVideoNode extends BaseNode<OverlayVideoNodeParams> {
  async render({
    renderer,
    time,
  }: {
    renderer: CanvasRenderer;
    time: number;
  }): Promise<void> {
    await super.render({ renderer, time });

    const { overlay, resolveUrl } = this.params;
    if (!overlay || !overlay.src || overlay.sourceDuration <= 0) return;

    // Tiempo fuente: in-point + tiempo principal, en bucle dentro de la duración.
    const dur = overlay.sourceDuration;
    let sourceTime = (overlay.seekOffset || 0) + time;
    sourceTime = ((sourceTime % dur) + dur) % dur;

    const url = resolveUrl(overlay.src);
    let blob;
    try {
      blob = await urlBlobCache.get(url);
    } catch {
      return;
    }
    let frame;
    try {
      frame = await videoCache.getFrameAt({ mediaId: overlay.src, file: blob, time: sourceTime, decodeWidth: renderer.previewDecodeWidth });
    } catch {
      return;
    }
    if (!frame) return;

    const canvas = frame.canvas as OffscreenCanvas | HTMLCanvasElement;
    const sw = canvas.width;
    const sh = canvas.height;
    const alpha = Math.max(0, Math.min(1, overlay.opacity / 100));
    const zoom = overlay.zoom > 0 ? overlay.zoom : 1;

    drawVideoFit(
      renderer.context,
      canvas,
      sw,
      sh,
      renderer.width,
      renderer.height,
      alpha,
      zoom !== 1 ? { x: 0, y: 0, scale: zoom } : undefined,
    );
  }
}