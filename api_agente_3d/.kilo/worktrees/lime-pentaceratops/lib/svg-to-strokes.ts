// lib/svg-to-strokes.ts
// Helper para convertir un elemento SVG (icono) en trazos editables del editor.
// Reutiliza la misma lógica de extracción de contornos que importPNG.

import { getTextBounds } from '@/lib/draw-stroke';

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  points: Point[];
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  type: 'line' | 'curve';
  holes?: Point[][];
  shapeType?: 'circle' | 'rectangle' | 'text';
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  rotation?: number;
}

// ---------------------------------------------------------------------------
// Utilidades de contorno
// ---------------------------------------------------------------------------

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function getCentroid(pts: Point[]): Point {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

function traceContourBoundary(filled: Uint8Array, w: number, h: number): Point[] {
  let startX = -1, startY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (filled[y * w + x]) {
        startX = x; startY = y;
        break;
      }
    }
    if (startX !== -1) break;
  }
  if (startX === -1) return [];

  const isFilled = (x: number, y: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return false;
    return filled[y * w + x] === 1;
  };

  const dirs = [
    { dx: 0, dy: -1 },  // 0 N
    { dx: 1, dy: -1 },  // 1 NE
    { dx: 1, dy: 0 },   // 2 E
    { dx: 1, dy: 1 },   // 3 SE
    { dx: 0, dy: 1 },   // 4 S
    { dx: -1, dy: 1 },  // 5 SW
    { dx: -1, dy: 0 },  // 6 W
    { dx: -1, dy: -1 }, // 7 NW
  ];

  const contour: Point[] = [];
  let x = startX, y = startY;
  let backtrack = 6;

  do {
    contour.push({ x, y });
    let found = false;
    for (let i = 1; i <= 8; i++) {
      const d = (backtrack + i) % 8;
      const nx = x + dirs[d].dx;
      const ny = y + dirs[d].dy;
      if (isFilled(nx, ny)) {
        backtrack = (d + 4) % 8;
        x = nx; y = ny;
        found = true;
        break;
      }
    }
    if (!found) break;
  } while (x !== startX || y !== startY);

  return contour;
}

function simplifyContourOrdered(pts: Point[], step: number): Point[] {
  if (pts.length <= 2) return pts;
  const result: Point[] = [];
  for (let i = 0; i < pts.length; i += step) {
    result.push(pts[i]);
  }
  if (result.length > 2) {
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.abs(last.x - first.x) > 1 || Math.abs(last.y - first.y) > 1) {
      result.push(first);
    }
  }
  return result;
}

function douglasPeucker(pts: Point[], epsilon: number): Point[] {
  if (pts.length <= 2) return pts;
  const sqEps = epsilon * epsilon;

  function findFarthest(start: number, end: number): { index: number; maxSq: number } {
    let maxSq = 0;
    let index = start;
    const x1 = pts[start].x, y1 = pts[start].y;
    const x2 = pts[end].x, y2 = pts[end].y;
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    for (let i = start + 1; i < end; i++) {
      let distSq: number;
      if (lenSq === 0) {
        const a = pts[i].x - x1;
        const b = pts[i].y - y1;
        distSq = a * a + b * b;
      } else {
        const t = ((pts[i].x - x1) * dx + (pts[i].y - y1) * dy) / lenSq;
        const clamped = Math.max(0, Math.min(1, t));
        const projX = x1 + clamped * dx;
        const projY = y1 + clamped * dy;
        const a = pts[i].x - projX;
        const b = pts[i].y - projY;
        distSq = a * a + b * b;
      }
      if (distSq > maxSq) {
        maxSq = distSq;
        index = i;
      }
    }
    return { index, maxSq };
  }

  const stack: [number, number][] = [[0, pts.length - 1]];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    const { index, maxSq } = findFarthest(start, end);
    if (maxSq > sqEps) {
      keep[index] = 1;
      stack.push([start, index]);
      stack.push([index, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) result.push(pts[i]);
  }
  return result.length >= 2 ? result : pts.slice(0, 2);
}

function findAllContours(filled: Uint8Array, w: number, h: number): { points: Point[]; type: 'outer' | 'inner' }[] {
  const contours: { points: Point[]; type: 'outer' | 'inner' }[] = [];

  // 1) Contornos exteriores
  const visited = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (filled[idx] && !visited[idx]) {
        const region = new Uint8Array(w * h);
        const queue: [number, number][] = [[x, y]];
        visited[idx] = 1;
        region[idx] = 1;
        let qi = 0;
        while (qi < queue.length) {
          const [cx, cy] = queue[qi++];
          const nbs = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (const [nx, ny] of nbs) {
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const nidx = ny * w + nx;
              if (filled[nidx] && !visited[nidx]) {
                visited[nidx] = 1;
                region[nidx] = 1;
                queue.push([nx, ny]);
              }
            }
          }
        }
        const contour = traceContourBoundary(region, w, h);
        if (contour.length > 2) contours.push({ points: contour, type: 'outer' });
      }
    }
  }

  // 2) Contornos interiores (huecos)
  const tVisited = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!filled[idx] && !tVisited[idx]) {
        const queue: [number, number][] = [[x, y]];
        tVisited[idx] = 1;
        const pixels: [number, number][] = [[x, y]];
        let touchesBorder = false;
        let qi = 0;
        while (qi < queue.length) {
          const [cx, cy] = queue[qi++];
          if (cx === 0 || cx === w - 1 || cy === 0 || cy === h - 1) touchesBorder = true;
          const nbs = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (const [nx, ny] of nbs) {
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const nidx = ny * w + nx;
              if (!filled[nidx] && !tVisited[nidx]) {
                tVisited[nidx] = 1;
                queue.push([nx, ny]);
                pixels.push([nx, ny]);
              }
            }
          }
        }
        if (!touchesBorder) {
          const region = new Uint8Array(w * h);
          for (const [px, py] of pixels) region[py * w + px] = 1;
          const contour = traceContourBoundary(region, w, h);
          if (contour.length > 2) contours.push({ points: contour, type: 'inner' });
        }
      }
    }
  }

  return contours;
}

