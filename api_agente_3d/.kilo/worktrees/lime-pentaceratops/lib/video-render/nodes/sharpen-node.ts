// SharpenNode: aplica "Intensidad" (igual que el editor de imágenes) a la capa de
// vídeo. El image editor usa un filtro SVG (feConvolveMatrix/feGaussianBlur) sobre
// un <img>; el vídeo se renderiza en canvas 2D, donde ctx.filter NO soporta url()
// (y menos aún en OffscreenCanvas del export). Así que:
//  - intensity < 0  => suavizado: ctx.filter = blur(std) con std = (-intensity/100)*1.5
//    (GPU, rápido; mismo valor que el image editor).
//  - intensity > 0  => nitidez: convolución 3x3 con el MISMO kernel que el image editor
//    (centro 1+4k, lados −k, k = pow(intensity/100, 1.4)*5). Pesada en CPU pero fiel.
//  - intensity == 0 => passthrough (render directo de los hijos, sin temp).
//
// Envuelve a los hijos (la capa de vídeo). Los renderiza a un canvas temporal y luego
// vuelca el resultado al contexto real. El renderer.state.videoArea lo siguen
// publicando los VideoNode (mismo tamaño => misma área), así que texto/objetos y la
// máscara de selección se posicionan igual.
import type { CanvasRenderer } from "../canvas-renderer";
import { BaseNode } from "./base-node";
import type { SharpenNodeParams } from "../types";
import { createOffscreenCanvas } from "../canvas-utils";

/** Convolución 3x3 de nitidez (Laplacian sharpen): out = (1+4k)*center − k*(N+S+E+W). */
export function applySharpen(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  intensity: number,
): void {
  const k = Math.pow(intensity / 100, 1.4) * 5;
  const center = 1 + 4 * k;
  const w4 = w * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      // Borde: copiar sin tocar (no hay vecinos completos).
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        dst[idx] = src[idx];
        dst[idx + 1] = src[idx + 1];
        dst[idx + 2] = src[idx + 2];
        dst[idx + 3] = src[idx + 3];
        continue;
      }
      for (let c = 0; c < 3; c++) {
        const i = idx + c;
        const ctr = src[i];
        const n = src[i - w4];
        const s = src[i + w4];
        const e = src[i + 4];
        const west = src[i - 4];
        const v = center * ctr - k * (n + s + e + west);
        dst[i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      dst[idx + 3] = src[idx + 3]; // alpha sin tocar
    }
  }
}

export class SharpenNode extends BaseNode<SharpenNodeParams> {
  private tempCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private tempCtx:
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
    await super.render({ renderer, time });

    const intensity = this.params.intensity ?? 0;
    // Passthrough: sin coste cuando no hay intensidad.
    if (!intensity) {
      for (const child of this.children) {
        await child.render({ renderer, time });
      }
      return;
    }

    this.ensureTemp(renderer.width, renderer.height);
    const tctx = this.tempCtx!;
    const tcanvas = this.tempCanvas!;
    tctx.clearRect(0, 0, tcanvas.width, tcanvas.height);
    tctx.filter = "none";

    // Renderizar los hijos (capa de vídeo) al temporal sin filtro.
    const realCtx = renderer.context;
    (renderer as { context: typeof tctx }).context = tctx;
    for (const child of this.children) {
      await child.render({ renderer, time });
    }
    (renderer as { context: typeof realCtx }).context = realCtx;

    const ctx = renderer.context;
    // Filtro que el padre (EffectNode, rama sin máscara) haya fijado en ctx.filter
    // (brillo/contraste/saturación/matiz/desenfoque global). SharpenNode renderiza
    // sus hijos al temporal SIN filtro y luego vuelca el resultado al canvas real;
    // si aquí hiciéramos ctx.filter = "none" perderíamos el filtro global del vídeo
    // (bug: con intensidad != 0 desaparecían brillo/contraste/etc. en export sin
    // máscara). Con máscara, EffectNode pone el filtro a "none" en su temporal y él
    // mismo compositea con el globalFilter, así que aquí parentFilter = "none" y no
    // hay doble aplicación. Combinamos el filtro del padre con el nuestro.
    const parentFilter = ctx.filter && ctx.filter !== "none" ? ctx.filter : "";
    if (intensity < 0) {
      // Suavizado: blur por GPU (ctx.filter). Mismo std que el image editor.
      const std = (-intensity / 100) * 1.5;
      const blurFilter = `blur(${std}px)`;
      ctx.save();
      ctx.filter = parentFilter ? `${parentFilter} ${blurFilter}` : blurFilter;
      ctx.drawImage(tcanvas, 0, 0);
      ctx.restore();
    } else {
      // Nitidez: convolución 3x3 sobre los píxeles del temporal.
      const w = tcanvas.width;
      const h = tcanvas.height;
      const src = tctx.getImageData(0, 0, w, h);
      const out = tctx.createImageData(w, h);
      applySharpen(src.data, out.data, w, h, intensity);
      tctx.putImageData(out, 0, 0);
      ctx.save();
      ctx.filter = parentFilter || "none";
      ctx.drawImage(tcanvas, 0, 0);
      ctx.restore();
    }
  }

  private ensureTemp(w: number, h: number) {
    if (
      this.tempCanvas &&
      this.tempCanvas.width === w &&
      this.tempCanvas.height === h &&
      this.tempCtx
    ) {
      return;
    }
    this.tempCanvas = createOffscreenCanvas({ width: w, height: h });
    const ctx = this.tempCanvas.getContext("2d", { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("SharpenNode: no se pudo obtener contexto 2d del temporal");
    this.tempCtx = ctx;
  }
}