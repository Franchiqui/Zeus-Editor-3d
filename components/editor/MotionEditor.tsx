'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { FC } from 'react';
import * as THREE from 'three';
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
  ChevronUp,
  ChevronDown,
  Copy,
  ClipboardPaste,
} from 'lucide-react';
import {
  EASING_OPTIONS,
  EasingFunction,
  PluginParamTrack,
  PluginParamKeyframe,
  TransformProperty,
  TransformTrack,
  EffectTrack,
  EffectKeyframe,
  EffectType,
  EFFECT_TYPE_LABELS,
  EFFECT_PROPERTY_PRESETS,
  evaluateTransformTrack,
  evaluatePluginParamTrack,
  evaluateEffectTrack,
  evaluateDeformadorTrack,
  motionMaxDuration,
  upsertKeyframeAt,
  createPluginParamTrack,
  createTransformTrack,
  createGroupTransformTrack,
  createEffectTrack,
  createDeformadorTrack,
  TRANSFORM_PROPERTIES,
  TRANSFORM_PROPERTY_LABELS,
  type TransformKeyframe,
  type DeformadorTrack,
  type DeformadorKeyframe,
} from '@/lib/animation';
import { DEFORMADORES_DIRECTOS, deformadorPorId, aplicarDeformador } from '@/lib/deformadores';
import { DeformParamRows } from './deform-fields';
import { cloneMesh } from '@/lib/plugins/clone';
import type { Mesh } from '@/lib/geometry';
import { Slider } from '@/components/ui/slider';
import {
  listarPlugins,
  suscribirsePlugins,
  obtenerPlugin,
  type PluginParams,
} from '@/lib/plugins';
import { useI18n } from '@/lib/i18n';

/** Valores base de cada efecto (tomados de FxConfig por defecto). */
const EFFECT_DEFAULTS: Record<EffectType, Record<string, number | string | boolean>> = {
  rain: { enabled: true, count: 320, speed: 2 },
  smoke: { enabled: true, count: 120, size: 0.11, color: '#444a52', riseSpeed: 1 },
  stars: { enabled: true, starSize: 1 },
  fire: { enabled: true, count: 160, size: 0.11, intensity: 1 },
  sparks: { enabled: true, count: 140, size: 0.035 },
  glow: { enabled: true, glowColor: '#5fd4ff', glowIntensity: 1.4, glowObjects: false },
};

/** Inspector de propiedades para un fotograma de efecto. */
const EffectKeyframeInspector: React.FC<{
  effectType: EffectType;
  kf: EffectKeyframe;
  onValuesChange: (values: Partial<Record<string, number | string | boolean>>) => void;
}> = ({ effectType, kf, onValuesChange }) => {
  const props = EFFECT_PROPERTY_PRESETS[effectType];
  return (
    <>
      {props.map((p) => {
        const val = kf.values?.[p];
        const common = {
          label: EFFECT_PARAM_LABELS[p] ?? p,
          value: val,
          onChange: (v: number | string | boolean) =>
            onValuesChange({ [p]: v }),
        };
        if (typeof val === 'boolean') {
          return (
            <label key={p} className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={!!val}
                onChange={(e) => common.onChange(e.target.checked)}
              />
              {common.label}
            </label>
          );
        }
        if (typeof val === 'string') {
          return (
            <div key={p} className="flex items-center gap-1 text-xs">
              <label className="text-muted-foreground">{common.label}</label>
              <input
                type="color"
                value={val.length > 0 ? val : '#000000'}
                onChange={(e) => common.onChange(e.target.value)}
                className="w-6 h-5 p-0 border rounded cursor-pointer bg-gray-800 border-gray-600"
              />
            </div>
          );
        }
        return (
          <label key={p} className="flex items-center gap-1 text-xs text-muted-foreground">
            {common.label}
            <input
              type="number"
              step={p === 'size' || p === 'glowIntensity' || p === 'starSize' || p === 'riseSpeed' ? 0.01 : p === 'speed' ? 0.1 : 10}
              value={typeof val === 'number' ? val : ''}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) common.onChange(v);
              }}
              className="w-16 px-1 py-0.5 rounded bg-black/30 border border-white/10 text-foreground"
            />
          </label>
        );
      })}
    </>
  );
};

/** Etiquetas para las propiedades de efecto. */
const EFFECT_PARAM_LABELS: Record<string, string> = {
  enabled: 'Activo',
  count: 'Partículas',
  speed: 'Velocidad',
  size: 'Tamaño',
  intensity: 'Intensidad',
  color: 'Color',
  riseSpeed: 'Ascenso',
  starSize: 'Tamaño',
  glowColor: 'Color',
  glowIntensity: 'Intensidad',
  glowObjects: 'Objetos',
};

/** Objeto de escena reducido a lo que el editor de movimiento necesita. */
export interface MotionEditorObject {
  id: string;
  name?: string;
  hidden?: boolean;
  transform: Record<TransformProperty, number>;
  opacity?: number;
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
  effectTracks: EffectTrack[];
  setEffectTracks: (tracks: EffectTrack[]) => void;
  /** Pistas de deformadores (en cadena, una de cada deformador por objeto). */
  deformadorTracks: DeformadorTrack[];
  setDeformadorTracks: (tracks: DeformadorTrack[]) => void;
  /**
   * Notifica el cambio de pista seleccionada: el visor muestra la cage
   * del deformador SOLO mientras su pista está seleccionada (al elegir
   * otra pista de otro tipo, el contorno se apaga). Manda el id de la
   * pista de deformador, o null si la seleccionada no es de deformador.
   */
  onDeformTrackSelected?: (trackId: string | null) => void;
  /** Malla base congelada por objectId (para animar parámetros de plugin). */
  pluginBaseMeshes: Record<string, Mesh>;
  setPluginBaseMeshes: Dispatch<SetStateAction<Record<string, Mesh>>>;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  currentTime: number;
  setCurrentTime: (t: number) => void;
  autoKey: boolean;
  setAutoKey: (v: boolean) => void;
  /**
   * Recorrido editable del objeto seleccionado visible en el visor.
   */
  showMotionPath: boolean;
  setShowMotionPath: (v: boolean) => void;
  /**
   * Aplica una transformada absoluta al objeto seleccionado.
   */
  onApplyTransform: (transform: Record<TransformProperty, number>) => void;
  /**
   * Aplica una opacidad al objeto seleccionado (0..1).
   */
  onApplyOpacity: (opacity: number) => void;
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

/** Tipos de pista en la línea de tiempo (incluye deformadores). */
type KfKind = 'transform' | 'plugin' | 'effect' | 'deformador';

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
  effectTracks,
  setEffectTracks,
  deformadorTracks,
  setDeformadorTracks,
  onDeformTrackSelected,
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
   onApplyTransform,
   onApplyOpacity,
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
  const dragRef = useRef<{ trackId: string; originalTime: number; kind: KfKind } | null>(null);
  const [dragTime, setDragTime] = useState<number | null>(null);
  // `dragTime` en el closure de `up` quedaría obsoleto: se lee vía ref.
  // El `move` escribe la ref DIRECTAMENTE (no vía render): si el render va
  // por detrás de los eventos, `up` soltaba el rombo en un tiempo viejo y
  // el fotograma «volvía» al sitio.
  const dragTimeRef = useRef<number | null>(null);

  const globalDuration = Math.max(5, motionMaxDuration(transformTracks, pluginTracks, effectTracks, deformadorTracks));
  const timelineWidth = globalDuration * pxPerSecond;

  const visibleObjects = useMemo(
    () => sceneObjects.filter((o) => !o.hidden),
    [sceneObjects]
  );

  const trackOfObject = useMemo(() => {
    const map = new Map<string, { t: number; p: number; d: number }>();
    for (const tr of transformTracks) {
      const e = map.get(tr.objectId) ?? { t: 0, p: 0, d: 0 };
      e.t += tr.keyframes.length;
      map.set(tr.objectId, e);
    }
    for (const tr of pluginTracks) {
      const e = map.get(tr.objectId) ?? { t: 0, p: 0, d: 0 };
      e.p += tr.keyframes.length;
      map.set(tr.objectId, e);
    }
    for (const tr of deformadorTracks) {
      const e = map.get(tr.objectId) ?? { t: 0, p: 0, d: 0 };
      e.d += tr.keyframes.length;
      map.set(tr.objectId, e);
    }
    return map;
  }, [transformTracks, pluginTracks, deformadorTracks]);

  const plugin = pluginId ? obtenerPlugin(pluginId) : undefined;
  const animatableParams = useMemo(
    () => (plugin ? plugin.params.filter((p) => p.tipo === 'slider') : []),
    [plugin]
  );
  const selectedParam = animatableParams.find((p) => p.id === paramId);

  // ------------------------------------------------------- transforma numérica

  // Transformada estática del objeto seleccionado.
  const selectedObject = selectedObjectId
    ? sceneObjects.find((o) => o.id === selectedObjectId)
    : null;

  // Valores animados en el playhead (si el objeto tiene pista de transformada).
  const animatedTransform = useMemo(() => {
    if (!selectedObjectId) return null;
    const tr = transformTracks.find((tk) => tk.objectId === selectedObjectId);
    if (!tr) return null;
    return evaluateTransformTrack(tr, currentTime);
  }, [selectedObjectId, transformTracks, currentTime]);

