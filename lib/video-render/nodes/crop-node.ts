// CropNode: nodo final (solo export). Renderiza todo el contenido a un canvas
// escena a tamaño completo (sceneWidth×sceneHeight) y luego blitea la sub-región
// del recorte (calculada sobre el área contain-fit del vídeo principal) al canvas
// del renderer (que ya está a tamaño de salida con dimensiones pares para yuv420p).
// Reproduce flushCropFrame + outputCanvas del export original.
import type { CanvasRenderer } from "../canvas-renderer";
import { CanvasRenderer as FullRenderer } from "../canvas-renderer";
import { BaseNode } from "./base-node";
import type { CropNodeParams } from "../types";

export class CropNode extends BaseNode<CropNodeParams> {
  private sceneRenderer: FullRenderer | null = null;

  async render({
    renderer,
    time,
  }: {
    renderer: CanvasRenderer;
    time: number;
  }): Promise<void> {
    const { crop, mainVideoArea, sceneWidth, sceneHeight } = this.params;

    if (!this.sceneRenderer) {
      this.sceneRenderer = new FullRenderer({
        width: sceneWidth,
        height: sceneHeight,
        fps: renderer.fps,
      });
    }
    const scene = this.sceneRenderer;
    // clear negro del canvas escena (las barras quedan negras, igual que el original).
    scene.context.fillStyle = "black";
    scene.context.fillRect(0, 0, scene.width, scene.height);
    // Reiniciar el estado de render de la pasada (área de vídeo la fijan los hijos).
    scene.state.videoArea = null;
    scene.state.mainVideoArea = null;

    for (const child of this.children) {
      await child.render({ renderer: scene, time });
    }

    // Sub-región del recorte sobre el área contain-fit del vídeo principal.
    const sx = mainVideoArea.dx + (crop.x / 100) * mainVideoArea.dw;
    const sy = mainVideoArea.dy + (crop.y / 100) * mainVideoArea.dh;
    const sw = (crop.width / 100) * mainVideoArea.dw;
    const sh = (crop.height / 100) * mainVideoArea.dh;

    const ctx = renderer.context;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, renderer.width, renderer.height);
    ctx.drawImage(
      scene.canvas,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      renderer.width,
      renderer.height,
    );
  }
}