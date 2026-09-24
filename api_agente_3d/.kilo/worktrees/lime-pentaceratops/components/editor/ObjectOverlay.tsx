'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ObjectClip, ObjectKeyframe } from '@/types';
import { getObjectOpacityAtTime, getObjectValuesAtTime, ObjectValuesAtTime, defaultCorners } from '@/lib/object-keyframes';
import { computeHomography, homographyToMatrix3d } from '@/lib/homography';
import ObjectVideo from '@/components/editor/ObjectVideo';

interface ObjectOverlayProps {
  objectClips: ObjectClip[];
  currentTime: number;
  selectedObjectId?: string | null;
  onSelectObject?: (id: string | null) => void;
  onUpdateObjectClip?: (id: string, updates: Partial<ObjectClip>) => void;
  playerZoom?: number;
  /** Si true (reproduciendo), los objetos fuera de su rango [startTime, startTime+duration)
   *  NO se muestran ni siquiera estando seleccionados. En pausa el seleccionado sí se
   *  mantiene visible fuera de rango para poder editarlo. */
  isPlaying?: boolean;
}

type DragState = {
  mode: 'move';
  id: string;
  startX: number;
  startY: number;
  startVals: ObjectValuesAtTime;
  hasKeyframes: boolean;
  localTime: number;
} | {
  mode: 'resize';
  id: string;
  startX: number;
  startVals: ObjectValuesAtTime;
  hasKeyframes: boolean;
  localTime: number;
  containerWidth: number;
} | {
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
} | null;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Calcula el transform CSS (matrix3d) a partir de los 4 corners en ±50.
 * Aplica una homografía REAL (no una simulación 3D): cada esquina de la
 * imagen queda EXACTAMENTE en la posición del vértice correspondiente, de
 * modo que al mover un vértice la esquina de la imagen se mueve con él.
 *   corners: 0 sup-izq, 1 sup-der, 2 inf-der, 3 inf-izq (en ±50, centro = 0)
 *   W,H: tamaño renderizado del objeto en píxeles
 * Con valores por defecto (±50) el transform es identidad.
 */
const getCornersTransform = (
  corners: { x: number; y: number }[],
  W: number,
  H: number,
  mirrored = false,
): { transform: string; transformOrigin: string } => {
  if (!W || !H) return { transform: 'none', transformOrigin: '0 0' };
  // Con espejo, se intercambia la paramétrica horizontal del origen: la esquina
  // sup-izq de la imagen cae en el vértice sup-der (y viceversa), de modo que el
  // objeto se voltea pero los 4 handles de deformación quedan pegados a sus
  // esquinas visuales. La imagen sigue deformándose igual.
  const src: [number, number][] = mirrored
    ? [
        [W, 0], [0, 0], [0, H], [W, H],
      ]
    : [
        [0, 0], [W, 0], [W, H], [0, H],
      ];
  const dst: [number, number][] = corners.map((c) => [
    ((50 + c.x) / 100) * W,
    ((50 + c.y) / 100) * H,
  ]) as [number, number][];
  const h = computeHomography(src, dst);
  if (!h) return { transform: 'none', transformOrigin: '0 0' };
  return { transform: homographyToMatrix3d(h), transformOrigin: '0 0' };
};