// ---------------------------------------------------------------------------
// Conversión SVG → Strokes
// ---------------------------------------------------------------------------

function svgToImage(svgElement: SVGElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Error cargando SVG como imagen'));
    };
    img.src = url;
  });
}

/**
 * Convierte un elemento SVG (icono) en un array de Stroke editables.
 * @param svgElement El elemento SVG del DOM.
 * @param size Tamaño del canvas para rasterizar (por defecto 128).
 * @returns Array de strokes listos para insertar en el editor.
 */
export interface SvgToStrokesOptions {
  size?: number;
  /** 0 = mínimo detalle (pocos vértices), 100 = máximo detalle (muchos vértices) */
  detailLevel?: number;
}

/**
 * Convierte un elemento SVG (icono) en un array de Stroke editables.
 * @param svgElement El elemento SVG del DOM.
 * @param options Opciones de conversión.
 * @returns Array de strokes listos para insertar en el editor.
 */
export async function svgElementToStrokes(
  svgElement: SVGElement,
  options: SvgToStrokesOptions = {}
): Promise<Stroke[]> {
  const { detailLevel = 100 } = options;

  // detailLevel controla DOS cosas para evitar deformaciones:
  // 1) Tamaño del canvas de rasterización (menos px = naturalmente menos vértices)
  // 2) Epsilon de Douglas-Peucker (menos agresivo que antes)
  const clampedDetail = Math.max(0, Math.min(100, detailLevel));

  // Canvas: 128px (bajo) → 2048px (alto)
  const size = Math.round(128 + (clampedDetail / 100) * 1920);

  // Epsilon proporcional al tamaño de píxel para no deformar la forma
  // 0% → 2.5 (conservador con canvas pequeño), 100% → 0.3 (detalle total)
  const epsilon = Math.max(0.3, 2.5 - (clampedDetail / 100) * 2.2);

  // 1. Clonar el SVG y escalarlo al tamaño del canvas
  const clone = svgElement.cloneNode(true) as SVGElement;
  clone.setAttribute('width', String(size));
  clone.setAttribute('height', String(size));

  // Preservar el viewBox original; si no existe, usar uno cuadrado estándar
  const originalViewBox = clone.getAttribute('viewBox');
  if (!originalViewBox) {
    clone.setAttribute('viewBox', '0 0 24 24');
  }

  clone.style.color = '#ffffff';

  // 2. Dibujar en canvas
  const img = await svgToImage(clone);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  ctx.drawImage(img, 0, 0, size, size);

  // 3. Extraer píxeles opacos
  const imageData = ctx.getImageData(0, 0, size, size);
  const w = size;
  const h = size;
  const filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = imageData.data[i * 4 + 3];
    if (a > 30) {
      filled[i] = 1;
    }
  }

  // 4. Extraer contornos
  const contourInfos = findAllContours(filled, w, h);
  const outerContours = contourInfos.filter((c) => c.type === 'outer');
  const innerContours = contourInfos.filter((c) => c.type === 'inner');

  // 5. Convertir contornos a strokes
  const strokes: Stroke[] = [];
  for (const outer of outerContours) {
    if (outer.points.length <= 2) continue;
    // No reducimos por step — el tamaño del canvas ya controla la densidad.
    // Solo aplicamos Douglas-Peucker para eliminar vértices redundantes.
    const simplifiedOuter = douglasPeucker(outer.points, epsilon);

    const holes: Point[][] = [];
    for (const inner of innerContours) {
      if (inner.points.length <= 2) continue;
      const centroid = getCentroid(inner.points);
      if (pointInPolygon(centroid, outer.points)) {
        holes.push(douglasPeucker(inner.points, epsilon));
      }
    }

    strokes.push({
      id: crypto.randomUUID(),
      points: simplifiedOuter,
      strokeColor: '#ffffff',
      strokeWidth: 1,
      fillColor: 'transparent',
      type: 'line',
      holes: holes.length > 0 ? holes : undefined,
    });
  }

  return strokes;
}

