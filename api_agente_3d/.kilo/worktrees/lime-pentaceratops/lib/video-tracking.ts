'use client';

import type { ObjectKeyframe, SelectionKeyframe } from '@/types';

/**
 * Utilidades para convertir los datos de tracking en instantes (keyframes)
 * de un objeto superpuesto del editor de vídeo.
 *
 * Históricamente esto incluía un cliente HTTP de la API Python `video_tracking_api`
 * (FastAPI en :8000), pero ese tracking se reemplazó por el tracker LOCAL de
 * `lib/pattern-track.ts` (ZSAD, sin IA, sin API) y por SAM2/detector; la carpeta
 * `video_tracking_api/` se eliminó. Aquí quedan sólo los helpers puros de
 * suavizado y conversión TrackingData → keyframes, reutilizados por el tracker
 * local y por la pestaña Objetos.
 */

export interface TrackingData {
  frames: number[];
  bboxes: number[][];   // [x, y, w, h] en px del frame del vídeo
  centers: number[][];  // [cx, cy] en px
  scales: number[];
  rotations: number[];
  fps: number;
  total_frames: number;
  initial_bbox: number[];
  video_path?: string;
  // Contorno poligonal del objeto por cada fotograma en porcentaje 0-100 del frame
  contours?: { x: number; y: number }[][];
  // Trazado inicial dibujado por el usuario con líneas rectas (puntos en % 0-100)
  initial_lazo_path?: { x: number; y: number }[];
}

/**
 * Suavizado ROBUSTO de los datos de tracking, en el cliente.
 */
export function smoothTrackingData(data: TrackingData, half: number = 4): TrackingData {
  if (!data || !data.centers || data.centers.length === 0) return data;
  const h = Math.max(1, Math.floor(half));
  const n = data.centers.length;

  const ma = (arr: number[]): number[] => {
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let sum = 0, cnt = 0;
      for (let j = Math.max(0, i - h); j <= Math.min(n - 1, i + h); j++) { sum += arr[j]; cnt++; }
      out[i] = sum / cnt;
    }
    return out;
  };
  const med = (arr: number[]): number[] => {
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const s = arr.slice(Math.max(0, i - h), Math.min(n, i + h + 1)).sort((a, b) => a - b);
      out[i] = s[Math.floor(s.length / 2)];
    }
    return out;
  };

  const cx = ma(data.centers.map((c) => c[0]));
  const cy = ma(data.centers.map((c) => c[1]));

  const bx = med(data.bboxes.map((b) => b[0]));
  const by = med(data.bboxes.map((b) => b[1]));
  const bw = med(data.bboxes.map((b) => b[2]));
  const bh = med(data.bboxes.map((b) => b[3]));

  // Recalcular escala a partir del bbox suavizado.
  const ib = data.initial_bbox || [0, 0, bw[0] || 1, bh[0] || 1];
  const initArea = (ib[2] || 1) * (ib[3] || 1);
  const scales = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const area = (bw[i] || 0) * (bh[i] || 0);
    scales[i] = initArea > 0 ? Math.sqrt(area / initArea) : 1;
  }

  // Suavizar rotaciones (si el tracker las provee). Usamos media centrada
  // para que el lazo gire suavemente siguiendo la orientación del objeto.
  const rotations = data.rotations ? ma(data.rotations) : new Array<number>(n).fill(0);

  const centers = new Array<number[]>(n);
  const bboxes = new Array<number[]>(n);
  for (let i = 0; i < n; i++) {
    const bbcx = bx[i] + bw[i] / 2;
    const bbcy = by[i] + bh[i] / 2;
    centers[i] = [(cx[i] + bbcx) / 2, (cy[i] + bbcy) / 2];
    bboxes[i] = [bx[i], by[i], bw[i], bh[i]];
  }

  return { ...data, centers, bboxes, scales, rotations, contours: data.contours, initial_lazo_path: data.initial_lazo_path };
}

/**
 * Transforma un lazo poligonal de líneas rectas inicial en el fotograma `k`
 * según el centro, la escala (X/Y no-uniforme) y la rotación devueltos por
 * el tracker en dicho fotograma. Esto garantiza que en CADA fotograma el
 * contorno mantenga sus LÍNEAS RECTAS exactas como las dibujó el usuario,
 * moviéndose, escalando (ancho/alto independientemente) y girando dinámicamente
 * con el objeto.
 */