export default function ObjectOverlay({
  objectClips,
  currentTime,
  selectedObjectId,
  onSelectObject,
  onUpdateObjectClip,
  playerZoom = 100,
  isPlaying = false,
}: ObjectOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  // Modo de deformación por vértices (corner handles). Tab cicla:
  //  - 'width':  arrastrar un vértice solo varía el ancho (coordenada x).
  //  - 'height': arrastrar un vértice solo varía el alto  (coordenada y).
  //  - 'both':   arrastrar un vértice varía x e y libremente (modo original).
  const [cornerResizeMode, setCornerResizeMode] = useState<'width' | 'height' | 'both'>('both');
  // Set de keyframes "vivo" durante un arrastre: evita duplicar keyframes en
  // cada mousemove y permite encadenar upserts sobre el conjunto anterior.
  const dragKeyframesRef = useRef<ObjectKeyframe[] | null>(null);

  // Atajo de teclado: Tab cambia el modo de deformación de los vértices.
  // Ciclo: width → height → both → width. Se previene el foco del DOM.
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

  // Tamaño del área de overlay (para convertir % → px en la homografía) y
  // relación de aspecto por objeto (para deducir la altura renderizada).
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });
  const [aspectMap, setAspectMap] = useState<Record<string, number>>({});

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setOverlaySize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        // Delta en porcentaje del objeto (coordenadas 0-100)
        const dx = ((event.clientX - dragState.startX) / dragState.objectWidth) * 100;
        const dy = ((event.clientY - dragState.startY) / dragState.objectHeight) * 100;
        const nextCorners = dragState.startCorners.map((c, i) => {
          if (i !== dragState.cornerIndex) return { ...c };
          // 'width' → solo x; 'height' → solo y; 'both' → x e y juntos (original).
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
      // Sin keyframes: move/resize editan los valores base (comportamiento
      // original). EXCEPCIÓN 'corner' (vértices): SIEMPRE upserta un keyframe en
      // el instante local actual — cada arrastre de vértice queda fijado en ese
      // momento del tiempo; 1 solo keyframe = deformación estática, 2+ = animada
      // (la capa se deforma de un lado al otro entre los keyframes).
      if (!state.hasKeyframes && state.mode !== 'corner') {
        if (state.mode === 'move') {
          onUpdateObjectClip!(state.id, {
            position: { x: partial.x ?? state.startVals.x, y: partial.y ?? state.startVals.y },
          });
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
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    const ar = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 0;
                    if (ar > 0) {
                      setAspectMap((m) => (m[clip.id] === ar ? m : { ...m, [clip.id]: ar }));
                    }
                  }}
                  style={{
                    opacity: getObjectOpacityAtTime(clip, currentTime),
                    ...getCornersTransform(
                      vals.corners ?? clip.corners ?? defaultCorners(),
                      overlaySize.width > 0 ? (vals.width / 100) * overlaySize.width : 0,
                      vals.height !== undefined
                        ? (overlaySize.height > 0 ? (vals.height / 100) * overlaySize.height : ((vals.width / 100) * overlaySize.width) / (aspectMap[clip.id] ?? 1))
                        : (aspectMap[clip.id] ? ((vals.width / 100) * overlaySize.width) / aspectMap[clip.id] : 0),
                      !!clip.mirrored,
                    ),
                  }}
                />
              ) : (
                <img
                  src={clip.src}
                  alt={clip.name}
                  draggable={false}
                  className="block w-full h-auto object-contain pointer-events-none"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    const ar = img.naturalWidth / img.naturalHeight;
                    if (Number.isFinite(ar) && ar > 0) {
                      setAspectMap((m) => (m[clip.id] === ar ? m : { ...m, [clip.id]: ar }));
                    }
                  }}
                  style={{
                    opacity: getObjectOpacityAtTime(clip, currentTime),
                    ...getCornersTransform(
                      vals.corners ?? clip.corners ?? defaultCorners(),
                      overlaySize.width > 0 ? (vals.width / 100) * overlaySize.width : 0,
                      vals.height !== undefined
                        ? (overlaySize.height > 0 ? (vals.height / 100) * overlaySize.height : ((vals.width / 100) * overlaySize.width) / (aspectMap[clip.id] ?? 1))
                        : (aspectMap[clip.id] ? ((vals.width / 100) * overlaySize.width) / aspectMap[clip.id] : 0),
                      !!clip.mirrored,
                    ),
                  }}
                />
              )}
              {isSelected && onUpdateObjectClip && (
                <>
                  {/* Resize handle en el borde derecho */}
                  <button
                    type="button"
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-8 bg-blue-500 border border-white shadow-lg cursor-ew-resize pointer-events-auto z-10"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const container = containerRef.current;
                      const objectEl = event.currentTarget.parentElement;
                      if (!container || !objectEl) return;
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
                    // corners en ±50 → left = 50 + corner.x, top = 50 + corner.y
                    // ±50 mapea a 0% y 100%, colocando los handles en las esquinas
                    left: `${50 + corner.x}%`,
                    top: `${50 + corner.y}%`,
                    cursor: i === 0 || i === 2 ? 'nwse-resize' : 'nesw-resize',
                    // Compensar el zoom del reproductor: el handle no debe escalar
                    transform: `translate(-50%, -50%) scale(${playerZoom ? 100 / playerZoom : 1})`,
                  }}
                  // Feedback visual del modo de deformación:
                  //  - width:  el handle se tiñe azul y solo varía horizontalmente.
                  //  - height: el handle se tiñe ámbar y solo varía verticalmente.
                  title={`Vértice ${i + 1} — Modo ${cornerResizeMode === 'width' ? 'ANCHO (x)' : cornerResizeMode === 'height' ? 'ALTO (y)' : 'LIBRE (x+y)'}. Cambia con Tab`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const objectEl = event.currentTarget.parentElement;
                    if (!objectEl) return;
                    const rect = objectEl.getBoundingClientRect();
                    const startVals = getObjectValuesAtTime(clip, currentTime);
                    const startCorners = (startVals.corners ?? clip.corners ?? defaultCorners()).map(c => ({ ...c }));
                    const localTime = clamp(currentTime - clip.startTime, 0, clip.duration);
                    const hasKeyframes = !!(clip.keyframes && clip.keyframes.length);
                    // 'corner' SIEMPRE crea/actualiza un keyframe: sin keyframes
                    // arranca de una lista vacía (el primer arrastre crea el 1.er
                    // keyframe en este instante).
                    dragKeyframesRef.current = hasKeyframes ? [...clip.keyframes!] : [];
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