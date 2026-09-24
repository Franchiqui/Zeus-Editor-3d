'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImagePlus, Move, Trash2, Plus, KeyRound, Save, X, Pencil, Copy, Eye, EyeOff, Crosshair, Wand2, Link2, Loader2, ArrowUp, ArrowDown, BringToFront, SendToBack } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n';
import { ObjectClip, ObjectKeyframe, BezierAnchor } from '@/types';
import { OverlayObjectAsset } from '@/lib/overlay-objects';
import { getObjectValuesAtTime } from '@/lib/object-keyframes';
import {
  TrackingData,
  trackingDataToKeyframes,
  smoothTrackingData,
} from '@/lib/video-tracking';
import { trackPattern } from '@/lib/pattern-track';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export interface TrackingRegion { x: number; y: number; width: number; height: number; }

type ApiStatus = 'unknown' | 'connecting' | 'online' | 'offline';
type MotionPhase = 'idle' | 'tracking' | 'done' | 'error';
interface MotionState {
  phase: MotionPhase;
  data?: TrackingData;
  error?: string;
  frames?: number;
  fps?: number;
  durationSec?: number;
  progress?: number;
}

interface VideoObjectEditorProps {
  objectClips: ObjectClip[];
  availableObjects: OverlayObjectAsset[];
  currentTime: number;
  videoDuration: number;
  selectedObjectId?: string | null;
  onSelectObject: (id: string | null) => void;
  onAddObjectClip: (asset: OverlayObjectAsset) => void;
  onUpdateObjectClip: (id: string, updates: Partial<ObjectClip>) => void;
  onDeleteObjectClip: (id: string) => void;
  /** Cambia la capa (z-order) del objeto: front/back = al frente/al fondo;
   *  forward/backward = un nivel. El orden del array objectClips define el
   *  apilado (los últimos van encima), en preview y export. */
  onMoveObjectLayer: (id: string, dir: 'front' | 'back' | 'forward' | 'backward') => void;
  onSeek?: (time: number) => void;
  // ── Tracking de vídeo ──
  videoSrcUrl?: string;
  videoNativeSize?: { width: number; height: number };
  trackingRegion?: TrackingRegion | null;
  onTrackingRegionChange?: (r: TrackingRegion | null) => void;
  trackingLazoPath?: BezierAnchor[] | null;
  onTrackingLazoPathChange?: (path: BezierAnchor[] | null) => void;
  trackingMode?: 'lazo' | 'rect';
  onTrackingModeChange?: (mode: 'lazo' | 'rect') => void;
  isDrawingTrackingRegion?: boolean;
  onDrawingTrackingRegionChange?: (active: boolean) => void;
  onToast?: (title: string, description?: string) => void;
  // Datos de tracking completos (para previsualizar el movimiento sobre el preview).
  onMotionDataChange?: (data: TrackingData | null) => void;
  // Tracking por SAM2 (IA vía ComfyUI): recibe la región marcada (o lazo) y devuelve un
  // TrackingData (bbox/centro/escala/contours por frame). Reusa la config SAM2 de Efectos.
  onSam2Track?: (region: TrackingRegion, lazoPath?: BezierAnchor[] | null, onProgress?: (p: number) => void) => Promise<TrackingData | null>;
  sam2Ready?: boolean;
  // Servidores ComfyUI + Flux Bridge (compartidos con LTX/SAM2 de Efectos).
  serverStatus?: { comfyui: boolean; fluxBridge: boolean };
  serverMessage?: string | null;
  isStartingServers?: boolean;
  onStartServers?: () => void;
  onRestartBridge?: () => void;
  // Fallback de región: bbox de la selección activa (lazo/rect/círculo de la
  // pestaña Efectos). Se usa SI el usuario no dibujó la región de tracking con
  // el botón, pero sí tiene una selección en el frame actual — así "dibujar la
  // región" (el lazo conocido) también sirve para trackear.
  selectionRegionFallback?: TrackingRegion | null;
  // Oculta la selección de Efectos (lazo) una vez creado el movimiento. Se llama
  // sólo cuando el lazo se usó como región de tracking (fallback), para que no
  // se quede "parado" por el preview después de trackear.
  onClearSelection?: () => void;
}

