import type { TextClip, TextKeyframe } from '@/types';

/**
 * Helper de animación de TEXTO: espejo de lib/object-keyframes.ts para TextClip.
 * Anima posición (x, y), tamaño de fuente (fontSize) y opacidad, interpolando
 * linealmente entre instantes. El `time` de cada keyframe es LOCAL al clip
 * (0..duration), igual que en los objetos, para que la animación viaje con el clip.
 *
 * Sin keyframes (vacío/ausente) => usa los valores estáticos del TextClip
 * (comportamiento original, sin animación).
 */

export interface KeyframableText {
  startTime: number;
  duration: number;
  position: { x: number; y: number };
  fontSize: number;
  opacity?: number;
  fadeInDuration?: number;
  fadeOutDuration?: number;
  keyframes?: TextKeyframe[];
}

export interface TextValuesAtTime {
  x: number;
  y: number;
  fontSize: number;
  opacity: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Devuelve los valores visuales (x, y, fontSize, opacity) de un texto en un
 * instante absoluto de la línea de tiempo.
 *
 * - Sin keyframes: valores estáticos del clip.
 * - Con keyframes: interpola linealmente entre los dos circundantes. Antes del
 *   primero usa el primero; después del último usa el último.
 */
export function getTextValuesAtTime(
  clip: KeyframableText,
  currentTime: number,
): TextValuesAtTime {
  const base: TextValuesAtTime = {
    x: clip.position.x,
    y: clip.position.y,
    fontSize: clip.fontSize,
    opacity: clip.opacity ?? 100,
  };

  const keyframes = clip.keyframes;
  if (!keyframes || keyframes.length === 0) return base;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const local = currentTime - clip.startTime;

  const kfVal = (k: TextKeyframe): TextValuesAtTime => ({
    x: k.x,
    y: k.y,
    fontSize: k.fontSize,
    opacity: k.opacity,
  });

  if (local <= sorted[0].time) return kfVal(sorted[0]);
  if (local >= sorted[sorted.length - 1].time) return kfVal(sorted[sorted.length - 1]);

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (local >= a.time && local <= b.time) {
      const span = b.time - a.time;
      const t = span <= 0 ? 0 : (local - a.time) / span;
      return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        fontSize: lerp(a.fontSize, b.fontSize, t),
        opacity: lerp(a.opacity, b.opacity, t),
      };
    }
  }

  return kfVal(sorted[sorted.length - 1]);
}

/**
 * Multiplicador de opacidad (0..1) por fundido fadeIn/fadeOut en el instante
 * actual. Lógica idéntica a getFadeMultiplierAtTime de objetos y al cálculo que
 * ya existía en draw-text.ts y TextOverlay.tsx (ahora unificado aquí).
 */
export function getTextFadeMultiplierAtTime(clip: KeyframableText, currentTime: number): number {
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

/** Opacidad final (0..1) del texto: keyframe/opacity × fundido. */
export function getTextOpacityAtTime(clip: KeyframableText, currentTime: number): number {
  const vals = getTextValuesAtTime(clip, currentTime);
  return (vals.opacity / 100) * getTextFadeMultiplierAtTime(clip, currentTime);
}