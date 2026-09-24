import type { Point2D, Polygon } from '@/lib/geometry';

/**
 * Polilínea libre dibujada a mano en un lienzo 2D del editor 3D:
 * línea ABIERTA de segmentos rectos, independiente del contorno cerrado
 * de la plantilla. Existe solo en el lienzo 2D (no llega al visor 3D ni
 * afecta a la malla).
 */
export interface Polyline {
  id: string;
  points: Point2D[];
}

/** Herramientas de la barra del lienzo 2D. */
export type CanvasTool = 'edit' | 'line' | 'erase' | 'select';

/**
 * Clave estable de cada lienzo 2D ('views:front', 'views:side',
 * 'views:top', 'mesh:silhouette', 'mesh:side', 'mesh:section:<id>',
 * 'lathe:profile', …): las polilíneas se guardan por lienzo en
 * Editor3D con estas claves.
 */
export type CanvasKey = string;

/** Polilíneas de todos los lienzos, para guardar/cargar el proyecto. */
export type PolylinesByCanvas = Record<CanvasKey, Polyline[]>;

/**
 * Dirección de un vértice cualquiera del lienzo: line -1 es un vértice
 * del CONTORNO; si no, es el índice de la polilínea y vertex el índice
 * dentro de ella.
 */
export interface VertexRef {
  line: number;
  vertex: number;
}

/** Rectángulo de la marquesina en unidades del lienzo (esquinas libres). */
export interface MarqueeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Ruta SVG (M/L) de una polilínea, en unidades 0..1; el llamador escala ×100. */
export function polylineToPathD(points: Point2D[]): string {
  if (points.length === 0) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');
}

/** Distancia del punto p al segmento ab. */
export function pointToSegmentDist(
  p: Point2D,
  a: Point2D,
  b: Point2D
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // Proyección sobre el segmento, acotada a [0, 1]
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Polilínea más cercana al punto, si algún segmento cae a menos de
 * radius (en unidades del lienzo): para la goma de borrar.
 * Devuelve su id o null.
 */
export function nearestPolylineHit(
  lines: Polyline[],
  pt: Point2D,
  radius: number
): string | null {
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.points.length; i++) {
      const d = pointToSegmentDist(pt, line.points[i], line.points[i + 1]);
      if (d < bestDist) {
        bestDist = d;
        bestId = line.id;
      }
    }
  }
  return bestDist <= radius ? bestId : null;
}

/**
 * Vértices (del contorno y de las polilíneas) que caen dentro del
 * rectángulo de la marquesina: son los que quedan seleccionados.
 */
export function verticesInRect(
  polygon: Polygon,
  lines: Polyline[],
  rect: MarqueeRect
): VertexRef[] {
  const minX = Math.min(rect.x0, rect.x1);
  const maxX = Math.max(rect.x0, rect.x1);
  const minY = Math.min(rect.y0, rect.y1);
  const maxY = Math.max(rect.y0, rect.y1);
  const inside = (p: Point2D) =>
    p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
  const refs: VertexRef[] = [];
  polygon.forEach((p, i) => {
    if (inside(p)) refs.push({ line: -1, vertex: i });
  });
  lines.forEach((line, li) => {
    line.points.forEach((p, i) => {
      if (inside(p)) refs.push({ line: li, vertex: i });
    });
  });
  return refs;
}

/**
 * Sanea las polilíneas leídas de un archivo .zeus: descarta las que no
 * tienen sentido (menos de 2 puntos, puntos sin coordenadas) y clona
 * los datos para no compartir referencias con el objeto cargado.
 */
export function sanitizePolylines(raw: unknown): Polyline[] {
  if (!Array.isArray(raw)) return [];
  const out: Polyline[] = [];
  for (const line of raw) {
    if (!line || typeof line !== 'object') continue;
    const { id, points } = line as { id?: unknown; points?: unknown };
    if (typeof id !== 'string' && typeof id !== 'number') continue;
    if (!Array.isArray(points)) continue;
    const clean: Point2D[] = [];
    for (const p of points) {
      if (
        !p ||
        typeof p !== 'object' ||
        typeof (p as Point2D).x !== 'number' ||
        typeof (p as Point2D).y !== 'number' ||
        !Number.isFinite((p as Point2D).x) ||
        !Number.isFinite((p as Point2D).y)
      ) {
        continue;
      }
      clean.push({ x: (p as Point2D).x, y: (p as Point2D).y });
    }
    if (clean.length >= 2) out.push({ id: String(id), points: clean });
  }
  return out;
}

/** Sanea el mapa completo de polilíneas por lienzo leído de un .zeus. */
export function sanitizePolylinesByCanvas(raw: unknown): PolylinesByCanvas {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: PolylinesByCanvas = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const clean = sanitizePolylines(value);
    if (clean.length > 0) out[key] = clean;
  }
  return out;
}

/** Id nuevo para una polilínea (suficiente colisión-free para el editor). */
export function newPolylineId(): string {
  return `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}