export default function VideoObjectEditor({
  objectClips,
  availableObjects,
  currentTime,
  videoDuration,
  selectedObjectId,
  onSelectObject,
  onAddObjectClip,
  onUpdateObjectClip,
  onDeleteObjectClip,
  onMoveObjectLayer,
  onSeek,
  videoSrcUrl,
  videoNativeSize,
  trackingRegion,
  onTrackingRegionChange,
  trackingLazoPath,
  onTrackingLazoPathChange,
  trackingMode = 'lazo',
  onTrackingModeChange,
  isDrawingTrackingRegion = false,
  onDrawingTrackingRegionChange,
  onToast,
  onMotionDataChange,
  onSam2Track,
  sam2Ready,
  selectionRegionFallback,
  onClearSelection,
  serverStatus,
  serverMessage,
  isStartingServers,
  onStartServers,
  onRestartBridge,
}: VideoObjectEditorProps) {
  const [assetToAddId, setAssetToAddId] = useState<string>('');
  const [editingKfId, setEditingKfId] = useState<string | null>(null);
  const [isNewKf, setIsNewKf] = useState(false);
  const [snapshot, setSnapshot] = useState<ObjectKeyframe | null>(null); // para Cancelar
  const { t } = useI18n();

  // ── Estado de tracking (tracker local, sin servidor) ──
  const [sampleStep, setSampleStep] = useState(5);
  const [motion, setMotion] = useState<MotionState>({ phase: 'idle' });
  // Motor de tracking: SAM2 (IA, vía ComfyUI) o patrón (local, sin servidor).
  // SAM2 es el predeterminado: sigue el contorno real del objeto (no sólo una caja).
  const [trackEngine, setTrackEngine] = useState<'sam2' | 'pattern'>('sam2');

  const selectedClip = useMemo(
    () => objectClips.find((clip) => clip.id === selectedObjectId) ?? null,
    [objectClips, selectedObjectId]
  );

  // Al cambiar de objeto cerramos la sesión de edición (los cambios ya están aplicados).
  useEffect(() => {
    setEditingKfId(null);
    setSnapshot(null);
    setIsNewKf(false);
  }, [selectedObjectId]);

  const activeCount = objectClips.filter(
    (clip) => currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration
  ).length;

  const hasKeyframes = !!(selectedClip?.keyframes && selectedClip.keyframes.length > 0);
  const sortedKeyframes = useMemo(
    () => (selectedClip?.keyframes ? [...selectedClip.keyframes].sort((a, b) => a.time - b.time) : []),
    [selectedClip?.keyframes]
  );
  const currentLocalTime = selectedClip ? clamp(currentTime - selectedClip.startTime, 0, selectedClip.duration) : 0;
  const editingKf = sortedKeyframes.find((k) => k.id === editingKfId) ?? null;

  // --- Base (sin keyframes): edición directa como en el comportamiento original ---
  const setBase = (partial: Partial<Pick<ObjectClip, 'position' | 'width' | 'height' | 'opacity'>>) => {
    if (!selectedClip) return;
    onUpdateObjectClip(selectedClip.id, partial);
  };

  const updateKeyframe = (kfId: string, partial: Partial<ObjectKeyframe>) => {
    if (!selectedClip) return;
    const next = (selectedClip.keyframes || []).map((k) => (k.id === kfId ? { ...k, ...partial } : k));
    onUpdateObjectClip(selectedClip.id, { keyframes: next });
  };

  const deleteKeyframe = (kfId: string) => {
    if (!selectedClip) return;
    const next = (selectedClip.keyframes || []).filter((k) => k.id !== kfId);
    onUpdateObjectClip(selectedClip.id, { keyframes: next });
    if (editingKfId === kfId) {
      setEditingKfId(null);
      setSnapshot(null);
      setIsNewKf(false);
    }
  };

  // --- Sesión de edición de un instante ---
  const startNewKeyframe = () => {
    if (!selectedClip) return;
    let time = currentLocalTime;
    // Si ya hay un instante en este minuto, desplazamos el nuevo +1s para no pisarlo.
    if ((selectedClip.keyframes || []).some((k) => Math.abs(k.time - time) < 0.05)) {
      time = clamp(time + 1, 0, selectedClip.duration);
    }
    const cur = getObjectValuesAtTime(selectedClip, currentLocalTime);
    const newKf: ObjectKeyframe = {
      id: `kf-${selectedClip.id}-${Date.now()}`,
      time,
      x: Math.round(cur.x),
      y: Math.round(cur.y),
      width: clamp(Math.round(cur.width), 5, 95),
      height: cur.height,
      opacity: Math.round(cur.opacity),
      // Guardar las coordenadas de los 4 vértices (corners) al crear el instante,
      // de modo que cada vértice se anima por separado entre instantes.
      corners: cur.corners
        ? cur.corners.map((c) => ({ x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 }))
        : undefined,
    };
    onUpdateObjectClip(selectedClip.id, { keyframes: [...(selectedClip.keyframes || []), newKf] });
    setEditingKfId(newKf.id);
    setIsNewKf(true);
    setSnapshot(null);
    onSeek?.(selectedClip.startTime + time); // cursor sobre el instante => mandos en vivo
  };

  const copyPreviousKeyframe = () => {
    if (!selectedClip) return;
    const kfs = (selectedClip.keyframes || []).slice().sort((a, b) => a.time - b.time);
    // El instante anterior al cursor actual (el mayor tiempo <= currentLocalTime)
    const prev = [...kfs].reverse().find((k) => k.time <= currentLocalTime);
    let source: ObjectKeyframe | null = null;
    if (prev) {
      source = prev;
    } else if (kfs.length > 0) {
      // Si no hay ninguno antes, usar el primero
      source = kfs[0];
    }
    if (!source) {
      alert(t('videoEditor.objects.noPrevKf'));
      return;
    }
    let time = currentLocalTime;
    // Si ya hay un instante en este minuto, desplazar +1s
    if (kfs.some((k) => Math.abs(k.time - time) < 0.05)) {
      time = clamp(time + 1, 0, selectedClip.duration);
    }
    const newKf: ObjectKeyframe = {
      ...source,
      id: `kf-${selectedClip.id}-${Date.now()}`,
      time,
    };
    onUpdateObjectClip(selectedClip.id, { keyframes: [...kfs, newKf] });
    setEditingKfId(newKf.id);
    setIsNewKf(true);
    setSnapshot(null);
    onSeek?.(selectedClip.startTime + time); // cursor sobre el instante => mandos en vivo
  };


  const startEditKeyframe = (kf: ObjectKeyframe) => {
    setEditingKfId(kf.id);
    setIsNewKf(false);
    setSnapshot({ ...kf });
    onSeek?.(selectedClip!.startTime + kf.time); // cursor sobre el instante => mandos en vivo
  };

  const finishEditing = () => {
    setEditingKfId(null);
    setSnapshot(null);
    setIsNewKf(false);
  };

  const cancelEditing = () => {
    if (editingKfId) {
      if (isNewKf) {
        deleteKeyframe(editingKfId);
      } else if (snapshot) {
        updateKeyframe(editingKfId, { ...snapshot });
      }
    }
    setEditingKfId(null);
    setSnapshot(null);
    setIsNewKf(false);
  };

  // Los mandos de arriba: editan el instante en vivo (si hay sesión) o la base.
  const showSliders = !hasKeyframes || editingKf !== null;
  const sliderVals = editingKf
    ? { x: editingKf.x, y: editingKf.y, width: editingKf.width, opacity: editingKf.opacity }
    : selectedClip
      ? { x: selectedClip.position.x, y: selectedClip.position.y, width: selectedClip.width, opacity: selectedClip.opacity }
      : { x: 0, y: 0, width: 0, opacity: 0 };

  const onSliderChange = (field: 'x' | 'y' | 'width' | 'opacity', value: number) => {
    if (editingKf) {
      updateKeyframe(editingKf.id, { [field]: value });
    } else if (!hasKeyframes && selectedClip) {
      if (field === 'x' || field === 'y') {
        setBase({ position: { ...selectedClip.position, [field]: value } });
      } else {
        setBase({ [field]: value } as Partial<Pick<ObjectClip, 'position' | 'width' | 'opacity'>>);
      }
    }
  };

  // ── Tracking: lanzar el tracking del vídeo ──
  // El botón se habilita con sólo vídeo cargado (no requiere región dibujada):
  // si falta la región, el clic da feedback claro en vez de quedar "muerto".
  const canTrack = !!videoSrcUrl && !!videoNativeSize && motion.phase !== 'tracking'
    && (trackEngine === 'pattern' || !!onSam2Track);

  // Convierte un TrackingData en instantes del objeto seleccionado ( posición +
  // escala relativos al frame 0). Devuelve los keyframes creados o null si no
  // hay datos válidos. Comparte la lógica entre el auto-aplicar (tras trackear)
  // y el botón «Aplicar movimiento trackeado».
  const applyMotionToSelected = (data: TrackingData): ObjectKeyframe[] | null => {
    if (!selectedClip || !videoNativeSize) return null;
    const baseX = selectedClip.position.x;
    const baseY = selectedClip.position.y;
    const baseWidthPct = selectedClip.width;
    const kfs = trackingDataToKeyframes(data, {
      videoWidth: videoNativeSize.width,
      videoHeight: videoNativeSize.height,
      clipDuration: selectedClip.duration,
      baseWidthPct,
      baseX,
      baseY,
      sampleStepFrames: sampleStep,
    });
    if (kfs.length === 0) return null;
    // En el frame 0 el keyframe = la posición/tamaño que ya tenía el objeto
    // (delta 0 y escala relativa 1), así que no se "cambia de lugar" ni se hace
    // más grande; a partir de ahí se mueve y escala con el objeto trackeado.
    onUpdateObjectClip(selectedClip.id, {
      keyframes: kfs,
      position: { x: kfs[0].x, y: kfs[0].y },
      width: kfs[0].width,
    });
    return kfs;
  };

  const handleTrack = async () => {
    if (!videoSrcUrl || !videoNativeSize) return;
    // Región a trackear: la dibujada con el botón, o —si no hay— el bbox de la
    // selección activa (lazo/rect/círculo de la pestaña Efectos). Así el lazo
    // que el usuario ya conoce sirve directamente para trackear.
    const region = trackingRegion ?? selectionRegionFallback;
    const usedFallback = !trackingRegion && !!selectionRegionFallback;
    if (!region || region.width < 0.5 || region.height < 0.5) {
      setMotion({ phase: 'error', error: t('videoEditor.objects.drawRegionFirst') });
      onToast?.(t('videoEditor.objects.missingRegionToast'), t('videoEditor.objects.missingRegionToastDesc'));
      return;
    }
    setMotion({ phase: 'tracking', progress: 0 });
    onMotionDataChange?.(null);
    try {
      let data: TrackingData | null = null;
      if (trackEngine === 'sam2') {
        if (!onSam2Track) throw new Error(t('videoEditor.objects.sam2NotAvailable'));
        data = await onSam2Track(region, trackingLazoPath, (p) => setMotion((m) => ({ ...m, progress: Math.round(p * 100) })));
      } else {
        const W = videoNativeSize.width;
        const H = videoNativeSize.height;
        const bbox = {
          x: Math.round((region.x / 100) * W),
          y: Math.round((region.y / 100) * H),
          width: Math.round((region.width / 100) * W),
          height: Math.round((region.height / 100) * H),
        };
        // Tracker local por patrón (sin API Python, sin subir el vídeo a un servidor):
        // extrae los frames con seeks y trackea el parche por correlación ZSAD multiescala.
        const raw = await trackPattern({
          videoUrl: videoSrcUrl,
          videoWidth: W,
          videoHeight: H,
          initialBbox: bbox,
          fps: 30,
          onProgress: () => {},
        });
        // Suavizado robusto en el cliente (mediana para tamaño + media centrada
        // para posición) para que el recuadro se quede pegado al objeto sin
        // temblar lateralmente ni saltar de tamaño.
        data = smoothTrackingData(raw, 4);
      }
      if (!data || !data.centers || data.centers.length === 0) throw new Error(t('videoEditor.objects.noTrackData'));
      const fps = data.fps && data.fps > 0 ? data.fps : 30;
      setMotion({
        phase: 'done',
        data,
        frames: data.centers.length,
        fps,
        durationSec: data.centers.length / fps,
        progress: 100,
      });
      onMotionDataChange?.(data);
      // Ocultar la región y el lazo dibujados: ya cumplieron su función (prompt inicial).
      onTrackingRegionChange?.(null);
      onTrackingLazoPathChange?.(null);
      onDrawingTrackingRegionChange?.(false);
      // Si el lazo de Efectos se usó como región de tracking, ocultarlo para
      // que no se quede estático en el preview una vez creado el movimiento.
      if (usedFallback) onClearSelection?.();
      // Crear ya los instantes del objeto seleccionado para que el usuario pueda
      // modificarlos uno a uno (no sólo un movimiento "oculto"). Si no hay objeto
      // seleccionado, se queda pendiente el botón «Aplicar movimiento trackeado».
      if (selectedClip) {
        const kfs = applyMotionToSelected(data);
        if (kfs && kfs.length > 0) {
          onToast?.(t('videoEditor.objects.motionApplied'), t('videoEditor.objects.motionAppliedDesc', { n: kfs.length }));
          onSeek?.(selectedClip.startTime + kfs[0].time);
        } else {
          onToast?.(t('videoEditor.objects.trackingDone'), t('videoEditor.objects.trackingDoneDesc', { frames: data.centers.length, fps }));
        }
      } else {
        onToast?.(t('videoEditor.objects.trackingDone'), t('videoEditor.objects.trackingDoneDesc2', { frames: data.centers.length, fps }));
      }
    } catch (e: any) {
      setMotion({ phase: 'error', error: e?.message || t('videoEditor.objects.trackingError') });
      onMotionDataChange?.(null);
    }
  };

  // ── Tracking: vincular al objeto seleccionado ──
  const handleApplyToSelected = () => {
    if (!selectedClip || !motion.data || !videoNativeSize) return;
    const kfs = applyMotionToSelected(motion.data);
    if (!kfs) {
      onToast?.(t('videoEditor.objects.noMotion2'), t('videoEditor.objects.noMotionDesc'));
      return;
    }
    onToast?.(t('videoEditor.objects.motionApplied'), t('videoEditor.objects.motionAppliedDesc2', { n: kfs.length }));
    onSeek?.(selectedClip.startTime + kfs[0].time);
  };

  const setRegionField = (field: keyof TrackingRegion, value: number) => {
    if (!onTrackingRegionChange) return;
    const cur = trackingRegion ?? { x: 40, y: 40, width: 20, height: 20 };
    onTrackingRegionChange({ ...cur, [field]: clamp(value, 0, 100) });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto custom-scrollbar-thin space-y-4 mt-14">
      {/* ───────── 1 · Crear movimiento (tracking del vídeo) ───────── */}
      <div className="rounded-xl bg-gray-800/50 border border-cyan-500/25 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2">
            <Crosshair className="w-4 h-4" />
            {t('videoEditor.objects.createMotion')}
          </h4>
          {/* Motor de tracking: SAM2 (IA) o patrón (local) */}
          <div className="flex items-center gap-1 bg-gray-950/60 rounded-lg p-0.5 border border-gray-700">
            <button
              type="button"
              onClick={() => setTrackEngine('sam2')}
              className={`px-2 py-1 text-[10px] uppercase font-bold rounded-md tracking-wider transition-colors ${trackEngine === 'sam2' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              title={t('videoEditor.objects.sam2EngineTitle')}
            >{t('videoEditor.objects.engineSam2')}</button>
            <button
              type="button"
              onClick={() => setTrackEngine('pattern')}
              className={`px-2 py-1 text-[10px] uppercase font-bold rounded-md tracking-wider transition-colors ${trackEngine === 'pattern' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              title={t('videoEditor.objects.patternTitle')}
            >{t('videoEditor.objects.enginePattern')}</button>
          </div>
        </div>

        <p className="text-[10px] text-gray-500 leading-snug">
          {trackEngine === 'sam2'
            ? <>{t('videoEditor.objects.sam2Desc1')} <b>{t('videoEditor.objects.sam2DescOutline')}</b> {t('videoEditor.objects.sam2Desc2')} <b>{t('videoEditor.objects.sam2DescFirstFrame')}</b> {t('videoEditor.objects.sam2Desc3')} <b>{t('videoEditor.objects.trackMotion')}</b>{t('videoEditor.objects.sam2Desc4')}</>
            : <>{t('videoEditor.objects.patternDesc1')} <b>{t('videoEditor.objects.trackMotion')}</b>{t('videoEditor.objects.patternDesc2')}</>}
        </p>

        {trackEngine === 'sam2' && sam2Ready === false && motion.phase !== 'tracking' && (
          <div className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5 leading-snug">
            {t('videoEditor.objects.sam2NotReady')}
          </div>
        )}

        {trackEngine === 'sam2' && (
          <div className="space-y-1.5">
            {/* Servidores (ComfyUI + Bridge, compartidos con LTX/SAM2 de Efectos) */}
            <div className="flex items-center gap-2 bg-gray-950/50 p-1.5 rounded-lg border border-gray-700/50">
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${serverStatus?.comfyui ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'}`} />
                <span className="text-[9px] text-gray-400">{t('videoEditor.selection.sam2Comfyui')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${serverStatus?.fluxBridge ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'}`} />
                <span className="text-[9px] text-gray-400">{t('videoEditor.selection.sam2Bridge')}</span>
              </div>
              <button
                type="button"
                onClick={() => onStartServers?.()}
                disabled={!!isStartingServers || (serverStatus?.comfyui && serverStatus?.fluxBridge)}
                className="ml-auto text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-violet-500/20 text-violet-300 hover:bg-violet-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-violet-500/30"
              >
                {isStartingServers ? t('videoEditor.selection.sam2Starting') : serverStatus?.comfyui && serverStatus?.fluxBridge ? t('videoEditor.selection.sam2Ready') : t('videoEditor.selection.sam2StartServers')}
              </button>
              <button
                type="button"
                onClick={() => onRestartBridge?.()}
                disabled={!!isStartingServers}
                title={t('videoEditor.selection.sam2RestartBridgeTitle')}
                className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-gray-700/40 text-gray-300 hover:bg-gray-600/60 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-gray-600/40"
              >
                {t('videoEditor.selection.sam2RestartBridge')}
              </button>
            </div>
            {serverMessage && (
              <p className={`text-[9px] uppercase tracking-wider ${serverMessage.includes('listo') ? 'text-green-400' : serverMessage.includes('Error') ? 'text-red-400' : 'text-violet-300'}`}>
                {serverMessage}
              </p>
            )}
          </div>
        )}

        {/* Región a trackear */}
        <div className="rounded-lg bg-gray-950/40 border border-white/10 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] text-gray-400 uppercase font-black">{t('videoEditor.objects.regionLabel')}</Label>
            <div className="flex items-center gap-1 bg-gray-900 p-0.5 rounded border border-gray-700 text-[10px]">
              <button
                type="button"
                onClick={() => onTrackingModeChange?.('lazo')}
                className={`px-2 py-0.5 rounded transition ${trackingMode === 'lazo' ? 'bg-cyan-600 text-white font-bold' : 'text-gray-400 hover:text-white'}`}
              >
                {t('videoEditor.objects.lazoOutline')}
              </button>
              <button
                type="button"
                onClick={() => onTrackingModeChange?.('rect')}
                className={`px-2 py-0.5 rounded transition ${trackingMode === 'rect' ? 'bg-cyan-600 text-white font-bold' : 'text-gray-400 hover:text-white'}`}
              >
                {t('videoEditor.selection.shapeRect')}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="space-y-1">
              <span className="text-[9px] text-gray-500">X</span>
              <Input type="number" min={0} max={100} step={0.5} value={trackingRegion?.x ?? 0}
                onChange={(e) => setRegionField('x', Number(e.target.value))} className="bg-gray-950 border-gray-600 text-white h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <span className="text-[9px] text-gray-500">Y</span>
              <Input type="number" min={0} max={100} step={0.5} value={trackingRegion?.y ?? 0}
                onChange={(e) => setRegionField('y', Number(e.target.value))} className="bg-gray-950 border-gray-600 text-white h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <span className="text-[9px] text-gray-500">{t('videoEditor.objects.widthField')}</span>
              <Input type="number" min={1} max={100} step={0.5} value={trackingRegion?.width ?? 0}
                onChange={(e) => setRegionField('width', Number(e.target.value))} className="bg-gray-950 border-gray-600 text-white h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <span className="text-[9px] text-gray-500">{t('videoEditor.objects.heightField')}</span>
              <Input type="number" min={1} max={100} step={0.5} value={trackingRegion?.height ?? 0}
                onChange={(e) => setRegionField('height', Number(e.target.value))} className="bg-gray-950 border-gray-600 text-white h-8 text-xs" />
            </div>
          </div>
          <Button
            size="sm"
            variant={isDrawingTrackingRegion ? 'default' : 'outline'}
            onClick={() => onDrawingTrackingRegionChange?.(!isDrawingTrackingRegion)}
            className={isDrawingTrackingRegion ? 'bg-cyan-600 hover:bg-cyan-500 w-full' : 'border-gray-600 text-gray-200 hover:bg-gray-700 w-full'}
          >
            <Crosshair className="w-3.5 h-3.5 mr-1" />
            {isDrawingTrackingRegion
              ? t('videoEditor.objects.drawing')
              : trackingMode === 'lazo'
                ? t('videoEditor.objects.drawLazo')
                : t('videoEditor.objects.drawRegion')}
          </Button>
          <p className="text-[10px] text-gray-500 leading-snug">
            {trackingMode === 'lazo'
              ? t('videoEditor.objects.lazoHelp')
              : t('videoEditor.objects.rectHelp')}
          </p>
        </div>

        {/* Opciones del tracker */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] text-gray-400 uppercase">{t('videoEditor.objects.sampling')}</Label>
            <Input type="number" min={1} max={60} value={sampleStep}
              onChange={(e) => setSampleStep(clamp(Number(e.target.value) || 5, 1, 60))}
              className="bg-gray-950 border-gray-600 text-white h-9 text-xs" />
          </div>
        </div>

        <Button onClick={handleTrack} disabled={!canTrack} className={`w-full disabled:opacity-40 ${trackEngine === 'sam2' ? 'bg-violet-600 hover:bg-violet-500' : 'bg-cyan-600 hover:bg-cyan-500'}`}>
          {motion.phase === 'tracking' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wand2 className="w-4 h-4 mr-1" />}
          {motion.phase === 'tracking' ? (motion.progress != null && motion.progress > 0 ? t('videoEditor.objects.trackingProgress', { progress: motion.progress }) : t('videoEditor.objects.tracking')) : t('videoEditor.objects.trackMotion')}
        </Button>

        {motion.phase === 'tracking' && motion.progress != null && motion.progress > 0 && (
          <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-violet-500 transition-all" style={{ width: `${Math.max(2, Math.min(100, motion.progress))}%` }} />
          </div>
        )}

        {!canTrack && motion.phase !== 'tracking' && (
          <p className="text-[10px] text-gray-500 leading-snug">
            {!videoSrcUrl ? t('videoEditor.objects.noVideoLoaded2') : ''}
            {trackEngine === 'sam2' && !onSam2Track ? t('videoEditor.objects.sam2Unavailable') : ''}
          </p>
        )}

        {canTrack && !trackingRegion && !selectionRegionFallback && motion.phase !== 'tracking' && motion.phase !== 'error' && (
          <p className="text-[10px] text-amber-300 leading-snug">
            {t('videoEditor.objects.missingRegion')}
          </p>
        )}
        {canTrack && (trackingRegion || selectionRegionFallback) && motion.phase !== 'tracking' && (() => {
          const r = trackingRegion ?? selectionRegionFallback!;
          return (
            <p className="text-[10px] text-emerald-300 leading-snug">
              {t('videoEditor.objects.regionReady', { w: Math.round(r.width), h: Math.round(r.height), extra: trackingRegion ? '' : t('videoEditor.objects.fromLazo') })}
            </p>
          );
        })()}

        {motion.phase === 'error' && (
          <p className="text-[11px] text-red-400 leading-snug">{motion.error}</p>
        )}

        {motion.phase === 'done' && motion.data && (
          <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-[11px] text-emerald-200 leading-snug">
            {t('videoEditor.objects.motionCreated', { frames: motion.frames ?? 0, fps: motion.fps ?? 0, dur: motion.durationSec?.toFixed(2) ?? '0.00' })}
            {selectedClip
              ? t('videoEditor.objects.motionAppliedNote')
              : t('videoEditor.objects.motionSelectNote')}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-gray-800/50 border border-emerald-500/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-emerald-400 uppercase tracking-wider">{t('videoEditor.objects.onScreen')}</h4>
          <span className="text-[10px] text-gray-400">{t('videoEditor.objects.countBadge', { total: objectClips.length, active: activeCount })}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Select value={assetToAddId} onValueChange={setAssetToAddId}>
            <SelectTrigger className="bg-gray-950 border-gray-600 text-white">
              <SelectValue placeholder={t('videoEditor.objects.chooseObject')} />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700 text-white">
              {availableObjects.map((asset) => (
                <SelectItem key={asset.id} value={asset.id}>
                  {asset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={() => {
              const asset = availableObjects.find((item) => item.id === assetToAddId);
              if (asset) onAddObjectClip(asset);
            }}
            disabled={!assetToAddId}
            className="whitespace-nowrap"
          >
            <ImagePlus className="w-4 h-4 mr-1" />
            {t('videoEditor.objects.addObject')}
          </Button>
        </div>
        <p className="text-[11px] text-gray-500">{t('videoEditor.objects.dragHint')}</p>
      </div>

      <div className="space-y-2">
          {objectClips.map((clip) => {
          const isSelected = clip.id === selectedObjectId;
          const isActive = currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration;
          return (
            <div
              key={clip.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectObject(clip.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectObject(clip.id); } }}
              className={`w-full text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                isSelected
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : isActive
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : 'border-gray-700 bg-gray-800/40 hover:border-gray-500'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{clip.name}</div>
                  <div className="text-[11px] text-gray-400">
                    {clip.startTime.toFixed(1)}s - {(clip.startTime + clip.duration).toFixed(1)}s
                    {clip.keyframes && clip.keyframes.length > 0 && (
                      <span className="ml-2 text-emerald-400">· {t('videoEditor.objects.kfCount', { n: clip.keyframes.length })}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateObjectClip(clip.id, { visible: clip.visible === false ? true : false });
                    }}
                    className={`p-1 rounded border border-white/5 transition-colors ${clip.visible === false ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-emerald-400'}`}
                    title={clip.visible === false ? t('videoEditor.objects.showObject') : t('videoEditor.objects.hideObject')}
                  >
                    {clip.visible === false ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <Move className="w-4 h-4 text-gray-500 shrink-0" />
                </div>
              </div>
            </div>
          );
        })}
        {objectClips.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-700 p-6 text-center text-sm text-gray-500">
            {t('videoEditor.objects.noObjects')}
          </div>
        )}
      </div>

      {selectedClip && (
        <div className="rounded-xl bg-gray-800/50 border border-white/10 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-bold text-white uppercase tracking-wider truncate">{selectedClip.name}</h4>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => onMoveObjectLayer(selectedClip.id, 'back')}
                title={t('videoEditor.objects.sendBack')}
                className="rounded-md border border-gray-700 bg-gray-900/60 p-1.5 text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                <SendToBack className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onMoveObjectLayer(selectedClip.id, 'backward')}
                title={t('videoEditor.objects.backOne')}
                className="rounded-md border border-gray-700 bg-gray-900/60 p-1.5 text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onMoveObjectLayer(selectedClip.id, 'forward')}
                title={t('videoEditor.objects.fwdOne')}
                className="rounded-md border border-gray-700 bg-gray-900/60 p-1.5 text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onMoveObjectLayer(selectedClip.id, 'front')}
                title={t('videoEditor.objects.bringFront')}
                className="rounded-md border border-gray-700 bg-gray-900/60 p-1.5 text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                <BringToFront className="h-3.5 w-3.5" />
              </button>
              <Button size="sm" variant="destructive" onClick={() => onDeleteObjectClip(selectedClip.id)}>
                <Trash2 className="w-4 h-4 mr-1" />
                {t('videoEditor.objects.delete')}
              </Button>
            </div>
          </div>

          {/* ───────── 2 · Vincular movimiento trackeado ───────── */}
          <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-cyan-400" />
              <h5 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">{t('videoEditor.objects.linkTitle')}</h5>
            </div>
            <p className="text-[11px] text-gray-400 leading-snug">
              {motion.phase === 'done' && motion.data
                ? t('videoEditor.objects.linkDone')
                : t('videoEditor.objects.linkIdle')}
            </p>
            <Button
              onClick={handleApplyToSelected}
              disabled={motion.phase !== 'done' || !motion.data}
              className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40"
            >
              <Wand2 className="w-4 h-4 mr-1" />
              {t('videoEditor.objects.applyMotion')}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-emerald-400 font-bold mb-2 block uppercase">{t('videoEditor.objects.startTime')}</Label>
              <Input
                type="number"
                min="0"
                max={videoDuration}
                step="0.1"
                value={selectedClip.startTime}
                onChange={(e) => onUpdateObjectClip(selectedClip.id, { startTime: Number(e.target.value) })}
                className="bg-gray-950 border-gray-600 text-white"
              />
            </div>
            <div>
              <Label className="text-xs text-emerald-400 font-bold mb-2 block uppercase">{t('videoEditor.objects.duration')}</Label>
              <Input
                type="number"
                min="0.1"
                max={Math.max(0.1, videoDuration - selectedClip.startTime)}
                step="0.1"
                value={selectedClip.duration}
                onChange={(e) => onUpdateObjectClip(selectedClip.id, { duration: Number(e.target.value) })}
                className="bg-gray-950 border-gray-600 text-white"
              />
            </div>
          </div>

          {/* Mandos de arriba: posición / tamaño / opacidad.
              - Sin instantes: editan la base del objeto.
              - Editando un instante: editan EN VIVO ese instante (el objeto se mueve a la vez). */}
          {showSliders ? (
            <>
              {editingKf && (
                <div className="rounded-md bg-emerald-500/10 border border-emerald-500/40 px-3 py-1.5 text-[11px] text-emerald-200">
                  {t('videoEditor.objects.editingKfNote', { time: (selectedClip.startTime + editingKf.time).toFixed(1) })}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-[10px] text-gray-500 uppercase font-black">{t('videoEditor.text.posX', { value: sliderVals.x.toFixed(0) })}</Label>
                  <Slider
                    value={[sliderVals.x]}
                    onValueChange={([value]) => onSliderChange('x', value)}
                    min={0}
                    max={100}
                    step={1}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] text-gray-500 uppercase font-black">{t('videoEditor.text.posY', { value: sliderVals.y.toFixed(0) })}</Label>
                  <Slider
                    value={[sliderVals.y]}
                    onValueChange={([value]) => onSliderChange('y', value)}
                    min={0}
                    max={100}
                    step={1}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] text-gray-500 uppercase font-black">{t('videoEditor.objects.sizeLabel', { value: sliderVals.width.toFixed(0) })}</Label>
                <Slider
                  value={[sliderVals.width]}
                  onValueChange={([value]) => onSliderChange('width', value)}
                  min={5}
                  max={95}
                  step={1}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] text-gray-500 uppercase font-black">{t('videoEditor.text.opacity', { value: sliderVals.opacity.toFixed(0) })}</Label>
                <Slider
                  value={[sliderVals.opacity]}
                  onValueChange={([value]) => onSliderChange('opacity', value)}
                  min={0}
                  max={100}
                  step={1}
                />
              </div>
              <div className="flex items-center justify-between gap-3 py-1 rounded-lg bg-gray-950/40 border border-white/10 px-3">
                <div className="flex-1">
                  <Label className="text-[10px] text-gray-300 uppercase font-black block">{t('videoEditor.objects.mirror')}</Label>
                  <p className="text-[9px] text-gray-500 mt-0.5">{t('videoEditor.objects.mirrorHelp')}</p>
                </div>
                <Switch
                  checked={!!selectedClip.mirrored}
                  onCheckedChange={(v) => onUpdateObjectClip(selectedClip.id, { mirrored: v })}
                />
              </div>
              {selectedClip.mediaType === 'video' && (
                <div className="flex items-center justify-between gap-3 py-1 rounded-lg bg-gray-950/40 border border-white/10 px-3">
                  <div className="flex-1">
                    <Label className="text-[10px] text-gray-300 uppercase font-black block">{t('videoEditor.objects.syncTitle')}</Label>
                    <p className="text-[9px] text-gray-500 mt-0.5">{t('videoEditor.objects.syncHelp')}</p>
                  </div>
                  <Switch
                    checked={!!selectedClip.syncToTimeline}
                    onCheckedChange={(v) => onUpdateObjectClip(selectedClip.id, { syncToTimeline: v })}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg bg-gray-950/40 border border-white/10 px-3 py-2 text-[11px] text-gray-400 leading-snug">
              {t('videoEditor.objects.keyframesNote')}
            </div>
          )}

          {/* Sección de instantes (fotogramas clave) */}
          <div className="rounded-lg bg-gray-950/50 border border-emerald-500/30 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                <h5 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">{t('videoEditor.objects.motionTitle')}</h5>
              </div>
              {!editingKf && (
                <>
                  <Button
                    size="sm"
                    onClick={startNewKeyframe}
                    className="whitespace-nowrap"
                    title={t('videoEditor.text.newKfTitle')}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    {t('videoEditor.text.createKf', { time: (selectedClip.startTime + currentLocalTime).toFixed(1) })}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={copyPreviousKeyframe}
                    className="whitespace-nowrap border-gray-600 text-gray-300 hover:bg-gray-700"
                    title={t('videoEditor.objects.copyKfTitle')}
                  >
                    <Copy className="w-3.5 h-3.5 mr-1" />
                    {t('videoEditor.objects.copyKf')}
                  </Button>
                </>
              )}
            </div>

            <div className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-2 text-[11px] text-emerald-200 leading-snug">
              <b>{t('videoEditor.objects.kfHelp1')}</b> {t('videoEditor.objects.kfHelp2')} {t('videoEditor.objects.kfHelp3')}
            </div>

            {/* Formulario de edición del instante (en vivo) */}
            {editingKf && (
              <div className="rounded-md border border-emerald-500/60 bg-emerald-500/5 p-3 space-y-3">
                <div className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">
                  {isNewKf ? t('videoEditor.text.newKf') : t('videoEditor.text.editingKf')}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[9px] text-gray-400 uppercase">{t('videoEditor.text.kfMinute')}</Label>
                    <Input
                      type="number"
                      min={selectedClip.startTime}
                      max={selectedClip.startTime + selectedClip.duration}
                      step="0.1"
                      value={Number((selectedClip.startTime + editingKf.time).toFixed(1))}
                      onChange={(e) => {
                        const newTime = clamp(Number(e.target.value) - selectedClip.startTime, 0, selectedClip.duration);
                        updateKeyframe(editingKf.id, { time: newTime });
                        onSeek?.(selectedClip.startTime + newTime); // cursor sigue al instante => mandos en vivo
                      }}
                      className="bg-gray-950 border-gray-600 text-white h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[9px] text-gray-400 uppercase">{t('videoEditor.text.kfOpacity')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="1"
                      value={editingKf.opacity}
                      onChange={(e) => updateKeyframe(editingKf.id, { opacity: clamp(Number(e.target.value), 0, 100) })}
                      className="bg-gray-950 border-gray-600 text-white h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[9px] text-gray-400 uppercase">{t('videoEditor.text.kfPosX')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="1"
                      value={editingKf.x}
                      onChange={(e) => updateKeyframe(editingKf.id, { x: clamp(Number(e.target.value), 0, 100) })}
                      className="bg-gray-950 border-gray-600 text-white h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[9px] text-gray-400 uppercase">{t('videoEditor.text.kfPosY')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="1"
                      value={editingKf.y}
                      onChange={(e) => updateKeyframe(editingKf.id, { y: clamp(Number(e.target.value), 0, 100) })}
                      className="bg-gray-950 border-gray-600 text-white h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-[9px] text-gray-400 uppercase">{t('videoEditor.objects.kfSizePct')}</Label>
                    <Input
                      type="number"
                      min={5}
                      max={95}
                      step={1}
                      value={editingKf.width}
                      onChange={(e) => updateKeyframe(editingKf.id, { width: clamp(Number(e.target.value), 5, 95) })}
                      className="bg-gray-950 border-gray-600 text-white h-8 text-xs"
                    />
                  </div>

                {/* Coordenadas de los 4 vértices (corners) — numerados 1-4 */}
                {editingKf.corners && editingKf.corners.length === 4 && (
                  <div className="col-span-2 space-y-2 mt-2">
                    <Label className="text-[9px] text-gray-400 uppercase font-black">{t('videoEditor.objects.cornersLabel')}</Label>
                    <div className="grid grid-cols-4 gap-2 text-[10px] text-gray-400 mb-1">
                      <span>{t('videoEditor.objects.corner1')}</span>
                      <span>{t('videoEditor.objects.corner2')}</span>
                      <span>{t('videoEditor.objects.corner3')}</span>
                      <span>{t('videoEditor.objects.corner4')}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {editingKf.corners.map((corner, idx) => (
                        <div key={idx} className="flex gap-1">
                          <Input
                            type="number"
                            min={-200}
                            max={200}
                            step={0.1}
                            value={corner.x}
                            onChange={(e) => {
                              const next = [...editingKf.corners!];
                              next[idx] = { ...next[idx], x: Number(e.target.value) };
                              updateKeyframe(editingKf.id, { corners: next });
                            }}
                            className="bg-gray-950 border-gray-600 text-white h-8 text-xs w-1/2"
                          />
                          <Input
                            type="number"
                            min={-200}
                            max={200}
                            step={0.1}
                            value={corner.y}
                            onChange={(e) => {
                              const next = [...editingKf.corners!];
                              next[idx] = { ...next[idx], y: Number(e.target.value) };
                              updateKeyframe(editingKf.id, { corners: next });
                            }}
                            className="bg-gray-950 border-gray-600 text-white h-8 text-xs w-1/2"
                          />
                        </div>
                      ))}
                    </div>
                    <p className="text-[9px] text-gray-500">{t('videoEditor.objects.cornersHelp')}</p>
                  </div>
                )}
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button size="sm" variant="ghost" onClick={cancelEditing} className="text-gray-300">
                    <X className="w-3.5 h-3.5 mr-1" />
                    {t('videoEditor.text.cancel')}
                  </Button>
                  <Button size="sm" onClick={finishEditing} className="bg-emerald-600 hover:bg-emerald-500">
                    <Save className="w-3.5 h-3.5 mr-1" />
                    {t('videoEditor.text.save')}
                  </Button>
                </div>
              </div>
            )}

            {/* Lista de instantes guardados */}
            {!editingKf && sortedKeyframes.length > 0 && (
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {sortedKeyframes.map((kf, idx) => (
                  <div
                    key={kf.id}
                    className="rounded-md border border-gray-700 bg-gray-900/40 p-2"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[10px] text-emerald-400 uppercase font-black">
                        {t('videoEditor.text.kfBadge', { n: idx + 1, time: (selectedClip.startTime + kf.time).toFixed(1) })}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEditKeyframe(kf)}
                          className="h-7 px-2 text-gray-300 hover:text-emerald-400"
                          title={t('videoEditor.text.editKfTitle')}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteKeyframe(kf.id)}
                          className="h-7 px-2 text-gray-400 hover:text-red-400"
                          title={t('videoEditor.text.deleteKfTitle')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 text-[11px] text-gray-300">
                      <span>{t('videoEditor.text.posX', { value: Math.round(kf.x) })}</span>
                      <span>{t('videoEditor.text.posY', { value: Math.round(kf.y) })}</span>
                      <span>{t('videoEditor.objects.kfSizeShort2', { value: Math.round(kf.width) })}</span>
                      <span>{t('videoEditor.text.kfOpacityShort', { value: Math.round(kf.opacity) })}</span>
                    </div>
                    {kf.corners && kf.corners.length === 4 && (
                      <div className="grid grid-cols-4 gap-1.5 text-[10px] text-gray-400 mt-1">
                        {kf.corners.map((c, ci) => (
                          <span key={ci} title={t('videoEditor.objects.vertexTitle', { n: ci + 1 })}>{t('videoEditor.objects.vertexBadge', { n: ci + 1, x: c.x.toFixed(1), y: c.y.toFixed(1) })}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!editingKf && sortedKeyframes.length === 0 && (
              <p className="text-[11px] text-gray-500 leading-snug">
                {t('videoEditor.text.noMotion')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}