// PaintNode: dibuja la capa de pintura (brocha/bote/gotero/borrador) sobre el vídeo.
// Capa raster única (dataURL PNG con alpha, `paint.mask`) a resolución nativa, dura
// todo el vídeo (o [timeStart,timeEnd] si timeEnabled). Si hay `baseBox` y selección
// 'inside', la máscara se transforma de baseBox→caja actual de la selección
// (`effectiveSelectionShape` al tiempo t): la pintura va pegada a la selección y entre
// los keyframes de selección se mueve/escala progresivamente. Va por encima del
// EffectNode y por debajo de objetos/texto. En preview no se añade (includeOverlays):
// la pinta el overlay DOM (PaintOverlay) 1:1.
import type { CanvasRenderer } from "../canvas-renderer";
import { BaseNode } from "./base-node";
import type { PaintNodeParams } from "../types";
import { getObjectImage, isImageReady } from "../composite/object-media";
import { buildSelectionPath, paintFollowRect } from "../composite/selection-path";
import { effectiveSelectionShape } from "@/lib/selection-keyframes";
import type { VideoPaintState, VideoSelectionState } from "@/types";

/** ¿Está activo el rango temporal de la pintura en el instante t? */
export function isPaintTimeActive(paint: VideoPaintState | null | undefined, t: number): boolean {
  if (!paint?.enabled || !paint.timeEnabled) return true;
  const s = paint.timeStart ?? 0;
  const e = paint.timeEnd ?? Infinity;
  return t >= s && t <= e;
}

/**
 * Fuerza 0..1 de la pintura en t por rango temporal + fades (misma semántica que
 * effectTimeStrength de la selección). Sin rango activo devuelve 1.
 */
export function paintTimeStrength(paint: VideoPaintState | null | undefined, t: number): number {
  if (!paint?.enabled || !paint.timeEnabled) return 1;
  const s = paint.timeStart ?? 0;
  const e = paint.timeEnd ?? Infinity;
  if (t < s || t > e) return 0;
  const fadeIn = Math.max(0, paint.fadeIn ?? 0);
  const fadeOut = Math.max(0, paint.fadeOut ?? 0);
  let a = 1;
  if (fadeIn > 0 && t < s + fadeIn) a = Math.min(1, (t - s) / fadeIn);
  if (fadeOut > 0 && t > e - fadeOut) a = Math.min(a, Math.max(0, (e - t) / fadeOut));
  return Math.max(0, Math.min(1, a));
}

/**
 * Caja actual (%, 0-100) a la que transformar la pintura en t, o null si la pintura es
 * libre (capa fija full-frame). Sólo cuando hay baseBox y selección activa 'inside':
 * sigue a la selección (interpola entre los keyframes de selección).
 */
export function paintFollowBox(
  paint: VideoPaintState,
  selection: VideoSelectionState | null | undefined,
  t: number,
): { x: number; y: number; width: number; height: number } | null {
  if (!paint.baseBox || !selection?.enabled || selection.scope !== 'inside' || !selection.shape) return null;
  const shape = effectiveSelectionShape(selection, t);
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
}

export class PaintNode extends BaseNode<PaintNodeParams> {
  async render({
    renderer,
    time,
  }: {
    renderer: CanvasRenderer;
    time: number;
  }): Promise<void> {
    await super.render({ renderer, time });

    const { paint, selection } = this.params;
    if (!paint?.enabled) return;
    const strength = paintTimeStrength(paint, time);
    if (strength <= 0) return;

    const area = renderer.state.videoArea;
    const dx = area ? area.dx : 0;
    const dy = area ? area.dy : 0;
    const dw = area ? area.dw : renderer.width;
    const dh = area ? area.dh : renderer.height;
    const ctx = renderer.context;

    // Modo "rellenar todo menos la selección": rellena con el color de pintura sólo la
    // región del scope (dentro o fuera de la selección)dejando el vídeo visible en la
    // región contraria. IMPORTANTE: usar clip (no fill-then-erase): como el PaintNode
    // dibuja sobre el vídeo en el MISMO canvas, destination-out borraría también el vídeo
    // del agujero → quedaría transparente → en el export se vería NEGRO. Con clip, la
    // región no rellenada conserva el vídeo. El agujero se calcula en cada frame desde
    // effectiveSelectionShape → sigue al objeto sin deformarse (sin raster).
    if (paint.inverseFill) {
      const sel = selection ?? null;
      const shape = sel && sel.enabled && sel.shape ? effectiveSelectionShape(sel, time) : null;
      ctx.save();
      if (shape) {
        const selPath = buildSelectionPath(shape, dx, dy, dw, dh);
        if (sel?.scope === 'inside') {
          // scope 'dentro': pintar DENTRO de la selección (el objeto); el fondo conserva el vídeo.
          ctx.clip(selPath);
        } else {
          // scope 'fuera': pintar FUERA de la selección (el fondo); el objeto conserva el vídeo.
          const combined = new Path2D();
          combined.rect(dx, dy, dw, dh);
          combined.addPath(selPath);
          ctx.clip(combined, 'evenodd');
        }
      }
      ctx.globalAlpha = Math.max(0, Math.min(1, (paint.opacity / 100) * strength));
      ctx.fillStyle = paint.color;
      ctx.fillRect(dx, dy, dw, dh);
      ctx.restore();
      return;
    }

    if (!paint.mask) return;

    const img = getObjectImage(paint.mask);
    if (!isImageReady(img)) return; // export la precarga; en su defecto, salta

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (paint.opacity / 100) * strength));
    // Si la pintura va pegada a la selección, transformar la máscara de baseBox→caja
    // actual (sigue al objeto; entre keyframes de selección se interpola). Si no,
    // capa fija full-frame.
    const currentBox = paintFollowBox(paint, selection ?? null, time);
    if (currentBox && paint.baseBox) {
      const r = paintFollowRect(paint.baseBox, currentBox, dx, dy, dw, dh);
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, r.x, r.y, r.width, r.height);
    } else {
      ctx.drawImage(img, dx, dy, dw, dh);
    }
    ctx.restore();
  }
}