import { flattenPolygon, scanlineIntervalsAtY } from './geometry';
import type { Views, Polygon } from './geometry';

/**
 * Convierte la entrada de la pestaña Mallas en tres vistas ortogonales
 * compatibles con buildViewsMesh / reconstructVoxels.
 *
 * - Frente   = silueta (X·Y)
 * - Superior = la plantilla de altura media (X·Z)
 * - Costado  = si se pasa `sideView`, se usa tal cual (Z·Y).
 *              Si no, se infiere del ancho en Z de las plantillas.
 */
export function meshInputToViews(
  silhouette: Polygon,
  sections: Array<{ y: number; polygon: Polygon }>,
  sideView?: Polygon | null
): Views {
  // 1) Frente = silueta tal cual. Se copian los puntos COMPLETOS
  // (incluidas las asas hIn/hOut de las esquinas curvadas): si solo se
  // copiaran x/y, las curvas dibujadas en la pestaña Mallas se perderían
  // y el objeto 3D saldría con los vértices "en bruto" (pico) en vez de
  // redondo. buildViewsMesh y reconstructVoxels aplanan las asas después.
  const front: Polygon = silhouette.map((p) => ({ ...p }));

  // 2) Superior = plantilla más cercana a y=0.5 (asas incluidas)
  const sorted = [...sections].sort((a, b) => a.y - b.y);
  const mid =
    sorted.find((s) => s.y >= 0.5) ?? sorted[sorted.length - 1] ?? sorted[0];
  const top: Polygon = mid
    ? mid.polygon.map((p) => ({ ...p }))
    : [
        { x: 0.3, y: 0.3 },
        { x: 0.7, y: 0.3 },
        { x: 0.7, y: 0.7 },
        { x: 0.3, y: 0.7 },
      ];

  // 3) Costado: si viene dibujado a mano, se usa tal cual (asas incluidas).
  let side: Polygon;
  if (sideView && sideView.length >= 3) {
    side = sideView.map((p) => ({ ...p }));
  } else {
    // Fallback: inferir el costado del ancho en Z de cada plantilla
    side = [];
    const samples = 24;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const y = t;
      const sec = nearestSection(sorted, 1 - y);
      const zHalf = sec ? halfWidthZ(sec.polygon) : 0.2;
      side.push({ x: 0.5 - zHalf, y });
    }
    for (let i = samples; i >= 0; i--) {
      const t = i / samples;
      const y = t;
      const sec = nearestSection(sorted, 1 - y);
      const zHalf = sec ? halfWidthZ(sec.polygon) : 0.2;
      side.push({ x: 0.5 + zHalf, y });
    }
  }

  return { front, side, top };
}

/**
 * Ancho en x que ocupa un polígono sobre la línea horizontal `y`
 * (y=0 arriba, y=1 abajo en coordenadas de lienzo).
 *
 * Si `y` cae fuera del polígono se recorta a su rango vertical. Si la línea
 * no lo cruza (por ejemplo en el borde exacto superior/inferior, donde el
 * lado horizontal no cuenta como cruce), se reintenta un poco hacia
 * dentro antes de caer al rango x completo.
 */
export function xRangeAtY(poly: Polygon, y: number): [number, number] | null {
  if (poly.length < 2) return null;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minY) || !isFinite(maxY)) return null;

  const clamped = Math.min(Math.max(y, minY), maxY);
  let intervals = scanlineIntervalsAtY(poly, clamped);

  // En los bordes exactos (o en puntas de ancho casi nulo) la línea de
  // barrido puede salir vacía o degenerada: reintentamos hacia dentro.
  const degenerate =
    intervals.length === 0 ||
    intervals.every(([a, b]) => b - a < 0.02);
  if (degenerate && maxY - minY > 0.02) {
    const eps = Math.max(1e-4, (maxY - minY) * 0.01);
    const inner =
      clamped <= (minY + maxY) / 2 ? minY + eps : maxY - eps;
    intervals = scanlineIntervalsAtY(poly, inner);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  for (const [a, b] of intervals) {
    if (a < minX) minX = a;
    if (b > maxX) maxX = b;
  }
  if (intervals.length > 0 && isFinite(minX) && isFinite(maxX)) {
    return [minX, maxX];
  }

  // Último recurso: rango x completo del polígono
  minX = Infinity;
  maxX = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  return isFinite(minX) && isFinite(maxX) ? [minX, maxX] : null;
}

/**
 * Escala un polígono (asas de curvas incluidas) para que ocupe
 * exactamente los rangos indicados en x e y, manteniendo su forma
 * relativa dentro de cada eje.
 */
export function scalePolygonToRanges(
  poly: Polygon,
  xRange: [number, number],
  yRange: [number, number]
): Polygon {
  if (poly.length < 2) return poly.map((p) => ({ ...p }));

  // Los límites se miden sobre la curva real (asas Bézier aplanadas):
  // si solo se midieran los vértices, un círculo dibujado con asas
  // sobresaldría del rango objetivo una vez escalado.
  const flat = flattenPolygon(poly, 24);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of flat) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const minW = 0.02;
  let [tx0, tx1] = xRange;
  let [ty0, ty1] = yRange;
  if (tx1 - tx0 < minW) {
    const c = (tx0 + tx1) / 2;
    tx0 = c - minW / 2;
    tx1 = c + minW / 2;
  }
  if (ty1 - ty0 < minW) {
    const c = (ty0 + ty1) / 2;
    ty0 = c - minW / 2;
    ty1 = c + minW / 2;
  }

  const sx = (tx1 - tx0) / Math.max(1e-6, maxX - minX);
  const sy = (ty1 - ty0) / Math.max(1e-6, maxY - minY);
  const mapX = (x: number) => tx0 + (x - minX) * sx;
  const mapY = (y: number) => ty0 + (y - minY) * sy;

  return poly.map((p) => {
    const next: Polygon[number] = {
      ...p,
      x: mapX(p.x),
      y: mapY(p.y),
    };
    if (p.hIn) next.hIn = { x: mapX(p.hIn.x), y: mapY(p.hIn.y) };
    if (p.hOut) next.hOut = { x: mapX(p.hOut.x), y: mapY(p.hOut.y) };
    return next;
  });
}

/**
 * Ajusta una plantilla (X·Z) a la altura `y` (0 arriba, 1 abajo):
 * su ancho en X se estira al ancho de la silueta en esa altura y su
 * ancho en Z al ancho del costado en esa misma altura.
 */
export function fitSectionToViews(
  polygon: Polygon,
  y: number,
  silhouette?: Polygon | null,
  sideView?: Polygon | null
): Polygon {
  const fallback: [number, number] = [0.3, 0.7];
  const xRange =
    silhouette && silhouette.length >= 3
      ? xRangeAtY(silhouette, y) ?? fallback
      : fallback;
  const zRange =
    sideView && sideView.length >= 3
      ? xRangeAtY(sideView, y) ?? fallback
      : fallback;
  return scalePolygonToRanges(polygon, xRange, zRange);
}

function nearestSection(
  sorted: Array<{ y: number; polygon: Polygon }>,
  targetY: number
) {
  let best = sorted[0];
  let bestD = Infinity;
  for (const s of sorted) {
    const d = Math.abs(s.y - targetY);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function halfWidthZ(poly: Polygon): number {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    if (p.y < min) min = p.y;
    if (p.y > max) max = p.y;
  }
  return Math.max(0.02, (max - min) / 2);
}