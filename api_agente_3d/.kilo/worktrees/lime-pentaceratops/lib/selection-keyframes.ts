import { SelectionShape, SelectionKeyframe, VideoSelectionState, BezierAnchor, MotionPathFrame, MotionMaskFrame } from '@/types';

export interface SelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const boxOf = (k: SelectionKeyframe): SelectionBox => ({ x: k.x, y: k.y, width: k.width, height: k.height });

/** Bounding box (en %) de todos los paths Bézier (freehand). Si no hay anclas, caja nula. */
export function pathsBBox(paths: BezierAnchor[][] | undefined | null): SelectionBox {
  if (!paths || paths.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consider = (v: number, axis: 'x' | 'y') => {
    if (!isFinite(v)) return;
    if (axis === 'x') { if (v < minX) minX = v; if (v > maxX) maxX = v; }
    else { if (v < minY) minY = v; if (v > maxY) maxY = v; }
  };
  for (const anchors of paths) {
    for (const a of anchors) {
      consider(a.x, 'x'); consider(a.y, 'y');
      consider(a.hInX, 'x'); consider(a.hInY, 'y');
      consider(a.hOutX, 'x'); consider(a.hOutY, 'y');
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

/**
 * Transforma los paths Bézier de la caja `base` a la caja `target` (translate +
 * scale independiente X/Y). Mapea cada ancla y sus mangos. Si base.width/height
 * es 0 se evita la división (sólo se traslada).
 */
export function transformPaths(
  paths: BezierAnchor[][] | undefined | null,
  base: SelectionBox,
  target: SelectionBox,
): BezierAnchor[][] {
  if (!paths || paths.length === 0) return [];
  const sx = base.width > 0 ? target.width / base.width : 1;
  const sy = base.height > 0 ? target.height / base.height : 1;
  const mapX = (p: number) => (p - base.x) * sx + target.x;
  const mapY = (p: number) => (p - base.y) * sy + target.y;
  return paths.map((anchors) =>
    anchors.map((a) => ({
      x: mapX(a.x),
      y: mapY(a.y),
      hInX: mapX(a.hInX),
      hInY: mapY(a.hInY),
      hOutX: mapX(a.hOutX),
      hOutY: mapY(a.hOutY),
    })),
  );
}

/**
 * Caja (x,y,width,height en %) de la selección en el instante absoluto `t` del timeline.
 *
 * - Sin keyframes (o tracking desactivado / freehand): usa la caja estática de la shape.
 * - Con keyframes: interpola linealmente entre los dos circundantes. Antes del primero
 *   usa el primero; después del último usa el último.
 *
 * El tiempo de cada keyframe es ABSOLUTO del timeline (la selección/máscara es global,
 * no viaja con un clip), a diferencia de ObjectKeyframe que es local al clip.
 */
export function getSelectionBoxAtTime(shape: SelectionShape, t: number): SelectionBox {
  const kfs = shape.keyframes;
  if (!kfs || kfs.length === 0) {
    return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  }
  const sorted = [...kfs].sort((a, b) => a.time - b.time);
  if (t <= sorted[0].time) return boxOf(sorted[0]);
  if (t >= sorted[sorted.length - 1].time) return boxOf(sorted[sorted.length - 1]);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time;
      const u = span <= 0 ? 0 : (t - a.time) / span;
      return {
        x: lerp(a.x, b.x, u),
        y: lerp(a.y, b.y, u),
        width: lerp(a.width, b.width, u),
        height: lerp(a.height, b.height, u),
      };
    }
  }
  return boxOf(sorted[sorted.length - 1]);
}

/**
 * Devuelve la shape "efectiva" a tiempo `t`: si tracking está activo y hay keyframes,
 * sustituye la caja por la interpolada. Para freehand, además transforma los paths
 * Bézier de su caja base (bbox de los paths dibujados) a la caja interpolada, así
 * el lazo sigue al objeto (translate + scale). Sin tracking o sin keyframes,
 * devuelve la shape tal cual.
 */
export function effectiveSelectionShape(selection: VideoSelectionState, t: number): SelectionShape {
  const s = selection.shape;
  if (selection.track && s.keyframes && s.keyframes.length > 0) {
    const b = getSelectionBoxAtTime(s, t);
    if (s.type === 'freehand') {
      const base = pathsBBox(s.paths);
      return { ...s, paths: transformPaths(s.paths, base, b), ...b };
    }
    return { ...s, ...b };
  }
  return s;
}

/**
 * Como `effectiveSelectionShape`, pero además tiene en cuenta el BORRADOR de seguimiento
 * `selection.draftBox` (arrastre sin fijar): si lo hay y tracking activo, usa esa caja
 * (y para freehand transforma los paths a ella). Es la posición que el usuario VE ahora
 * en el preview; la usan la brocha/bote y el commit de pintura para recortar/anclar a la
 * ubicación actual, no a una posición anterior del keyframe. El export NO usa el borrador
 * (no está confirmado como keyframe) — sólo el preview/edición.
 */
export function effectiveSelectionShapeForPaint(selection: VideoSelectionState, t: number): SelectionShape {
  const draft = selection.draftBox ?? null;
  if (draft && selection.track) {
    const s = selection.shape;
    if (s.type === 'freehand') {
      const base = pathsBBox(s.paths);
      return { ...s, paths: transformPaths(s.paths, base, draft), ...draft };
    }
    return { ...s, ...draft };
  }
  return effectiveSelectionShape(selection, t);
}

/** Inserta/reemplaza un keyframe en `t` con la caja dada; devuelve la lista ordenada. */
export function upsertSelectionKeyframe(shape: SelectionShape, t: number, box: SelectionBox): SelectionKeyframe[] {
  const kfs = (shape.keyframes ?? []).filter((k) => Math.abs(k.time - t) > 0.001);
  kfs.push({ time: t, x: box.x, y: box.y, width: box.width, height: box.height });
  kfs.sort((a, b) => a.time - b.time);
  return kfs;
}

/**
 * Inserta/reemplaza un frame de silueta (motionPaths) en `t` con los paths del lazo
 * tal como están EN ESE FOTOGAMA (copia profunda). Es el mecanismo del "morph":
 * cada pulsación de "Fijar keyframe aquí" guarda la forma exacta dibujada, y
 * `effectiveSelectionMotionPaths` interpola (morph) entre los frames circundantes.
 */
export function upsertSelectionMotionPath(shape: SelectionShape, t: number, paths: BezierAnchor[][]): MotionPathFrame[] {
  const frames = (shape.motionPaths ?? []).filter((f) => Math.abs(f.time - t) > 0.001);
  frames.push({
    time: t,
    paths: paths.map((p) => p.map((a) => ({ ...a }))),
  });
  frames.sort((a, b) => a.time - b.time);
  return frames;
}

/** Elimina el keyframe más cercano a `t` (within 0.001s); devuelve la lista restante. */
export function removeSelectionKeyframeAt(shape: SelectionShape, t: number): SelectionKeyframe[] {
  return (shape.keyframes ?? []).filter((k) => Math.abs(k.time - t) > 0.001);
}

// ── Silueta cambiante por frame (motionPaths / motionMasks) ─────────────────────
// Estos campos tienen PRIORIDAD sobre el tracking de caja (transformPaths): cuando
// existen, el recorte usa la silueta deformada/raster de cada frame en vez del
// path estático transformado por la caja interpolada. Pensados para recortes
// precisos como capa donde la forma del objeto cambia (rotación/deformación).

/** Lerp entre dos anchors Bézier (posición + mangos). */
function lerpAnchor(a: BezierAnchor, b: BezierAnchor, t: number): BezierAnchor {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    hInX: lerp(a.hInX, b.hInX, t),
    hInY: lerp(a.hInY, b.hInY, t),
    hOutX: lerp(a.hOutX, b.hOutX, t),
    hOutY: lerp(a.hOutY, b.hOutY, t),
  };
}

/**
 * Muestrea un path Bézier (lista cerrada de anclas con mangos) como polilínea de
 * puntos. Cada segmento va de ancla i a i+1 con controles hOut[i] y hIn[i+1].
 */
function samplePathPoints(anchors: BezierAnchor[], samples: number): { x: number; y: number }[] {
  if (anchors.length === 0) return [];
  if (anchors.length === 1) return [{ x: anchors[0].x, y: anchors[0].y }];
  const pts: { x: number; y: number }[] = [];
  const m = anchors.length;
  const per = Math.max(2, Math.ceil(samples / m));
  for (let i = 0; i < m; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % m];
    const c1x = a.hOutX ?? a.x; const c1y = a.hOutY ?? a.y;
    const c2x = b.hInX ?? b.x; const c2y = b.hInY ?? b.y;
    for (let s = 0; s < per; s++) {
      const u = s / per;
      const v = 1 - u;
      pts.push({
        x: v * v * v * a.x + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u * u * u * b.x,
        y: v * v * v * a.y + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u * u * u * b.y,
      });
    }
  }
  return pts;
}

