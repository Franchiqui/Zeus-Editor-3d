import { ObjectKeyframe } from '@/types';

/**
 * Tipo estructural mínimo que comparten los ObjectClip y los clips de efecto
 * del effects-track (que no tienen `name` ni `keyframes`). Permite reutilizar
 * el mismo helper de interpolación para ambos en el render de export.
 */
export interface KeyframableObject {
  startTime: number;
  duration: number;
  position: { x: number; y: number };
  width: number;
  height?: number;
  opacity?: number;
  fadeInDuration?: number;
  fadeOutDuration?: number;
  keyframes?: ObjectKeyframe[];
  corners?: { x: number; y: number }[];
}

export interface ObjectValuesAtTime {
  x: number;
  y: number;
  width: number;
  height?: number;
  opacity: number;
  corners?: { x: number; y: number }[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Offsets de las esquinas respecto al centro del objeto, en rango ±50.
 * La posición CSS del handle es: left = 50 + corner.x (%), top = 50 + corner.y (%)
 * Con ±50: 50+(-50)=0% y 50+50=100% → exactamente en las esquinas del contenedor.
 */
export const defaultCorners = (): { x: number; y: number }[] => [
  { x: -50, y: -50 }, // superior-izquierda
  { x:  50, y: -50 }, // superior-derecha
  { x:  50, y:  50 }, // inferior-derecha
  { x: -50, y:  50 }, // inferior-izquierda
];

/**
 * Devuelve los valores visuales (x, y, width, opacity) de un objeto en un
 * instante absoluto de la línea de tiempo.
 *
 * - Sin keyframes (vacío/ausente): usa los valores estáticos del clip
 *   (comportamiento original, sin animación).
 * - Con keyframes: interpola linealmente entre los dos keyframes circundantes.
 *   Antes del primero usa el primero; después del último usa el último.
 *
 * El tiempo de cada keyframe es LOCAL al clip (0..duration), por lo que la
 * animación viaja con el clip al moverlo en la línea de tiempo.
 */
export function getObjectValuesAtTime(
  clip: KeyframableObject,
  currentTime: number
): ObjectValuesAtTime {
  const baseCorners = clip.corners ?? defaultCorners();
  const base: ObjectValuesAtTime = {
    x: clip.position.x,
    y: clip.position.y,
    width: clip.width,
    height: clip.height,
    opacity: clip.opacity ?? 100,
    corners: baseCorners,
  };

  const keyframes = clip.keyframes;
  if (!keyframes || keyframes.length === 0) return base;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const local = currentTime - clip.startTime;

  const cornersOf = (k: ObjectKeyframe) =>
    k.corners ?? baseCorners;

  const kfVal = (k: ObjectKeyframe): ObjectValuesAtTime => ({
    x: k.x,
    y: k.y,
    width: k.width,
    height: k.height,
    opacity: k.opacity,
    corners: cornersOf(k).map((c) => ({ x: c.x, y: c.y })),
  });

  // Antes del primer keyframe
  if (local <= sorted[0].time) return kfVal(sorted[0]);
  // Después del último
  if (local >= sorted[sorted.length - 1].time) return kfVal(sorted[sorted.length - 1]);

  // Entre dos keyframes consecutivos
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (local >= a.time && local <= b.time) {
      const span = b.time - a.time;
      const t = span <= 0 ? 0 : (local - a.time) / span;
      const ca = cornersOf(a);
      const cb = cornersOf(b);
      return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        width: lerp(a.width, b.width, t),
        height: a.height !== undefined && b.height !== undefined ? lerp(a.height, b.height, t) : undefined,
        opacity: lerp(a.opacity, b.opacity, t),
        corners: ca.map((c, idx) => ({ x: lerp(c.x, cb[idx].x, t), y: lerp(c.y, cb[idx].y, t) })),
      };
    }
  }

  return kfVal(sorted[sorted.length - 1]);
}

/**
 * Multiplicador de opacidad (0..1) por fundido fadeIn/fadeOut en el instante
 * actual. Lógica idéntica a la que existía en ObjectOverlay y en renderFrame,
 * extraída aquí para compartirla entre preview y export.
 */
export function getFadeMultiplierAtTime(clip: KeyframableObject, currentTime: number): number {
  const clipLocalTime = currentTime - clip.startTime;
  const clipDuration = clip.duration ?? 0;
  const fadeInDuration = Math.max(0, clip.fadeInDuration ?? 0);
  const fadeOutDuration = Math.max(0, clip.fadeOutDuration ?? 0);

  let fadeMultiplier = 1;

  if (fadeInDuration > 0 && clipLocalTime < fadeInDuration) {
    fadeMultiplier = Math.min(fadeMultiplier, Math.max(0, clipLocalTime / fadeInDuration));
  }

  if (fadeOutDuration > 0) {
    const remainingTime = clipDuration - clipLocalTime;
    if (remainingTime < fadeOutDuration) {
      fadeMultiplier = Math.min(fadeMultiplier, Math.max(0, remainingTime / fadeOutDuration));
    }
  }

  return fadeMultiplier;
}

/** Opacidad final (0..1) del objeto: keyframe/opacity × fundido. */
export function getObjectOpacityAtTime(clip: KeyframableObject, currentTime: number): number {
  const vals = getObjectValuesAtTime(clip, currentTime);
  return (vals.opacity / 100) * getFadeMultiplierAtTime(clip, currentTime);
}