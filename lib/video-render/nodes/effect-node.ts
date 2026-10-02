// EffectNode: envuelve la capa de vídeo y aplica los efectos globales — filtro
// (brightness/contrast/saturation/hue/blur) e intensidad (nitidez por convolución
// 3x3 / suavizado por blur) — con la máscara de selección (dentro/fuera, dos
// pasadas) EXACTAMENTE como renderFrame del export original.
//
// "Solo dentro / Solo fuera" (scope) ahora aplica a TODOS los efectos, incluida la
// intensidad: antes SharpenNode iba dentro de EffectNode y afilaba TODO el frame
// ignorando la selección. Ahora EffectNode posee la intensidad y compone una
// versión "con efecto" (afilada/filtrada) y una "sin efecto" por scope.
//
// Casos:
//  - Sin selección (o fuera de rango temporal): efecto a todo el frame.
//  - Con selección + efecto + shape: dos pasadas. inside → efecto sólo en la
//    silueta; outside → efecto sólo en el complemento.
// Los objetos y texto se renderizan FUERA de este nodo (sin efecto ni máscara),
// igual que en renderFrame.
//
// Silueta cambiante (prioridad, igual que SelectionMaskNode):
//  1) motionMasks (SAM2, raster alpha por frame): recorte píxel a píxel con la
//     máscara (destination-in en canvas auxiliar). "Solo fuera" = invertir SAM2.
//  2) motionPaths (lazo por puntos deformado por frame): clip por path deformado.
//  3) Legacy: caja + path estático transformado (effectiveSelectionShape).
import type { CanvasRenderer, VideoArea } from "../canvas-renderer";
import { BaseNode } from "./base-node";
import type { SelectionMaskNodeParams } from "../types";
import { createOffscreenCanvas } from "../canvas-utils";
import { effectTimeStrength, isEffectTimeActive, buildSelectionPath, buildSelectionPaths } from "../composite/selection-path";
import {
  effectiveSelectionShape,
  effectiveSelectionMotionPaths,
  effectiveSelectionMaskUrl,
} from "@/lib/selection-keyframes";
import { loadMaskImage } from "../selection-mask-cache";
import { applySharpen } from "./sharpen-node";
import type { BezierAnchor } from "@/types";

export class EffectNode extends BaseNode<SelectionMaskNodeParams> {
  private tempCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private tempCtx:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null = null;
  // Canvas afilado (intensidad > 0): convolución 3x3 sobre el temporal. Si la
  // intensidad es 0 o < 0 (blur vía ctx.filter) no se usa.
  private sharpCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private sharpCtx:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null = null;
  // Canvas auxiliar para recortar la pasada "de silueta" contra la máscara raster
  // (SAM2): se dibuja la versión con/sin efecto, se recorta con destination-in
  // contra el PNG alpha, y se vuelca encima de la pasada base.
  private maskCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private maskCtx:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null = null;

