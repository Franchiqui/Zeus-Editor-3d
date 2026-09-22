'use client';

export type EasingFunction =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'ease-in-cubic'
  | 'ease-out-cubic'
  | 'ease-in-out-cubic'
  | 'spring';

export type KeyframeProperty =
  | 'zoom'
  | 'offsetX'
  | 'offsetY'
  | 'rotationX'
  | 'rotationY'
  | 'translateX'
  | 'translateY'
  | 'translateZ'
  | 'scale';

export interface Keyframe {
  time: number;
  values: Partial<Record<KeyframeProperty, number>>;
  easing: EasingFunction;
}

export interface AnimationTrack {
  id: string;
  objectId: string | null;
  name: string;
  duration: number;
  looping: boolean;
  keyframes: Keyframe[];
}

export interface AnimationState {
  tracks: AnimationTrack[];
  playing: boolean;
  currentTime: number;
  selectedTrackId: string | null;
}

const EASING_FUNCTIONS: Record<EasingFunction, (t: number) => number> = {
  linear: (t) => t,
  'ease-in': (t) => t * t,
  'ease-out': (t) => 1 - (1 - t) * (1 - t),
  'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  'ease-in-cubic': (t) => t * t * t,
  'ease-out-cubic': (t) => 1 - Math.pow(1 - t, 3),
  'ease-in-out-cubic': (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  spring: (t) => {
    const oscillation = 4;
    const decay = 3;
    return 1 - Math.cos(t * Math.PI * oscillation) * Math.exp(-t * decay);
  },
};

export function getEasingFunction(fn: EasingFunction): (t: number) => number {
  return EASING_FUNCTIONS[fn] || EASING_FUNCTIONS.linear;
}

export function interpolateValue(
  from: number | undefined,
  to: number | undefined,
  progress: number,
  easing: EasingFunction
): number | undefined {
  if (from === undefined || to === undefined) return to ?? from;
  const eased = getEasingFunction(easing)(progress);
  return from + (to - from) * eased;
}

export function findKeyframeSegment(
  keyframes: Keyframe[],
  time: number
): { start: Keyframe; end: Keyframe; segmentProgress: number } | null {
  if (keyframes.length < 2) return null;
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  if (time <= sorted[0].time) {
    return { start: sorted[0], end: sorted[1], segmentProgress: 0 };
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (time >= start.time && time <= end.time) {
      const segmentDuration = end.time - start.time;
      const segmentProgress = segmentDuration > 0 ? (time - start.time) / segmentDuration : 0;
      return { start, end, segmentProgress };
    }
  }

  const last = sorted[sorted.length - 1];
  const secondLast = sorted[sorted.length - 2];
  return { start: secondLast, end: last, segmentProgress: 1 };
}

export function evaluateTrack(
  track: AnimationTrack,
  time: number
): Partial<Record<KeyframeProperty, number>> | null {
  if (track.keyframes.length === 0) return null;

  const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
  const effectiveTime = track.looping && track.duration > 0
    ? ((time % track.duration) + track.duration) % track.duration
    : time;

   if (effectiveTime <= sorted[0].time) {
     return { ...(sorted[0].values ?? {}) };
   }
 
   if (effectiveTime >= sorted[sorted.length - 1].time) {
     return { ...(sorted[sorted.length - 1].values ?? {}) };
   }
 
   const segment = findKeyframeSegment(sorted, effectiveTime);
   if (!segment) return { ...(sorted[0].values ?? {}) };
 
   const result: Partial<Record<KeyframeProperty, number>> = {};
   const properties = Array.from(
     new Set([...Object.keys(segment.start.values ?? {}), ...Object.keys(segment.end.values ?? {})])
   ) as KeyframeProperty[];
 
   for (const prop of properties) {
     const fromVal = (segment.start.values ?? {})[prop];
     const toVal = (segment.end.values ?? {})[prop];
     result[prop] = interpolateValue(fromVal, toVal, segment.segmentProgress, segment.end.easing);
   }

  return result;
}

export const EASING_OPTIONS: { value: EasingFunction; label: string }[] = [
  { value: 'linear', label: 'Lineal' },
  { value: 'ease-in', label: 'Entrada' },
  { value: 'ease-out', label: 'Salida' },
  { value: 'ease-in-out', label: 'Entrada/Salida' },
  { value: 'ease-in-cubic', label: 'Entrada Cúbica' },
  { value: 'ease-out-cubic', label: 'Salida Cúbica' },
  { value: 'ease-in-out-cubic', label: 'Entrada/Salida Cúbica' },
  { value: 'spring', label: 'Resorte' },
];

export const KEYFRAME_PROPERTY_LABELS: Record<KeyframeProperty, string> = {
  zoom: 'Zoom',
  offsetX: 'Desplazamiento X',
  offsetY: 'Desplazamiento Y',
  rotationX: 'Rotación X',
  rotationY: 'Rotación Y',
  translateX: 'Traslación X',
  translateY: 'Traslación Y',
  translateZ: 'Traslación Z',
  scale: 'Escala',
};

export const OBJECT_PROPERTIES: KeyframeProperty[] = [
  'translateX',
  'translateY',
  'translateZ',
  'rotationX',
  'rotationY',
  'scale',
];

export function createDefaultTrack(
  objectId: string | null,
  name: string,
  duration: number = 3
): AnimationTrack {
  return {
    id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    objectId,
    name,
    duration,
    looping: false,
    keyframes: [
      { time: 0, values: {}, easing: 'linear' },
      { time: duration, values: {}, easing: 'linear' },
    ],
  };
}

export function createDefaultKeyframe(
  time: number,
  properties: KeyframeProperty[],
  values: Partial<Record<KeyframeProperty, number>>
): Keyframe {
  return {
    time,
    values: { ...values },
    easing: 'linear',
  };
}

export function cloneTrack(track: AnimationTrack): AnimationTrack {
  return {
    ...track,
    keyframes: track.keyframes.map((k) => ({ ...k, values: { ...k.values } })),
  };
}

// ---------------------------------------------------------------------------
// Cámara como objeto de escena: pose por fotograma (posición + foco + FOV).
// ---------------------------------------------------------------------------

export type Vec3 = { x: number; y: number; z: number };

export type CameraKeyframe = {
  /** Milisegundos dentro del recorrido */
  time: number;
  /** Posición del cuerpo de la cámara */
  position: Vec3;
  /** Foco: el punto hacia el que mira (look-at) */
  target: Vec3;
  /** Ángulo de visión; si falta, usa el FOV del objeto */
  fov?: number;
  easing: EasingFunction;
};

export type CameraData = {
  fov: number;
  /** Foco actual de la cámara (sin fotograma seleccionado) */
  target: Vec3;
  keyframes: CameraKeyframe[];
};

export function createDefaultCameraData(): CameraData {
  return { fov: 45, target: { x: 0, y: 1, z: 0 }, keyframes: [] };
}

/** Evalúa el recorrido de una cámara-objeto en un instante (ms). */
export function evaluateCameraKeyframes(
  keyframes: CameraKeyframe[],
  time: number,
  fovFallback: number = 45
): { position: Vec3; target: Vec3; fov: number } | null {
  if (keyframes.length === 0) return null;
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const poseOf = (k: CameraKeyframe): { position: Vec3; target: Vec3; fov: number } => ({
    position: k.position,
    target: k.target,
    fov: k.fov ?? fovFallback,
  });
  if (keyframes.length === 1 || time <= sorted[0].time) {
    return poseOf(sorted[0]);
  }
  if (time >= sorted[sorted.length - 1].time) {
    return poseOf(sorted[sorted.length - 1]);
  }
  // Segmento que contiene `time` (misma lógica que findKeyframeSegment,
  // pero sobre fotogramas de cámara).
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (time >= start.time && time <= end.time) {
      const dur = end.time - start.time;
      const progress = dur > 0 ? (time - start.time) / dur : 0;
      const eased = getEasingFunction(end.easing)(progress);
      const lerp = (a: number, b: number) => a + (b - a) * eased;
      const fovA = start.fov ?? fovFallback;
      const fovB = end.fov ?? fovFallback;
      return {
        position: {
          x: lerp(start.position.x, end.position.x),
          y: lerp(start.position.y, end.position.y),
          z: lerp(start.position.z, end.position.z),
        },
        target: {
          x: lerp(start.target.x, end.target.x),
          y: lerp(start.target.y, end.target.y),
          z: lerp(start.target.z, end.target.z),
        },
        fov: lerp(fovA, fovB),
      };
    }
  }
  return poseOf(sorted[sorted.length - 1]);
}

