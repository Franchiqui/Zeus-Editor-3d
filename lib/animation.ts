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
