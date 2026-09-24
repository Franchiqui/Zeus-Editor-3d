'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ObjectClip, ObjectKeyframe } from '@/types';
import { getObjectOpacityAtTime, getObjectValuesAtTime, ObjectValuesAtTime, defaultCorners } from '@/lib/object-keyframes';
import ObjectVideo from '@/components/editor/ObjectVideo';

interface ObjectOverlayProps {
  objectClips: ObjectClip[];
  currentTime: number;
  selectedObjectId?: string | null;
  onSelectObject?: (id: string | null) => void;
  onUpdateObjectClip?: (id: string, updates: Partial<ObjectClip>) => void;
  /** Si true (reproduciendo), los objetos fuera de su rango [startTime, startTime+duration)
   *  NO se muestran ni siquiera estando seleccionados. En pausa el seleccionado sí se
   *  mantiene visible fuera de rango para poder editarlo. */
  isPlaying?: boolean;
}

type DragState =
  | {
      mode: 'move';
      id: string;
      startX: number;
      startY: number;
      startVals: ObjectValuesAtTime;
      hasKeyframes: boolean;
      localTime: number;
    }
  | {
      mode: 'resize';
      id: string;
      startX: number;
      startVals: ObjectValuesAtTime;
      hasKeyframes: boolean;
      localTime: number;
      containerWidth: number;
    }
  | {
      mode: 'corner';
      id: string;
      cornerIndex: number;
      startX: number;
      startY: number;
      startVals: ObjectValuesAtTime;
      startCorners: { x: number; y: number }[];
      hasKeyframes: boolean;
      localTime: number;
      objectWidth: number;
      objectHeight: number;
      mirrored: boolean;
    }
  | null;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export default function ObjectOverlay({
  objectClips,
  currentTime,
  selectedObjectId,
  onSelectObject,
  onUpdateObjectClip,
  isPlaying = false,
}: ObjectOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [cornerResizeMode, setCornerResizeMode] = useState<'width' | 'height' | 'both'>('both');
  const dragKeyframesRef = useRef<ObjectKeyframe[] | null>(null);

  useEffect(() => {
    if (!selectedObjectId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        setCornerResizeMode((prev) =>
          prev === 'width' ? 'height' : prev === 'height' ? 'both' : 'width'
        );
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [selectedObjectId]);

  const activeObjects = useMemo(
    () =>
      objectClips.filter(
        (clip) =>
          (currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration) ||
          (!isPlaying && clip.id === selectedObjectId)
      ),
    [currentTime, objectClips, selectedObjectId, isPlaying]
  );

  useEffect(() => {
    if (!dragState || !onUpdateObjectClip) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (dragState.mode === 'move') {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const nextX = clamp(
          dragState.startVals.x + ((event.clientX - dragState.startX) / rect.width) * 100,
          0,
          100
        );
        const nextY = clamp(
          dragState.startVals.y + ((event.clientY - dragState.startY) / rect.height) * 100,
          0,
          100
        );
        applyDragUpdate(dragState, { x: nextX, y: nextY });
      } else if (dragState.mode === 'resize') {
        const deltaPercent = ((event.clientX - dragState.startX) / dragState.containerWidth) * 100;
        const nextWidth = clamp(dragState.startVals.width + deltaPercent, 5, 95);
        applyDragUpdate(dragState, { width: nextWidth });
      } else if (dragState.mode === 'corner') {
        // Espejo: la X del handle está invertida en pantalla, así que el delta
        // del cursor se aplica negado a la coordenada local del vértice.
        const dxSign = dragState.mirrored ? -1 : 1;
        const dx = dxSign * ((event.clientX - dragState.startX) / dragState.objectWidth) * 100;
        const dy = ((event.clientY - dragState.startY) / dragState.objectHeight) * 100;
        const nextCorners = dragState.startCorners.map((c, i) => {
          if (i !== dragState.cornerIndex) return { ...c };
          if (cornerResizeMode === 'width') {
            return { x: clamp(c.x + dx, -200, 200), y: c.y };
          }
          if (cornerResizeMode === 'height') {
            return { x: c.x, y: clamp(c.y + dy, -200, 200) };
          }
          return {
            x: clamp(c.x + dx, -200, 200),
            y: clamp(c.y + dy, -200, 200),
          };
        });
        applyDragUpdate(dragState, { corners: nextCorners });
      }
    };

    const applyDragUpdate = (
      state: Exclude<DragState, null>,
      partial: Partial<Pick<ObjectKeyframe, 'x' | 'y' | 'width' | 'opacity' | 'corners'>>
    ) => {
      // Sin keyframes: edita los valores base (comportamiento original).
      if (!state.hasKeyframes) {
        if (state.mode === 'move') {
          onUpdateObjectClip!(state.id, {
            position: { x: partial.x ?? state.startVals.x, y: partial.y ?? state.startVals.y },
          });
        } else if (state.mode === 'corner') {
          onUpdateObjectClip!(state.id, { corners: partial.corners ?? state.startVals.corners });
        } else {
          onUpdateObjectClip!(state.id, { width: partial.width ?? state.startVals.width });
        }
        return;
      }

      // Con keyframes: upsert del keyframe en el instante local actual.
      let prev = dragKeyframesRef.current ?? [];
      const idx = prev.findIndex((k) => Math.abs(k.time - state.localTime) < 0.05);
      let next: ObjectKeyframe[];
      if (idx >= 0) {
        next = prev.map((k) =>
          k.id === prev[idx].id
            ? { ...k, ...partial }
            : k
        );
      } else {
        const newKf: ObjectKeyframe = {
          id: `kf-${state.id}-${state.localTime.toFixed(3)}`,
          time: state.localTime,
          x: partial.x ?? state.startVals.x,
          y: partial.y ?? state.startVals.y,
          width: partial.width ?? state.startVals.width,
          opacity: state.startVals.opacity,
          corners: partial.corners ? partial.corners.map(c => ({ ...c })) : undefined,
        };
        next = [...prev, newKf];
      }
      dragKeyframesRef.current = next;
      onUpdateObjectClip!(state.id, { keyframes: next });
    };

    const handleMouseUp = () => {
      dragKeyframesRef.current = null;
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, onUpdateObjectClip, cornerResizeMode]);

  return (
    <div ref={containerRef} className="absolute inset-0 z-[15] overflow-hidden pointer-events-none">
      {activeObjects.map((clip) => {
        const isSelected = clip.id === selectedObjectId;
        const vals = getObjectValuesAtTime(clip, currentTime);
        return (
          <div
            key={clip.id}
            className="absolute inset-0 pointer-events-none"
          >
            <div
              role="button"
              tabIndex={0}
              className="absolute inline-flex cursor-move select-none pointer-events-auto"
              style={{
                left: `${vals.x}%`,
                top: `${vals.y}%`,
                width: `${vals.width}%`,
                height: vals.height !== undefined ? `${vals.height}%` : 'auto',
                transform: 'translate(-50%, -50%)',
                touchAction: 'none',
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelectObject?.(clip.id);
                const startVals = getObjectValuesAtTime(clip, currentTime);
                const localTime = clamp(currentTime - clip.startTime, 0, clip.duration);
                const hasKeyframes = !!(clip.keyframes && clip.keyframes.length);
                dragKeyframesRef.current = hasKeyframes ? [...clip.keyframes!] : null;
                setDragState({
                  mode: 'move',
                  id: clip.id,
                  startX: event.clientX,
                  startY: event.clientY,
                  startVals,
                  hasKeyframes,
                  localTime,
                });
              }}
              onClick={(event) => {
                event.stopPropagation();
                onSelectObject?.(clip.id);
              }}
            >
              {clip.mediaType === 'video' ? (
                <ObjectVideo
                  clip={clip}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  className="block w-full h-auto object-contain pointer-events-none"
                  style={{ opacity: getObjectOpacityAtTime(clip, currentTime), transform: clip.mirrored ? 'scaleX(-1)' : undefined }}
                />
              ) : (
                <img
                  src={clip.src}
                  alt={clip.name}
                  draggable={false}
                  className="block w-full h-auto object-contain pointer-events-none"
                  style={{ opacity: getObjectOpacityAtTime(clip, currentTime), transform: clip.mirrored ? 'scaleX(-1)' : undefined }}
                />
              )}
               {isSelected && onUpdateObjectClip && (
                 <>
                 <button
                   type="button"
                   className="absolute -bottom-2 -right-2 h-5 w-5 rounded-full bg-emerald-500 border border-white shadow-lg"
                   title="Redimensionar"
                   onMouseDown={(event) => {
                     event.preventDefault();
                     event.stopPropagation();
                     const container = containerRef.current;
                     if (!container) return;
                     const startVals = getObjectValuesAtTime(clip, currentTime);
                     const localTime = clamp(currentTime - clip.startTime, 0, clip.duration);
                     const hasKeyframes = !!(clip.keyframes && clip.keyframes.length);
                     dragKeyframesRef.current = hasKeyframes ? [...clip.keyframes!] : null;
                     setDragState({
                       mode: 'resize',
                       id: clip.id,
                       startX: event.clientX,
                       startVals,
                       hasKeyframes,
                       localTime,
                       containerWidth: container.getBoundingClientRect().width,
                     });
                   }}
                 />
{(vals.corners ?? clip.corners ?? defaultCorners()).map((corner, i) => (
  <button
    key={i}
    type="button"
    className={`absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow pointer-events-auto z-20 ${cornerResizeMode === 'width' ? 'bg-blue-500' : cornerResizeMode === 'height' ? 'bg-amber-500' : 'bg-red-500'}`}
    style={{
      left: `${50 + (clip.mirrored ? -corner.x : corner.x)}%`,
      top: `${50 + corner.y}%`,
      cursor: i === 0 || i === 2 ? 'nwse-resize' : 'nesw-resize',
      touchAction: 'none',
    }}
    title={`Vértice ${i + 1} — Modo ${cornerResizeMode === 'width' ? 'ANCHO (x)' : cornerResizeMode === 'height' ? 'ALTO (y)' : 'LIBRE (x+y)'}. Cambia con Tab`}
    onMouseDown={(event) => {
      event.preventDefault();
      event.stopPropagation();
      const objectEl = event.currentTarget.parentElement;
      console.log('[ObjectOverlay2] corner onMouseDown, clip:', clip.name, 'corner:', i, 'objectEl:', !!objectEl);
      if (!objectEl) return;
      const rect = objectEl.getBoundingClientRect();
      const startVals = getObjectValuesAtTime(clip, currentTime);
      const startCorners = (startVals.corners ?? clip.corners ?? defaultCorners()).map(c => ({ ...c }));
      const localTime = clamp(currentTime - clip.startTime, 0, clip.duration);
      const hasKeyframes = !!(clip.keyframes && clip.keyframes.length);
      dragKeyframesRef.current = hasKeyframes ? [...clip.keyframes!] : null;
      setDragState({
        mode: 'corner',
        id: clip.id,
        cornerIndex: i,
        startX: event.clientX,
        startY: event.clientY,
        startVals,
        startCorners,
        hasKeyframes,
        localTime,
        objectWidth: rect.width,
        objectHeight: rect.height,
        mirrored: !!clip.mirrored,
      });
    }}
  />
))}
                 </>
               )}
            </div>
          </div>
        );
      })}
    </div>
  );
}