   // Valores efectivos: usamos la animación en playhead si existe,
   // si no la transformada estática del objeto. La opacidad del mesh
   // se expone como 'o' para que los campos numéricos y los fotogramas
   // la lean/escriban de forma uniforme.
   const effectiveTransform = useMemo(() => {
     if (!selectedObject) return null;
     const base = selectedObject.transform;
     const withOpacity = { ...base, o: selectedObject.opacity ?? 1 };
     if (!animatedTransform) return withOpacity;
     return { ...withOpacity, ...animatedTransform };
   }, [selectedObject, animatedTransform]);

    // Aplica un cambio a una sola propiedad y, si autoKey está activado o
   // hay un fotograma seleccionado en el playhead, crea/actualiza el
   // fotograma en el tiempo actual con los valores absolutos nuevos.
   const handleNumericChange = (prop: TransformProperty, value: number) => {
     if (!selectedObject || !effectiveTransform) return;
     const newTransform = { ...effectiveTransform, [prop]: value };
     // La opacidad vive en mesh.opacity, no en la transformada del
     // ObjectTransform: actualizar el mesh también (no solo el fotograma).
     if (prop === 'o') {
       onApplyOpacity(value);
     } else {
       onApplyTransform(newTransform);
     }

     const shouldUpdateKeyframe =
       autoKey ||
       (selectedKeyframeTime !== null && Math.abs(selectedKeyframeTime - currentTime) < 1e-4);
     if (!shouldUpdateKeyframe) return;

     const tr = transformTracks.find((tk) => tk.objectId === selectedObjectId);
     if (!tr) return;
     // Base = valores animados previos al playhead (o transformada estática).
     const base = animatedTransform ?? selectedObject.transform;
     const baseValues: Record<TransformProperty, number> = {
       px: base.px ?? 0, py: base.py ?? 0, pz: base.pz ?? 0,
       rx: base.rx ?? 0, ry: base.ry ?? 0, rz: base.rz ?? 0,
       sx: base.sx ?? 1, sy: base.sy ?? 1, sz: base.sz ?? 1,
       o: base.o ?? (selectedObject.opacity ?? 1),
     };
     // Cada fotograma guarda el transform COMPLETO (posición, rotación,
     // escala y opacidad) para que la interpolación sea siempre coherente
     // y no dependa de qué propiedades cambiaron en este fotograma.
     const values: Partial<Record<TransformProperty, number>> = {};
     for (const p of TRANSFORM_PROPERTIES) {
       values[p] = newTransform[p] ?? baseValues[p];
     }
     if (Object.keys(values).length === 0) return;
     setTransformTracks(
       transformTracks.map((tk) =>
         tk.objectId === selectedObjectId
           ? {
               ...tk,
               duration: Math.max(tk.duration, currentTime),
               keyframes: upsertKeyframeAt(tk.keyframes, {
                 time: currentTime,
                 values,
                 easing: 'linear',
               }),
             }
           : tk
       )
     );
   };

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

  const updateEffectTrack = (id: string, patch: Partial<EffectTrack>) => {
    setEffectTracks(effectTracks.map((tr) => (tr.id === id ? { ...tr, ...patch } : tr)));
  };

  const updateDeformadorTrack = (id: string, patch: Partial<DeformadorTrack>) => {
    setDeformadorTracks(deformadorTracks.map((tr) => (tr.id === id ? { ...tr, ...patch } : tr)));
  };

  // Reordenar pistas de deformador: el ORDEN del array es el ORDEN de la
  // CADENA en el visor (cada deformador se hornea sobre la salida del
  // anterior). Subir/bajar intercambia posiciones vecinas — p. ej. Afilar
  // antes que Doblar para que el afilado se mida sobre la malla recta.
  const moveDeformadorTrack = (id: string, dir: -1 | 1) => {
    const idx = deformadorTracks.findIndex((tr) => tr.id === id);
    const j = idx + dir;
    if (idx === -1 || j < 0 || j >= deformadorTracks.length) return;
    const next = [...deformadorTracks];
    [next[idx], next[j]] = [next[j], next[idx]];
    setDeformadorTracks(next);
  };

  // ------------------------------------------------------------------
  // Copiar / pegar pista (de cualquier tipo: transformada, plugin, efecto
  // o deformador). Copiar guarda la pista seleccionada; pegar la clona
  // sobre el objeto (o los miembros del grupo) seleccionado, respetando
  // las MISMAS reglas de unicidad que «Añadir pista» (una por deformador/
  // plugin+param/efecto, una transformada por objeto) y congelando las
  // bases nuevas donde toque (plugins y deformadores).
  type PistaCopiada =
    | { kind: 'transform'; track: TransformTrack }
    | { kind: 'plugin'; track: PluginParamTrack }
    | { kind: 'effect'; track: EffectTrack }
    | { kind: 'deformador'; track: DeformadorTrack };

  const [pistaCopiada, setPistaCopiada] = useState<PistaCopiada | null>(null);

  // Aviso efímero de la pega (junto al botón): la pega NEVER no-op en
  // silencio — si un objeto no acepta el clip, se dice por qué.
  const [avisoPegado, setAvisoPegado] = useState<string | null>(null);
  const avisoRefPegado = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avisarPegado = (texto: string) => {
    setAvisoPegado(texto);
    if (avisoRefPegado.current) clearTimeout(avisoRefPegado.current);
    avisoRefPegado.current = setTimeout(() => setAvisoPegado(null), 3000);
  };