  async render({
    renderer,
    time,
  }: {
    renderer: CanvasRenderer;
    time: number;
  }): Promise<void> {
    const { selection, globalFilter, intensity } = this.params;
    // Fuerza 0..1 por rango temporal + fades in/out (1 sin rango o sin fades).
    const strength = effectTimeStrength(selection, time);
    const effectsActive = strength > 0;
    const intRaw = intensity ?? 0;
    // Filtro combinado: globalFilter + blur de suavizado si intensidad < 0.
    const blurFromIntensity = intRaw < 0 ? `blur(${(-intRaw / 100) * 1.5}px)` : "";
    const fullFilter = [globalFilter, blurFromIntensity].filter(Boolean).join(" ");
    const hasFullFilter = Boolean(fullFilter);
    const hasSharpen = intRaw > 0; // afilado por convolución (necesita canvas aparte)
    const hasAnyEffect = hasFullFilter || intRaw !== 0;

    const sel = selection?.enabled ? selection : null;
    const useMask =
      sel && sel.shape && effectsActive && hasAnyEffect && Boolean(sel.shape.type);

    // ---- Sin máscara: efecto a todo el frame (o nada si fuera de rango) ----
    if (!useMask) {
      const ctx = renderer.context;
      // effectsActive puede ser false si hay selección con rango temporal y estamos
      // fuera de él → ningún efecto aplica (passthrough), igual que el original.
      const applyEffect = effectsActive && hasAnyEffect;
      if (!applyEffect) {
        ctx.save();
        ctx.filter = "none";
        for (const child of this.children) {
          await child.render({ renderer, time });
        }
        ctx.restore();
        return;
      }
      // Con fade (strength < 1) hace falta mezclar el frame con efecto sobre el frame
      // sin efecto → los hijos van a un temporal y se vuelca raw + eff*alpha.
      const needsTempMix = strength < 1;
      if (intRaw === 0 && !needsTempMix) {
        // Sólo filtro global (sin intensidad) y sin fade: path directo, igual que
        // antes — los hijos se dibujan al canvas real con ctx.filter puesto.
        ctx.save();
        ctx.filter = fullFilter || "none";
        for (const child of this.children) {
          await child.render({ renderer, time });
        }
        ctx.restore();
        return;
      }
      // Con intensidad (o con fade): se renderiza al temporal sin efecto (raw) y se
      // vuelca: primero raw, luego la versión con filtro encima con el alpha del fade
      // (1 sin fade → resultado idéntico al original, el eff cubre el raw).
      await this.renderChildrenToTemp(renderer, time);
      const eff = hasSharpen ? this.sharpenTemp(renderer) : this.tempCanvas!;
      ctx.save();
      ctx.filter = "none";
      ctx.drawImage(this.tempCanvas!, 0, 0);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = strength;
      ctx.filter = fullFilter || "none";
      ctx.drawImage(eff, 0, 0);
      ctx.restore();
      return;
    }

    // ---- Con máscara: dos pasadas por scope ----
    await this.renderChildrenToTemp(renderer, time);
    const rawCanvas = this.tempCanvas!;
    const effCanvas = hasSharpen ? this.sharpenTemp(renderer) : rawCanvas;
    const inside = sel!.scope === "inside";

    const area = renderer.state.videoArea;
    const dx = area ? area.dx : 0;
    const dy = area ? area.dy : 0;
    const dw = area ? area.dw : renderer.width;
    const dh = area ? area.dh : renderer.height;

    // Prioridad de silueta (igual que SelectionMaskNode): motionMasks > motionPaths
    // > shape estático. SAM2 rellena motionMasks; el lazo por puntos rellena
    // motionPaths; son mutuamente excluyentes.
    const maskUrl = effectiveSelectionMaskUrl(sel!, time);
    const motionPaths: BezierAnchor[][] | null = maskUrl
      ? null
      : effectiveSelectionMotionPaths(sel!, time);

    if (maskUrl) {
      // Raster (SAM2): recorte píxel a píxel. Si la máscara no carga, cae al modelo
      // vectorial (shape estático) para no romper el efecto.
      try {
        const mask = await loadMaskImage(maskUrl);
        if (this.renderRasterMask(renderer, rawCanvas, effCanvas, mask, sel!, fullFilter, area, strength)) {
          return;
        }
      } catch {
        // Máscara no disponible: cae al recorte vectorial abajo.
      }
    }

    // Vector (motionPaths o shape estático): dos pasadas con clip por Path2D.
    const shape = effectiveSelectionShape(sel!, time);
    const path = motionPaths
      ? buildSelectionPaths(motionPaths, dx, dy, dw, dh)
      : buildSelectionPath(shape, dx, dy, dw, dh);

    const ctx = renderer.context;
    ctx.save();
    ctx.filter = "none";
    // Base: el frame sin efecto (raw). Para outside con fade se vuelca también el
    // eff con el alpha del fade encima; sin fade el comportamiento es idéntico al
    // original (el eff completo cubre el raw).
    ctx.drawImage(rawCanvas, 0, 0);
    if (inside) {
      // Silueta con efecto (con el fade como alpha).
      ctx.save();
      ctx.globalAlpha = strength;
      ctx.clip(path);
      ctx.filter = fullFilter || "none";
      ctx.drawImage(effCanvas, 0, 0);
      ctx.restore();
    } else {
      // Efecto en todo el frame (con fade)...
      ctx.save();
      ctx.globalAlpha = strength;
      ctx.filter = fullFilter || "none";
      ctx.drawImage(effCanvas, 0, 0);
      ctx.restore();
      // ...y la silueta restaurada a raw por encima (sin fade: es el vídeo original).
      ctx.save();
      ctx.clip(path);
      ctx.filter = "none";
      ctx.drawImage(rawCanvas, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Renderiza los hijos al temporal SIN efecto (raw). Engaña a los hijos cambiando
   * renderer.context al temporal (mismo tamaño => containFit igual).
   */
  private async renderChildrenToTemp(renderer: CanvasRenderer, time: number) {
    this.ensureTemp(renderer.width, renderer.height);
    const tctx = this.tempCtx!;
    const tcanvas = this.tempCanvas!;
    tctx.clearRect(0, 0, tcanvas.width, tcanvas.height);
    tctx.filter = "none";
    const realCtx = renderer.context;
    (renderer as { context: typeof tctx }).context = tctx;
    try {
      for (const child of this.children) {
        await child.render({ renderer, time });
      }
    } finally {
      (renderer as { context: typeof realCtx }).context = realCtx;
    }
  }

  /** Calcula la versión afilada del temporal (convolución 3x3 sobre sus píxeles). */
  private sharpenTemp(renderer: CanvasRenderer): OffscreenCanvas | HTMLCanvasElement {
    this.ensureSharp(renderer.width, renderer.height);
    const sctx = this.sharpCtx!;
    const scanvas = this.sharpCanvas!;
    const tctx = this.tempCtx!;
    const tcanvas = this.tempCanvas!;
    const w = tcanvas.width;
    const h = tcanvas.height;
    const src = tctx.getImageData(0, 0, w, h);
    const out = sctx.createImageData(w, h);
    applySharpen(src.data, out.data, w, h, this.params.intensity ?? 0);
    sctx.putImageData(out, 0, 0);
    return scanvas;
  }

  /**
   * Recorte raster (SAM2) para "solo dentro / solo fuera", ahora con efecto
   * (afilado/filtrado) vs raw:
   *  - base (todo el frame): inside → raw sin efecto; outside → eff con efecto.
   *  - silueta (recortada a la máscara alpha): inside → eff con efecto; outside →
   *    raw sin efecto. Vuelcada encima de la base con source-over.
   * Resultado: inside aplica el efecto a la silueta real; outside al complemento
   * (invertir SAM2). Devuelve true si pintó.
   */
  private renderRasterMask(
    renderer: CanvasRenderer,
    rawCanvas: OffscreenCanvas | HTMLCanvasElement,
    effCanvas: OffscreenCanvas | HTMLCanvasElement,
    mask: HTMLImageElement,
    sel: NonNullable<SelectionMaskNodeParams["selection"]>,
    fullFilter: string,
    area: VideoArea | null,
    strength: number,
  ): boolean {
    const inside = sel.scope === "inside";
    this.ensureMask(renderer.width, renderer.height);
    const mctx = this.maskCtx!;
    const mcanvas = this.maskCanvas!;

    // Pasada base sobre el canvas principal. Con fade en scope outside la base es
    // raw + eff*alpha (el efecto del fondo se desvanece); sin fade (o inside) es el
    // comportamiento original (raw o eff a tope).
    const ctx = renderer.context;
    ctx.save();
    ctx.filter = "none";
    if (!inside && strength < 1) {
      ctx.drawImage(rawCanvas, 0, 0);
      ctx.save();
      ctx.globalAlpha = strength;
      ctx.filter = fullFilter || "none";
      ctx.drawImage(effCanvas, 0, 0);
      ctx.restore();
    } else {
      ctx.save();
      ctx.filter = inside ? "none" : fullFilter;
      ctx.drawImage(inside ? rawCanvas : effCanvas, 0, 0);
      ctx.restore();
    }

    // Silueta: versión recortada a la máscara, vuelcada encima. Con fade, la silueta
    // que lleva el efecto (inside → eff) se vuelca con el alpha del fade; la que
    // restaura el vídeo original (outside → raw) va siempre a tope.
    mctx.clearRect(0, 0, mcanvas.width, mcanvas.height);
    mctx.filter = "none";
    mctx.save();
    mctx.filter = inside ? fullFilter : "none";
    mctx.drawImage(inside ? effCanvas : rawCanvas, 0, 0);
    mctx.restore();
    // Recortar al alpha de la máscara (res nativa sw×sh → área dx,dy,dw,dh).
    mctx.save();
    mctx.globalCompositeOperation = "destination-in";
    const sw = area ? area.sw : mask.naturalWidth;
    const sh = area ? area.sh : mask.naturalHeight;
    const dx = area ? area.dx : 0;
    const dy = area ? area.dy : 0;
    const dw = area ? area.dw : renderer.width;
    const dh = area ? area.dh : renderer.height;
    mctx.drawImage(mask, 0, 0, sw, sh, dx, dy, dw, dh);
    mctx.restore();

    // Composite la silueta sobre la base (source-over, sin re-filtrar).
    ctx.filter = "none";
    ctx.globalAlpha = inside ? strength : 1;
    ctx.drawImage(mcanvas, 0, 0);
    ctx.restore();
    return true;
  }

  private ensureTemp(w: number, h: number) {
    if (this.tempCanvas && this.tempCanvas.width === w && this.tempCanvas.height === h && this.tempCtx) {
      return;
    }
    this.tempCanvas = createOffscreenCanvas({ width: w, height: h });
    const ctx = this.tempCanvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("EffectNode: no se pudo obtener contexto 2d del temporal");
    this.tempCtx = ctx;
  }

  private ensureSharp(w: number, h: number) {
    if (this.sharpCanvas && this.sharpCanvas.width === w && this.sharpCanvas.height === h && this.sharpCtx) {
      return;
    }
    this.sharpCanvas = createOffscreenCanvas({ width: w, height: h });
    const ctx = this.sharpCanvas.getContext("2d", { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("EffectNode: no se pudo obtener contexto 2d del afilado");
    this.sharpCtx = ctx;
  }

  private ensureMask(w: number, h: number) {
    if (this.maskCanvas && this.maskCanvas.width === w && this.maskCanvas.height === h && this.maskCtx) {
      return;
    }
    this.maskCanvas = createOffscreenCanvas({ width: w, height: h });
    const ctx = this.maskCanvas.getContext("2d", { alpha: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("EffectNode: no se pudo obtener contexto 2d del canvas de máscara");
    this.maskCtx = ctx;
  }
}