// ---------------------------------------------------------------------------
// Editor de movimiento: pistas de TRANSFORMADA de objetos y de PARÁMETROS de
// plugin. Todo en SEGUNDOS (el legacy AnimationTrack usa ms; queda aislado).
// ---------------------------------------------------------------------------

/** Propiedades animables de la transformada de un objeto (ObjectTransform). */
export type TransformProperty =
  | 'px' | 'py' | 'pz'
  | 'rx' | 'ry' | 'rz'
  | 'sx' | 'sy' | 'sz';

export interface TransformKeyframe {
  time: number;
  /** Solo las propiedades que cambian en este fotograma. */
  values: Partial<Record<TransformProperty, number>>;
  easing: EasingFunction;
}

export interface TransformTrack {
  id: string;
  objectId: string;
  name: string;
  /** Duración en segundos. */
  duration: number;
  looping: boolean;
  keyframes: TransformKeyframe[];
  /**
   * Pistas de grupo: cuando se está, esta pista controla SIMULTÁNEAMENTE
   * la transformada de todos los objetos listados aquí (además del
   * objectId principal). Permite animar un grupo de objetos como si
   * fueran un único objeto.
   */
  objectIds?: string[];
}

/** Fotograma de un parámetro de plugin (solo deslizadores son animables). */
export interface PluginParamKeyframe {
  time: number;
  value: number;
  easing: EasingFunction;
}