export function transformLazoForFrame(
  initialPath: { x: number; y: number }[],
  initialCenterPx: [number, number],
  currentCenterPx: [number, number],
  scale: number,
  videoWidth: number,
  videoHeight: number,
  scaleX?: number,
  scaleY?: number,
  rotationDeg?: number,
): { x: number; y: number }[] {
  if (!initialPath || initialPath.length === 0 || !videoWidth || !videoHeight) return [];

  const cx0 = (initialCenterPx[0] / videoWidth) * 100;
  const cy0 = (initialCenterPx[1] / videoHeight) * 100;
  const cxK = (currentCenterPx[0] / videoWidth) * 100;
  const cyK = (currentCenterPx[1] / videoHeight) * 100;

  const s = isFinite(scale) && scale > 0 ? scale : 1;
  const sx = isFinite(scaleX ?? s) && (scaleX ?? s) > 0 ? (scaleX ?? s) : s;
  const sy = isFinite(scaleY ?? s) && (scaleY ?? s) > 0 ? (scaleY ?? s) : s;
  const rot = rotationDeg && isFinite(rotationDeg) ? rotationDeg : 0;
  const cosR = Math.cos((rot * Math.PI) / 180);
  const sinR = Math.sin((rot * Math.PI) / 180);

  return initialPath.map((pt) => {
    const dx = (pt.x - cx0) * sx;
    const dy = (pt.y - cy0) * sy;
    if (rot) {
      const rx = dx * cosR - dy * sinR;
      const ry = dx * sinR + dy * cosR;
      return { x: cxK + rx, y: cyK + ry };
    }
    return {
      x: cxK + dx,
      y: cyK + dy,
    };
  });
}

/**
 * Extrae los puntos del contorno exterior de una máscara binaria (ImageData)
 * usando muestreo por rayos angulares desde el centro de masa del objeto.
 * Devuelve un array de puntos [{ x, y }] en porcentaje 0-100 del vídeo.
 */
export function extractMaskContourFromImageData(
  d: Uint8ClampedArray,
  vw: number,
  vh: number,
  cx: number,
  cy: number,
  numRays: number = 48
): { x: number; y: number }[] {
  if (cx <= 0 || cy <= 0 || vw <= 0 || vh <= 0) return [];
  const points: { x: number; y: number }[] = [];
  const step = (Math.PI * 2) / numRays;

  for (let i = 0; i < numRays; i++) {
    const angle = i * step;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const maxR = Math.hypot(vw, vh);

    let lastHitX = cx;
    let lastHitY = cy;
    let found = false;

    for (let r = 1; r < maxR; r += 2) {
      const px = Math.round(cx + cosA * r);
      const py = Math.round(cy + sinA * r);
      if (px < 0 || px >= vw || py < 0 || py >= vh) break;

      const idx = (py * vw + px) * 4;
      const isWhite = (d[idx] + d[idx + 1] + d[idx + 2]) / 3 > 127;
      if (isWhite) {
        lastHitX = px;
        lastHitY = py;
        found = true;
      } else if (found && r > 10) {
        break;
      }
    }

    if (found) {
      points.push({
        x: (lastHitX / vw) * 100,
        y: (lastHitY / vh) * 100,
      });
    }
  }

  return points;
}

/**
 * Convierte un array de puntos en % 0-100 a un d de SVG <path>.
 */
export function contourToSvgPath(points: { x: number; y: number }[]): string {
  if (!points || points.length === 0) return '';
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }
  d += ' Z';
  return d;
}

