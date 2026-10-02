// SelectionMaskNode: envuelve todo el contenido (vídeo+efectos+pintura+objetos+texto)
// y aplica la máscara de selección: el área DENTRO de la selección se muestra;
// el área FUERA se vuelve transparente (para export con alpha). El canvas del
// renderer debe tener alpha:true para que el exterior quede transparente (no negro).
import type { CanvasRenderer } from '../canvas-renderer';
import { BaseNode } from './base-node';
import type { SelectionMaskNodeParams } from '../types';
import { createOffscreenCanvas } from '../canvas-utils';
import { isEffectTimeActive, effectTimeStrength, buildSelectionPath, buildSelectionPaths } from '../composite/selection-path';
import { effectiveSelectionShape, effectiveSelectionMotionPaths, effectiveSelectionMaskUrl } from '@/lib/selection-keyframes';
import { loadMaskImage } from '../selection-mask-cache';

export class SelectionMaskNode extends BaseNode<SelectionMaskNodeParams> {
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

    const { selection } = this.params;
    const sel = selection?.enabled ? selection : null;
    if (!sel || !sel.shape || !isEffectTimeActive(sel, time)) {
      for (const child of this.children) {
        await child.render({ renderer, time });
      }
      return;
    }
    // Fuerza 0..1 por rango temporal + fades: el contenido recortado se desvanece
    // (hacia transparente) según la rampa in/out.
    const strength = effectTimeStrength(sel, time);

    // Tres modos de silueta (en orden de prioridad):
    // 1) Máscara raster por frame (SAM2): composite destination-in contra el PNG.
    // 2) Paths deformados por frame (lazo por puntos): clip por path deformado.
    // 3) Legacy: caja + path estático transformado (effectiveSelectionShape).
    const maskUrl = effectiveSelectionMaskUrl(sel, time);
    const motionPaths = maskUrl ? null : effectiveSelectionMotionPaths(sel, time);
    const shape = maskUrl || motionPaths ? null : effectiveSelectionShape(sel, time);

    if (!maskUrl && !motionPaths && !shape) {
      for (const child of this.children) {
        await child.render({ renderer, time });
      }
      return;
    }

    this.ensureTemp(renderer.width, renderer.height);
    const tctx = this.tempCtx!;
    const tcanvas = this.tempCanvas!;
    tctx.clearRect(0, 0, tcanvas.width, tcanvas.height);
    tctx.filter = 'none';

    const realCtx = renderer.context;
    const realWidth = renderer.width;
    const realHeight = renderer.height;
    (renderer as { context: typeof tctx }).context = tctx;
    for (const child of this.children) {
      await child.render({ renderer, time });
    }
    (renderer as { context: typeof realCtx }).context = realCtx;
    void realWidth;
    void realHeight;

    const ctx = renderer.context;
    ctx.save();
    ctx.clearRect(0, 0, renderer.width, renderer.height);
    ctx.filter = 'none';

    const area = renderer.state.videoArea;
    const dx = area ? area.dx : 0;
    const dy = area ? area.dy : 0;
    const dw = area ? area.dw : renderer.width;
    const dh = area ? area.dh : renderer.height;

    // scope='outside' = "Invertir selección": lo que se MANTIENE es el complemento
    // de la silueta (el fondo), y la silueta del objeto queda transparente. Para un
    // PNG/canvas eso es destination-out (borra donde la máscara es opaca); para un
    // path vectorial, se dibuja el contenido y luego se borra el interior del path.
    const inverted = sel.scope === 'outside';

    if (maskUrl) {
      // Máscara raster: el contenido (tcanvas) ya está dibujado; recortamos contra
      // el PNG alineado al área de vídeo (contain-fit). destination-in mantiene la
      // silueta del objeto; destination-out la borra (inversión) y deja el fondo.
      try {
        const mask = await loadMaskImage(maskUrl);
        ctx.save();
        ctx.globalAlpha = strength;
        ctx.drawImage(tcanvas, 0, 0);
        ctx.restore();
        ctx.save();
        ctx.globalCompositeOperation = inverted ? 'destination-out' : 'destination-in';
        // La máscara está en res nativa (sw×sh); se dibuja en (dx,dy,dw,dh).
        const sw = area ? area.sw : mask.naturalWidth;
        const sh = area ? area.sh : mask.naturalHeight;
        ctx.drawImage(mask, 0, 0, sw, sh, dx, dy, dw, dh);
        ctx.restore();
      } catch {
        // Si la máscara no carga, no recortes (no rompas el export).
        ctx.save();
        ctx.globalAlpha = strength;
        ctx.drawImage(tcanvas, 0, 0);
        ctx.restore();
      }
    } else if (inverted) {
      // Path invertido: dibuja todo el contenido y luego borra el interior del path
      // (destination-out + fill) → queda el exterior, el interior es transparente.
      const path = motionPaths
        ? buildSelectionPaths(motionPaths, dx, dy, dw, dh)
        : buildSelectionPath(shape!, dx, dy, dw, dh);
      ctx.save();
      ctx.globalAlpha = strength;
      ctx.drawImage(tcanvas, 0, 0);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fill(path);
      ctx.restore();
    } else {
      const path = motionPaths
        ? buildSelectionPaths(motionPaths, dx, dy, dw, dh)
        : buildSelectionPath(shape!, dx, dy, dw, dh);
      ctx.save();
      ctx.clip(path);
      ctx.save();
      ctx.globalAlpha = strength;
      ctx.drawImage(tcanvas, 0, 0);
      ctx.restore();
      ctx.restore();
    }
    ctx.restore();
  }

  private ensureTemp(w: number, h: number) {
    if (this.tempCanvas && this.tempCanvas.width === w && this.tempCanvas.height === h && this.tempCtx) {
      return;
    }
    this.tempCanvas = createOffscreenCanvas({ width: w, height: h });
    const ctx = this.tempCanvas.getContext('2d', { alpha: true });
    if (!ctx) {
      throw new Error('Failed to get temp canvas context');
    }
    this.tempCtx = ctx as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D;
  }
}