export interface PluginParamTrack {
  id: string;
  objectId: string;
  pluginId: string;
  paramId: string;
  /** Duración en segundos. */
  duration: number;
  looping: boolean;
  keyframes: PluginParamKeyframe[];
}

export const TRANSFORM_PROPERTIES: TransformProperty[] = [
  'px', 'py', 'pz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz',
];

export const TRANSFORM_PROPERTY_LABELS: Record<TransformProperty, string> = {
  px: 'Posición X',
  py: 'Posición Y',
  pz: 'Posición Z',
  rx: 'Rotación X',
  ry: 'Rotación Y',
  rz: 'Rotación Z',
  sx: 'Escala X',
  sy: 'Escala Y',
  sz: 'Escala Z',
};

/**
 * Evalúa una pista de transformada en un instante (segundos). Devuelve solo
 * las propiedades presentes en los fotogramas; el resto lo resuelve quien
 * llama mezclando con el transform estático del objeto.
 */
export function evaluateTransformTrack(
  track: TransformTrack,
  time: number
): Partial<Record<TransformProperty, number>> | null {
  if (track.keyframes.length === 0) return null;
  const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
  const effectiveTime = track.looping && track.duration > 0
    ? ((time % track.duration) + track.duration) % track.duration
    : time;

  if (effectiveTime <= sorted[0].time) {
    return { ...(sorted[0].values ?? {}) };
  }
  if (effectiveTime >= sorted[sorted.length - 1].time) {
    return { ...(sorted[sorted.length - 1].values ?? {}) };
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (effectiveTime >= start.time && effectiveTime <= end.time) {
      const segDur = end.time - start.time;
      const progress = segDur > 0 ? (effectiveTime - start.time) / segDur : 0;
      const eased = getEasingFunction(end.easing)(progress);
      const props = Array.from(
        new Set([...Object.keys(start.values ?? {}), ...Object.keys(end.values ?? {})])
      ) as TransformProperty[];
      const result: Partial<Record<TransformProperty, number>> = {};
      for (const prop of props) {
        const from = (start.values ?? {})[prop];
        const to = (end.values ?? {})[prop];
        if (from === undefined && to === undefined) continue;
        result[prop] = from !== undefined && to !== undefined
          ? from + (to - from) * eased
          : (to ?? from);
      }
      return result;
    }
  }
  return { ...(sorted[sorted.length - 1].values ?? {}) };
}

