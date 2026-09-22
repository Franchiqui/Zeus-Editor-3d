'use client';

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { FC } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  Play,
  Pause,
  Square,
  SkipBack,
  X,
  Trash2,
  Plus,
  Film,
  CircleDot,
  Eye,
  EyeOff,
  RotateCcw,
  AlertTriangle,
  FolderOpen,
  Unlink,
} from 'lucide-react';
import {
  EASING_OPTIONS,
  EasingFunction,
  PluginParamTrack,
  PluginParamKeyframe,
  TransformProperty,
  TransformTrack,
  TRANSFORM_PROPERTY_LABELS,
  createPluginParamTrack,
  createTransformTrack,
  createGroupTransformTrack,
  diffTransform,
  evaluatePluginParamTrack,
  motionMaxDuration,
  upsertKeyframeAt,
} from '@/lib/animation';
import { cloneMesh } from '@/lib/plugins/clone';
import type { Mesh } from '@/lib/geometry';
import {
  listarPlugins,
  suscribirsePlugins,
  obtenerPlugin,
  type PluginParams,
} from '@/lib/plugins';
import { useI18n } from '@/lib/i18n';

/** Objeto de escena reducido a lo que el editor de movimiento necesita. */
export interface MotionEditorObject {
  id: string;
  name?: string;
  hidden?: boolean;
  transform: Record<TransformProperty, number>;
}

export interface MotionEditorProps {
  sceneObjects: MotionEditorObject[];
  selectedObjectId: string | null;
  onSelectObject: (id: string) => void;
  /**
   * Grupos de objetos creados en la escena. Permiten animar varios
   * objetos a la vez desde el editor de movimiento.
   */
  groups: Array<{ id: string; name: string; objectIds: string[] }>;
  transformTracks: TransformTrack[];
  setTransformTracks: (tracks: TransformTrack[]) => void;
  pluginTracks: PluginParamTrack[];
  setPluginTracks: (tracks: PluginParamTrack[]) => void;
  /** Malla base congelada por objectId (para animar parámetros de plugin). */
  pluginBaseMeshes: Record<string, Mesh>;
  setPluginBaseMeshes: Dispatch<SetStateAction<Record<string, Mesh>>>;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  currentTime: number;
  setCurrentTime: (t: number) => void;
  autoKey: boolean;
  setAutoKey: (v: boolean) => void;
  /** Recorrido editable del objeto seleccionado visible en el visor. */
  showMotionPath: boolean;
  setShowMotionPath: (v: boolean) => void;
  /**
   * Devuelve el objeto a su transform estático y borra TODAS sus pistas
   * (transformada y plugin) y su malla base congelada.
   */
  onRestoreObject: (objectId: string) => void;
  /**
   * Devuelve la malla base del objeto (obj.mesh o la triMesh del dueño),
   * con la misma regla que Editor3D.handleApplyPlugin. No mutar.
   */
  resolverMallaBase: (objectId: string) => Mesh | null;
  /** Altura en px del editor (se controla arrastrando el separador). */
  height?: number;
  onClose: () => void;
}

const MIN_PX_PER_SECOND = 40;
const MAX_PX_PER_SECOND = 400;
const ROW_HEIGHT = 28;

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const mm = Math.floor(s / 60);
  const rest = s - mm * 60;
  const ss = Math.floor(rest);
  const cs = Math.floor((rest - ss) * 100);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Editor de movimiento: línea de tiempo + pistas de transformada y de
 * parámetros de plugin. Componente controlado puro (todo el estado de
 * escena vive en Editor3D); ocupa la franja inferior del área principal
 * cuando está activo.
 */
