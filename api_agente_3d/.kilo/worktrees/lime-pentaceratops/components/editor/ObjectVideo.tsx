'use client';

import React, { useEffect, useRef } from 'react';
import { ObjectClip } from '@/types';

interface ObjectVideoProps {
  clip: ObjectClip;
  currentTime: number;
  isPlaying: boolean;
  className?: string;
  style?: React.CSSProperties;
  onLoadedMetadata?: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
}

/**
 * <video> para objetos de vídeo con dos modos:
 * - Por defecto (sin clip.syncToTimeline): BUCLE CONTINUO — el vídeo se reproduce
 *   solo, ignorando el timeline (comportamiento original).
 * - clip.syncToTimeline: SINCRONIZADO — se comporta como un clip de vídeo normal:
 *   avanza con el playhead, se pausa al pausar el timeline, hace seek al arrastrar
 *   la barra de tiempo y NO hace bucle (si el clip dura más que el vídeo, se
 *   congela en el último frame). Fuera del rango se pausa.
 */
export default function ObjectVideo({
  clip,
  currentTime,
  isPlaying,
  className,
  style,
  onLoadedMetadata,
}: ObjectVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const clipRef = useRef(clip);
  clipRef.current = clip;

  // Mantiene el <video> en el frame correcto cuando el modo es sincronizado.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !clipRef.current.syncToTimeline) return;

    const local = currentTime - clipRef.current.startTime;
    const inRange = local >= 0 && local < clipRef.current.duration;
    if (!inRange) {
      try { v.pause(); } catch {}
      return;
    }

    // Seek si el playhead se movió (arrastre de la barra) o el vídeo quedó
    // desfasado. Tolerancia para no pelear con la reproducción continua.
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
    const target = dur ? Math.min(local, Math.max(0, dur - 0.01)) : local;
    if (Math.abs(v.currentTime - target) > 0.15) {
      try { v.currentTime = target; } catch {}
    }

    if (isPlaying) {
      if (v.paused) void v.play().catch(() => {});
    } else {
      try { v.pause(); } catch {}
    }
  }, [currentTime, isPlaying]);

  const sync = clip.syncToTimeline;

  return (
    <video
      ref={videoRef}
      src={clip.src}
      muted
      loop={!sync}
      autoPlay={!sync}
      playsInline
      preload="auto"
      draggable={false}
      className={className}
      onLoadedMetadata={onLoadedMetadata}
      style={style}
    />
  );
}