/**
 * MORPH entre dos conjuntos de paths: resamplea ambos a la misma densidad de
 * puntos (polilínea cerrada) y hace lerp punto a punto. Resultado: un único
 * subpath en polilínea (mangos = el propio punto) que se transforma poco a poco
 * de la forma A a la forma B. A diferencia de lerpAnchor (que exige la misma
 * estructura de anclas), funciona con lazos dibujados distinto en cada keyframe.
 */
function morphPaths(a: BezierAnchor[][], b: BezierAnchor[][], t: number): BezierAnchor[][] {
  const N = 72;
  const pa = samplePathPoints(a.flat(), N);
  const pb = samplePathPoints(b.flat(), N);
  const m = Math.max(pa.length, pb.length);
  const anchors: BezierAnchor[] = [];
  for (let i = 0; i < m; i++) {
    const pai = pa[i % pa.length];
    const pbi = pb[i % pb.length];
    const x = lerp(pai.x, pbi.x, t);
    const y = lerp(pai.y, pbi.y, t);
    anchors.push({ x, y, hInX: x, hInY: y, hOutX: x, hOutY: y });
  }
  return [anchors];
}

/**
 * Frame de una lista ordenada por `time` más cercano al instante `t`. Para
 * motionPaths se interpolation lineal entre los dos circundantes (paths); para
 * motionMasks (raster) se devuelve el más cercano (no se interpola raster).
 * Fuera de rango → el extremo. Null si la lista está vacía.
 */