/**
 * Centra un grupo de strokes en una posición dada.
 * @param strokes Array de strokes a centrar.
 * @param centerX Coordenada X del centro deseado.
 * @param centerY Coordenada Y del centro deseado.
 */
// BBox de un conjunto de strokes INCLUYENDO los bounds de texto (un stroke de
// texto sólo guarda el ancla en `points`, no el contorno). Devuelve null si no
// hay contenido válido.
function computeStrokesBounds(strokes: Stroke[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    // Ignorar vértices sueltos (1 punto sin shapeType): no son parte del dibujo
    // y, si están lejos, inflan el bbox y descuadran el centrado.
    if (s.points.length < 2 && s.shapeType !== 'text') continue;
    for (const p of s.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (s.holes) {
      for (const h of s.holes) {
        for (const p of h) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
      }
    }
    if (s.shapeType === 'text' && s.points[0] && s.text) {
      const tb = getTextBounds(s);
      minX = Math.min(minX, tb.minX);
      minY = Math.min(minY, tb.minY);
      maxX = Math.max(maxX, tb.maxX);
      maxY = Math.max(maxY, tb.maxY);
    }
  }
  if (!isFinite(minX) || !isFinite(maxX)) return null;
  return { minX, minY, maxX, maxY };
}

export function centerStrokes(strokes: Stroke[], centerX: number, centerY: number): Stroke[] {
  if (strokes.length === 0) return strokes;

  const b = computeStrokesBounds(strokes);
  if (!b) return strokes;

  const strokeCenterX = (b.minX + b.maxX) / 2;
  const strokeCenterY = (b.minY + b.maxY) / 2;
  const dx = centerX - strokeCenterX;
  const dy = centerY - strokeCenterY;

  return strokes.map((s) => ({
    ...s,
    points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    holes: s.holes ? s.holes.map((h) => h.map((p) => ({ x: p.x + dx, y: p.y + dy }))) : undefined,
  }));
}

/**
 * Escala un grupo de strokes por un factor uniforme.
 * @param strokes Array de strokes a escalar.
 * @param factor Factor de escala (1.0 = sin cambio).
 */
export function scaleStrokes(strokes: Stroke[], factor: number): Stroke[] {
  if (factor === 1) return strokes;
  return strokes.map((s) => ({
    ...s,
    points: s.points.map((p) => ({ x: p.x * factor, y: p.y * factor })),
    holes: s.holes ? s.holes.map((h) => h.map((p) => ({ x: p.x * factor, y: p.y * factor }))) : undefined,
    // Escalar también el tamaño de fuente de los textos para que escalen
    // uniformemente con el resto del icono (si no, el ancla se mueve pero el
    // texto mantiene su tamaño y se descuadra).
    fontSize: s.shapeType === 'text' && s.fontSize ? s.fontSize * factor : s.fontSize,
  }));
}

/**
 * Normaliza, escala y centra strokes de forma segura:
 * 1. Calcula el bounding box real.
 * 2. Lo desplaza para que empiece en (0,0).
 * 3. Escala uniformemente al ancho objetivo.
 * 4. Centra el resultado en (centerX, centerY).
 * @param strokes Array de strokes.
 * @param targetWidth Ancho deseado en unidades del editor.
 * @param centerX Coordenada X del centro deseado.
 * @param centerY Coordenada Y del centro deseado.
 */
export function normalizeScaleAndCenterStrokes(
  strokes: Stroke[],
  targetWidth: number,
  centerX: number,
  centerY: number
): Stroke[] {
  if (strokes.length === 0) return strokes;

  // 1. Bounding box (incluye texto)
  const b = computeStrokesBounds(strokes);
  if (!b) return strokes;
  const { minX, minY, maxX, maxY } = b;

  const currentWidth = maxX - minX;
  const currentHeight = maxY - minY;
  if (currentWidth === 0 && currentHeight === 0) return strokes;

  // 2. Normalizar a (0,0)
  const normalized = strokes.map((s) => ({
    ...s,
    points: s.points.map((p) => ({ x: p.x - minX, y: p.y - minY })),
    holes: s.holes ? s.holes.map((h) => h.map((p) => ({ x: p.x - minX, y: p.y - minY }))) : undefined,
  }));

  // 3. Escalar uniformemente
  const factor = currentWidth > 0 ? targetWidth / currentWidth : 1;
  const scaled = scaleStrokes(normalized, factor);

  // 4. Centrar
  const scaledWidth = currentWidth * factor;
  const scaledHeight = currentHeight * factor;
  const dx = centerX - scaledWidth / 2;
  const dy = centerY - scaledHeight / 2;

  return scaled.map((s) => ({
    ...s,
    points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    holes: s.holes ? s.holes.map((h) => h.map((p) => ({ x: p.x + dx, y: p.y + dy }))) : undefined,
  }));
}
