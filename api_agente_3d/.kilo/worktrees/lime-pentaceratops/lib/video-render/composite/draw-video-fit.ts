// Portado de VideoEditor.tsx (drawVideoFit + composeTransition, líneas ~5421-5506),
// adaptado para que las fuentes sean CanvasImageSource genéricas (frames de mediabunny
// o imágenes) con dimensiones explícitas, en vez de <video>/ImageBitmap en vivo.
import type { TransitionType } from "@/types";

export interface FitTransform {
  x: number;
  y: number;
  scale: number;
}

export interface FitRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** Rect contain-fit (con barras) de una fuente sw×sh dentro de un área gw×gh. */
export function containFit(sw: number, sh: number, gw: number, gh: number): FitRect {
  const arV = sw / sh;
  const arC = gw / gh;
  if (arV > arC) {
    const dw = gw;
    const dh = gw / arV;
    return { dx: 0, dy: (gh - dh) / 2, dw, dh };
  }
  const dh = gh;
  const dw = gh * arV;
  return { dx: (gw - dw) / 2, dy: 0, dw, dh };
}

/** Dibuja `source` (ya con dimensiones sw×sh) ajustado contain-fit al área gw×gh. */
export function drawVideoFit(
  gctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  gw: number,
  gh: number,
  alpha = 1,
  transform?: FitTransform,
  mirror = false,
): void {
  if (!source) return;
  const arV = sw / sh;
  const arC = gw / gh;
  let dw2: number, dh2: number, dx2: number, dy2: number;
  if (arV > arC) {
    dw2 = gw;
    dh2 = gw / arV;
    dx2 = 0;
    dy2 = (gh - dh2) / 2;
  } else {
    dh2 = gh;
    dw2 = gh * arV;
    dx2 = (gw - dw2) / 2;
    dy2 = 0;
  }
  gctx.save();
  gctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (mirror) {
    // Espejo horizontal alrededor del centro del rect contain-fit: el contenido
    // se voltea pero permanece ocupando exactamente el mismo rectángulo.
    const cx = dx2 + dw2 / 2;
    const cy = dy2 + dh2 / 2;
    gctx.translate(cx, cy);
    gctx.scale(-1, 1);
    gctx.translate(-cx, -cy);
  }
  if (transform) {
    gctx.translate(gw / 2 + transform.x, gh / 2 + transform.y);
    gctx.scale(transform.scale, transform.scale);
    gctx.translate(-gw / 2, -gh / 2);
  }
  gctx.drawImage(source, 0, 0, sw, sh, dx2, dy2, dw2, dh2);
  gctx.restore();
}

/**
 * Compone la transición (clip A + clip B) sobre `gctx` (área gw×gh). NO aplica el
 * filtro de efectos global (eso lo hace el SelectionMaskNode/FilterNode por fuera);
 * el blur propio de la transición 'blur' sí queda horneado aquí.
 */
export function composeTransition(
  gctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  gw: number,
  gh: number,
  va: CanvasImageSource,
  vaW: number,
  vaH: number,
  vb: CanvasImageSource,
  vbW: number,
  vbH: number,
  progress: number,
  transType: TransitionType | string,
  mirrorA = false,
  mirrorB = false,
): void {
  const p = Math.max(0, Math.min(1, progress));
  switch (transType) {
    case "fade":
    case "dissolve":
      drawVideoFit(gctx, va, vaW, vaH, gw, gh, 1, undefined, mirrorA);
      drawVideoFit(gctx, vb, vbW, vbH, gw, gh, p, undefined, mirrorB);
      break;
    case "blur":
      gctx.filter = `blur(${p * 20}px)`;
      drawVideoFit(gctx, va, vaW, vaH, gw, gh, 1 - p, undefined, mirrorA);
      gctx.filter = `blur(${(1 - p) * 20}px)`;
      drawVideoFit(gctx, vb, vbW, vbH, gw, gh, p, undefined, mirrorB);
      gctx.filter = "none";
      break;
    case "slide-left":
      drawVideoFit(gctx, va, vaW, vaH, gw, gh, 1, { x: -p * gw, y: 0, scale: 1 }, mirrorA);
      drawVideoFit(gctx, vb, vbW, vbH, gw, gh, 1, { x: (1 - p) * gw, y: 0, scale: 1 }, mirrorB);
      break;
    case "slide-right":
      drawVideoFit(gctx, va, vaW, vaH, gw, gh, 1, { x: p * gw, y: 0, scale: 1 }, mirrorA);
      drawVideoFit(gctx, vb, vbW, vbH, gw, gh, 1, { x: -(1 - p) * gw, y: 0, scale: 1 }, mirrorB);
      break;
    case "slide-up":
      drawVideoFit(gctx, va, vaW, vaH, gw, gh, 1, { x: 0, y: -p * gh, scale: 1 }, mirrorA);
      drawVideoFit(gctx, vb, vbW, vbH, gw, gh, 1, { x: 0, y: (1 - p) * gh, scale: 1 }, mirrorB);
      break;
    case "slide-down":
      drawVideoFit(gctx, va, vaW, vaH, gw, gh, 1, { x: 0, y: p * gh, scale: 1 }, mirrorA);
      drawVideoFit(gctx, vb, vbW, vbH, gw, gh, 1, { x: 0, y: -(1 - p) * gh, scale: 1 }, mirrorB);
      break;
    case "zoom-in":
      drawVideoFit(gctx, va, vaW, vaH, gw, gh, 1 - p, { x: 0, y: 0, scale: 1 + p }, mirrorA);
      drawVideoFit(gctx, vb, vbW, vbH, gw, gh, p, { x: 0, y: 0, scale: 0.5 + p * 0.5 }, mirrorB);
      break;
    case "zoom-out":
      drawVideoFit(gctx, va, vaW, vaH, gw, gh, 1 - p, { x: 0, y: 0, scale: 1 - p * 0.5 }, mirrorA);
      drawVideoFit(gctx, vb, vbW, vbH, gw, gh, p, { x: 0, y: 0, scale: 1.5 - p * 0.5 }, mirrorB);
      break;
    default:
      drawVideoFit(gctx, va, vaW, vaH, gw, gh, 1, undefined, mirrorA);
      drawVideoFit(gctx, vb, vbW, vbH, gw, gh, p, undefined, mirrorB);
  }
}