export function nearestMotionFrame<T extends { time: number }>(frames: T[] | undefined | null, t: number): T | null {
  if (!frames || frames.length === 0) return null;
  const sorted = frames;
  if (t <= sorted[0].time) return sorted[0];
  if (t >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.time && t <= b.time) return Math.abs(t - a.time) <= Math.abs(t - b.time) ? a : b;
  }
  return sorted[sorted.length - 1];
}

/**
 * Paths del lazo DEFORMADOS en el instante `t` (silueta cambiante, lazo por puntos).
 * Interpola linealmente entre los dos motionFrames circundantes. Null si no hay
 * motionPaths (caller cae al modelo de caja).
 */
export function effectiveSelectionMotionPaths(selection: VideoSelectionState, t: number): BezierAnchor[][] | null {
  const s = selection.shape;
  const frames = s.motionPaths;
  if (!frames || frames.length === 0) return null;
  if (frames.length === 1) return frames[0].paths;
  if (t <= frames[0].time) return frames[0].paths;
  if (t >= frames[frames.length - 1].time) return frames[frames.length - 1].paths;
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time;
      const u = span <= 0 ? 0 : (t - a.time) / span;
      return morphPaths(a.paths, b.paths, u);
    }
  }
  return frames[frames.length - 1].paths;
}

/**
 * URL de la máscara raster (SAM2) válida en el instante `t` (la más cercana; el
 * raster no se interpola). Null si no hay motionMasks.
 */
export function effectiveSelectionMaskUrl(selection: VideoSelectionState, t: number): string | null {
  const frames = selection.shape.motionMasks;
  const f = nearestMotionFrame(frames, t);
  return f ? f.url : null;
}

/** ¿La selección tiene silueta cambiante (motionPaths o motionMasks)? */
export function hasMotionSilhouette(selection: VideoSelectionState | null | undefined): boolean {
  if (!selection?.shape) return false;
  const s = selection.shape;
  return (!!s.motionPaths && s.motionPaths.length > 0) || (!!s.motionMasks && s.motionMasks.length > 0);
}