export const MotionEditor: FC<MotionEditorProps> = ({
  sceneObjects,
  selectedObjectId,
  onSelectObject,
  groups,
  transformTracks,
  setTransformTracks,
  pluginTracks,
  setPluginTracks,
  pluginBaseMeshes,
  setPluginBaseMeshes,
  playing,
  setPlaying,
  currentTime,
  setCurrentTime,
  autoKey,
  setAutoKey,
  showMotionPath,
  setShowMotionPath,
  onRestoreObject,
  resolverMallaBase,
  height,
  onClose,
}) => {
  const { t } = useI18n();
  const plugins = useSyncExternalStore(
    suscribirsePlugins,
    listarPlugins,
    listarPlugins
  );

  const [pxPerSecond, setPxPerSecond] = useState(80);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedKeyframeTime, setSelectedKeyframeTime] = useState<number | null>(null);
  const [pluginId, setPluginId] = useState<string>('');
  const [paramId, setParamId] = useState<string>('');
  const [selectedObjectGroupId, setSelectedObjectGroupId] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  // Arrastre en curso: { pista, time original del kf } → time flotante local.
  const dragRef = useRef<{ trackId: string; originalTime: number; kind: 'transform' | 'plugin' } | null>(null);
  const [dragTime, setDragTime] = useState<number | null>(null);
  // `dragTime` en el closure de `up` quedaría obsoleto: se lee vía ref.
  const dragTimeRef = useRef<number | null>(null);
  dragTimeRef.current = dragTime;

  const globalDuration = Math.max(5, motionMaxDuration(transformTracks, pluginTracks));
  const timelineWidth = globalDuration * pxPerSecond;

  const visibleObjects = useMemo(
    () => sceneObjects.filter((o) => !o.hidden),
    [sceneObjects]
  );

  const trackOfObject = useMemo(() => {
    const map = new Map<string, { t: number; p: number }>();
    for (const tr of transformTracks) {
      const e = map.get(tr.objectId) ?? { t: 0, p: 0 };
      e.t += tr.keyframes.length;
      map.set(tr.objectId, e);
    }
    for (const tr of pluginTracks) {
      const e = map.get(tr.objectId) ?? { t: 0, p: 0 };
      e.p += tr.keyframes.length;
      map.set(tr.objectId, e);
    }
    return map;
  }, [transformTracks, pluginTracks]);

  const plugin = pluginId ? obtenerPlugin(pluginId) : undefined;
  const animatableParams = useMemo(
    () => (plugin ? plugin.params.filter((p) => p.tipo === 'slider') : []),
    [plugin]
  );
  const selectedParam = animatableParams.find((p) => p.id === paramId);

  // ------------------------------------------------------------- transporte

  const togglePlay = useCallback(() => setPlaying(!playing), [playing, setPlaying]);

  const stop = useCallback(() => {
    setPlaying(false);
    setCurrentTime(0);
  }, [setPlaying, setCurrentTime]);

  // --------------------------------------------------------------- pistas

  const updateTransformTrack = (id: string, patch: Partial<TransformTrack>) => {
    setTransformTracks(transformTracks.map((tr) => (tr.id === id ? { ...tr, ...patch } : tr)));
  };

  const updatePluginTrack = (id: string, patch: Partial<PluginParamTrack>) => {
    setPluginTracks(pluginTracks.map((tr) => (tr.id === id ? { ...tr, ...patch } : tr)));
  };

  const deleteTrack = (id: string) => {
    setTransformTracks(transformTracks.filter((tr) => tr.id !== id));
    setPluginTracks(pluginTracks.filter((tr) => tr.id !== id));
    if (selectedTrackId === id) {
      setSelectedTrackId(null);
      setSelectedKeyframeTime(null);
    }
  };

  /** Añade fotograma en currentTime a la pista seleccionada. */
  const addKeyframeAtCurrentTime = () => {
    if (!selectedTrackId) return;
    const tTrack = transformTracks.find((tr) => tr.id === selectedTrackId);
    if (tTrack) {
      const objeto = sceneObjects.find((o) => o.id === tTrack.objectId);
      const actual = objeto?.transform;
      const primerKf = tTrack.keyframes[0];
      // Values: props cuyo valor difiere del fotograma t=0 (o todas si
      // aún no hay fotograma inicial).
      const base = primerKf?.values ?? {};
      const values = actual
        ? diffTransform(
            {
              px: base.px ?? actual.px, py: base.py ?? actual.py, pz: base.pz ?? actual.pz,
              rx: base.rx ?? actual.rx, ry: base.ry ?? actual.ry, rz: base.rz ?? actual.rz,
              sx: base.sx ?? actual.sx, sy: base.sy ?? actual.sy, sz: base.sz ?? actual.sz,
            },
            actual
          )
        : {};
      const nuevo = { time: currentTime, values, easing: 'linear' as EasingFunction };
      updateTransformTrack(tTrack.id, {
        keyframes: upsertKeyframeAt(tTrack.keyframes, nuevo),
        duration: Math.max(tTrack.duration, currentTime),
      });
      setSelectedKeyframeTime(currentTime);
      return;
    }
    const pTrack = pluginTracks.find((tr) => tr.id === selectedTrackId);
    if (pTrack) {
      // El fotograma nuevo nace con el valor que la animación YA tiene
      // aquí (interpolado): añadirlo no cambia nada hasta que el usuario
      // ajuste su valor en el inspector — es fijar la pose actual.
      const valorInterp = evaluatePluginParamTrack(pTrack, currentTime);
      const pluginDef = obtenerPlugin(pTrack.pluginId);
      const paramDef = pluginDef?.params.find((p) => p.id === pTrack.paramId);
      const kf: PluginParamKeyframe = {
        time: currentTime,
        value:
          valorInterp ??
          (typeof paramDef?.valor === 'number' ? paramDef.valor : 0),
        easing: 'linear',
      };
      updatePluginTrack(pTrack.id, {
        keyframes: upsertKeyframeAt(pTrack.keyframes, kf),
        duration: Math.max(pTrack.duration, currentTime),
      });
      setSelectedKeyframeTime(currentTime);
    }
  };

  /** Crea la pista de parámetro de plugin desde el panel izquierdo. */
  const addPluginTrack = () => {
    if (!plugin || !selectedParam) return;

    // Objeto(s) objetivo: grupo o seleccion individual
    let targetIds: string[];
    if (selectedObjectGroupId) {
      const group = groups.find((g) => g.id === selectedObjectGroupId);
      if (!group) return;
      targetIds = group.objectIds
        .map((id) => sceneObjects.find((o) => o.id === id))
        .filter((o): o is MotionEditorObject => !!o && !o.hidden)
        .map((o) => o.id);
    } else {
      if (!selectedObjectId) return;
      targetIds = [selectedObjectId];
    }
    if (targetIds.length === 0) return;

    // Congelar la malla base para objetos que aún no la tienen
    const baseMeshesToAdd: Record<string, Mesh> = {};
    const validIds = targetIds.filter((oid) => {
      if (pluginBaseMeshes[oid]) return true;
      const base = resolverMallaBase(oid);
      if (base) {
        baseMeshesToAdd[oid] = cloneMesh(base);
        return true;
      }
      return false;
    });
    if (Object.keys(baseMeshesToAdd).length > 0) {
      setPluginBaseMeshes((prev) => ({ ...prev, ...baseMeshesToAdd }));
    }
    if (validIds.length === 0) return;

    const yaFiltrados = validIds.filter(
      (oid) =>
        !pluginTracks.some(
          (tr) => tr.objectId === oid && tr.pluginId === plugin.id && tr.paramId === selectedParam.id
        )
    );
    if (yaFiltrados.length === 0) return;

    // El efecto NACE en su valor mínimo (Disolver 0 % = intacto) y llega
    // al valor por defecto al final de la pista: así la reproducción ya
    // muestra progresión sin tocar nada, en vez de nacer medio disuelto.
    const esSlider = selectedParam.tipo === 'slider';
    const valorMin = esSlider && typeof selectedParam.min === 'number' ? selectedParam.min : 0;
    const valorDef = typeof selectedParam.valor === 'number' ? selectedParam.valor : 0;

    const nuevas: PluginParamTrack[] = yaFiltrados.map((oid) => {
      const track = createPluginParamTrack(
        oid,
        plugin.id,
        selectedParam.id,
        valorMin,
        Math.max(5, currentTime)
      );
      // Fotograma inicial en 0 s con el valor mínimo…
      track.keyframes = upsertKeyframeAt(track.keyframes, {
        time: 0,
        value: valorMin,
        easing: 'linear',
      });
      // …y el valor por defecto al final de la pista.
      track.keyframes = upsertKeyframeAt(track.keyframes, {
        time: track.duration,
        value: valorDef,
        easing: 'linear',
      });
      return track;
    });

    setPluginTracks([...pluginTracks, ...nuevas]);
    setSelectedTrackId(nuevas[0].id);
    setSelectedKeyframeTime(0);
  };

  /** Crea pista(s) de transformada del(los) objeto(s) seleccionado(s). */
  const addTransformTrack = () => {
    let targetIds: string[];
    if (selectedObjectGroupId) {
      const group = groups.find((g) => g.id === selectedObjectGroupId);
      if (!group) return;
      targetIds = group.objectIds
        .map((id) => sceneObjects.find((o) => o.id === id))
        .filter((o): o is MotionEditorObject => !!o && !o.hidden)
        .map((o) => o.id);
    } else {
      if (!selectedObjectId) return;
      targetIds = [selectedObjectId];
    }
    if (targetIds.length === 0) return;

    const nuevas: TransformTrack[] = [];
    for (const oid of targetIds) {
      if (transformTracks.some((tr) => tr.objectId === oid)) continue;
      const objeto = sceneObjects.find((o) => o.id === oid);
      if (!objeto) continue;
      nuevas.push(createTransformTrack(oid, objeto.transform, Math.max(5, currentTime)));
    }
    if (nuevas.length === 0) return;
    setTransformTracks([...transformTracks, ...nuevas]);
    setSelectedTrackId(nuevas[0].id);
  };

  /** Fuse un grupo de objetos en una única pista de transformación compartida. */
  const mergeGroupToTrack = () => {
    if (!selectedObjectGroupId) return;
    const group = groups.find((g) => g.id === selectedObjectGroupId);
    if (!group) return;
    const groupObjs = group.objectIds
      .map((id) => sceneObjects.find((o) => o.id === id))
      .filter((o): o is MotionEditorObject => !!o && !o.hidden);
    if (groupObjs.length === 0) return;

    const memberIds = groupObjs.map((o) => o.id);
    const memberIdSet = new Set(memberIds);

    // Reemplazar pistas individuales de los miembros por una sola pista de grupo
    const remaining = transformTracks.filter(
      (tr) => !memberIdSet.has(tr.objectId) && !(tr.objectIds && tr.objectIds.some((id) => memberIdSet.has(id)))
    );

    const track = createGroupTransformTrack(
      memberIds,
      groupObjs[0].transform,
      Math.max(5, currentTime)
    );
    setTransformTracks([...remaining, track]);
    setSelectedTrackId(track.id);
    setSelectedKeyframeTime(0);
    setSelectedObjectGroupId(null);
  };

  /** Desvincula una pista de grupo: la reemplaza por pistas individuales. */
  const unmergeGroupTrack = (trackId: string) => {
    const groupTrack = transformTracks.find((tr) => tr.id === trackId);
    if (!groupTrack || !groupTrack.objectIds) return;

    const allIds = [groupTrack.objectId, ...(groupTrack.objectIds ?? [])];
    const memberIdSet = new Set(allIds);
    const newTracks: TransformTrack[] = [];

    for (const oid of allIds) {
      if (transformTracks.some((tr) => tr.id !== trackId && tr.objectId === oid)) continue;
      const obj = sceneObjects.find((o) => o.id === oid);
      if (!obj) continue;
      const track = createTransformTrack(oid, obj.transform, groupTrack.duration);
      track.keyframes = groupTrack.keyframes.map((kf) => ({ ...kf }));
      track.looping = groupTrack.looping;
      newTracks.push(track);
    }

    setTransformTracks(
      transformTracks.filter((tr) => tr.id !== trackId).concat(newTracks)
    );
    setSelectedTrackId(newTracks[0]?.id ?? null);
    setSelectedKeyframeTime(0);
  };

  // ------------------------------------------------------------ timeline UI

  const clampTime = (sec: number) => Math.min(Math.max(0, sec), globalDuration);

  const timeFromEvent = useCallback(
    (clientX: number) => {
      const el = timelineRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return clampTime((clientX - rect.left) / pxPerSecond);
    },
    [pxPerSecond, globalDuration] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const beginScrub = (e: React.PointerEvent) => {
    setCurrentTime(timeFromEvent(e.clientX));
    const move = (ev: PointerEvent) => setCurrentTime(timeFromEvent(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Empieza a arrastrar un diamante: mueve un time flotante local. */
  const beginKeyframeDrag = (
    e: React.PointerEvent,
    trackId: string,
    kfTime: number,
    kind: 'transform' | 'plugin'
  ) => {
    e.stopPropagation();
    dragRef.current = { trackId, originalTime: kfTime, kind };
    setDragTime(kfTime);
    const move = (ev: PointerEvent) => setDragTime(timeFromEvent(ev.clientX));
    const up = () => {
      const drag = dragRef.current;
      const nuevoTime = dragTimeRef.current;
      dragRef.current = null;
      setDragTime(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!drag || nuevoTime === null) return;
      commitKeyframeDrag(drag.trackId, drag.originalTime, nuevoTime, drag.kind);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Reubica el fotograma: upsert en el nuevo time y borra el original. */
  const commitKeyframeDrag = (
    trackId: string,
    originalTime: number,
    newTime: number,
    kind: 'transform' | 'plugin'
  ) => {
    if (Math.abs(newTime - originalTime) < 1e-4) return;
    if (kind === 'transform') {
      const tr = transformTracks.find((t) => t.id === trackId);
      if (!tr) return;
      const kf = tr.keyframes.find((k) => Math.abs(k.time - originalTime) < 1e-4);
      if (!kf) return;
      const resto = tr.keyframes.filter((k) => Math.abs(k.time - originalTime) >= 1e-4);
      updateTransformTrack(trackId, {
        keyframes: upsertKeyframeAt(resto, { ...kf, time: newTime }),
        duration: Math.max(tr.duration, newTime),
      });
    } else {
      const tr = pluginTracks.find((t) => t.id === trackId);
      if (!tr) return;
      const kf = tr.keyframes.find((k) => Math.abs(k.time - originalTime) < 1e-4);
      if (!kf) return;
      const resto = tr.keyframes.filter((k) => Math.abs(k.time - originalTime) >= 1e-4);
      updatePluginTrack(trackId, {
        keyframes: upsertKeyframeAt(resto, { ...kf, time: newTime }),
        duration: Math.max(tr.duration, newTime),
      });
    }
    setSelectedKeyframeTime(newTime);
  };

  const deleteKeyframe = (trackId: string, kfTime: number, kind: 'transform' | 'plugin') => {
    if (kind === 'transform') {
      const tr = transformTracks.find((t) => t.id === trackId);
      if (!tr) return;
      updateTransformTrack(trackId, {
        keyframes: tr.keyframes.filter((k) => Math.abs(k.time - kfTime) >= 1e-4),
      });
    } else {
      const tr = pluginTracks.find((t) => t.id === trackId);
      if (!tr) return;
      updatePluginTrack(trackId, {
        keyframes: tr.keyframes.filter((k) => Math.abs(k.time - kfTime) >= 1e-4),
      });
    }
    if (selectedKeyframeTime === kfTime) setSelectedKeyframeTime(null);
  };

  const setKeyframeEasing = (
    trackId: string,
    kfTime: number,
    easing: EasingFunction,
    kind: 'transform' | 'plugin'
  ) => {
    if (kind === 'transform') {
      const tr = transformTracks.find((t) => t.id === trackId);
      if (!tr) return;
      updateTransformTrack(trackId, {
        keyframes: tr.keyframes.map((k) =>
          Math.abs(k.time - kfTime) < 1e-4 ? { ...k, easing } : k
        ),
      });
    } else {
      const tr = pluginTracks.find((t) => t.id === trackId);
      if (!tr) return;
      updatePluginTrack(trackId, {
        keyframes: tr.keyframes.map((k) =>
          Math.abs(k.time - kfTime) < 1e-4 ? { ...k, easing } : k
        ),
      });
    }
  };

  const setKeyframeParamValue = (
    trackId: string,
    kfTime: number,
    value: number
  ) => {
    const tr = pluginTracks.find((tk) => tk.id === trackId);
    if (!tr) return;
    updatePluginTrack(trackId, {
      keyframes: tr.keyframes.map((k) =>
        Math.abs(k.time - kfTime) < 1e-4 ? { ...k, value } : k
      ),
    });
  };

  // Fotograma seleccionado (para el inspector bajo el timeline).
  const selectedTransformKf = useMemo(() => {
    if (!selectedTrackId || selectedKeyframeTime === null) return null;
    const tr = transformTracks.find((tk) => tk.id === selectedTrackId);
    return tr?.keyframes.find((k) => Math.abs(k.time - selectedKeyframeTime) < 1e-4) ?? null;
  }, [selectedTrackId, selectedKeyframeTime, transformTracks]);
  const selectedPluginKf = useMemo(() => {
    if (!selectedTrackId || selectedKeyframeTime === null) return null;
    const tr = pluginTracks.find((tk) => tk.id === selectedTrackId);
    return tr?.keyframes.find((k) => Math.abs(k.time - selectedKeyframeTime) < 1e-4) ?? null;
  }, [selectedTrackId, selectedKeyframeTime, pluginTracks]);

  const selectedTrack = transformTracks.find((tk) => tk.id === selectedTrackId)
    ?? pluginTracks.find((tk) => tk.id === selectedTrackId)
    ?? null;

  // Marcas de regla: paso adaptativo para no saturar con zoom bajo.
  const rulerStep = pxPerSecond >= 160 ? 0.25 : pxPerSecond >= 80 ? 0.5 : 1;
  const marks: number[] = [];
  for (let tt = 0; tt <= globalDuration + 1e-9; tt += rulerStep) {
    marks.push(Math.round(tt * 100) / 100);
  }

   const renderKeyframeRow = (
     track: TransformTrack | PluginParamTrack,
     kind: 'transform' | 'plugin'
   ) => {
     const isSel = track.id === selectedTrackId;
     const isGroupTrack =
       kind === 'transform' &&
       (track as TransformTrack).objectIds &&
       (track as TransformTrack).objectIds!.length > 0;
     const groupMemberCount = isGroupTrack
       ? (track as TransformTrack).objectIds!.length + 1
       : 0;
     return (
       <div
         key={track.id}
         className={`flex items-center border-t border-white/5 ${isSel ? 'bg-purple-500/10' : 'hover:bg-white/5'}`}
         style={{ height: ROW_HEIGHT }}
       >
         <div
           className="w-44 shrink-0 px-2 truncate text-[10px] cursor-pointer"
           onClick={() => { setSelectedTrackId(track.id); setSelectedKeyframeTime(null); }}
           title={kind === 'transform' ? t('editor3D.motion.transformTrack') : pluginTrackLabel(track as PluginParamTrack)}
         >
           {kind === 'transform' ? (
             <span
               className={`flex items-center gap-1 ${
                 isGroupTrack ? 'text-fuchsia-300' : 'text-sky-300'
               }`}
             >
               {isGroupTrack && <FolderOpen className="w-3 h-3" />}
               {isGroupTrack
                 ? `${t('editor3D.motion.groupTrack')} (${groupMemberCount})`
                 : t('editor3D.motion.transformTrack')}
             </span>
           ) : (
             <span className="text-emerald-300">{pluginTrackLabel(track as PluginParamTrack)}</span>
           )}
         </div>
         {isGroupTrack && (
           <button
             onClick={() => unmergeGroupTrack(track.id)}
             className="px-1 rounded hover:bg-white/10 text-fuchsia-300 shrink-0"
             title={t('editor3D.motion.unmergeGroup')}
           >
             <Unlink className="w-3 h-3" />
           </button>
         )}
         <div className="relative flex-1 h-full">
          {track.keyframes.map((kf) => {
            const shownTime = dragRef.current?.trackId === track.id && Math.abs(kf.time - dragRef.current.originalTime) < 1e-4 && dragTime !== null
              ? dragTime
              : kf.time;
            const isKfSel = isSel && selectedKeyframeTime !== null && Math.abs(kf.time - selectedKeyframeTime) < 1e-4;
            return (
              <button
                key={kf.time}
                onPointerDown={(e) => beginKeyframeDrag(e, track.id, kf.time, kind)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedTrackId(track.id);
                  setSelectedKeyframeTime(kf.time);
                }}
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rotate-45 border ${
                  isKfSel
                    ? 'bg-amber-300 border-amber-100'
                    : kind === 'transform'
                      ? 'bg-sky-400 border-sky-200 hover:bg-sky-300'
                      : 'bg-emerald-400 border-emerald-200 hover:bg-emerald-300'
                }`}
                style={{ left: shownTime * pxPerSecond }}
                title={`${formatTime(kf.time)}s`}
              />
            );
          })}
        </div>
      </div>
    );
  };

  const pluginTrackLabel = (track: PluginParamTrack): string => {
    const def = obtenerPlugin(track.pluginId);
    const param = def?.params.find((p) => p.id === track.paramId);
    const nombre = def?.nombre ?? track.pluginId;
    return param ? `${nombre} · ${param.etiqueta}` : nombre;
  };

  // Aviso: pistas de plugin cuyo aplicar() produce malla inválida en
  // algún valor animado (vacía o con coordenadas no finitas). Es lo que
  // hace que el objeto se vea negro o «desaparezca» al reproducir.
  const degenerateTracks = useMemo(() => {
    const out = new Set<string>();
    for (const tr of pluginTracks) {
      const def = obtenerPlugin(tr.pluginId);
      if (!def) continue;
      const base = pluginBaseMeshes[tr.objectId];
      if (!base) continue;
      for (const kf of tr.keyframes) {
        const params: PluginParams = {};
        for (const p of def.params) params[p.id] = p.valor;
        params[tr.paramId] = kf.value;
        try {
          const r = def.aplicar(base, params);
          const roto =
            !r || !r.vertices.length || !r.faces.length ||
            r.vertices.some(
              (vt) =>
                !isFinite(vt.x) || !isFinite(vt.y) || !isFinite(vt.z)
            );
          if (roto) {
            out.add(tr.id);
            break;
          }
        } catch {
          out.add(tr.id);
          break;
        }
      }
    }
    return out;
  }, [pluginTracks, pluginBaseMeshes]);

  return (
    <div
      className="border-t border-white/10 bg-background/95 text-xs flex"
      style={{ height: height ?? '40vh', flexShrink: 0 }}
      data-testid="motion-editor"
    >
      {/* Columna izquierda: objetos + animar plugin */}
      <div className="w-60 shrink-0 border-r border-white/10 flex flex-col custom-scrollbar overflow-y-auto">
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/10">
          <span className="font-semibold text-green-300 flex items-center gap-1">
            <Film className="w-3.5 h-3.5" />
            {t('editor3D.motion.menuTitle')}
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-red-500/20 text-red-300"
            title={t('editor3D.motion.close')}
            data-testid="close-motion-editor"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Objetos */}
        <div className="px-2 py-1.5">
          <div className="text-muted-foreground mb-1">{t('editor3D.motion.selectObject')}</div>
          <div className="flex flex-col gap-0.5">
            {visibleObjects.map((obj) => {
              const counts = trackOfObject.get(obj.id) ?? { t: 0, p: 0 };
              const activo = obj.id === selectedObjectId && !selectedObjectGroupId;
              return (
                <button
                  key={obj.id}
                  onClick={() => {
                    setSelectedObjectGroupId(null);
                    onSelectObject(obj.id);
                  }}
                  className={`flex items-center justify-between px-1.5 py-1 rounded text-left ${
                    activo ? 'bg-purple-500/20 text-purple-200' : 'hover:bg-white/5'
                  }`}
                >
                  <span className="truncate">{obj.name ?? obj.id}</span>
                  <span className="flex gap-0.5 shrink-0">
                    {counts.t > 0 && (
                      <span className="px-1 rounded bg-sky-500/20 text-sky-300 text-[9px]">T:{counts.t}</span>
                    )}
                    {counts.p > 0 && (
                      <span className="px-1 rounded bg-emerald-500/20 text-emerald-300 text-[9px]">P:{counts.p}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {selectedObjectId &&
            !selectedObjectGroupId &&
            !transformTracks.some((tr) => tr.objectId === selectedObjectId) && (
            <button
              onClick={addTransformTrack}
              className="mt-1.5 w-full px-2 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 flex items-center justify-center gap-1"
            >
              <Plus className="w-3 h-3" />
              {t('editor3D.motion.addTransformTrack')}
            </button>
          )}
        </div>

        {/* Grupos de objetos */}
        {groups.length > 0 && (
          <div className="px-2 py-1.5 border-t border-white/10">
            <div className="text-muted-foreground mb-1 flex items-center gap-1">
              <FolderOpen className="w-3 h-3" />
              {t('editor3D.objectGroups')}
            </div>
            <div className="flex flex-col gap-0.5">
              {groups.map((grp) => {
                const groupObjs = grp.objectIds
                  .map((id) => sceneObjects.find((o) => o.id === id))
                  .filter((o): o is MotionEditorObject => !!o && !o.hidden);
                const activo = grp.id === selectedObjectGroupId;
                const sinTrackT = groupObjs.filter(
                  (o) => !transformTracks.some((tr) => tr.objectId === o.id)
                ).length;
                if (groupObjs.length === 0) return null;
                return (
                  <button
                    key={grp.id}
                    onClick={() => setSelectedObjectGroupId(activo ? null : grp.id)}
                    className={`flex items-center justify-between px-1.5 py-1 rounded text-left ${
                      activo
                        ? 'bg-green-500/20 text-green-200'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <span className="truncate flex items-center gap-1">
                      <FolderOpen className="w-3 h-3" />
                      {grp.name}
                    </span>
                    <span className="flex gap-0.5 shrink-0">
                      <span className="text-[9px] text-muted-foreground">
                        {groupObjs.length}
                      </span>
                      {sinTrackT > 0 && (
                        <span className="px-1 rounded bg-sky-500/20 text-sky-300 text-[9px]">
                          +{sinTrackT}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedObjectGroupId && (
              (() => {
                const group = groups.find((g) => g.id === selectedObjectGroupId);
                if (!group) return null;
                const groupObjs = group.objectIds
                  .map((id) => sceneObjects.find((o) => o.id === id))
                  .filter((o): o is MotionEditorObject => !!o && !o.hidden);
                if (groupObjs.length === 0) return null;
                const sinTrackT = groupObjs.filter(
                  (o) => !transformTracks.some((tr) => tr.objectId === o.id)
                ).length;
                const hayGrupoTrack = transformTracks.some(
                  (tr) =>
                    tr.objectIds &&
                    tr.objectIds.some((id) => groupObjs.some((o) => o.id === id))
                );
                if (hayGrupoTrack || sinTrackT === 0) return null;
                return (
                  <button
                    onClick={mergeGroupToTrack}
                    className="mt-1.5 w-full px-2 py-1 rounded bg-fuchsia-500/20 hover:bg-fuchsia-500/30 text-fuchsia-300 flex items-center justify-center gap-1"
                  >
                    <FolderOpen className="w-3 h-3" />
                    {t('editor3D.motion.fuseGroup')}
                  </button>
                );
              })()
            )}
          </div>
        )}

        {/* Animar plugin */}
        <div className="px-2 py-1.5 border-t border-white/10">
          <div className="text-muted-foreground mb-1">{t('editor3D.motion.pluginSection')}</div>
          {/* Lista completa de plugins (nombre + descripción), como en el
              modal de plugins: un <select> solo deja ver el nombre y se
              corta con la columna estrecha. */}
          <div className="max-h-44 overflow-y-auto custom-scrollbar rounded border border-white/10 bg-black/30 mb-1">
            {plugins.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setPluginId(p.id); setParamId(''); }}
                className={`block w-full text-left px-2 py-1.5 border-b border-white/5 last:border-b-0 transition-colors ${
                  p.id === pluginId
                    ? 'bg-violet-500/20 text-violet-200'
                    : 'hover:bg-white/5 text-foreground'
                }`}
              >
                <span className="block font-semibold">{p.nombre}</span>
                <span className="block text-[10px] opacity-70">{p.descripcion}</span>
              </button>
            ))}
          </div>
          {plugin && (
            animatableParams.length === 0 ? (
              <div className="text-[10px] text-amber-300/80 mb-1">{t('editor3D.motion.noAnimatableParams')}</div>
            ) : (
              <>
                <select
                  value={paramId}
                  onChange={(e) => setParamId(e.target.value)}
                  className="w-full px-1.5 py-1 rounded bg-black/30 border border-white/10 text-foreground mb-1"
                >
                  <option value="">{t('editor3D.motion.pickParam')}</option>
                  {animatableParams.map((p) => (
                    <option key={p.id} value={p.id}>{p.etiqueta}</option>
                  ))}
                </select>
                 <button
                   onClick={addPluginTrack}
                   disabled={
                     !selectedParam ||
                     (!selectedObjectId && !selectedObjectGroupId)
                   }
                   className="w-full px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                 >
                   <Plus className="w-3 h-3" />
                   {selectedObjectGroupId
                     ? (() => {
                         const group = groups.find((g) => g.id === selectedObjectGroupId);
                         if (!group) return t('editor3D.motion.addPluginTrack');
                         const groupObjs = group.objectIds
                           .map((id) => sceneObjects.find((o) => o.id === id))
                           .filter(
                             (o): o is MotionEditorObject => !!o && !o.hidden
                           );
                         const sinTrack = groupObjs.filter(
                           (o) =>
                             !pluginTracks.some(
                               (tr) =>
                                 tr.objectId === o.id &&
                                 tr.pluginId === plugin?.id &&
                                 tr.paramId === selectedParam?.id
                             )
                         ).length;
                         return t('editor3D.motion.addPluginTracks', { count: sinTrack });
                       })()
                     : t('editor3D.motion.addPluginTrack')}
                </button>
              </>
            )
          )}
          {pluginId && (
            <div className="text-[10px] text-muted-foreground mt-1">{t('editor3D.motion.baseMeshHint')}</div>
          )}

          {/* Restaurar objeto: transform estático de vuelta y borrar sus
              pistas. Para recuperarse de un plugin deformado a lo loco. */}
          {selectedObjectId &&
            (transformTracks.some((tk) => tk.objectId === selectedObjectId) ||
              pluginTracks.some((tk) => tk.objectId === selectedObjectId)) && (
            <button
              onClick={() => selectedObjectId && onRestoreObject(selectedObjectId)}
              data-testid="motion-restore-object"
              className="mt-2 w-full px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 flex items-center justify-center gap-1"
              title={t('editor3D.motion.restoreObject')}
            >
              <RotateCcw className="w-3 h-3" />
              {t('editor3D.motion.restoreObject')}
            </button>
          )}
        </div>
      </div>

      {/* Zona derecha: transporte + timeline */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Transporte */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/10 flex-wrap">
          <button onClick={() => setCurrentTime(0)} className="p-1.5 rounded hover:bg-white/10" title={t('editor3D.motion.goToStart')}>
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={togglePlay}
            data-testid="motion-play-btn"
            className={`p-1.5 rounded ${playing ? 'bg-green-500/20 text-green-300' : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300'}`}
            title={playing ? t('editor3D.motion.pause') : t('editor3D.motion.play')}
          >
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <button onClick={stop} className="p-1.5 rounded hover:bg-red-500/20 text-red-300" title={t('editor3D.motion.stop')}>
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={() => setShowMotionPath(!showMotionPath)}
            data-testid="motion-path-toggle"
            className={`p-1.5 rounded ${
              showMotionPath
                ? 'bg-red-500/20 text-red-300'
                : 'text-muted-foreground hover:bg-white/10'
            }`}
            title={showMotionPath ? t('editor3D.motion.hidePath') : t('editor3D.motion.showPath')}
          >
            {showMotionPath ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
          <span className="px-1.5 py-0.5 rounded bg-black/30 font-mono text-[11px]" data-testid="motion-time-display">
            {formatTime(currentTime)}
          </span>

          <button
            onClick={() => setAutoKey(!autoKey)}
            data-testid="autokey-toggle"
            className={`px-2 py-1 rounded flex items-center gap-1 font-medium ${
              autoKey
                ? 'bg-red-500/30 text-red-200'
                : 'bg-white/5 text-muted-foreground hover:text-foreground'
            }`}
            title={autoKey ? t('editor3D.motion.autoKeyOn') : t('editor3D.motion.autoKeyOff')}
          >
            <CircleDot className={`w-3 h-3 ${autoKey ? 'text-red-400 animate-pulse' : ''}`} />
            {t('editor3D.motion.autoKey')}
          </button>

          {selectedTrack && (
            <>
              <label className="text-muted-foreground ml-2">{t('editor3D.motion.duration')}</label>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={selectedTrack.duration}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0.1;
                  if (transformTracks.some((tk) => tk.id === selectedTrack.id)) {
                    updateTransformTrack(selectedTrack.id, { duration: v });
                  } else {
                    updatePluginTrack(selectedTrack.id, { duration: v });
                  }
                }}
                className="w-16 px-1 py-0.5 rounded bg-black/30 border border-white/10 text-foreground"
              />
              <label className="flex items-center gap-1 text-muted-foreground">
                <input
                  type="checkbox"
                  checked={selectedTrack.looping}
                  onChange={() => {
                    if (transformTracks.some((tk) => tk.id === selectedTrack.id)) {
                      updateTransformTrack(selectedTrack.id, { looping: !selectedTrack.looping });
                    } else {
                      updatePluginTrack(selectedTrack.id, { looping: !selectedTrack.looping });
                    }
                  }}
                />
                {t('editor3D.motion.looping')}
              </label>
            </>
          )}

          {selectedTrackId && (
            <button
              onClick={() => selectedTrackId && deleteTrack(selectedTrackId)}
              className="p-1.5 rounded hover:bg-red-500/20 text-red-300 ml-auto"
              title={t('editor3D.motion.deleteTrack')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          <label className="text-muted-foreground ml-auto flex items-center gap-1">
            Zoom
            <input
              type="range"
              min={MIN_PX_PER_SECOND}
              max={MAX_PX_PER_SECOND}
              step={10}
              value={pxPerSecond}
              onChange={(e) => setPxPerSecond(parseInt(e.target.value, 10))}
              className="w-24"
            />
          </label>
        </div>

        {/* Timeline */}
        <div className="flex-1 min-h-0 flex flex-col custom-scrollbar overflow-auto">
          <div className="flex" style={{ minWidth: timelineWidth + 176 }}>
            {/* Columna de etiquetas fija + área deslizable compartida */}
            <div className="w-44 shrink-0 border-r border-white/10">
              <div className="h-7 border-b border-white/10 flex items-center px-2 text-muted-foreground">
                {t('editor3D.motion.time')}
              </div>
              {transformTracks.map((tr) => (
                <div key={tr.id} className="border-t border-white/5 flex items-center px-2" style={{ height: ROW_HEIGHT }}>
                  <span className="text-[10px] text-sky-300 truncate">
                    {sceneObjects.find((o) => o.id === tr.objectId)?.name ?? tr.objectId}
                  </span>
                </div>
              ))}
              {pluginTracks.map((tr) => (
                <div key={tr.id} className="border-t border-white/5 flex items-center px-2" style={{ height: ROW_HEIGHT }}>
                  <span className="text-[10px] text-emerald-300 truncate">
                    {sceneObjects.find((o) => o.id === tr.objectId)?.name ?? tr.objectId}
                  </span>
                  {degenerateTracks.has(tr.id) && (
                    <span
                      className="ml-auto shrink-0"
                      title={t('editor3D.motion.degenerateWarning')}
                    >
                      <AlertTriangle className="w-3 h-3 text-amber-300" />
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex-1 relative" ref={timelineRef}>
              {/* Regla */}
              <div
                className="h-7 border-b border-white/10 relative cursor-pointer select-none"
                onPointerDown={beginScrub}
              >
                {marks.map((tt) => (
                  <div key={tt} className="absolute top-0 h-full" style={{ left: tt * pxPerSecond }}>
                    <div className="w-px h-2 bg-white/30 mt-auto absolute bottom-0" />
                    <span className="absolute bottom-2 left-1 text-[9px] text-muted-foreground">{tt}s</span>
                  </div>
                ))}
              </div>
              {/* Filas */}
              {transformTracks.map((tr) => renderKeyframeRow(tr, 'transform'))}
              {pluginTracks.map((tr) => renderKeyframeRow(tr, 'plugin'))}
              {transformTracks.length === 0 && pluginTracks.length === 0 && (
                <div className="absolute inset-0 top-7 flex items-center justify-center text-muted-foreground pointer-events-none">
                  {t('editor3D.motion.selectObject')}
                </div>
              )}
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-px bg-red-400 pointer-events-none z-10"
                style={{ left: currentTime * pxPerSecond }}
                data-testid="motion-playhead"
              >
                <div className="w-2 h-2 -translate-x-1/2 rotate-45 bg-red-400 -mt-0.5" />
              </div>
            </div>
          </div>
        </div>

        {/* Inspector del fotograma seleccionado */}
        {(selectedTransformKf || selectedPluginKf) && selectedTrackId && (
          <div className="border-t border-white/10 px-2 py-1.5 flex items-center gap-2 flex-wrap">
            <span className="text-muted-foreground">
              {t('editor3D.motion.keyframe')} @ {formatTime(selectedKeyframeTime ?? 0)}s
            </span>
            <select
              value={(selectedTransformKf ?? selectedPluginKf)?.easing ?? 'linear'}
              onChange={(e) =>
                setKeyframeEasing(
                  selectedTrackId,
                  selectedKeyframeTime ?? 0,
                  e.target.value as EasingFunction,
                  transformTracks.some((tk) => tk.id === selectedTrackId) ? 'transform' : 'plugin'
                )
              }
              className="px-1.5 py-0.5 rounded bg-black/30 border border-white/10 text-foreground"
              title={t('editor3D.motion.easing')}
            >
              {EASING_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {selectedPluginKf && (
              (() => {
                const tr = pluginTracks.find((tk) => tk.id === selectedTrackId);
                const pDef = obtenerPlugin(tr?.pluginId ?? '')?.params.find(
                  (p) => p.id === tr?.paramId
                );
                const sliderDef = pDef && pDef.tipo === 'slider' ? pDef : null;
                return (
                  <label className="flex items-center gap-1 text-muted-foreground">
                    {pDef?.etiqueta ?? tr?.paramId}
                    <input
                      type="number"
                      step={sliderDef?.paso ?? 0.1}
                      min={sliderDef?.min}
                      max={sliderDef?.max}
                      value={selectedPluginKf.value}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && selectedKeyframeTime !== null) {
                          setKeyframeParamValue(selectedTrackId, selectedKeyframeTime, v);
                        }
                      }}
                      className="w-20 px-1 py-0.5 rounded bg-black/30 border border-white/10 text-foreground"
                    />
                  </label>
                );
              })()
            )}
            {selectedTransformKf && (
              <span className="text-[10px] text-muted-foreground">
                {Object.keys(selectedTransformKf.values)
                  .map((p) => TRANSFORM_PROPERTY_LABELS[p as TransformProperty])
                  .filter(Boolean)
                  .join(', ')}
              </span>
            )}
            <button
              onClick={() => selectedKeyframeTime !== null && deleteKeyframe(
                selectedTrackId,
                selectedKeyframeTime,
                transformTracks.some((tk) => tk.id === selectedTrackId) ? 'transform' : 'plugin'
              )}
              className="p-1 rounded hover:bg-red-500/20 text-red-300"
              title={t('editor3D.motion.deleteKeyframe')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={addKeyframeAtCurrentTime}
              className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              {t('editor3D.motion.addKeyframe')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};