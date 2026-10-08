/**
 * Perfiles de revolución (pestaña Torno) del editor 3D.
 *
 * Un «perfil» es el contorno de UNA de las dos mitades del objeto (la que
 * se gira alrededor del eje). El motor (`buildLatheMesh` en lib/geometry)
 * interpreta cada punto así:
 *   - x = radio (distancia al eje de giro; el eje está en x = 0, x ≥ 0).
 *   - y = altura en «espacio pantalla»; el motor la invierte con
 *         worldY = 1 - y  (y crece hacia abajo, como en el lienzo).
 *
 * Para que un perfil generado por la IA resulte intuitivo se aceptan puntos
 * NORMALIZADOS (radio 0..1, altura 0..1 con 0 = base y 1 = parte superior) y
 * esta utilidad los convierte al espacio del editor centrando el objeto en el
 * origen (altura total = `worldHeight`, por defecto 2, como las primitivas).
 */

import type { Polygon, Point2D } from './geometry';
import { latheProfileLoop } from './geometry';

export type LathePresetName =
  | 'botella'
  | 'jarron'
  | 'taza'
  | 'cuenco'
  | 'copa'
  | 'cono'
  | 'cilindro'
  | 'esfera';

/** Punto de entrada aceptado desde la IA / el modelo de visión. */
export type LathePointInput =
  | readonly [number, number]
  | { x: number; y: number }
  | { radius: number; height: number };

export type LatheProfileOptions = {
  /** Altura total del objeto en unidades de mundo (por defecto 2). */
  worldHeight?: number;
  /** Escala del radio máximo del perfil normalizado (por defecto 1). */
  radiusScale?: number;
};

/** Punto normalizado [radio 0..1, altura 0..1] (altura: 0 = base, 1 = arriba). */
type NormalizedPoint = readonly [number, number];

/**
 * Perfiles de fábrica. Cada punto es [radio, altura] normalizados.
 * Sirven de plantilla cuando la IA crea un objeto «de memoria» (sin
 * coordenadas exactas de una imagen de referencia).
 */
const PRESETS: Record<LathePresetName, NormalizedPoint[]> = {
  // Botella de cuello largo.
  botella: [
    [0.0, 0.0],
    [0.26, 0.02],
    [0.28, 0.09],
    [0.28, 0.52],
    [0.24, 0.6],
    [0.12, 0.71],
    [0.09, 0.79],
    [0.09, 0.96],
    [0.12, 0.98],
    [0.12, 1.0],
    [0.0, 1.0],
  ],
  // Jarrón de panza ancha y boca estrecha.
  jarron: [
    [0.0, 0.0],
    [0.2, 0.03],
    [0.25, 0.28],
    [0.19, 0.55],
    [0.13, 0.72],
    [0.16, 0.83],
    [0.22, 0.94],
    [0.22, 1.0],
    [0.0, 1.0],
  ],
  // Taza / vaso cilíndrico.
  taza: [
    [0.0, 0.0],
    [0.2, 0.02],
    [0.22, 0.08],
    [0.22, 1.0],
    [0.0, 1.0],
  ],
  // Cuenco de fondo curvo.
  cuenco: [
    [0.0, 0.0],
    [0.18, 0.05],
    [0.32, 0.3],
    [0.36, 0.58],
    [0.36, 0.7],
    [0.0, 0.7],
  ],
  // Copa con pie y cáliz.
  copa: [
    [0.0, 0.0],
    [0.14, 0.02],
    [0.14, 0.08],
    [0.05, 0.14],
    [0.045, 0.45],
    [0.07, 0.53],
    [0.2, 0.61],
    [0.22, 0.74],
    [0.2, 0.95],
    [0.21, 1.0],
    [0.0, 1.0],
  ],
  // Cono simple.
  cono: [
    [0.0, 0.0],
    [0.28, 0.0],
    [0.02, 1.0],
    [0.0, 1.0],
  ],
  // Cilindro recto.
  cilindro: [
    [0.0, 0.0],
    [0.22, 0.0],
    [0.22, 1.0],
    [0.0, 1.0],
  ],
  // Esfera (media circunferencia).
  esfera: (() => {
    const out: NormalizedPoint[] = [];
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI;
      const r = i === 0 || i === steps ? 0 : Math.sin(t) * 0.28;
      const h = (1 - Math.cos(t)) / 2;
      out.push([r, h]);
    }
    return out;
  })(),
};

export const LATHE_PRESET_NAMES = Object.keys(PRESETS) as LathePresetName[];

