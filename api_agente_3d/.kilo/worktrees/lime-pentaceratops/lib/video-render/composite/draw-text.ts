// Portado de VideoEditor.tsx (drawTextClipOnCanvas + hexToRgb, líneas ~5283-5377).
// Dibuja un TextClip sobre el ctx dado, con posición relativa al área de vídeo
// (vX,vY,vW,vH = rect contain-fit del vídeo en el canvas), fade y estilo completo.
import type { TextClip } from "@/types";
import type { TextValuesAtTime } from "@/lib/text-keyframes";

function hexToRgb(hex: string): string {
  if (!hex || hex === "transparent") return "0, 0, 0";
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : "0, 0, 0";
}

export function drawTextClipOnCanvas(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  textClip: TextClip,
  textScale: number,
  vX: number,
  vY: number,
  vW: number,
  vH: number,
  t: number,
  /** Valores interpolados por keyframes (posición/tamaño/opacity). Si se omite,
   *  se leen los campos estáticos del clip (comportamiento sin animación). */
  vals?: TextValuesAtTime,
): void {
  const fs = (vals?.fontSize ?? textClip.fontSize) * textScale;
  ctx.font = `${textClip.isItalic ? "italic " : ""}${textClip.isBold ? "bold " : ""}${fs}px "${(textClip.fontFamily || "Arial").replace(/"/g, "")}", sans-serif`;
  ctx.textAlign = textClip.textAlign || "center";
  ctx.textBaseline = "top";

  const x = vX + ((vals?.x ?? textClip.position.x) / 100) * vW;
  const y = vY + ((vals?.y ?? textClip.position.y) / 100) * vH;

  const elapsed = t - textClip.startTime;
  const remaining = textClip.startTime + textClip.duration - t;
  // Fade opcional (fadeInDuration/fadeOutDuration ahora están en el tipo).
  const fadeIn = textClip.fadeInDuration;
  const fadeOut = textClip.fadeOutDuration;
  let fadeOpacity = 1;
  if (fadeIn && elapsed < fadeIn) {
    fadeOpacity = Math.max(0, elapsed / fadeIn);
  } else if (fadeOut && remaining < fadeOut) {
    fadeOpacity = Math.max(0, remaining / fadeOut);
  }

  const baseOpacity = (vals?.opacity ?? textClip.opacity ?? 100) / 100;
  ctx.globalAlpha = baseOpacity * fadeOpacity;

  const lines = textClip.text.split("\n");
  const lineHeight = fs * 1.2;
  const paddingX = fs * 1.0;
  const paddingY = fs * 0.5;

  // Rotación opcional (textClip.rotation en grados). Se gira alrededor del punto
  // (x, y) del texto => translate(x,y) + rotate, y luego se dibuja todo relativo
  // al origen. Así el texto se queda en su zona de la imagen y solo gira ahí.
  const rot = ((textClip.rotation ?? 0) * Math.PI) / 180;

  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);

  if (textClip.backgroundColor && textClip.backgroundColor !== "transparent") {
    let maxWidth = 0;
    lines.forEach((line: string) => {
      const m = ctx.measureText(line);
      if (m.width > maxWidth) maxWidth = m.width;
    });
    const bgW = maxWidth + paddingX * 2;
    const bgH = lines.length * lineHeight + paddingY * 2;
    // Relativo al origen (x,y): el fondo rodea al texto cuya base está en y.
    const bgX =
      textClip.textAlign === "center"
        ? -maxWidth / 2 - paddingX
        : textClip.textAlign === "right"
          ? -maxWidth - paddingX
          : -paddingX;
    ctx.fillStyle = `rgba(${hexToRgb(textClip.backgroundColor)}, ${(textClip.backgroundOpacity ?? 100) / 100})`;
    ctx.fillRect(bgX, 0, bgW, bgH);
  }

  if ((textClip.shadowBlur ?? 0) > 0) {
    ctx.shadowColor = textClip.shadowColor || "black";
    ctx.shadowBlur = (textClip.shadowBlur ?? 0) * textScale;
    ctx.shadowOffsetX = (textClip.shadowOffset || 0) * textScale;
    ctx.shadowOffsetY = (textClip.shadowOffset || 0) * textScale;
  } else {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  ctx.fillStyle = textClip.color || "#ffffff";

  if ((textClip.borderWidth ?? 0) > 0) {
    ctx.strokeStyle = textClip.borderColor || "black";
    ctx.lineWidth = (textClip.borderWidth ?? 0) * textScale;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
  }

  lines.forEach((line: string, index: number) => {
    const ly = paddingY + index * lineHeight;
    if ((textClip.borderWidth ?? 0) > 0) {
      ctx.strokeText(line, 0, ly);
    }
    ctx.fillText(line, 0, ly);
  });

  ctx.restore();

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  ctx.globalAlpha = 1;
}