/**
 * Convierte los datos de tracking (px del frame) en instantes (keyframes) de un
 * ObjectClip del editor, en porcentajes del área de vídeo (0-100).
 *
 * El objeto NO salta al centro absoluto del objeto trackeado: **conserva la
 * posición y el tamaño que el usuario le dio** y solo hereda el MOVIMIENTO
 * RELATIVO del objeto trackeado:
 *
 * - Posición: x = baseX + (center[k] - center[0]) en %; y análogo. El objeto
 *   empieza donde lo dejó el usuario y se desplaza con el mismo delta que el
 *   objeto trackeado (no se "cambia de lugar").
 * - Escala: width = baseWidthPct * (scale[k] / scale[0]); en el frame 0 la
 *   escala relativa es 1, así que el objeto mantiene su tamaño y solo crece o
 *   se encoge proporcionalmente al cambio de tamaño del objeto trackeado (no se
 *   "hace más grande" de golpe).
 * - Tiempo: LOCAL al clip. El frame k (número REAL en data.frames[k], relativo
 *   al inicio del tracking) se mapea a localTime = startTimeLocal + frameNumber
 *   * frameDurationSec, clampeado a [startTimeLocal, endTimeLocal]. Por defecto
 *   startTimeLocal=0, frameDurationSec=1/fps, endTimeLocal=clipDuration
 *   (caso sin recorte, playbackRate 1 y región dibujada al inicio del clip).
 * - Muestrea cada `sampleStepFrames` (default 5) + siempre el primero y el último.
 */
