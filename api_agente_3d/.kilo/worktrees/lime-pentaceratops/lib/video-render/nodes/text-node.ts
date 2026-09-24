// TextNode: dibuja un TextClip sobre el canvas, posicionado relativo al área de
// vídeo activa (renderer.state.videoArea) — igual que drawTextClipOnCanvas en el
// export original. textScale = ratio entre el alto del canvas y un alto de
// referencia (1080), para que el tamaño de fuente se vea igual en cualquier resolución.
import type { CanvasRenderer } from "../canvas-renderer";
import { BaseNode } from "./base-node";
import type { TextNodeParams } from "../types";
import { drawTextClipOnCanvas } from "../composite/draw-text";
import { getTextValuesAtTime } from "@/lib/text-keyframes";

const REFERENCE_HEIGHT = 1080;

export class TextNode extends BaseNode<TextNodeParams> {
  async render({
    renderer,
    time,
  }: {
    renderer: CanvasRenderer;
    time: number;
  }): Promise<void> {
    await super.render({ renderer, time });

    const { textClip } = this.params;
    if (time < textClip.startTime || time >= textClip.startTime + textClip.duration) return;

    const area = renderer.state.videoArea;
    // Fallback al canvas completo si ningún vídeo está activo (raro).
    const vW = area ? area.dw : renderer.width;
    const vH = area ? area.dh : renderer.height;
    const vX = area ? area.dx : 0;
    const vY = area ? area.dy : 0;

    const textScale = renderer.height / REFERENCE_HEIGHT;
    // Valores interpolados por keyframes (posición/tamaño/opacity). Sin keyframes
    // getTextValuesAtTime devuelve los campos estáticos del clip (mismo resultado).
    const vals = getTextValuesAtTime(textClip, time);
    drawTextClipOnCanvas(renderer.context, textClip, textScale, vX, vY, vW, vH, time, vals);
  }
}