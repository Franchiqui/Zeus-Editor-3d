// TransitionNode: compone la transición A→B (clipA.transitionOut) durante la
// ventana [windowStart, windowEnd). Usa composeTransition con los frames
// decodificados de A y B. Publica el área de vídeo de A (coincide con el export
// original, que usa el videoElement de A durante la transición).
//
// Fiel a getTransitionAtExport:
//  - A: clipLocalTimeA = time - clipA.startTime (mapeo normal).
//  - B: clipLocalTimeB = (time - windowStart) = progress*duration, es decir, B
//    se trata como si empezara en windowStart (solapamiento), independientemente
//    de su propio startTime. Así un clip B sin solapamiento igual entra en la
//    transición desde su inicio de fuente.
import type { CanvasRenderer } from "../canvas-renderer";
import { BaseNode } from "./base-node";
import type { TransitionNodeParams } from "../types";
import { mapClipLocalToSource } from "@/lib/clip-time";
import { videoCache } from "../video-cache/service";
import { urlBlobCache } from "../video-cache/url-blob-cache";
import { containFit, composeTransition } from "../composite/draw-video-fit";

async function resolveFrameA(
  clip: TransitionNodeParams["clipA"],
  url: string,
  time: number,
  sourceStartA: number,
  trimStart: number,
  decodeWidth?: number,
): Promise<{ canvas: CanvasImageSource; sw: number; sh: number } | null> {
  const clipLocalTime = time - sourceStartA;
  if (clipLocalTime < 0 || clipLocalTime >= clip.duration) return null;
  const { sourceTime } = mapClipLocalToSource(clip, clipLocalTime, trimStart);
  const mediaId = clip.mediaFileId || url;
  const blob = await urlBlobCache.get(url);
  const frame = await videoCache.getFrameAt({ mediaId, file: blob, time: sourceTime, decodeWidth });
  if (!frame) return null;
  const c = frame.canvas as OffscreenCanvas | HTMLCanvasElement;
  return { canvas: c, sw: c.width, sh: c.height };
}

async function resolveFrameB(
  clip: TransitionNodeParams["clipB"],
  url: string,
  time: number,
  windowStart: number,
  trimStart: number,
  decodeWidth?: number,
): Promise<{ canvas: CanvasImageSource; sw: number; sh: number } | null> {
  const clipLocalTime = time - windowStart; // B empieza en windowStart (solapamiento)
  if (clipLocalTime < 0) return null;
  const { sourceTime } = mapClipLocalToSource(clip, clipLocalTime, trimStart);
  const mediaId = clip.mediaFileId || url;
  const blob = await urlBlobCache.get(url);
  const frame = await videoCache.getFrameAt({ mediaId, file: blob, time: sourceTime, decodeWidth });
  if (!frame) return null;
  const c = frame.canvas as OffscreenCanvas | HTMLCanvasElement;
  return { canvas: c, sw: c.width, sh: c.height };
}

export class TransitionNode extends BaseNode<TransitionNodeParams> {
  async render({
    renderer,
    time,
  }: {
    renderer: CanvasRenderer;
    time: number;
  }): Promise<void> {
    await super.render({ renderer, time });

    const { clipA, urlA, sourceStartA, clipB, urlB, trimStart, windowStart, windowEnd, type } =
      this.params;
    if (windowEnd <= windowStart) return;
    if (time < windowStart || time >= windowEnd) return;

    const progress = (time - windowStart) / (windowEnd - windowStart);

    const dw = renderer.previewDecodeWidth;
    const frameA = await resolveFrameA(clipA, urlA, time, sourceStartA, trimStart, dw);
    const frameB = await resolveFrameB(clipB, urlB, time, windowStart, trimStart, dw);

    if (!frameA && !frameB) return;
    if (!frameA && frameB) {
      const { dx, dy, dw, dh } = containFit(frameB.sw, frameB.sh, renderer.width, renderer.height);
      renderer.state.videoArea = { dx, dy, dw, dh, sw: frameB.sw, sh: frameB.sh };
      composeTransition(renderer.context, renderer.width, renderer.height, frameB.canvas, frameB.sw, frameB.sh, frameB.canvas, frameB.sw, frameB.sh, 1, "fade", !!clipB.mirrored, !!clipB.mirrored);
      return;
    }
    if (frameA && !frameB) {
      const { dx, dy, dw, dh } = containFit(frameA.sw, frameA.sh, renderer.width, renderer.height);
      renderer.state.videoArea = { dx, dy, dw, dh, sw: frameA.sw, sh: frameA.sh };
      composeTransition(renderer.context, renderer.width, renderer.height, frameA.canvas, frameA.sw, frameA.sh, frameA.canvas, frameA.sw, frameA.sh, 1, "fade", !!clipA.mirrored, !!clipA.mirrored);
      return;
    }

    const areaA = containFit(frameA!.sw, frameA!.sh, renderer.width, renderer.height);
    renderer.state.videoArea = {
      dx: areaA.dx,
      dy: areaA.dy,
      dw: areaA.dw,
      dh: areaA.dh,
      sw: frameA!.sw,
      sh: frameA!.sh,
    };

    composeTransition(
      renderer.context,
      renderer.width,
      renderer.height,
      frameA!.canvas,
      frameA!.sw,
      frameA!.sh,
      frameB!.canvas,
      frameB!.sw,
      frameB!.sh,
      progress,
      type,
      !!clipA.mirrored,
      !!clipB.mirrored,
    );
  }
}