  const clonPista = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const idPistaNueva = (prefijo: string) =>
    `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const copiarPista = () => {
    const id = selectedTrackId;
    if (!id) return;
    const trT = transformTracks.find((tr) => tr.id === id);
    if (trT) { setPistaCopiada({ kind: 'transform', track: clonPista(trT) }); return; }
    const trP = pluginTracks.find((tr) => tr.id === id);
    if (trP) { setPistaCopiada({ kind: 'plugin', track: clonPista(trP) }); return; }
    const trE = effectTracks.find((tr) => tr.id === id);
    if (trE) { setPistaCopiada({ kind: 'effect', track: clonPista(trE) }); return; }
    const trD = deformadorTracks.find((tr) => tr.id === id);
    if (trD) setPistaCopiada({ kind: 'deformador', track: clonPista(trD) });
  };

  /** Fusiona los fotogramas de la pista copiada en una pista que YA
   *  existe, DESPLAZÁNDOLOS para que empiecen justo después del último
   *  fotograma existente: el movimiento se REPITE a continuación
   *  (pegar dos veces el mismo clip = la secuencia dos veces seguidas).
   *  El hueco de 0.05 s hace el reinicio casi instantáneo (un corte,
   *  sin rebobinado) y evita pisar el último fotograma existente. */
  const fusionarRepetida = <K extends { time: number }>(
    kfsExistentes: K[],
    kfsCopiados: K[]
  ): { keyframes: K[]; duracion: number } => {
    const ultima = kfsExistentes.length ? Math.max(...kfsExistentes.map((k) => k.time)) : 0;
    const primera = kfsCopiados.length ? Math.min(...kfsCopiados.map((k) => k.time)) : 0;
    const shift = ultima - primera + 0.05;
    const desplazados = kfsCopiados.map((k) => ({ ...k, time: k.time + shift }));
    const finalShift = desplazados.length ? Math.max(...desplazados.map((k) => k.time)) : ultima;
    return {
      keyframes: [...kfsExistentes, ...desplazados].sort((a, b) => a.time - b.time),
      duracion: Math.max(ultima, finalShift),
    };
  };

  const pegarPista = () => {
    if (!pistaCopiada) return;
    const { kind, track } = pistaCopiada;

    // Objetivo: los miembros del grupo elegido o el objeto seleccionado
    // (el mismo criterio de las secciones «Añadir pista»).
    let objetivoIds: string[] = [];
    if (selectedObjectGroupId) {
      const group = groups.find((g) => g.id === selectedObjectGroupId);
      if (group) {
        objetivoIds = group.objectIds
          .map((oid) => sceneObjects.find((o) => o.id === oid))
          .filter((o): o is MotionEditorObject => !!o && !o.hidden)
          .map((o) => o.id);
      }
    } else if (selectedObjectId) {
      objetivoIds = [selectedObjectId];
    }
    if (objetivoIds.length === 0) {
      avisarPegado(t('editor3D.motion.pasteNoTarget'));
      return;
    }

    const avisarPegadoFin = (modificadas: number) => {
      avisarPegado(
        modificadas > 0
          ? t('editor3D.motion.pasteOkRepeat')
          : t('editor3D.motion.pasteOk')
      );
    };

    if (kind === 'transform') {
      // Las fotogramas de transformada llevan valores ABSOLUTOS: repetir
      // el clip repite la trayectoria completa (con el salto de vuelta al
      // inicio, como conviene a una repetición).
      if (track.objectIds?.length && selectedObjectGroupId) {
        // Pista de GRUPO copiada: primero intenta la pega grupal…
        const grupal = transformTracks.find(
          (tr) =>
            !!tr.objectIds?.length &&
            objetivoIds.some((oid) => tr.objectIds!.includes(oid) || tr.objectId === oid)
        );
        if (grupal) {
          const { keyframes, duracion } = fusionarRepetida(grupal.keyframes, track.keyframes);
          const modificada: TransformTrack = { ...grupal, keyframes, duration: duracion };
          setTransformTracks([
            ...transformTracks.map((tr) => (tr.id === grupal.id ? modificada : tr)),
          ]);
          setSelectedTrackId(modificada.id);
          avisarPegadoFin(1);
          return;
        }
        const yaCubierta = objetivoIds.some(
          (oid) =>
            transformTracks.some((tr) => tr.objectId === oid || tr.objectIds?.includes(oid))
        );
        if (yaCubierta) {
          avisarPegado(t('editor3D.motion.pasteCoveredByGroup'));
          return;
        }
        const nueva: TransformTrack = {
          id: idPistaNueva('ttrack'),
          objectId: objetivoIds[0],
          name: track.name,
          duration: track.duration,
          looping: track.looping,
          keyframes: clonPista(track.keyframes),
          objectIds: [...objetivoIds],
        };
        setTransformTracks([...transformTracks, nueva]);
        setSelectedTrackId(nueva.id);
        avisarPegadoFin(0);
        return;
      }
      // Pista de grupo PEGADA a un objeto suelto (o clip individual): los
      // valores son absolutos, así que vale como pista individual. Cada
      // objeto sin transformada recibe una pista nueva; el que YA tiene
      // una, su clip se añade a CONTINUACIÓN (repetir el movimiento).
      // Solo se salta el cubierto por una pista de GRUPO (no se mezclan).
      const nuevas: TransformTrack[] = [];
      const modificadas: TransformTrack[] = [];
      for (const oid of objetivoIds) {
        const existente = transformTracks.find(
          (tr) => tr.objectId === oid || tr.objectIds?.includes(oid)
        );
        if (existente?.objectIds?.length) continue;
        if (existente) {
          const { keyframes, duracion } = fusionarRepetida(existente.keyframes, track.keyframes);
          modificadas.push({ ...existente, keyframes, duration: duracion });
        } else {
          nuevas.push({
            id: idPistaNueva('ttrack'),
            objectId: oid,
            name: track.name,
            duration: track.duration,
            looping: track.looping,
            keyframes: clonPista(track.keyframes),
          });
        }
      }
      if (nuevas.length === 0 && modificadas.length === 0) {
        avisarPegado(t('editor3D.motion.pasteCoveredByGroup'));
        return;
      }
      const idsMod = new Set(modificadas.map((m) => m.id));
      setTransformTracks([
        ...transformTracks.filter((tr) => !idsMod.has(tr.id)),
        ...nuevas,
        ...modificadas,
      ]);
      setSelectedTrackId((nuevas[0] ?? modificadas[0]).id);
      avisarPegadoFin(modificadas.length);
      return;
    }

    if (kind === 'plugin') {
      // Misma regla que addPluginTrack: plugin registrado y base
      // congelada; una pista por (objeto, plugin, parámetro) — si ya la
      // tiene, sus fotogramas se desplazan a continuación (repetir).
      if (!obtenerPlugin(track.pluginId)) {
        avisarPegado(t('editor3D.motion.pastePluginMissing'));
        return;
      }
      const validIds = congelarBases(objetivoIds);
      if (validIds.length === 0) {
        avisarPegado(t('editor3D.motion.pasteNoTarget'));
        return;
      }
      const nuevas: PluginParamTrack[] = [];
      const modificadas: PluginParamTrack[] = [];
      for (const oid of validIds) {
        const existente = pluginTracks.find(
          (tr) => tr.objectId === oid && tr.pluginId === track.pluginId && tr.paramId === track.paramId
        );
        if (existente) {
          const { keyframes, duracion } = fusionarRepetida(existente.keyframes, track.keyframes);
          modificadas.push({ ...existente, keyframes, duration: duracion });
        } else {
          nuevas.push({
            id: idPistaNueva('ptrack'),
            objectId: oid,
            pluginId: track.pluginId,
            paramId: track.paramId,
            duration: track.duration,
            looping: track.looping,
            keyframes: clonPista(track.keyframes),
          });
        }
      }
      if (nuevas.length === 0 && modificadas.length === 0) {
        avisarPegado(t('editor3D.motion.pasteCoveredByGroup'));
        return;
      }
      const idsMod = new Set(modificadas.map((m) => m.id));
      setPluginTracks([
        ...pluginTracks.filter((tr) => !idsMod.has(tr.id)),
        ...nuevas,
        ...modificadas,
      ]);
      setSelectedTrackId((nuevas[0] ?? modificadas[0]).id);
      avisarPegadoFin(modificadas.length);
      return;
    }

    if (kind === 'effect') {
      // Los efectos son por objeto: pega al objeto (o a cada miembro del
      // grupo), uno por tipo y objeto; el que ya lo tiene, lo repite.
      const nuevas: EffectTrack[] = [];
      const modificadas: EffectTrack[] = [];
      for (const oid of objetivoIds) {
        const existente = effectTracks.find(
          (tr) => tr.effectType === track.effectType && (tr.objectId ?? null) === oid
        );
        if (existente) {
          const { keyframes, duracion } = fusionarRepetida(existente.keyframes, track.keyframes);
          modificadas.push({ ...existente, keyframes, duration: duracion });
        } else {
          nuevas.push({
            id: idPistaNueva('etrack'),
            effectType: track.effectType,
            objectId: oid,
            duration: track.duration,
            looping: track.looping,
            keyframes: clonPista(track.keyframes),
          });
        }
      }
      if (nuevas.length === 0 && modificadas.length === 0) {
        avisarPegado(t('editor3D.motion.pasteCoveredByGroup'));
        return;
      }
      const idsMod = new Set(modificadas.map((m) => m.id));
      setEffectTracks([
        ...effectTracks.filter((tr) => !idsMod.has(tr.id)),
        ...nuevas,
        ...modificadas,
      ]);
      setSelectedTrackId((nuevas[0] ?? modificadas[0]).id);
      avisarPegadoFin(modificadas.length);
      return;
    }

    // kind === 'deformador': la cadena admite UNA pista por (objeto,
    // deformador) — la base congelada es imprescindible (malla sin
    // romper). Si el objeto ya la tiene, el clip se AÑADE a continuación
    // (el mismo movimiento se repite dos veces seguidas).
    if (!deformadorPorId(track.deformadorId)) {
      avisarPegado(t('editor3D.motion.pastePluginMissing'));
      return;
    }
    // Clip de GRUPO con grupo elegido: pega a la pista de grupo — si ya
    // existe una, el movimiento se repite a continuación; si no, la crea
    // SIN reemplazar pistas individuales (la cubierta por grupo las tapa).
    if (track.objectIds?.length && selectedObjectGroupId) {
      const grupal = deformadorTracks.find(
        (tr) =>
          tr.deformadorId === track.deformadorId &&
          !!tr.objectIds?.length &&
          objetivoIds.some((oid) => tr.objectIds!.includes(oid) || tr.objectId === oid)
      );
      if (grupal) {
        const { keyframes, duracion } = fusionarRepetida(grupal.keyframes, track.keyframes);
        const modificada: DeformadorTrack = { ...grupal, keyframes, duration: duracion };
        setDeformadorTracks(deformadorTracks.map((tr) => (tr.id === grupal.id ? modificada : tr)));
        setSelectedTrackId(modificada.id);
        avisarPegadoFin(1);
        return;
      }
      const conBase = congelarBases(objetivoIds);
      if (conBase.length < 2) {
        avisarPegado(t('editor3D.motion.pasteNoTarget'));
        return;
      }
      const nueva: DeformadorTrack = {
        id: idPistaNueva('dtrack'),
        objectId: conBase[0],
        objectIds: conBase.slice(1),
        deformadorId: track.deformadorId,
        duration: track.duration,
        looping: track.looping,
        keyframes: clonPista(track.keyframes),
      };
      setDeformadorTracks([...deformadorTracks, nueva]);
      setSelectedTrackId(nueva.id);
      avisarPegadoFin(0);
      return;
    }
    const validIds = congelarBases(objetivoIds);
    if (validIds.length === 0) {
      avisarPegado(t('editor3D.motion.pasteNoTarget'));
      return;
    }
    const nuevas: DeformadorTrack[] = [];
    const modificadas: DeformadorTrack[] = [];
    for (const oid of validIds) {
      const existente = deformadorTracks.find(
        (tr) =>
          (tr.objectId === oid || tr.objectIds?.includes(oid)) &&
          tr.deformadorId === track.deformadorId
      );
      if (existente?.objectIds?.length) continue; // cubierta por GRUPO: no se mezcla
      if (existente) {
        const { keyframes, duracion } = fusionarRepetida(existente.keyframes, track.keyframes);
        modificadas.push({ ...existente, keyframes, duration: duracion });
      } else {
        nuevas.push({
          id: idPistaNueva('dtrack'),
          objectId: oid,
          deformadorId: track.deformadorId,
          duration: track.duration,
          looping: track.looping,
          keyframes: clonPista(track.keyframes),
        });
      }
    }
    if (nuevas.length === 0 && modificadas.length === 0) {
      avisarPegado(t('editor3D.motion.pasteCoveredByGroup'));
      return;
    }
    const idsMod = new Set(modificadas.map((m) => m.id));
    setDeformadorTracks([
      ...deformadorTracks.filter((tr) => !idsMod.has(tr.id)),
      ...nuevas,
      ...modificadas,
    ]);
    setSelectedTrackId((nuevas[0] ?? modificadas[0]).id);
    avisarPegadoFin(modificadas.length);
  };

  // La cage del deformador en el visor sigue la pista SELECCIONADA: al
  // elegir una pista de deformador se notifica su id; al elegir otra
  // pista (de otro tipo) o ninguna, null — el contorno se apaga.
  useEffect(() => {
    if (!onDeformTrackSelected) return;
    const esDeform = deformadorTracks.some((tr) => tr.id === selectedTrackId);
    onDeformTrackSelected(esDeform ? selectedTrackId : null);
  }, [selectedTrackId, deformadorTracks, onDeformTrackSelected]);

  const deleteTrack = (id: string) => {
    setTransformTracks(transformTracks.filter((tr) => tr.id !== id));
    setPluginTracks(pluginTracks.filter((tr) => tr.id !== id));
    setEffectTracks(effectTracks.filter((tr) => tr.id !== id));
    setDeformadorTracks(deformadorTracks.filter((tr) => tr.id !== id));
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
      // Values: el transform COMPLETO (posición, rotación, escala y
      // opacidad) del objeto en este momento. Cada fotograma es
      // independiente: no depende de la base del anterior.
      const base = primerKf?.values ?? {};
      const values: Partial<Record<TransformProperty, number>> = {};
      for (const p of TRANSFORM_PROPERTIES) {
        if (p === 'o') {
          values[p] = objeto?.opacity ?? base.o ?? 1;
        } else {
          values[p] = actual ? (actual[p] ?? base[p] ?? 0) : (base[p] ?? 0);
        }
      }
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
      return;
    }
    const dTrack = deformadorTracks.find((tr) => tr.id === selectedTrackId);
    if (dTrack) {
      // Igual que los plugins: el fotograma nace con los valores que la
      // animación YA tiene aquí (interpolados, con los faltantes de los
      // defaults del deformador) — fijar la pose actual.
      const def = deformadorPorId(dTrack.deformadorId);
      const neutro: PluginParams = {};
      if (def) for (const p of def.params) neutro[p.id] = p.valor;
      const evaluar = evaluateDeformadorTrack(dTrack, currentTime) ?? {};
      const kf: DeformadorKeyframe = {
        time: currentTime,
        values: { ...neutro, ...evaluar },
        easing: 'linear',
      };
      updateDeformadorTrack(dTrack.id, {
        keyframes: upsertKeyframeAt(dTrack.keyframes, kf),
        duration: Math.max(dTrack.duration, currentTime),
      });
      setSelectedKeyframeTime(currentTime);
    }
  };

  /**
   * Valores por defecto que debe conservar un fotograma de efecto: los
   * parámetros que no se animan toman el valor base del FxConfig.
   */
  const defaultEffectValues = (effectType: EffectType): Record<string, number | string | boolean> => {
    return { ...EFFECT_DEFAULTS[effectType] };
  };

  /** Añade fotograma de efecto en currentTime a la pista seleccionada. */
  const addEffectKeyframeAtCurrentTime = () => {
    if (!selectedTrackId) return;
    const eTrack = effectTracks.find((tr) => tr.id === selectedTrackId);
    if (!eTrack) return;
     // Heredar valores del fotograma anterior (o del keyframe más cercano)
     // para que solo los parámetros modificados cambien.
     const sortedEfs = [...eTrack.keyframes].sort((a, b) => a.time - b.time);
     const prevKf = sortedEfs
       .slice()
       .reverse()
       .find((k) => k.time <= currentTime) ?? sortedEfs[0];
    const prevValues = { ...defaultEffectValues(eTrack.effectType), ...(prevKf?.values ?? {}) };
    const nuevo: EffectKeyframe = {
      time: currentTime,
      values: { ...prevValues },
      easing: 'linear',
    };
    updateEffectTrack(eTrack.id, {
      keyframes: upsertKeyframeAt(eTrack.keyframes, nuevo),
      duration: Math.max(eTrack.duration, currentTime),
    });
    setSelectedKeyframeTime(currentTime);
  };
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
    const validIds = congelarBases(targetIds);
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

  /** Congela las mallas base de los objetivos que aún no la tienen
   *  (compartido por las pistas de PLUGIN y de DEFORMADOR). */
  const congelarBases = (targetIds: string[]): string[] => {
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
    return validIds;
  };

  /** Deformador elegido en la sección «Animar deformadores». */
  const [selectedDeformadorId, setSelectedDeformadorId] = useState<string>('');
  const deformadorSel = selectedDeformadorId
    ? DEFORMADORES_DIRECTOS.find((d) => d.id === selectedDeformadorId)
    : undefined;
  const deformadorNeutro = (deformadorId: string): PluginParams => {
    const def = DEFORMADORES_DIRECTOS.find((d) => d.id === deformadorId);
    const neutro: PluginParams = {};
    if (def) for (const p of def.params) neutro[p.id] = p.valor;
    return neutro;
  };

  /** Crea pista(s) de deformador (animable, en cadena): el deformador
   *  elegido sobre los objetivos, con fotogramas NEUTROS (defaults en 0 s
   *  y en el final del track) — inerte hasta que el usuario edite. */
  const addDeformadorTrack = () => {
    const def = deformadorSel;
    if (!def) return;

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
    const validIds = congelarBases(targetIds);
    if (validIds.length === 0) return;
    // Un deformador solo puede llevar UNA pista por objeto (es una cadena:
    // dos del mismo serían redundantes). Las pistas de GRUPO también tapan
    // a sus miembros (objectId u objectIds).
    const yaFiltrados = validIds.filter(
      (oid) =>
        !deformadorTracks.some(
          (tr) =>
            (tr.objectId === oid || tr.objectIds?.includes(oid)) &&
            tr.deformadorId === def.id
        )
    );

    const neutro = deformadorNeutro(def.id);
    const siembra = (track: DeformadorTrack) => {
      // Inerte al nacer: los DOS fotogramas llevan los valores neutros.
      track.keyframes = upsertKeyframeAt(
        upsertKeyframeAt([], { time: 0, values: { ...neutro }, easing: 'linear' as EasingFunction }),
        { time: track.duration, values: { ...neutro }, easing: 'linear' as EasingFunction }
      );
      return track;
    };

    if (selectedObjectGroupId) {
      if (yaFiltrados.length === 0) {
        // El grupo ya tiene la pista de este deformador: se selecciona.
        const existente = deformadorTracks.find(
          (tr) =>
            tr.deformadorId === def.id &&
            validIds.some((oid) => tr.objectId === oid || tr.objectIds?.includes(oid))
        );
        if (existente) {
          setSelectedTrackId(existente.id);
          setSelectedKeyframeTime(0);
        }
        return;
      }
      if (yaFiltrados.length > 1) {
        // GRUPO: UNA pista cubre a todos los miembros — la deformación se
        // aplica a la UNIÓN «como si fuera 1» (igual que el modo directo de
        // la Escena). Las pistas individuales de ESTE deformador en los
        // miembros quedan reemplazadas (no pueden convivir con la de grupo).
        const track = siembra(createDeformadorTrack(yaFiltrados[0], def.id, neutro, Math.max(5, currentTime)));
        track.objectIds = yaFiltrados.slice(1);
        const idsCubiertos = new Set(yaFiltrados);
        setDeformadorTracks(
          deformadorTracks
            .filter((tr) => !(idsCubiertos.has(tr.objectId) && tr.deformadorId === def.id))
            .concat(track)
        );
        setSelectedTrackId(track.id);
        setSelectedKeyframeTime(0);
        return;
      }
    }

    if (yaFiltrados.length === 0) return;

    const nuevas: DeformadorTrack[] = yaFiltrados.map((oid) =>
      siembra(createDeformadorTrack(oid, def.id, neutro, Math.max(5, currentTime)))
    );

    setDeformadorTracks([...deformadorTracks, ...nuevas]);
    setSelectedTrackId(nuevas[0].id);
    setSelectedKeyframeTime(0);
  };

  /** Estado del selector de efectos en el panel izquierdo. */
  const [selectedEffectType, setSelectedEffectType] = useState<EffectType | ''>('');

  /** Crea una pista de efecto visual (del objeto seleccionado; los efectos
   *  son por objeto, como en el visor). */
  const addEffectTrack = () => {
    if (!selectedEffectType) return;
    const oid = selectedObjectId ?? null;
    const existing = effectTracks.find(
      (tr) => tr.effectType === selectedEffectType && (tr.objectId ?? null) === oid
    );
    if (existing) {
      setSelectedTrackId(existing.id);
      return;
    }
    const nueva = createEffectTrack(selectedEffectType, Math.max(5, currentTime), oid);
    nueva.keyframes = upsertKeyframeAt(nueva.keyframes, {
      time: currentTime,
      values: { ...EFFECT_DEFAULTS[selectedEffectType], enabled: true },
      easing: 'linear',
    } as EffectKeyframe);
    setEffectTracks([...effectTracks, nueva]);
    setSelectedTrackId(nueva.id);
    setSelectedKeyframeTime(currentTime);
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
      // Un miembro ya cubierto por una pista de grupo (objectId u
      // objectIds) no recibe pista individual: chocaría con la de grupo.
      if (
        transformTracks.some(
          (tr) => tr.objectId === oid || tr.objectIds?.includes(oid)
        )
      )
        continue;
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

  /**
   * Desvincula una pista de grupo: la reemplaza por pistas individuales.
   * La pista de grupo guarda SOLO la pose del objeto principal: copiarla
   * tal cual a cada miembro aplanaba el grupo sobre el principal (mismo
   * problema de deformación que en la reproducción). Cada miembro recibe
   * la MISMA delta rígida por fotograma (pose del principal ∘ pose
   * estática del principal⁻¹) aplicada sobre SU transformada estática,
   * igual que hace el visor.
   */
  const unmergeGroupTrack = (trackId: string) => {
    const groupTrack = transformTracks.find((tr) => tr.id === trackId);
    if (!groupTrack || !groupTrack.objectIds) return;

    const allIds = [groupTrack.objectId, ...(groupTrack.objectIds ?? [])];
    const newTracks: TransformTrack[] = [];

    const kfs = [...groupTrack.keyframes].sort((a, b) => a.time - b.time);
    if (kfs.length === 0) return;
    const principal = sceneObjects.find((o) => o.id === groupTrack.objectId);
    if (!principal) return;
    const matrizDe = (t: Partial<Record<TransformProperty, number>>) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(t.px ?? 0, t.py ?? 0, t.pz ?? 0),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0)
        ),
        new THREE.Vector3(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1)
      );
    // Base de la delta: la pose estática del principal (o el fotograma 0
    // si la pista nació con otra pose).
    const principalM = matrizDe(
      kfs.some((kf) => kf.time === 0) ? kfs[0].values : principal.transform
    );

    for (const oid of allIds) {
      if (
        transformTracks.some(
          (tr) =>
            tr.id !== trackId &&
            (tr.objectId === oid || tr.objectIds?.includes(oid))
        )
      )
        continue;
      const obj = sceneObjects.find((o) => o.id === oid);
      if (!obj) continue;
      const track = createTransformTrack(oid, obj.transform, groupTrack.duration);
      track.looping = groupTrack.looping;
      if (oid === groupTrack.objectId) {
        // El principal conserva los fotogramas tal cual (son SU pose).
        track.keyframes = kfs.map((kf) => ({ ...kf }));
      } else {
        // Miembro secundario: aplicar cada delta rígida sobre SU pose.
        const base = matrizDe(obj.transform);
        track.keyframes = kfs.map((kf) => {
          const delta = matrizDe(kf.values).multiply(principalM.clone().invert());
          const m = delta.multiply(base.clone());
          const pos = new THREE.Vector3();
          const quat = new THREE.Quaternion();
          const scl = new THREE.Vector3();
          m.decompose(pos, quat, scl);
          const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
          const values: Record<TransformProperty, number> = {
            px: pos.x, py: pos.y, pz: pos.z,
            rx: euler.x, ry: euler.y, rz: euler.z,
            sx: scl.x, sy: scl.y, sz: scl.z,
            o: obj.opacity ?? 1,
          };
          return { time: kf.time, values, easing: kf.easing };
        });
      }
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
      // getBoundingClientRect() ya refleja el desplazamiento por el
      // scroll de los ancestros: rect.left se mueve con ellos, así que
      // clientX - rect.left es directamente la coordenada de contenido.
      // Sumar además el scrollLeft de los ancestros LO CONTABA DOBLE y
      // desplazaba todos los clics/arrastres (con scroll horizontal el
      // pinchado caía más adelante, hasta clavarse al final).
      // Si un ancestro escalara (zoom CSS), rect.width ≠ el.clientWidth:
      // convertimos además de visual a contenido con la proporción.
      const escala =
        rect.width > 0 && el.clientWidth > 0 && el.clientWidth !== rect.width
          ? el.clientWidth / rect.width
          : 1;
      return clampTime(((clientX - rect.left) * escala) / pxPerSecond);
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

  // Arrastre de fotograma: el drag no arranca en pointerdown sino al
  // primer pointermove que supere el umbral (evita que un click de
  // selección arranque el drag).
  const keyframeDragRef = useRef<{
    trackId: string;
    kfTime: number;
     kind: KfKind;
     startX: number;
     startTime: number;
     active: boolean;
   } | null>(null);
   const DRAG_THRESHOLD = 4; // px mínimos para iniciar el arrastre
   // Indica que el último pointerup terminó un arrastre de fotograma:
   // el onClick posterior no debe saltar currentTime al tiempo origen.
   const dragJustEndedRef = useRef(false);

  const beginKeyframeDrag = (
    e: React.PointerEvent,
    trackId: string,
    kfTime: number,
     kind: KfKind
   ) => {
    e.stopPropagation();
    e.preventDefault();
    keyframeDragRef.current = {
      trackId,
      kfTime,
      kind,
      startX: e.clientX,
      startTime: kfTime,
      active: false,
    };
    setDragTime(kfTime);
    const move = (ev: PointerEvent) => {
      const ref = keyframeDragRef.current;
      if (!ref) return;
      const delta = Math.abs(ev.clientX - ref.startX);
      if (!ref.active && delta < DRAG_THRESHOLD) return;
      if (!ref.active) {
        ref.active = true;
        dragRef.current = {
          trackId: ref.trackId,
          originalTime: ref.startTime,
          kind: ref.kind,
        };
      }
      const t = timeFromEvent(ev.clientX);
      dragTimeRef.current = t;
      setDragTime(t);
    };
     const up = () => {
       const ref = keyframeDragRef.current;
       dragJustEndedRef.current = !!ref?.active;
       keyframeDragRef.current = null;
      dragRef.current = null;
      setDragTime(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!ref || !ref.active) return;
      commitKeyframeDrag(ref.trackId, ref.startTime, dragTimeRef.current ?? ref.startTime, ref.kind);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Reubica el fotograma: upsert en el nuevo time y borra el original. */
  const commitKeyframeDrag = (
    trackId: string,
    originalTime: number,
    newTime: number,
    kind: KfKind
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
    } else if (kind === 'plugin') {
      const tr = pluginTracks.find((t) => t.id === trackId);
      if (!tr) return;
      const kf = tr.keyframes.find((k) => Math.abs(k.time - originalTime) < 1e-4);
      if (!kf) return;
      const resto = tr.keyframes.filter((k) => Math.abs(k.time - originalTime) >= 1e-4);
      updatePluginTrack(trackId, {
        keyframes: upsertKeyframeAt(resto, { ...kf, time: newTime }),
        duration: Math.max(tr.duration, newTime),
      });
    } else if (kind === 'deformador') {
      const tr = deformadorTracks.find((t) => t.id === trackId);
      if (!tr) return;
      const kf = tr.keyframes.find((k) => Math.abs(k.time - originalTime) < 1e-4);
      if (!kf) return;
      const resto = tr.keyframes.filter((k) => Math.abs(k.time - originalTime) >= 1e-4);
      updateDeformadorTrack(trackId, {
        keyframes: upsertKeyframeAt(resto, { ...kf, time: newTime }),
        duration: Math.max(tr.duration, newTime),
      });
    } else {
      const tr = effectTracks.find((t) => t.id === trackId);
      if (!tr) return;
      const kf = tr.keyframes.find((k) => Math.abs(k.time - originalTime) < 1e-4);
      if (!kf) return;
      const resto = tr.keyframes.filter((k) => Math.abs(k.time - originalTime) >= 1e-4);
      updateEffectTrack(trackId, {
        keyframes: upsertKeyframeAt(resto, { ...kf, time: newTime }),
        duration: Math.max(tr.duration, newTime),
      });
    }
    setSelectedKeyframeTime(newTime);
  };

  const deleteKeyframe = (trackId: string, kfTime: number, kind: KfKind) => {
    if (kind === 'transform') {
      const tr = transformTracks.find((t) => t.id === trackId);
      if (!tr) return;
      updateTransformTrack(trackId, {
        keyframes: tr.keyframes.filter((k) => Math.abs(k.time - kfTime) >= 1e-4),
      });
     } else if (kind === 'plugin') {
      const tr = pluginTracks.find((t) => t.id === trackId);
      if (!tr) return;
      updatePluginTrack(trackId, {
        keyframes: tr.keyframes.filter((k) => Math.abs(k.time - kfTime) >= 1e-4),
      });
    } else if (kind === 'deformador') {
      const tr = deformadorTracks.find((t) => t.id === trackId);
      if (!tr) return;
      updateDeformadorTrack(trackId, {
        keyframes: tr.keyframes.filter((k) => Math.abs(k.time - kfTime) >= 1e-4),
      });
    } else {
      const tr = effectTracks.find((t) => t.id === trackId);
      if (!tr) return;
      updateEffectTrack(trackId, {
        keyframes: tr.keyframes.filter((k) => Math.abs(k.time - kfTime) >= 1e-4),
      });
    }
    if (selectedKeyframeTime === kfTime) setSelectedKeyframeTime(null);
  };

  const setKeyframeEasing = (
    trackId: string,
    kfTime: number,
    easing: EasingFunction,
    kind: KfKind
  ) => {
    if (kind === 'transform') {
      const tr = transformTracks.find((t) => t.id === trackId);
      if (!tr) return;
      updateTransformTrack(trackId, {
        keyframes: tr.keyframes.map((k) =>
          Math.abs(k.time - kfTime) < 1e-4 ? { ...k, easing } : k
        ),
      });
    } else if (kind === 'plugin') {
      const tr = pluginTracks.find((t) => t.id === trackId);
      if (!tr) return;
      updatePluginTrack(trackId, {
        keyframes: tr.keyframes.map((k) =>
          Math.abs(k.time - kfTime) < 1e-4 ? { ...k, easing } : k
        ),
      });
    } else if (kind === 'deformador') {
      const tr = deformadorTracks.find((t) => t.id === trackId);
      if (!tr) return;
      updateDeformadorTrack(trackId, {
        keyframes: tr.keyframes.map((k) =>
          Math.abs(k.time - kfTime) < 1e-4 ? { ...k, easing } : k
        ),
      });
    } else {
      const tr = effectTracks.find((t) => t.id === trackId);
      if (!tr) return;
      updateEffectTrack(trackId, {
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
  const selectedEffectKf = useMemo(() => {
    if (!selectedTrackId || selectedKeyframeTime === null) return null;
    const tr = effectTracks.find((tk) => tk.id === selectedTrackId);
    return tr?.keyframes.find((k) => Math.abs(k.time - selectedKeyframeTime) < 1e-4) ?? null;
  }, [selectedTrackId, selectedKeyframeTime, effectTracks]);
  const selectedDeformKf = useMemo(() => {
    if (!selectedTrackId || selectedKeyframeTime === null) return null;
    const tr = deformadorTracks.find((tk) => tk.id === selectedTrackId);
    return tr?.keyframes.find((k) => Math.abs(k.time - selectedKeyframeTime) < 1e-4) ?? null;
  }, [selectedTrackId, selectedKeyframeTime, deformadorTracks]);
  const selectedDeformTrack = useMemo(() => {
    if (!selectedTrackId) return null;
    return deformadorTracks.find((tk) => tk.id === selectedTrackId) ?? null;
  }, [selectedTrackId, deformadorTracks]);
  const selectedEffectTrack = useMemo(() => {
    if (!selectedTrackId) return null;
    return effectTracks.find((tk) => tk.id === selectedTrackId) ?? null;
  }, [selectedTrackId, effectTracks]);

  const selectedTrack = transformTracks.find((tk) => tk.id === selectedTrackId)
    ?? pluginTracks.find((tk) => tk.id === selectedTrackId)
    ?? effectTracks.find((tk) => tk.id === selectedTrackId)
    ?? deformadorTracks.find((tk) => tk.id === selectedTrackId)
    ?? null;

  /** Tipo de la pista con ese id (inspector: easing, borrar fotograma). */
  const kindDePista = (id: string): KfKind =>
    transformTracks.some((tk) => tk.id === id) ? 'transform'
    : pluginTracks.some((tk) => tk.id === id) ? 'plugin'
    : effectTracks.some((tk) => tk.id === id) ? 'effect'
    : 'deformador';

  // Marcas de regla: paso adaptativo para no saturar con zoom bajo.
  const rulerStep = pxPerSecond >= 160 ? 0.25 : pxPerSecond >= 80 ? 0.5 : 1;
  const marks: number[] = [];
  for (let tt = 0; tt <= globalDuration + 1e-9; tt += rulerStep) {
    marks.push(Math.round(tt * 100) / 100);
  }

    const renderKeyframeRow = (
      track: TransformTrack | PluginParamTrack | EffectTrack | DeformadorTrack,
      kind: KfKind
    ) => {
     const isSel = track.id === selectedTrackId;
     return (
       <div
         key={track.id}
         className={`flex items-center border-t border-white/5 ${isSel ? 'bg-purple-500/10' : 'hover:bg-white/5'}`}
         style={{ height: ROW_HEIGHT }}
       >
          <div className="relative flex-1 h-full">
          {track.keyframes.map((kf) => {
            const shownTime = dragRef.current?.trackId === track.id && Math.abs(kf.time - dragRef.current.originalTime) < 1e-4 && dragTime !== null
              ? dragTime
              : kf.time;
            const isKfSel = isSel && selectedKeyframeTime !== null && Math.abs(kf.time - selectedKeyframeTime) < 1e-4;
            return (
              <button
key={kf.time}
                 onPointerDown={(e) => {
                   if (e.button !== 0) return;
                   beginKeyframeDrag(e, track.id, kf.time, kind);
                 }}
                 onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTrackId(track.id);
                    setSelectedKeyframeTime(kf.time);
                    // Solo saltar currentTime en un click puro, no tras
                    // arrastrar el fotograma (el arrastre ya posicionó el
                    // playhead en el tiempo destino).
                    if (!dragJustEndedRef.current) {
                      setCurrentTime(kf.time);
                    }
                    dragJustEndedRef.current = false;
                  }}
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rotate-45 border ${
                  isKfSel
                    ? 'bg-amber-300 border-amber-100'
                    : kind === 'transform'
                      ? 'bg-sky-400 border-sky-200 hover:bg-sky-300'
                      : kind === 'plugin'
                        ? 'bg-emerald-400 border-emerald-200 hover:bg-emerald-300'
                        : kind === 'deformador'
                          ? 'bg-pink-400 border-pink-200 hover:bg-pink-300'
                          : 'bg-orange-400 border-orange-200 hover:bg-orange-300'
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

  const effectTrackLabel = (track: EffectTrack): string => {
    const base = EFFECT_TYPE_LABELS[track.effectType] ?? track.effectType;
    // «Fuego — Silla»: a qué objeto pertenece la pista de efecto.
    const objeto = track.objectId
      ? sceneObjects.find((o) => o.id === track.objectId)
      : undefined;
    return objeto ? `${base} — ${objeto.name}` : base;
  };

  const deformadorTrackLabel = (track: DeformadorTrack): string => {
    const def = deformadorPorId(track.deformadorId);
    const objeto = sceneObjects.find((o) => o.id === track.objectId);
    const base = def?.nombre ?? track.deformadorId;
    if (!objeto) return base;
    if (track.objectIds?.length) {
      return `${base} — ${objeto.name} (${t('editor3D.motion.groupTrack')} · ${track.objectIds.length + 1})`;
    }
    return `${base} — ${objeto.name}`;
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
    for (const tr of deformadorTracks) {
      const def = deformadorPorId(tr.deformadorId);
      if (!def) continue;
      const base = pluginBaseMeshes[tr.objectId];
      if (!base) continue;
      for (const kf of tr.keyframes) {
        try {
          const r = aplicarDeformador(
            tr.deformadorId,
            base,
            { ...deformadorNeutro(tr.deformadorId), ...kf.values }
          );
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
  }, [pluginTracks, deformadorTracks, pluginBaseMeshes]);

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
              const counts = trackOfObject.get(obj.id) ?? { t: 0, p: 0, d: 0 };
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
                    {counts.d > 0 && (
                      <span className="px-1 rounded bg-pink-500/20 text-pink-300 text-[9px]">D:{counts.d}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {selectedObjectId &&
            !selectedObjectGroupId &&
            !transformTracks.some(
              (tr) =>
                tr.objectId === selectedObjectId ||
                tr.objectIds?.includes(selectedObjectId)
            ) && (
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
                  (o) =>
                    !transformTracks.some(
                      (tr) => tr.objectId === o.id || tr.objectIds?.includes(o.id)
                    )
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
                  (o) =>
                    !transformTracks.some(
                      (tr) => tr.objectId === o.id || tr.objectIds?.includes(o.id)
                    )
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

          {/* Animar deformadores: los 9 botones con icono (Doblar…Romper).
              Se elige uno y «Añadir pista» crea la pista animable de sus
              params (en cadena sobre el objeto, en orden del array). */}
          <div className="px-2 py-1.5 border-t border-white/10">
            <div className="text-muted-foreground mb-1">{t('editor3D.motion.deformSection')}</div>
            <div className="grid grid-cols-3 gap-1 mb-1">
              {DEFORMADORES_DIRECTOS.map((def) => {
                const activo = def.id === selectedDeformadorId;
                return (
                  <button
                    key={def.id}
                    type="button"
                    title={def.nombre}
                    data-testid={`motion-deformador-${def.id}`}
                    onClick={() => setSelectedDeformadorId(activo ? '' : def.id)}
                    className={`relative flex h-8 items-center justify-center rounded-md p-0.5 border transition-colors ${
                      activo
                        ? 'bg-gray-700 border-pink-400'
                        : 'bg-black/30 border-white/10 hover:bg-white/5'
                    }`}
                  >
                    <span
                      data-letra
                      className="hidden text-[10px] font-bold text-gray-300 select-none"
                    >
                      {def.nombre.charAt(0)}
                    </span>
                    <img
                      src={def.icono}
                      alt=""
                      draggable={false}
                      onError={(e) => {
                        const letra = e.currentTarget.parentElement?.querySelector('[data-letra]');
                        if (letra) letra.classList.remove('hidden');
                        e.currentTarget.style.display = 'none';
                      }}
                      className="h-full w-full object-contain"
                    />
                  </button>
                );
              })}
            </div>
            {deformadorSel && (
              <button
                onClick={addDeformadorTrack}
                disabled={!selectedObjectId && !selectedObjectGroupId}
                data-testid="motion-add-deformador-track"
                className="w-full px-2 py-1 rounded bg-pink-500/20 hover:bg-pink-500/30 text-pink-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
              >
                <Plus className="w-3 h-3" />
                {(() => {
                  if (!selectedObjectGroupId) return t('editor3D.motion.addDeformadorTrack');
                  const group = groups.find((g) => g.id === selectedObjectGroupId);
                  if (!group) return t('editor3D.motion.addDeformadorTrack');
                  const groupObjs = group.objectIds
                    .map((id) => sceneObjects.find((o) => o.id === id))
                    .filter((o): o is MotionEditorObject => !!o && !o.hidden);
                  if (groupObjs.length > 1) return t('editor3D.motion.addDeformadorTrack');
                  const sinTrack = groupObjs.filter(
                    (o) =>
                      !deformadorTracks.some(
                        (tr) =>
                          (tr.objectId === o.id || tr.objectIds?.includes(o.id)) &&
                          tr.deformadorId === deformadorSel.id
                      )
                  ).length;
                  return t('editor3D.motion.addDeformadorTracks', { count: sinTrack });
                })()}
              </button>
            )}
            {selectedObjectId && deformadorTracks.some((tr) => tr.objectId === selectedObjectId) && (
              <div className="text-[10px] text-muted-foreground mt-1">
                {t('editor3D.motion.deformTrackHint')}
              </div>
            )}
          </div>

          {/* Efectos visuales: lluvia, humo, estrellas, etc. */}
          <div className="px-2 py-1.5 border-t border-white/10">
            <div className="text-muted-foreground mb-1 flex items-center gap-1">
              <span>🎨</span>
              {t('editor3D.motion.effectSection')}
            </div>
            <select
              value={selectedEffectType ?? ''}
              onChange={(e) => setSelectedEffectType(e.target.value as EffectType | '')}
              className="w-full px-1.5 py-1 rounded bg-black/30 border border-white/10 text-foreground mb-1"
            >
              <option value="">{t('editor3D.motion.pickEffect')}</option>
              {(Object.keys(EFFECT_TYPE_LABELS) as EffectType[]).map((et) => (
                <option key={et} value={et}>{EFFECT_TYPE_LABELS[et]}</option>
              ))}
            </select>
            {selectedEffectType && (
              <button
                onClick={addEffectTrack}
                disabled={effectTracks.some(
                  (tr) =>
                    tr.effectType === selectedEffectType &&
                    (tr.objectId ?? null) === (selectedObjectId ?? null)
                )}
                className="w-full px-2 py-1 rounded bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
              >
                <Plus className="w-3 h-3" />
                {t('editor3D.motion.addEffectTrack')}
              </button>
            )}
            {effectTracks.length > 0 && (
              <div className="mt-1 text-[10px] text-muted-foreground">
                {effectTracks.length} {t('editor3D.motion.effectTracks', { count: effectTracks.length })}
              </div>
            )}
          </div>

          {/* Restaurar objeto: transform estático de vuelta y borrar sus
               pistas. Para recuperarse de un plugin deformado a lo loco. */}
          {selectedObjectId &&
            (transformTracks.some((tk) => tk.objectId === selectedObjectId) ||
              pluginTracks.some((tk) => tk.objectId === selectedObjectId) ||
              deformadorTracks.some((tk) => tk.objectId === selectedObjectId)) && (
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

           {effectiveTransform && (
             <div className="flex items-center gap-1 ml-2">
               <fieldset className="border border-white/10 rounded px-1.5 py-0.5">
                 <legend className="text-[9px] text-muted-foreground px-0.5">
                   {t('editor3D.motion.position')}
                 </legend>
                 <div className="flex items-end gap-0.5">
                   {(['px', 'py', 'pz'] as const).map((prop, i) => (
                     <div key={prop} className="flex flex-col items-center">
                       <span className="text-[8px] text-muted-foreground mb-0.5">
                         {['X', 'Y', 'Z'][i]}
                       </span>
                       <input
                         type="number"
                         step="0.1"
                         value={effectiveTransform[prop]}
                         onChange={(e) => {
                           const v = parseFloat(e.target.value);
                           if (!isNaN(v)) handleNumericChange(prop, v);
                         }}
                         className="w-14 px-0.5 py-0 rounded bg-black/30 border border-white/10 text-foreground font-mono text-[10px]"
                       />
                     </div>
                   ))}
                 </div>
               </fieldset>
               <fieldset className="border border-white/10 rounded px-1.5 py-0.5">
                 <legend className="text-[9px] text-muted-foreground px-0.5">
                   {t('editor3D.motion.rotation')}
                 </legend>
                 <div className="flex items-end gap-0.5">
                   {(['rx', 'ry', 'rz'] as const).map((prop, i) => (
                     <div key={prop} className="flex flex-col items-center">
                       <span className="text-[8px] text-muted-foreground mb-0.5">
                         {['X', 'Y', 'Z'][i]}
                       </span>
                       <input
                         type="number"
                         step="1"
                         value={(effectiveTransform[prop] * 180) / Math.PI}
                         onChange={(e) => {
                           const v = parseFloat(e.target.value);
                           if (!isNaN(v)) handleNumericChange(prop, (v * Math.PI) / 180);
                         }}
                         className="w-14 px-0.5 py-0 rounded bg-black/30 border border-white/10 text-foreground font-mono text-[10px]"
                       />
                     </div>
                   ))}
                 </div>
               </fieldset>
               <fieldset className="border border-white/10 rounded px-1.5 py-0.5">
                 <legend className="text-[9px] text-muted-foreground px-0.5">
                   {t('editor3D.motion.scale')}
                 </legend>
                 <div className="flex items-end gap-0.5">
                   {(['sx', 'sy', 'sz'] as const).map((prop, i) => (
                     <div key={prop} className="flex flex-col items-center">
                       <span className="text-[8px] text-muted-foreground mb-0.5">
                         {['X', 'Y', 'Z'][i]}
                       </span>
                       <input
                         type="number"
                         step="0.01"
                         value={effectiveTransform[prop]}
                         onChange={(e) => {
                           const v = parseFloat(e.target.value);
                           if (!isNaN(v)) handleNumericChange(prop, v);
                         }}
                         className="w-14 px-0.5 py-0 rounded bg-black/30 border border-white/10 text-foreground font-mono text-[10px]"
                       />
                     </div>
                   ))}
                 </div>
               </fieldset>
                <fieldset className="border border-white/10 rounded px-1.5 py-0.5">
                  <legend className="text-[9px] text-muted-foreground px-0.5">
                    {t('editor3D.motion.opacity')}
                  </legend>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={effectiveTransform?.o ?? selectedObject?.opacity ?? 1}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) handleNumericChange('o', Math.min(1, Math.max(0, v)));
                    }}
                    className="w-14 px-0.5 py-0 rounded bg-black/30 border border-white/10 text-foreground font-mono text-[10px]"
                  />
                </fieldset>
             </div>
           )}

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
                  if (effectTracks.some((tk) => tk.id === selectedTrack.id)) {
                    updateEffectTrack(selectedTrack.id, { duration: v });
                  } else if (transformTracks.some((tk) => tk.id === selectedTrack.id)) {
                    updateTransformTrack(selectedTrack.id, { duration: v });
                  } else if (deformadorTracks.some((tk) => tk.id === selectedTrack.id)) {
                    updateDeformadorTrack(selectedTrack.id, { duration: v });
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
                    if (effectTracks.some((tk) => tk.id === selectedTrack.id)) {
                      updateEffectTrack(selectedTrack.id, { looping: !selectedTrack.looping });
                    } else if (transformTracks.some((tk) => tk.id === selectedTrack.id)) {
                      updateTransformTrack(selectedTrack.id, { looping: !selectedTrack.looping });
                    } else if (deformadorTracks.some((tk) => tk.id === selectedTrack.id)) {
                      updateDeformadorTrack(selectedTrack.id, { looping: !selectedTrack.looping });
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
            <Slider
              value={[pxPerSecond]}
              min={MIN_PX_PER_SECOND}
              max={MAX_PX_PER_SECOND}
              step={10}
              onValueChange={([v]) => setPxPerSecond(v)}
              className="w-24"
              data-testid="motion-zoom-slider"
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
              {transformTracks.map((tr) => {
                const isGroupTrack = !!(tr.objectIds && tr.objectIds.length > 0);
                const groupMemberCount = isGroupTrack ? tr.objectIds!.length + 1 : 0;
                const isSel = tr.id === selectedTrackId;
                return (
                  <div
                    key={tr.id}
                    className={`border-t border-white/5 flex items-center px-2 cursor-pointer ${
                      isSel ? 'bg-purple-500/10' : 'hover:bg-white/5'
                    }`}
                    style={{ height: ROW_HEIGHT }}
                    onClick={() => { setSelectedTrackId(tr.id); setSelectedKeyframeTime(null); }}
                    title={
                      isGroupTrack
                        ? `${t('editor3D.motion.groupTrack')} (${groupMemberCount})`
                        : t('editor3D.motion.transformTrack')
                    }
                  >
                    {isGroupTrack && <FolderOpen className="w-3 h-3 shrink-0 text-fuchsia-300 mr-1" />}
                    <span className={`text-[10px] truncate ${isGroupTrack ? 'text-fuchsia-300' : 'text-sky-300'}`}>
                      {sceneObjects.find((o) => o.id === tr.objectId)?.name ?? tr.objectId}
                    </span>
                    {isGroupTrack && (
                      <button
                        onClick={(e) => { e.stopPropagation(); unmergeGroupTrack(tr.id); }}
                        className="ml-auto px-1 rounded hover:bg-white/10 text-fuchsia-300 shrink-0"
                        title={t('editor3D.motion.unmergeGroup')}
                      >
                        <Unlink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
              {pluginTracks.map((tr) => {
                const isSel = tr.id === selectedTrackId;
                return (
                  <div
                    key={tr.id}
                    className={`border-t border-white/5 flex items-center px-2 cursor-pointer ${
                      isSel ? 'bg-purple-500/10' : 'hover:bg-white/5'
                    }`}
                    style={{ height: ROW_HEIGHT }}
                    onClick={() => { setSelectedTrackId(tr.id); setSelectedKeyframeTime(null); }}
                    title={pluginTrackLabel(tr)}
                  >
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
                );
              })}
              {effectTracks.map((tr) => {
                const isSel = tr.id === selectedTrackId;
                return (
                  <div
                    key={tr.id}
                    className={`border-t border-white/5 flex items-center px-2 cursor-pointer ${
                      isSel ? 'bg-purple-500/10' : 'hover:bg-white/5'
                    }`}
                    style={{ height: ROW_HEIGHT }}
                    onClick={() => { setSelectedTrackId(tr.id); setSelectedKeyframeTime(null); }}
                    title={effectTrackLabel(tr)}
                  >
                    <span className="text-[10px] text-orange-300 truncate">
                      {effectTrackLabel(tr)}
                    </span>
                  </div>
                );
              })}
              {deformadorTracks.map((tr) => {
                const isSel = tr.id === selectedTrackId;
                const i = deformadorTracks.indexOf(tr);
                return (
                  <div
                    key={tr.id}
                    className={`border-t border-white/5 flex items-center px-2 cursor-pointer ${
                      isSel ? 'bg-purple-500/10' : 'hover:bg-white/5'
                    }`}
                    style={{ height: ROW_HEIGHT }}
                    onClick={() => { setSelectedTrackId(tr.id); setSelectedKeyframeTime(null); }}
                    title={deformadorTrackLabel(tr)}
                  >
                    {/* Nº de orden EN LA CADENA: en el visor cada
                        deformador se aplica sobre la salida del anterior. */}
                    <span className="text-[9px] text-pink-300/50 mr-1 shrink-0 tabular-nums">
                      {i + 1}
                    </span>
                    <span className="text-[10px] text-pink-300 truncate">
                      {deformadorTrackLabel(tr)}
                    </span>
                    {!!(tr.objectIds?.length) && (
                      <FolderOpen className="w-3 h-3 shrink-0 text-fuchsia-300 ml-1" />
                    )}
                    {deformadorTracks.length > 1 && (
                      <span className="ml-auto shrink-0 flex items-center gap-0.5">
                        <button
                          className="w-4 h-4 flex items-center justify-center rounded text-muted-foreground hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-default"
                          disabled={i === 0}
                          title={t('editor3D.motion.moveTrackUp')}
                          onClick={(e) => { e.stopPropagation(); moveDeformadorTrack(tr.id, -1); }}
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button
                          className="w-4 h-4 flex items-center justify-center rounded text-muted-foreground hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-default"
                          disabled={i === deformadorTracks.length - 1}
                          title={t('editor3D.motion.moveTrackDown')}
                          onClick={(e) => { e.stopPropagation(); moveDeformadorTrack(tr.id, 1); }}
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </span>
                    )}
                    {degenerateTracks.has(tr.id) && (
                      <span
                        className={`${deformadorTracks.length > 1 ? 'ml-1' : 'ml-auto'} shrink-0`}
                        title={t('editor3D.motion.degenerateWarning')}
                      >
                        <AlertTriangle className="w-3 h-3 text-amber-300" />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Toda la zona de regla+filas responde al scrub: pinchar en
                cualquier sitio (y arrastrar) mueve el playhead. Los rombos
                de fotograma hacen stopPropagation, así no se pelean. */}
            <div className="flex-1 relative" ref={timelineRef} onPointerDown={beginScrub} data-testid="motion-timeline-area">
              {/* Regla */}
              <div
                className="h-7 border-b border-white/10 relative select-none"
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
               {effectTracks.map((tr) => renderKeyframeRow(tr, 'effect'))}
               {deformadorTracks.map((tr) => renderKeyframeRow(tr, 'deformador'))}
               {transformTracks.length === 0 && pluginTracks.length === 0 && effectTracks.length === 0 && deformadorTracks.length === 0 && (
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

        {/* Inspector del fotograma seleccionado. Visible SIEMPRE que hay
            una pista seleccionada: sin fotograma elegido solo ofrece
            «Añadir fotograma» (antes, para programar había que picar un
            kf existente primero, y ese click además saltaba el playhead). */}
        {selectedTrackId && (
          <div className="border-t border-white/10 px-2 py-1.5 flex items-center gap-2 flex-wrap">
            {/* Copiar / pegar pista: copia la pista seleccionada (de
                cualquier tipo) y la pega en el objeto o grupo elegido. */}
            <button
              onClick={copiarPista}
              className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground"
              title={t('editor3D.motion.copyTrack')}
              data-testid="motion-copy-track"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={pegarPista}
              disabled={!pistaCopiada}
              className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default"
              title={t('editor3D.motion.pasteTrack')}
              data-testid="motion-paste-track"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
            </button>
            {avisoPegado && (
              <span className="text-[10px] text-emerald-300 max-w-[26rem] truncate" data-testid="motion-paste-notice">
                {avisoPegado}
              </span>
            )}
            {(selectedTransformKf || selectedPluginKf || selectedEffectKf || selectedDeformKf) && (
              <>
                <span className="text-muted-foreground">
                  {t('editor3D.motion.keyframe')} @ {formatTime(selectedKeyframeTime ?? 0)}s
                </span>
                <select
                  value={(selectedTransformKf ?? selectedPluginKf ?? selectedEffectKf ?? selectedDeformKf)?.easing ?? 'linear'}
                  onChange={(e) =>
                    setKeyframeEasing(
                      selectedTrackId,
                      selectedKeyframeTime ?? 0,
                      e.target.value as EasingFunction,
                      kindDePista(selectedTrackId)
                    )
                  }
                  className="px-1.5 py-0.5 rounded bg-black/30 border border-white/10 text-foreground"
                  title={t('editor3D.motion.easing')}
                >
                  {EASING_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </>
            )}
            {(() => {
              // Pista de deformador seleccionada: los campos editan SIEMPRE
              // el instante ACTUAL (el playhead) — el cambio crea/actualiza
              // el fotograma ahí mismo y se ve en vivo. Es el autoclave del
              // deformador, siempre activo: mover un campo ROMBO crea el
              // rombo. Con un kf elegido funciona igual (picar el rombo
              // lleva el playhead a él, así que editar refina ese kf).
              const tr = deformadorTracks.find((tk) => tk.id === selectedTrackId);
              const def = tr ? deformadorPorId(tr.deformadorId) : undefined;
              if (!tr || !def) return null;
              const neutro = deformadorNeutro(tr.deformadorId);
              const evaluar = evaluateDeformadorTrack(tr, currentTime) ?? {};
              const valores: PluginParams = { ...neutro, ...evaluar };
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-pink-300">
                    {def.nombre} @ {formatTime(currentTime)}s
                  </span>
                  <DeformParamRows
                    deformador={def}
                    params={valores}
                    onParams={(next) => {
                      updateDeformadorTrack(tr.id, {
                        keyframes: upsertKeyframeAt(tr.keyframes, {
                          time: currentTime,
                          values: { ...next },
                          easing: 'linear' as EasingFunction,
                        }),
                        duration: Math.max(tr.duration, currentTime),
                      });
                      setSelectedKeyframeTime(currentTime);
                    }}
                  />
                </div>
              );
            })()}
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
            {selectedEffectKf && selectedEffectTrack && (
              <EffectKeyframeInspector
                effectType={selectedEffectTrack.effectType}
                kf={selectedEffectKf}
                onValuesChange={(newValues) => {
                  if (selectedKeyframeTime === null) return;
                  updateEffectTrack(selectedTrackId, {
                    keyframes: selectedEffectTrack.keyframes.map((k) =>
                      Math.abs(k.time - selectedKeyframeTime) < 1e-4
                        ? { ...k, values: { ...k.values, ...newValues } }
                        : k
                    ),
                  });
                }}
              />
            )}
            <button
              disabled={selectedKeyframeTime === null}
              onClick={() => selectedKeyframeTime !== null && deleteKeyframe(
                selectedTrackId,
                selectedKeyframeTime,
                kindDePista(selectedTrackId)
              )}
              className="p-1 rounded hover:bg-red-500/20 text-red-300 disabled:opacity-40"
              title={selectedKeyframeTime === null ? t('editor3D.motion.pickKeyframe') : t('editor3D.motion.deleteKeyframe')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={
                effectTracks.some((tk) => tk.id === selectedTrackId)
                  ? addEffectKeyframeAtCurrentTime
                  : addKeyframeAtCurrentTime
              }
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