/** Evalúa una pista de parámetro de plugin en un instante (segundos). */
export function evaluatePluginParamTrack(
  track: PluginParamTrack,
  time: number
): number | null {
  if (track.keyframes.length === 0) return null;
  const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
  const effectiveTime = track.looping && track.duration > 0
    ? ((time % track.duration) + track.duration) % track.duration
    : time;

  if (effectiveTime <= sorted[0].time) return sorted[0].value;
  if (effectiveTime >= sorted[sorted.length - 1].time) {
    return sorted[sorted.length - 1].value;
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (effectiveTime >= start.time && effectiveTime <= end.time) {
      const segDur = end.time - start.time;
      const progress = segDur > 0 ? (effectiveTime - start.time) / segDur : 0;
      const eased = getEasingFunction(end.easing)(progress);
      return start.value + (end.value - start.value) * eased;
    }
  }
  return sorted[sorted.length - 1].value;
}

/**
 * Inserta un fotograma o REEMPLAZA el que cae en el mismo tiempo
 * (tolerancia `epsilon`). Devuelve un array nuevo ordenado por tiempo.
 */
export function upsertKeyframeAt<T extends { time: number }>(
  keyframes: T[],
  kf: T,
  epsilon: number = 1e-4
): T[] {
  const existing = keyframes.findIndex((k) => Math.abs(k.time - kf.time) < epsilon);
  if (existing >= 0) {
    const next = [...keyframes];
    next[existing] = kf;
    return next.sort((a, b) => a.time - b.time);
  }
  return [...keyframes, kf].sort((a, b) => a.time - b.time);
}

/**
 * Diff de transformadas: solo las propiedades cuyo delta supera `eps`.
 * `ObjectTransform` (viewer-3d.tsx) cumple la forma de `Record<TransformProperty, number>`.
 */
export function diffTransform(
  from: Record<TransformProperty, number>,
  to: Record<TransformProperty, number>,
  eps: number = 1e-4
): Partial<Record<TransformProperty, number>> {
  const result: Partial<Record<TransformProperty, number>> = {};
  for (const prop of TRANSFORM_PROPERTIES) {
    const a = from[prop];
    const b = to[prop];
    if (a === undefined || b === undefined) continue;
    if (Math.abs(b - a) > eps) result[prop] = b;
  }
  return result;
}

export function createTransformTrack(
  objectId: string,
  transform: Record<TransformProperty, number>,
  duration: number = 5
): TransformTrack {
  return {
    id: `ttrack-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    objectId,
    name: 'Transformación',
    duration,
    looping: false,
    keyframes: [
      {
        time: 0,
        values: TRANSFORM_PROPERTIES.reduce((acc, p) => {
          if (transform[p] !== undefined) acc[p] = transform[p];
          return acc;
        }, {} as Partial<Record<TransformProperty, number>>),
        easing: 'linear',
      },
    ],
  };
}

/**
 * Crea una pista de transformada de GRUPO: controla al objeto principal
 * (objectId) y a todos los listados en objectIds con un único set de
 * fotogramas. Útil para animar varios objetos como un solo cuerpo.
 */
export function createGroupTransformTrack(
  objectIds: string[],
  transform: Record<TransformProperty, number>,
  duration: number = 5
): TransformTrack {
  if (objectIds.length === 0) {
    return createTransformTrack('', transform, duration);
  }
  const mainId = objectIds[0];
  const rest = objectIds.slice(1);
  return {
    id: `ttrack-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    objectId: mainId,
    name: 'Grupo',
    duration,
    looping: false,
    keyframes: [
      {
        time: 0,
        values: TRANSFORM_PROPERTIES.reduce((acc, p) => {
          if (transform[p] !== undefined) acc[p] = transform[p];
          return acc;
        }, {} as Partial<Record<TransformProperty, number>>),
        easing: 'linear',
      },
    ],
    objectIds: rest.length > 0 ? rest : undefined,
  };
}

export function createPluginParamTrack(
  objectId: string,
  pluginId: string,
  paramId: string,
  value: number,
  duration: number = 5
): PluginParamTrack {
  return {
    id: `ptrack-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    objectId,
    pluginId,
    paramId,
    duration,
    looping: false,
    keyframes: [{ time: 0, value, easing: 'linear' }],
  };
}

/** Duración global del sistema de movimiento (segundos). */
export function motionMaxDuration(
  transformTracks: TransformTrack[],
  pluginTracks: PluginParamTrack[]
): number {
  let max = 0;
  for (const t of transformTracks) max = Math.max(max, t.duration);
  for (const t of pluginTracks) max = Math.max(max, t.duration);
  return max;
}
