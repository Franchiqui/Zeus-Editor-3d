// Portado de VideoEditor.tsx (buildSelectionPath + isEffectTimeActive, líneas ~116-168).
// Construye un Path2D para la forma de selección mapeando los % (0-100) del área de
// vídeo al rect contain-fit (dx,dy,dw,dh) en píxeles. Usado por SelectionMaskNode.
import type { BezierAnchor, SelectionShape, VideoSelectionState } from "@/types";

/**
 * Rect destino (px del área de vídeo dx,dy,dw,dh) para dibujar la máscara de pintura
 * "pegada" a la selección: mapea la caja base (donde se pintó) a la caja actual. La
 * máscara entera se transforma así: baseBox.origin → currentBox.origin y se escala por
 * currentBox/baseBox. La pintura dentro de baseBox sigue al objeto; entre keyframes la
 * caja se interpola, así la medida cambia progresivamente (no a saltos).
 */
export function paintFollowRect(
  baseBox: { x: number; y: number; width: number; height: number },
  currentBox: { x: number; y: number; width: number; height: number },
  dx: number, dy: number, dw: number, dh: number,
): { x: number; y: number; width: number; height: number } {
  const sx = baseBox.width > 0 ? currentBox.width / baseBox.width : 1;
  const sy = baseBox.height > 0 ? currentBox.height / baseBox.height : 1;
  const destXpct = currentBox.x - baseBox.x * sx;
  const destYpct = currentBox.y - baseBox.y * sy;
  const destWpct = 100 * sx;
  const destHpct = 100 * sy;
  return {
    x: dx + (destXpct / 100) * dw,
    y: dy + (destYpct / 100) * dh,
    width: (destWpct / 100) * dw,
    height: (destHpct / 100) * dh,
  };
}

/** ¿Está activo el rango temporal de la selección en el instante t? */
export function isEffectTimeActive(
  selection: VideoSelectionState | null | undefined,
  t: number,
): boolean {
  if (!selection?.enabled || !selection.timeEnabled) return true;
  const s = selection.timeStart ?? 0;
  const e = selection.timeEnd ?? Infinity;
  return t >= s && t <= e;
}

/**
 * Fuerza 0..1 del efecto en el instante t por rango temporal + fades: 0 fuera del
 * rango; dentro, rampa 0→1 durante fadeIn segundos tras timeStart y 1→0 durante
 * fadeOut segundos antes de timeEnd. Sin rango activo (o sin fades) devuelve 1.
 */
export function effectTimeStrength(
  selection: VideoSelectionState | null | undefined,
  t: number,
): number {
  if (!selection?.enabled || !selection.timeEnabled) return 1;
  const s = selection.timeStart ?? 0;
  const e = selection.timeEnd ?? Infinity;
  if (t < s || t > e) return 0;
  const fadeIn = Math.max(0, selection.fadeIn ?? 0);
  const fadeOut = Math.max(0, selection.fadeOut ?? 0);
  let a = 1;
  if (fadeIn > 0 && t < s + fadeIn) a = Math.min(1, (t - s) / fadeIn);
  if (fadeOut > 0 && t > e - fadeOut) a = Math.min(a, Math.max(0, (e - t) / fadeOut));
  return Math.max(0, Math.min(1, a));
}

export function buildSelectionPath(
  shape: SelectionShape,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): Path2D {
  const path = new Path2D();
  const X = (p: number) => dx + (p / 100) * dw;
  const Y = (p: number) => dy + (p / 100) * dh;
  if (shape.type === "wand") {
    // Varita mágica: la forma real es la máscara raster (motionMasks), que tiene
    // prioridad en los nodos (maskUrl > motionPaths > shape). Si se llega aquí sin
    // máscara (fallback), no recortar nada: path vacío.
    return path;
  } else if (shape.type === "circle") {
    const cx = X(shape.x + shape.width / 2);
    const cy = Y(shape.y + shape.height / 2);
    const rx = (shape.width / 200) * dw;
    const ry = (shape.height / 200) * dh;
    path.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  } else if (shape.type === "freehand") {
    const paths =
      shape.paths ||
      (shape as unknown as { polygons?: { x: number; y: number }[][] }).polygons ||
      [];
    appendBezierPaths(path, paths, X, Y);
  } else {
    path.rect(
      X(shape.x),
      Y(shape.y),
      (shape.width / 100) * dw,
      (shape.height / 100) * dh,
    );
  }
  return path;
}

/**
 * Construye un Path2D a partir de paths Bézier explícitos (silueta deformada por
 * frame, "lazo por puntos") mapeados de % (0-100) al rect contain-fit (dx,dy,dw,dh).
 * Igual que la rama freehand de buildSelectionPath pero con paths propios.
 */
export function buildSelectionPaths(
  paths: BezierAnchor[][],
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): Path2D {
  const path = new Path2D();
  const X = (p: number) => dx + (p / 100) * dw;
  const Y = (p: number) => dy + (p / 100) * dh;
  appendBezierPaths(path, paths || [], X, Y);
  return path;
}

function appendBezierPaths(
  path: Path2D,
  paths: BezierAnchor[][],
  X: (p: number) => number,
  Y: (p: number) => number,
): void {
  for (const anchors of paths) {
    if (!anchors || anchors.length < 2) continue;
    const first = anchors[0] as {
      x: number; y: number;
      hInX?: number; hInY?: number; hOutX?: number; hOutY?: number;
    };
    path.moveTo(X(first.x), Y(first.y));
    const n = anchors.length;
    for (let i = 0; i < n; i++) {
      const a = anchors[i];
      const b = anchors[(i + 1) % n];
      const hasBezier = "hOutX" in a && "hInX" in b;
      if (hasBezier) {
        path.bezierCurveTo(
          X((a as BezierAnchor).hOutX),
          Y((a as BezierAnchor).hOutY),
          X((b as BezierAnchor).hInX),
          Y((b as BezierAnchor).hInY),
          X(b.x),
          Y(b.y),
        );
      } else {
        path.lineTo(X(b.x), Y(b.y));
      }
    }
    path.closePath();
  }
}