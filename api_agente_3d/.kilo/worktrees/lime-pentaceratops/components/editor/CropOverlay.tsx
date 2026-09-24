'use client';

import React, { useEffect, useRef, useState } from 'react';
import { VideoCropState } from '@/types';

interface CropOverlayProps {
  crop: VideoCropState;
  videoAspectRatio: number | null; // w/h del vídeo (== aspect del cuadro del preview)
  onChange: (next: VideoCropState) => void;
}

type DragState =
  | {
      mode: 'move';
      startX: number;
      startY: number;
      start: VideoCropState;
      containerWidth: number;
      containerHeight: number;
    }
  | {
      mode: 'resize';
      startX: number;
      startY: number;
      start: VideoCropState;
      containerWidth: number;
      containerHeight: number;
    }
  | null;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const MIN_SIZE = 5;

// Devuelve el ratio width%/height% necesario para que el rectángulo se vea con
// `targetAspect` dentro de un cuadro cuya proporción es `boxAspect` (w/h).
// Derivación: rectWpx = width/100*boxW, rectHpx = height/100*boxH,
// boxW/boxH = boxAspect  →  (width/height)*boxAspect = targetAspect.
function aspectRatioFor(targetAspect: number, boxAspect: number | null): number | null {
  if (!boxAspect || boxAspect <= 0) return null;
  return targetAspect / boxAspect;
}

function parseAspect(aspect: string | null): number | null {
  if (!aspect) return null;
  const m = aspect.split(':');
  if (m.length !== 2) return null;
  const w = parseFloat(m[0]);
  const h = parseFloat(m[1]);
  if (!isFinite(w) || !isFinite(h) || h === 0) return null;
  return w / h;
}

export default function CropOverlay({ crop, videoAspectRatio, onChange }: CropOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState>(null);

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const cw = rect.width || dragState.containerWidth;
      const ch = rect.height || dragState.containerHeight;
      const target = parseAspect(crop.aspect);
      const r = target ? aspectRatioFor(target, videoAspectRatio) : null; // width = height * r

      if (dragState.mode === 'move') {
        const dx = ((event.clientX - dragState.startX) / cw) * 100;
        const dy = ((event.clientY - dragState.startY) / ch) * 100;
        const x = clamp(dragState.start.x + dx, 0, 100 - dragState.start.width);
        const y = clamp(dragState.start.y + dy, 0, 100 - dragState.start.height);
        onChange({ ...dragState.start, x, y });
        return;
      }

      // resize (handle inferior-derecho): cambia ancho, alto sigue la proporción si hay lock
      const deltaW = ((event.clientX - dragState.startX) / cw) * 100;
      let width = clamp(dragState.start.width + deltaW, MIN_SIZE, 100 - dragState.start.x);
      let height: number;

      if (r) {
        height = width / r;
        if (height > 100 - dragState.start.y || height > 100) {
          height = Math.min(100 - dragState.start.y, 100);
          width = height * r;
          width = clamp(width, MIN_SIZE, 100 - dragState.start.x);
        }
      } else {
        const deltaH = ((event.clientY - dragState.startY) / ch) * 100;
        height = clamp(dragState.start.height + deltaH, MIN_SIZE, 100 - dragState.start.y);
      }
      onChange({ ...dragState.start, width, height });
    };

    const handleMouseUp = () => setDragState(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, crop.aspect, videoAspectRatio, onChange]);

  const startDrag = (event: React.MouseEvent, mode: 'move' | 'resize') => {
    event.preventDefault();
    event.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setDragState({
      mode,
      startX: event.clientX,
      startY: event.clientY,
      start: { ...crop },
      containerWidth: rect.width,
      containerHeight: rect.height,
    });
  };

  const { x, y, width, height } = crop;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-[20] overflow-hidden pointer-events-none"
    >
      {/* Atenuación exterior (4 bandas oscuras) */}
      <div className="absolute bg-black/55 pointer-events-none" style={{ left: 0, top: 0, right: 0, height: `${y}%` }} />
      <div className="absolute bg-black/55 pointer-events-none" style={{ left: 0, top: `${y + height}%`, right: 0, bottom: 0 }} />
      <div className="absolute bg-black/55 pointer-events-none" style={{ left: 0, top: `${y}%`, width: `${x}%`, height: `${height}%` }} />
      <div className="absolute bg-black/55 pointer-events-none" style={{ left: `${x + width}%`, top: `${y}%`, right: 0, height: `${height}%` }} />

      {/* Rectángulo de zona */}
      <div
        role="button"
        tabIndex={0}
        className="absolute cursor-move select-none pointer-events-auto border-2 border-dashed border-emerald-400 bg-transparent"
        style={{
          left: `${x}%`,
          top: `${y}%`,
          width: `${width}%`,
          height: `${height}%`,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
          touchAction: 'none',
        }}
        onMouseDown={(e) => startDrag(e, 'move')}
      >
        {/* esquinas */}
        {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
          <span
            key={c}
            className="absolute h-2.5 w-2.5 bg-emerald-400 border border-black/50 rounded-sm pointer-events-none"
            style={{
              top: c.startsWith('n') ? -5 : undefined,
              bottom: c.startsWith('s') ? -5 : undefined,
              left: c.endsWith('w') ? -5 : undefined,
              right: c.endsWith('e') ? -5 : undefined,
            }}
          />
        ))}
        {/* handle de redimensión (inferior-derecha) */}
        <button
          type="button"
          title="Redimensionar zona"
          className="absolute -bottom-1.5 -right-1.5 h-4 w-4 rounded-full bg-emerald-500 border border-white shadow-lg cursor-se-resize pointer-events-auto"
          onMouseDown={(e) => startDrag(e, 'resize')}
        />
      </div>
    </div>
  );
}