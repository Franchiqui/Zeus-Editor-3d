// Portado casi verbatim de Motor-Render/services/renderer/canvas-renderer.ts.
// Renderer 2D canvas (OffscreenCanvas con fallback a <canvas>) usado por el
// scene graph tanto en preview como en export.
import type { BaseNode } from "./nodes/base-node";

export type CanvasRendererParams = {
  width: number;
  height: number;
  fps: number;
  /** Canvas existente a usar como destino (preview pasa el canvas visible para
   *  renderizar directo y evitar un blit extra; export no lo pasa → OffscreenCanvas). */
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  /** Ancho de decodificación de vídeo para el preview (downscale). Lo leen los
   *  VideoNode/TransitionNode/OverlayVideoNode y lo pasan a videoCache.getFrameAt.
   *  undefined = nativo (export). */
  previewDecodeWidth?: number;
  /** Si true, el canvas se crea con alpha:true y clear() hace clearRect (transparente)
   *  en vez de fillRect negro. Para export con transparencia (selección/lazo): lo
   *  que quede fuera de la máscara será transparente en el WebM/VP9 resultante.
   *  Por defecto false (fondo negro opaco, comportamiento histórico). */
  alpha?: boolean;
};

/**
 * Estado compartido durante una pasada de render. Los nodos de vídeo/imagen
 * escriben `videoArea` (área contain-fit del clip activo) para que los nodos de
 * texto/objeto y la máscara de selección se posicionen relativo al área de vídeo
 * (comportamiento de Zeus, no absoluto como Motor-Render). `mainVideoArea` lo
 * usa CropNode (área del vídeo principal, constante). `globalFilter` lo fija el
 * EffectNode para que los VideoNode puedan combinar filtro global + por clip.
 */
export interface VideoArea {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  sw: number;
  sh: number;
}

export interface RenderState {
  videoArea: VideoArea | null;
  mainVideoArea: VideoArea | null;
  globalFilter: string;
}

export function createRenderState(): RenderState {
  return { videoArea: null, mainVideoArea: null, globalFilter: "" };
}

export class CanvasRenderer {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  width: number;
  height: number;
  fps: number;
  state: RenderState;
  /** Ancho de decodificación de vídeo (preview). undefined = nativo. */
  previewDecodeWidth?: number;
  /** Si true, el canvas tiene canal alpha y clear() deja fondo transparente. */
  alpha: boolean;

  constructor({ width, height, fps, previewDecodeWidth, alpha }: CanvasRendererParams) {
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.state = createRenderState();
    this.previewDecodeWidth = previewDecodeWidth;
    this.alpha = alpha ?? false;

    // SIEMPRE renderizar a un buffer offscreen y luego blitear al canvas destino.
    // Antes se pasaba el canvas visible para "ahorrar el blit", pero el render
    // hace clear() a negro ANTES del decode asíncrono → durante el decode el
    // canvas visible se quedaba negro (pantalla negra en vídeos con decode
    // lento). Con offscreen+blit, el canvas visible sólo se actualiza cuando el
    // frame ya está decodificado → mantiene el frame anterior durante el decode.
    try {
      this.canvas = new OffscreenCanvas(width, height);
    } catch {
      this.canvas = document.createElement("canvas");
      this.canvas.width = width;
      this.canvas.height = height;
    }

    const context = this.canvas.getContext("2d", { alpha: this.alpha });
    if (!context) {
      throw new Error("Failed to get canvas context");
    }

    this.context = context as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D;
  }

  setSize({ width, height }: { width: number; height: number }) {
    this.width = width;
    this.height = height;

    if (this.canvas instanceof OffscreenCanvas) {
      this.canvas = new OffscreenCanvas(width, height);
    } else {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    const context = this.canvas.getContext("2d", { alpha: this.alpha });
    if (!context) {
      throw new Error("Failed to get canvas context");
    }

    this.context = context as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D;
  }

  private clear() {
    if (this.alpha) {
      // Export con transparencia: fondo transparente para que lo que quede fuera
      // de la máscara de selección (SelectionMaskNode) salga transparente en el
      // WebM/VP9 con alpha. clearRect deja alpha=0.
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    } else {
      this.context.fillStyle = "black";
      this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  async render({ node, time }: { node: BaseNode; time: number }) {
    this.clear();
    await node.render({ renderer: this, time });
  }

  async renderToCanvas({
    node,
    time,
    targetCanvas,
  }: {
    node: BaseNode;
    time: number;
    targetCanvas: HTMLCanvasElement;
  }) {
    await this.render({ node, time });

    // Blit del buffer offscreen al canvas destino. Sólo actualiza el canvas
    // visible cuando el frame ya está decodificado → mantiene el frame anterior
    // durante el decode asíncrono (evita la pantalla negra).
    const ctx = targetCanvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get target canvas context");
    }

    ctx.drawImage(this.canvas, 0, 0, targetCanvas.width, targetCanvas.height);
  }
}