export function trackingDataToKeyframes(
  data: TrackingData,
  opts: {
    videoWidth: number;
    videoHeight: number;
    clipDuration: number;
    baseWidthPct: number;
    baseX: number;
    baseY: number;
    /** Tiempo LOCAL del clip donde empieza el tracking (donde se dibujó la
     *  región). Default 0 = inicio del clip. */
    startTimeLocal?: number;
    /** Segundos de clip que avanza por cada frame del tracking. Para playbackRate
     *  r: 1/(fps*r). Default 1/fps. */
    frameDurationSec?: number;
    /** Tope local (fin del clip). Default clipDuration. */
    endTimeLocal?: number;
    sampleStepFrames?: number;
  },
): ObjectKeyframe[] {
  if (!data || !data.centers || data.centers.length === 0) return [];
  const {
    videoWidth, videoHeight, clipDuration, baseWidthPct, baseX, baseY,
    startTimeLocal = 0,
    frameDurationSec,
    endTimeLocal,
    sampleStepFrames = 5,
  } = opts;
  if (!videoWidth || !videoHeight || clipDuration <= 0) return [];

  const fps = data.fps && data.fps > 0 ? data.fps : 30;
  const total = data.centers.length;
  const frameDur = frameDurationSec && frameDurationSec > 0 ? frameDurationSec : 1 / fps;
  const tStart = Math.max(0, Math.min(clipDuration, startTimeLocal));
  const tEnd = Math.max(tStart, Math.min(clipDuration, endTimeLocal ?? clipDuration));

  // Referencia en el frame 0: centro inicial y escala inicial (normalizamos a 1).
  const c0 = data.centers[0];
  const s0Raw = data.scales?.[0];
  const s0 = typeof s0Raw === 'number' && s0Raw > 0 ? s0Raw : 1;

  // Indices a muestrear: 0, step, 2*step, ... + el último.
  const indices: number[] = [];
  for (let i = 0; i < total; i += Math.max(1, sampleStepFrames)) indices.push(i);
  if (indices[indices.length - 1] !== total - 1) indices.push(total - 1);

  const keyframes: ObjectKeyframe[] = [];
  let lastValidScaleRel = 1;
  let lastValidDeltaX = 0;
  let lastValidDeltaY = 0;

  for (const k of indices) {
    // Número de frame REAL (relativo al inicio del tracking).
    const frameNumber = (data.frames && Number.isFinite(data.frames[k])) ? data.frames[k] : k;
    const time = Math.max(tStart, Math.min(tEnd, tStart + frameNumber * frameDur));

    const [cx, cy] = data.centers[k];
    const bb = data.bboxes?.[k] || [0, 0, 0, 0];
    // Si el tracking falló en este frame (bbox 0,0,0,0), mantener el último valor.
    const isFail = !bb || (bb[0] === 0 && bb[1] === 0 && bb[2] === 0 && bb[3] === 0);
    if (isFail) {
      keyframes.push(buildKf(k, baseX + lastValidDeltaX, baseY + lastValidDeltaY, baseWidthPct * lastValidScaleRel, time));
      continue;
    }

    // Delta de posición en % respecto al frame 0.
    const dx = ((cx - c0[0]) / videoWidth) * 100;
    const dy = ((cy - c0[1]) / videoHeight) * 100;
    // Escala relativa al frame 0 (empieza en 1).
    const scaleRel = (data.scales?.[k] ?? s0) / s0;
    if (Number.isFinite(scaleRel) && scaleRel > 0) lastValidScaleRel = scaleRel;
    if (Number.isFinite(dx)) lastValidDeltaX = dx;
    if (Number.isFinite(dy)) lastValidDeltaY = dy;

    const x = baseX + lastValidDeltaX;
    const y = baseY + lastValidDeltaY;
    const width = Math.max(5, Math.min(95, baseWidthPct * lastValidScaleRel));

    keyframes.push(buildKf(k, x, y, width, time));
  }

  // Deduplica tiempos idénticos (puede pasar si sampleStep baja a 1 o clips cortos).
  const seen = new Set<number>();
  return keyframes.filter((k) => {
    const key = Math.round(k.time * 100);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.time - b.time);
}

function buildKf(i: number, x: number, y: number, width: number, time: number): ObjectKeyframe {
  return {
    id: `kf-trk-${i}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    time,
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
    width: Math.max(5, Math.min(95, width)),
    opacity: 100,
  };
}

/**
 * Convierte los datos de tracking (px del frame) en instantes (keyframes) de la
 * SELECCIÓN (lazo/rect/círculo) del editor, en porcentajes del área de vídeo (0-100).
 *
 * Sigue el enfoque RELATIVO de `trackingDataToKeyframes` (objetos): el lazo CONSERVA
 * la posición/tamaño que el usuario le dio (`baseBox`) y solo hereda el MOVIMIENTO
 * del objeto trackeado. Así el frame 0 queda idéntico al dibujo del usuario (delta 0,
 * escala relativa 1) y los siguientes se desplazan/escalan con el objeto.
 *
 * - Centro: newCenter = baseCenter + (center[k] - center[0]) en %. Anclaje al centro
 *   → la caja crece desde el centro del objeto, no desde la esquina.
 * - Tamaño: width/height = baseWidth/Height * (scale[k] / scale[0]). Escala relativa
 *   desde 1 en el frame 0 (conserva la proporción del lazo, no la del bbox crudo).
 * - Tiempo: ABSOLUTO del timeline (la selección es global). El frame de tracking k
 *   (número de frame REAL en data.frames[k], relativo al inicio del tracking) se
 *   mapea a timelineAbs = startTimeAbs + frameNumber * frameDurationSec, clampeado a
 *   [startTimeAbs, endTimeAbs]. Esto compensa:
 *     · recorte del clip (sourceStartTime/trimStart): startTimeAbs = currentTime
 *       donde se dibujó el lazo, no el inicio del clip;
 *     · playbackRate r: frameDurationSec = 1/(fps*r) — el archivo avanza r× por
 *       segundo de timeline, así que un frame de archivo = 1/(fps*r) s de timeline;
 *     · el hecho de que el tracker ya muestrea (usa data.frames[k], no el índice k).
 * - Muestrea cada `sampleStepFrames` (default 1 = usar todos los puntos del tracker,
 *   que ya vienen muestreados) + siempre el primero y el último.
 * - Frames fallidos (bbox 0,0,0,0) mantienen la última caja válida.
 */
export function trackingDataToSelectionKeyframes(
  data: TrackingData,
  opts: {
    videoWidth: number;
    videoHeight: number;
    /** Tiempo absoluto del timeline que corresponde al frame 0 del tracking
     *  (= donde el usuario dibujó el lazo / currentTime en ese momento). */
    startTimeAbs: number;
    /** Segundos de timeline que avanza por cada frame del tracking. Para un clip
     *  con playbackRate r y fps de tracking: frameDurationSec = 1/(fps*r). */
    frameDurationSec: number;
    /** Tiempo absoluto del timeline donde termina el clip (tope). */
    endTimeAbs: number;
    /** Caja base del lazo en % (0-100): el bbox de los paths para freehand, o la caja
     *  estática/interpolada para rect/círculo. Es lo que el usuario dibujó/posicionó. */
    baseBox: { x: number; y: number; width: number; height: number };
    /** Conservar silueta: el lazo mantiene EXACTAMENTE el tamaño y la forma que el
     *  usuario dibujó y solo se TRASLADA siguiendo al objeto (sin reescalar). Es lo
     *  que se quiere para un recorte preciso como capa: la silueta nunca se deforma
     *  ni deja partes del objeto fuera. Default true. */
    keepSilhouette?: boolean;
    sampleStepFrames?: number;
  },
): SelectionKeyframe[] {
  if (!data || !data.centers || data.centers.length === 0) return [];
  const { videoWidth, videoHeight, startTimeAbs, frameDurationSec, endTimeAbs, baseBox, keepSilhouette = true, sampleStepFrames = 1 } = opts;
  if (!videoWidth || !videoHeight || frameDurationSec <= 0) return [];
  if (!baseBox || baseBox.width <= 0 || baseBox.height <= 0) return [];

  const total = data.centers.length;

  // Referencia en el frame 0: centro inicial y escala inicial.
  const c0 = data.centers[0];
  const s0Raw = data.scales?.[0];
  const s0 = typeof s0Raw === 'number' && s0Raw > 0 ? s0Raw : 1;

  const baseCx = baseBox.x + baseBox.width / 2;
  const baseCy = baseBox.y + baseBox.height / 2;

  const indices: number[] = [];
  for (let i = 0; i < total; i += Math.max(1, sampleStepFrames)) indices.push(i);
  if (indices[indices.length - 1] !== total - 1) indices.push(total - 1);

  const keyframes: SelectionKeyframe[] = [];
  let lastValid: SelectionKeyframe | null = null;
  let lastScaleRel = 1;
  let lastDx = 0;
  let lastDy = 0;
  for (const k of indices) {
    // Número de frame REAL (relativo al inicio del tracking). data.frames[k] es lo
    // que grabó el tracker; si falta, cae a k (frames consecutivos).
    const frameNumber = (data.frames && Number.isFinite(data.frames[k])) ? data.frames[k] : k;
    const time = Math.max(startTimeAbs, Math.min(endTimeAbs, startTimeAbs + frameNumber * frameDurationSec));

    const [cx, cy] = data.centers[k];
    const bb = data.bboxes?.[k];
    const isFail = !bb || (bb[0] === 0 && bb[1] === 0 && bb[2] === 0 && bb[3] === 0);
    if (isFail) {
      // Mantener la última caja válida (centro+delta+escala conservados).
      if (lastValid) {
        const w = Math.max(1, Math.min(100, baseBox.width * lastScaleRel));
        const h = Math.max(1, Math.min(100, baseBox.height * lastScaleRel));
        const kfx: SelectionKeyframe = {
          time,
          x: Math.max(0, Math.min(100, baseCx + lastDx - w / 2)),
          y: Math.max(0, Math.min(100, baseCy + lastDy - h / 2)),
          width: w,
          height: h,
        };
        keyframes.push(kfx);
      }
      continue;
    }

    // Delta de posición en % respecto al frame 0 (movimiento del centro).
    const dx = ((cx - c0[0]) / videoWidth) * 100;
    const dy = ((cy - c0[1]) / videoHeight) * 100;
    // Escala relativa al frame 0 (empieza en 1). En modo conservar silueta se
    // fuerza a 1: el lazo mantiene su tamaño/forma exactos y solo se traslada.
    const scaleRel = keepSilhouette ? 1 : (data.scales?.[k] ?? s0) / s0;
    if (Number.isFinite(scaleRel) && scaleRel > 0) lastScaleRel = scaleRel;
    if (Number.isFinite(dx)) lastDx = dx;
    if (Number.isFinite(dy)) lastDy = dy;

    const w = Math.max(1, Math.min(100, baseBox.width * lastScaleRel));
    const h = Math.max(1, Math.min(100, baseBox.height * lastScaleRel));
    const kf: SelectionKeyframe = {
      time,
      x: Math.max(0, Math.min(100, baseCx + lastDx - w / 2)),
      y: Math.max(0, Math.min(100, baseCy + lastDy - h / 2)),
      width: w,
      height: h,
    };
    keyframes.push(kf);
    lastValid = kf;
  }

  // Deduplica tiempos idénticos.
  const seen = new Set<number>();
  return keyframes.filter((k) => {
    const key = Math.round(k.time * 100);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.time - b.time);
}