export function isLathePresetName(value: unknown): value is LathePresetName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, value);
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Convierte un punto normalizado [radio, altura] al espacio del editor. */
function normalizedToEditorPoint(
  point: NormalizedPoint,
  opts: LatheProfileOptions,
): Point2D {
  const worldHeight = opts.worldHeight ?? 2;
  const radiusScale = opts.radiusScale ?? 1;
  const radius = Math.max(0, Number(point[0]) || 0) * radiusScale;
  const height = Math.min(1, Math.max(0, Number(point[1]) || 0));
  // y en «espacio pantalla»: 0 = arriba del lienzo, crece hacia abajo.
  // El motor hace worldY = 1 - y, así que con worldHeight=2 el objeto queda
  // centrado en el origen (worldY de -1 a +1).
  const y = (1 - height) * worldHeight;
  return { x: round6(radius), y: round6(y) };
}

/** Construye un polígono de perfil a partir de puntos normalizados. */
export function buildLatheProfileFromNormalized(
  points: readonly NormalizedPoint[],
  opts: LatheProfileOptions = {},
): Polygon {
  return points.map((p) => normalizedToEditorPoint(p, opts));
}

/** Perfil de fábrica a partir de su nombre (p. ej. «botella»). */
export function buildLathePreset(
  name: LathePresetName,
  opts: LatheProfileOptions = {},
): Polygon {
  const pts = PRESETS[name] ?? PRESETS.botella;
  return buildLatheProfileFromNormalized(pts, opts);
}

/** Normaliza un punto de entrada a [radio, altura] (altura arriba: 0 base, 1 arriba). */
function coerceNormalizedPoint(input: LathePointInput): [number, number] {
  if (Array.isArray(input)) {
    return [Number(input[0]) || 0, Number(input[1]) || 0];
  }
  if (input && typeof input === 'object') {
    const obj = input as { x?: number; y?: number; radius?: number; height?: number };
    if (typeof obj.radius === 'number' || typeof obj.height === 'number') {
      return [Number(obj.radius) || 0, Number(obj.height) || 0];
    }
    return [Number(obj.x) || 0, Number(obj.y) || 0];
  }
  return [0, 0];
}

/** Convierte un punto de entrada en editor ({x: radio, y: pantalla}) ya en el espacio del lienzo. */
function coerceEditorPoint(input: LathePointInput): Point2D {
  if (Array.isArray(input)) {
    return { x: round6(Number(input[0]) || 0), y: round6(Number(input[1]) || 0) };
  }
  if (input && typeof input === 'object') {
    const obj = input as { x?: number; y?: number; radius?: number; height?: number };
    if (typeof obj.radius === 'number' || typeof obj.height === 'number') {
      return { x: round6(Number(obj.radius) || 0), y: round6(Number(obj.height) || 0) };
    }
    return { x: round6(Number(obj.x) || 0), y: round6(Number(obj.y) || 0) };
  }
  return { x: 0, y: 0 };
}

export type LatheProfileRequest = {
  /** Nombre de perfil de fábrica (botella, jarron, taza, cuenco, copa, cono, cilindro, esfera). */
  preset?: unknown;
  /** Lista de puntos. Acepta [[r,h],…], [{x,y},…] o [{radius,height},…]. */
  profile?: unknown;
  /** Alias de `profile`. */
  points?: unknown;
  /** 'normalized' (por defecto) o 'editor' (puntos ya en el espacio del lienzo). */
  profileSpace?: unknown;
  worldHeight?: number;
  radiusScale?: number;
};

function asPointArray(value: unknown): LathePointInput[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter(
    (p) => Array.isArray(p) || (p && typeof p === 'object'),
  ) as LathePointInput[];
  return out.length > 0 ? out : null;
}

/**
 * Resuelve la petición de perfil que envía la IA: bien un `preset` de fábrica,
 * bien una lista de `points`/`profile` normalizados (o en espacio del editor).
 * Lanza si no hay datos suficientes para dibujar el perfil.
 */
export function resolveLatheProfile(request: LatheProfileRequest): Polygon {
  const raw = request.profile ?? request.points;
  const list = asPointArray(raw);

  if (list) {
    if (request.profileSpace === 'editor') {
      const poly = list.map(coerceEditorPoint);
      if (poly.length < 3) throw new Error('El perfil necesita al menos 3 puntos.');
      return poly;
    }
    const normalized = list.map(coerceNormalizedPoint);
    if (normalized.length < 3) throw new Error('El perfil necesita al menos 3 puntos.');
    const poly = buildLatheProfileFromNormalized(normalized, {
      worldHeight: request.worldHeight,
      radiusScale: request.radiusScale,
    });
    return poly;
  }

  if (isLathePresetName(request.preset)) {
    return buildLathePreset(request.preset, {
      worldHeight: request.worldHeight,
      radiusScale: request.radiusScale,
    });
  }

  throw new Error(
    'Indica un "preset" (botella, jarron, taza, cuenco, copa, cono, cilindro, esfera) ' +
      'o una lista "points" de coordenadas [radio, altura] normalizadas 0..1.',
  );
}

