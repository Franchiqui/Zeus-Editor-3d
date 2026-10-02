// ObjectNode: dibuja un overlay (ObjectClip PNG/GIF/vídeo o clip de pista de
// efectos con overlayKind). Posicionado relativo al área de vídeo activa, animado
// por keyframes vía getObjectValuesAtTime + fade. Los GIF se dibujan frame a
// frame (getGifFrameCanvas); los PNG via getObjectImage; los vídeos vía
// videoCache (mediabunny random-access, mismo motor que los clips de vídeo).
import type { CanvasRenderer } from "../canvas-renderer";
import { BaseNode } from "./base-node";
import type { ObjectNodeParams } from "../types";
import { getObjectValuesAtTime, getFadeMultiplierAtTime, defaultCorners } from "@/lib/object-keyframes";
import { drawHomographyImage } from "@/lib/homography";
import { videoCache } from "../video-cache/service";
import { urlBlobCache } from "../video-cache/url-blob-cache";
import {
  ensureGifFrames,
  getGifFrames,
  getGifFrameCanvas,
  getObjectImage,
  getObjectVideoDuration,
  getDomVideoFrame,
  isImageReady,
  isVideoSrc,
  looksLikeImage,
} from "../composite/object-media";

export class ObjectNode extends BaseNode<ObjectNodeParams> {
  async render({
    renderer,
    time,
  }: {
    renderer: CanvasRenderer;
    time: number;
  }): Promise<void> {
    await super.render({ renderer, time });

    const { objectClip: obj } = this.params;
    if (time < obj.startTime || time >= obj.startTime + obj.duration) {
      return;
    }

    const vals = getObjectValuesAtTime(obj, time);
    const fadeMultiplier = getFadeMultiplierAtTime(obj, time);
    const clipLocalTime = time - obj.startTime;

    const area = renderer.state.videoArea;
    const dw = area ? area.dw : renderer.width;
    const dh = area ? area.dh : renderer.height;
    const dx = area ? area.dx : 0;
    const dy = area ? area.dy : 0;

    const isGifSource =
      obj.src.toLowerCase().includes(".gif") || obj.src.startsWith("data:image/gif");

    // Detección de vídeo: el src es la fuente de verdad (data:video/ o extensión de
    // vídeo). PERO "Crear capa con la selección" tipo vídeo genera un src `blob:`
    // SIN extensión (URL.createObjectURL), que isVideoSrc no reconoce. En ese caso
    // usamos obj.mediaType como pista: si mediaType==='video' y el src NO es una
    // imagen evidente (mira looksLikeImage), lo tratamos como vídeo. Esto preserva
    // los overlays de la pista de efectos: llevan mediaType:'video' hardcodeado pero
    // su src es un PNG (media://.../x.png o data:image/png) → looksLikeImage true →
    // no se tratan como vídeo y siguen por la rama de imagen.
    const isVideoSource =
      isVideoSrc(obj.src) || (obj.mediaType === "video" && !looksLikeImage(obj.src));

    const corners = vals.corners ?? obj.corners ?? defaultCorners();
    const defCorners = defaultCorners();
    const hasDeformation = corners.some(
      (c, i) => Math.abs(c.x - defCorners[i].x) > 0.1 || Math.abs(c.y - defCorners[i].y) > 0.1
    );

    if (isVideoSource) {
      // Objeto vídeo: por defecto se reproduce en BUCLE mientras el clip esté
      // activo (loopTime = tiempo local % duración). Con syncToTimeline se
      // comporta como un clip normal: avanza UNA vez con el tiempo del clip y, si
      // el clip dura más que el vídeo, se congela en el último frame. Se usa
      // videoCache (mediabunny) como los clips de vídeo normales: random-access,
      // sin depender de un <video> DOM reproduciéndose, y soporta alpha.
      const duration = await getObjectVideoDuration(obj.src);
      const loopTime = obj.syncToTimeline
        ? Math.max(0, Math.min(clipLocalTime, duration > 0 ? duration - 0.01 : clipLocalTime))
        : duration > 0 ? clipLocalTime % duration : clipLocalTime;
      const blob = await urlBlobCache.get(obj.src);
      // Frame vía mediabunny (WebCodecs). Si no puede decodificar el medio (p. ej.
      // webm de MediaRecorder de "Crear capa con selección"), se captura el frame
      // con un <video> DOM nativo — el mismo decoder que usa el preview.
      let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
      let fw = 0;
      let fh = 0;
      try {
        const frame = await videoCache.getFrameAt({
          mediaId: obj.src,
          file: blob,
          time: loopTime,
        });
        if (frame) {
          canvas = frame.canvas as OffscreenCanvas | HTMLCanvasElement;
          fw = canvas.width;
          fh = canvas.height;
        }
      } catch {
        // mediabunny lanzó → fallback DOM.
      }
      if (!canvas) {
        const dom = await getDomVideoFrame(obj.src, loopTime, blob);
        if (!dom) return;
        canvas = dom;
        fw = dom.width;
        fh = dom.height;
      }
      if (!fw || !fh) return;

      const drawW = (dw * vals.width) / 100;
      const drawH =
        vals.height !== undefined
          ? (dh * vals.height) / 100
          : drawW * (fh / fw);
      const centerX = dx + (dw * vals.x) / 100;
      const centerY = dy + (dh * vals.y) / 100;

      const ctx = renderer.context;
      ctx.save();
      ctx.globalAlpha = (vals.opacity / 100) * fadeMultiplier;
      if (hasDeformation) {
        const srcRect: [number, number][] = [
          [centerX - drawW / 2, centerY - drawH / 2],
          [centerX + drawW / 2, centerY - drawH / 2],
          [centerX + drawW / 2, centerY + drawH / 2],
          [centerX - drawW / 2, centerY + drawH / 2],
        ];
        // Espejo: invertir la paramétrica u del rect (la imagen se voltea pero
        // los 4 vértices deformables quedan exactamente en el mismo sitio).
        const finalSrcRect = obj.mirrored
          ? [srcRect[1], srcRect[0], srcRect[3], srcRect[2]]
          : srcRect;
        const dst = cornersToQuad(corners, centerX, centerY, drawW, drawH);
        drawHomographyImage(ctx, canvas as unknown as HTMLCanvasElement, finalSrcRect, dst, 0, 0, fw, fh);
      } else {
        if (obj.mirrored) {
          ctx.translate(centerX, centerY);
          ctx.scale(-1, 1);
          ctx.translate(-centerX, -centerY);
        }
        ctx.drawImage(canvas, centerX - drawW / 2, centerY - drawH / 2, drawW, drawH);
      }
      ctx.restore();
      return;
    }

    if (isGifSource) {
      let frames = getGifFrames(obj.id);
      if (!frames) {
        void ensureGifFrames(obj.id, obj.src);
        return;
      }
      const gif = getGifFrameCanvas(frames, clipLocalTime);
      if (!gif) return;
      const drawW = (dw * vals.width) / 100;
      const drawH = vals.height !== undefined ? (dh * vals.height) / 100 : drawW * (gif.h / gif.w);
      const centerX = dx + (dw * vals.x) / 100;
      const centerY = dy + (dh * vals.y) / 100;
      const ctx = renderer.context;
      ctx.save();
      ctx.globalAlpha = (vals.opacity / 100) * fadeMultiplier;
      if (hasDeformation) {
        // Homografía (mismo warp que el editor): las 4 esquinas del GIF
        // quedan exactamente en los 4 vértices deformables.
        const srcRect: [number, number][] = [
          [centerX - drawW / 2, centerY - drawH / 2],
          [centerX + drawW / 2, centerY - drawH / 2],
          [centerX + drawW / 2, centerY + drawH / 2],
          [centerX - drawW / 2, centerY + drawH / 2],
        ];
        const finalSrcRect = obj.mirrored
          ? [srcRect[1], srcRect[0], srcRect[3], srcRect[2]]
          : srcRect;
        const dst = cornersToQuad(corners, centerX, centerY, drawW, drawH);
        drawHomographyImage(ctx, gif.canvas, finalSrcRect, dst, 0, 0, gif.w, gif.h);
      } else {
        if (obj.mirrored) {
          ctx.translate(centerX, centerY);
          ctx.scale(-1, 1);
          ctx.translate(-centerX, -centerY);
        }
        ctx.drawImage(gif.canvas, centerX - drawW / 2, centerY - drawH / 2, drawW, drawH);
      }
      ctx.restore();
      return;
    }

    const img = getObjectImage(obj.src);
    if (!isImageReady(img)) return;

    const drawW = (dw * vals.width) / 100;
    // Altura: si vals.height está definido (capas de selección), usarlo directamente;
    // si no, deducir del aspecto de la imagen (comportamiento original).
    const drawH = vals.height !== undefined ? (dh * vals.height) / 100 : drawW * (img.naturalHeight / img.naturalWidth);
    const centerX = dx + (dw * vals.x) / 100;
    const centerY = dy + (dh * vals.y) / 100;

    const ctx = renderer.context;
    ctx.save();
    ctx.globalAlpha = (vals.opacity / 100) * fadeMultiplier;
    if (hasDeformation) {
      // Homografía (mismo warp que el editor): las 4 esquinas de la imagen
      // quedan exactamente en los 4 vértices deformables.
      const srcRect: [number, number][] = [
        [centerX - drawW / 2, centerY - drawH / 2],
        [centerX + drawW / 2, centerY - drawH / 2],
        [centerX + drawW / 2, centerY + drawH / 2],
        [centerX - drawW / 2, centerY + drawH / 2],
      ];
      const finalSrcRect = obj.mirrored
        ? [srcRect[1], srcRect[0], srcRect[3], srcRect[2]]
        : srcRect;
      const dst = cornersToQuad(corners, centerX, centerY, drawW, drawH);
      drawHomographyImage(ctx, img, finalSrcRect, dst, 0, 0, img.naturalWidth, img.naturalHeight);
    } else {
      if (obj.mirrored) {
        ctx.translate(centerX, centerY);
        ctx.scale(-1, 1);
        ctx.translate(-centerX, -centerY);
      }
      ctx.drawImage(img, centerX - drawW / 2, centerY - drawH / 2, drawW, drawH);
    }
    ctx.restore();
  }
}

/**
 * Convierte los 4 corners (en ±50, centro = 0) a un cuadrilátero destino
 * en px del canvas, centrado en (centerX, centerY) y escalado por
 * (drawW, drawH). Orden: sup-izq, sup-der, inf-der, inf-izq.
 */
function cornersToQuad(
  corners: { x: number; y: number }[],
  centerX: number,
  centerY: number,
  drawW: number,
  drawH: number,
): [number, number][] {
  return corners.map((c) => [
    centerX + (c.x / 100) * drawW,
    centerY + (c.y / 100) * drawH,
  ]) as [number, number][];
}