/** Subdivide un tramo recto (o curvo con asas Bézier) en `steps` pasos. */
function bezierSteps(
  from: Point2D,
  c1: Point2D,
  c2: Point2D,
  to: Point2D,
  steps: number,
): Point2D[] {
  const out: Point2D[] = [];
  for (let step = 1; step < steps; step++) {
    const t = step / steps;
    const inverse = 1 - t;
    out.push({
      x:
        inverse * inverse * inverse * from.x +
        3 * inverse * inverse * t * c1.x +
        3 * inverse * t * t * c2.x +
        t * t * t * to.x,
      y:
        inverse * inverse * inverse * from.y +
        3 * inverse * inverse * t * c1.y +
        3 * inverse * t * t * c2.y +
        t * t * t * to.y,
    });
  }
  return out;
}

/** Punto sobre la polilínea densa a la distancia s (longitud de arco acumulada en cum). */
function pointAtArc(poly: Point2D[], cum: number[], s: number, total: number): Point2D {
  const clamped = Math.max(0, Math.min(total, s));
  let lo = 0;
  let hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= clamped) lo = mid;
    else hi = mid;
  }
  const a = poly[lo];
  const b = poly[lo + 1] ?? poly[lo];
  const segSpan = cum[lo + 1] - cum[lo];
  const t = segSpan > 1e-12 ? (clamped - cum[lo]) / segSpan : 0;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/**
 * Remuestrea el PERFIL DEL TORNO a `n` vértices uniformes por longitud de
 * arco (control «Vértices del perfil» del torno: las figuras de un clic
 * traen un número de puntos fijo y este ajusta la densidad, por ejemplo el
 * círculo de un toroide). Sigue las CURVAS del perfil (asas Bézier), así
 * los vértices nuevos caen sobre la silueta y la figura no cambia de
 * forma; el primer vértice se conserva como ancla y en perfiles abiertos
 * los dos extremos tal cual. Al cambiar el número, las asas de curva se
 * cuecen en los vértices (el contorno resultante es la misma silueta en
 * polilínea). Si el número ya es el de la figura, la devuelve tal cual.
 */
export function resampleLatheProfile(poly: Polygon, n: number): Polygon {
  const target = Math.max(3, Math.round(Number.isFinite(n) ? n : poly.length));
  const clone = poly.map((p) => ({
    x: p.x,
    y: p.y,
    ...(p.hIn ? { hIn: p.hIn } : {}),
    ...(p.hOut ? { hOut: p.hOut } : {}),
  }));
  if (poly.length < 2 || target === clone.length) return clone;
  const { points, closed } = latheProfileLoop(poly);

  // Contorno aplanado siguiendo sus curvas (16 pasos por tramo como hace
  // buildLatheMesh): la longitud de arco se mide sobre la curva real.
  const curveSteps = 16;
  const dense: Point2D[] = [];
  const cum: number[] = [];
  const push = (p: Point2D) => {
    const prev = dense[dense.length - 1];
    const start = dense.length === 0 ? 0 : cum[cum.length - 1] + Math.hypot(p.x - prev.x, p.y - prev.y);
    dense.push({ x: p.x, y: p.y });
    cum.push(start);
  };
  push(points[0]);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const c1 = a.hOut ?? a;
    const c2 = b.hIn ?? b;
    for (const mid of bezierSteps(a, c1, c2, b, curveSteps)) push(mid);
    push(b);
  }
  // En el anillo cerrado, el tramo de cierre (último → primero) se aplana
  // igual que los demás y añade su punto final: el contorno denso queda con
  // el anillo completo y la longitud de arco lo cuenta entero.
  let total = cum[cum.length - 1];
  if (closed) {
    const first = points[0];
    const last = points[points.length - 1];
    const c1 = last.hOut ?? last;
    const c2 = first.hIn ?? first;
    for (const mid of bezierSteps(last, c1, c2, first, curveSteps)) push(mid);
    push(first);
    total = cum[cum.length - 1];
  }

  // Muestrear `target` posiciones en el bucle (o la polilínea abierta con
  // extremos fijos) y quitar puntos repetidos por imán/pasillos cortos.
  const raw: Point2D[] = [];
  if (closed) {
    for (let k = 0; k < target; k++) {
      raw.push(pointAtArc(dense, cum, (k / target) * total, total));
    }
  } else {
    for (let k = 0; k < target - 1; k++) {
      raw.push(pointAtArc(dense, cum, (k / (target - 1)) * total, total));
    }
    const lastDense = dense[dense.length - 1];
    raw.push({ x: lastDense.x, y: lastDense.y });
  }
  const out: Point2D[] = [];
  for (const p of raw) {
    const prev = out[out.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-6) continue;
    out.push({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 });
  }
  // Figura enana (tramos demasiado cortos para `target` puntos): devuelve
  // los puntos útiles que haya; remuestrear más partiría el contorno.
  return out;
}
