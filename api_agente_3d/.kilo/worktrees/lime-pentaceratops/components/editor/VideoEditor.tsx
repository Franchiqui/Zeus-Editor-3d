'use client';

import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback, useTransition } from 'react';
import { createPortal } from 'react-dom';
import JSZip from 'jszip';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { VideoEditState, TimelineState, TimelineTrack, TimelineClip, TrackType, TextClip, ObjectClip, ObjectKeyframe, VideoOverlay, TransitionType, VideoCropState, VideoSelectionState, VideoPaintState, SelectionShape, SelectionKeyframe, BezierAnchor } from '@/types';
import Timeline from '@/components/editor/Timeline';
import TimelinePlayer from '@/components/editor/TimelinePlayer';
import TimelinePreview from '@/components/editor/TimelinePreview';
import FontPreview, { FontStyle, SavedTextPreset } from '@/components/editor/FontEditor';
import FileUploader from '@/components/ui/file-uploader';
import VideoTextEditor from '@/components/editor/VideoTextEditor';
import VideoObjectEditor, { type TrackingRegion } from '@/components/editor/VideoObjectEditor';
import { smoothTrackingData, extractMaskContourFromImageData, contourToSvgPath, transformLazoForFrame } from '@/lib/video-tracking';
import { trackingDataToKeyframes } from '@/lib/video-tracking';
import type { TrackingData } from '@/lib/video-tracking';
import { trackPattern } from '@/lib/pattern-track';
import TextOverlay from '@/components/editor/TextOverlay';
import ObjectOverlay from '@/components/editor/ObjectOverlay';
import ObjectOverlay2 from '@/components/editor/ObjectOverlay-2';
import EffectsOverlay from '@/components/editor/EffectsOverlay';
import CropOverlay from '@/components/editor/CropOverlay';
import SelectionOverlay from '@/components/editor/SelectionOverlay';
import PaintOverlay from '@/components/editor/PaintOverlay';
import ScreenshotCapture from '@/components/editor/ScreenshotCapture';
import { Upload, Plus, Video, FileVideo, FileAudio, FileImage, X, Download, Volume2, VolumeX, Settings, Scissors, Check, RefreshCw, FolderOpen, Loader2, Film, Save, Folder, ZoomIn, ZoomOut, Maximize, Play, Pause, Trash2, Clock, Calendar, ArrowRightLeft, Layers, HardDrive, ChevronLeft, ChevronRight, Music, Sparkles, Presentation, ArrowUp, ArrowDown, ImagePlus, Link, Database, Grid3x3, List, SkipBack, SkipForward, Gauge, Square, Camera, Hand, Copy, ClipboardPaste, Palette, Code2, Circle, Spline, PenTool, Eye, EyeOff, Paintbrush, PaintBucket, Pipette, Eraser, Wand2, FileArchive, Globe, Crosshair, KeyRound, Pencil, Repeat } from 'lucide-react';
import pb from '@/lib/pocketbase';
import { Modal } from '@/components/ui/modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAIEditorBridgeOptional } from '@/components/AIEditorBridgeContext';
import { useChatContext } from '@/components/ChatContext';
import { EditorFileNameBar } from '@/components/ui/EditorFileNameBar';
import { cn, cleanDisplayFileName, cleanTextForTTS } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { copyText } from '@/lib/clipboard';
import { deconstructGIF, type FrameData } from '@/lib/gif-utils';
import { getObjectValuesAtTime, getObjectOpacityAtTime, getFadeMultiplierAtTime, defaultCorners } from '@/lib/object-keyframes';
import { fixWebmDurationBlob } from '@/lib/webm-duration-fix';
import { mapClipLocalToSource as mapClipLocalToSourceFn, mapSourceToClipLocal as mapSourceToClipLocalFn } from '@/lib/clip-time';
import { effectiveSelectionShape, effectiveSelectionShapeForPaint, effectiveSelectionMaskUrl, effectiveSelectionMotionPaths, upsertSelectionKeyframe, upsertSelectionMotionPath, removeSelectionKeyframeAt, getSelectionBoxAtTime, pathsBBox, transformPaths, hasMotionSilhouette } from '@/lib/selection-keyframes';
import { floodFillMask } from '@/lib/wand-mask';
import { evictMaskImage, setMaskOverride, clearMaskOverride, clearAllMaskOverrides, loadMaskImage } from '@/lib/video-render/selection-mask-cache';
import { buildSelectionPath, buildSelectionPaths } from '@/lib/video-render/composite/selection-path';
import { CanvasRenderer } from '@/lib/video-render/canvas-renderer';
import { buildScene } from '@/lib/video-render/scene-builder';
import { SceneExporter, type ExportFormat, type ExportQuality } from '@/lib/video-render/scene-exporter';
import { videoCache } from '@/lib/video-render/video-cache/service';
import { buildTimelineAudioBuffer } from '@/lib/video-render/composite/audio-mixer';
import { getObjectImage, isImageReady, getObjectVideoDuration } from '@/lib/video-render/composite/object-media';
import type { RootNode } from '@/lib/video-render/nodes/root-node';
import { getSlideEffect, getAllEffects, createCustomEffectFromFile, loadCustomEffectsFromStorage, loadCustomEffectsFromProjectData, getSerializableCustomEffects, removeCustomEffectAndSave, type SlideEffectId } from '@/lib/slide-effects';
import { createOverlayObjectFromFile, registerOverlayObject, saveOverlayObjectsToStorage, getOverlayObjects, getSerializableOverlayObjects, loadOverlayObjectsFromProjectData, loadOverlayObjectsFromStorage, removeOverlayObjectAndSave, type OverlayObjectAsset } from '@/lib/overlay-objects';
import { ZeusMultieditorAPI } from '@/lib/sdk/client';
import { ZeusProject } from '@/lib/sdk/types';
import { getLocalPaths, listDirectory, getMediaUrl, readProject, saveProject, writeFile, copyFile, ensureDir, getFilePath, readFile, readFileBuffer, transcodeVideo, enhanceVideo, htmlToMp4, startComfyUI, startFluxBridge, stopFluxBridge, getServerStatus, isElectron } from '@/lib/electron-fs';

const LOCAL_BRIDGE_URL = process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://localhost:4001';
const LOCAL_SERVER_URL = process.env.NEXT_PUBLIC_LOCAL_SERVER_URL || 'http://localhost:3003';

const api = new ZeusMultieditorAPI(LOCAL_BRIDGE_URL);
const LOCAL_UPLOAD_ENDPOINT = `${LOCAL_BRIDGE_URL}/api/local/upload`;

const EFFECTS_TRACK_NAME = 'Pista de efectos';
const SAVED_TEXTS_STORAGE_KEY = 'zeus-saved-texts';

// Presets de proporción para el recorte de pantalla / zona de exportación.
// aspect = "W:H"; targetAspect = W/H.
const CROP_PRESETS: { aspect: string; label: string }[] = [
  { aspect: '16:9', label: '16:9 · YouTube' },
  { aspect: '9:16', label: '9:16 · Shorts / TikTok' },
  { aspect: '1:1', label: '1:1 · Instagram' },
  { aspect: '4:3', label: '4:3 · Clásico' },
  { aspect: '3:2', label: '3:2 · Foto' },
  { aspect: '21:9', label: '21:9 · Cine' },
  { aspect: '5:4', label: '5:4 · Monitor' },
];

// Etiquetas localizables de los presets (sufijos traducidos por idioma).
const getCropPresetLabels = (t: (key: string) => string): Record<string, string> => ({
  '4:3': t('videoEditor.crop.presetClassic'),
  '3:2': t('videoEditor.crop.presetPhoto'),
  '21:9': t('videoEditor.crop.presetCinema'),
  '5:4': t('videoEditor.crop.presetMonitor'),
});

function parseCropAspect(aspect: string | null): number | null {
  if (!aspect) return null;
  const m = aspect.split(':');
  if (m.length !== 2) return null;
  const w = parseFloat(m[0]);
  const h = parseFloat(m[1]);
  if (!isFinite(w) || !isFinite(h) || h === 0) return null;
  return w / h;
}

// Rectángulo por defecto centrado con `targetAspect` dentro de un cuadro de
// proporción `boxAspect` (w/h). width%/height% cumplen (width/height)*boxAspect = targetAspect.
function defaultCropRectForAspect(targetAspect: number, boxAspect: number | null): { x: number; y: number; width: number; height: number } {
  const box = boxAspect && boxAspect > 0 ? boxAspect : targetAspect;
  const r = targetAspect / box; // width = height * r
  // parte de un 80% de la dimensión menor y recorta si se pasa de 100
  let height = 80;
  let width = height * r;
  if (width > 100) { width = 100; height = width / r; }
  if (height > 100) { height = 100; width = height * r; }
  const x = (100 - width) / 2;
  const y = (100 - height) / 2;
  return { x, y, width, height };
}

// Formatea segundos como H:M:S (horas sin relleno, minutos y segundos a 2 dígitos).
// Formato ÚNICO de tiempo de toda la app: timeline, rango temporal, keyframes, SAM2...
function fmtHMS(total: number): string {
  if (!isFinite(total) || total < 0) total = 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
// Parsea "h:m:s" (o "m:s", o "s" suelto) a segundos. Devuelve null si no es válido.
function parseHMS(str: string): number | null {
  const t = str.trim();
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length === 1) {
    const n = parseFloat(parts[0]);
    return isFinite(n) ? n : null;
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]);
    const s = parseFloat(parts[1]);
    if (!isFinite(m) || !isFinite(s)) return null;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    if (!isFinite(h) || !isFinite(m) || !isFinite(s)) return null;
    return h * 3600 + m * 60 + s;
  }
  return null;
}
// Función para obtener la URL base según el entorno
function getBaseUrl(): string {
  // Si estamos en desarrollo, usar localhost
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:3003';
  }
  // Si estamos en producción, usar el servidor local configurado
  return LOCAL_SERVER_URL;
}

const BASE_URL = getBaseUrl();

function sortVerticesClockwise(verts: Array<{ x: number; y: number } | null>): Array<{ x: number; y: number } | null> {
  const valid = verts.filter((v): v is { x: number; y: number } => v !== null);
  if (valid.length === 0) return verts;
  const cx = valid.reduce((s, v) => s + v.x, 0) / valid.length;
  const cy = valid.reduce((s, v) => s + v.y, 0) / valid.length;
  // En coordenadas de pantalla (Y↓), ordenar por ángulo atan2 en sentido
  // antihorario (ángulos crecientes) y rotar para que el punto más alto (Y mínima)
  // quede primero. Resultado canónico: [sup-izq, sup-der, inf-der, inf-izq].
  const withAngle = valid.map(v => ({ v, a: Math.atan2(v.y - cy, v.x - cx) }));
  withAngle.sort((a, b) => a.a - b.a);
  // Encontrar el punto más alto (Y mínima) y rotar para que quede en primer lugar.
  let startIdx = 0;
  let minY = withAngle[0].v.y;
  for (let i = 1; i < withAngle.length; i++) {
    if (withAngle[i].v.y < minY) { minY = withAngle[i].v.y; startIdx = i; }
  }
  const ordered = [...withAngle.slice(startIdx), ...withAngle.slice(0, startIdx)];
  const sorted: Array<{ x: number; y: number } | null> = Array(verts.length).fill(null);
  ordered.forEach((p, i) => { sorted[i] = p.v; });
  return sorted;
}

function vertexPositionLabel(index: number): string {
  const labels = ['Superior izquierdo', 'Superior derecho', 'Inferior derecho', 'Inferior izquierdo'];
  return labels[index] ?? `Vértice ${index + 1}`;
}

// Cache de aspecto (naturalWidth/naturalHeight) de las imágenes de objetos, por
// src. Necesario para que la caja de la homografía comparta el aspecto de la
// imagen y las 4 esquinas de esta caigan exactas en los 4 vértices.
const objectAspectCache = new Map<string, number>();
function loadObjectAspect(src: string): Promise<number> {
  const cached = objectAspectCache.get(src);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const ar = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
      objectAspectCache.set(src, ar);
      resolve(ar);
    };
    img.onerror = () => {
      // Fallback para objetos vídeo (un <img> no puede cargar vídeo): medir el
      // aspect desde el metadata del <video>.
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const ar = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1;
        objectAspectCache.set(src, ar);
        resolve(ar);
      };
      video.onerror = () => {
        objectAspectCache.set(src, 1);
        resolve(1);
      };
      video.src = src;
    };
    img.src = src;
  });
}

/**
 * Spline cúbica monótona (Fritsch–Carlson) sobre una serie de (times, vals).
 * Devuelve un muestreador sample(t) que interpola SUAVEMENTE entre los puntos,
 * pasa exacto por cada uno y NUNCA sobrepasa (monótona por tramos). Con 2 puntos
 * es lineal; con 3+ aplica una curva que suaviza entradas/salidas según el tipo
 * de movimiento. Usado para generar 1 instante por frame entre las marcas de
 * vértice (movimiento + escala suaves, no lineales a palo).
 */
function makeMonotoneCubic(times: number[], vals: number[]): (t: number) => number {
  const n = times.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => vals[0];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = times[i + 1] - times[i];
    slope.push(dx !== 0 ? (vals[i + 1] - vals[i]) / dx : 0);
  }
  const m = new Array<number>(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) m[i] = 0; // extremo local o plano
    else m[i] = (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; }
    else {
      const a = m[i] / slope[i], b = m[i + 1] / slope[i];
      const r = a * a + b * b;
      if (r > 9) {
        const tau = 3 / Math.sqrt(r);
        m[i] = tau * a * slope[i];
        m[i + 1] = tau * b * slope[i];
      }
    }
  }
  return (t: number) => {
    if (t <= times[0]) return vals[0];
    if (t >= times[n - 1]) return vals[n - 1];
    let i = 0;
    while (i < n - 2 && t > times[i + 1]) i++;
    const dx = times[i + 1] - times[i];
    const tt = dx > 0 ? (t - times[i]) / dx : 0;
    const h00 = 2 * tt * tt * tt - 3 * tt * tt + 1;
    const h10 = tt * tt * tt - 2 * tt * tt + tt; // tt^3 - 2tt^2 + tt
    const h01 = -2 * tt * tt * tt + 3 * tt * tt; // -2tt^3 + 3tt^2
    const h11 = tt * tt * tt - tt * tt; // tt^3 - tt^2
    return h00 * vals[i] + h10 * dx * m[i] + h01 * vals[i + 1] + h11 * dx * m[i + 1];
  };
}

const MIME_EXTENSION_MAP: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

const getExtensionFromMime = (mime: string) => MIME_EXTENSION_MAP[mime] || mime.split('/')[1] || 'bin';

const sanitizeFileSegment = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$|/g, '')
    .slice(0, 30);

type GeneratedAudioAsset = {
  blob: Blob;
  voice: string;
  text: string;
  fileName: string;
};

const createGeneratedAudioFileName = (voice: string, text: string, mime: string, sequence: number) => {
  const snippetSource = cleanTextForTTS(text).slice(0, 40) || 'clip';
  const snippet = sanitizeFileSegment(snippetSource) || 'clip';
  const voiceSegment = sanitizeFileSegment(voice || 'voz') || 'voz';
  const extension = getExtensionFromMime(mime);
  return `texto-a-audio_${voiceSegment}_${snippet}_${sequence}.${extension}`;
};

const buildGeneratedAssetFile = (asset: GeneratedAudioAsset) => new File([asset.blob], asset.fileName, { type: asset.blob.type });

function loadAudioMetadata(url: string): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.style.display = 'none';
    audio.preload = 'metadata';
    audio.src = url;
    document.body.appendChild(audio);
    const cleanup = () => {
      try { document.body.removeChild(audio); } catch {}
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout cargando audio'));
    }, 10000);
    audio.onloadedmetadata = () => {
      clearTimeout(timer);
      const duration = isFinite(audio.duration) ? audio.duration : 0;
      cleanup();
      resolve({ duration });
    };
    audio.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('Error cargando audio'));
    };
  });
}

function loadVideoMetadata(url: string): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.style.display = 'none';
    video.preload = 'metadata';
    video.src = url;
    document.body.appendChild(video);
    const cleanup = () => {
      try { document.body.removeChild(video); } catch {}
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout cargando video'));
    }, 15000);
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      const duration = isFinite(video.duration) ? video.duration : 0;
      cleanup();
      resolve({ duration });
    };
    video.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('Error cargando video'));
    };
    video.load();
  });
}

const replaceGeneratedAssetUrl = (url: string | undefined | null, metadata: Map<string, string>) => {
  if (!url) return url;
  const mapped = metadata.get(url);
  if (mapped) return `assets/${mapped}`;
  return url;
};

const sanitizeEditStateForProjectSave = (state: VideoEditState, metadata: Map<string, string>) => {
  if (metadata.size === 0) return state;
  const cloned: VideoEditState = JSON.parse(JSON.stringify(state));
  const sanitizeClip = (clip: any) => {
    clip.mediaFileId = replaceGeneratedAssetUrl(clip.mediaFileId, metadata);
    clip.thumbnailUrl = replaceGeneratedAssetUrl(clip.thumbnailUrl, metadata);
  };
  cloned.timeline?.tracks?.forEach((track) => {
    track.clips?.forEach(sanitizeClip);
  });
  cloned.objectClips?.forEach((objectClip: any) => {
    objectClip.src = replaceGeneratedAssetUrl(objectClip.src, metadata);
  });
  return cloned;
};
function isEffectsTrack(track: TimelineTrack) {
  return track.name === EFFECTS_TRACK_NAME;
}

function createEffectsTrack(): TimelineTrack {
  return {
    id: `video-effects-${Date.now()}`,
    type: 'video',
    name: EFFECTS_TRACK_NAME,
    clips: [],
    isLocked: false,
  };
}

function placeEffectsTrackBelowMainVideo(tracks: TimelineTrack[]) {
  const effectsTracks = tracks.filter(isEffectsTrack);
  if (effectsTracks.length === 0) return tracks;

  const nonEffectsTracks = tracks.filter((track) => !isEffectsTrack(track));
  const mainVideoIndex = nonEffectsTracks.findIndex((track) => track.id === 'video-1');
  const insertAt = mainVideoIndex >= 0 ? mainVideoIndex + 1 : 0;

  return [
    ...nonEffectsTracks.slice(0, insertAt),
    ...effectsTracks,
    ...nonEffectsTracks.slice(insertAt),
  ];
}

function isPlayableVideoClip(clip: TimelineClip): clip is TimelineClip & { mediaFileId: string } {
  return (clip.type === 'video' || clip.type === 'image') && !!clip.mediaFileId && !clip.overlayKind;
}

/** Estado de edición vacío (sin clips, sin efectos, sin selección, sin crop, sin texto/objetos). */
function createDefaultEditState(): VideoEditState {
  const defaultTracks: TimelineTrack[] = [
    {
      id: 'video-1',
      type: 'video' as TrackType,
      name: 'Vídeo Principal',
      clips: [],
      isLocked: false
    },
    {
      id: 'audio-1',
      type: 'audio' as TrackType,
      name: 'Audio Principal',
      clips: [],
      isMuted: false,
      isLocked: false,
      volume: 1
    },
    {
      id: 'text-1',
      type: 'text' as TrackType,
      name: 'Texto/Superposiciones',
      clips: [],
      isLocked: false
    },
    {
      id: 'image-1',
      type: 'image' as TrackType,
      name: 'Pista de Imagen',
      clips: [],
      isLocked: false
    }
  ];

  const tracks = placeEffectsTrackBelowMainVideo(defaultTracks);

  return {
    trimStart: 0,
    trimEnd: 0,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    hue: 0,
    blur: 0,
    intensity: 0,
    textClips: [],
    objectClips: [],
    videoOverlay: null,
    timeline: {
      duration: 60,
      currentTime: 0,
      zoom: 160,
      tracks
    }
  };
}

/** Genera un Blob con solo el fragmento del video entre trimStart y trimEnd (para guardar en lugar del video completo). */
function getTrimmedVideoBlob(videoUrl: string, trimStart: number, trimEnd: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    if (videoUrl.startsWith('http')) video.crossOrigin = 'anonymous';
    video.muted = false;
    video.preload = 'auto';
    video.playsInline = true;

    const cleanup = () => {
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('ended', onEnded);
      if (video.parentNode) video.parentNode.removeChild(video);
      video.src = '';
    };

    const onError = () => {
      cleanup();
      reject(new Error('Error al cargar el video para recorte'));
    };

    const onLoaded = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      const duration = video.duration;
      const start = Math.max(0, trimStart);
      const end = Math.min(duration, trimEnd);
      if (end <= start) {
        cleanup();
        reject(new Error('Rango de recorte inválido'));
        return;
      }
      video.style.position = 'fixed';
      video.style.left = '-9999px';
      video.style.pointerEvents = 'none';
      document.body.appendChild(video);
      video.currentTime = start;
      video.addEventListener('seeked', onSeeked, { once: true });
    };

    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      let stream: MediaStream | undefined;
      try {
        stream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.() ??
          (video as HTMLVideoElement & { mozCaptureStream?: () => MediaStream }).mozCaptureStream?.();
      } catch (e) {
        cleanup();
        reject(e);
        return;
      }
      if (!stream || !stream.getVideoTracks().length) {
        cleanup();
        reject(new Error('No se pudo capturar el stream del video'));
        return;
      }
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' :
        MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2500000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        cleanup();
        resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
      };
      recorder.onerror = () => {
        cleanup();
        reject(new Error('Error al grabar el fragmento'));
      };
      recorder.start(100);
      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('ended', onEnded);
      const endTime = Math.min(video.duration, trimEnd);
      (window as any).__trimRecorder = recorder;
      (window as any).__trimVideo = video;
      (window as any).__trimEndTime = endTime;
      video.play().catch((e) => {
        cleanup();
        recorder.stop();
        reject(e);
      });
    };

    const onTimeUpdate = () => {
      const end = (window as any).__trimEndTime as number | undefined;
      if (typeof end === 'number' && video.currentTime >= end - 0.1) {
        video.pause();
        const rec = (window as any).__trimRecorder;
        if (rec && rec.state !== 'inactive') rec.stop();
        (window as any).__trimRecorder = null;
        (window as any).__trimVideo = null;
        (window as any).__trimEndTime = null;
      }
    };

    const onEnded = () => {
      const rec = (window as any).__trimRecorder;
      if (rec && rec.state !== 'inactive') rec.stop();
      (window as any).__trimRecorder = null;
      (window as any).__trimVideo = null;
      (window as any).__trimEndTime = null;
    };

    video.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', onLoaded);
    video.src = videoUrl;
    video.load();
  });
}

/** Voces TTS de la API texto-a-vox (Azure Neural español) */
const TTS_VOICES: { id: string; label: string; gender: 'femenino' | 'masculino' }[] = [
  { id: 'es-AR-ElenaNeural', label: 'Elena (AR)', gender: 'femenino' },
  { id: 'es-AR-TomasNeural', label: 'Tomas (AR)', gender: 'masculino' },
  { id: 'es-BO-MarceloNeural', label: 'Marcelo (BO)', gender: 'masculino' },
  { id: 'es-BO-SofiaNeural', label: 'Sofia (BO)', gender: 'femenino' },
  { id: 'es-CL-CatalinaNeural', label: 'Catalina (CL)', gender: 'femenino' },
  { id: 'es-CL-LorenzoNeural', label: 'Lorenzo (CL)', gender: 'masculino' },
  { id: 'es-CO-GonzaloNeural', label: 'Gonzalo (CO)', gender: 'masculino' },
  { id: 'es-CO-SalomeNeural', label: 'Salome (CO)', gender: 'femenino' },
  { id: 'es-CU-BelkysNeural', label: 'Belkys (CU)', gender: 'femenino' },
  { id: 'es-CU-ManuelNeural', label: 'Manuel (CU)', gender: 'masculino' },
  { id: 'es-DO-EmilioNeural', label: 'Emilio (DO)', gender: 'masculino' },
  { id: 'es-DO-RamonaNeural', label: 'Ramona (DO)', gender: 'femenino' },
  { id: 'es-EC-AndreaNeural', label: 'Andrea (EC)', gender: 'femenino' },
  { id: 'es-EC-LuisNeural', label: 'Luis (EC)', gender: 'masculino' },
  { id: 'es-ES-AlvaroNeural', label: 'Alvaro (ES)', gender: 'masculino' },
  { id: 'es-ES-ElviraNeural', label: 'Elvira (ES)', gender: 'femenino' },
  { id: 'es-ES-EstrellaNeural', label: 'Estrella (ES)', gender: 'femenino' },
  { id: 'es-ES-LaiaNeural', label: 'Laia (ES)', gender: 'femenino' },
  { id: 'es-ES-ManuelNeural', label: 'Manuel (ES)', gender: 'masculino' },
  { id: 'es-ES-PelayoNeural', label: 'Pelayo (ES)', gender: 'masculino' },
  { id: 'es-GQ-JavierNeural', label: 'Javier (GQ)', gender: 'masculino' },
  { id: 'es-GQ-TeresaNeural', label: 'Teresa (GQ)', gender: 'femenino' },
  { id: 'es-GT-AndresNeural', label: 'Andres (GT)', gender: 'masculino' },
  { id: 'es-GT-MartaNeural', label: 'Marta (GT)', gender: 'femenino' },
  { id: 'es-HN-CarlosNeural', label: 'Carlos (HN)', gender: 'masculino' },
  { id: 'es-HN-KarlaNeural', label: 'Karla (HN)', gender: 'femenino' },
  { id: 'es-MX-DaliaNeural', label: 'Dalia (MX)', gender: 'femenino' },
  { id: 'es-MX-JorgeNeural', label: 'Jorge (MX)', gender: 'masculino' },
  { id: 'es-NI-FedericoNeural', label: 'Federico (NI)', gender: 'masculino' },
  { id: 'es-NI-YolandaNeural', label: 'Yolanda (NI)', gender: 'femenino' },
  { id: 'es-PA-MargaritaNeural', label: 'Margarita (PA)', gender: 'femenino' },
  { id: 'es-PA-RobertoNeural', label: 'Roberto (PA)', gender: 'masculino' },
  { id: 'es-PE-CamilaNeural', label: 'Camila (PE)', gender: 'femenino' },
  { id: 'es-PE-AlexNeural', label: 'Alex (PE)', gender: 'masculino' },
  { id: 'es-PR-KarinaNeural', label: 'Karina (PR)', gender: 'femenino' },
  { id: 'es-PR-VictorNeural', label: 'Victor (PR)', gender: 'masculino' },
  { id: 'es-PY-MarioNeural', label: 'Mario (PY)', gender: 'masculino' },
  { id: 'es-PY-TaniaNeural', label: 'Tania (PY)', gender: 'femenino' },
  { id: 'es-SV-LorenaNeural', label: 'Lorena (SV)', gender: 'femenino' },
  { id: 'es-SV-RodrigoNeural', label: 'Rodrigo (SV)', gender: 'masculino' },
  { id: 'es-US-AlonsoNeural', label: 'Alonso (US)', gender: 'masculino' },
  { id: 'es-US-PalomaNeural', label: 'Paloma (US)', gender: 'femenino' },
  { id: 'es-UY-MateoNeural', label: 'Mateo (UY)', gender: 'masculino' },
  { id: 'es-UY-ValentinaNeural', label: 'Valentina (UY)', gender: 'femenino' },
  { id: 'es-VE-PaolaNeural', label: 'Paola (VE)', gender: 'femenino' },
  { id: 'es-VE-SalvadorNeural', label: 'Salvador (VE)', gender: 'masculino' },
];

/** Diapositiva generada para presentación animada */
export interface EditorSlide {
  id: string;
  imageDataUrl: string;
  title: string;
  description: string;
  /** Efecto overlay (rayos, partículas, viñeta, etc.) */
  overlayEffectId?: string | null;
  /** Ancho del bloque de texto (% de 10 a 100) */
  textWidth?: number;
  /** Alineación del texto */
  textAlign?: 'left' | 'center' | 'right';
  /** Tamaño de fuente del título (px) */
  titleFontSize?: number;
  /** Color del título (hex) */
  titleColor?: string;
  /** Fuente del título */
  titleFontFamily?: string;
  /** Tamaño de fuente de la descripción (px) */
  descriptionFontSize?: number;
  /** Color de la descripción (hex) */
  descriptionColor?: string;
  /** Fuente de la descripción */
  descriptionFontFamily?: string;
}

// Formulario de guardar presentación: estado local del título para no perder foco al escribir
const SavePresentationForm = ({
  onSaveProject,
  onSaveAnimation,
  onExportVideo,
  onClose,
  isSaving,
  isExporting,
  exportProgress,}: {
  onSaveProject: (titulo: string) => void;
  onSaveAnimation: (titulo: string) => void;
  onExportVideo: (titulo: string) => void;
  onClose: () => void;
  isSaving: boolean;
  isExporting: boolean;
  exportProgress: string;
}) => {
  const { t } = useI18n();
  const [titulo, setTitulo] = useState('');
  const tituloRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-4 p-4">
      <div className="text-sm text-gray-400">
        {t('videoEditor.saveAsProject1')} <strong className="text-white">{t('videoEditor.saveAsProject2')}</strong> {t('videoEditor.saveAsProject3')} <strong className="text-white">{t('videoEditor.saveAsProject4')}</strong>
      </div>
      <div>
        <label className="text-sm font-medium text-gray-300 block mb-2">{t('videoEditor.titleLabel')}</label>
        <div className="relative">
          <input
            ref={tituloRef}
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder={t('videoEditor.titlePlaceholder')}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white outline-none focus:ring-2 focus:ring-emerald-500"
            autoFocus
          />
        </div>
      </div>
      {isExporting && <p className="text-sm text-emerald-400">{exportProgress}</p>}
      <div className="flex flex-wrap gap-3 pt-2">
        <Button
          onClick={() => titulo.trim() && onSaveProject(titulo)}
          disabled={isSaving || !titulo.trim()}
          className="!bg-gray-700 hover:!bg-gray-600 !text-white"
        >
          {isSaving && !isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Guardar proyecto (.zeus)
        </Button>
        <Button
          onClick={() => titulo.trim() && onSaveAnimation(titulo)}
          disabled={isSaving || !titulo.trim()}
          className="!bg-emerald-700 hover:!bg-emerald-600 !text-white"
        >
          {isSaving && !isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
          Guardar como animación
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={isSaving}>
          Cancelar
        </Button>
      </div>
    </div>
  );
};

export type AIPresentationData = {
  presentation: {
    title: string;
    coverSvg?: string;
    slides: Array<{
      title: string;
      description: string;
      assignedImageName: string;
      durationSec: number;
      textWidth?: number;
      textAlign?: 'left' | 'center' | 'right';
      titleFontSize?: number;
      titleColor?: string;
      titleFontFamily?: string;
      descriptionFontSize?: number;
      descriptionColor?: string;
      descriptionFontFamily?: string;
    }>;
    gradientFrom?: string;
    gradientTo?: string;
  };
  imageDataUrls: Record<string, string>;
  audioDataUrl?: string;
  backgroundDataUrl?: string;
};

/** Timeline estructurado generado por la IA (modo "Animación / pieza multimedia"). */
export type AIAnimationData = {
  animation: {
    title?: string;
    durationSec?: number;
    style?: string;
    clips: Array<{
      mediaName: string;
      type: 'video' | 'image' | 'audio';
      track: 'video' | 'audio';
      startTime: number;
      duration: number;
      sourceStartTime?: number;
      playbackRate?: number;
      reversed?: boolean;
      volume?: number;
      opacity?: number;
      transitionIn?: { type: string; duration: number };
      transitionOut?: { type: string; duration: number };
      label?: string;
    }>;
    textOverlays?: Array<{
      text: string;
      startTime: number;
      duration: number;
      x?: number;
      y?: number;
      fontSize?: number;
      color?: string;
      fontFamily?: string;
      textAlign?: 'left' | 'center' | 'right';
      opacity?: number;
    }>;
    globalFilter?: {
      brightness?: number;
      contrast?: number;
      saturation?: number;
      hue?: number;
      blur?: number;
      intensity?: number;
    };
    crop?: {
      aspect?: string | null;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    };
  };
  /** nombreArchivo -> URL (object URL o data URL) que el editor usa como mediaFileId */
  mediaUrls: Record<string, string>;
};

type VideoEditorProps = {
  videoUrl: string;
  initialEditState?: VideoEditState;
  projectFile?: File;
  projectName?: string;
  /** Propuesta/guion generado por IA (ej. desde Crear animación con IA) */
  aiScript?: string;
  /** Presentación generada por IA con imágenes asignadas a diapositivas */
  aiPresentation?: AIPresentationData;
  /** Animación/pieza multimedia generada por IA (timeline estructurado) */
  aiAnimation?: AIAnimationData;
  onSave: (editState: VideoEditState) => void;
  onCancel: () => void;
  onLoadProject?: (projectData: any) => void;
};

// Componente separado para el formulario de guardado
const SaveProjectForm = ({
  onClose,
  onSaveFullLocal,
  isSaving,
}: {
  onClose: () => void;
  onSaveFullLocal: (projectName: string, manualFiles: File[]) => Promise<void>;
  isSaving: boolean;
}) => {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [localProjects, setLocalProjects] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [manualFiles, setManualFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchLocalProjects = async () => {
      setIsLoading(true);
      try {
        const paths = await getLocalPaths();
        const folderPaths = [paths?.video, paths?.proyectos_video, paths?.proyectos].filter(Boolean);
        const uniquePaths = Array.from(new Set(folderPaths));
        let allFiles: any[] = [];
        for (const p of uniquePaths) {
          const files = await listDirectory(p!, 'proyectos');
          const filtered = files.filter(f => !allFiles.some(af => af.path === f.path));
          allFiles = [...allFiles, ...filtered];
        }
        setLocalProjects(allFiles || []);
      } catch (e) { console.error(e); } finally { setIsLoading(false); }
    };
    fetchLocalProjects();
  }, []);
  const addFilesToList = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setManualFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index: number) => {
    setManualFiles(prev => prev.filter((_, i) => i !== index));
  };

  const isExisting = localProjects.some(p => p.name.toLowerCase() === title.toLowerCase());

  return (
    <div className="space-y-6 p-6 max-h-[90vh] overflow-y-auto custom-scrollbar">
      <div className="space-y-3">
        <label className="text-sm font-bold text-gray-300 uppercase tracking-wider">Nombre del Proyecto</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Escribe el nombre del proyecto..."
          className="w-full bg-gray-900 border-2 border-gray-800 rounded-2xl p-4 text-white text-lg outline-none focus:border-green-500 transition-all shadow-inner"
          autoFocus
        />
      </div>

      {/* SECCIÓN DE IMPORTACIÓN MANUAL PARA EL PROYECTO */}
      <div className="space-y-4 p-4 bg-blue-500/5 border-2 border-dashed border-blue-500/20 rounded-2xl">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-2">
            <Upload className="w-3 h-3" /> Archivos para empaquetar en /assets
          </label>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-bold transition-all"
          >
            {t('videoEditor.addFiles')}
          </button>
          <input type="file" ref={fileInputRef} onChange={addFilesToList} multiple className="hidden" />
        </div>

        {manualFiles.length > 0 ? (
          <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar-thin">
            {manualFiles.map((f, i) => (
              <div key={i} className="flex items-center justify-between bg-gray-900/60 p-2 rounded-xl border border-gray-800">
                <div className="flex items-center gap-2 truncate">
                  <div className="w-6 h-6 rounded bg-gray-800 flex items-center justify-center text-[10px]">
                    {f.type.includes('video') ? '🎥' : f.type.includes('audio') ? '🎵' : '🖼️'}
                  </div>
                  <span className="text-xs text-gray-300 truncate">{f.name}</span>
                </div>
                <button onClick={() => removeFile(i)} className="text-gray-500 hover:text-red-400 p-1">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-gray-500 text-center py-2 italic text-balance px-4">
            Selecciona los archivos originales que quieres que Zeus guarde dentro de la carpeta del proyecto.
          </p>
        )}
      </div>

      <div className="space-y-3">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
          <FolderOpen className="w-3 h-3" /> Proyectos Existentes
        </label>
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-gray-700" /></div>
        ) : (
          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
            {localProjects.map((p) => (
              <button
                key={p.id}
                onClick={() => setTitle(p.name)}
                className={`text-[10px] px-3 py-1.5 rounded-full border transition-all ${title.toLowerCase() === p.name.toLowerCase()
                  ? 'bg-green-500 border-green-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                  }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-center gap-3 pt-2">
        <Button variant="ghost" onClick={onClose} disabled={isSaving} className="px-6 text-gray-500">{t('videoEditor.cancel')}</Button>
        <Button
          onClick={() => title.trim() && onSaveFullLocal(title, manualFiles)}
          disabled={isSaving || !title.trim()}
          style={{ backgroundColor: isExisting ? '#059669' : '#10b981', color: '#fff', fontWeight: '800', borderRadius: '12px', height: '48px', padding: '0 24px', border: 'none' }}
        >
          {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
          <span className="ml-2 uppercase">{isExisting ? 'Actualizar Proyecto' : 'Crear Proyecto'}</span>
        </Button>
      </div>
    </div>
  );
};

export default function VideoEditor({ videoUrl, initialEditState, projectFile, projectName, aiScript, aiPresentation, aiAnimation, onSave, onCancel, onLoadProject }: VideoEditorProps) {
  const { toast } = useToast();
  const { t } = useI18n();
  const [currentProjectName, setCurrentProjectName] = useState('');

  useEffect(() => {
    // Solo mostramos el nombre del proyecto si realmente se ha cargado un estado inicial de proyecto
    if (initialEditState && projectName) {
      setCurrentProjectName(projectName);
    } else {
      setCurrentProjectName('');
    }
   }, [initialEditState, projectName]);

   const vertexInstantsLoadedFromProject = useRef(false);

   // Cargar vertexInstants desde initialEditState (proyecto cargado via page.tsx)
    useEffect(() => {
     if (initialEditState && typeof initialEditState === 'object') {
       const projectLevelInstants = (initialEditState as any).vertexInstants;
       if (Array.isArray(projectLevelInstants) && projectLevelInstants.length > 0) {
         setVertexInstants(projectLevelInstants);
         if (typeof window !== 'undefined') localStorage.setItem('zeus-vertex-instants', JSON.stringify(projectLevelInstants));
         vertexInstantsLoadedFromProject.current = true;
       } else {
         setVertexInstants([]);
         if (typeof window !== 'undefined') localStorage.removeItem('zeus-vertex-instants');
         vertexInstantsLoadedFromProject.current = true;
       }
     }
   }, [initialEditState]);

   const videoRef = useRef<HTMLVideoElement>(null);
  // Preview scene-graph: canvas visible + renderer + escena. El <video> (videoRef)
  // queda oculto (drivea metadata/duración y TimelinePlayer); el canvas pinta el
  // scene graph (vídeo+transiciones+filtro global+máscara de selección) vía RAF.
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewSceneRef = useRef<RootNode | null>(null);
  const previewRendererRef = useRef<CanvasRenderer | null>(null);
  const previewRafRef = useRef<number>(0);
  const previewLastSigRef = useRef<string>('');
  // Firma de la estructura del preview (sin currentTime). Se calcula en un effect
  // aparte (no cada frame) y la lee el bucle RAF para saber cuándo reconstruir la
  // escena. Así evitamos un JSON.stringify de todo el timeline a 60fps.
  const previewSigRef = useRef<string>('');
  // Último slot de frame pintado (tiempo cuantizado a 30fps). El short-circuit del
  // RAF salta el render cuando ni la estructura ni el frame de vídeo visible
  // cambiaron: compositar el mismo frame 4K→1280 dos veces (60fps sobre un vídeo
  // 30fps) da píxeles idénticos y dobla el trabajo de GPU → tirones. Ver bucle.
  const previewLastFrameSlotRef = useRef<number>(-1);
  const currentTimeRef = useRef(0);
  // Ref compartida con TimelinePlayer: el player escribe aquí el currentTime a 60fps
  // (sin re-renderizar el editor). El bucle de preview lee esta ref para pintar el
  // canvas fotograma a fotograma a tiempo real. El estado (editState.timeline.
  // currentTime) sólo se actualiza a ~15fps y haría el preview a saltos.
  const previewTimeRef = useRef(0);
  // Ref de reproducción (isTimelinePlaying). Se declara aquí, antes del effect del
  // bucle de preview, para que éste pueda leer isPlayingRef.current y aplicar la
  // intensidad al frame actual sólo en pausa. La asignación .current se hace más
  // abajo, tras declararse isTimelinePlaying.
   const isPlayingRef = useRef(false);
   const isSimplePlayerRef = useRef(false);
  const imageOverlayRef = useRef<HTMLImageElement>(null);
  // Vídeo superpuesto (overlay a pantalla completa con su propio transporte).
  const overlayVideoRef = useRef<HTMLVideoElement | null>(null);
  const overlayFileInputRef = useRef<HTMLInputElement | null>(null);
  const [overlayPlaying, setOverlayPlaying] = useState(false);
  const [overlayCurrentTime, setOverlayCurrentTime] = useState(0);
  const overlaySeekDraggingRef = useRef(false);
  const [previewVideoSize, setPreviewVideoSize] = useState<{ width: number; height: number }>({ width: 1280, height: 720 });
  // Resolución nativa del vídeo principal (para el canvas de pintura a resolución
  // full). Se setea en onLoadedMetadata; cae a previewVideoSize si no se conoce.
  const [videoNativeSize, setVideoNativeSize] = useState<{ width: number; height: number } | null>(null);
  // Herramienta de pintura activa (pestaña Efectos). null = ninguna (sólo se ve la
  // capa; los eventos los gestionan los overlays de objetos/selección).
  const [paintTool, setPaintTool] = useState<'brush' | 'bucket' | 'eyedropper' | 'eraser' | null>(null);
  // Varita mágica: tolerancia de color (± por canal 0-255) del flood fill por color.
  const [wandTolerance, setWandTolerance] = useState(15);
  // Editor manual de coordenadas de seguimiento: copiar de un keyframe y aplicar para
  // verificar que lo que guarda es correcto.
  const [selCoordsInput, setSelCoordsInput] = useState('');
  // Toggle "Ver original": cuando está activo, el preview renderiza SIN efectos
  // (brillo/contraste/saturación/matiz/desenfoque/intensidad) ni máscara de selección,
  // para comparar el vídeo limpio contra los cambios aplicados. No toca editState:
  // sólo construye la escena con un editState neutral al vuelo.
  const [previewOriginal, setPreviewOriginal] = useState(false);
  const presentationAudioRef = useRef<HTMLAudioElement | null>(null);
  const timelineAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const loadPresentationInputRef = useRef<HTMLInputElement>(null);
  const loadProjectFileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const selectionFileInputRef = useRef<HTMLInputElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  // Stage del preview (el div con aspect-ratio que enmarca el vídeo). Se usa
  // para medir su tamaño de layout (px, sin zoom) al aplicar vértices a un objeto.
  const previewStageRef = useRef<HTMLDivElement>(null);
  const exportInProgressRef = useRef(false);
  const exportCancelRef = useRef<null | (() => void)>(null);
  const lastProgrammaticSeekRef = useRef(0);
  const lastVideoSourceRef = useRef<string | undefined>(undefined);
  // Generación del cambio de fuente del <video> principal: evita que un handler
  // onloadeddata stale (de un cambio de fuente anterior) haga seek a una posición
  // obsoleta cuando la fuente vuelve a cambiar antes de cargar.
  const videoSrcGenRef = useRef(0);
  const seekRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generatedAssetsRef = useRef<Map<string, GeneratedAudioAsset>>(new Map());
  const audioFolderPathRef = useRef<string | null>(null);
  const generatedAudioMetadataRef = useRef<Map<string, string>>(new Map());
  const generatedAudioSequenceRef = useRef(0);

  // Recording Area Calibration (mirroring EditorTutorials system)
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [recordingArea, setRecordingArea] = useState<{ x: number; y: number; width: number; height: number }>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zeus-recording-area');
      if (saved) return JSON.parse(saved);
    }
    return { x: 100, y: 100, width: 800, height: 600 };
  });
  const [isDraggingCal, setIsDraggingCal] = useState(false);
  const [dragStartCal, setDragStartCal] = useState({ x: 0, y: 0 });
  const [resizeHandleCal, setResizeHandleCal] = useState<string | null>(null);
  const [mouseOffsetX, setMouseOffsetX] = useState(115);
  const [mouseOffsetY, setMouseOffsetY] = useState(57);
  const [realMouseOffsetX, setRealMouseOffsetX] = useState(0);
  const [realMouseOffsetY, setRealMouseOffsetY] = useState(0);
  const [realMouseScaleX, setRealMouseScaleX] = useState(1);
  const [realMouseScaleY, setRealMouseScaleY] = useState(1);
  const [vertexAreaOffsetX, setVertexAreaOffsetX] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zeus-vertex-area-offset-x');
      if (saved) return parseInt(saved, 10);
    }
    return 0;
  });
  const [vertexAreaOffsetY, setVertexAreaOffsetY] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zeus-vertex-area-offset-y');
      if (saved) return parseInt(saved, 10);
    }
    return 0;
  });
  const vertexCaptureArea = useMemo(
    () => ({
      x: recordingArea.x + vertexAreaOffsetX,
      y: recordingArea.y + vertexAreaOffsetY,
      width: recordingArea.width,
      height: recordingArea.height,
    }),
    [recordingArea, vertexAreaOffsetX, vertexAreaOffsetY]
  );
   const [isCapturingVertex, setIsCapturingVertex] = useState(false);
   const [isVertexTracking, setIsVertexTracking] = useState(false);
   const [vertexTrackEngine, setVertexTrackEngine] = useState<'sam2' | 'pattern'>('sam2');
  const [verticesCaptured, setVerticesCaptured] = useState<Array<{ x: number; y: number } | null>>([null, null, null, null]);
  const [vertexInstants, setVertexInstants] = useState<Array<{ id: string; time: number; vertices: Array<{ x: number; y: number } | null>; width: number; height: number; opacity: number }>>([]);
  // Selección de instantes + objeto destino para "Aplicar al objeto".
  const [selectedInstantIds, setSelectedInstantIds] = useState<Set<string>>(new Set());
  const [vertexTargetObjectId, setVertexTargetObjectId] = useState<string>('');
  // Generar 1 instante por frame entre los marcados (interpolando los 4 vértices
  // en pantalla) para que la deformación anime frame a frame como el tracking.
  const [vertexSampleFps, setVertexSampleFps] = useState(1);
  // Última aplicación de vértices a un objeto (para mostrar un resumen visible
  // en el panel: cuántos instantes se generaron y en qué objeto).
  const [lastVertexApply, setLastVertexApply] = useState<{ count: number; objectName: string; dense: boolean } | null>(null);
  const [trackingRegion, setTrackingRegion] = useState<TrackingRegion | null>(null);
  const [trackingLazoPath, setTrackingLazoPath] = useState<BezierAnchor[] | null>(null);
  // Zona del vídeo copiada con la selección (se pega como objeto).
  const [copiedZoneDataUrl, setCopiedZoneDataUrl] = useState<string | null>(null);
  const [trackingMode, setTrackingMode] = useState<'lazo' | 'rect'>('lazo');
  const [isDrawingTrackingRegion, setIsDrawingTrackingRegion] = useState(false);
  const [trackingDraft, setTrackingDraft] = useState<{ startX: number; startY: number } | null>(null);
  const [trackingLazoPoints, setTrackingLazoPoints] = useState<{ x: number; y: number }[]>([]);
  const [trackingCursor, setTrackingCursor] = useState<{ x: number; y: number } | null>(null);
  const [trackingPreviewData, setTrackingPreviewData] = useState<TrackingData | null>(null);
  const [editingInstantId, setEditingInstantId] = useState<string | null>(null);
  const [draggedVertex, setDraggedVertex] = useState<{ index: number; x: number; y: number } | null>(null);
  const [isCapturingTest, setIsCapturingTest] = useState(false);
  const [manualPointText, setManualPointText] = useState('');
  const [captureTestScreenshot, setCaptureTestScreenshot] = useState(true);
  const [testRect, setTestRect] = useState<{ v1: {x: number; y: number}; v2: {x: number; y: number}; v3: {x: number; y: number}; v4: {x: number; y: number} } | null>(null);
  // Edición de instantes (keyframes) de un ObjectClip desde la pestaña Punto de vértice.
  const [editingKfId, setEditingKfId] = useState<string | null>(null);
  const [kfSnapshot, setKfSnapshot] = useState<ObjectKeyframe | null>(null);
  const [kfIsNew, setKfIsNew] = useState(false);
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const finishTrackingLazo = useCallback((pts: { x: number; y: number }[]) => {
    if (!pts || pts.length === 0) return;
    let finalPts = pts;
    if (finalPts.length < 3) {
      const center = finalPts[0] || { x: 50, y: 50 };
      const r = 10;
      finalPts = [];
      for (let a = 0; a < 360; a += 30) {
        const rad = (a * Math.PI) / 180;
        finalPts.push({
          x: Math.max(0, Math.min(100, center.x + r * Math.cos(rad))),
          y: Math.max(0, Math.min(100, center.y + r * Math.sin(rad))),
        });
      }
    }
    let minX = 100, maxX = 0, minY = 100, maxY = 0;
    for (const p of finalPts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    setTrackingRegion({ x: minX, y: minY, width, height });
    const anchors: BezierAnchor[] = finalPts.map((p) => ({
      x: p.x, y: p.y, hInX: p.x, hInY: p.y, hOutX: p.x, hOutY: p.y,
    }));
    setTrackingLazoPath(anchors);
    setTrackingLazoPoints([]);
    setTrackingCursor(null);
    setIsDrawingTrackingRegion(false);
  }, []);

  useEffect(() => {
    if (!isDrawingTrackingRegion || trackingMode !== 'lazo') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        if (trackingLazoPoints.length > 0) {
          finishTrackingLazo(trackingLazoPoints);
        } else {
          setIsDrawingTrackingRegion(false);
        }
      } else if (e.key === 'Backspace' || e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setTrackingLazoPoints((prev) => prev.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDrawingTrackingRegion, trackingMode, trackingLazoPoints, finishTrackingLazo]);

  const fetchAudioFolderPath = useCallback(async () => {
    if (audioFolderPathRef.current) return audioFolderPathRef.current;
    const paths = await getLocalPaths();
    const folder = paths?.audio;
    if (!folder) throw new Error('Configura una carpeta de audio en la pestaña Archivos.');
    audioFolderPathRef.current = folder;
    return folder;
  }, []);

  const uploadGeneratedAudioToLocalFolder = useCallback(async (asset: GeneratedAudioAsset) => {
    try {
      const folder = await fetchAudioFolderPath();
      const file = buildGeneratedAssetFile(asset);
      const destPath = `${folder}\\${file.name}`;
      const sourcePath = getFilePath(file);
      if (sourcePath) {
        await copyFile(sourcePath, destPath);
      } else {
        const buffer = new Uint8Array(await file.arrayBuffer());
        await writeFile(destPath, buffer);
      }
      toast({
        title: 'Audio guardado localmente',
        description: asset.fileName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar el audio localmente.';
      console.warn('[TTS local save]', message, error);
      toast({
        title: 'No se pudo guardar el audio',
        description: message,
        variant: 'destructive',
      });
      throw error;
    }
  }, [fetchAudioFolderPath, toast]);

  // Estado para el estilo de fuente personalizado (FontEditor)
  const [customFontStyle, setCustomFontStyle] = useState<FontStyle>({
    text: t('videoEditor.style.exampleTextLabel'),
    fontFamily: 'Arial',
    fontSize: 48,
    color: '#ffffff',
    borderColor: '#000000',
    borderWidth: 0,
    shadowColor: '#000000',
    shadowBlur: 4,
    shadowOffset: 2,
    backgroundColor: '#000000',
    backgroundOpacity: 0,
    backgroundBlur: 0,
    borderRadius: 0,
    isBold: false,
    isItalic: false,
    isUnderline: false,
  });
  const [savedTextPresets, setSavedTextPresets] = useState<SavedTextPreset[]>([]);
  const [pendingTextStyleApplication, setPendingTextStyleApplication] = useState<{ nonce: number; style: FontStyle } | null>(null);

  // Estados para PocketBase Proyectos
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [savedProjects, setSavedProjects] = useState<any[]>([]);
  const [localProjects, setLocalProjects] = useState<any[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingLocalProjects, setIsLoadingLocalProjects] = useState(false);
  // ID del proyecto en el servidor Zeus API (localhost:3150)
  const [apiProjectId, setApiProjectId] = useState<string | null>(null);

  const [videoHasError, setVideoHasError] = useState(false);
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [presentationViewOpen, setPresentationViewOpen] = useState(!!aiScript);
  const aiBridge = useAIEditorBridgeOptional();
  const { messages, setMessages, conversationId, setConversationId } = useChatContext();
  // Guion editable: permite que el chat IA lea y escriba (igual que en el editor de documentos)
  const [localScriptContent, setLocalScriptContent] = useState(aiScript ?? '');
  const slidesRef = useRef<EditorSlide[]>([]);
  const transitionsRef = useRef<Array<{ type: TransitionType; duration: number }>>([]);
  const [presentationSnapshot, setPresentationSnapshot] = useState(aiScript ?? '');

  // Estado para crear diapositivas desde vídeo (pestaña Recursos)
  const [slideSource, setSlideSource] = useState<'timeline' | 'url' | 'photos'>('timeline');
  const [slideVideoUrl, setSlideVideoUrl] = useState('');
  const [slideIntervalSeconds, setSlideIntervalSeconds] = useState(5);
  const [slideQuality, setSlideQuality] = useState<'low' | 'medium' | 'high' | 'ultra' | 'max'>('medium');
  const [slides, setSlides] = useState<EditorSlide[]>([]);
  const [isCapturingSlides, setIsCapturingSlides] = useState(false);
  const [sameTitleForAll, setSameTitleForAll] = useState(false);
  const [globalSlideTitle, setGlobalSlideTitle] = useState('');
  const [presentationSlidesOpen, setPresentationSlidesOpen] = useState(false);
  const [presentationSlideIndex, setPresentationSlideIndex] = useState(0);
  const [presentationSlidesPlaying, setPresentationSlidesPlaying] = useState(false);
  const [presentationSlideIntervalSec, setPresentationSlideIntervalSec] = useState(5);
  const [presentationMusicClip, setPresentationMusicClip] = useState<{ url: string; duration: number } | null>(null);
  const [presentationTransitionsByGap, setPresentationTransitionsByGap] = useState<Array<{ type: TransitionType; duration: number }>>([]);
  slidesRef.current = slides;
  transitionsRef.current = presentationTransitionsByGap;
  const [presentationBackgroundType, setPresentationBackgroundType] = useState<'none' | 'image' | 'video' | 'color' | 'gradient'>('none');
  const [presentationBackgroundUrl, setPresentationBackgroundUrl] = useState('');
  const [presentationZoom, setPresentationZoom] = useState(100);
  const [showPresentationGuide, setShowPresentationGuide] = useState(true);
  const [presentationBgModalOpen, setPresentationBgModalOpen] = useState(false);
  const [bgModalTab, setBgModalTab] = useState<'none' | 'image' | 'video' | 'color' | 'gradient'>('none');
  const [bgModalFiles, setBgModalFiles] = useState<any[]>([]);
  const [bgModalLoading, setBgModalLoading] = useState(false);
  const [solidColor, setSolidColor] = useState('#0a0a0a');
  const [gradientFrom, setGradientFrom] = useState('#1a1a2e');
  const [gradientTo, setGradientTo] = useState('#0a0a0a');
  const [gradientAngle, setGradientAngle] = useState(180);
  const [slidePreviewImageUrl, setSlidePreviewImageUrl] = useState<string | null>(null);
  const [presentationSaveModalOpen, setPresentationSaveModalOpen] = useState(false);
  const [libraryEffectTarget, setLibraryEffectTarget] = useState<'all' | number>('all');
  const [, setCustomEffectsVersion] = useState(0);
  const [isCreatingEffect, setIsCreatingEffect] = useState(false);
  const createEffectInputRef = useRef<HTMLInputElement>(null);
  const [, setOverlayObjectsVersion] = useState(0);
  const [isCreatingOverlayObject, setIsCreatingOverlayObject] = useState(false);
  const createOverlayObjectInputRef = useRef<HTMLInputElement>(null);
  const [useDeformableObjectOverlay, setUseDeformableObjectOverlay] = useState(true);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [presentationConfigModalOpen, setPresentationConfigModalOpen] = useState(false);
  const [applyConfigGlobally, setApplyConfigGlobally] = useState(false);
  const applyGlobalRef = useRef(applyConfigGlobally);
  const slideIndexRef = useRef(presentationSlideIndex);
  useEffect(() => { applyGlobalRef.current = applyConfigGlobally; }, [applyConfigGlobally]);
  useEffect(() => { slideIndexRef.current = presentationSlideIndex; }, [presentationSlideIndex]);
  const [presentationLoadModalOpen, setPresentationLoadModalOpen] = useState(false);
  const [presentationExportedVideoUrl, setPresentationExportedVideoUrl] = useState<string | null>(null);
  const [isSavingPresentation, setIsSavingPresentation] = useState(false);
  const [savedPresentations, setSavedPresentations] = useState<any[]>([]);
  const [isLoadingPresentations, setIsLoadingPresentations] = useState(false);
  const [presentationExportProgress, setPresentationExportProgress] = useState('');
  const [isExportingPresentationVideo, setIsExportingPresentationVideo] = useState(false);
  const [activeCaptureStream, setActiveCaptureStream] = useState<MediaStream | null>(null);
  const [isScreenshotPreviewMuted, setIsScreenshotPreviewMuted] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (activeCaptureStream) {
      console.log('📹 Mostrando flujo de captura externa en el monitor');
      video.srcObject = activeCaptureStream;
      video.play().catch(err => console.warn('Error al reproducir stream de captura:', err));
    } else if (video.srcObject) {
      console.log('🛑 Deteniendo flujo de captura externa');
      video.srcObject = null;
      // Ya no llamamos a video.load() aquí para evitar errores de interrupción
    }
  }, [activeCaptureStream]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isScreenshotPreviewMuted;
    }
  }, [isScreenshotPreviewMuted]);

  useEffect(() => {
    if (aiScript) {
      setLocalScriptContent(aiScript);
      setPresentationSnapshot(aiScript);
      setPresentationViewOpen(true);
    }
  }, [aiScript]);

  // Auto-crear diapositivas cuando llega una presentación generada por IA
  useEffect(() => {
    if (!aiPresentation?.presentation?.slides?.length) return;

    // Fallback: paleta de colores y fuentes si la IA no las proporciona
    const colorPalette = [
      '#ff6b6b', '#4ecdc4', '#f7d794', '#e77f67', '#786fa6', '#f8a5c2', '#63cdda', '#596275',
      '#f3a683', '#e15f41', '#c44569', '#f8b500', '#6c5ce7', '#a29bfe', '#fd79a8', '#e17055',
    ];
    const fontPalette = ['Inter', 'Georgia', 'Playfair Display', 'Arial Black', 'Courier New', 'Trebuchet MS', 'Palatino Linotype'];

    // Generar portada SVG si la IA la proporcionó
    const coverSvg = aiPresentation.presentation.coverSvg;
    let coverDataUrl = '';
    if (coverSvg) {
      const svgString = coverSvg.trim();
      const encoded = typeof window !== 'undefined' ? btoa(unescape(encodeURIComponent(svgString))) : Buffer.from(svgString).toString('base64');
      coverDataUrl = `data:image/svg+xml;base64,${encoded}`;
    }

    const coverSlide: EditorSlide | null = coverDataUrl
      ? {
          id: `slide-cover-${Date.now()}`,
          imageDataUrl: coverDataUrl,
          title: aiPresentation.presentation.title || 'Portada',
          description: '',
          textWidth: 100,
          textAlign: 'center',
          titleFontSize: 48,
          titleColor: '#ffffff',
          titleFontFamily: 'Inter',
          descriptionFontSize: 24,
          descriptionColor: '#e5e7eb',
          descriptionFontFamily: 'Inter',
        }
      : null;

    const newSlides: EditorSlide[] = aiPresentation.presentation.slides.map((slide) => {
      const hash = slide.title.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const titleColor = slide.titleColor || colorPalette[hash % colorPalette.length];
      const descColor = slide.descriptionColor || colorPalette[(hash + 3) % colorPalette.length];
      const titleFont = slide.titleFontFamily || fontPalette[hash % fontPalette.length];
      const descFont = slide.descriptionFontFamily || fontPalette[(hash + 5) % fontPalette.length];
      return {
        id: `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        imageDataUrl: aiPresentation.imageDataUrls[slide.assignedImageName] || '',
        title: slide.title,
        description: slide.description,
        textWidth: 100,
        textAlign: slide.textAlign ?? 'center',
        titleFontSize: slide.titleFontSize ?? 37,
        titleColor,
        titleFontFamily: titleFont,
        descriptionFontSize: slide.descriptionFontSize ?? 24,
        descriptionColor: descColor,
        descriptionFontFamily: descFont,
      };
    });

    setSlides(coverSlide ? [coverSlide, ...newSlides] : newSlides);
    setPresentationZoom(140);
    setApplyConfigGlobally(true);

    // Audio de fondo
    if (aiPresentation.audioDataUrl) {
      setPresentationMusicClip({ url: aiPresentation.audioDataUrl, duration: 0 });
    }

    // Fondo de presentación
    if (aiPresentation.backgroundDataUrl) {
      const isVideo = aiPresentation.backgroundDataUrl.startsWith('data:video');
      setPresentationBackgroundType(isVideo ? 'video' : 'image');
      setPresentationBackgroundUrl(aiPresentation.backgroundDataUrl);
    } else {
      const gf = aiPresentation.presentation.gradientFrom;
      const gt = aiPresentation.presentation.gradientTo;
      if (gf && gt) {
        setPresentationBackgroundType('gradient');
        setPresentationBackgroundUrl(`${gf}|${gt}||180`);
        setGradientFrom(gf);
        setGradientTo(gt);
      } else {
        // Fallback: generar degradado determinista a partir del título
        const presets = [
          ['#0f0c29', '#302b63'],
          ['#141e30', '#243b55'],
          ['#1a1a2e', '#16213e'],
          ['#200122', '#6f0000'],
          ['#1cb5e0', '#000851'],
          ['#2b5876', '#4e4376'],
          ['#000428', '#004e92'],
          ['#232526', '#414345'],
          ['#3a1c71', '#d76d77'],
          ['#11998e', '#38ef7d'],
        ];
        const hash = aiPresentation.presentation.title.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const [from, to] = presets[hash % presets.length];
        setPresentationBackgroundType('gradient');
        setPresentationBackgroundUrl(`${from}|${to}||180`);
        setGradientFrom(from);
        setGradientTo(to);
      }
    }

    // No abrimos la vista de propuesta; dejamos al usuario en el editor
    toast({ title: 'Presentación generada', description: `${newSlides.length} diapositivas creadas automáticamente. Ve a la pestaña Recursos para verlas.` });
  }, [aiPresentation]);

  // Auto-materializar la animación IA (timeline estructurado) cuando llega la prop.
  // One-shot: dispara una sola vez y delega en materializeAnimRef.current (reasignado
  // cada render con handlers frescos) para evitar stale closures.
  useEffect(() => {
    if (!aiAnimation || didMaterializeAnimRef.current) return;
    didMaterializeAnimRef.current = true;
    materializeAnimRef.current(aiAnimation);
  }, [aiAnimation]);

  const handleOpenPresentationView = useCallback(() => {
    setPresentationSnapshot(localScriptContent || '');
    setPresentationViewOpen(true);
  }, [localScriptContent]);

  const handleSaveSnapshot = useCallback(() => {
    setPresentationSnapshot(localScriptContent || '');
  }, [localScriptContent]);

  // Mantener una transición por cada espacio entre diapositivas (1→2, 2→3, ...)
  useEffect(() => {
    const need = Math.max(0, slides.length - 1);
    setPresentationTransitionsByGap((prev) => {
      if (prev.length === need) return prev;
      if (prev.length < need)
        return [
          ...prev,
          ...Array(need - prev.length)
            .fill(null)
            .map(() => ({ type: 'fade' as TransitionType, duration: 0.5 })),
        ];
      return prev.slice(0, need);
    });
  }, [slides.length]);

  const [editState, setEditState] = useState<VideoEditState>(() => {
    const defaultTracks: TimelineTrack[] = [
      {
        id: 'video-1',
        type: 'video' as TrackType,
        name: 'Vídeo Principal',
        clips: [],
        isLocked: false
      },
      {
        id: 'audio-1',
        type: 'audio' as TrackType,
        name: 'Audio Principal',
        clips: [],
        isMuted: false,
        isLocked: false,
        volume: 1
      },
      {
        id: 'text-1',
        type: 'text' as TrackType,
        name: 'Texto/Superposiciones',
        clips: [],
        isLocked: false
      },
      {
        id: 'image-1',
        type: 'image' as TrackType,
        name: 'Pista de Imagen',
        clips: [],
        isLocked: false
      }
    ];

    // Si hay un estado inicial cargado, mezclar las pistas guardadas con las por defecto
    let finalTracks: TimelineTrack[] = defaultTracks;

    if (initialEditState?.timeline?.tracks) {
      // Preservar las pistas guardadas (con su estado isLocked)
      const savedTracks = initialEditState.timeline.tracks;

      // Asegurar que existan las tres pistas por defecto, manteniendo las guardadas si existen
      finalTracks = defaultTracks.map(defaultTrack => {
        const savedTrack = savedTracks.find(st => st.id === defaultTrack.id);
        // Si existe una pista guardada con el mismo ID, usar la guardada (preserva isLocked)
        // sino, usar la por defecto
        return savedTrack || defaultTrack;
      });

      // Agregar cualquier pista adicional que no esté en las por defecto
      const additionalTracks = savedTracks.filter(st =>
        !defaultTracks.some(dt => dt.id === st.id)
      );
      finalTracks = [...finalTracks, ...additionalTracks];
    }

    finalTracks = placeEffectsTrackBelowMainVideo(finalTracks);

    const defaultTimeline = {
      duration: 60,
      currentTime: 0,
      zoom: 160, // Default value, will be loaded from localStorage in useEffect
      tracks: finalTracks
    };

    if (!initialEditState) {
      return createDefaultEditState();
    }

    return {
      ...initialEditState,
      timeline: initialEditState.timeline || defaultTimeline,
      textClips: initialEditState.textClips || [],
      objectClips: initialEditState.objectClips || [],
      videoOverlay: initialEditState.videoOverlay ?? null
    };
  });

  const [selectionSaveName, setSelectionSaveName] = useState('');
  const timelineRef = useRef(editState.timeline);
  timelineRef.current = editState.timeline;

  // Ref del editState para el loop RAF del preview (lee structura sin re-suscribir).
  const editStateRef = useRef(editState);
  editStateRef.current = editState;

  // Ref con las acciones locales del editor expuestas al chat IA ([ZEUS_ACTION]).
  // Se rellena cada render (después de definir los handlers) para que el executor
  // (registrado una sola vez) siempre vea handlers frescos sin stale closure.
  const localActionsRef = useRef<Record<string, (p: any) => unknown | Promise<unknown>>>({});

  // Materialización one-shot de la animación IA: el useEffect dispara UNA sola vez
  // (didMaterializeAnimRef) y delega en materializeAnimRef.current, que se reasigna
  // cada render para capturar handlers frescos (mismo patrón anti-stale que localActionsRef).
  const didMaterializeAnimRef = useRef(false);
  const materializeAnimRef = useRef<(a: AIAnimationData) => void>(() => {});

  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [resourceViewMode, setResourceViewMode] = useState<'grid' | 'list'>('grid');
  const [uploadType, setUploadType] = useState<'video' | 'audio' | 'image'>('video');
  const [pbLoadStep, setPbLoadStep] = useState<'collection' | 'record' | 'file' | 'local'>('collection');
  const [localFolderFiles, setLocalFolderFiles] = useState<any[]>([]);
  const [pbCollections, setPbCollections] = useState<{ id: string; name: string }[]>([]);
  const [selectedPbCollection, setSelectedPbCollection] = useState<string | null>(null);
  const [pbRecords, setPbRecords] = useState<{ recordId: string; recordName: string; files: { url: string; fileName: string }[] }[]>([]);
  const [selectedPbRecordFiles, setSelectedPbRecordFiles] = useState<{ url: string; fileName: string }[] | null>(null);
  const [pbLoading, setPbLoading] = useState(false);
  const [fileNotAllowedMessage, setFileNotAllowedMessage] = useState<string | null>(null);
   const [isTimelinePlaying, setIsTimelinePlaying] = useState(false);
   const [isLoopEnabled, setIsLoopEnabled] = useState(false);
   const [useSimplePlayer, setUseSimplePlayer] = useState(false);
  const [showSavedMessage, setShowSavedMessage] = useState(false);
  const [projectInputRef, setProjectInputRef] = useState<HTMLInputElement | null>(null);
  const [uploadLocalInputRef, setUploadLocalInputRef] = useState<HTMLInputElement | null>(null);
  const pendingLocalUploadTypeRef = useRef<'video' | 'audio' | 'image'>('video');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFileName, setExportFileName] = useState('');
  const [exportFormat, setExportFormat] = useState('webm');
  const [exportQuality, setExportQuality] = useState('high');
  // Exportar sólo el área del lazo/selección con fondo transparente (WebM/VP9 con
  // alpha). Visible sólo cuando hay selección activa. Al sobreponer el vídeo, la
  // zona transparente deja ver el vídeo de atrás.
  const [exportTransparent, setExportTransparent] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [playerZoom, setPlayerZoom] = useState(100);
  const [isHandMode, setIsHandMode] = useState(false);
  const [isDraggingPlayer, setIsDraggingPlayer] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(350); // Ajustado para mostrar 3 pistas por defecto
  const playerScrollContainerRef = useRef<HTMLDivElement>(null);

  // Efecto para mantener el scroll centrado cuando cambia el zoom
  useEffect(() => {
    if (playerScrollContainerRef.current) {
      const container = playerScrollContainerRef.current;
      // Pequeño retardo para esperar a que el DOM se actualice con el nuevo zoom
      const timeoutId = setTimeout(() => {
        const scrollX = (container.scrollWidth - container.clientWidth) / 2;
        const scrollY = (container.scrollHeight - container.clientHeight) / 2;
        container.scrollTo({
          left: scrollX,
          top: scrollY,
          behavior: 'smooth'
        });
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [playerZoom]);
  const [isResizingTimeline, setIsResizingTimeline] = useState(false);
  const [ttsText, setTtsText] = useState('');
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [ttsVoice, setTtsVoice] = useState('es-ES-AlvaroNeural');
  const [ttsRate, setTtsRate] = useState('0%');
  const [ttsPitch, setTtsPitch] = useState('0Hz');
  const [ttsVolume, setTtsVolume] = useState('0%');
  const [ttsGender, setTtsGender] = useState('neutro');
  const [isReadingScript, setIsReadingScript] = useState(false);
  const [isReadingPaused, setIsReadingPaused] = useState(false);
  const [currentScriptIndex, setCurrentScriptIndex] = useState(-1);
  const [readingRate, setReadingRate] = useState(1.0);
  const scriptAudioRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const presentationScrollRef = useRef<HTMLDivElement | null>(null);
  // Ref para controlar el estado de lectura síncronamente y evitar problemas de closure
  const isReadingRef = useRef(false);
  const isPausedRef = useRef(false);
  const fileCache = useRef<Map<string, File>>(new Map());

  // Unificamos las frases para que UI y Voz coincidan exactamente con el renderizado
  const scriptSentences = useMemo(() => {
    if (!presentationSnapshot) return [];

    const allSentences: string[] = [];
    presentationSnapshot.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed.startsWith('#')) {
        const cleaned = cleanTextForTTS(trimmed);
        if (cleaned && cleaned.length > 1) {
          allSentences.push(cleaned);
        }
      } else {
        const sentences = trimmed.split(/([.!?]+)/).reduce((acc: string[], val, idx, array) => {
          if (idx % 2 === 0) {
            const punct = array[idx + 1] || '';
            const combined = (val + punct).trim();
            if (combined) acc.push(combined);
          }
          return acc;
        }, []);

        sentences.forEach(s => {
          const cleaned = cleanTextForTTS(s);
          if (cleaned && cleaned.length > 1) {
            allSentences.push(cleaned);
          }
        });
      }
    });
    return allSentences;
  }, [presentationSnapshot]);

  const chatMessages = useMemo(() => messages.slice(-18), [messages]);
  const renderChatContent = useCallback((content: string) => {
    return content.split('\n').map((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return <div key={`empty-${idx}`} className="h-2" />;
      }
      if (trimmed.startsWith('#')) {
        return (
          <h3
            key={`heading-${idx}`}
            className="text-xl font-black uppercase tracking-tight text-yellow-300"
          >
            {trimmed.replace(/#/g, '').trim()}
          </h3>
        );
      }
      if (/^[-*]/.test(trimmed)) {
        return (
          <p key={`bullet-${idx}`} className="text-base md:text-lg leading-relaxed text-gray-200">
            • {trimmed.replace(/^[-*]+/, '').trim()}
          </p>
        );
      }
      return (
        <p key={`para-${idx}`} className="text-base md:text-lg leading-relaxed text-gray-200">
          {trimmed}
        </p>
      );
    });
  }, []);
  const [currentSpeakingText, setCurrentSpeakingText] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const handleCopyChat = useCallback((text: string, id: string) => {
    copyText(text.trim());
    setCopiedMessageId(id);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopiedMessageId(null), 1800);
  }, []);
  const handleSpeakChat = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (window.speechSynthesis.speaking && currentSpeakingText === text) {
      window.speechSynthesis.cancel();
      setCurrentSpeakingText(null);
      speechUtteranceRef.current = null;
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanTextForTTS(text));
    utterance.lang = 'es-ES';
    utterance.rate = 0.95;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith('es'));
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      setCurrentSpeakingText(null);
      speechUtteranceRef.current = null;
    };
    speechUtteranceRef.current = utterance;
    setCurrentSpeakingText(text);
    window.speechSynthesis.speak(utterance);
  }, [currentSpeakingText]);

  useEffect(() => () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current); }, []);

  // Auto-scroll para seguir la lectura en la presentación
  useEffect(() => {
    if (currentScriptIndex !== -1 && presentationViewOpen) {
      const element = document.querySelector(`[data-script-index="${currentScriptIndex}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentScriptIndex, presentationViewOpen]);

  useEffect(() => {
    if (!presentationViewOpen && isReadingScript) {
      if (scriptAudioRef.current) {
        scriptAudioRef.current.pause();
        scriptAudioRef.current = null;
      }
      setIsReadingScript(false);
    }
  }, [presentationViewOpen, isReadingScript]);

  useEffect(() => {
    const filtered = TTS_VOICES.filter(v => ttsGender === 'neutro' || v.gender === ttsGender);
    if (filtered.length > 0 && !filtered.some(v => v.id === ttsVoice)) {
      setTtsVoice(filtered[0].id);
    }
  }, [ttsGender, ttsVoice]);

  // Audio context para manejo proper del audio
  const [audioContext, setAudioContext] = useState<AudioContext | undefined>(undefined);
  const [masterOutput, setMasterOutput] = useState<AudioNode | undefined>(undefined);

  const [clipboardClip, setClipboardClip] = useState<TimelineClip | null>(null);
  const [history, setHistory] = useState<VideoEditState[]>([]);
  const [future, setFuture] = useState<VideoEditState[]>([]);

  // Modo de "Crear capa de selección": 'png' (foto fija del frame actual) o
  // 'video' (la zona en movimiento durante selectionVideoDuration segundos).
  const [selectionLayerMode, setSelectionLayerMode] = useState<'png' | 'video'>('png');
  const [selectionVideoDuration, setSelectionVideoDuration] = useState(3);
  const [copyProgress, setCopyProgress] = useState<{ current: number; total: number } | null>(null);

  const handlePlayerZoom = (delta: number) => {
    setPlayerZoom((prev: number) => Math.max(50, Math.min(400, prev + delta)));
  };

  const resetPlayerZoom = () => setPlayerZoom(100);

  // Al cambiar el zoom, centrar el scroll horizontal y vertical del contenedor del reproductor.
  // Se hace dos veces: inmediatamente tras el render (el margen ya cambió) y
  // después de 250ms para capturar el estado final de la transición CSS (200ms).
  useEffect(() => {
    const container = playerScrollContainerRef.current;
    if (!container) return;

    const center = () => {
      const maxScrollLeft = container.scrollWidth - container.clientWidth;
      const maxScrollTop = container.scrollHeight - container.clientHeight;
      container.scrollLeft = maxScrollLeft / 2;
      container.scrollTop = maxScrollTop / 2;
    };

    const raf = requestAnimationFrame(center);          // tras el primer re-render
    const timer = setTimeout(center, 250);              // tras la transición CSS (200ms)

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [playerZoom]);

  // Función para formatear tiempo a MM:SS
  const formatTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return '0:00';

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const computeTimelineDuration = useCallback(() => {
    const tracks = editState.timeline?.tracks;
    if (!tracks || tracks.length === 0) {
      return editState.timeline?.duration ?? Math.max(0, videoDuration);
    }

    let maxEnd = 0;
    tracks.forEach((track) => {
      track.clips?.forEach((clip) => {
        if (typeof clip.startTime === 'number' && typeof clip.duration === 'number') {
          maxEnd = Math.max(maxEnd, clip.startTime + clip.duration);
        }
      });
    });
    return Math.max(0, maxEnd);
  }, [editState.timeline, videoDuration]);

  const handleCalculateTimelineLength = () => {
    const computedDuration = computeTimelineDuration();
    if (computedDuration <= 0) {
      toast({
        title: 'Calcular duración',
        description: 'Añade clips al timeline antes de calcular la duración.',
      });
      return;
    }

    setEditState((prev) => {
      if (!prev.timeline) return prev;
      return {
        ...prev,
        timeline: {
          ...prev.timeline,
          duration: computedDuration,
        },
      };
    });
    setVideoDuration(computedDuration);
    toast({
      title: 'Duración calculada',
      description: `El timeline dura ${formatTime(computedDuration)}`,
    });
  };

  // Función para guardar el estado actual en el historial antes de un cambio
  const saveToHistory = useCallback((newState: VideoEditState) => {
    setHistory(prev => [...prev, editState].slice(-50)); // Guardar últimos 50 pasos
    setFuture([]); // Al hacer un cambio nuevo, limpiamos el futuro
    setEditState(newState);
  }, [editState]);

  // Snapshot del estado actual en el historial SIN cambiar editState. Para que las
  // acciones del chat IA que usan handlers basados en setEditState (sin saveToHistory)
  // sean deshacibles con Ctrl+Z. Lee editStateRef.current (fresco del último render).
  const snapshotHistory = useCallback(() => {
    setHistory(prev => [...prev, editStateRef.current].slice(-50));
    setFuture([]);
  }, []);

  // Sincronizar guion local cuando llega el prop aiScript (ej. desde Crear animación con IA)
  useEffect(() => {
    if (aiScript !== undefined && aiScript !== null) setLocalScriptContent(aiScript);
  }, [aiScript]);

  // Registrar editor de vídeo en el puente del chat: el modelo puede leer el guion, los textos, los archivos del timeline y las diapositivas
  useEffect(() => {
    if (!aiBridge) return;
    const fmt = (s: number) => {
      if (!s || isNaN(s)) return '0:00';
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m}:${sec.toString().padStart(2, '0')}`;
    };
    const unregisterImages = aiBridge.registerDocumentImages(() => {
      const currentSlides = slidesRef.current;
      if (currentSlides.length === 0) return null;
      return currentSlides.map((s) => s.imageDataUrl).filter(Boolean) as string[];
    });
    const unregisterContent = aiBridge.registerDocumentContent(() => {
      const parts: string[] = [];
      if (localScriptContent.trim()) parts.push(localScriptContent.trim());
      const clips = editState.textClips || [];
      if (clips.length > 0) {
        parts.push('\n\n--- Textos en pantalla ---');
        clips.forEach((c, i) => {
          parts.push(`[${i + 1}] ${fmt(c.startTime)} - ${fmt(c.startTime + c.duration)}: ${c.text}`);
        });
      }
      const objects = editState.objectClips || [];
      if (objects.length > 0) {
        parts.push('\n\n--- Objetos superpuestos ---');
        objects.forEach((o, i) => {
          parts.push(`[${i + 1}] ${o.name || '(sin nombre)'} (${o.mediaType})  ${fmt(o.startTime)} - ${fmt(o.startTime + o.duration)}  pos (${o.position.x.toFixed(0)}, ${o.position.y.toFixed(0)}) ancho ${o.width.toFixed(0)}% opacidad ${o.opacity}%`);
        });
      }
      const timeline = editState.timeline;
      if (timeline?.tracks?.length) {
        parts.push('\n\n--- Archivos en el timeline ---');
        parts.push(`Duración total: ${fmt(timeline.duration)}`);
        timeline.tracks.forEach((track) => {
          if (!track.clips?.length) return;
          const typeLabel = track.type === 'video' ? 'Vídeo' : track.type === 'audio' ? 'Audio' : 'Texto';
          parts.push(`\nPista: ${track.name} (${typeLabel})`);
          track.clips.forEach((clip) => {
            const name = clip.label || clip.text || '(sin nombre)';
            const end = clip.startTime + clip.duration;
            parts.push(`  - ${name}  ${fmt(clip.startTime)} - ${fmt(end)}  (${clip.duration.toFixed(1)}s)`);
          });
        });
      }
      const currentSlides = slidesRef.current;
      const currentTransitions = transitionsRef.current;
      if (currentSlides.length > 0) {
        parts.push('\n\n--- Diapositivas (generadas desde vídeo) ---');
        parts.push('Puedes actualizar título, descripción y transiciones. Para escribir desde el chat, incluye un bloque de código con la clave "slides" y/o "transitions".');
        currentSlides.forEach((slide, i) => {
          parts.push(`\n[${i}] Título: ${slide.title || '(vacío)'} | Descripción: ${slide.description || '(vacío)'}`);
        });
        if (currentTransitions.length > 0) {
          parts.push('\nTransiciones entre diapositivas:');
          currentTransitions.forEach((t, i) => {
            parts.push(`  Entre ${i + 1} y ${i + 2}: ${t.type} ${t.duration}s`);
          });
        }
        parts.push('\nFormato para actualizar desde el chat: ```slides\n{"slides":[{"index":0,"title":"Nuevo título","description":"Nueva descripción"}],"transitions":[{"type":"fade","duration":0.5}]}\n```');
      }
      return parts.length > 0 ? parts.join('\n') : null;
    });
    const VALID_TRANSITIONS: TransitionType[] = ['none', 'fade', 'dissolve', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom-in', 'zoom-out', 'blur'];
    const unregisterEditor = aiBridge.registerEditor((text: string) => {
      const trimmed = text.trim();
      const match = trimmed.match(/```(?:slides|json)\s*\n?([\s\S]*?)```/i);
      if (match) {
        try {
          const raw = match[1].trim();
          const data = raw.startsWith('[') ? { slides: JSON.parse(raw) } : JSON.parse(raw);
          const slideUpdates = Array.isArray(data.slides) ? data.slides : data.slides ? [data.slides] : [];
          const transitionUpdates = Array.isArray(data.transitions) ? data.transitions : [];
          if (slideUpdates.length > 0) {
            setSlides((prev) =>
              prev.map((s, i) => {
                const u = slideUpdates.find((u: { index?: number }) => u.index === i);
                if (!u) return s;
                return {
                  ...s,
                  title: typeof u.title === 'string' ? u.title : s.title,
                  description: typeof u.description === 'string' ? u.description : s.description,
                };
              })
            );
          }
          if (transitionUpdates.length > 0) {
            setPresentationTransitionsByGap((prev) =>
              prev.map((t, i) => {
                const u = transitionUpdates[i];
                if (!u) return t;
                const type = u.type && VALID_TRANSITIONS.includes(u.type as TransitionType) ? (u.type as TransitionType) : t.type;
                const duration = typeof u.duration === 'number' ? Math.max(0.2, Math.min(2, u.duration)) : t.duration;
                return { type, duration };
              })
            );
          }
          const rest = (trimmed.slice(0, match.index) + trimmed.slice(match.index! + match[0].length)).trim();
          if (rest) setLocalScriptContent(rest);
        } catch {
          setLocalScriptContent(trimmed);
        }
      } else {
        setLocalScriptContent(trimmed);
      }
    });
    return () => {
      unregisterContent();
      unregisterImages();
      unregisterEditor();
    };
  }, [aiBridge, localScriptContent, editState.textClips, editState.objectClips, editState.timeline, presentationViewOpen]);

  // Registrar el executor de acciones para que la IA del chat pueda controlar el editor vía SDK
  useEffect(() => {
    if (!aiBridge) return;
    const unregister = aiBridge.registerActionExecutor(async (action, params) => {
      switch (action) {
        case 'createProject':
          return api.createProject(params as Parameters<typeof api.createProject>[0]);
        case 'updateProject':
          return api.updateProject(
            params.id as string,
            params as Parameters<typeof api.updateProject>[1]
          );
        case 'getProject':
          return api.getProject(params.id as string);
        case 'getProjects':
          return api.getProjects();
        case 'deleteProject':
          return api.deleteProject(params.id as string);
        case 'getTimeline':
          return api.getTimeline(params.projectId as string);
        case 'insertClip':
          return api.insertClip(
            params.projectId as string,
            params as Parameters<typeof api.insertClip>[1]
          );
        case 'updateClip':
          return api.updateClip(
            params.projectId as string,
            params.clipId as string,
            params as Parameters<typeof api.updateClip>[2]
          );
        case 'deleteClip':
          return api.deleteClip(params.projectId as string, params.clipId as string);
        case 'getAssets':
          return api.getAssets();
        case 'uploadAsset':
          return api.uploadAsset(params);
        case 'getStyles':
          return api.getStyles();
        case 'generateScript':
          return api.generateScript(params);
        case 'getSuggestions':
          return api.getSuggestions(params);
        case 'autoEdit':
          return api.autoEdit(params.projectId as string, params);
        case 'getExportStatus':
          return api.getExportStatus(params.jobId as string);
        case 'addEffect':
          return api.applyEffect(
            params.projectId as string,
            params as Parameters<typeof api.applyEffect>[1]
          );
        case 'addTransition':
          return api.applyTransition(
            params.projectId as string,
            params as Parameters<typeof api.applyTransition>[1]
          );
        case 'addText':
          return api.addText(
            params.projectId as string,
            params as Parameters<typeof api.addText>[1]
          );
        case 'getEffects':
          return api.getEffects();
        case 'getTransitions':
          return api.getTransitions();
        case 'exportProject':
          return api.exportProject(
            params.projectId as string,
            params as Parameters<typeof api.exportProject>[1]
          );
        case 'getCurrentProjectId':
          return { id: apiProjectId };
        // Métodos del SDK no cableados arriba (servidor)
        case 'getAsset':
          return (api as any).getAsset(params.id as string);
        case 'listFiles':
          return (api as any).listFiles(params.folder as string, params.category as string | undefined);
        case 'deleteFile':
          return (api as any).deleteFile(params.path as string);
        case 'downloadExport':
          return (api as any).downloadExport(params.jobId as string);
        default:
          // Acciones locales del editor (mutan editState, el proyecto visible)
          if (localActionsRef.current[action]) {
            return await localActionsRef.current[action](params);
          }
          throw new Error(`Acción desconocida: ${action}`);
      }
    });
    return unregister;
  }, [aiBridge, apiProjectId]);

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    const newHistory = history.slice(0, history.length - 1);

    setFuture(prev => [editState, ...prev]);
    setHistory(newHistory);
    setEditState(previous);
  }, [editState, history]);

  const handleRedo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);

    setHistory(prev => [...prev, editState]);
    setFuture(newFuture);
    setEditState(next);
  }, [editState, future]);

  // Hash que incluye startTime y duration de cada clip para que al cambiar duración en modal se actualice timeline.duration
  const tracksHash = JSON.stringify(editState.timeline?.tracks?.flatMap(t => t.clips).map(c => ({ startTime: c.startTime, duration: c.duration })) ?? []);

  const resolveUrl = useCallback((url: string) => {
    if (!url || typeof url !== 'string') return '';
    if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('http') || url.startsWith('media:')) {
      return url;
    }
    // Rutas locales de Windows (ej: C:\Users\...) convertir a media://
    if (/^[a-zA-Z]:\\/.test(url) && typeof window !== 'undefined' && (window as any).electronAPI?.getMediaUrl) {
      return (window as any).electronAPI.getMediaUrl(url);
    }
    const baseUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL || process.env.NEXT_PUBLIC_PB_URL || 'http://127.0.0.1:8090';
    if (url.startsWith('/')) {
      return baseUrl + url;
    }
    // Ruta PocketBase: recordId/filename
    if (url.includes('/') && !url.startsWith('/')) {
      return `${baseUrl}/api/files/proyectos/${url}`;
    }
    return url;
  }, []);

  /** Mapea clipLocalTime → sourceTime y playbackRate (considera speedZones).
   *  Implementación compartida en lib/clip-time.ts (también usada por el motor de render). */
  const mapClipLocalToSource = useCallback(
    (clip: TimelineClip, clipLocalTime: number, trimStart: number) =>
      mapClipLocalToSourceFn(clip, clipLocalTime, trimStart),
    [],
  );

  /** Mapea sourceTime → clipLocalTime (inverso de mapClipLocalToSource, para handleTimeUpdate) */
  const mapSourceToClipLocal = useCallback(
    (clip: TimelineClip, sourceTime: number, trimStart: number) =>
      mapSourceToClipLocalFn(clip, sourceTime, trimStart),
    [],
  );

  /** Mapea tiempo del timeline → { clip, url, sourceTime, playbackRate } para reproducir correctamente fragmentos con sourceStartTime, speedZones y cámara lenta */
  const getActiveVideoInfo = useCallback((timelineTime: number): { clip: TimelineClip; url: string; sourceTime: number; playbackRate: number } | null => {
    const timeline = timelineRef.current;
    if (!timeline) return null;
    const trimStart = editState.trimStart ?? 0;
    const allVideoClips = timeline.tracks
      .filter(t => t.type === 'video')
      .flatMap(track => track.clips)
      .filter(isPlayableVideoClip);
    const allImageClips = timeline.tracks
      .filter(t => t.type === 'image')
      .flatMap(track => track.clips)
      .filter(clip => clip.mediaFileId); // Imágenes con archivo

    // Priorizar video sobre imagen si ambos existen en el mismo tiempo
    const allVisualClips = [...allVideoClips, ...allImageClips];
    if (allVisualClips.length === 0) return null;

    const matchingClips = allVisualClips.filter(c =>
      timelineTime >= c.startTime && timelineTime < c.startTime + c.duration
    );
    const clip = matchingClips.length > 0 ? matchingClips[matchingClips.length - 1] : null;
    if (!clip) return null;

    const clipLocalTime = timelineTime - clip.startTime;
    const { sourceTime, playbackRate } = mapClipLocalToSource(clip, clipLocalTime, trimStart);
    const url = clip.id.includes('main-video') ? resolveUrl(videoUrl) : resolveUrl(clip.mediaFileId!);
    return { clip, url, sourceTime, playbackRate };
  }, [editState.trimStart, editState.trimEnd, videoUrl, resolveUrl, mapClipLocalToSource]);

  const getCurrentVideoSource = useCallback(() => {
    const timeline = timelineRef.current;
    const info = getActiveVideoInfo(timeline?.currentTime ?? 0);
    if (info) return info.url;
    if (!timeline) return resolveUrl(videoUrl);
    const allVideoClips = timeline.tracks
      .filter(t => t.type === 'video')
      .flatMap(track => track.clips)
      .filter(isPlayableVideoClip);
    const allImageClips = timeline.tracks
      .filter(t => t.type === 'image')
      .flatMap(track => track.clips)
      .filter(clip => clip.mediaFileId);
    const allVisualClips = [...allVideoClips, ...allImageClips];
    if (allVisualClips.length > 0) return resolveUrl(allVisualClips[0].mediaFileId!);
    return resolveUrl(videoUrl);
  }, [videoUrl, resolveUrl, getActiveVideoInfo]);

  // Captura un frame del vídeo en un timestamp (de la línea de tiempo) -> data URL, para el modelo de visión.
  // Resuelve la fuente real desde el timeline (getActiveVideoInfo) y mapea timeline time -> source time,
  // igual que hace el resto del editor. Usa un <video> offscreen adjuntado al DOM (un video detached no
  // decodifica frames y drawImage pintaría negro).
  const captureFrameAtTime = useCallback(async (timestampSeconds: number): Promise<string | null> => {
    const info = getActiveVideoInfo(timestampSeconds);
    const src = info?.url ?? getCurrentVideoSource();
    if (!src) return null;
    const seekTime = info ? info.sourceTime : timestampSeconds;
    const video = document.createElement('video');
    // media:// (y http) NECESITA crossOrigin='anonymous' o el canvas se tainta y
    // toDataURL lanza SecurityError -> captura null. blob:/data: son same-origin.
    if (!src.startsWith('blob:') && !src.startsWith('data:')) video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.style.position = 'fixed';
    video.style.left = '-9999px';
    video.style.pointerEvents = 'none';
    document.body.appendChild(video);

    return new Promise<string | null>((resolve) => {
      let done = false;
      const cleanup = () => {
        try { video.remove(); } catch { /* ignore */ }
      };
      const finish = (v: string | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), 20000);

      const draw = () => {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) { finish(null); return; }
        const maxDim = 768;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) { finish(null); return; }
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/jpeg', 0.8));
        } catch {
          finish(null);
        }
      };

      const onSeeked = () => {
        // Esperar a que el frame quede decodificado/presentado antes de drawImage.
        if (typeof video.requestVideoFrameCallback === 'function') {
          let drawn = false;
          video.requestVideoFrameCallback(() => {
            if (drawn) return;
            drawn = true;
            draw();
          });
          setTimeout(() => {
            if (drawn) return;
            drawn = true;
            draw();
          }, 400);
        } else {
          requestAnimationFrame(draw);
        }
      };

      const onLoaded = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        const dur = video.duration;
        const t = isFinite(dur) && dur > 0
          ? Math.max(0, Math.min(seekTime, dur - 0.05))
          : Math.max(0, seekTime);
        try {
          video.currentTime = t;
        } catch {
          finish(null);
        }
      };

      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', () => finish(null));
      video.src = src;
      video.load();
    });
  }, [getActiveVideoInfo, getCurrentVideoSource]);

  // Registrar el capturador de frames de vídeo para que el modelo de visión del chat pueda
  // pedir un frame concreto en un timestamp (bloque [VISION_FRAME] en el modelo de texto).
  // También registrar el tiempo actual del vídeo (currentTime + duration) para que el prompt
  // del modelo de texto sepa qué instante pedir.
  useEffect(() => {
    if (!aiBridge) return;
    const unregisterCapture = aiBridge.registerCaptureVideoFrameAt(captureFrameAtTime);
    const unregisterTime = aiBridge.registerVideoTimeGetter(() => ({
      currentTime: previewTimeRef.current,
      duration: timelineRef.current?.duration ?? 0,
    }));
    return () => {
      unregisterCapture();
      unregisterTime();
    };
  }, [aiBridge, captureFrameAtTime]);

  /** Captura diapositivas desde una URL de vídeo: cada N segundos un frame, con calidad (escala y formato). */
  const captureSlidesFromVideo = useCallback(async (
    videoSrc: string,
    intervalSec: number,
    quality: 'low' | 'medium' | 'high' | 'ultra' | 'max'
  ): Promise<EditorSlide[]> => {
    const usePng = quality === 'ultra' || quality === 'max';
    const nativeOnly = usePng;
    const scale = nativeOnly ? 1 : quality === 'low' ? 0.5 : quality === 'medium' ? 1 : 2;
    const jpegQuality = usePng ? 1 : quality === 'low' ? 0.6 : quality === 'medium' ? 0.85 : 1;
    const video = document.createElement('video');
    if (!videoSrc.startsWith('blob:') && !videoSrc.startsWith('data:')) video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.style.position = 'fixed';
    video.style.left = '-9999px';
    video.style.pointerEvents = 'none';
    document.body.appendChild(video);

    return new Promise((resolve, reject) => {
      const onError = () => {
        cleanup();
        reject(new Error('Error al cargar el vídeo para capturar diapositivas'));
      };

      const onLoaded = async () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        const duration = video.duration;
        if (!duration || duration <= 0) {
          cleanup();
          reject(new Error('Duración del vídeo no válida'));
          return;
        }
        const times: number[] = [];
        for (let t = 0; t < duration; t += intervalSec) times.push(t);
        if (times.length === 0) times.push(0);
        const results: EditorSlide[] = [];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          reject(new Error('No se pudo crear contexto de canvas'));
          return;
        }
        for (let i = 0; i < times.length; i++) {
          const t = times[i];
          await new Promise<void>((seekResolve, seekReject) => {
            let settled = false;
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              video.removeEventListener('error', onSeekErr);
              captureFrame();
            };
            const onSeekErr = () => {
              video.removeEventListener('seeked', onSeeked);
              video.removeEventListener('error', onSeekErr);
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                seekReject(new Error('Error al buscar en el vídeo'));
              }
            };
            const timer = setTimeout(() => {
              if (settled) return;
              // Timeout de fallback: si el evento 'seeked' no disparó (p.ej. el video ya
              // está en esa posición), capturamos igual con el currentTime actual.
              captureFrame();
            }, 3000);
            const captureFrame = () => {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
              }
              const capture = () => {
                try {
                  const w = video.videoWidth;
                  const h = video.videoHeight;
                  if (!w || !h) {
                    seekResolve();
                    return;
                  }
                  const cw = nativeOnly ? w : Math.round(w * scale);
                  const ch = nativeOnly ? h : Math.round(h * scale);
                  canvas.width = cw;
                  canvas.height = ch;
                  if (ctx.imageSmoothingEnabled !== undefined) {
                    ctx.imageSmoothingEnabled = !nativeOnly;
                    if (nativeOnly && (ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: string }).imageSmoothingQuality !== undefined) {
                      (ctx as CanvasRenderingContext2D & { imageSmoothingQuality: string }).imageSmoothingQuality = 'high';
                    }
                  }
                  ctx.drawImage(video, 0, 0, cw, ch);
                  const dataUrl = usePng
                    ? canvas.toDataURL('image/png')
                    : canvas.toDataURL('image/jpeg', jpegQuality);
                  results.push({
                    id: `slide-${Date.now()}-${i}`,
                    imageDataUrl: dataUrl,
                    title: '',
                    description: ''
                  });
                } catch (e) {
                  seekReject(e);
                  return;
                }
                seekResolve();
              };
              // Esperar a que el frame quede decodificado/presentado antes de drawImage.
              // requestVideoFrameCallback garantiza el frame listo; requestAnimationFrame
              // es el fallback cuando no está disponible. Sin esto, drawImage captura un
              // frame negro o parcial (sólo aparece el filo superior).
              let drawn = false;
              if (typeof video.requestVideoFrameCallback === 'function') {
                video.requestVideoFrameCallback(() => {
                  if (drawn) return;
                  drawn = true;
                  capture();
                });
                setTimeout(() => {
                  if (drawn) return;
                  drawn = true;
                  capture();
                }, 400);
              } else {
                requestAnimationFrame(() => {
                  if (drawn) return;
                  drawn = true;
                  capture();
                });
              }
            };
            video.addEventListener('seeked', onSeeked, { once: true });
            video.addEventListener('error', onSeekErr, { once: true });
            // Si el video ya está (casi) en el timestamp objetivo, el evento 'seeked' no
            // se dispara. Nos aseguramos de capturar de todos modos.
            const targetTime = t;
            video.currentTime = targetTime;
            if (Math.abs(video.currentTime - targetTime) < 0.1) {
              onSeeked();
            }
          });
        }
        cleanup();
        resolve(results);
      };

      const cleanup = () => {
        video.removeEventListener('error', onError);
        video.removeEventListener('loadedmetadata', onLoaded);
        if (video.parentNode) video.parentNode.removeChild(video);
        video.src = '';
      };

      video.addEventListener('error', onError);
      video.addEventListener('loadedmetadata', onLoaded);
      video.src = videoSrc;
      video.load();
    });
  }, []);

  /** Convierte archivos de imagen en diapositivas para la presentación. */
  const createSlidesFromPhotos = useCallback(async (files: FileList | null): Promise<EditorSlide[]> => {
    if (!files || files.length === 0) return [];
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) throw new Error('Ninguno de los archivos seleccionados es una imagen válida.');
    const slides: EditorSlide[] = await Promise.all(
      imageFiles.map((file, i) =>
        new Promise<EditorSlide>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            // Extraer nombre sin extensión
            const baseName = file.name.replace(/\.[^/.]+$/, '');
            resolve({
              id: `slide-photo-${Date.now()}-${i}`,
              imageDataUrl: dataUrl,
              title: baseName,
              description: '',
            });
          };
          reader.onerror = () => reject(new Error(`Error al leer ${file.name}`));
          reader.readAsDataURL(file);
        })
      )
    );
    return slides;
  }, []);

  const currentTime = editState.timeline?.currentTime ?? 0;
  currentTimeRef.current = currentTime;

  // ---- Preview scene-graph: loop RAF que renderiza la escena al canvas visible.
  // Lee editState/tamaño/currentTime de refs (no re-suscribe cada frame). Reconstruye
  // la escena sólo cuando cambia la estructura (firma sin currentTime), y recrea el
  // renderer cuando cambia el tamaño. Los frames de vídeo los decodifica el videoCache
  // (mediabunny CanvasSink, random-access). Los objetos/texto/imagen no van aquí
  // (includeOverlays=false): los pintan los overlays DOM, que quedan como handlers.

  // Firma estructural del preview (sin currentTime): se recalcula en este effect
  // sólo cuando cambia la estructura/efectos/tamaño — no cada frame. Antes se hacía
  // un JSON.stringify de todo el timeline dentro del bucle a 60fps (costoso). Ahora
  // el bucle lee previewSigRef.current y reconstruye la escena sólo si cambió.
  useEffect(() => {
    const mainVideoUrl = resolveUrl(videoUrl);
    previewSigRef.current =
      JSON.stringify({
        tracks: editState.timeline?.tracks,
        trimStart: editState.trimStart,
        trimEnd: editState.trimEnd,
        selection: editState.selection,
        duration: editState.timeline?.duration,
        brightness: editState.brightness,
        contrast: editState.contrast,
        saturation: editState.saturation,
        hue: editState.hue,
        blur: editState.blur,
        intensity: editState.intensity,
        previewOriginal,
        // Incluir el estado de reproducción en la firma: al cambiar play/pausa se
        // reconstruye la escena para aplicar (o no) la intensidad al frame actual.
        isPlaying: isTimelinePlaying,
      }) +
      '|' + mainVideoUrl + '|' + previewVideoSize.width + 'x' + previewVideoSize.height;
  }, [
    editState.timeline?.tracks,
    editState.trimStart,
    editState.trimEnd,
    editState.selection,
    editState.timeline?.duration,
    editState.brightness,
    editState.contrast,
    editState.saturation,
    editState.hue,
    editState.blur,
    editState.intensity,
    previewOriginal,
    isTimelinePlaying,
    previewVideoSize,
    videoUrl,
    resolveUrl,
  ]);

  useEffect(() => {
    let running = true;
       const loop = async () => {
       if (!running) return;
       // Durante playback con el reproductor simple: el canvas está oculto y el <video>
       // nativo hace el playback. Saltamos el render pesado del scene-graph
       // (decode 4K→1280) para evitar tirones.
       if (isPlayingRef.current && isSimplePlayerRef.current) {
         if (running) previewRafRef.current = requestAnimationFrame(loop);
         return;
       }
       const canvas = previewCanvasRef.current;
      const es = editStateRef.current;
      const size = previewVideoSize;
      if (canvas && es.timeline) {
        const sig = previewSigRef.current;
        // Short-circuit por slot de frame (tiempo cuantizado a 30fps). Renderizamos
        // sólo cuando cambia la estructura (firma) o el frame de vídeo visible.
        // Un vídeo 30fps en pantalla 60Hz muestra cada frame 2 refrescos: compositear
        // el MISMO frame a 60fps produce píxeles idénticos y dobla el drawImage 4K→1280
        // (el coste dominante del bucle) → espiga past 16.6ms → vsyncs caídos → "se
        // frena". Cuantizando a 30fps el render cae 1 vez cada 2 vsyncs, SIEMPRE en
        // límite de vsync (seguimos llamando rAF a 60Hz, sin saltar ticks) → fluido y
        // sin derivar. A diferencia del viejo throttle 30fps (que saltaba rAF y
        // derivaba del vsync), aquí el rAF va a 60Hz y sólo se salta el trabajo, no
        // el repintado de vsync. Para fuentes 60fps el preview va a 30fps (el usuario
        // acepta menor calidad de preview a cambio de fluidez).
        const frameSlot = Math.floor(previewTimeRef.current * 30);
        if (
          sig === previewLastSigRef.current &&
          frameSlot === previewLastFrameSlotRef.current
        ) {
          if (running) previewRafRef.current = requestAnimationFrame(loop);
          return;
        }
        if (sig !== previewLastSigRef.current) {
          previewLastSigRef.current = sig;
          if (canvas.width !== size.width) canvas.width = size.width;
          if (canvas.height !== size.height) canvas.height = size.height;
          try {
            // Buffer offscreen + blit al canvas visible (no render directo). El
            // render directo hacía clear() a negro ANTES del decode asíncrono →
            // pantalla negra durante el decode en vídeos lentos. Con offscreen+blit
            // el canvas visible mantiene el frame anterior hasta que el nuevo está
            // listo. NOTA: no pasamos previewDecodeWidth: mediabunny decodifica
            // siempre a resolución nativa (el `width` de CanvasSink sólo redimensiona
            // el canvas de salida, no el decode).
            previewRendererRef.current = new CanvasRenderer({
              width: size.width,
              height: size.height,
              fps: 30,
            });
            // "Ver original": construye la escena con un editState neutral (sin
            // efectos ni máscara) para comparar contra el vídeo limpio. No muta
            // editState: sólo cambia lo que se pasa a buildScene.
            const mainVideoUrl = resolveUrl(videoUrl);
            const sceneEs = previewOriginal
              ? {
                  ...es,
                  brightness: 0,
                  contrast: 0,
                  saturation: 0,
                  hue: 0,
                  blur: 0,
                  intensity: 0,
                  selection: undefined,
                }
              : es;
            previewSceneRef.current = buildScene(sceneEs, {
              isPreview: true,
              // Aplicar intensidad al frame actual SÓLO en pausa: durante la
              // reproducción la omite (convolución 3×3 = cara) y el preview va
              // fluido; al pausar o tocar el slider se aplica al fotograma en
              // pantalla para ver el cambio. El export siempre la aplica.
              previewApplyIntensity: !isPlayingRef.current,
              canvasSize: { width: size.width, height: size.height },
              duration: es.timeline?.duration ?? 0,
              mainVideoUrl,
              resolveUrl,
              mainVideoSize: null,
              overlays: [],
              includeOverlays: false,
            });
          } catch (e) {
            console.error('preview buildScene error', e);
            previewSceneRef.current = null;
          }
        }
        const scene = previewSceneRef.current;
        const renderer = previewRendererRef.current;
        if (scene && renderer) {
          try {
            // previewTimeRef viene del TimelinePlayer a 60fps durante el play; al
            // pausar/hacer seek, el propio player lo deja en el tiempo actual. Usar
            // el currentTime del estado (15fps) aquí haría el preview a saltos.
            await renderer.renderToCanvas({ node: scene, time: previewTimeRef.current, targetCanvas: canvas });
            previewLastFrameSlotRef.current = frameSlot;
          } catch (e) {
            // Frame decode puede fallar puntualmente (seek/decode asíncrono); se ignora.
          }
        }
      }
      if (running) previewRafRef.current = requestAnimationFrame(loop);
    };
    previewRafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(previewRafRef.current);
      // Forzar reconstrucción en el próximo mount (la firma/size viejos ya no aplican).
      previewLastSigRef.current = '';
      previewLastFrameSlotRef.current = -1;
    };
  }, [previewVideoSize, resolveUrl, videoUrl, previewOriginal]);

  useEffect(() => {
    setMounted(true);

    // Auto-cargar proyecto si hay ID en la URL
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('projectId');
    const isLocalProject = params.get('isLocalProject');
    const localProjectName = params.get('projectName');
    const localProjectPath = params.get('projectPath');

    if (isLocalProject === 'true' && localProjectPath) {
      console.log('📂 Auto-cargando proyecto local:', localProjectName);
      loadFullProjectLocal({ name: localProjectName, path: localProjectPath });
    } else if (projectId) {
      pb.collection('proyectos').getOne(projectId, { requestKey: null }).then((record) => {
        const data = typeof record.file === 'string' ? JSON.parse(record.file) : record.file;
        if (data.editState) {
          setEditState(data.editState);
          if (data.videoUrl) {
            // Si el proyecto tiene una URL de video guardada
            // (podemos guardarla en el mismo JSON)
          }
        }
      }).catch(e => console.error('Error cargando proyecto de vídeo:', e));
    }
  }, []);

  // Guardar playerZoom en localStorage cuando cambie
  useEffect(() => {
    console.log(`🔍 Saving playerZoom to localStorage: ${playerZoom}`);
    localStorage.setItem('playerZoom', playerZoom.toString());
  }, [playerZoom]);

  // Cargar valores desde localStorage después del montaje (client-side only)
  useEffect(() => {
    const savedPlayerZoom = localStorage.getItem('playerZoom');
    if (savedPlayerZoom) {
      const zoomValue = parseInt(savedPlayerZoom);
      if (!isNaN(zoomValue)) {
        setPlayerZoom(zoomValue);
      }
    }

    const savedTimelineZoom = localStorage.getItem('timelineZoom');
    if (savedTimelineZoom) {
      const zoomValue = parseInt(savedTimelineZoom);
      if (!isNaN(zoomValue)) {
        setEditState(prev => prev.timeline ? {
          ...prev,
          timeline: { ...prev.timeline, zoom: zoomValue }
        } : prev);
      }
    }
  }, []);

   // Load vertex instants from localStorage (solo como fallback si no vienen del proyecto)
   useEffect(() => {
    if (vertexInstantsLoadedFromProject.current) return;
    const saved = localStorage.getItem('zeus-vertex-instants');
    if (saved) {
      try {
        setVertexInstants(JSON.parse(saved));
      } catch { /* ignore parse errors */ }
    }
  }, []);
  useEffect(() => {
    if (!presentationMusicClip || !presentationAudioRef.current) return;
    if (presentationSlidesPlaying) {
      presentationAudioRef.current.play().catch(() => { });
    } else {
      presentationAudioRef.current.pause();
      presentationAudioRef.current.currentTime = 0;
    }
  }, [presentationSlidesPlaying, presentationMusicClip]);

  // Avance automático de diapositivas cuando la presentación está en reproducción
  useEffect(() => {
    if (!presentationSlidesOpen || !presentationSlidesPlaying || slides.length === 0) return;
    const interval = setInterval(() => {
      setPresentationSlideIndex((i) => {
        if (i >= slides.length - 1) {
          setPresentationSlidesPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, presentationSlideIntervalSec * 1000);
    return () => clearInterval(interval);
  }, [presentationSlidesOpen, presentationSlidesPlaying, presentationSlideIntervalSec, slides.length]);

  // Inicializar AudioContext para manejo proper del audio
  useEffect(() => {
    const context = new (window.AudioContext || (window as any).webkitAudioContext)();
    const masterGain = context.createGain();
    masterGain.connect(context.destination);
    setAudioContext(context);
    setMasterOutput(masterGain);

    return () => {
      if (context.state !== 'closed') context.close();
    };
  }, []);

  // Lógica para redimensionar la línea de tiempo
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isResizingTimeline) return;

      // Calcular nueva altura (la diferencia desde el fondo de la pantalla)
      const newHeight = window.innerHeight - e.clientY;
      // Limitar la altura mínima y máxima
      setTimelineHeight(Math.max(150, Math.min(window.innerHeight * 0.7, newHeight)));
    };

    const handleGlobalMouseUp = () => {
      setIsResizingTimeline(false);
      document.body.style.cursor = 'default';
    };

    if (isResizingTimeline) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
      document.body.style.cursor = 'row-resize';
    }

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isResizingTimeline]);

  // Cargar proyecto si se proporciona un archivo de proyecto
  useEffect(() => {
    if (projectFile) {
      loadProjectFromFile(projectFile);
    }
  }, [projectFile]);

  // Cargar lista de proyectos al abrir el modal de guardar
  useEffect(() => {
    if (isSaveModalOpen) fetchProjectsForSave();
  }, [isSaveModalOpen]);

  // Cargar efectos personalizados desde localStorage
  useEffect(() => {
    loadCustomEffectsFromStorage();
    setCustomEffectsVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    loadOverlayObjectsFromStorage();
    setOverlayObjectsVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_TEXTS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedTextPreset[];
      if (Array.isArray(parsed)) {
        setSavedTextPresets(parsed);
      }
    } catch (_) { }
  }, []);

  // Guardar timeline zoom en localStorage cuando cambie
  useEffect(() => {
    if (editState.timeline?.zoom) {
      console.log(`🔍 Saving timelineZoom to localStorage: ${editState.timeline.zoom}`);
      localStorage.setItem('timelineZoom', editState.timeline.zoom.toString());
    }
  }, [editState.timeline?.zoom]);

  // Renderizar imágenes con img element (como ImageEditor)
  
  // Clip principal oculto con el botón ojo: en modo reproductor simple el <video>
  // nativo lo dibuja, así que hay que ocultarlo también ahí.
  const mainVideoClipHidden = !!editState.timeline?.tracks
    ?.flatMap(t => t.clips)
    .find(c => c.id.includes('main-video'))?.hidden;

  // Obtener imágenes activas para el overlay
  const activeImageClips = useMemo(() => {
    if (!editState.timeline) return [];
    const currentTime = editState.timeline.currentTime;
    
    return editState.timeline.tracks
      .filter(t => t.type === 'image')
      .flatMap(track => track.clips)
      .filter(clip => 
        clip.mediaFileId && 
        currentTime >= clip.startTime && 
        currentTime < clip.startTime + clip.duration
      );
  }, [editState.timeline?.currentTime, editState.timeline?.tracks]);

  // Efectos para el video principal
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Si no hay URL, resetear estados y salir
    if (!videoUrl) {
      setVideoDuration(60); // Duración por defecto para proyectos vacíos
      setVideoHasError(false);
      return;
    }

    // Pausar video por defecto y no silenciar
    video.muted = false;
    video.volume = 1.0;
    video.pause(); // Pausar inmediatamente

    const handleLoadedMetadata = () => {
      // Aplica la duración real al estado y al timeline. Extraído en función porque
      // los WebM grabados con MediaRecorder pueden reportar duration = Infinity/NaN
      // en loadedmetadata; en ese caso necesitamos un seek de descubrimiento antes.
      const applyDuration = (realDuration: number) => {
        const duration = (isFinite(realDuration) && realDuration > 0) ? realDuration : 60;
        setVideoDuration(duration);

      setEditState(prev => {
        const newTracks = [...(prev.timeline?.tracks || [])];
        // Duración real del vídeo: se usa para el clip principal y para el timeline.
        // Antes se hacía Math.max(duration, currentDuration, 60), lo que imprimía un
        // suelo de 60 s y hacía que los vídeos de <1 min mostraran siempre 1:00.
        const effectiveDuration = duration;

        // 1. Gestionar clip de vídeo
        const videoTrackIndex = newTracks.findIndex(t => t.type === 'video');
        if (videoTrackIndex !== -1 && newTracks[videoTrackIndex].clips.length === 0) {
          const mainVideoClip: TimelineClip = {
            id: `main-video-${Date.now()}`,
            trackId: newTracks[videoTrackIndex].id,
            type: 'video',
            startTime: 0,
            duration: effectiveDuration,
            thumbnailUrl: videoUrl,
            mediaFileId: videoUrl,
            overlayTint: undefined
          };
          newTracks[videoTrackIndex] = { ...newTracks[videoTrackIndex], clips: [mainVideoClip] };
        } else if (videoTrackIndex !== -1 && newTracks[videoTrackIndex].clips.length > 0) {
          // Ajustar la duración del clip principal a la duración real del vídeo
          const clips = newTracks[videoTrackIndex].clips.map(c =>
            c.id.includes('main-video')
              ? { ...c, duration: effectiveDuration }
              : c
          );
          newTracks[videoTrackIndex] = { ...newTracks[videoTrackIndex], clips };
        }

        // 2. Gestionar clip de audio (Desconectar audio del vídeo a su propia pista)
        const audioTrackIndex = newTracks.findIndex(t => t.type === 'audio');
        if (audioTrackIndex !== -1 && newTracks[audioTrackIndex].clips.length === 0) {
          const mainAudioClip: TimelineClip = {
            id: `main-audio-${Date.now()}`,
            trackId: newTracks[audioTrackIndex].id,
            type: 'audio',
            startTime: 0,
            duration: effectiveDuration,
            mediaFileId: videoUrl // Usamos la misma fuente pero tratada como audio
            ,
            overlayTint: undefined
          };
          newTracks[audioTrackIndex] = { ...newTracks[audioTrackIndex], clips: [mainAudioClip] };
        } else if (audioTrackIndex !== -1 && newTracks[audioTrackIndex].clips.length > 0) {
          const clips = newTracks[audioTrackIndex].clips.map(c =>
            c.id.includes('main-audio')
              ? { ...c, duration: effectiveDuration }
              : c
          );
          newTracks[audioTrackIndex] = { ...newTracks[audioTrackIndex], clips };
        }

        return {
          ...prev,
          // Forzar trimEnd a la duración real del vídeo si está en valores por defecto,
          // y clampear siempre a la duración real para que el recorte no exceda el vídeo
          // ( antes el suelo de 60 s de effectiveDuration hacía que un vídeo de <1 min
          //   mostrara "Fin" en 1:00 aunque el vídeo fuera más corto ).
          trimEnd: Math.min(
            ((prev.trimEnd ?? 0) <= 1 || prev.trimEnd === 60) ? duration : (prev.trimEnd ?? duration),
            duration
          ),
          timeline: {
            ...prev.timeline!,
            duration: effectiveDuration,
            tracks: newTracks
          }
        };
      });
      video.pause();
      }; // fin applyDuration

      const rawDuration = video.duration;
      if (isFinite(rawDuration) && rawDuration > 0) {
        applyDuration(rawDuration);
        return;
      }
      // Duración no finita (típico en WebM grabados con MediaRecorder, que reportan
      // Infinity/NaN en loadedmetadata): forzamos un seek al final del fichero para
      // que el navegador la calcule y la leemos de currentTime (quedará clampeada a
      // la duración real). Sin esto, los vídeos de <1 min mostraban siempre 1:00.
      let resolved = false;
      const finishSeek = () => {
        if (resolved) return;
        resolved = true;
        video.removeEventListener('seeked', finishSeek);
        video.removeEventListener('timeupdate', finishSeek);
        const discovered = video.currentTime;
        try { video.currentTime = 0; } catch {}
        applyDuration(discovered);
      };
      video.addEventListener('seeked', finishSeek);
      video.addEventListener('timeupdate', finishSeek);
      try {
        video.currentTime = 1e101; // seek lejano: el navegador clampea al final real
      } catch {
        finishSeek();
      }
      // Salvaguarda: si en 1.5 s no ha saltado ningún evento, usar lo que haya
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        video.removeEventListener('seeked', finishSeek);
        video.removeEventListener('timeupdate', finishSeek);
        applyDuration(video.duration);
      }, 1500);
    };

    // Agregar evento para cuando el video puede reproducirse
    const handleCanPlay = () => {
      setVideoHasError(false); // El video está listo, quitamos cualquier estado de error
      // Asegurar que el video esté pausado
      video.pause();
    };

    // Agregar evento para detectar errores
    const handleError = (e: Event) => {
      const videoElement = e.target as HTMLVideoElement;
      if (!videoElement.src || videoElement.src === window.location.href) return;

      // Solo mostramos el error crítico si el video realmente no ha cargado nada
      // y tiene un código de error de red o formato
      if (videoElement.readyState < 1 && (videoElement.error?.code === 4 || videoElement.error?.code === 2)) {
        console.error('Error de Video Crítico:', videoElement.error);
        setVideoHasError(true);
      } else {
        // Errores menores o temporales se ignoran para no interrumpir al usuario
        console.warn('Aviso de Video (No crítico):', videoElement.error);
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
    };
  }, [videoUrl]);

  // Efecto para sincronizar el tiempo del video con el estado del timeline (SOLO cuando está pausado)
  // Durante reproducción, TimelinePlayer es la fuente de verdad; handleTimeUpdate causaría conflictos y reinicios
   isPlayingRef.current = isTimelinePlaying;
   isSimplePlayerRef.current = useSimplePlayer;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (isPlayingRef.current) return; // No actualizar timeline durante reproducción
      if (video.paused && (Date.now() - lastProgrammaticSeekRef.current) < 8000) return;
      const sourceTime = video.currentTime;
      setEditState(prev => {
        if (!prev.timeline) return prev;
        const allClips = prev.timeline.tracks.flatMap(t => t.clips).filter(isPlayableVideoClip);
        const trimStart = prev.trimStart ?? 0;
        for (const clip of allClips) {
          const clipLocalTime = mapSourceToClipLocal(clip, sourceTime, trimStart);
          if (clipLocalTime >= 0 && clipLocalTime < clip.duration) {
            const timelineTime = clip.startTime + clipLocalTime;
            if (Math.abs(prev.timeline.currentTime - timelineTime) < 0.05) return prev;
            return {
              ...prev,
              timeline: { ...prev.timeline, currentTime: Math.min(timelineTime, clip.startTime + clip.duration) }
            };
          }
        }
        return prev;
      });
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [mapSourceToClipLocal]);

  // Efecto para ajustar la duración total del timeline basándose en los clips
  useEffect(() => {
    if (!editState.timeline?.tracks) return;

    const allClips = editState.timeline.tracks.flatMap(t => t.clips);

    // SI NO HAY CLIPS, RESETEAMOS A ESTADO LIMPIO
    if (allClips.length === 0) {
      if (editState.timeline.duration !== 60 || editState.timeline.currentTime !== 0) {
        setEditState(prev => {
          if (!prev.timeline) return prev;
          return {
            ...prev,
            timeline: {
              ...prev.timeline,
              duration: 60,
              currentTime: 0
            }
          };
        });
        setVideoDuration(60);
      }
      return;
    }

    const maxEndTime = allClips.reduce((max, clip) => {
      return Math.max(max, clip.startTime + clip.duration);
    }, 0);

    // Ajustar duración a la del contenido (sin suelo de 60 s) para que los vídeos
    // cortos reflejen su duración exacta. El suelo de 60 s sólo aplica a proyectos
    // vacíos (rama de "sin clips" más arriba).
    const finalDuration = maxEndTime;

    if (Math.abs(editState.timeline.duration - finalDuration) > 0.5) {
      setEditState(prev => {
        if (!prev.timeline) return prev;
        return {
          ...prev,
          timeline: {
            ...prev.timeline,
            duration: finalDuration
          }
        };
      });
      setVideoDuration(finalDuration);
    }
  }, [tracksHash]);

  // Sincronizar el vídeo de preview con la posición del timeline al hacer seek (click o botones)
  // Convierte tiempo del timeline → tiempo de fuente usando sourceStartTime y playbackRate
  const seekPreviewTo = useCallback((timelineTime: number) => {
    const video = videoRef.current;
    if (!video) return;
    const info = getActiveVideoInfo(timelineTime);
    const targetSourceTime = info ? info.sourceTime : timelineTime;
    const timeDiff = Math.abs(video.currentTime - targetSourceTime);
    if (timeDiff < 0.05 && (!info || Math.abs((video.playbackRate || 1) - info.playbackRate) < 0.01)) return;
    if (seekRetryTimeoutRef.current) {
      clearTimeout(seekRetryTimeoutRef.current);
      seekRetryTimeoutRef.current = null;
    }
    lastProgrammaticSeekRef.current = Date.now();
    video.playbackRate = info?.playbackRate ?? 1;
    video.currentTime = targetSourceTime;

    // Reintentos: más allá de ~4–5 min el navegador puede no tener esa parte bufferada
    const scheduleRetry = (attempt: number) => {
      if (attempt > 2) return;
      seekRetryTimeoutRef.current = setTimeout(() => {
        seekRetryTimeoutRef.current = null;
        const v = videoRef.current;
        if (!v || !v.paused) return;
        const diff = Math.abs(v.currentTime - targetSourceTime);
        if (diff > 1) {
          lastProgrammaticSeekRef.current = Date.now();
          v.currentTime = targetSourceTime;
          scheduleRetry(attempt + 1);
        }
      }, 2000);
    };
    scheduleRetry(0);
  }, [getActiveVideoInfo]);

  // useLayoutEffect: seek ANTES del paint para evitar salto visible al inicio del fragmento
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video || !editState.timeline) return;

    const timelineTime = editState.timeline.currentTime;
    const info = getActiveVideoInfo(timelineTime);

    // --- LÓGICA DE VISIBILIDAD, AUDIO Y SINCRONIZACIÓN ---
    if (activeCaptureStream) {
      // Si hay una captura activa, forzar visibilidad y opacidad total
      video.style.opacity = "1";
      video.style.visibility = "visible";
      video.muted = true; // No queremos feedback de audio durante la captura de pantalla
    } else if (info && info.clip) {
      // SI HAY CLIP: Sincronizar y mostrar
      const expectedSourceTime = info.sourceTime;
      const expectedRate = Math.max(0.1, info.playbackRate ?? 1);
      const timeDiff = Math.abs(video.currentTime - expectedSourceTime);
      const rateDiff = Math.abs((video.playbackRate || 1) - expectedRate);

      if (rateDiff > 0.01) video.playbackRate = expectedRate;
      if (info.clip.reversed) {
        // Clip invertido: HTML5 no puede reproducir hacia atrás, así que el <video>
        // permanece PAUSADO y re-seekamos en CADA actualización de currentTime para
        // aproximar la reproducción reversa frame a frame (irá a saltos, esperado).
        if (!video.paused) video.pause();
        if (Math.abs(video.currentTime - expectedSourceTime) > 0.02) {
          video.currentTime = expectedSourceTime;
        }
      } else if (video.paused || timeDiff > 0.5) {
        if (timeDiff > 0.1) video.currentTime = expectedSourceTime;
      }

      // Fade y Opacidad
      const clip = info.clip;
      const clipLocalTime = timelineTime - clip.startTime;
      const fadeInDur = clip.fadeInDuration || 0;
      const fadeOutDur = clip.fadeOutDuration || 0;
      let opacity = 1;

      if (fadeInDur > 0 && clipLocalTime < fadeInDur) {
        opacity = clipLocalTime / fadeInDur;
      } else if (fadeOutDur > 0 && clipLocalTime > (clip.duration - fadeOutDur)) {
        opacity = (clip.duration - clipLocalTime) / fadeOutDur;
      }

      video.style.opacity = Math.max(0, Math.min(1, opacity)).toString();
      video.style.visibility = "visible";
      // Espejo horizontal del clip activo (visible en el reproductor simple; el
      // canvas ya lo aplica vía VideoNode en el scene graph).
      video.style.transform = info.clip.mirrored ? "scaleX(-1)" : "";

      // Asegurar que el audio del video principal suene (si no está muteado el track).
      // Un clip invertido lleva el audio silenciado (no se puede invertir el sonido en
      // tiempo real).
      const videoTrack = editState.timeline.tracks.find(t => t.type === 'video');
      video.muted = (videoTrack?.isMuted ?? false) || !!clip.reversed;
      video.volume = videoTrack?.volume ?? 1;

    } else {
      // SI NO HAY CLIP: Ocultar, silenciar y pausar
      video.style.opacity = "0";
      video.style.visibility = "hidden";
      video.style.transform = "";
      video.muted = true;
      video.volume = 0;
      // Solo pausamos si no se supone que estemos reproduciendo otra cosa
      if (!video.paused && !isTimelinePlaying) {
        video.pause();
      }
    }
  }, [editState.timeline?.currentTime, tracksHash, getActiveVideoInfo, isTimelinePlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !editState.timeline) return;

    // Buscar si hay alguna pista de video silenciada
    const tracks = editState.timeline.tracks || [];
    const videoTrack = tracks.find(track => track.type === 'video');
    const audioTrack = tracks.find(track => track.type === 'audio');

    // Obtener el clip de vídeo actual
    const currentVideoClip = getActiveVideoInfoRef.current(editState.timeline.currentTime);

    // El video se silencia si:
    // 1. La pista de video está silenciada
    // 2. El clip actual tiene volumen 0
    // 3. El volumen general es 0
    const isVideoMuted = videoTrack?.isMuted || false;
    const clipVolume = currentVideoClip?.clip?.volume ?? 1;
    const trackVolume = videoTrack?.volume ?? 1;
    const isReversedClip = !!currentVideoClip?.clip?.reversed;

    video.muted = isVideoMuted || clipVolume === 0 || isReversedClip;
    video.volume = clipVolume * trackVolume;

    // Sincronizar reproducción
    if (isTimelinePlaying) {
      if (isReversedClip) {
        // Clip invertido: no se puede reproducir hacia atrás con HTML5. Se mantiene
        // pausado y el useLayoutEffect re-seek frame a frame según avanza currentTime.
        if (!video.paused) video.pause();
      } else if (video.paused) {
        video.play().catch(() => { });
      }
    } else {
      if (!video.paused) {
        video.pause();
      }
    }
  }, [editState.timeline, isTimelinePlaying]);

  // Forzar sincronización cuando se inicia la reproducción (usar sourceTime, no timeline time)
  const getActiveVideoInfoRef = useRef(getActiveVideoInfo);
  getActiveVideoInfoRef.current = getActiveVideoInfo;
  useEffect(() => {
    if (!isTimelinePlaying) return;
    const video = videoRef.current;
    if (!video || !editState.timeline) return;
    const timelineTime = editState.timeline.currentTime;
    const info = getActiveVideoInfoRef.current(timelineTime);
    const targetSourceTime = info?.sourceTime ?? timelineTime;
    if (Math.abs(video.currentTime - targetSourceTime) > 0.1) {
      video.playbackRate = info?.playbackRate ?? 1;
      video.currentTime = targetSourceTime;
    }
  }, [isTimelinePlaying]);

  // Gestionar reproducción de audio del timeline
  useEffect(() => {
    if (!editState.timeline) return;

    const timeline = editState.timeline;
    const audioClipsByTrack = timeline.tracks.filter(t => t.type === 'audio').flatMap(track => track.clips.map(clip => ({ clip, track })));

    // Limpiar elementos de audio anteriores que ya no existen
    const currentClipIds = new Set(audioClipsByTrack.map(({ clip }) => clip.id));
    for (const [clipId, audioEl] of timelineAudioElementsRef.current) {
      if (!currentClipIds.has(clipId)) {
        audioEl.pause();
        audioEl.remove();
        timelineAudioElementsRef.current.delete(clipId);
      }
    }

    // Crear o actualizar elementos de audio para los clips actuales
    audioClipsByTrack.forEach(({ clip, track }) => {
      if (!clip.mediaFileId) return;

      let audioEl = timelineAudioElementsRef.current.get(clip.id);
      if (!audioEl) {
        audioEl = new Audio(clip.mediaFileId);
        if (clip.mediaFileId.startsWith('http')) audioEl.crossOrigin = 'anonymous';
        audioEl.preload = "auto";
        timelineAudioElementsRef.current.set(clip.id, audioEl);
      }

      // Sincronizar con la posición actual del timeline
      const currentTime = timeline.currentTime ?? 0;
      const clipVolume = clip.volume ?? 1;
      const trackVolume = (track.volume ?? 1);
      const isMutedTrack = track.isMuted;

      if (currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration) {
        const localTime = currentTime - clip.startTime;
        if (Math.abs(audioEl.currentTime - localTime) > 0.1) {
          audioEl.currentTime = localTime;
        }
        
        // Aplicar volumen del clip
        audioEl.volume = isMutedTrack ? 0 : Math.min(1, clipVolume * trackVolume);

        if (isTimelinePlaying) {
          if (audioEl.paused) {
            audioEl.play().catch(() => {});
          }
        } else if (!audioEl.paused) {
          audioEl.pause();
        }
      } else {
        if (!audioEl.paused) {
          audioEl.pause();
        }
      }
    });
  }, [editState.timeline?.currentTime, isTimelinePlaying, editState.timeline?.tracks]);

  // Limpiar todos los elementos de audio al desmontar el editor
  useEffect(() => {
    return () => {
      for (const [, audioEl] of timelineAudioElementsRef.current) {
        audioEl.pause();
        audioEl.src = '';
        audioEl.load();
      }
      timelineAudioElementsRef.current.clear();
    };
  }, []);

  // Handle video source changes when the active clip changes (incl. durante la
  // reproducción, al cruzar de un clip al siguiente). Antes dependía sólo de
  // tracksHash/videoUrl y no cambiaba la fuente a mitad del playback, así que el
  // <video> principal seguía reproduciendo el clip anterior (la parte "cortada").
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // SI HAY CAPTURA ACTIVA, NO HACER NADA CON EL SRC
    if (activeCaptureStream) {
      if (video.src) {
        video.removeAttribute('src'); // Limpiar el src para que no choque con el srcObject
        video.load();
      }
      lastVideoSourceRef.current = undefined;
      return;
    }

    const timelineTime = timelineRef.current?.currentTime ?? 0;
    const info = getActiveVideoInfo(timelineTime);
    // Si el clip activo es una imagen, no cargar nada en el <video> oculto: las
    // imágenes las pinta el overlay DOM (activeImageClips) y el <video> sólo sabe
    // decodificar vídeo (de lo contrario lanza "Error cargando video source").
    const newSource = (info && info.clip.type === 'image') ? '' : (info?.url ?? getCurrentVideoSource());

    if (lastVideoSourceRef.current !== newSource) {
      lastVideoSourceRef.current = newSource;
      const gen = ++videoSrcGenRef.current;
      const wasPlaying = !video.paused;
      const targetSourceTime = info?.sourceTime ?? timelineTime;

      console.log('Cambiando fuente de video a:', newSource, 'Tipo:', info?.clip?.type);
      if (newSource) {
        // crossOrigin ANTES de asignar src: sin él, un canvas que dibuje este
        // <video> se tainta y getImageData/toDataURL lanzan SecurityError (varita
        // mágica, screenshot). media:// ya responde Access-Control-Allow-Origin: *;
        // http(s) funciona si el servidor manda cabeceras CORS (si no, el vídeo no
        // carga: fallo visible en la UI en vez de error silencioso al leer píxeles).
        // blob:/data: son same-origin y no necesitan (ni aceptan) crossOrigin.
        if (!newSource.startsWith('blob:') && !newSource.startsWith('data:')) {
          video.crossOrigin = 'anonymous';
        }
        video.src = newSource;
      } else {
        video.removeAttribute('src');
        video.load();
      }

      const onLoaded = () => {
        // Si la fuente volvió a cambiar antes de cargar, ignoramos este evento.
        if (videoSrcGenRef.current !== gen) return;
        video.playbackRate = info?.playbackRate ?? 1;
        video.currentTime = targetSourceTime;
        if (info?.clip?.reversed) {
          // Clip invertido: NO reproducir (HTML5 no va hacia atrás). Permanece pausado;
          // el useLayoutEffect re-seek frame a frame. El currentTime ya fijado encima
          // fuerza la decodificación del frame correcto.
          if (!video.paused) video.pause();
        } else if (wasPlaying) {
          video.play().catch(() => { });
        } else {
          // "Priming" del decodificador: un play+pause inmediato muteado calienta el
          // pipeline de vídeo al cargar, de modo que el primer play real del usuario
          // arranque sin el micro-corte/salto inicial del decoder. No hay movimiento ni
          // audio visibles (muteado y pausa en el mismo frame).
          try {
            const wasMuted = video.muted;
            video.muted = true;
            const p = video.play();
            if (p && typeof p.then === 'function') {
              p.then(() => { video.pause(); video.muted = wasMuted; }).catch(() => { video.muted = wasMuted; });
            } else {
              video.pause();
              video.muted = wasMuted;
            }
          } catch {}
        }
      };
      const onError = () => {
        if (videoSrcGenRef.current !== gen) return;
        console.error('Error cargando video source:', newSource);
      };
      // { once: true } + guard de generación: el handler se autoelimina al dispararse
      // y los stale (de cambios anteriores) quedan inactivos sin re-seekar a posiciones viejas.
      video.addEventListener('loadeddata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    }
  }, [editState.timeline?.currentTime, tracksHash, videoUrl, getActiveVideoInfo, getCurrentVideoSource, activeCaptureStream]);

  /** Nombres de archivos del timeline para la barra: "Vídeo: x.mp4", "Audio: y.mp3", etc. */
  const timelineFileNameItems = useMemo(() => {
    // Si tenemos un nombre de proyecto, lo usamos como prioridad
    if (currentProjectName) {
      return [`PROYECTO: ${currentProjectName.toUpperCase()}`];
    }

    const tracks = editState.timeline?.tracks ?? [];
    const typeLabels: Record<TrackType, string> = { video: 'Vídeo', audio: 'Audio', text: 'Texto', image: 'Imagen' };
    const items: string[] = [];
    for (const track of tracks) {
      const label = typeLabels[track.type] ?? track.type;
      for (const clip of track.clips) {
        const rawName = clip.label ?? (clip.mediaFileId ? String(clip.mediaFileId).split(/[/\\]/).pop() || clip.mediaFileId : clip.text?.slice(0, 20) || 'sin nombre');
        const name = clip.label ?? (clip.mediaFileId ? cleanDisplayFileName(String(clip.mediaFileId)) : rawName);
        items.push(`${label}: ${name}`);
      }
    }
    if (items.length === 0 && videoUrl) {
      const mainRaw = String(videoUrl).split(/[/\\]/).pop();
      const mainName = mainRaw ? cleanDisplayFileName(mainRaw) : 'Vídeo principal';
      items.push(`Vídeo: ${mainName}`);
    }

    // Si después de todo no hay nada, mostramos el mensaje de vacío
    if (items.length === 0) {
      return ["NO TRACK LOADED"];
    }

    return items;
  }, [editState.timeline?.tracks, videoUrl, currentProjectName]);

  const resolvedObjectClips = useMemo(() => {
    const timelineClipsById = new Map(
      (editState.timeline?.tracks || [])
        .flatMap((track) => track.clips)
        .map((clip) => [clip.id, clip] as const)
    );

    return (editState.objectClips || []).map((objectClip) => {
      const timelineClip = timelineClipsById.get(objectClip.id);
      if (!timelineClip) return objectClip;
      return {
        ...objectClip,
        startTime: timelineClip.startTime ?? objectClip.startTime,
        duration: timelineClip.duration ?? objectClip.duration,
        opacity: Math.round(((timelineClip.opacity ?? (objectClip.opacity / 100)) || 0) * 100),
        fadeInDuration: timelineClip.fadeInDuration ?? objectClip.fadeInDuration ?? 0,
        fadeOutDuration: timelineClip.fadeOutDuration ?? objectClip.fadeOutDuration ?? 0,
      };
    });
  }, [editState.objectClips, editState.timeline?.tracks]);

  const deformableObjectClips = useMemo(() => {
    const filtered = resolvedObjectClips.filter(clip => clip.isDeformable !== false);
    return filtered;
  }, [resolvedObjectClips]);

  const normalObjectClips = useMemo(() => {
    const filtered = resolvedObjectClips.filter(clip => clip.isDeformable === false);
    return filtered;
  }, [resolvedObjectClips]);

  // Durante la captura de vértices, mostramos una vista previa dedicada del
  // objeto colocado (selectedObjectId → vertexTargetObjectId) para que el
  // usuario alinee los 4 vértices a la forma real del objeto (incluidas las
  // formas raras/transparentes). Excluimos ese objeto de los overlays normales
  // (que solo lo pintan si el playhead cae dentro del span del clip) para que
  // no se duplique y la vista de alineación sea la única fuente de verdad.
  const vertexAlignObjectId = useMemo(() => {
    if (!isCapturingVertex) return null;
    const sel = resolvedObjectClips.find(c => c.id === selectedObjectId);
    if (sel) return sel.id;
    if (vertexTargetObjectId) {
      const t = resolvedObjectClips.find(c => c.id === vertexTargetObjectId);
      if (t) return t.id;
    }
    return null;
  }, [isCapturingVertex, selectedObjectId, vertexTargetObjectId, resolvedObjectClips]);

  const vertexAlignClip = useMemo(
    () => (isCapturingVertex ? resolvedObjectClips.find(c => c.id === vertexAlignObjectId) ?? null : null),
    [isCapturingVertex, vertexAlignObjectId, resolvedObjectClips]
  );

  // Version filtrada que oculta objetos con visible=false (para preview y export)
  const visibleDeformableObjectClips = useMemo(
    () => deformableObjectClips.filter(clip => clip.visible !== false && clip.id !== vertexAlignObjectId),
    [deformableObjectClips, vertexAlignObjectId]
  );
  const visibleNormalObjectClips = useMemo(
    () => normalObjectClips.filter(clip => clip.visible !== false && clip.id !== vertexAlignObjectId),
    [normalObjectClips, vertexAlignObjectId]
  );

  const resolvedEffectClips = useMemo(() => {
    const effectsTrack = editState.timeline?.tracks.find(isEffectsTrack);
    if (!effectsTrack) return [];

    return effectsTrack.clips
      .filter((clip) => clip.overlayKind === 'effect' && clip.mediaFileId)
      .map((clip) => {
        const width = (clip as any).width ?? 100;
        const height = (clip as any).height ?? 100;
        const position = (clip as any).position ?? { x: 50, y: 50 };
        return {
          id: clip.id,
          src: clip.mediaFileId!,
          width,
          height,
          opacity: Math.round(((clip.opacity ?? 1) * 100)),
          startTime: clip.startTime,
          duration: clip.duration,
          fadeInDuration: clip.fadeInDuration ?? 0,
          fadeOutDuration: clip.fadeOutDuration ?? 0,
          position,
          isBold: false,
          isItalic: false,
          isUnderline: false,
          mediaType: 'video',
          mirrored: !!clip.mirrored,
          shadowBlur: clip.shadowBlur ?? 0,
          shadowColor: clip.shadowColor ?? 'transparent'
        };
      });
  }, [editState.timeline?.tracks]);

  const persistSavedTextPresets = useCallback((presets: SavedTextPreset[]) => {
    setSavedTextPresets(presets);
    try {
      localStorage.setItem(SAVED_TEXTS_STORAGE_KEY, JSON.stringify(presets));
    } catch (_) { }
  }, []);

  const handleSaveCurrentTextPreset = useCallback(() => {
    const defaultName = (customFontStyle.text || 'Texto guardado').trim().slice(0, 40) || 'Texto guardado';
    let name = defaultName;
    try {
      if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
        const result = window.prompt('Nombre para este texto guardado:', defaultName);
        if (result !== null) name = result.trim() || defaultName;
      }
    } catch (e) {
      console.warn('window.prompt no está soportado');
    }
    if (!name) return;
    const nextPresets = [
      ...savedTextPresets,
      {
        id: `saved-text-${Date.now()}`,
        name,
        style: { ...customFontStyle },
      },
    ];
    persistSavedTextPresets(nextPresets);
  }, [customFontStyle, persistSavedTextPresets, savedTextPresets]);

  const applyTextPreset = useCallback((style: FontStyle) => {
    setCustomFontStyle(style);
    setPendingTextStyleApplication({
      nonce: Date.now(),
      style: { ...style },
    });
  }, []);

  const handleUseSavedTextPreset = useCallback((presetId: string) => {
    const preset = savedTextPresets.find((item) => item.id === presetId);
    if (!preset) return;
    applyTextPreset(preset.style);
  }, [applyTextPreset, savedTextPresets]);

  const handleDeleteSavedTextPreset = useCallback((presetId: string) => {
    persistSavedTextPresets(savedTextPresets.filter((item) => item.id !== presetId));
  }, [persistSavedTextPresets, savedTextPresets]);

  const handleTimelineChange = (timeline: TimelineState) => {
    console.log('🔒 handleTimelineChange called');
    timeline.tracks.forEach(track => {
      console.log(`🔒 Track ${track.id} isLocked: ${track.isLocked}`);
    });
    saveToHistory({ ...editState, timeline });
  };

   const handleTimelinePlayPause = (isPlaying: boolean) => {
     setIsTimelinePlaying(isPlaying);
   };

  

  // Refrescar la vista previa: recarga el <video> principal desde la posición actual
  // para rehacer el buffer y limpiar el decodificador. Útil cuando el vídeo se frena
  // o se queda pillado en un punto (buffer agotado / memoria acumulada). Pausa la
  // reproducción, suelta la fuente, la vuelve a cargar y hace seek al punto actual.
  const handleRefreshPreview = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setIsTimelinePlaying(false);
    try { video.pause(); } catch {}

    const timelineTime = editState.timeline?.currentTime ?? 0;
    const info = getActiveVideoInfo(timelineTime);
    const src = info?.url ?? getCurrentVideoSource();
    const targetSourceTime = info?.sourceTime ?? timelineTime;

    // Soltar la fuente actual y forzar recarga (limpia el buffer del elemento).
    try {
      video.removeAttribute('src');
      video.load();
    } catch {}

    if (src) {
      // crossOrigin antes de src: ver el effect de cambio de fuente (línea ~3399).
      if (!src.startsWith('blob:') && !src.startsWith('data:')) video.crossOrigin = 'anonymous';
      video.src = src;
      video.playbackRate = info?.playbackRate ?? 1;
      lastVideoSourceRef.current = src; // evitar que el effect de cambio de fuente re-asigne de nuevo
      const onReady = () => {
        try { video.currentTime = targetSourceTime; } catch {}
      };
      video.addEventListener('loadeddata', onReady, { once: true });
      // Si ya estaba descargado, aplicar el seek de inmediato.
      if (video.readyState >= 2) {
        try { video.currentTime = targetSourceTime; } catch {}
      }
    } else {
      lastVideoSourceRef.current = undefined;
    }
  }, [editState.timeline, getActiveVideoInfo, getCurrentVideoSource]);

  const handleTimelineTimeUpdate = useCallback((time: number) => {
    setEditState(prev => {
      if (!prev.timeline) return prev;
      const currentTime = prev.timeline.currentTime ?? 0;
      if (Math.abs(currentTime - time) < 0.001) return prev;
      return {
        ...prev,
        timeline: {
          ...prev.timeline,
          currentTime: time
        }
      };
    });
  }, []);

  // ===== LTX Video — hooks (DEBEN ir antes del guard `if (!mounted)` para respetar el orden de hooks) =====
  const LTX_SETTINGS_KEY = 'zms-ltx-settings';
  const loadLtxSettings = (): Record<string, string> => {
    try { return JSON.parse(localStorage.getItem(LTX_SETTINGS_KEY) || '{}'); } catch { return {}; }
  };
  const ltxSettings = loadLtxSettings();

  const [ltxPrompt, setLtxPrompt] = useState('');
  const [ltxNegative, setLtxNegative] = useState('');
  const [ltxSeed, setLtxSeed] = useState(42);
  const [ltxWorkflowJson, setLtxWorkflowJson] = useState<object | null>(null);
  const [ltxWorkflowName, setLtxWorkflowName] = useState('');
  const [ltxMode, setLtxMode] = useState<'i2v' | 't2v'>((ltxSettings.mode as 'i2v' | 't2v') || 'i2v');
  const [ltxT2vSwitchNode, setLtxT2vSwitchNode] = useState(ltxSettings.t2vSwitchNode || '');
  const [ltxPromptNode, setLtxPromptNode] = useState(ltxSettings.promptNode || '');
  const [ltxNegativeNode, setLtxNegativeNode] = useState(ltxSettings.negativeNode || '');
  const [ltxSeedNode, setLtxSeedNode] = useState(ltxSettings.seedNode || '');
  const [ltxImageNode, setLtxImageNode] = useState(ltxSettings.imageNode || '');
  const [ltxDurationNode, setLtxDurationNode] = useState(ltxSettings.durationNode || '');
  const [ltxFpsNode, setLtxFpsNode] = useState(ltxSettings.fpsNode || '');
  const [ltxDuration, setLtxDuration] = useState<number>(Number(ltxSettings.durationValue ?? 0) || 0);
  const [ltxFps, setLtxFps] = useState(0);
  const [ltxWidthNode, setLtxWidthNode] = useState(ltxSettings.widthNode || '');
  const [ltxHeightNode, setLtxHeightNode] = useState(ltxSettings.heightNode || '');
  const [ltxWidth, setLtxWidth] = useState<number>(Number(ltxSettings.widthValue ?? 0) || 0);
  const [ltxHeight, setLtxHeight] = useState<number>(Number(ltxSettings.heightValue ?? 0) || 0);
  const [ltxWorkflowPath, setLtxWorkflowPath] = useState<string>(ltxSettings.workflowPath || '');
  const [ltxImageFile, setLtxImageFile] = useState<File | null>(null);
  const [ltxImagePreviewUrl, setLtxImagePreviewUrl] = useState<string | null>(null);
  const [isGeneratingLtx, setIsGeneratingLtx] = useState(false);
  const [ltxProgress, setLtxProgress] = useState<{ current: number; total: number; percent: number } | null>(null);
  const [ltxError, setLtxError] = useState<string | null>(null);
  const [ltxFileName, setLtxFileName] = useState<string>('');
  const [ltxComfyUrl] = useState(ltxSettings.comfyUrl || 'http://127.0.0.1:8188');
  const [ltxServerStatus, setLtxServerStatus] = useState<{ comfyui: boolean; fluxBridge: boolean }>({ comfyui: false, fluxBridge: false });
  const [isStartingLtxServers, setIsStartingLtxServers] = useState(false);
  const [ltxServerMessage, setLtxServerMessage] = useState<string | null>(null);

  const ltxNodeCandidates = useMemo(() => {
    const empty = { text: [] as { id: string; ct: string }[], seed: [] as { id: string; ct: string }[], image: [] as { id: string; ct: string }[], frames: [] as { id: string; ct: string }[], fps: [] as { id: string; ct: string }[], width: [] as { id: string; ct: string }[], height: [] as { id: string; ct: string }[], boolean: [] as { id: string; ct: string }[] };
    const wf = ltxWorkflowJson as Record<string, any> | null;
    if (!wf || typeof wf !== 'object') return empty;
    for (const [id, node] of Object.entries(wf)) {
      if (typeof node !== 'object' || node === null) continue;
      const ct = String(node.class_type || node.type || '');
      const keys = new Set(Object.keys(node.inputs || {}));
      const push = (arr: { id: string; ct: string }[]) => arr.push({ id, ct });
      if (/TextEncode|TextEncoder|Prompt|String|Multiline/i.test(ct) || keys.has('text') || keys.has('prompt') || keys.has('negative_prompt') || keys.has('prompt_g') || keys.has('prompt_l')) push(empty.text);
      if (/KSampler|RandomNoise|Noise/i.test(ct) || keys.has('seed') || keys.has('noise_seed')) push(empty.seed);
      if (ct === 'LoadImage') push(empty.image);
      if (keys.has('length') || keys.has('batch_size') || keys.has('frames') || keys.has('num_frames')) push(empty.frames);
      if (keys.has('fps') || keys.has('frame_rate') || keys.has('frames_per_second')) push(empty.fps);
      if (keys.has('width')) push(empty.width);
      if (keys.has('height')) push(empty.height);
      if (/Boolean|Toggle|Switch/i.test(ct)) push(empty.boolean);
    }
    return empty;
  }, [ltxWorkflowJson]);

  // Auto-rellenar los IDs de nodos vacíos al cargar un workflow (sólo si el campo está
  // vacío, para no pisar lo que el usuario haya fijado a mano).
  useEffect(() => {
    if (!ltxWorkflowJson) return;
    const t = ltxNodeCandidates.text;
    if (!ltxPromptNode.trim() && t[0]) setLtxPromptNode(t[0].id);
    if (!ltxNegativeNode.trim() && t[1]) setLtxNegativeNode(t[1].id);
    if (!ltxSeedNode.trim() && ltxNodeCandidates.seed[0]) setLtxSeedNode(ltxNodeCandidates.seed[0].id);
    if (!ltxImageNode.trim() && ltxNodeCandidates.image[0]) setLtxImageNode(ltxNodeCandidates.image[0].id);
    if (!ltxDurationNode.trim() && ltxNodeCandidates.frames[0]) setLtxDurationNode(ltxNodeCandidates.frames[0].id);
    if (!ltxFpsNode.trim() && ltxNodeCandidates.fps[0]) setLtxFpsNode(ltxNodeCandidates.fps[0].id);
    if (!ltxWidthNode.trim() && ltxNodeCandidates.width[0]) setLtxWidthNode(ltxNodeCandidates.width[0].id);
    if (!ltxHeightNode.trim() && ltxNodeCandidates.height[0]) setLtxHeightNode(ltxNodeCandidates.height[0].id);
    if (!ltxT2vSwitchNode.trim() && ltxNodeCandidates.boolean[0]) setLtxT2vSwitchNode(ltxNodeCandidates.boolean[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ltxWorkflowJson]);

  // Input reutilizable para un ID de nodo del workflow cargado. Usa <datalist>:
  // el usuario puede teclear el ID a mano (el que vea en ComfyUI) o elegirlo de la
  // lista de nodos detectados. Si el valor no está en el workflow, se marca en ámbar.
  const renderLtxNodeSelect = (
    value: string,
    onChange: (v: string) => void,
    candidates: { id: string; ct: string }[],
    placeholder: string,
    listKey?: string,
  ) => {
    const stableListKey = listKey || candidates.map((c) => c.id).join('-');
    const inList = !value || candidates.some((c) => c.id === value);
    return (
      <>
        <input
          list={`ltx-nodes-${stableListKey}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full bg-transparent border rounded-lg p-1.5 text-xs outline-none focus:ring-1 focus:ring-emerald-400 ${!inList ? 'border-amber-500/60 text-amber-300' : 'border-gray-700 text-white'}`}
        />
        <datalist id={`ltx-nodes-${stableListKey}`}>
          {candidates.map((c) => {
            return <option key={c.id} value={c.id}>{c.id}</option>;
          })}
        </datalist>
      </>
    );
  };

  // --- Mejorar calidad (ffmpeg) ---
  const [enhanceSourceFile, setEnhanceSourceFile] = useState<File | null>(null);
  const [enhanceSourcePath, setEnhanceSourcePath] = useState<string>(''); // ruta local si "usar vídeo cargado"
  const [enhanceScale, setEnhanceScale] = useState<'no' | '1.5x' | '2x' | '1080p' | '4k'>('2x');
  const [enhanceSharpen, setEnhanceSharpen] = useState<number>(1.0);
  const [enhanceDenoise, setEnhanceDenoise] = useState<number>(0);
  const [enhanceFps, setEnhanceFps] = useState<'no' | '30' | '60'>('60');
  const [enhanceMotion, setEnhanceMotion] = useState<boolean>(false);
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const [enhanceProgress, setEnhanceProgress] = useState<number>(0);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [enhanceFileName, setEnhanceFileName] = useState<string>('');

  // Captura de pantalla (pestaña Captura): silenciar el preview de la selección de zona.
  const [captureAudioMuted, setCaptureAudioMuted] = useState<boolean>(true);

  // --- SAM2 (segmentación de vídeo con IA vía ComfyUI) ---
  // El usuario aporta su workflow SAM2 (formato API) con un nodo LoadVideo (vídeo
  // fuente) y un nodo portador de la cadena de puntos (PrimitiveNode cuyo "value"
  // alimenta coordinates_positive de Sam2Segmentation en modo vídeo). El editor
  // calcula puntos DENTRO del lazo a partir de su forma, el bridge inyecta el JSON
  // en ese nodo, lanza el workflow y devuelve un vídeo de máscaras; el frontend lo
  // decodifica a PNGs por frame (luminancia→alfa) → motionMasks (silueta cambiante).
  // La silueta cambia al contorno REAL del objeto cada frame (no sólo se deforma).
  const SAM2_SETTINGS_KEY = 'zms-sam2-settings';
  const loadSam2Settings = (): Record<string, string> => {
    try { return JSON.parse(localStorage.getItem(SAM2_SETTINGS_KEY) || '{}'); } catch { return {}; }
  };
  const sam2Settings = loadSam2Settings();
  const [sam2WorkflowJson, setSam2WorkflowJson] = useState<object | null>(null);
  const [sam2WorkflowName, setSam2WorkflowName] = useState('');
  const [sam2WorkflowPath, setSam2WorkflowPath] = useState<string>(sam2Settings.workflowPath || '');
  const [sam2VideoNode, setSam2VideoNode] = useState(sam2Settings.videoNode || '');
  const [sam2PointsNode, setSam2PointsNode] = useState(sam2Settings.pointsNode || '');
  const [sam2FrameNode, setSam2FrameNode] = useState(sam2Settings.frameNode || '');
  const [sam2FrameIndex, setSam2FrameIndex] = useState(sam2Settings.frameIndex ?? '0');
  const [sam2ComfyUrl] = useState(sam2Settings.comfyUrl || 'http://127.0.0.1:8188');
  const [sam2Busy, setSam2Busy] = useState(false);
  const [sam2Progress, setSam2Progress] = useState<{ current: number; total: number; percent: number } | null>(null);
  const [sam2Error, setSam2Error] = useState<string | null>(null);
  // Segunda pasada aditiva: en vez de reemplazar motionMasks, la nueva segmentación
  // se FUSIONA (unión) con las máscaras existentes frame a frame. Sirve para tapar
  // los frames donde la primera pasada dejó partes del objeto sin marcar: se dibuja
  // el lazo en el frame que falla y se vuelve a pulsar Segmentar.
  const [sam2Merge, setSam2Merge] = useState(false);
  // Fuerza del prompt (densidad de puntos positivos que recibe SAM2): 1x = grilla
  // 12x12 con tope 12 puntos; 4x = grilla 48x48 con tope 48. En la segunda pasada
  // además se añaden puntos muestreados de la máscara existente del frame del prompt
  // (objeto completo), de modo que subir la fuerza hace que SAM2 re-segmente con más
  // precisión la zona que la primera pasada no cubrió.
  const [sam2PromptStrength, setSam2PromptStrength] = useState(2);
  // Límite temporal de la segunda pasada: si sam2MergeRange está activo, la fusión
  // solo toca los frames dentro de ±sam2MergeRangeSec segundos alrededor del frame
  // actual (donde se dibujó el lazo). El resto del vídeo queda con las máscaras
  // existentes intactas (evita que una propagación lejana contamine zonas buenas).
  const [sam2MergeRange, setSam2MergeRange] = useState(false);
  const [sam2MergeRangeSec, setSam2MergeRangeSec] = useState(2);
  // Retoque de máscaras SAM2 (motionMasks): borrar/añadir/varita al frame actual.
  const [maskEditMode, setMaskEditMode] = useState<'erase' | 'add' | 'wand' | null>(null);
  const [maskBrushSize, setMaskBrushSize] = useState(24);
  const [maskEditVersion, setMaskEditVersion] = useState(0);

  const sam2NodeCandidates = useMemo(() => {
    const empty = { video: [] as { id: string; ct: string }[], points: [] as { id: string; ct: string }[], frame: [] as { id: string; ct: string }[] };
    const wf = sam2WorkflowJson as Record<string, any> | null;
    if (!wf || typeof wf !== 'object') return empty;
    for (const [id, node] of Object.entries(wf)) {
      if (typeof node !== 'object' || node === null) continue;
      const ct = String(node.class_type || node.type || '');
      const keys = new Set(Object.keys(node.inputs || {}));
      if (/LoadVideo|VHS_LoadVideo/i.test(ct)) empty.video.push({ id, ct });
      // Nodo de segmentación donde se inyectan los puntos como coordinates_positive
      // (literal en formato API; forceInput sólo restringe la UI). Sam2Segmentation
      // (modo vídeo, propaga) o Sam2VideoSegmentationAddPoints (cadena con frame_index).
      if (ct === 'Sam2Segmentation' || ct === 'Sam2VideoSegmentationAddPoints') empty.points.push({ id, ct });
      if (keys.has('frame') || keys.has('frame_index')) empty.frame.push({ id, ct });
    }
    return empty;
  }, [sam2WorkflowJson]);

  useEffect(() => {
    if (!sam2WorkflowJson) return;
    if (!sam2VideoNode.trim() && sam2NodeCandidates.video[0]) setSam2VideoNode(sam2NodeCandidates.video[0].id);
    if (!sam2PointsNode.trim() && sam2NodeCandidates.points[0]) setSam2PointsNode(sam2NodeCandidates.points[0].id);
    if (!sam2FrameNode.trim() && sam2NodeCandidates.frame[0]) setSam2FrameNode(sam2NodeCandidates.frame[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sam2WorkflowJson]);

  const loadSam2WorkflowFromPath = useCallback(async (path: string) => {
    if (!path) return;
    try {
      const txt = await readFile(path);
      if (!txt) return;
      const parsed = JSON.parse(txt);
      setSam2WorkflowJson(parsed);
      setSam2WorkflowName(path.replace(/\\/g, '/').split('/').pop() || path);
      setSam2WorkflowPath(path);
      setSam2Error(null);
      try {
        const cur = loadSam2Settings();
        localStorage.setItem(SAM2_SETTINGS_KEY, JSON.stringify({ ...cur, workflowPath: path }));
      } catch {}
    } catch (e: any) {
      setSam2Error('No se pudo leer el workflow: ' + (e?.message || e));
    }
  }, []);

  // Convierte una URL media:// o una ruta Windows → ruta OS del archivo (para
  // readFileBuffer). Devuelve null si es remota (PocketBase/http) y no se puede
  // leer localmente.
  const urlToOsPath = (u: string): string | null => {
    if (!u) return null;
    if (u.startsWith('media://')) {
      try { const p = u.split('path=')[1]; return p ? decodeURIComponent(p) : null; } catch { return null; }
    }
    if (/^[a-zA-Z]:[\\/]/.test(u)) return u;
    return null;
  };

  // Retoque de máscaras EN MEMORIA: el pincel NO escribe a disco al soltar. Acumula
  // los canvas editados por URL y activa un override en loadMaskImage para que el
  // preview/export muestre el retoque en vivo. Sólo "Listo" / "Guardar proyecto"
  // vuelcan a disco (flushPendingMaskEdits); descartar (re-segmentar / quitar silueta
  // / desmontar) borra los overrides sin tocar el disco original.
  const pendingMaskCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());

  const onMaskEditCommit = useCallback((url: string, canvas: HTMLCanvasElement) => {
    pendingMaskCanvasesRef.current.set(url, canvas);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = canvas.toDataURL('image/png');
      setMaskOverride(url, img);
    } catch (e) {
      console.error('Error al activar el override de máscara', e);
    }
  }, []);

  // Varita en el retoque de máscara: flood fill del frame en el punto pulsado y
  // aplicación sobre la máscara del fotograma actual (en memoria, como el pincel).
  // Modo según modificador: 'add' (Ctrl+clic) añade la región por color; 'subtract'
  // (Shift+clic) la borra; 'replace' (sin modificador) decide según el punto: si
  // cae DENTRO de la máscara borra la región, si cae fuera la añade.
  // Comparte tolerancia con la varita de selección (wandTolerance).
  const handleMaskWandPick = async (xPct: number, yPct: number, mode: 'replace' | 'add' | 'subtract' = 'replace') => {
    const video = videoRef.current;
    if (!video) {
      toast({ title: 'Varita (máscara)', description: 'No hay vídeo cargado.', variant: 'destructive' });
      return;
    }
    const vw = video.videoWidth || videoNativeSize?.width || previewVideoSize.width;
    const vh = video.videoHeight || videoNativeSize?.height || previewVideoSize.height;
    if (!vw || !vh) {
      toast({ title: 'Varita (máscara)', description: 'El vídeo aún no tiene un frame decodificado.', variant: 'destructive' });
      return;
    }
    const maskUrl = editState.selection?.enabled ? effectiveSelectionMaskUrl(editState.selection, currentTime) : null;
    if (!maskUrl) {
      toast({ title: 'Varita (máscara)', description: 'No hay máscara raster en este fotograma.', variant: 'destructive' });
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    try {
      ctx.drawImage(video, 0, 0, vw, vh);
      ctx.getImageData(0, 0, 1, 1);
    } catch {
      toast({ title: 'Varita (máscara)', description: 'No se pudo leer el frame actual (¿vídeo remoto sin CORS?).', variant: 'destructive' });
      return;
    }
    const px = Math.max(0, Math.min(vw - 1, Math.round((xPct / 100) * vw)));
    const py = Math.max(0, Math.min(vh - 1, Math.round((yPct / 100) * vh)));
    const res = floodFillMask(canvas, px, py, wandTolerance);
    if (!res || res.selectedPixels === 0) {
      toast({ title: 'Varita (máscara)', description: 'No se encontró ninguna región con esa tolerancia. Prueba a aumentarla.', variant: 'destructive' });
      return;
    }
    let img: HTMLImageElement;
    try {
      img = await loadMaskImage(maskUrl);
    } catch {
      toast({ title: 'Varita (máscara)', description: 'No se pudo cargar la máscara de este fotograma.', variant: 'destructive' });
      return;
    }
    const mc = document.createElement('canvas');
    mc.width = img.naturalWidth;
    mc.height = img.naturalHeight;
    const mctx = mc.getContext('2d');
    if (!mctx) return;
    mctx.drawImage(img, 0, 0);
    // ¿Añadir o borrar? Ctrl+clic añade, Shift+clic borra; sin modificador se
    // decide según si el punto pulsado ya está dentro de la máscara.
    const mx = Math.max(0, Math.min(img.naturalWidth - 1, Math.round((px / vw) * img.naturalWidth)));
    const my = Math.max(0, Math.min(img.naturalHeight - 1, Math.round((py / vh) * img.naturalHeight)));
    const sample = mctx.getImageData(mx, my, 1, 1).data;
    const erase = mode === 'subtract' ? true : mode === 'add' ? false : sample[3] > 128;
    let selImg: HTMLImageElement;
    try {
      selImg = await loadMaskImage(res.maskUrl);
    } catch {
      toast({ title: 'Varita (máscara)', description: 'No se pudo aplicar la región seleccionada.', variant: 'destructive' });
      return;
    }
    mctx.save();
    mctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    mctx.drawImage(selImg, 0, 0, mc.width, mc.height);
    mctx.restore();
    onMaskEditCommit(maskUrl, mc);
    // Refresca el canvas de edición del overlay para mostrar el resultado en vivo.
    setMaskEditVersion((v) => v + 1);
  };

  // Trazo aditivo/sustractivo sobre la máscara (como la varita mágica): al CERRAR
  // un lazo con Ctrl+clic/Enter la región interior del lazo se AÑADE a la máscara
  // del frame actual (unión); con Shift se EXTRAE (diferencia). El lazo se
  // rasteriza a resolución de vídeo y se compone sobre la máscara efectiva del
  // frame (respeta los overrides de retoque en memoria vía loadMaskImage).
  // Si NO hay máscara aún, Ctrl+cerrar la CREA desde el lazo (estática t=0, como
  // la varita); Shift sin máscara no tiene nada que restar (toast).
  const handleLazoApply = async (paths: BezierAnchor[][], mode: 'add' | 'subtract') => {
    const es = editStateRef.current;
    const cur = es.selection;
    if (!cur?.enabled || !cur.shape) return false;
    const vw = videoNativeSize?.width || previewVideoSize.width;
    const vh = videoNativeSize?.height || previewVideoSize.height;
    if (!vw || !vh) {
      toast({ title: 'Trazo (máscara)', description: 'El vídeo aún no tiene tamaño conocido.', variant: 'destructive' });
      return false;
    }
    const closed = paths.filter((p) => p.length >= 3);
    if (closed.length === 0) return false;
    // Rasteriza el lazo cerrado (paths Bézier en % 0-100) a un canvas de vídeo.
    const region = document.createElement('canvas');
    region.width = vw;
    region.height = vh;
    const rctx = region.getContext('2d');
    if (!rctx) return false;
    rctx.fillStyle = '#fff';
    for (const anchors of closed) {
      const d = new Path2D();
      const sx = (v: number) => (v / 100) * vw;
      const sy = (v: number) => (v / 100) * vh;
      d.moveTo(sx(anchors[0].x), sy(anchors[0].y));
      const n = anchors.length;
      for (let i = 0; i < n; i++) {
        const a = anchors[i];
        const b = anchors[(i + 1) % n];
        d.bezierCurveTo(sx(a.hOutX), sy(a.hOutY), sx(b.hInX), sy(b.hInY), sx(b.x), sy(b.y));
      }
      d.closePath();
      rctx.fill(d);
    }
    const regionUrl = region.toDataURL('image/png');

    const tNow = es.timeline?.currentTime ?? 0;
    const maskUrl = effectiveSelectionMaskUrl(cur, tNow);
    if (!maskUrl) {
      // Sin máscara previa: sólo tiene sentido añadir (crear). Restar no aplica.
      if (mode === 'subtract') {
        toast({ title: 'Trazo (máscara)', description: 'No hay máscara que extraer; segmenta primero con SAM2.', variant: 'destructive' });
        return false;
      }
      const box = pathsBBox(closed);
      const shape: SelectionShape = {
        type: 'freehand',
        ...box,
        paths: [],
        // Un único frame en t=0 → la máscara estática vale para todo el vídeo.
        motionMasks: [{ time: 0, url: regionUrl }],
      };
      updateSelection({ enabled: true, shape });
      snapshotHistory();
      return true;
    }
    let img: HTMLImageElement;
    try {
      img = await loadMaskImage(maskUrl);
    } catch {
      toast({ title: 'Trazo (máscara)', description: 'No se pudo cargar la máscara de este fotograma.', variant: 'destructive' });
      return false;
    }
    const mc = document.createElement('canvas');
    mc.width = img.naturalWidth;
    mc.height = img.naturalHeight;
    const mctx = mc.getContext('2d');
    if (!mctx) return false;
    mctx.drawImage(img, 0, 0);
    mctx.save();
    mctx.globalCompositeOperation = mode === 'subtract' ? 'destination-out' : 'source-over';
    mctx.drawImage(region, 0, 0, mc.width, mc.height);
    mctx.restore();
    onMaskEditCommit(maskUrl, mc);
    setMaskEditVersion((v) => v + 1);
    return true;
  };

  // Vuelca TODOS los retoques pendientes al disco (al confirmar). Llamado por
  // "Listo" y por "Guardar proyecto".
  const flushPendingMaskEdits = useCallback(async () => {
    const map = pendingMaskCanvasesRef.current;
    if (!map.size) return;
    const entries = Array.from(map.entries());
    map.clear();
    await Promise.all(entries.map(async ([url, canvas]) => {
      const osPath = urlToOsPath(url);
      if (!osPath) { clearMaskOverride(url); return; }
      try {
        const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));
        const ab = await blob.arrayBuffer();
        await writeFile(osPath, new Uint8Array(ab));
      } catch (e) {
        console.error('Error al volcar la máscara editada al disco', e);
      } finally {
        // Sea o no escrita, limpiamos el override: si se escribió, el disco manda;
        // si falló, volvemos al original (no dejamos un override huérfano).
        clearMaskOverride(url);
        evictMaskImage(url);
      }
    }));
    setMaskEditVersion((v) => v + 1);
  }, []);

  // Descarta los retoques pendientes SIN escribir a disco (vuelve al original).
  const discardPendingMaskEdits = useCallback(() => {
    pendingMaskCanvasesRef.current.clear();
    clearAllMaskOverrides();
  }, []);

  // Al desmontar el editor (cerrar/navegar sin confirmar), descarta los retoques en
  // memoria: el disco queda con las máscaras originales.
  useEffect(() => () => { discardPendingMaskEdits(); }, [discardPendingMaskEdits]);

  const loadSam2WorkflowFromPathRef = useRef(loadSam2WorkflowFromPath);
  loadSam2WorkflowFromPathRef.current = loadSam2WorkflowFromPath;

  // Decodifica un vídeo de máscaras (ruta OS local o media://) a PNGs por frame
  // (luminancia→alfa, RGB=blanco) guardados en la carpeta de vídeos. Devuelve la
  // lista de { time, url(media://) }. El vídeo de máscaras cubre el archivo fuente
  // COMPLETO (VHS_LoadVideo carga todo el fichero); muestreamos sólo el tramo del
  // clip: desde `sourceStartTime` (segundos reales del source al inicio del clip)
  // durante `fileSecondsToTrack` segundos, a 30 fps, y mapeamos frame-f → timeline
  // `clipStart + f/(30*rate)` (clamp al rango del clip). Así el lazo puede estar en
  // cualquier frame (con frame_index del prompt acorde) y el mapeo sigue siendo
  // correcto para el caso de clip=vídeo entero.
  const decodeMaskVideoToPngs = async (
    maskVideoPath: string,
    clipStart: number,
    sourceStartTime: number,
    fileSecondsToTrack: number,
    rate: number,
    clipDur: number,
    onProgress?: (p: number) => void,
  ): Promise<{ time: number; url: string }[]> => {
    const src = maskVideoPath.startsWith('media://') || maskVideoPath.startsWith('http')
      ? maskVideoPath
      : (isElectron() && window.electronAPI?.getMediaUrl ? window.electronAPI.getMediaUrl(maskVideoPath) : maskVideoPath);
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.src = src;
    await new Promise<void>((res, rej) => { video.onload = () => res(); video.onloadeddata = () => res(); video.onerror = () => rej(new Error('No se pudo cargar el vídeo de máscaras.')); });
    const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (dur <= 0) throw new Error('El vídeo de máscaras no tiene duración.');
    const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
    const canvas = document.createElement('canvas');
    canvas.width = vw; canvas.height = vh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const paths = await getLocalPaths();
    // Máscaras SAM2: carpeta específica si está configurada; si no, a la de vídeos
    // (comportamiento anterior) para no romper nada.
    const vroot = paths?.mascaras || paths?.video || paths?.proyectos_video || paths?.proyectos || '';
    if (!vroot) throw new Error('No se encontró la carpeta de vídeos ni de máscaras. Configúrala en la pestaña Archivo.');
    await ensureDir(vroot);
    const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const maskFps = 30; // muestreo del vídeo de máscaras a 30fps (por seek real, no por índice)
    // Sólo el tramo del clip: desde sourceStartTime durante fileSecondsToTrack segundos.
    const total = Math.max(1, Math.floor(fileSecondsToTrack * maskFps));
    const frameDurationSec = 1 / (maskFps * rate);
    const endTimeAbs = clipStart + clipDur;
    const out: { time: number; url: string }[] = [];
    for (let f = 0; f < total; f++) {
      const tMask = Math.min(sourceStartTime + f / maskFps, Math.max(0, dur - 0.001));
      await new Promise<void>((res) => { const on = () => { video.removeEventListener('seeked', on); res(); }; video.addEventListener('seeked', on); video.currentTime = tMask; });
      ctx.clearRect(0, 0, vw, vh);
      ctx.drawImage(video, 0, 0, vw, vh);
      // Luminancia → alfa (las máscaras SAM2 son blanco=sí objeto, negro=fondo). RGB=blanco.
      const img = ctx.getImageData(0, 0, vw, vh);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = lum;
      }
      ctx.putImageData(img, 0, 0);
      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));
      const ab = await blob.arrayBuffer();
      const fname = `sam2mask_${sessionId}_${String(f).padStart(5, '0')}.png`;
      const fpath = `${vroot}\\${fname}`;
      await writeFile(fpath, new Uint8Array(ab));
      const time = Math.max(clipStart, Math.min(endTimeAbs, clipStart + f * frameDurationSec));
      const murl = isElectron() && window.electronAPI?.getMediaUrl ? window.electronAPI.getMediaUrl(fpath) : fpath;
      out.push({ time, url: murl });
      if (onProgress && (f % 5 === 0)) onProgress(f / total);
    }
    return out;
  };

  // FUSIÓN de máscaras para la SEGUNDA PASADA aditiva de SAM2: une (OR píxel a
  // píxel) cada máscara nueva con la existente del frame más cercano en tiempo y
  // guarda el PNG combinado a disco. Sirve para tapar los frames donde la primera
  // pasada dejó partes del objeto sin marcar: se dibuja el lazo en el frame que
  // falla y se vuelve a pulsar Segmentar con el modo "añadir" activo. Las máscaras
  // sin contrapartida en la otra pasada se conservan tal cual. Respeta los
  // overrides de retoque en memoria (loadMaskImage devuelve la versión retocada).
  const mergeMaskFrameLists = async (
    existing: { time: number; url: string }[],
    fresh: { time: number; url: string }[],
    frameDurationSec: number,
    onProgress?: (p: number) => void,
    // Rango temporal opcional (tiempo del timeline): si se pasa, SOLO se fusionan
    // los frames dentro de [center - sec, center + sec]. Los frames nuevos fuera
    // del rango se ignoran y las máscaras existentes de esa zona quedan intactas.
    range?: { center: number; sec: number } | null,
  ): Promise<{ time: number; url: string }[]> => {
    const paths = await getLocalPaths();
    // Misma carpeta que decodeMaskVideoToPngs: máscaras propia si está configurada.
    const vroot = paths?.mascaras || paths?.video || paths?.proyectos_video || paths?.proyectos || '';
    if (!vroot) throw new Error('No se encontró la carpeta de vídeos ni de máscaras.');
    await ensureDir(vroot);
    const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // Tolerancia de emparejamiento: medio frame de vídeo (las dos pasadas generan
    // la misma cuadrícula de tiempos si el clip no cambió).
    const tol = Math.max(frameDurationSec / 2, 0.002);
    const inRange = (t: number) => !range || Math.abs(t - range.center) <= range.sec;
    const used = new Set<number>();
    const out: { time: number; url: string }[] = [];

    // Unión de dos máscaras: alfa = max(alfaA, alfaB), RGB se mantiene blanco
    // (convención SAM2: blanco = objeto). Tamaño del mayor de los dos PNGs.
    const unionTwo = async (aUrl: string, bUrl: string, idx: number): Promise<string> => {
      const [ia, ib] = await Promise.all([loadMaskImage(aUrl), loadMaskImage(bUrl)]);
      const w = Math.max(ia.naturalWidth, ib.naturalWidth);
      const h = Math.max(ia.naturalHeight, ib.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(ia, 0, 0);
      const da = ctx.getImageData(0, 0, w, h).data;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(ib, 0, 0);
      const db = ctx.getImageData(0, 0, w, h).data;
      const outData = new ImageData(w, h);
      const od = outData.data;
      for (let i = 0; i < od.length; i += 4) {
        od[i] = 255; od[i + 1] = 255; od[i + 2] = 255;
        od[i + 3] = Math.max(da[i + 3], db[i + 3]);
      }
      ctx.clearRect(0, 0, w, h);
      ctx.putImageData(outData, 0, 0);
      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));
      const ab = await blob.arrayBuffer();
      const fname = `sam2mask_merge_${sessionId}_${String(idx).padStart(5, '0')}.png`;
      const fpath = `${vroot}\\${fname}`;
      await writeFile(fpath, new Uint8Array(ab));
      return isElectron() && window.electronAPI?.getMediaUrl ? window.electronAPI.getMediaUrl(fpath) : fpath;
    };

    for (let i = 0; i < fresh.length; i++) {
      const f = fresh[i];
      // Fuera del rango configurado: esta pasada no toca esa zona del vídeo.
      if (!inRange(f.time)) continue;
      // Existente con el tiempo más cercano (lista corta: búsqueda lineal).
      let bestIdx = -1, bestD = Infinity;
      for (let j = 0; j < existing.length; j++) {
        if (used.has(j)) continue;
        const d = Math.abs(existing[j].time - f.time);
        if (d < bestD) { bestD = d; bestIdx = j; }
      }
      if (bestIdx >= 0 && bestD <= tol) {
        used.add(bestIdx);
        const mergedUrl = await unionTwo(existing[bestIdx].url, f.url, out.length);
        // La URL existente ya no se referencia (el shape apuntará a la fusionada):
        // evicta caché y overrides huérfanos para que no acumulen memoria.
        evictMaskImage(existing[bestIdx].url);
        clearMaskOverride(existing[bestIdx].url);
        out.push({ time: f.time, url: mergedUrl });
      } else {
        // Sin contrapartida cercana: se queda la máscara nueva tal cual.
        out.push(f);
      }
      if (onProgress && (i % 5 === 0)) onProgress(i / fresh.length);
    }
    // Máscaras existentes sin contrapartida nueva: se conservan.
    for (let j = 0; j < existing.length; j++) {
      if (!used.has(j)) out.push(existing[j]);
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  };

  const loadLtxWorkflowFromPath = useCallback(async (path: string) => {
    if (!path) return;
    try {
      const txt = await readFile(path);
      if (!txt) { return; }
      const parsed = JSON.parse(txt);
      setLtxWorkflowJson(parsed);
      setLtxWorkflowName(path.replace(/\\/g, '/').split('/').pop() || path);
      setLtxError(null);
    } catch (e: any) {
      setLtxWorkflowJson(null);
      setLtxWorkflowName('');
      setLtxError('No se pudo leer el workflow guardado: ' + (e?.message || ''));
    }
  }, []);

  useEffect(() => {
    if (!isElectron()) return;
    const check = async () => {
      try {
        const s = await getServerStatus();
        setLtxServerStatus({ comfyui: s.comfyui.running, fluxBridge: s.fluxBridge.running });
      } catch { /* noop */ }
    };
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  // Auto-cargar el último workflow usado desde disco al montar
  useEffect(() => {
    if (ltxWorkflowPath) loadLtxWorkflowFromPath(ltxWorkflowPath);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-cargar el último workflow SAM2 usado desde disco al montar
  useEffect(() => {
    if (sam2WorkflowPath) loadSam2WorkflowFromPathRef.current(sam2WorkflowPath);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      localStorage.setItem(LTX_SETTINGS_KEY, JSON.stringify({
        promptNode: ltxPromptNode, negativeNode: ltxNegativeNode, seedNode: ltxSeedNode,
        imageNode: ltxImageNode, durationNode: ltxDurationNode, fpsNode: ltxFpsNode,
        durationValue: ltxDuration, workflowPath: ltxWorkflowPath, comfyUrl: ltxComfyUrl,
        widthNode: ltxWidthNode, heightNode: ltxHeightNode, widthValue: ltxWidth, heightValue: ltxHeight,
        mode: ltxMode, t2vSwitchNode: ltxT2vSwitchNode,
      }));
    } catch { /* noop */ }
  }, [ltxPromptNode, ltxNegativeNode, ltxSeedNode, ltxImageNode, ltxDurationNode, ltxFpsNode, ltxDuration, ltxWorkflowPath, ltxComfyUrl, ltxWidthNode, ltxHeightNode, ltxWidth, ltxHeight, ltxMode, ltxT2vSwitchNode]);

  useEffect(() => () => { if (ltxImagePreviewUrl) URL.revokeObjectURL(ltxImagePreviewUrl); }, [ltxImagePreviewUrl]);

  // --- HTML a MP4 (render de animaciones HTML en ventana oculta de Electron) ---
  const [htmlSrcFile, setHtmlSrcFile] = useState<File | null>(null);
  const [htmlDuration, setHtmlDuration] = useState<number>(6);
  const [htmlSpeed, setHtmlSpeed] = useState<number>(1);
  const [htmlFps, setHtmlFps] = useState<number>(30);
  const [htmlResolution, setHtmlResolution] = useState<'1920x1080' | '1280x720' | '1080x1920' | '1080x1080'>('1920x1080');
  const [htmlBusy, setHtmlBusy] = useState(false);
  const [htmlProgress, setHtmlProgress] = useState<number>(0);
  const [htmlError, setHtmlError] = useState<string | null>(null);
  const [htmlFileName, setHtmlFileName] = useState<string>('');
  // Web → MP4: capturar una URL web a MP4 (reutiliza el pipeline de htmlToMp4 con url).
  const [webUrl, setWebUrl] = useState<string>('');
  const [webFileName, setWebFileName] = useState<string>('');
  // WebM → MP4: transcodear un archivo de vídeo (WebM/MP4/MOV…) a MP4 vía ffmpeg.
  const [webSrcFile, setWebSrcFile] = useState<File | null>(null);
  const [webmFileName, setWebmFileName] = useState<string>('');
  // Modo de la pestaña HTML → MP4: 'file' = HTML/ZIP local, 'url' = URL web, 'webm' = archivo de vídeo a MP4.
  const [htmlMode, setHtmlMode] = useState<'file' | 'url' | 'webm'>('file');

  if (!mounted) return <div className="h-full w-full bg-gray-950 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-blue-500" /></div>;

  const loadProjectFromFile = async (file: File) => {
    try {
      fileCache.current.clear();
      let projectData: any;
      const assetUrls = new Map<string, string>();

      // Detectar si es un ZIP (nuevo formato) o JSON (formato antiguo)
      const buffer = await file.arrayBuffer();
      const signature = new Uint8Array(buffer.slice(0, 4));
      const isZip = signature[0] === 0x50 && signature[1] === 0x4B && signature[2] === 0x03 && signature[3] === 0x04;

      if (isZip) {
        console.log('Detectado paquete .Zeus comprimido. Extrayendo activos...');
        const zip = await JSZip.loadAsync(buffer);

        // Cargar el JSON del proyecto
        const jsonFile = zip.file('project.json');
        if (!jsonFile) throw new Error('Archivo project.json no encontrado en el paquete');
        projectData = JSON.parse(await jsonFile.async('text'));

        // Extraer y mapear activos
        const files = Object.keys(zip.files).filter(path => path.startsWith('assets/') && !zip.files[path].dir);
        await Promise.all(files.map(async (path) => {
          const zipFile = zip.file(path);
          if (zipFile) {
            const blob = await zipFile.async('blob');
            const fileName = path.replace('assets/', '');
            const url = URL.createObjectURL(blob);
            assetUrls.set(fileName, url);
            const fileObject = new File([blob], fileName, { type: blob.type || '' });
            fileCache.current.set(url, fileObject);
          }
        }));
      } else {
        console.log('Detectado archivo JSON plano. Cargando modo compatibilidad...');
        const text = new TextDecoder().decode(buffer);
        projectData = JSON.parse(text);
      }

      // Validar que sea un proyecto válido
      if (projectData.version && projectData.editState) {
        const loadedEditState = projectData.editState;

        // Mapear URLs del proyecto a los nuevos Blobs extraídos del ZIP
        const remapUrl = (oldUrl: string) => {
          if (!oldUrl || String(oldUrl).startsWith('data:')) return oldUrl;
          const fileName = String(oldUrl).split(/[/\\]/).pop() || '';
          for (const [name, blobUrl] of assetUrls.entries()) {
            if (name === fileName || name.endsWith('_' + fileName)) return blobUrl;
          }
          return oldUrl;
        };

        if (projectData.videoUrl) projectData.videoUrl = remapUrl(projectData.videoUrl);

        // Crear las pistas por defecto
        const defaultTracks: TimelineTrack[] = [
          { id: 'video-1', type: 'video' as TrackType, name: 'Vídeo Principal', clips: [], isLocked: false },
          { id: 'audio-1', type: 'audio' as TrackType, name: 'Audio Principal', clips: [], isMuted: false, isLocked: false, volume: 1 },
          { id: 'text-1', type: 'text' as TrackType, name: 'Texto/Superposiciones', clips: [], isLocked: false }
        ];

        let finalTracks: TimelineTrack[] = defaultTracks;
        if (loadedEditState.timeline?.tracks) {
          const savedTracks = loadedEditState.timeline.tracks;
          finalTracks = defaultTracks.map(defaultTrack => {
            const savedTrack = savedTracks.find((st: TimelineTrack) => st.id === defaultTrack.id);
            if (savedTrack) {
              savedTrack.clips.forEach((clip: any) => {
                if (clip.mediaFileId) clip.mediaFileId = remapUrl(clip.mediaFileId);
                if (clip.thumbnailUrl) clip.thumbnailUrl = remapUrl(clip.thumbnailUrl);
              });
              return savedTrack;
            }
            return defaultTrack;
          });
          const additionalTracks = savedTracks.filter((st: TimelineTrack) => !defaultTracks.some(dt => dt.id === st.id));
          additionalTracks.forEach((track: any) => {
            track.clips.forEach((clip: any) => {
              if (clip.mediaFileId) clip.mediaFileId = remapUrl(clip.mediaFileId);
            });
          });
          finalTracks = [...finalTracks, ...additionalTracks];
        }
        finalTracks = placeEffectsTrackBelowMainVideo(finalTracks);

        const finalEditState = {
          ...loadedEditState,
          objectClips: (loadedEditState.objectClips || []).map((oc: any) => ({ ...oc, src: remapUrl(oc.src) })),
          videoOverlay: loadedEditState.videoOverlay
            ? { ...loadedEditState.videoOverlay, src: remapUrl(loadedEditState.videoOverlay.src) }
            : null,
          timeline: loadedEditState.timeline ? { ...loadedEditState.timeline, tracks: finalTracks } : { duration: 60, currentTime: 0, zoom: 100, tracks: finalTracks }
        };

        setEditState(finalEditState);
        if (projectData.guion_ia) setLocalScriptContent(projectData.guion_ia);
        if (projectData.presentationSlides?.length > 0) {
          setSlides(projectData.presentationSlides.map((s: any) => ({ ...s, imageDataUrl: remapUrl(s.imageDataUrl) })));
          if (Array.isArray(projectData.presentationTransitionsByGap)) setPresentationTransitionsByGap(projectData.presentationTransitionsByGap);
          if (typeof projectData.presentationSlideIntervalSec === 'number') setPresentationSlideIntervalSec(projectData.presentationSlideIntervalSec);
        }
        if (projectData.conversacion?.messages?.length > 0) {
          setMessages(projectData.conversacion.messages);
          setConversationId(projectData.conversacion.conversationId || null);
        } else {
          setMessages([]);
          setConversationId(null);
        }
        if (Array.isArray(projectData.customEffects)) loadCustomEffectsFromProjectData(projectData.customEffects);
        if (Array.isArray(projectData.customOverlayObjects)) loadOverlayObjectsFromProjectData(projectData.customOverlayObjects);
        if (Array.isArray(projectData.savedTextPresets)) persistSavedTextPresets(projectData.savedTextPresets);
        if (Array.isArray(projectData.vertexInstants)) {
          setVertexInstants(projectData.vertexInstants);
          if (typeof window !== 'undefined') localStorage.setItem('zeus-vertex-instants', JSON.stringify(projectData.vertexInstants));
          vertexInstantsLoadedFromProject.current = true;
        } else {
          // El proyecto no tiene instantes: limpiar localStorage para no mezclar con proyectos anteriores
          if (typeof window !== 'undefined') localStorage.removeItem('zeus-vertex-instants');
          setVertexInstants([]);
          vertexInstantsLoadedFromProject.current = true;
        }

        if (onLoadProject) onLoadProject(projectData);
        toast({ title: 'Proyecto cargado', description: `Se ha cargado el proyecto con ${assetUrls.size} archivos multimedia.`, variant: 'default' });
      }
    } catch (error) {
      console.error('Error al cargar el proyecto:', error);
      toast({ title: 'Error', description: 'No se pudo cargar el archivo .Zeus', variant: 'destructive' });
    }
  };

  const handleLoadProject = () => {
    setIsLoadModalOpen(true);
    fetchLocalProjects();
  };

  const fetchProjectsForSave = async () => {
    setIsLoadingProjects(true);
    try {
      // La colección 'proyectos' de PocketBase ya no se usa.
      // Solo cargamos proyectos locales.
      setSavedProjects([]);
    } catch (error) {
      console.error('Error al cargar proyectos:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const saveProjectToPocketBase = async (title: string, existingRecordId?: string) => {
    if (!title.trim()) {
      alert('Por favor, ingresa un título para el proyecto');
      return;
    }

    setIsSavingProject(true);
    console.log('🚀 Iniciando empaquetado total del proyecto...');

    try {
      const formData = new FormData();
      formData.append('titulo', title);
      formData.append('tipo', 'edit_video');
      if (localScriptContent != null && localScriptContent.trim() !== '') {
        formData.append('guion_ia', localScriptContent.trim());
      }

      // 1. Identificar todos los activos del proyecto
      const assetMap = new Map<string, File>();
      const isUrlFromThisRecord = (url: string) => existingRecordId && url && typeof url === 'string' && url.includes('/api/files/') && url.includes(existingRecordId);

      const createFileFromBlob = (blob: Blob, hint: string) => {
        const mimeMap: Record<string, string> = {
          'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
          'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
          'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp'
        };
        const extension = mimeMap[blob.type] || blob.type.split('/')[1] || 'bin';
        const file = new File([blob], `project_asset_${hint}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}.${extension}`, { type: blob.type });
        return file;
      };

      let generatedAssetCounter = 0;

      const processAsset = async (url: string) => {
        if (!url || url.includes('placeholder') || assetMap.has(url)) return;
        if (isUrlFromThisRecord(url)) {
          console.log(`⏭️ Omitiendo re-subida (ya en el proyecto): ${url}`);
          return;
        }
        const generatedAsset = generatedAssetsRef.current.get(url);
        if (generatedAsset) {
          const file = buildGeneratedAssetFile(generatedAsset);
          assetMap.set(url, file);
          console.log(`✅ Activo generado empaquetado: ${file.name}`);
          return;
        }
        try {
          console.log(`🔍 Analizando activo: ${url}`);
          // Intentamos descargar el archivo (sea blob o URL remota)
          const response = await fetch(url);
          if (!response.ok) throw new Error('No se pudo acceder al archivo');

          const blob = await response.blob();

          // Mapeo de extensiones comunes
          const mimeMap: Record<string, string> = {
            'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
            'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
            'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp'
          };

          const extension = mimeMap[blob.type] || blob.type.split('/')[1] || 'bin';
          const filename = `project_asset_${Date.now()}_${Math.random().toString(36).substr(2, 4)}.${extension}`;

          const file = new File([blob], filename, { type: blob.type });
          assetMap.set(url, file);
          console.log(`✅ Activo preparado para empaquetar: ${filename} (${blob.type})`);
        } catch (e) {
          console.warn(`⚠️ No se pudo empaquetar el activo ${url} (probablemente externo o CORS):`, e);
        }
      };

      // Duración del video principal (del clip en la pista de video)
      const videoTrack = editState.timeline?.tracks.find((t: any) => t.type === 'video');
      const mainVideoClip = videoTrack?.clips.find((c: any) => c.mediaFileId === videoUrl);
      const videoDuration = mainVideoClip?.duration ?? (editState.trimEnd ?? 0);
      const trimStart = editState.trimStart ?? 0;
      const trimEndVal = editState.trimEnd ?? videoDuration;
      const hasTrim = trimStart > 0.05 || (videoDuration - trimEndVal) > 0.05;
      let savedAsTrimmed = false;
      let trimmedDuration = trimEndVal - trimStart;

      // Recolectar video: si hay recorte, guardar solo el fragmento; si no, el video completo
      // Al actualizar un proyecto existente, no re-subir el vídeo que ya está en el registro (evita duplicados)
      if (existingRecordId && isUrlFromThisRecord(videoUrl)) {
        console.log('⏭️ Vídeo principal ya en el proyecto; no se re-sube.');
      } else if (hasTrim) {
        try {
          console.log('✂️ Recortando video al fragmento del editor antes de guardar...');
          const blob = await getTrimmedVideoBlob(videoUrl, trimStart, trimEndVal);
          const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
          const file = new File([blob], `project_video_trimmed_${Date.now()}.${ext}`, { type: blob.type });
          assetMap.set(videoUrl, file);
          savedAsTrimmed = true;
          console.log(`✅ Fragmento recortado listo (${trimmedDuration.toFixed(1)}s)`);
        } catch (e) {
          console.warn('⚠️ No se pudo generar el fragmento, se guardará el video completo:', e);
          await processAsset(videoUrl);
        }
      } else {
        await processAsset(videoUrl);
      }

      if (editState.timeline) {
        for (const track of editState.timeline.tracks) {
          for (const clip of track.clips) {
            if (clip.mediaFileId === videoUrl) continue; // ya procesado arriba
            if (clip.mediaFileId) await processAsset(clip.mediaFileId);
            // No subir miniaturas como file_imagen: son solo para vista previa en el timeline y crean archivos innecesarios
          }
        }
      }

      console.log(`📊 Total de archivos a subir: ${assetMap.size}`);

      // 2. Añadir al FormData categorizado (no se suben imágenes a file_imagen para evitar capturas/miniaturas innecesarias)
      assetMap.forEach((file) => {
        if (file.type.startsWith('video/')) formData.append('file_video', file);
        else if (file.type.startsWith('audio/')) formData.append('file_audio', file);
        else if (file.type.startsWith('image/')) { /* no subir a file_imagen */ }
        else formData.append('file_documento', file);
      });

      // 3. Crear o actualizar registro
      formData.append('file', JSON.stringify({ version: '1.0', status: 'uploading' }));

      let record: { id: string;[k: string]: any };
      if (existingRecordId) {
        console.log('📤 Actualizando proyecto existente en PocketBase...');
        formData.append('titulo', title);
        record = await pb.collection('proyectos').update(existingRecordId, formData) as any;
        console.log('✅ Registro actualizado:', record.id);
      } else {
        console.log('📤 Subiendo paquete de proyecto nuevo a PocketBase...');
        record = await pb.collection('proyectos').create(formData);
        console.log('✅ Registro creado:', record.id);
      }

      // 4. Mapear URLs finales de PocketBase
      const urlMapping = new Map<string, string>();
      const getFieldFiles = (field: any) => Array.isArray(field) ? field : (field ? [field] : []);

      const allUploaded = [
        ...getFieldFiles(record.file_video),
        ...getFieldFiles(record.file_audio),
        ...getFieldFiles(record.file_imagen),
        ...getFieldFiles(record.file_documento)
      ];

      // Vincular URLs originales con las nuevas en PocketBase
      assetMap.forEach((file, originalUrl) => {
        // Buscamos el nombre que PB le puso al archivo (que suele contener parte de nuestro nombre aleatorio)
        const pbName = allUploaded.find(name => name.includes(file.name.split('.')[0]));
        if (pbName) {
          const newUrl = pb.files.getURL(record, pbName);
          urlMapping.set(originalUrl, newUrl);
          console.log(`🔗 Re-vinculado: ${originalUrl} -> ${newUrl}`);
        }
      });

      // 5. Generar JSON final con las nuevas rutas internas
      const finalEditState = JSON.parse(JSON.stringify(editState));
      if (finalEditState.timeline) {
        console.log('🔒 About to save project - current track states:');
        finalEditState.timeline.tracks.forEach((track: any) => {
          console.log(`🔒 Track ${track.id} isLocked: ${track.isLocked}`);
        });

        finalEditState.timeline.tracks.forEach((track: any) => {
          track.clips.forEach((clip: any) => {
            if (clip.mediaFileId && urlMapping.has(clip.mediaFileId)) {
              clip.mediaFileId = urlMapping.get(clip.mediaFileId);
            }
            if (clip.thumbnailUrl && urlMapping.has(clip.thumbnailUrl)) {
              clip.thumbnailUrl = urlMapping.get(clip.thumbnailUrl);
            }
            // No guardar miniaturas en data URL en el proyecto (ocupan mucho y no se usan en PB)
            if (clip.thumbnailUrl && typeof clip.thumbnailUrl === 'string' && clip.thumbnailUrl.startsWith('data:')) {
              delete clip.thumbnailUrl;
            }
          });
        });

        // Si guardamos solo el fragmento recortado, normalizar editState para que al reabrir el proyecto el video sea el recorte (trim 0..trimmedDuration)
        if (savedAsTrimmed && trimmedDuration > 0) {
          finalEditState.trimStart = 0;
          finalEditState.trimEnd = trimmedDuration;
          finalEditState.timeline.duration = Math.max(finalEditState.timeline.duration || 0, trimmedDuration);
          finalEditState.timeline.tracks.forEach((track: any) => {
            if (track.type === 'video') {
              track.clips.forEach((clip: any) => {
                const mappedUrl = urlMapping.get(videoUrl);
                if (clip.mediaFileId === mappedUrl || clip.mediaFileId === videoUrl) {
                  clip.duration = trimmedDuration;
                  // El archivo guardado es el fragmento recortado y empieza en 0: resetear
                  // el offset de origen (relevante si el clip se dividió con "Dividir" y
                  // arrastraba un sourceStartTime != 0). Si no, al reabrir el proyecto el
                  // vídeo hace seek al offset viejo dentro del fragmento y arranca por el medio.
                  clip.sourceStartTime = 0;
                  clip.sourceDuration = trimmedDuration;
                }
              });
            }
          });
        }
      }

      const finalProjectData = {
        version: '1.0',
        videoUrl: urlMapping.get(videoUrl) || videoUrl,
        editState: finalEditState,
        guion_ia: localScriptContent ?? '',
        ...(slides.length > 0 && {
          presentationSlides: slides.map(s => ({ id: s.id, title: s.title ?? '', description: s.description ?? '', imageDataUrl: s.imageDataUrl, overlayEffectId: s.overlayEffectId ?? null })),
          presentationTransitionsByGap: presentationTransitionsByGap,
          presentationSlideIntervalSec: presentationSlideIntervalSec,
        }),
        ...(messages.length > 0 && {
          conversacion: { messages, conversationId },
        }),
        ...(getSerializableCustomEffects().length > 0 && {
          customEffects: getSerializableCustomEffects(),
        }),
        ...(getSerializableOverlayObjects().length > 0 && {
          customOverlayObjects: getSerializableOverlayObjects(),
        }),
        ...(savedTextPresets.length > 0 && {
          savedTextPresets,
        }),
        timestamp: new Date().toISOString(),
        isAutonomous: true
      };

      await pb.collection('proyectos').update(record.id, {
        file: finalProjectData,
        ...(localScriptContent != null && localScriptContent.trim() !== '' && { guion_ia: localScriptContent.trim() })
      });

      setIsSaveModalOpen(false);
      setShowSavedMessage(true);
      setTimeout(() => setShowSavedMessage(false), 3000);
      alert(existingRecordId
        ? `¡Proyecto actualizado! Se ha guardado el paquete con ${assetMap.size} archivos.`
        : `¡Proyecto Guardado! Se ha creado un paquete autónomo con ${assetMap.size} archivos.`);
    } catch (error) {
      console.error('❌ Error crítico al empaquetar:', error);
      alert('Error al crear el paquete del proyecto. Verifica el tamaño de los archivos.');
    } finally {
      setIsSavingProject(false);
    }
  };

  const fetchProjectsFromPocketBase = async () => {
    setIsLoadingProjects(true);
    try {
      const records = await pb.collection('proyectos').getFullList({
        filter: 'tipo = "edit_video"',
        sort: '-created'
      });
      setSavedProjects(records);
      setIsLoadModalOpen(true);
    } catch (error) {
      console.error('Error al cargar proyectos:', error);
      alert('Error al obtener la lista de proyectos');
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const getProjectJsonData = () => ({
    version: '1.0',
    videoUrl,
    editState,
    guion_ia: localScriptContent ?? '',
    ...(slides.length > 0 && {
      presentationSlides: slides.map(s => ({ id: s.id, title: s.title ?? '', description: s.description ?? '', imageDataUrl: s.imageDataUrl, overlayEffectId: s.overlayEffectId ?? null })),
      presentationTransitionsByGap,
      presentationSlideIntervalSec,
    }),
    ...(messages.length > 0 && {
      conversacion: { messages, conversationId },
    }),
    ...(getSerializableCustomEffects().length > 0 && {
      customEffects: getSerializableCustomEffects(),
    }),
    ...(getSerializableOverlayObjects().length > 0 && {
      customOverlayObjects: getSerializableOverlayObjects(),
    }),
    ...(savedTextPresets.length > 0 && {
      savedTextPresets,
    }),
    ...(vertexInstants.length > 0 && {
      vertexInstants,
    }),
    timestamp: new Date().toISOString(),
    isAutonomous: true
  });

  const downloadProjectAsZeus = (projectTitle: string) => {
    const data = getProjectJsonData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const name = (projectTitle.trim() || 'proyecto-video').replace(/[^a-zA-Z0-9._\s-]/g, '_') + '.Zeus';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const saveProjectToFile = async () => {
    const data = getProjectJsonData();
    const json = JSON.stringify(data, null, 2);
    try {
      if ('showSaveFilePicker' in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: 'proyecto-video.Zeus',
          types: [{ description: 'Proyecto Zeus', accept: { 'application/json': ['.Zeus', '.zeus', '.json'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        alert('Proyecto guardado correctamente en el archivo.');
      } else {
        downloadProjectAsZeus('proyecto-video');
      }
    } catch (e) {
      if ((e as any)?.name === 'AbortError') return;
      console.error(e);
      downloadProjectAsZeus('proyecto-video');
    }
  };

  const updateProjectFile = async () => {
    const data = getProjectJsonData();
    const json = JSON.stringify(data, null, 2);
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: 'Proyecto Zeus', accept: { 'application/json': ['.Zeus', '.zeus', '.json'] } }],
          mode: 'readwrite',
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        alert('Proyecto actualizado correctamente en el archivo.');
      } else {
        alert('Tu navegador no soporta selección de archivos para actualizar. Usa "Descargar .Zeus" y guarda manualmente.');
      }
    } catch (e) {
      if ((e as any)?.name === 'AbortError') return;
      console.error(e);
      alert('No se pudo actualizar el archivo.');
    }
  };

  const saveFullProjectLocal = async (projectName: string, manualFiles: File[]) => {
    setIsSavingProject(true);
    try {
      // Al guardar el proyecto, vuelca los retoques de máscara pendientes al disco
      // (si no, el .zeus referenciaría máscaras originales y se perdería el retoque).
      await flushPendingMaskEdits();
      const paths = await getLocalPaths();
      // Los proyectos .zeus van a la carpeta de PROYECTOS (proyectos_video), no a la
      // de vídeos. Las exportaciones y los MP4 generados van a paths.video.
      const rootPath = paths?.proyectos_video || paths?.proyectos || paths?.video;

      if (!rootPath) {
        throw new Error('Configura la ruta de proyectos primero en el Dashboard.');
      }

      console.log('🚀 Guardando en ruta confirmada:', rootPath);

      const projectData = getProjectJsonData();
      const projectFolder = rootPath.replace(/\\*$/, '') + '\\' + projectName;
      await ensureDir(projectFolder);
      const assetsFolder = projectFolder + '\\assets';
      await ensureDir(assetsFolder);

      const zeusPath = projectFolder + '\\' + projectName + '.zeus';
      await saveProject(zeusPath, {
        titulo: projectName,
        tipo: 'edit_video',
        editState: projectData
      });

      // Guardar assets generados automáticamente
      const generatedAssetFiles = Array.from(generatedAssetsRef.current.values()).map(buildGeneratedAssetFile);
      for (const file of generatedAssetFiles) {
        const destPath = assetsFolder + '\\' + file.name;
        const buffer = new Uint8Array(await file.arrayBuffer());
        await writeFile(destPath, buffer);
      }

      // Guardar archivos manuales
      if (manualFiles && manualFiles.length > 0) {
        for (const file of manualFiles) {
          const sourcePath = getFilePath(file);
          const destPath = assetsFolder + '\\' + file.name;
          if (sourcePath) {
            await copyFile(sourcePath, destPath);
          } else {
            const buffer = new Uint8Array(await file.arrayBuffer());
            await writeFile(destPath, buffer);
          }
        }
      }

      const result = { path: projectFolder };

      // ── Sincronizar con Zeus API Server (localhost:3150) ──────────────────
      try {
        const projectPayload = {
          name: projectName,
          description: '',
          editState: projectData,
          videoUrl: projectData.videoUrl || '',
          guion_ia: projectData.guion_ia || '',
          localPath: result.path || '',
        };
        if (apiProjectId) {
          await api.updateProject(apiProjectId, projectPayload);
          console.log('[Zeus API] Proyecto actualizado en API server:', apiProjectId);
        } else {
          const created = await api.createProject(projectPayload);
          setApiProjectId(created.id);
          console.log('[Zeus API] Proyecto registrado en API server:', created.id);
        }
      } catch (apiErr) {
        console.warn('[Zeus API] No se pudo sincronizar con el servidor API (¿está corriendo en :3150?):', apiErr);
      }
      // ─────────────────────────────────────────────────────────────────────

      alert(`✅ PROYECTO CREADO CON ÉXITO\n\nUbicación: ${result.path}\nArchivos empaquetados: ${manualFiles.length}`);
      setIsSaveModalOpen(false);
    } catch (error) {
      console.error('Error al guardar proyecto local:', error);
      alert(error instanceof Error ? error.message : 'Error al guardar');
    } finally {
      setIsSavingProject(false);
    }
  };

  async function fetchLocalProjects() {
    setIsLoadingLocalProjects(true);
    try {
      const paths = await getLocalPaths();
      const folderPaths = [paths?.video, paths?.proyectos_video, paths?.proyectos].filter(Boolean);
      
      if (folderPaths.length === 0) {
        console.warn('No se han configurado rutas de búsqueda.');
        setLocalProjects([]);
        return;
      }

      // Eliminar duplicados
      const uniquePaths = Array.from(new Set(folderPaths));
      let allProjects: any[] = [];

      for (const p of uniquePaths) {
        try {
          const files = await listDirectory(p!, 'proyectos');
          // Evitar duplicados por ruta
          const filtered = files.filter(f => !allProjects.some(ap => ap.path === f.path));
          allProjects = [...allProjects, ...filtered];
        } catch (err) {
          console.error(`Error listando proyectos en ${p}:`, err);
        }
      }

      const projects = allProjects.filter((f: any) => f.isDirectory || f.name.endsWith('.zeus'));
      setLocalProjects(projects);
    } catch (e) {
      console.error('Error fetchLocalProjects:', e);
    } finally {
      setIsLoadingLocalProjects(false);
    }
  }

  async function loadFullProjectLocal(project: any) {
    setIsLoadingLocalProjects(true);
    // Cambio de proyecto: libera los sinks del videoCache del proyecto anterior.
    try { videoCache.clearAll(); } catch {}
    try {
      const paths = await getLocalPaths();
      const rootPath = paths?.video || paths?.proyectos_video || paths?.proyectos;

      let projectPath = project.path;
      if (project.isDirectory) {
        const files = await listDirectory(projectPath);
        const zeusFile = files.find((f: any) => f.name.endsWith('.zeus'));
        if (zeusFile) projectPath = zeusFile.path;
      }

      const data = await readProject(projectPath);
      if (!data) throw new Error('No se pudo leer el archivo de configuración .zeus');

      // Si es una presentación, cargarla como tal
      if (data.tipo === 'presentacion' || data.file?.slides) {
        loadPresentationFromRecord({ titulo: data.titulo || project.name, file: data.file || data, videoUrl: data.videoUrl });
        setIsLoadingLocalProjects(false);
        setIsLoadModalOpen(false);
        return;
      }

      const assetsFolderPath = `${projectPath}${projectPath.includes('\\') ? '\\' : '/'}assets`;
      const assetsFiles = await listDirectory(assetsFolderPath);

      let availableAssets: any[] = assetsFiles || [];
      console.log(`📂 Detectados ${availableAssets.length} archivos en la carpeta assets`);

      const findAssetByName = (originalUrlOrPath: string) => {
        if (!originalUrlOrPath || typeof originalUrlOrPath !== 'string') return null;
        const fileName = originalUrlOrPath.split(/[/\\]/).pop()?.split('?')[0];
        if (!fileName) return null;

        const found = availableAssets.find(a => a.name === fileName);
        if (found) {
          return `${getMediaUrl(found.path)}`;
        }
        return null;
      };

      // Soportar los distintos formatos de .zeus:
      //  - { editState: <estado con timeline> }                          (formato directo)
      //  - { editState: projectData } donde projectData = { editState }   (botón "Guardar proyecto" — doble anidación)
      //  - { file: <estado con timeline> }                               (exportación de vídeo)
      //  - { timeline, ... }                                             (plano)
      let loadedEditState: any = data.editState || data.file || (data.timeline ? data : null);
      // Deshacer la doble anidación: projectData (getProjectJsonData) contiene editState dentro
      if (loadedEditState && !loadedEditState.timeline && loadedEditState.editState?.timeline) {
        loadedEditState = loadedEditState.editState;
      }
      if (!loadedEditState || !loadedEditState.timeline) throw new Error('Estructura de proyecto no válida');

      // videoUrl puede estar en data (export), en projectData (Guardar proyecto) o en el propio editState
      const originalVideoUrl = data.videoUrl || loadedEditState.videoUrl || data.editState?.videoUrl || data.file?.videoUrl;
      const reconnectedVideoUrl = findAssetByName(originalVideoUrl);
      if (reconnectedVideoUrl) {
        data.videoUrl = reconnectedVideoUrl;
        console.log('✅ Vídeo principal reconectado');
      }

      if (loadedEditState.timeline?.tracks) {
        loadedEditState.timeline.tracks.forEach((track: any) => {
          track.clips.forEach((clip: any) => {
            if (clip.mediaFileId) {
              const newUrl = findAssetByName(clip.mediaFileId);
              if (newUrl) clip.mediaFileId = newUrl;
            }
            if (clip.thumbnailUrl) {
              const newThumb = findAssetByName(clip.thumbnailUrl);
              if (newThumb) clip.thumbnailUrl = newThumb;
            }
          });
        });
      }

      if (Array.isArray(loadedEditState.objectClips)) {
        loadedEditState.objectClips.forEach((oc: any) => {
          const newSrc = findAssetByName(oc.src);
          if (newSrc) oc.src = newSrc;
        });
      }

      if (Array.isArray(data.presentationSlides)) {
        data.presentationSlides.forEach((s: any) => {
          const newImg = findAssetByName(s.imageDataUrl);
          if (newImg) s.imageDataUrl = newImg;
        });
      }

      // Para el formato "Guardar proyecto", guion_ia/slides/efectos/etc. viven en projectData
      // (data.editState original = getProjectJsonData()), no en data. Los hoistamos a data
      // antes de reemplazar data.editState con el editState real, para no perderlos.
      const projectData = (data.editState && typeof data.editState === 'object' && data.editState.version) ? data.editState : null;
      if (projectData) {
        if (data.guion_ia === undefined && projectData.guion_ia !== undefined) data.guion_ia = projectData.guion_ia;
        if (!data.presentationSlides && projectData.presentationSlides) data.presentationSlides = projectData.presentationSlides;
        if (data.presentationTransitionsByGap === undefined && projectData.presentationTransitionsByGap !== undefined) data.presentationTransitionsByGap = projectData.presentationTransitionsByGap;
        if (data.presentationSlideIntervalSec === undefined && projectData.presentationSlideIntervalSec !== undefined) data.presentationSlideIntervalSec = projectData.presentationSlideIntervalSec;
        if (!data.conversacion && projectData.conversacion) data.conversacion = projectData.conversacion;
        if (!data.customEffects && projectData.customEffects) data.customEffects = projectData.customEffects;
        if (!data.customOverlayObjects && projectData.customOverlayObjects) data.customOverlayObjects = projectData.customOverlayObjects;
        if (!data.savedTextPresets && projectData.savedTextPresets) data.savedTextPresets = projectData.savedTextPresets;
        if (!data.videoUrl && projectData.videoUrl) data.videoUrl = projectData.videoUrl;
        if (Array.isArray(projectData.vertexInstants)) data.vertexInstants = projectData.vertexInstants;
      }

      data.editState = loadedEditState;

      if (onLoadProject) {
        onLoadProject(data);
      }

      setEditState(loadedEditState);
      if (data.guion_ia) setLocalScriptContent(data.guion_ia);
      if (data.presentationSlides) setSlides(data.presentationSlides);
      if (Array.isArray(data.vertexInstants)) {
        setVertexInstants(data.vertexInstants);
        if (typeof window !== 'undefined') localStorage.setItem('zeus-vertex-instants', JSON.stringify(data.vertexInstants));
        vertexInstantsLoadedFromProject.current = true;
      } else {
        if (typeof window !== 'undefined') localStorage.removeItem('zeus-vertex-instants');
        setVertexInstants([]);
        vertexInstantsLoadedFromProject.current = true;
      }

      setIsLoadModalOpen(false);
      toast({ title: 'Proyecto Reconectado', description: `Se ha cargado "${project.name}" y se han reconectado sus archivos locales.` });
    } catch (error) {
      console.error('Error en carga dual:', error);
      alert(error instanceof Error ? error.message : 'Error al cargar proyecto');
    } finally {
      setIsLoadingLocalProjects(false);
    }
  }

  const deleteProjectFromPocketBase = async (id: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar este proyecto?')) return;

    try {
      await pb.collection('proyectos').delete(id);
      setSavedProjects(prev => prev.filter(p => p.id !== id));
    } catch (error) {
      console.error('Error al eliminar proyecto:', error);
      alert('No se pudo eliminar el proyecto');
    }
  };

  const loadProjectFromRecord = (project: any) => {
    try {
      if (project.file && project.file.editState) {
        // Usar la misma lógica de mezcla que en el estado inicial
        const loadedEditState = project.file.editState;

        // Crear las pistas por defecto
        const defaultTracks: TimelineTrack[] = [
          {
            id: 'video-1',
            type: 'video' as TrackType,
            name: 'Vídeo Principal',
            clips: [],
            isLocked: false
          },
          {
            id: 'audio-1',
            type: 'audio' as TrackType,
            name: 'Audio Principal',
            clips: [],
            isMuted: false,
            isLocked: false,
            volume: 1
          },
          {
            id: 'text-1',
            type: 'text' as TrackType,
            name: 'Texto/Superposiciones',
            clips: [],
            isLocked: false
          }
        ];

        // Mezclar pistas guardadas con las por defecto
        let finalTracks: TimelineTrack[] = defaultTracks;

        if (loadedEditState.timeline?.tracks) {
          const savedTracks = loadedEditState.timeline.tracks;

          // Preservar pistas guardadas (con su estado isLocked)
          finalTracks = defaultTracks.map(defaultTrack => {
            const savedTrack = savedTracks.find((st: TimelineTrack) => st.id === defaultTrack.id);
            if (savedTrack) {
              console.log(`🔒 loadProjectFromRecord - Preservando pista ${defaultTrack.id}: isLocked=${savedTrack.isLocked}`);
              return savedTrack;
            }
            console.log(`📁 loadProjectFromRecord - Usando pista por defecto ${defaultTrack.id}: isLocked=false`);
            return defaultTrack;
          });

          // Agregar pistas adicionales
          const additionalTracks = savedTracks.filter((st: TimelineTrack) =>
            !defaultTracks.some(dt => dt.id === st.id)
          );
          finalTracks = [...finalTracks, ...additionalTracks];
        }
        finalTracks = placeEffectsTrackBelowMainVideo(finalTracks);

        // Crear el estado final con las pistas mezcladas
        const finalEditState = {
          ...loadedEditState,
          objectClips: loadedEditState.objectClips || [],
          videoOverlay: loadedEditState.videoOverlay ?? null,
          timeline: loadedEditState.timeline ? {
            ...loadedEditState.timeline,
            tracks: finalTracks
          } : {
            duration: 60,
            currentTime: 0,
            zoom: 100,
            tracks: finalTracks
          }
        };

        setEditState(finalEditState);
        const scriptFromProject = project.guion_ia ?? project.file?.guion_ia;
        if (scriptFromProject != null && String(scriptFromProject).trim() !== '') {
          setLocalScriptContent(String(scriptFromProject));
        }
        if (project.file?.presentationSlides?.length > 0) {
          setSlides(project.file.presentationSlides);
          if (Array.isArray(project.file.presentationTransitionsByGap)) {
            setPresentationTransitionsByGap(project.file.presentationTransitionsByGap);
          }
          if (typeof project.file.presentationSlideIntervalSec === 'number') {
            setPresentationSlideIntervalSec(project.file.presentationSlideIntervalSec);
          }
        }
        if (project.file?.conversacion?.messages?.length > 0) {
          const msgs = project.file.conversacion.messages.filter(
            (m: unknown) => m && typeof m === 'object' && 'role' in m && 'content' in m
          );
          setMessages(msgs);
          const id = project.file.conversacion.conversationId;
          setConversationId(typeof id === 'string' ? id : null);
        }
        if (Array.isArray(project.file?.customEffects) && project.file.customEffects.length > 0) {
          loadCustomEffectsFromProjectData(project.file.customEffects);
          setCustomEffectsVersion((v) => v + 1);
        }
        if (Array.isArray(project.file?.customOverlayObjects) && project.file.customOverlayObjects.length > 0) {
          loadOverlayObjectsFromProjectData(project.file.customOverlayObjects);
          setOverlayObjectsVersion((v) => v + 1);
        }
        if (Array.isArray(project.file?.savedTextPresets)) {
          persistSavedTextPresets(project.file.savedTextPresets);
        }
        if (Array.isArray(project.file?.vertexInstants)) {
          setVertexInstants(project.file.vertexInstants);
          if (typeof window !== 'undefined') localStorage.setItem('zeus-vertex-instants', JSON.stringify(project.file.vertexInstants));
          vertexInstantsLoadedFromProject.current = true;
        } else {
          if (typeof window !== 'undefined') localStorage.removeItem('zeus-vertex-instants');
          setVertexInstants([]);
          vertexInstantsLoadedFromProject.current = true;
        }
        setIsLoadModalOpen(false);
        alert(`Proyecto "${project.titulo}" cargado correctamente`);
      }
    } catch (error) {
      console.error('Error al procesar datos del proyecto:', error);
      alert('El formato del proyecto no es válido');
    }
  };

  const getPresentationData = () => ({
    version: 1,
    slides,
    transitionsByGap: presentationTransitionsByGap,
    backgroundType: presentationBackgroundType,
    backgroundUrl: presentationBackgroundUrl,
    intervalSec: presentationSlideIntervalSec,
    musicClipUrl: presentationMusicClip?.url ?? null,
  });

  const savePresentationAsProject = async (titulo: string) => {
    setIsSavingPresentation(true);
    try {
      const paths = await getLocalPaths();
      const rootPath = paths?.video || paths?.proyectos_video || paths?.proyectos;
      if (!rootPath) throw new Error('Configura la ruta de vídeos o proyectos primero.');

      const datos = getPresentationData();
      const zeusPath = `${rootPath}\\${titulo.trim()}.zeus`;
      await ensureDir(rootPath);
      await saveProject(zeusPath, {
        titulo: titulo.trim(),
        tipo: 'presentacion',
        file: datos
      });

      setPresentationSaveModalOpen(false);
      alert('Presentación guardada como proyecto local.');
    } catch (e: any) {
      console.error('Presentación save error:', e);
      alert(e.message || 'Error al guardar la presentación');
    } finally {
      setIsSavingPresentation(false);
    }
  };

  const exportPresentationToVideo = (): Promise<Blob> => {
    return new Promise(async (resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('No se pudo crear el canvas'));
        return;
      }
      
      const preloadImages = (): Promise<HTMLImageElement[]> => {
        return Promise.all(
          slides.map(
            (s) =>
              new Promise<HTMLImageElement>((res, rej) => {
                const img = new Image();
                if (s.imageDataUrl.startsWith('http')) img.crossOrigin = 'anonymous';
                img.onload = () => res(img);
                img.onerror = () => rej(new Error('Error cargando imagen'));
                img.src = s.imageDataUrl;
              })
          )
        );
      };

      const preloadBackground = (): Promise<HTMLImageElement | null> => {
        if (presentationBackgroundType === 'image' && presentationBackgroundUrl) {
          return new Promise((res) => {
            const img = new Image();
            if (presentationBackgroundUrl.startsWith('http')) img.crossOrigin = 'anonymous';
            img.onload = () => res(img);
            img.onerror = () => res(null);
            img.src = presentationBackgroundUrl.startsWith('http') || presentationBackgroundUrl.startsWith('blob') || presentationBackgroundUrl.startsWith('data') 
              ? presentationBackgroundUrl 
              : resolveUrl(presentationBackgroundUrl);
          });
        }
        return Promise.resolve(null);
      };
      
      const preloadOverlays = (): Promise<(HTMLImageElement | null)[]> => {
        return Promise.all(
          slides.map(
            (s): Promise<HTMLImageElement | null> =>
              s.overlayEffectId
                ? new Promise((res) => {
                  const eff = getSlideEffect(s.overlayEffectId as SlideEffectId);
                  if (!eff) return res(null);
                  const img = new Image();
                  img.onload = () => res(img);
                  img.onerror = () => res(null);
                  img.src = eff.getDataUrl(canvas.width, canvas.height);
                })
                : Promise.resolve(null)
          )
        );
      };

      try {
        const images = await preloadImages();
        const overlayImages = await preloadOverlays();
        const backgroundImg = await preloadBackground();
        const slideDurationSec = presentationSlideIntervalSec;
        const transitionDurationSec = presentationTransitionsByGap[0]?.duration ?? 0.5;
        const timePerSlide = transitionDurationSec + slideDurationSec;
        const totalDurationSec = slides.length * timePerSlide;
        
        if (slides.length === 0 || totalDurationSec <= 0) {
          reject(new Error('No hay diapositivas para exportar'));
          return;
        }

        const canvasStream = canvas.captureStream(30);
        let combinedStream: MediaStream = canvasStream;
        let bgAudio: HTMLAudioElement | null = null;
        let audioCtx: AudioContext | null = null;

        let audioGain: GainNode | null = null;
        const FADE_OUT_DURATION = 3; // segundos de fade-out al final

        if (presentationMusicClip && presentationMusicClip.url) {
          try {
            bgAudio = new Audio();
            bgAudio.crossOrigin = 'anonymous';
            bgAudio.src = resolveUrl(presentationMusicClip.url);
            bgAudio.loop = true;

            audioCtx = new AudioContext();
            const dest = audioCtx.createMediaStreamDestination();
            const source = audioCtx.createMediaElementSource(bgAudio);
            audioGain = audioCtx.createGain();
            audioGain.gain.value = 1;
            source.connect(audioGain);
            audioGain.connect(dest);

            combinedStream = new MediaStream([
              ...canvasStream.getVideoTracks(),
              ...dest.stream.getAudioTracks(),
            ]);
          } catch (audioErr) {
            console.warn('No se pudo añadir audio al vídeo:', audioErr);
            combinedStream = canvasStream;
          }
        }

        const stream = combinedStream;
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm';

        const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 15000000 });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
          try { bgAudio?.pause(); } catch {}
          try { audioCtx?.close(); } catch {}
          resolve(new Blob(chunks, { type: mime }));
        };
        recorder.onerror = () => {
          try { bgAudio?.pause(); } catch {}
          try { audioCtx?.close(); } catch {}
          reject(new Error('Error al grabar el vídeo'));
        };

        recorder.start(100);
        bgAudio?.play().catch(() => {});
        const startTime = performance.now();
        const zoomFactor = presentationZoom / 100;

        const getWrappedLines = (text: string, font: string, maxWidth: number): string[] => {
          ctx.font = font;
          const words = text.replace(/\s+/g, ' ').trim().split(' ');
          const lines: string[] = [];
          let line = '';
          for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            if (ctx.measureText(testLine).width > maxWidth && n > 0) {
              lines.push(line);
              line = words[n] + ' ';
            } else {
              line = testLine;
            }
          }
          lines.push(line);
          return lines;
        };

        const drawSlide = (
          sCtx: CanvasRenderingContext2D,
          sSlide: EditorSlide,
          sImg: HTMLImageElement,
          sOverlay: HTMLImageElement | null,
          sCanvasW: number,
          sCanvasH: number
        ) => {
          sCtx.save();

          const hasText = !!(sSlide.title || sSlide.description);
          const maxImgW = sCanvasW * 0.467;
          const maxImgH = sCanvasH * 0.5;
          const imgScale = Math.min(maxImgW / sImg.width, maxImgH / sImg.height, 1);
          const w = sImg.width * imgScale;
          const h = sImg.height * imgScale;

          const TEXT_GAP = 40;
          const tBoxW = maxImgW * ((sSlide.textWidth || 60) / 100);
          // En la UI el zoom CSS (transform:scale) NO afecta el layout/wrapping del texto
          const wrapW = tBoxW;

          let textH = 0;
          if (hasText) {
            if (sSlide.title) {
              const tSize = sSlide.titleFontSize || 32;
              const tFont = `bold ${tSize}px ${sSlide.titleFontFamily || 'sans-serif'}`;
              const tLines = getWrappedLines(sSlide.title, tFont, wrapW);
              textH += tLines.length * tSize * 1.3;
            }
            if (sSlide.description) {
              const dSize = sSlide.descriptionFontSize || 18;
              const dFont = `${dSize}px ${sSlide.descriptionFontFamily || 'sans-serif'}`;
              const dLines = getWrappedLines(sSlide.description, dFont, wrapW);
              textH += dLines.length * dSize * 1.4;
            }
          }

          const totalH = h + (hasText ? TEXT_GAP + textH : 0);
          const imgX = (sCanvasW - w) / 2;
          const imgY = (sCanvasH - totalH) / 2;

          // Dibujar Imagen
          sCtx.save();
          sCtx.shadowColor = 'rgba(0,0,0,0.6)';
          sCtx.shadowBlur = 50;
          sCtx.shadowOffsetY = 15;

          const radius = 24;
          const roundedPath = () => {
            sCtx.beginPath();
            sCtx.moveTo(imgX + radius, imgY);
            sCtx.lineTo(imgX + w - radius, imgY);
            sCtx.quadraticCurveTo(imgX + w, imgY, imgX + w, imgY + radius);
            sCtx.lineTo(imgX + w, imgY + h - radius);
            sCtx.quadraticCurveTo(imgX + w, imgY + h, imgX + w - radius, imgY + h);
            sCtx.lineTo(imgX + radius, imgY + h);
            sCtx.quadraticCurveTo(imgX, imgY + h, imgX, imgY + h - radius);
            sCtx.lineTo(imgX, imgY + radius);
            sCtx.quadraticCurveTo(imgX, imgY, imgX + radius, imgY);
            sCtx.closePath();
          };

          sCtx.fillStyle = '#000';
          roundedPath();
          sCtx.fill();

          sCtx.shadowColor = 'transparent';
          sCtx.save();
          roundedPath();
          sCtx.clip();
          sCtx.drawImage(sImg, imgX, imgY, w, h);
          if (sOverlay && sOverlay.complete) {
            sCtx.globalAlpha = 0.9;
            sCtx.drawImage(sOverlay, imgX, imgY, w, h);
            sCtx.globalAlpha = 1;
          }
          sCtx.restore();

          sCtx.strokeStyle = '#374151';
          sCtx.lineWidth = 1.5;
          roundedPath();
          sCtx.stroke();
          sCtx.restore();

          // Dibujar Textos
          if (hasText) {
            let curY = imgY + h + TEXT_GAP;
            const align = sSlide.textAlign || 'center';
            sCtx.textAlign = align as CanvasTextAlign;

            if (sSlide.title) {
              const tSize = sSlide.titleFontSize || 32;
              sCtx.fillStyle = sSlide.titleColor || '#ffffff';
              const tFont = `bold ${tSize}px ${sSlide.titleFontFamily || 'sans-serif'}`;
              const tLines = getWrappedLines(sSlide.title, tFont, wrapW);
              let tx = sCanvasW / 2;
              if (align === 'left') tx = (sCanvasW - tBoxW) / 2;
              if (align === 'right') tx = (sCanvasW + tBoxW) / 2;
              for (const line of tLines) {
                sCtx.fillText(line, tx, curY + tSize);
                curY += tSize * 1.3;
              }
            }

            if (sSlide.description) {
              const dSize = sSlide.descriptionFontSize || 18;
              sCtx.fillStyle = sSlide.descriptionColor || '#d1d5db';
              const dFont = `${dSize}px ${sSlide.descriptionFontFamily || 'sans-serif'}`;
              const dLines = getWrappedLines(sSlide.description, dFont, wrapW);
              let dx = sCanvasW / 2;
              if (align === 'left') dx = (sCanvasW - tBoxW) / 2;
              if (align === 'right') dx = (sCanvasW + tBoxW) / 2;
              for (const line of dLines) {
                sCtx.fillText(line, dx, curY + dSize);
                curY += dSize * 1.4;
              }
            }
          }

          sCtx.restore();
        };

        const drawFrame = () => {
          const elapsed = (performance.now() - startTime) / 1000;

          // Fade-out de audio en los últimos segundos
          if (audioGain) {
            const timeRemaining = totalDurationSec - elapsed;
            if (timeRemaining <= 0) {
              audioGain.gain.value = 0;
            } else if (timeRemaining < FADE_OUT_DURATION) {
              audioGain.gain.value = Math.max(0, timeRemaining / FADE_OUT_DURATION);
            } else {
              audioGain.gain.value = 1;
            }
          }

          if (elapsed >= totalDurationSec) {
            recorder.stop();
            return;
          }

          const currentSlideIndex = Math.min(slides.length - 1, Math.floor(elapsed / timePerSlide));
          const timeInCurrentSlide = elapsed - currentSlideIndex * timePerSlide;
          const isTransitioning = currentSlideIndex > 0 && timeInCurrentSlide < transitionDurationSec;
          const transitionProgress = isTransitioning ? timeInCurrentSlide / transitionDurationSec : 1;

          const gapIndex = currentSlideIndex - 1;
          const trans = isTransitioning && presentationTransitionsByGap[gapIndex]
            ? presentationTransitionsByGap[gapIndex]
            : { type: 'none' as TransitionType, duration: transitionDurationSec };

          const slide = slides[currentSlideIndex];
          const img = images[currentSlideIndex];
          if (!slide || !img) {
            requestAnimationFrame(drawFrame);
            return;
          }

          setPresentationExportProgress(`Exportando: Diapositiva ${currentSlideIndex + 1} de ${slides.length}`);

          // --- 1. Fondo ---
          if (presentationBackgroundType === 'color' && presentationBackgroundUrl) {
            ctx.fillStyle = presentationBackgroundUrl;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          } else if (presentationBackgroundType === 'gradient' && presentationBackgroundUrl) {
            const [from, to, , angleStr] = presentationBackgroundUrl.split('|');
            const angle = parseFloat(angleStr) || 180;
            const rad = (angle - 90) * (Math.PI / 180);
            const x1 = canvas.width / 2 - Math.cos(rad) * canvas.width / 2;
            const y1 = canvas.height / 2 - Math.sin(rad) * canvas.height / 2;
            const x2 = canvas.width / 2 + Math.cos(rad) * canvas.width / 2;
            const y2 = canvas.height / 2 + Math.sin(rad) * canvas.height / 2;
            const grad = ctx.createLinearGradient(x1, y1, x2, y2);
            grad.addColorStop(0, from || '#1a1a2e');
            grad.addColorStop(1, to || '#0a0a0a');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          } else {
            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            if (backgroundImg && backgroundImg.complete) {
              const bgScale = Math.max(canvas.width / backgroundImg.width, canvas.height / backgroundImg.height);
              const bgW = backgroundImg.width * bgScale;
              const bgH = backgroundImg.height * bgScale;
              ctx.globalAlpha = 0.4;
              ctx.drawImage(backgroundImg, (canvas.width - bgW) / 2, (canvas.height - bgH) / 2, bgW, bgH);
              ctx.globalAlpha = 1;
              ctx.fillStyle = 'rgba(10, 10, 10, 0.6)';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
          }

          // --- 2. Aplicar Zoom Global ---
          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.scale(zoomFactor, zoomFactor);
          ctx.translate(-canvas.width / 2, -canvas.height / 2);

          const easeOut = (t: number) => 1 - Math.pow(1 - t, 1.7);

          if (isTransitioning && trans.type !== 'none') {
            // Dibujar diapositiva anterior (sin animación de salida; simplemente se mantiene)
            const prevSlideIndex = currentSlideIndex - 1;
            const prevSlide = slides[prevSlideIndex];
            const prevImg = images[prevSlideIndex];
            if (prevSlide && prevImg) {
              drawSlide(ctx, prevSlide, prevImg, overlayImages[prevSlideIndex], canvas.width, canvas.height);
            }

            // Dibujar diapositiva actual con transición de entrada
            const easedProgress = easeOut(transitionProgress);
            const invProgress = 1 - easedProgress;

            ctx.save();
            switch (trans.type) {
              case 'fade':
              case 'dissolve':
                ctx.globalAlpha = easedProgress;
                break;
              case 'slide-left':
                ctx.translate(canvas.width * invProgress, 0);
                ctx.globalAlpha = easedProgress;
                break;
              case 'slide-right':
                ctx.translate(-canvas.width * invProgress, 0);
                ctx.globalAlpha = easedProgress;
                break;
              case 'slide-up':
                ctx.translate(0, canvas.height * invProgress);
                ctx.globalAlpha = easedProgress;
                break;
              case 'slide-down':
                ctx.translate(0, -canvas.height * invProgress);
                ctx.globalAlpha = easedProgress;
                break;
              case 'zoom-in':
                ctx.translate(canvas.width / 2, canvas.height / 2);
                ctx.scale(0.85 + 0.15 * easedProgress, 0.85 + 0.15 * easedProgress);
                ctx.translate(-canvas.width / 2, -canvas.height / 2);
                ctx.globalAlpha = easedProgress;
                break;
              case 'zoom-out':
                ctx.translate(canvas.width / 2, canvas.height / 2);
                ctx.scale(1.15 - 0.15 * easedProgress, 1.15 - 0.15 * easedProgress);
                ctx.translate(-canvas.width / 2, -canvas.height / 2);
                ctx.globalAlpha = easedProgress;
                break;
              case 'blur':
                ctx.filter = `blur(${12 * invProgress}px)`;
                ctx.globalAlpha = easedProgress;
                break;
            }

            drawSlide(ctx, slide, img, overlayImages[currentSlideIndex], canvas.width, canvas.height);
            ctx.filter = 'none';
            ctx.restore();
          } else {
            drawSlide(ctx, slide, img, overlayImages[currentSlideIndex], canvas.width, canvas.height);
          }

          ctx.restore(); // Fin Zoom Global
          requestAnimationFrame(drawFrame);
        };
        
        requestAnimationFrame(drawFrame);
      } catch (err) {
        reject(err);
      }
    });
  };

  const savePresentationAsAnimation = async (titulo: string) => {
    setIsSavingPresentation(true);
    setIsExportingPresentationVideo(true);
    setPresentationExportProgress('Preparando...');
    try {
      const videoBlob = await exportPresentationToVideo();
      setPresentationExportProgress('Guardando vídeo...');

      const paths = await getLocalPaths();
      const rootPath = paths?.video || paths?.proyectos_video || paths?.proyectos;
      if (!rootPath) throw new Error('Configura la ruta de vídeos o proyectos primero.');
      await ensureDir(rootPath);

      const rawFileName = `presentacion-${Date.now()}.webm`;
      const rawPath = `${rootPath}\\${rawFileName}`;
      const buffer = new Uint8Array(await videoBlob.arrayBuffer());
      await writeFile(rawPath, buffer);

      // Transcodificar a MP4 con ffmpeg si estamos en Electron
      let videoPath = rawPath;
      let finalExt = 'webm';
      if (typeof window !== 'undefined' && (window as any).electronAPI?.transcodeVideo) {
        setPresentationExportProgress('Transcodificando a MP4...');
        const mp4Path = rawPath.replace(/\.webm$/, '.mp4');
        const transcodeRes = await transcodeVideo(rawPath, mp4Path, (percent) => {
          setPresentationExportProgress(percent < 0 ? 'Transcodificando a MP4...' : `Transcodificando a MP4: ${Math.round(percent)}%`);
        });
        if (transcodeRes.success && transcodeRes.outputPath) {
          videoPath = transcodeRes.outputPath;
          finalExt = 'mp4';
          // Borrar webm temporal
          try {
            const { fsDeleteFile } = (window as any).electronAPI;
            if (fsDeleteFile) await fsDeleteFile(rawPath);
          } catch {}
        } else {
          console.warn('Transcodificación a MP4 falló, usando webm:', transcodeRes.error);
        }
      }

      const videoFileName = videoPath.replace(/\\\\/g, '/').split('/').pop() || '';

      // También guardar una copia en la carpeta de vídeos para que aparezca en el explorador local
      const videoFolderPath = paths?.video;
      if (videoFolderPath && videoFolderPath !== rootPath) {
        await ensureDir(videoFolderPath);
        const videoFolderFilePath = `${videoFolderPath}\\${videoFileName}`;
        await copyFile(videoPath, videoFolderFilePath);
      }

      const datos = getPresentationData();
      const zeusPath = `${rootPath}\\${titulo.trim()}.zeus`;
      const mediaVideoUrl = typeof window !== 'undefined' && (window as any).electronAPI?.getMediaUrl
        ? (window as any).electronAPI.getMediaUrl(videoPath)
        : videoPath;
      await saveProject(zeusPath, {
        titulo: titulo.trim(),
        tipo: 'presentacion',
        file: datos,
        videoUrl: mediaVideoUrl
      });

      setPresentationSaveModalOpen(false);
      setPresentationExportProgress('');
      toast({ title: 'Guardado', description: `Presentación guardada como animación (${finalExt.toUpperCase()})`, variant: 'default' });
    } catch (e: any) {
      console.error('Presentación animation save error:', e);
      toast({ title: 'Error', description: e.message || 'Error al exportar o guardar', variant: 'destructive' });
    } finally {
      setIsSavingPresentation(false);
      setIsExportingPresentationVideo(false);
      setPresentationExportProgress('');
    }
  };

  const exportPresentationAsVideo = async (titulo: string) => {
    setIsSavingPresentation(true);
    setIsExportingPresentationVideo(true);
    setPresentationExportProgress('Preparando...');
    try {
      const videoBlob = await exportPresentationToVideo();
      setPresentationExportProgress('Guardando vídeo...');

      const paths = await getLocalPaths();
      const rootPath = paths?.video || paths?.proyectos_video || paths?.proyectos;
      if (!rootPath) throw new Error('Configura la ruta de vídeos o proyectos primero.');
      await ensureDir(rootPath);

      const rawFileName = `${titulo.trim()}.webm`;
      const rawPath = `${rootPath}\\${rawFileName}`;
      const buffer = new Uint8Array(await videoBlob.arrayBuffer());
      await writeFile(rawPath, buffer);

      // Transcodificar a MP4 con ffmpeg si estamos en Electron
      let videoPath = rawPath;
      let finalExt = 'webm';
      if (typeof window !== 'undefined' && (window as any).electronAPI?.transcodeVideo) {
        setPresentationExportProgress('Transcodificando a MP4...');
        const mp4Path = rawPath.replace(/\.webm$/, '.mp4');
        const transcodeRes = await transcodeVideo(rawPath, mp4Path, (percent) => {
          setPresentationExportProgress(percent < 0 ? 'Transcodificando a MP4...' : `Transcodificando a MP4: ${Math.round(percent)}%`);
        });
        if (transcodeRes.success && transcodeRes.outputPath) {
          videoPath = transcodeRes.outputPath;
          finalExt = 'mp4';
          // Borrar webm temporal
          try {
            const { fsDeleteFile } = (window as any).electronAPI;
            if (fsDeleteFile) await fsDeleteFile(rawPath);
          } catch {}
        } else {
          console.warn('Transcodificación a MP4 falló, usando webm:', transcodeRes.error);
        }
      }

      const videoFileName = videoPath.replace(/\\\\/g, '/').split('/').pop() || '';

      // También guardar una copia en la carpeta de vídeos para que aparezca en el explorador local
      const videoFolderPath = paths?.video;
      if (videoFolderPath && videoFolderPath !== rootPath) {
        await ensureDir(videoFolderPath);
        const videoFolderFilePath = `${videoFolderPath}\\${videoFileName}`;
        await copyFile(videoPath, videoFolderFilePath);
      }

      setPresentationSaveModalOpen(false);
      setPresentationExportProgress('');
      toast({ title: 'Exportado', description: `Vídeo ${videoFileName} guardado`, variant: 'default' });
    } catch (e: any) {
      console.error('Error exportando vídeo:', e);
      toast({ title: 'Error', description: e.message || 'Error al exportar vídeo', variant: 'destructive' });
    } finally {
      setIsSavingPresentation(false);
      setIsExportingPresentationVideo(false);
      setPresentationExportProgress('');
    }
  };

  const fetchPresentationsFromPocketBase = async () => {
    setIsLoadingPresentations(true);
    try {
      const [presentaciones, proyectosVideo] = await Promise.all([
        pb.collection('proyectos').getFullList({ filter: 'tipo = "presentacion"', sort: '-created', requestKey: null }),
        pb.collection('proyectos').getFullList({ filter: 'tipo = "edit_video"', sort: '-created', requestKey: null }),
      ]);
      const conDiapositivas = proyectosVideo.filter((p: any) => {
        const file = p.file;
        const data = typeof file === 'string' ? (() => { try { return JSON.parse(file); } catch { return {}; } })() : (file || {});
        return data.presentationSlides?.length > 0;
      });
      const records = [
        ...presentaciones.map((p: any) => ({ ...p, _origen: 'presentacion' })),
        ...conDiapositivas.map((p: any) => ({ ...p, _origen: 'proyecto_video' })),
      ].sort((a: any, b: any) => new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime());
      setSavedPresentations(records);
      setPresentationLoadModalOpen(true);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Error al cargar presentaciones');
    } finally {
      setIsLoadingPresentations(false);
    }
  };

  const loadPresentationFromRecord = (record: any) => {
    try {
      const raw = record.file ?? record.datos;
      const datos = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const slides = datos?.slides ?? datos?.presentationSlides;
      if (slides && Array.isArray(slides)) {
        setSlides(slides);
        const trans = datos.transitionsByGap ?? datos.presentationTransitionsByGap;
        if (Array.isArray(trans) && trans.length) setPresentationTransitionsByGap(trans);
        if (datos.backgroundType) setPresentationBackgroundType(datos.backgroundType);
        if (datos.backgroundUrl !== undefined) setPresentationBackgroundUrl(datos.backgroundUrl || '');
        if (typeof datos.intervalSec === 'number') setPresentationSlideIntervalSec(datos.intervalSec);
        if (datos.musicClipUrl) setPresentationMusicClip({ url: datos.musicClipUrl, duration: 0 });
        else setPresentationMusicClip(null);
        // Convertir videoUrl local a media:// si es necesario
        const exportedVideoUrl = datos.videoUrl || record.videoUrl;
        if (exportedVideoUrl && typeof exportedVideoUrl === 'string') {
          let resolvedUrl = exportedVideoUrl;
          if (/^[a-zA-Z]:\\/.test(resolvedUrl) && typeof window !== 'undefined' && (window as any).electronAPI?.getMediaUrl) {
            resolvedUrl = (window as any).electronAPI.getMediaUrl(resolvedUrl);
          }
          setPresentationExportedVideoUrl(resolvedUrl);
        } else {
          setPresentationExportedVideoUrl(null);
        }
        setPresentationLoadModalOpen(false);
        toast({ title: 'Cargada', description: `Presentación "${record.titulo}" cargada`, variant: 'default' });
      }
    } catch (e) {
      console.error(e);
      toast({ title: 'Error', description: 'Formato de presentación no válido', variant: 'destructive' });
    }
  };

  const deletePresentationFromPocketBase = async (id: string, e: React.MouseEvent, record?: any) => {
    e.stopPropagation();
    const msg = record?._origen === 'proyecto_video'
      ? '¿Eliminar este proyecto de vídeo completo? Se borrará de la base de datos.'
      : '¿Eliminar esta presentación?';
    if (!confirm(msg)) return;
    try {
      await pb.collection('proyectos').delete(id);
      setSavedPresentations((prev) => prev.filter((p) => p.id !== id));
    } catch (err: any) {
      alert(err?.message || 'Error al eliminar');
    }
  };

  const handleProjectFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      loadProjectFromFile(file);
    }
  };

  // Funciones de manejo de estado
  const handleTrimStartChange = (value: number[]) => {
    setEditState(prev => ({ ...prev, trimStart: value[0] }));
  };

  const handleTrimEndChange = (value: number[]) => {
    setEditState(prev => ({ ...prev, trimEnd: value[0] }));
  };

  const handleEffectChange = (key: keyof Pick<VideoEditState, 'brightness' | 'contrast' | 'saturation' | 'hue' | 'blur' | 'intensity'>) => (value: number[]) => {
    setEditState(prev => ({ ...prev, [key]: value[0] }));
  };


  // Funciones para manejar textos
  const handleAddTextClip = (clip: Omit<TextClip, 'id'>) => {
    const newClip: TextClip = {
      ...clip,
      id: `text-${Date.now()}`,
    };
    if (!editState.timeline) {
      saveToHistory({ ...editState, textClips: [...(editState.textClips || []), newClip] });
      return;
    }
    const textTrack = editState.timeline.tracks.find(track => track.type === 'text');
    if (!textTrack) {
      saveToHistory({ ...editState, textClips: [...(editState.textClips || []), newClip] });
      return;
    }
    const timelineClip: TimelineClip = {
      id: newClip.id,
      trackId: textTrack.id,
      type: 'text',
      startTime: clip.startTime,
      duration: clip.duration,
      text: clip.text,
      fontSize: clip.fontSize,
      fontFamily: clip.fontFamily,
      color: clip.color,
      backgroundColor: clip.backgroundColor,
      backgroundOpacity: clip.backgroundOpacity,
      backgroundBlur: clip.backgroundBlur,
      borderRadius: clip.borderRadius,
      borderWidth: clip.borderWidth,
      borderColor: clip.borderColor,
      shadowBlur: clip.shadowBlur,
      shadowOffset: clip.shadowOffset,
      shadowColor: clip.shadowColor,
      isBold: clip.isBold,
      isItalic: clip.isItalic,
      isUnderline: clip.isUnderline,
      position: clip.position,
      opacity: clip.opacity / 100,
      overlayTint: undefined
    };
    // Una sola actualización: texto + clip en timeline con el mismo id para que cuadren tiempos y se sincronicen
    saveToHistory({
      ...editState,
      textClips: [...(editState.textClips || []), newClip],
      timeline: {
        ...editState.timeline,
        tracks: editState.timeline.tracks.map(track =>
          track.id === textTrack.id
            ? { ...track, clips: [...track.clips, timelineClip] }
            : track
        ),
      },
    });
  };

  const handleUpdateTextClip = (id: string, updates: Partial<TextClip>) => {
    const nextTextClips = (editState.textClips || []).map(clip =>
      clip.id === id ? { ...clip, ...updates } : clip
    );
    if (!editState.timeline) {
      saveToHistory({ ...editState, textClips: nextTextClips });
      return;
    }
    const textTrack = editState.timeline.tracks.find(track => track.type === 'text');
    const clipInTrack = textTrack?.clips.find(c => c.id === id);
    const updatedClip = clipInTrack
      ? {
        ...clipInTrack,
        ...updates,
        opacity: updates.opacity !== undefined ? updates.opacity / 100 : clipInTrack.opacity,
      }
      : null;
    saveToHistory({
      ...editState,
      textClips: nextTextClips,
      timeline: updatedClip && textTrack
        ? {
          ...editState.timeline,
          tracks: editState.timeline.tracks.map(track =>
            track.id === textTrack.id
              ? {
                ...track,
                clips: track.clips.map(c => (c.id === id ? updatedClip : c)),
              }
              : track
          ),
        }
        : editState.timeline,
    });
  };

  const handleDeleteTextClip = (id: string) => {
    saveToHistory({
      ...editState,
      textClips: (editState.textClips || []).filter(clip => clip.id !== id)
    });

    // También eliminar de la línea de tiempo
    if (editState.timeline) {
      const textTrack = editState.timeline.tracks.find(track => track.type === 'text');
      if (textTrack) {
        handleDeleteClip(id);
      }
    }
  };

  const handleAddObjectClip = async (asset: OverlayObjectAsset, isDeformable: boolean = true) => {
    // Para objetos vídeo, la duración por defecto del clip = duración del vídeo
    // (se reproduce en bucle mientras el clip esté activo). Fallback 5s.
    let duration = 5;
    if (asset.mediaType === 'video') {
      try {
        const d = await getObjectVideoDuration(asset.dataUrl);
        if (Number.isFinite(d) && d > 0) duration = Math.max(1, d);
      } catch (e) {
        console.warn('No se pudo medir la duración del vídeo del objeto:', e);
      }
    }
    const newClip: ObjectClip = {
      id: `object-${Date.now()}`,
      name: asset.name,
      assetId: asset.id,
      src: asset.dataUrl,
      mediaType: asset.mediaType,
      position: { x: 50, y: 50 },
      width: 28,
      startTime: editState.timeline?.currentTime ?? 0,
      duration,
      opacity: 100,
      fadeInDuration: 0,
      fadeOutDuration: 0,
      isDeformable: isDeformable,
      corners: isDeformable ? [
        { x: -50, y: -50 },
        { x: 50, y: -50 },
        { x: 50, y: 50 },
        { x: -50, y: 50 },
      ] : undefined,
    };

    if (!editState.timeline) {
      saveToHistory({ ...editState, objectClips: [...(editState.objectClips || []), newClip] });
      setSelectedObjectId(newClip.id);
      return;
    }

    let effectsTrack = editState.timeline.tracks.find(isEffectsTrack);
    let nextTracks = editState.timeline.tracks;
    if (!effectsTrack) {
      effectsTrack = createEffectsTrack();
      nextTracks = placeEffectsTrackBelowMainVideo([...editState.timeline.tracks, effectsTrack]);
    }

    const timelineClip: TimelineClip = {
      id: newClip.id,
      trackId: effectsTrack.id,
      type: 'video',
      overlayKind: 'object',
      startTime: newClip.startTime,
      duration: newClip.duration,
      mediaFileId: newClip.src,
      thumbnailUrl: newClip.src,
      label: `Objeto: ${newClip.name}`,
      opacity: newClip.opacity / 100,
      fadeInDuration: 0,
      fadeOutDuration: 0,
      overlayTint: undefined,
    };

    saveToHistory({
      ...editState,
      objectClips: [...(editState.objectClips || []), newClip],
      timeline: {
        ...editState.timeline,
        tracks: nextTracks.map((track) =>
          track.id === effectsTrack!.id
            ? { ...track, clips: [...track.clips, timelineClip] }
            : track
        ),
      },
    });
    setSelectedObjectId(newClip.id);
  };

  // ---- Crear capa a partir de la selección ----
  // Captura el frame actual del vídeo fuente ORIGINAL (a resolución nativa), aplica
  // la máscara de selección (rect/circle/freehand) y crea un ObjectClip (PNG con alpha)
  // que muestra sólo lo dentro de la selección. El resto es transparente, por lo que la
  // capa se puede montar encima del video original.
  //
  // IMPORTANTE: se captura del vídeo origen —NO del previewCanvas— porque el canvas
  // visible se despliega con `object-contain` dentro de un contenedor con aspect-ratio
  // y se escala con `transform: scale(zoom)` (playerZoom). Eso produce letterboxing y
  // desalineación entre las % de SelectionOverlay (sobre el contenedor DOM) y las % del
  // canvas físico. Capturar del vídeo origen a tamaño nativo evita cualquier letterbox y
  // la capa resulta EXACTAMENTE del mismo tamaño y posición que el área seleccionada.
  const createSelectionLayer = async () => {
    if (!editState.selection?.enabled || !editState.selection.shape) {
      alert(t('videoEditor.selection.activateSelectionFirst'));
      return;
    }
    const src = getCurrentVideoSource();
    if (!src) {
      alert(t('videoEditor.selection.noVideoLoaded'));
      return;
    }
    const time = currentTimeRef.current;
    const shape = effectiveSelectionShapeForPaint(editState.selection, time);

    setIsCapturingSlides(true);
    try {
      // Capturar el frame COMPLETO del video origen a tamaño nativo, aplicando la
      // máscara de selección (rectángulo, círculo o trazo) como recorte. Todo lo
      // fuera de la máscara queda transparente (como el PNG). El resultado se guarda
      // como un objeto deformable en la librería y se añade al timeline.
      //
      // Además del dataUrl, devolvemos el bbox REAL del contenido no transparente
      // (bx, by, bw, bh en px nativos) y el tamaño nativo del vídeo (videoW, videoH).
      // El ObjectClip se posiciona/tamañoa a partir de ese bbox —NO de la caja de
      // selección (shape)— para que el aspect del PNG (bw/bh) coincida exactamente
      // con el aspect de la caja asignada. Así el preview (object-contain) no
      // encoge la capa y el export (drawImage estirado) no la deforma: la capa queda
      // exactamente del tamaño y posición del objeto recortado.
      const captured = await new Promise<{
        dataUrl: string; bx: number; by: number; bw: number; bh: number; videoW: number; videoH: number;
      }>((resolve, reject) => {
        const video = document.createElement('video');
        if (!src.startsWith('blob:') && !src.startsWith('data:')) video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.style.position = 'fixed';
        video.style.left = '-9999px';
        video.style.pointerEvents = 'none';
        document.body.appendChild(video);

        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('Timeout capturando frame de la capa de selección'));
        }, 20000);

        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          try { video.currentTime = time; } catch { /* ignore */ }
        };
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          if (typeof video.requestVideoFrameCallback === 'function') {
            let drawn = false;
            video.requestVideoFrameCallback(() => {
              if (drawn) return; drawn = true; doCapture();
            });
            setTimeout(() => {
              if (drawn) return; drawn = true; doCapture();
            }, 400);
          } else {
            requestAnimationFrame(() => requestAnimationFrame(doCapture));
          }
        };
        const onError = () => {
          cleanup();
          reject(new Error('Error cargando el vídeo para la capa de selección'));
        };
        const cleanup = () => {
          clearTimeout(timer);
          video.removeEventListener('error', onError);
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('seeked', onSeeked);
          try { video.remove(); } catch {}
          video.src = '';
        };

        const doCapture = async () => {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) {
            cleanup();
            reject(new Error('No se pudo decodificar el frame del video'));
            return;
          }
          // Canvas del tamaño COMPLETO del video (w×h), aplicando la máscara de
          // selección. Todo lo fuera de la máscara queda transparente. Si hay
          // máscara raster (varita mágica / SAM2: motionMasks) se recorta contra
          // el PNG (destination-in); si no, con el clip del path (rect/circle/lazo).
          // Con silueta cambiante (morph de lazo por puntos: motionPaths) se usa el
          // contorno deformado EN ESTE FRAME (tiempo de captura), no la forma base.
          const motionPaths = editState.selection?.enabled
            ? effectiveSelectionMotionPaths(editState.selection, time)
            : null;
          const path = motionPaths
            ? buildSelectionPaths(motionPaths, 0, 0, w, h)
            : buildSelectionPath(shape, 0, 0, w, h);
          const fullCanvas = document.createElement('canvas');
          fullCanvas.width = w;
          fullCanvas.height = h;
          const ctx = fullCanvas.getContext('2d');
          if (!ctx) {
            cleanup();
            reject(new Error('No se pudo crear el contexto de canvas'));
            return;
          }
          ctx.clearRect(0, 0, w, h);
          ctx.save();
          const maskUrl = editState.selection?.enabled ? effectiveSelectionMaskUrl(editState.selection, time) : null;
          if (maskUrl) {
            try {
              const mask = await loadMaskImage(maskUrl);
              ctx.drawImage(video, 0, 0, w, h);
              ctx.globalCompositeOperation = 'destination-in';
              ctx.drawImage(mask, 0, 0, w, h);
            } catch {
              // Máscara no disponible: cae al clip vectorial (path vacío para
              // wand → selección vacía, pero no rompe la creación de capa).
              ctx.clip(path);
              ctx.drawImage(video, 0, 0, w, h);
            }
          } else {
            ctx.clip(path);
            ctx.drawImage(video, 0, 0, w, h);
          }
          ctx.restore();

          // Recortar de nuevo al bounding box REAL del contenido no-transparente.
          // Así el PNG final contiene SOLO el objeto (el rectángulo de selección
          // puede incluir transparencias si la máscara es un círculo o trazo).
          const imageData = ctx.getImageData(0, 0, w, h);
          const data = imageData.data;
          let minX = w, minY = h, maxX = -1, maxY = -1;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * 4 + 3; // canal alpha
              if (data[idx] > 0) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          if (maxX < 0) {
            cleanup();
            reject(new Error('No se pudo recortar la selección (canvas vacío)'));
            return;
          }
          const bx = minX;
          const by = minY;
          const bw = maxX - minX + 1;
          const bh = maxY - minY + 1;

          // Canvas recortado al bbox del objeto
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = bw;
          cropCanvas.height = bh;
          const cctx = cropCanvas.getContext('2d');
          if (!cctx) {
            cleanup();
            reject(new Error('No se pudo crear el contexto de canvas de recorte'));
            return;
          }
          cctx.clearRect(0, 0, bw, bh);
          cctx.drawImage(fullCanvas, bx, by, bw, bh, 0, 0, bw, bh);

          const result = cropCanvas.toDataURL('image/png');
          cleanup();
          resolve({ dataUrl: result, bx, by, bw, bh, videoW: w, videoH: h });
        };

        video.addEventListener('loadedmetadata', onLoaded);
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', onError);
        video.src = src;
        video.load();
      });

// Registrar el PNG recortado como asset en la librería de objetos.
      // El clip se crea con la posición/tamaño del BBOX del contenido recortado
      // (NO con la caja de selección ni los defaults de handleAddObjectClip) para
      // que la capa aparezca en el lugar exacto y al tamaño exacto del objeto.
      const { dataUrl, bx, by, bw, bh, videoW, videoH } = captured;
      const assetName = `Selección ${time.toFixed(1)}s`;
      const asset: OverlayObjectAsset = {
        id: `object-${Date.now()}`,
        name: assetName,
        dataUrl,
        mediaType: 'png',
      };
      registerOverlayObject(asset);
      saveOverlayObjectsToStorage();

      // Crear el ObjectClip con la posición y tamaño del bbox del contenido (en %
      // del vídeo nativo). Así el aspect del PNG (bw/bh) coincide con el aspect de
      // la caja (width·W / height·H, donde W/H = aspect del vídeo) y ni el preview
      // (object-contain) encoge la capa ni el export (drawImage estirado) la deforma.
      const duration = editState.timeline?.duration ?? 0;
      const defaultDur = Math.min(5, duration);
      const clipStart = editState.timeline?.currentTime ?? 0;
      const wPct = videoW > 0 ? (bw / videoW) * 100 : shape.width;
      const hPct = videoH > 0 ? (bh / videoH) * 100 : shape.height;
      const cxPct = videoW > 0 ? ((bx + bw / 2) / videoW) * 100 : shape.x + shape.width / 2;
      const cyPct = videoH > 0 ? ((by + bh / 2) / videoH) * 100 : shape.y + shape.height / 2;
      const newClip: ObjectClip = {
        id: `selection-layer-${Date.now()}`,
        name: assetName,
        assetId: asset.id,
        src: dataUrl,
        mediaType: 'png',
        // Centro del bbox del contenido (%) y ancho/alto del bbox (no de la caja
        // de selección, que puede ser más grande y de aspect distinto).
        position: {
          x: cxPct,
          y: cyPct,
        },
        width: wPct,
        height: hPct,
        startTime: clipStart,
        duration: defaultDur,
        opacity: 100,
        fadeInDuration: 0,
        fadeOutDuration: 0,
        isDeformable: true,
        corners: defaultCorners(),
      };

      // Insertar en la pista de efectos
      let effectsTrack2 = editState.timeline?.tracks.find(isEffectsTrack);
      let nextTracks = editState.timeline?.tracks ?? [];
      if (!effectsTrack2) {
        effectsTrack2 = createEffectsTrack();
        nextTracks = placeEffectsTrackBelowMainVideo([...nextTracks, effectsTrack2]);
      }
      const timelineClip: TimelineClip = {
        id: newClip.id,
        trackId: effectsTrack2.id,
        type: 'video',
        overlayKind: 'object',
        startTime: clipStart,
        duration: defaultDur,
        mediaFileId: dataUrl,
        thumbnailUrl: dataUrl,
        label: `Capa: ${newClip.name}`,
        opacity: 1.0,
        fadeInDuration: 0,
        fadeOutDuration: 0,
        overlayTint: undefined,
      };
      nextTracks = nextTracks.map((tr) =>
        tr.id === effectsTrack2!.id
          ? { ...tr, clips: [...tr.clips.filter((cl) => cl.id !== newClip.id), timelineClip] }
          : tr
      );
      saveToHistory({
        ...editState,
        objectClips: [...(editState.objectClips || []), newClip],
        timeline: { ...editState.timeline!, tracks: nextTracks } as TimelineState,
      });
      setSelectedObjectId(newClip.id);

      toast({
        title: t('videoEditor.selection.layerCreated'),
        description: t('videoEditor.selection.layerCreatedDesc'),
      });
    } catch (err) {
      console.error(err);
      alert(t('videoEditor.selection.layerError'));
    } finally {
      setIsCapturingSlides(false);
    }
  };
  const saveSelectionLayerAsPng = async () => {
    if (!editState.selection?.enabled || !editState.selection.shape) {
      alert(t('videoEditor.selection.activateSelectionFirst'));
      return;
    }
    const src = getCurrentVideoSource();
    if (!src) {
      alert(t('videoEditor.selection.noVideoLoaded'));
      return;
    }
    const nativeSize = videoNativeSize ?? previewVideoSize;
    const nativeW = nativeSize.width;
    const nativeH = nativeSize.height;
    if (!nativeW || !nativeH) {
      alert('No se pudo determinar el tamaño del vídeo.');
      return;
    }
    const time = currentTimeRef.current;
    const shape = effectiveSelectionShapeForPaint(editState.selection, time);

    setIsCapturingSlides(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const video = document.createElement('video');
        if (!src.startsWith('blob:') && !src.startsWith('data:')) video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.style.position = 'fixed';
        video.style.left = '-9999px';
        video.style.pointerEvents = 'none';
        document.body.appendChild(video);

        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('Timeout capturando frame de selección'));
        }, 20000);

        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          try { video.currentTime = time; } catch { /* ignore */ }
        };
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          if (typeof video.requestVideoFrameCallback === 'function') {
            let drawn = false;
            video.requestVideoFrameCallback(() => {
              if (drawn) return; drawn = true; doCapture();
            });
            setTimeout(() => {
              if (drawn) return; drawn = true; doCapture();
            }, 400);
          } else {
            requestAnimationFrame(() => requestAnimationFrame(doCapture));
          }
        };
        const onError = () => {
          cleanup();
          reject(new Error('Error cargando el vídeo para la capa de selección'));
        };
        const cleanup = () => {
          clearTimeout(timer);
          video.removeEventListener('error', onError);
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('seeked', onSeeked);
          try { video.remove(); } catch {}
          video.src = '';
        };

        const doCapture = () => {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) {
            cleanup();
            reject(new Error('No se pudo decodificar el frame del video'));
            return;
          }
          const path = buildSelectionPath(shape, 0, 0, w, h);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            cleanup();
            reject(new Error('No se pudo crear el contexto de canvas'));
            return;
          }
          ctx.clearRect(0, 0, w, h);
          ctx.save();
          ctx.clip(path);
          ctx.drawImage(video, 0, 0, w, h);
          ctx.restore();
          const result = canvas.toDataURL('image/png');
          cleanup();
          resolve(result);
        };

        video.addEventListener('loadedmetadata', onLoaded);
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', onError);
        video.src = src;
        video.load();
      });

      // Descargar el PNG
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'selection-' + Date.now() + '.png';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast({ title: t('videoEditor.selection.pngDownloaded'), description: t('videoEditor.selection.pngDownloadedDesc') });
    } finally {
      setIsCapturingSlides(false);
    }
  };

  // ---- Crear capa de VÍDEO a partir de la selección ----
  // Igual que createSelectionLayer pero captura la zona EN MOVIMIENTO durante
  // `duration` segundos desde el playhead: busca frame a frame en el vídeo origen
  // (resolución nativa), aplica la máscara de selección en cada instante
  // (motionMasks raster > motionPaths > shape) y graba el resultado a webm con
  // canvas.captureStream + MediaRecorder. La capa resultante es un objeto de
  // vídeo posicionado/tamañado a la caja de la selección.

  // Ventana de recorte estable (px nativos): la caja de la selección en t0. Para
  // freehand se usa el bbox de la silueta (motionPaths por frame, si existe) o de
  // los paths (la caja de la shape puede no estar).
  const selectionCropWindowPx = (selection: VideoSelectionState, t: number, w: number, h: number) => {
    const shape = effectiveSelectionShapeForPaint(selection, t);
    let x = shape.x ?? 0;
    let y = shape.y ?? 0;
    let wd = shape.width ?? 100;
    let ht = shape.height ?? 100;
    if (shape.type === 'freehand') {
      const motionPaths = effectiveSelectionMotionPaths(selection, t);
      const src = motionPaths && motionPaths.length > 0 ? motionPaths : shape.paths;
      const b = pathsBBox(src);
      if (b.width > 0 && b.height > 0) { x = b.x; y = b.y; wd = b.width; ht = b.height; }
    }
    // Si hay keyframes de caja o frames de silueta (morph), la ventana de recorte
    // debe cubrir TODOS: la capa se captura sobre un rango y la silueta se
    // mueve/deforma entre keyframes. Unión de bboxes de todos los frames.
    const kfs = shape.keyframes ?? [];
    const mfs = shape.motionPaths ?? [];
    if (kfs.length > 0 || mfs.length > 0) {
      let minX = x, minY = y, maxX = x + wd, maxY = y + ht;
      const grow = (bx: number, by: number, bw: number, bh: number) => {
        minX = Math.min(minX, bx); minY = Math.min(minY, by);
        maxX = Math.max(maxX, bx + bw); maxY = Math.max(maxY, by + bh);
      };
      for (const k of kfs) grow(k.x, k.y, k.width, k.height);
      for (const f of mfs) { const b = pathsBBox(f.paths); if (b.width > 0 && b.height > 0) grow(b.x, b.y, b.width, b.height); }
      x = minX; y = minY; wd = maxX - minX; ht = maxY - minY;
    }
    const X = (v: number) => Math.max(0, Math.min(w, Math.round((v / 100) * w)));
    const Y = (v: number) => Math.max(0, Math.min(h, Math.round((v / 100) * h)));
    const x1 = X(x);
    const y1 = Y(y);
    const x2 = Math.max(x1 + 2, X(x + wd));
    const y2 = Math.max(y1 + 2, Y(y + ht));
    return { x: x1, y: y1, width: Math.min(w, x2) - x1, height: Math.min(h, y2) - y1 };
  };

  // Graba la zona seleccionada como webm (blob URL) desde t0 durante dur segundos.
  // El loop va pausando/resumiendo el MediaRecorder para que la duración del webm
  // sea ~dur (ritmo real) aunque los seeks tarden más que 1/fps.
  const captureSelectionVideo = (
    src: string,
    t0: number,
    dur: number,
    fps: number,
    selection: VideoSelectionState,
    win: { x: number; y: number; width: number; height: number },
    onProgress: (frame: number, total: number) => void,
  ) => new Promise<{ url: string; duration: number }>((resolve, reject) => {
    const video = document.createElement('video');
    // Convierte media:///rutas a blob: ANTES de cargarlo en el <video>: el stack de
    // medios de Chromium se cuelga con protocolos custom + Range en algunos builds
    // (timeout "capturando la zona de vídeo"). fetch(media://) sí funciona
    // (lo usa mediabunny), así que descargamos el archivo y lo servimos como blob.
    let effectiveSrc = src;
    const preloadPromise = (async () => {
      if (src.startsWith('blob:') || src.startsWith('data:')) return;
      try {
        const resp = await fetch(src);
        if (resp.ok) {
          const blob = await resp.blob();
          if (blob.size > 0) effectiveSrc = URL.createObjectURL(blob);
        }
      } catch { /* si fetch falla, se intenta con el src original */ }
    })();
    void preloadPromise.finally(() => {
      if (settled) return;
      if (!src.startsWith('blob:') && !src.startsWith('data:')) video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.style.position = 'fixed';
      video.style.left = '-9999px';
      video.style.pointerEvents = 'none';
      document.body.appendChild(video);
      video.addEventListener('error', onError);
      video.addEventListener('loadedmetadata', onLoaded);
      video.src = effectiveSrc;
      video.load();
    });

    const canvas = document.createElement('canvas');
    canvas.width = win.width;
    canvas.height = win.height;
    // Anexado al DOM (off-screen) como el vídeo: algunos builds de Chromium no
    // emiten frames de canvas.captureStream() con el canvas fuera del documento.
    canvas.style.position = 'fixed';
    canvas.style.left = '-9999px';
    canvas.style.pointerEvents = 'none';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      try { video.remove(); } catch {}
      reject(new Error('No se pudo crear el contexto de canvas'));
      return;
    }

    const chunks: BlobPart[] = [];
    let slotMs = Math.max(15, 1000 / fps);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const mimeType =
      (typeof MediaRecorder !== 'undefined' &&
        ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))) ||
      'video/webm';

    let recorder: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    let effectiveDuration = dur;
    let totalFrames = 0;
    let settled = false;
    let seekGuard: (() => void) | null = null;
    // Frames pre-renderizados (ImageBitmap) listos para grabar. Se rellenan
    // ANTES de arrancar el MediaRecorder y se liberan al terminar.
    let preRenderedFrames: ImageBitmap[] = [];
    const cleanupFrames = () => {
      preRenderedFrames.forEach((f) => {
        try { (f as ImageBitmap).close?.(); } catch {}
      });
      preRenderedFrames = [];
    };

    const timeout = setTimeout(() => fail(t('videoEditor.selection.captureTimeout')), 120000);

    function fail(msg: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { stream?.getTracks().forEach((tr) => tr.stop()); } catch {}
      try { recorder?.stop(); } catch {}
      try { video.remove(); } catch {}
      try { canvas.remove(); } catch {}
      cleanupFrames();
      reject(new Error(msg));
    }

    function onRecError() {
      const errName = (recorder as unknown as { error?: { name?: string } } | null)?.error?.name;
      fail(t('videoEditor.selection.recorderError') + (errName ? `: ${errName}` : '.'));
    }

    // Dibuja el frame actual del vídeo recortado a la máscara de selección en t.
    // Se dibuja SOLO la ventana de recorte (win) del vídeo; la máscara se aplica en
    // las mismas coords de ventana (raster: destination-in; vector: path con origen
    // desplazado -win).
    const drawMaskedFrame = async (t: number) => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      const { x: wx, y: wy, width: ww, height: wh } = win;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      const shapeAtT = effectiveSelectionShapeForPaint(selection, t);
      const motionPaths = effectiveSelectionMotionPaths(selection, t);
      const maskUrl = effectiveSelectionMaskUrl(selection, t);
      let drew = false;
      if (maskUrl) {
        try {
          const mask = await loadMaskImage(maskUrl);
          ctx.drawImage(video, wx, wy, ww, wh, 0, 0, ww, wh);
          ctx.globalCompositeOperation = 'destination-in';
          ctx.drawImage(mask, wx, wy, ww, wh, 0, 0, ww, wh);
          drew = true;
        } catch { /* sin máscara raster: cae al path vectorial */ }
      }
      if (!drew) {
        if (motionPaths) ctx.clip(buildSelectionPaths(motionPaths, -wx, -wy, w, h));
        else ctx.clip(buildSelectionPath(shapeAtT, -wx, -wy, w, h));
        ctx.drawImage(video, wx, wy, ww, wh, 0, 0, ww, wh);
      }
      ctx.restore();
    };

    // Seek + espera a que el frame esté pintado (seeked + rVFC, con fallback).
    const seekTo = (t: number) => new Promise<void>((res) => {
      let finished = false;
      const finish = () => {
        if (!finished) {
          finished = true;
          seekGuard = null;
          res();
        }
      };
      seekGuard = finish;
      // Guard corto: con el vídeo en blob (memoria) los seeks tardan milisegundos;
      // un guard largo estira el tiempo de pared del loop y el webm sale en cámara
      // lenta (más largo de lo pedido).
      setTimeout(() => { if (seekGuard === finish) finish(); }, 120);
      try { video.currentTime = t; } catch { finish(); }
    });

    const onSeeked = () => {
      if (!seekGuard) return;
      const g = seekGuard;
      seekGuard = null;
      if (typeof video.requestVideoFrameCallback === 'function') {
        let drawn = false;
        video.requestVideoFrameCallback(() => { if (!drawn) { drawn = true; g(); } });
        setTimeout(() => { if (!drawn) { drawn = true; g(); } }, 80);
      } else {
        requestAnimationFrame(() => requestAnimationFrame(g));
      }
    };
    video.addEventListener('seeked', onSeeked);

    const drawLoop = async () => {
      // 1) Pre-renderizar TODOS los frames a ImageBitmaps ANTES de grabar. La
      //    duración de un webm de MediaRecorder = tiempo de pared que el grabador
      //    está corriendo, NO el número de frames. Si se hace seek+draw durante
      //    la grabación, los seeks lentos estiran el webm (sale más largo de lo
      //    pedido) y la duración del clip, tomada del webm, no coincide con la
      //    pedida. Pre-renderizando, la grabación sólo repasa frames ya listos a
      //    ritmo real (slotMs) → el webm dura exactamente totalFrames*slotMs =
      //    effectiveDuration, sin depender de la velocidad de seek.
      for (let i = 0; i < totalFrames; i++) {
        if (settled) { cleanupFrames(); return; }
        const ft = t0 + ((i + 0.5) / totalFrames) * effectiveDuration;
        try { await seekTo(ft); } catch {}
        try { await drawMaskedFrame(ft); } catch (e) { console.error('Error dibujando frame de la capa de selección:', e); }
        try {
          if (typeof createImageBitmap === 'function') {
            preRenderedFrames.push(await createImageBitmap(canvas));
          } else {
            const c = document.createElement('canvas');
            c.width = canvas.width;
            c.height = canvas.height;
            c.getContext('2d')!.drawImage(canvas, 0, 0);
            preRenderedFrames.push(c as unknown as ImageBitmap);
          }
        } catch { /* hueco: se reutiliza el frame anterior al grabar */ }
        onProgress(i + 1, totalFrames);
      }
      if (settled) { cleanupFrames(); return; }
      if (preRenderedFrames.length === 0) {
        fail(t('videoEditor.selection.captureEmpty'));
        return;
      }

      // 2) Arrancar el grabador con el primer frame ya pintado. Sin pause/resume:
      //    pausar un MediaRecorder sobre canvas.captureStream hace que el sampler
      //    deje de emitir y el webm sale vacío.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(preRenderedFrames[0] as CanvasImageSource, 0, 0);
      try {
        stream = canvas.captureStream(fps);
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
        recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
        recorder.onerror = onRecError;
        recorder.onstop = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          try { stream?.getTracks().forEach((tr) => tr.stop()); } catch {}
          try { video.remove(); } catch {}
          try { canvas.remove(); } catch {}
          cleanupFrames();
          const blob = new Blob(chunks, { type: mimeType });
          if (chunks.length === 0 || blob.size < 200) {
            reject(new Error(t('videoEditor.selection.captureEmpty')));
            return;
          }
          // Normaliza la duración del webm: los webm de MediaRecorder NO llevan
          // el elemento Matroska Duration (o queda a 0), así que la duración
          // declarada es poco fiable (reproductores externos leen menos, el
          // <video>.duration sale Infinity y el seek por tiempo del export falla).
          // Inyectamos el Duration real con effectiveDuration. Si el parseo EBML
          // no encaja, fixWebmDurationBlob devuelve el blob intacto (fallback
          // seguro). La duración del clip es determinista = effectiveDuration.
          void (async () => {
            let finalBlob = blob;
            try {
              finalBlob = await fixWebmDurationBlob(blob, effectiveDuration);
            } catch {}
            const url = URL.createObjectURL(finalBlob);
            resolve({ url, duration: effectiveDuration });
          })();
        };
        recorder.start(200);
      } catch (e) {
        cleanupFrames();
        fail(t('videoEditor.selection.recorderUnavailable'));
        return;
      }

      // 3) Metrónomo: dibuja cada frame en su franja (slotMs). drawImage de un
      //    ImageBitmap es ~instantáneo, así que el webm dura exactamente
      //    totalFrames*slotMs = effectiveDuration.
      const startWall = performance.now();
      for (let i = 1; i < preRenderedFrames.length; i++) {
        const wait = startWall + i * slotMs - performance.now();
        if (wait > 0) await sleep(wait);
        if (settled) break;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(preRenderedFrames[i] as CanvasImageSource, 0, 0);
      }
      // Exponer el último frame un slot más antes de parar: que el sampler lo
      // capture y el webm cierre en effectiveDuration.
      const tail = startWall + preRenderedFrames.length * slotMs - performance.now();
      if (tail > 0) await sleep(tail);
      try { recorder?.stop(); } catch {}
    };

    const onLoaded = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      if (settled) return;
      const avail = Math.max(0, video.duration - t0);
      if (avail < 0.25) {
        fail(t('videoEditor.selection.videoEnding'));
        return;
      }
      effectiveDuration = Math.min(dur, avail);
      totalFrames = Math.max(2, Math.round(effectiveDuration * fps));
      // Salvaguarda de memoria: pre-renderizar guarda un ImageBitmap por frame.
      // Para capturas largas (hasta 20 s) limita el nº de frames (reduciendo el
      // fps de grabación); la duración del webm sigue siendo exacta porque
      // slotMs = 1000 / recFps y totalFrames*slotMs = effectiveDuration.
      const MAX_FRAMES = 450;
      if (totalFrames > MAX_FRAMES) {
        const recFps = MAX_FRAMES / effectiveDuration;
        totalFrames = MAX_FRAMES;
        slotMs = Math.max(15, 1000 / recFps);
      }
      void drawLoop();
    };

    const onError = () => fail(t('videoEditor.selection.captureError'));
  });

  // Valida que haya selección + vídeo y devuelve el contexto de captura (ventana
  // de recorte en px nativos, duración). Alerta y devuelve null si algo falla.
  const getSelectionCaptureContext = () => {
    if (!editState.selection?.enabled || !editState.selection.shape) {
      alert(t('videoEditor.selection.activateSelectionFirst'));
      return null;
    }
    const src = getCurrentVideoSource();
    if (!src) {
      alert(t('videoEditor.selection.noVideoLoaded'));
      return null;
    }
    const t0 = currentTimeRef.current;
    const shape = effectiveSelectionShapeForPaint(editState.selection, t0);
    const nativeSize = videoNativeSize ?? previewVideoSize;
    const nativeW = nativeSize.width;
    const nativeH = nativeSize.height;
    if (!nativeW || !nativeH) {
      alert(t('videoEditor.selection.videoSizeUnknown'));
      return null;
    }
    // Un trazo (lazo) vacío y sin silueta (motionPaths/motionMasks) no recorta nada.
    const hasAnyMask =
      shape.type !== 'freehand' ||
      (!!shape.paths && shape.paths.length > 0) ||
      !!effectiveSelectionMotionPaths(editState.selection, t0)?.length ||
      !!editState.selection.shape.motionMasks?.length;
    if (!hasAnyMask) {
      alert(t('videoEditor.selection.emptyLazo'));
      return null;
    }
    const win = selectionCropWindowPx(editState.selection, t0, nativeW, nativeH);
    if (win.width < 2 || win.height < 2) {
      alert(t('videoEditor.selection.selectionEmptyLayer'));
      return null;
    }
    const dur = Math.max(0.5, Math.min(20, Number(selectionVideoDuration) || 3));
    return { src, t0, win, nativeW, nativeH, dur, selection: editState.selection };
  };

  const createSelectionVideoLayer = async () => {
    const captureCtx = getSelectionCaptureContext();
    if (!captureCtx) return;
    const { src, t0, win, nativeW, nativeH, dur, selection } = captureCtx;
    const FPS = 30;

    setIsCapturingSlides(true);
    setCopyProgress({ current: 0, total: Math.max(2, Math.round(Math.min(dur, 20) * FPS)) });
    try {
      const { url, duration } = await captureSelectionVideo(
        src, t0, dur, FPS, selection, win,
        (current, total) => setCopyProgress({ current, total }),
      );
      const assetName = `Selección ${t0.toFixed(1)}s`;
      const asset: OverlayObjectAsset = {
        id: `object-${Date.now()}`,
        name: assetName,
        dataUrl: url,
        mediaType: 'video',
      };
      const clipStart = editState.timeline?.currentTime ?? 0;
      const wPct = (win.width / nativeW) * 100;
      const hPct = (win.height / nativeH) * 100;
      const cxPct = ((win.x + win.width / 2) / nativeW) * 100;
      const cyPct = ((win.y + win.height / 2) / nativeH) * 100;
      const newClip: ObjectClip = {
        id: `selection-video-layer-${Date.now()}`,
        name: assetName,
        assetId: asset.id,
        src: url,
        mediaType: 'video',
        // Centro y tamaño del ventanal de captura (% del vídeo nativo): la capa
        // cubre exactamente la zona seleccionada, sin deformar el aspecto.
        position: { x: cxPct, y: cyPct },
        width: wPct,
        height: hPct,
        startTime: clipStart,
        duration,
        opacity: 100,
        fadeInDuration: 0,
        fadeOutDuration: 0,
        isDeformable: true,
        corners: defaultCorners(),
      };

      // Insertar en la pista de efectos (mismo flujo que createSelectionLayer).
      let effectsTrack2 = editState.timeline?.tracks.find(isEffectsTrack);
      let nextTracks = editState.timeline?.tracks ?? [];
      if (!effectsTrack2) {
        effectsTrack2 = createEffectsTrack();
        nextTracks = placeEffectsTrackBelowMainVideo([...nextTracks, effectsTrack2]);
      }
      const timelineClip: TimelineClip = {
        id: newClip.id,
        trackId: effectsTrack2.id,
        type: 'video',
        overlayKind: 'object',
        startTime: clipStart,
        duration,
        mediaFileId: url,
        thumbnailUrl: url,
        label: `Capa: ${newClip.name}`,
        opacity: 1.0,
        fadeInDuration: 0,
        fadeOutDuration: 0,
        overlayTint: undefined,
      };
      nextTracks = nextTracks.map((tr) =>
        tr.id === effectsTrack2!.id
          ? { ...tr, clips: [...tr.clips.filter((cl) => cl.id !== newClip.id), timelineClip] }
          : tr
      );
      saveToHistory({
        ...editState,
        objectClips: [...(editState.objectClips || []), newClip],
        timeline: { ...editState.timeline!, tracks: nextTracks } as TimelineState,
      });
      setSelectedObjectId(newClip.id);
      toast({
        title: t('videoEditor.selection.videoLayerCreated'),
        description: t('videoEditor.selection.videoLayerCreatedDesc', { duration: duration.toFixed(1) }),
      });
    } catch (err) {
      console.error(err);
      alert(t('videoEditor.selection.videoLayerError'));
    } finally {
      setIsCapturingSlides(false);
      setCopyProgress(null);
    }
  };

  // Descarga la zona seleccionada en movimiento como archivo .webm (sin crear capa).
  const saveSelectionVideoAsWebm = async () => {
    const captureCtx = getSelectionCaptureContext();
    if (!captureCtx) return;
    const { src, t0, win, dur, selection } = captureCtx;
    const FPS = 30;

    setIsCapturingSlides(true);
    setCopyProgress({ current: 0, total: Math.max(2, Math.round(Math.min(dur, 20) * FPS)) });
    try {
      const { url, duration } = await captureSelectionVideo(
        src, t0, dur, FPS, selection, win,
        (current, total) => setCopyProgress({ current, total }),
      );
      // Descargar el webm
      const a = document.createElement('a');
      a.href = url;
      a.download = 'selection-' + Date.now() + '.webm';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast({ title: t('videoEditor.selection.videoDownloaded'), description: t('videoEditor.selection.videoDownloadedDesc', { duration: duration.toFixed(1) }) });
    } catch (err) {
      console.error(err);
      alert(t('videoEditor.selection.videoExportError'));
    } finally {
      setIsCapturingSlides(false);
      setCopyProgress(null);
    }
  };

  // ---- Vídeo superpuesto (overlay a pantalla completa) ----
  // Funciones planas (sin useCallback) para no añadir hooks en medio del
  // componente y evitar problemas de orden de hooks con HMR/Fast Refresh.
  const handleAddVideoOverlay = async (file: File) => {
    // En Electron los File de <input> exponen la ruta absoluta en .path → media://
    // persiste al guardar el .zeus. Si no hay path (web), usamos un blob URL.
    const fp = (file as any).path as string | undefined;
    const fileUrl = fp ? getMediaUrl(fp) : URL.createObjectURL(file);
    const url = resolveUrl(fileUrl);
    let duration = 0;
    try {
      duration = (await loadVideoMetadata(url)).duration;
    } catch {
      duration = 0;
    }
    saveToHistory({
      ...editState,
      videoOverlay: {
        id: `overlay-video-${Date.now()}`,
        src: fileUrl,
        sourceDuration: isFinite(duration) && duration > 0 ? duration : 0,
        opacity: 100,
        zoom: 1,
        seekOffset: 0,
      },
    });
    setOverlayPlaying(false);
    setOverlayCurrentTime(0);
  };

  const handleRemoveVideoOverlay = () => {
    const v = overlayVideoRef.current;
    if (v) { v.pause(); }
    saveToHistory({ ...editState, videoOverlay: null });
    setOverlayPlaying(false);
    setOverlayCurrentTime(0);
  };

  const handleUpdateVideoOverlay = (updates: Partial<VideoOverlay>) => {
    setEditState((prev) =>
      prev.videoOverlay ? { ...prev, videoOverlay: { ...prev.videoOverlay, ...updates } } : prev
    );
  };

  const toggleOverlayPlay = () => {
    const v = overlayVideoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  };

  const handleOverlaySeek = (t: number) => {
    const v = overlayVideoRef.current;
    if (v) {
      try { v.currentTime = t; } catch {}
    }
    setOverlayCurrentTime(t);
    handleUpdateVideoOverlay({ seekOffset: t });
  };

  const handleUpdateObjectClip = (id: string, updates: Partial<ObjectClip>) => {
    const nextObjectClips = (editState.objectClips || []).map((clip) =>
      clip.id === id ? { ...clip, ...updates } : clip
    );

    if (!editState.timeline) {
      saveToHistory({ ...editState, objectClips: nextObjectClips });
      return;
    }

    const effectsTrack = editState.timeline.tracks.find(isEffectsTrack);
    const clipInTrack = effectsTrack?.clips.find((clip) => clip.id === id);
    const updatedTrackClip = clipInTrack
      ? {
        ...clipInTrack,
        startTime: updates.startTime ?? clipInTrack.startTime,
        duration: updates.duration ?? clipInTrack.duration,
        opacity: updates.opacity !== undefined ? updates.opacity / 100 : clipInTrack.opacity,
        mirrored: updates.mirrored ?? clipInTrack.mirrored,
        label: updates.name ? `Objeto: ${updates.name}` : clipInTrack.label,
      }
      : null;

    saveToHistory({
      ...editState,
      objectClips: nextObjectClips,
      timeline: updatedTrackClip && effectsTrack
        ? {
          ...editState.timeline,
          tracks: editState.timeline.tracks.map((track) =>
            track.id === effectsTrack.id
              ? { ...track, clips: track.clips.map((clip) => (clip.id === id ? updatedTrackClip : clip)) }
              : track
          ),
        }
        : editState.timeline,
    });
  };

  const handleDeleteObjectClip = (id: string) => {
    saveToHistory({
      ...editState,
      objectClips: (editState.objectClips || []).filter((clip) => clip.id !== id),
      timeline: editState.timeline
        ? {
          ...editState.timeline,
          tracks: editState.timeline.tracks.map((track) =>
            isEffectsTrack(track)
              ? { ...track, clips: track.clips.filter((clip) => clip.id !== id) }
              : track
          ),
        }
        : editState.timeline,
    });
    if (selectedObjectId === id) setSelectedObjectId(null);
  };

  // Cambia la capa (z-order) de un objeto: el orden del array objectClips define
  // qué objeto se dibuja encima (los últimos van delante), tanto en el preview
  // como en el export (resolvedObjectClips / scene-builder).
  const handleMoveObjectLayer = (id: string, dir: 'front' | 'back' | 'forward' | 'backward') => {
    const clips = [...(editState.objectClips || [])];
    const idx = clips.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const [item] = clips.splice(idx, 1);
    let target = idx;
    if (dir === 'front') {
      clips.push(item);
      target = clips.length - 1;
    } else if (dir === 'back') {
      clips.unshift(item);
      target = 0;
    } else if (dir === 'forward') {
      target = Math.min(idx + 1, clips.length);
      clips.splice(target, 0, item);
    } else {
      target = Math.max(idx - 1, 0);
      clips.splice(target, 0, item);
    }
    if (target === idx) return; // ya estaba al frente/fondo: sin cambio
    saveToHistory({ ...editState, objectClips: clips });
  };

  // ── Copiar / Pegar la zona seleccionada del vídeo ──
  // Copiar: captura el frame actual del preview, lo recorta con la máscara de la
  // selección (SAM2/varita raster o trazo/rect/círculo vectorial, respetando el
  // alcance dentro/fuera) y guarda el PNG recortado. Pegar: lo añade como objeto.
  const loadImageElement = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
      img.src = src;
    });

  const handleCopySelection = async () => {
    const sel = editState.selection;
    if (!sel?.enabled || !sel.shape) {
      toast({ title: t('videoEditor.selection.selectFirst'), description: t('videoEditor.selection.selectFirstDesc') });
      return;
    }
    const previewCanvas = previewCanvasRef.current;
    const video = videoRef.current;
    const useCanvas = previewCanvas && previewCanvas.width > 0 && previewCanvas.height > 0;
    const source: HTMLCanvasElement | HTMLVideoElement | null = useCanvas ? previewCanvas : (video && video.videoWidth ? video : null);
    if (!source) {
      toast({ title: t('videoEditor.selection.noFrame'), description: t('videoEditor.selection.noFrameDesc') });
      return;
    }
    const w = (source as any).videoWidth || (source as any).width;
    const h = (source as any).videoHeight || (source as any).height;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { toast({ title: t('videoEditor.selection.canvasError') }); return; }
      ctx.drawImage(source as any, 0, 0, w, h);
      const time = editState.timeline?.currentTime || 0;
      const inside = sel.scope !== 'outside';
      // 1) Máscara raster (SAM2 / varita mágica): recorta con la imagen de la máscara.
      const maskUrl = effectiveSelectionMaskUrl(sel, time);
      if (maskUrl) {
        const maskImg = await loadImageElement(maskUrl);
        ctx.globalCompositeOperation = inside ? 'destination-in' : 'destination-out';
        ctx.drawImage(maskImg, 0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        // 2) Forma vectorial: trazo / rectángulo / círculo. Se usa la forma en el
        //    instante actual (respeta keyframes de seguimiento). El frame ya está
        //    dibujado completo (paso 1): con destination-in se conserva SOLO lo que
        //    cae dentro del path, y con destination-out solo lo que queda fuera.
        //    (ctx.clip() sin redibujar no borra nada — ese era el bug: se pegaba
        //    todo el vídeo en vez de solo la zona.)
        const shapeAtTime = effectiveSelectionShapeForPaint(sel, time);
        const path = buildSelectionPath(shapeAtTime, 0, 0, w, h);
        ctx.save();
        ctx.globalCompositeOperation = inside ? 'destination-in' : 'destination-out';
        ctx.fill(path);
        ctx.restore();
      }
      // 3) Recortar al cuadro del contenido (sin márgenes transparentes).
      const imgData = ctx.getImageData(0, 0, w, h).data;
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (imgData[(y * w + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) {
        toast({ title: t('videoEditor.selection.selectionEmpty'), description: t('videoEditor.selection.selectionEmptyDesc') });
        return;
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const crop = document.createElement('canvas');
      crop.width = bw;
      crop.height = bh;
      crop.getContext('2d')!.drawImage(canvas, minX, minY, bw, bh, 0, 0, bw, bh);
      setCopiedZoneDataUrl(crop.toDataURL('image/png'));
      toast({ title: t('videoEditor.selection.zoneCopied'), description: t('videoEditor.selection.zoneCopiedDesc') });
    } catch (e) {
      console.error('Error copiando la selección:', e);
      toast({ title: t('videoEditor.selection.copyFailed'), description: t('videoEditor.selection.copyFailedDesc') });
    }
  };

  const handlePasteSelection = async () => {
    if (!copiedZoneDataUrl) {
      toast({ title: t('videoEditor.selection.nothingToPaste'), description: t('videoEditor.selection.nothingToPasteDesc') });
      return;
    }
    const asset: OverlayObjectAsset = {
      id: `pasted-${Date.now()}`,
      name: 'Zona copiada',
      dataUrl: copiedZoneDataUrl,
      mediaType: 'png',
    };
    await handleAddObjectClip(asset, true);
    toast({ title: t('videoEditor.selection.zonePasted'), description: t('videoEditor.selection.zonePastedDesc') });
  };

  // ── Edición de instantes (keyframes) de ObjectClip desde la pestaña Punto de vértice ──
  const startEditKeyframeLocal = (clip: ObjectClip, kf: ObjectKeyframe) => {
    setEditingKfId(kf.id);
    setKfSnapshot({ ...kf });
    setKfIsNew(false);
    handleTimelineTimeUpdate(clip.startTime + kf.time);
  };

  const cancelEditingLocal = () => {
    if (editingKfId && !kfIsNew && kfSnapshot) {
      const clip = resolvedObjectClips.find((c) => c.keyframes?.some((k) => k.id === editingKfId));
      if (clip) {
        updateKeyframeLocal(clip.id, editingKfId, { ...kfSnapshot });
      }
    }
    setEditingKfId(null);
    setKfSnapshot(null);
    setKfIsNew(false);
  };

  const finishEditingLocal = () => {
    setEditingKfId(null);
    setKfSnapshot(null);
    setKfIsNew(false);
  };

  const updateKeyframeLocal = (clipId: string, kfId: string, updates: Partial<ObjectKeyframe>) => {
    const clip = resolvedObjectClips.find((c) => c.id === clipId);
    if (!clip || !clip.keyframes) return;
    const nextKeyframes = clip.keyframes.map((k) =>
      k.id === kfId ? { ...k, ...updates } : k
    );
    handleUpdateObjectClip(clipId, { keyframes: nextKeyframes });
  };

  const deleteKeyframeLocal = (clipId: string, kfId: string) => {
    const clip = resolvedObjectClips.find((c) => c.id === clipId);
    if (!clip || !clip.keyframes) return;
    const nextKeyframes = clip.keyframes.filter((k) => k.id !== kfId);
    handleUpdateObjectClip(clipId, { keyframes: nextKeyframes });
    if (editingKfId === kfId) {
      setEditingKfId(null);
      setKfSnapshot(null);
      setKfIsNew(false);
    }
  };

  const updateKeyframeCornerLocal = (clipId: string, kfId: string, cornerIdx: number, field: 'x' | 'y', value: number) => {
    const clip = resolvedObjectClips.find((c) => c.id === clipId);
    if (!clip || !clip.keyframes) return;
    const kf = clip.keyframes.find((k) => k.id === kfId);
    if (!kf || !kf.corners || kf.corners.length !== 4) return;
    const nextCorners = [...kf.corners];
    nextCorners[cornerIdx] = { ...nextCorners[cornerIdx], [field]: value };
    updateKeyframeLocal(clipId, kfId, { corners: nextCorners });
  };

   // Usa el tracker local (ZSAD) o SAM2 (IA vía ComfyUI) para interpolar los 4
   // vértices desde la primera marca a través de todos los frames. El motor se elige
   // como en la pestaña Objetos: SAM2 sigue el contorno real del objeto (requiere el
   // workflow SAM2 cargado e instancias en marcha); el tracker local por patrón
   // funciona offline en el navegador.
   // Para cada frame, transformLazoForFrame deforma el cuadrilátero inicial (4 vértices)
   // según el movimiento (centro/escala/rotación) devuelto por el tracker, creando
   // instantes intermedios desde la primera marca hasta el final del clip. Los instantes
   // se añaden a vertexInstants y se guardan en localStorage + proyecto.
    const trackVertexBetweenMarks = async (instantIds: string[], onProgress?: (p: number, msg: string) => void) => {
      const validInstants = vertexInstants
        .filter((iv) => instantIds.includes(iv.id) && iv.vertices.filter((v) => v !== null).length === 4)
        .sort((a, b) => a.time - b.time);
      if (validInstants.length === 0) {
        onProgress?.(0, 'Selecciona al menos un instante con 4 vértices.');
        return;
      }

      const videoUrl = getCurrentVideoSource();
      if (!videoUrl) {
        onProgress?.(0, 'No hay vídeo cargado.');
        return;
      }
      const nativeSize = videoNativeSize ?? previewVideoSize;
      if (!nativeSize?.width || !nativeSize?.height) {
        onProgress?.(0, 'El vídeo aún no tiene tamaño conocido.');
        return;
      }

      const W = nativeSize.width;
      const H = nativeSize.height;
      const fps = 30;
      const stageW = previewStageRef.current?.clientWidth || previewVideoSize.width || W;
      const stageH = previewStageRef.current?.clientHeight || previewVideoSize.height || H;
      const ratio = stageW / W;

      // Primer marca = punto de partida del tracking (las marcas adicionales definen el límite final)
      const markA = validInstants[0];
      const lastMark = validInstants[validInstants.length - 1];

      // Calcular el tiempo final: hasta la última marca si hay varias, o hasta el fin del clip si hay una sola
      const clipInfo = getActiveVideoInfo(markA.time);
      const clipEnd = clipInfo ? (clipInfo.clip.startTime + clipInfo.clip.duration) : markA.time + 10;
      const endTime = validInstants.length > 1 ? lastMark.time : clipEnd;

      // Convertir los 4 vértices del primer mark a px del video, bbox, centro y %
      const vertsA = markA.vertices as Array<{ x: number; y: number }>;
      const PpxA = vertsA.map((v) => ({ x: vertexCaptureArea.x + v.x, y: vertexCaptureArea.y + v.y }));
      const PvideoA = PpxA.map((p) => ({ x: p.x / ratio, y: p.y / ratio }));
      const PpctA = PvideoA.map((p) => ({ x: (p.x / W) * 100, y: (p.y / H) * 100 }));
      const minX = Math.min(...PvideoA.map((p) => p.x));
      const maxX = Math.max(...PvideoA.map((p) => p.x));
      const minY = Math.min(...PvideoA.map((p) => p.y));
      const maxY = Math.max(...PvideoA.map((p) => p.y));
      const cxA = (minX + maxX) / 2;
      const cyA = (minY + maxY) / 2;
      const bboxA = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

      // Región (bbox en %) y lazo (4 vértices en %) para SAM2
      const region: TrackingRegion = {
        x: (minX / W) * 100,
        y: (minY / H) * 100,
        width: ((maxX - minX) / W) * 100,
        height: ((maxY - minY) / H) * 100,
      };
      const lazoPath: BezierAnchor[] = PpctA.map((p) => ({ x: p.x, y: p.y, hInX: p.x, hInY: p.y, hOutX: p.x, hOutY: p.y }));

      const sam2ReadyVertex = !!sam2WorkflowJson
        && !!sam2VideoNode.trim()
        && !!sam2PointsNode.trim()
        && !!ltxServerStatus.comfyui
        && !!ltxServerStatus.fluxBridge;

      const newInstants: typeof vertexInstants = [];
      const frameStep = Math.max(1, vertexSampleFps);
      let trackingData: TrackingData | null = null;
      let useSam2 = vertexTrackEngine === 'sam2' && sam2ReadyVertex;

      try {
        if (useSam2) {
          // SAM2 (IA vía ComfyUI): igual que "Trackear movimiento" en la pestaña Objetos.
          // Pasamos markA.time como timeOverride para que runSam2Tracking use el clip
          // activo en ese instante y aplique el prompt SAM2 en el frame correcto.
          onProgress?.(0, 'SAM2: segmentando objeto con IA...');
          trackingData = await runSam2Tracking(region, lazoPath, (p) => {
            onProgress?.(p, 'SAM2 segmentando...');
          }, markA.time);
        } else if (vertexTrackEngine === 'pattern') {
          // Tracker local por patrón (ZSAD): offline, sin servidor ni IA.
          // Igual que el tracker local de la pestaña Objetos, pero con startTime en el primer mark.
          const resolvedVideoUrl = resolveUrl(videoUrl);
          const srcOsPath = urlToOsPath(resolvedVideoUrl);
          if (srcOsPath) {
            const trackDuration = Math.max(0.1, endTime - markA.time);
            const raw = await trackPattern({
              videoUrl: resolvedVideoUrl,
              videoWidth: W,
              videoHeight: H,
              initialBbox: bboxA,
              fps,
              startTime: markA.time,
              duration: trackDuration,
              onProgress: (_p: number) => {
                onProgress?.(_p, `Tracking local...`);
              },
            });
            trackingData = smoothTrackingData(raw, 3);
            trackingData.initial_lazo_path = PpctA;
          } else {
            onProgress?.(0, 'El tracker local requiere el video como archivo local.');
            return;
          }
        } else {
          // SAM2 solicitado pero no disponible: caer al tracker local si es posible
          onProgress?.(0, 'SAM2 no disponible. Cambiando al tracker local.');
          const resolvedVideoUrl = resolveUrl(videoUrl);
          const srcOsPath = urlToOsPath(resolvedVideoUrl);
          if (srcOsPath) {
            const trackDuration = Math.max(0.1, endTime - markA.time);
            const raw = await trackPattern({
              videoUrl: resolvedVideoUrl,
              videoWidth: W,
              videoHeight: H,
              initialBbox: bboxA,
              fps,
              startTime: markA.time,
              duration: trackDuration,
              onProgress: (_p: number) => {
                onProgress?.(_p, `Tracking local...`);
              },
            });
            trackingData = smoothTrackingData(raw, 3);
            trackingData.initial_lazo_path = PpctA;
          } else {
            onProgress?.(0, 'No se pudo resolver el video local para el tracking.');
            return;
          }
        }
      } catch (e) {
        console.error('Error en tracking de vértices:', e);
        onProgress?.(0, `Error: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }

      if (!trackingData || !trackingData.centers || trackingData.centers.length === 0) {
        onProgress?.(0, 'El tracking no devolvió datos.');
        return;
      }

      const centers = trackingData.centers;
      const scales = trackingData.scales;
      const rotations = trackingData.rotations;

      // Para SAM2, los datos cubren el clip completo (frame 0 = inicio del clip en el archivo).
      // Calcular el offset del primer mark dentro del clip.
      // Para el tracker local, los datos empiezan en markA.time (frame 0 = markA.time).
      let frameOffset = 0;
      let clipStart = markA.time;
      if (useSam2 && clipInfo) {
        clipStart = clipInfo.clip.startTime;
        frameOffset = Math.floor((markA.time - clipInfo.clip.startTime) * fps);
      }

      const c0 = (centers[frameOffset] || centers[0] || [cxA, cyA]) as [number, number];
      const s0 = scales?.[frameOffset] ?? scales?.[0] ?? 1;

      for (let k = frameOffset; k < centers.length; k += frameStep) {
        let t: number;
        if (useSam2) {
          t = clipStart + k / fps;
        } else {
          const frameNumber = (trackingData.frames && Number.isFinite(trackingData.frames[k])) ? trackingData.frames[k] : k;
          t = markA.time + frameNumber / fps;
        }
        if (t < markA.time - 0.01) continue;
        if (t > endTime + 0.01) continue;

        const cxK = centers[k];
        const scaleRel = (scales?.[k] ?? s0) / s0;
        const rotDeg = rotations?.[k] ?? 0;

        const PpctK = transformLazoForFrame(
          PpctA,
          [c0[0], c0[1]],
          [cxK[0], cxK[1]],
          scaleRel,
          W, H,
          scaleRel, scaleRel,
          rotDeg
        );

        if (PpctK.length === 4) {
          const Ppx = PpctK.map((p) => ({ x: (p.x / 100) * stageW - vertexCaptureArea.x, y: (p.y / 100) * stageH - vertexCaptureArea.y }));
          const inRange = Ppx.every((p) => p.x >= -300 && p.x <= stageW + 300 && p.y >= -300 && p.y <= stageH + 300);
          if (inRange) {
            const frac = endTime > markA.time ? Math.min(1, Math.max(0, (t - markA.time) / (endTime - markA.time))) : 1;
            const lerp = (a: number, b: number) => a + (b - a) * frac;
            newInstants.push({
              id: `trk-${markA.id}-f${k}`,
              time: t,
              vertices: Ppx.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) as Array<{ x: number; y: number }>,
              width: lerp(markA.width, lastMark.width),
              height: lerp(markA.height, lastMark.height),
              opacity: lerp(markA.opacity, lastMark.opacity),
            });
          }
        }
      }

      if (newInstants.length > 0) {
        setVertexInstants((prev) => {
          const filtered = prev.filter((iv) => !instantIds.includes(iv.id) || validInstants.some((m) => m.id === iv.id));
          const combined = [...filtered, ...newInstants].sort((a, b) => a.time - b.time);
          if (typeof window !== 'undefined') {
            localStorage.setItem('zeus-vertex-instants', JSON.stringify(combined));
          }
          return combined;
        });
        toast({ title: 'Tracking de vértices', description: `${newInstants.length} instantes intermedios creados desde el primer frame.` });
      } else {
        toast({ title: 'Tracking fallido', description: 'No se pudieron generar instantes intermedios.', variant: 'destructive' });
      }
    };

   // Aplica los instantes de vértice marcados a un objeto: crea instantes
   // (keyframes) con `corners` (4 vértices en ±50) para que el objeto se deforme
   // (perspectiva) encajando en los 4 vértices de cada instante marcado y se
   // anime entre ellos. La caja del objeto toma el ASPECTO de la imagen para que
   // las 4 esquinas de la imagen caigan exactas en los 4 vértices.
   const applyVertexInstantsToObject = async (objectId: string, instantIds: string[]) => {
     const clip = resolvedObjectClips.find((c) => c.id === objectId);
     if (!clip) {
       toast({ title: 'Sin objeto', description: 'Selecciona un objeto de la lista.', variant: 'destructive' });
       return;
     }
     const instants = vertexInstants
      .filter((iv) => instantIds.includes(iv.id) && iv.vertices.filter((v) => v !== null).length === 4)
      .sort((a, b) => a.time - b.time);
    if (instants.length === 0) {
      toast({ title: 'Sin instantes válidos', description: 'Marca instantes que tengan los 4 vértices capturados.', variant: 'destructive' });
      return;
    }

    // Tamaño del stage (px de layout, sin zoom). Fallback a previewVideoSize.
    const stageW = previewStageRef.current?.clientWidth || previewVideoSize.width || 0;
    const stageH = previewStageRef.current?.clientHeight || previewVideoSize.height || 0;
    if (!stageW || !stageH) {
      toast({ title: 'No se pudo medir el preview', variant: 'destructive' });
      return;
    }

    // Aspecto de la imagen (la <img> renderiza a w-full h-auto → alto = ancho/aspecto;
    // la homografía del ObjectOverlay usa H = alto de la caja; para que las 4
    // esquinas de la imagen caigan EXACTO en los vértices, la caja debe tener el
    // aspecto de la imagen).
    const aspect = await loadObjectAspect(clip.src);

    // Ampliación del clip para cubrir los tiempos absolutos de los instantes.
    const minT = instants[0].time;
    const maxT = instants[instants.length - 1].time;
    const curStart = clip.startTime;
    const curEnd = clip.startTime + clip.duration;
    const newStartTime = Math.max(0, Math.min(curStart, minT));
    const newEnd = Math.max(curEnd, maxT);
    const newDuration = Math.max(0.1, newEnd - newStartTime);
    const shift = curStart - newStartTime; // ≥0: el inicio se movió hacia atrás

    // Keyframes existentes desplazados (su tiempo es LOCAL al clip → al mover el
    // inicio deben aumentar en `shift` para quedarse en el mismo instante absoluto).
    let nextKfs: ObjectKeyframe[] = (clip.keyframes || []).map((k) => ({
      ...k,
      time: Math.max(0, k.time + shift),
    }));

    // Helper: a partir de 4 vértices en px del stage → keyframe con corners (±50)
    // y caja con el ASPECTO de la imagen que contiene el quad (la homografía
    // mapea las 4 esquinas de la imagen exactamente a los 4 vértices).
    const keyframeFromQuad = (
      Ppx: { x: number; y: number }[],
      localT: number,
      opacity: number,
      idSuffix: string,
    ): { kf: ObjectKeyframe; corners: { x: number; y: number }[] } => {
      const minX = Math.min(...Ppx.map((p) => p.x));
      const maxX = Math.max(...Ppx.map((p) => p.x));
      const minY = Math.min(...Ppx.map((p) => p.y));
      const maxY = Math.max(...Ppx.map((p) => p.y));
      const aabbW = maxX - minX;
      const aabbH = maxY - minY;
      const wPx = Math.max(aabbW, aabbH * aspect);
      const hPx = wPx / aspect;
      const cxPx = (minX + maxX) / 2; // centro del quad = centro de la caja
      const cyPx = (minY + maxY) / 2;
      const boxLeft = cxPx - wPx / 2;
      const boxTop = cyPx - hPx / 2;
      const corners = aabbW < 1 || aabbH < 1
        ? defaultCorners() // degenerado: sin warp
        : Ppx.map((p) => ({
            x: ((p.x - boxLeft) / wPx) * 100 - 50,
            y: ((p.y - boxTop) / hPx) * 100 - 50,
          }));
      const kf: ObjectKeyframe = {
        id: `vf-${clip.id}-${idSuffix}`,
        time: localT,
        x: (cxPx / stageW) * 100,
        y: (cyPx / stageH) * 100,
        width: (wPx / stageW) * 100,
        height: (hPx / stageH) * 100,
        opacity,
        corners,
      };
      return { kf, corners };
    };

    // Marcas sparse: 4 vértices en px del stage (relativos a vertexCaptureArea →
    // absoluto stage) + tiempo local + opacidad.
    const marks = instants.map((instant) => {
      const verts = instant.vertices as Array<{ x: number; y: number } | null>;
      const Ppx = verts.map((v) => ({ x: vertexCaptureArea.x + v!.x, y: vertexCaptureArea.y + v!.y }));
      const localT = Math.max(0, Math.min(newDuration, instant.time - newStartTime));
      return { id: instant.id, time: localT, opacity: instant.opacity, Ppx };
    });

    let baseCorners = defaultCorners();
    let baseX = clip.position.x, baseY = clip.position.y;
    let baseW = clip.width, baseH = clip.height;

    // Pre-calcular los keyframes de cada marca (4 vértices → keyframe con corners ±50).
    const markKfs: Array<{ kf: ObjectKeyframe; corners: { x: number; y: number }[]; time: number; opacity: number }> = marks.map((m) => {
      const { kf, corners } = keyframeFromQuad(m.Ppx, m.time, m.opacity, m.id);
      return { kf, corners, time: m.time, opacity: m.opacity };
    });
    if (markKfs.length > 0) {
      baseCorners = markKfs[0].corners;
      baseX = markKfs[0].kf.x; baseY = markKfs[0].kf.y;
      baseW = markKfs[0].kf.width; baseH = markKfs[0].kf.height;
    }

    const vertexDenseMode = vertexSampleFps <= 1;
    if (vertexDenseMode && marks.length >= 1) {
      // Generar 1 keyframe cada N frames entre la primera y la última marca,
      // interpolando LOS KEYFRAMES (x, y, w, h, corners ±50, opacity) con un
      // SPLINE CÚBICO MONÓTONO (Fritsch–Carlson) sobre las marcas. Interpolar
      // los valores del keyframe (no los vértices en pantalla) garantiza que
      // cada frame intermedio tenga un quad válido y la caja mantenga el aspecto.
      const fps = 30;
      const frameStep = Math.max(1, vertexSampleFps);
      const dtFrame = frameStep / fps;
      const startLocal = marks[0].time;
      const endLocal = marks[marks.length - 1].time;
      const mTimes = marks.map((m) => m.time);
      // Splines sobre cada corner (×4 vértices × 2 coords = 8) + posición (x,y,w,h) + opacidad.
      const cornerSplines = [0, 1, 2, 3].flatMap((ci) => [
        makeMonotoneCubic(mTimes, markKfs.map((mk) => mk.corners[ci].x)),
        makeMonotoneCubic(mTimes, markKfs.map((mk) => mk.corners[ci].y)),
      ]);
      const posX = makeMonotoneCubic(mTimes, markKfs.map((mk) => mk.kf.x));
      const posY = makeMonotoneCubic(mTimes, markKfs.map((mk) => mk.kf.y));
      const posW = makeMonotoneCubic(mTimes, markKfs.map((mk) => mk.kf.width));
      const posH = makeMonotoneCubic(mTimes, markKfs.map((mk) => mk.kf.height ?? 0));
      const opacitySpline = makeMonotoneCubic(mTimes, markKfs.map((mk) => mk.kf.opacity));
      const dense: ObjectKeyframe[] = [];
      let frameIdx = 0;
      for (let t = startLocal; t <= endLocal + 1e-6; t += dtFrame) {
        const tc = Math.min(t, endLocal);
        const corners = [0, 1, 2, 3].map((ci) => ({
          x: cornerSplines[ci * 2](tc),
          y: cornerSplines[ci * 2 + 1](tc),
        }));
        const height = markKfs[0].kf.height !== undefined ? posH(tc) : undefined;
        const kf: ObjectKeyframe = {
          id: `vf-${clip.id}-f${frameIdx}`,
          time: tc,
          x: posX(tc),
          y: posY(tc),
          width: posW(tc),
          height,
          opacity: opacitySpline(tc),
          corners,
        };
        dense.push(kf);
        frameIdx++;
      }
      // Asegurar la marca final exacta.
      const lastKf = dense[dense.length - 1];
      if (!lastKf || Math.abs(lastKf.time - endLocal) > 1e-3) {
        dense.push(markKfs[markKfs.length - 1].kf);
      }
      // Reemplazamos por completo los keyframes del rango marcado con los densos;
      // conservamos los existentes que queden FUERA del rango [startLocal, endLocal].
      nextKfs = nextKfs.filter((k) => k.time < startLocal - 1e-3 || k.time > endLocal + 1e-3);
      nextKfs = nextKfs.concat(dense);
      toast({
        title: 'Instantes aplicados al objeto',
        description: `${instants.length} marca(s) → ${dense.length} instantes (1 cada ${frameStep} frames @ ${fps}fps, curva suave) · ${clip.name}.`,
      });
    } else {
      // Sparse: upsert de las marcas en los keyframes existentes (desplazados).
      for (let mi = 0; mi < markKfs.length; mi++) {
        const mk = markKfs[mi];
        const existingIdx = nextKfs.findIndex((k) => Math.abs(k.time - mk.time) < 0.05);
        if (existingIdx >= 0) nextKfs[existingIdx] = mk.kf;
        else nextKfs.push(mk.kf);
      }
      toast({
        title: 'Instantes aplicados al objeto',
        description: `${instants.length} instante(s) → ${clip.name}. Se deforma a los 4 vértices y se anima entre ellos.`,
      });
    }

    nextKfs.sort((a, b) => a.time - b.time);

    handleUpdateObjectClip(clip.id, {
      startTime: newStartTime,
      duration: newDuration,
      keyframes: nextKfs,
      isDeformable: true,
      corners: baseCorners,
      position: { x: baseX, y: baseY },
      width: baseW,
      height: baseH,
    });
    setSelectedObjectId(clip.id);
    setLastVertexApply({ count: nextKfs.length, objectName: clip.name, dense: vertexSampleFps <= 1 && marks.length >= 1 });
  };

  const handleSave = () => {
    setIsSaveModalOpen(true);
  };

  const handleExportVideo = () => {
    setShowExportDialog(true);
    // Generar nombre por defecto basado en la fecha y hora actual
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
    setExportFileName(`video_editado_${timestamp}`);
  };

  // Limpiar todo el editor: vacía la línea de tiempo, los efectos, la selección,
  // el crop, los textos/objetos y el historial de deshacer/rehacer. Vuelve al
  // estado inicial (pantalla de bienvenida).
  const handleNewProject = () => {
    try { videoRef.current?.pause(); } catch { /* sin vídeo cargado */ }
    // Proyecto nuevo: libera todos los sinks del videoCache (decoders mediabunny de
    // los clips del proyecto anterior) para no retener memoria al cambiar de proyecto.
    try { videoCache.clearAll(); } catch {}
    setEditState(createDefaultEditState());
    setHistory([]);
    setFuture([]);
    setIsTimelinePlaying(false);
    setPlayerZoom(100);
    setIsHandMode(false);
    setIsDraggingPlayer(false);
    setSelectedObjectId(null);
    setClipboardClip(null);
    setVideoDuration(0);
    setVideoAspectRatio(null);
    setVideoHasError(false);
    setShowSavedMessage(false);
    setCurrentProjectName('');
    setIsUploaderOpen(false);
    setFileNotAllowedMessage(null);
  };

  const startExportProcess = () => {
    if (exportInProgressRef.current) return;
    setShowExportDialog(false);
    performActualExport();
  };

  // Exportación vía scene graph + mediabunny (WebCodecs), frame a frame, determinista
  // y SIN ffmpeg. El crop/objetos/texto/transiciones/filtro/máscara van dentro del scene
  // graph (buildScene). La normalización .zeus y el guardado se reusan del export original.
  const performActualExport = async () => {
    const video = videoRef.current;
    if (!video || exportInProgressRef.current) return;

    exportInProgressRef.current = true;
    setIsExporting(true);
    setExportProgress(0);
    setExportStatus('Iniciando renderizado...');

    const finish = (ok: boolean, message: string, variant: 'default' | 'destructive' = 'default') => {
      setIsExporting(false);
      exportInProgressRef.current = false;
      setExportProgress(100);
      setExportStatus(ok ? 'Exportación completada' : 'Error en la exportación');
      exportCancelRef.current = null;
      // NOTA: no llamamos clearNativeSinks() aquí. Tras revertir el decodeWidth,
      // el preview USA los buckets ::native (mismo decode que el export), así que
      // liberarlos tras exportar tiraría los sinks que el preview sigue usando →
      // re-init asíncrono al volver a reproducir → pantalla negra en muchos vídeos
      // (y si el re-demux falla, failedKeys los marca y quedan negros para siempre).
      // Los sinks son los mismos del preview (no hay duplicación nativa que acumular).
      try { toast({ title: ok ? 'Exportación completada' : 'Error', description: message, variant }); } catch {}
    };

    try {
      // --- Duración y resolución según calidad (igual que el export original) ---
      const currentVidDur = video.duration || videoDuration || 60;
      let trimStart = (editState.trimStart === 0 || editState.trimStart === 60) ? 0 : (editState.trimStart ?? 0);
      let trimEnd = (editState.trimEnd === 0 || editState.trimEnd === 60) ? currentVidDur : (editState.trimEnd ?? currentVidDur);

      let exportW = 1920;
      let exportH = 1080;
      if (exportQuality === 'ultra') {
        exportW = video.videoWidth || 3840;
        exportH = video.videoHeight || 2160;
      } else if (exportQuality === 'high') {
        exportW = 1920; exportH = 1080;
      } else if (exportQuality === 'medium') {
        exportW = 1280; exportH = 720;
      } else {
        exportW = 854; exportH = 480;
      }
      // dims pares para yuv420p (WebCodecs lo exige).
      exportW = Math.round(exportW / 2) * 2;
      exportH = Math.round(exportH / 2) * 2;

      // --- Solapamiento de transiciones: B empieza en windowStart, así el timeline
      // total se acorta en la suma de los solapamientos (esos tramos ya se reproducen
      // durante los fundidos). Igual que el export original.
      let totalTransitionOverlap = 0;
      {
        const vt = editState.timeline?.tracks.find(t => t.type === 'video');
        const sorted = (vt?.clips || []).filter(isPlayableVideoClip).slice().sort((a, b) => a.startTime - b.startTime);
        for (let i = 0; i < sorted.length - 1; i++) {
          const trans = sorted[i].transitionOut;
          if (trans && trans.type !== 'none' && trans.duration > 0) totalTransitionOverlap += trans.duration;
        }
      }
      let maxTimelineEnd = 0;
      editState.timeline?.tracks.forEach(track => {
        track.clips.forEach(clip => {
          let clipEnd = clip.startTime + clip.duration;
          if (clip.id.includes('main-video') || clip.id.includes('main-audio')) {
            clipEnd = clip.startTime + Math.max(0, trimEnd - trimStart);
          }
          maxTimelineEnd = Math.max(maxTimelineEnd, clipEnd);
        });
      });
      // trimStart original (antes de mutar a 0) para el mapeo fuente del clip principal:
      // mapClipLocalToSource(main, clipLocal, trimStart) usa sourceStartTime ?? trimStart,
      // así que la escena debe llevar el trimStart real para que el vídeo arranque desde
      // el recorte y no desde 0. La mutación trimStart=0 sólo sirve para la duración/
      // normalización .zeus (igual que el export original usaba trimStartLocal aparte).
      const origTrimStart = trimStart;
      if (maxTimelineEnd > 0) {
        trimStart = 0;
        trimEnd = Math.max(0.1, maxTimelineEnd - totalTransitionOverlap);
      }
      const exportDuration = Math.max(0.1, trimEnd - trimStart);

      // --- Construir la escena ---
      const mainVideoUrl = resolveUrl(videoUrl);
      const mainVideoSize = (video.videoWidth && video.videoHeight)
        ? { width: video.videoWidth, height: video.videoHeight }
        : null;
      // trimStart=origTrimStart (mapeo fuente del main) y trimEnd=origTrimStart+exportDuration
      // para que clipEffectiveEnd(main) = startTime + (trimEnd-trimStart) = exportDuration.
      const sceneEditState: VideoEditState = { ...editState, trimStart: origTrimStart, trimEnd: origTrimStart + exportDuration };
      const scene = buildScene(sceneEditState, {
        isPreview: false,
        canvasSize: { width: exportW, height: exportH },
        duration: exportDuration,
        mainVideoUrl,
        resolveUrl,
        mainVideoSize,
         overlays: [...visibleDeformableObjectClips, ...visibleNormalObjectClips, ...resolvedEffectClips] as ObjectClip[],
        videoOverlay: sceneEditState.videoOverlay ?? null,
        includeOverlays: true,
        // Exportar sólo el lazo/selección con fondo transparente (alpha). El renderer
        // va con alpha:true y el SelectionMaskNode recorta al shape; lo de fuera queda
        // transparente en el WebM/VP9 resultante.
        transparentBackground: exportTransparent,
      });

      // --- Precargar la máscara de pintura antes del bucle ---
      // (PaintNode la lee vía getObjectImage; si no está lista, saltaría los primeros
      //  frames). Capa única: una sola máscara dura todo el vídeo (o el intervalo).
      if (sceneEditState.paint?.enabled && sceneEditState.paint.mask) {
        const img = getObjectImage(sceneEditState.paint.mask);
        if (!isImageReady(img)) {
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          });
        }
      }

      // --- Audio: mezcla de la pista de audio (OfflineAudioContext) ---
      // Se usa sceneEditState (trimStart=origTrimStart) para que el clip main-audio
      // arranque desde el mismo recorte que el vídeo. Devuelve null si no hay clips
      // de audio → export sin pista de audio.
      setExportStatus('Mezclando audio...');
      let audioBuffer: AudioBuffer | null = null;
      try {
        audioBuffer = await buildTimelineAudioBuffer(sceneEditState, exportDuration, {
          resolveUrl,
          mainVideoUrl,
        });
      } catch (e) {
        console.warn('buildTimelineAudioBuffer falló; exportando sin audio:', e);
        audioBuffer = null;
      }

      // --- Exportar con mediabunny (WebCodecs), frame a frame, sin ffmpeg ---
      // Si exportTransparent está activo, MP4/AVC no soporta alpha → se fuerza WebM
      // dentro del SceneExporter y se pasa alpha al renderer + al CanvasSource.
      const format: ExportFormat = (exportTransparent || exportFormat === 'webm') ? 'webm' : 'mp4';
      const quality: ExportQuality = exportQuality === 'ultra' ? 'very_high' : (exportQuality as ExportQuality);
      const exporter = new SceneExporter({
        width: exportW,
        height: exportH,
        fps: 30,
        format,
        quality,
        shouldIncludeAudio: !!audioBuffer,
        audioBuffer: audioBuffer ?? undefined,
        alpha: exportTransparent,
      });
      exportCancelRef.current = () => exporter.cancel();
      const exportState = { error: null as Error | null };
      exporter.on('progress', (p: number) => {
        setExportProgress(p * 100);
        setExportStatus(`Renderizando fotogramas: ${Math.round(p * 100)}%`);
      });
      exporter.on('error', (err: Error) => { exportState.error = err; });

      setExportStatus('Renderizando fotogramas...');
      const buffer = await exporter.export({ rootNode: scene });
      exportCancelRef.current = null;

      if (!buffer) {
        if (exportState.error) {
          console.error('SceneExporter error:', exportState.error);
          finish(false, exportState.error.message || 'Error al renderizar el vídeo', 'destructive');
        } else {
          setIsExporting(false);
          exportInProgressRef.current = false;
          setExportStatus('Exportación cancelada');
        }
        return;
      }

      // --- Guardar el buffer (pipeline de escritorio / fallback web) ---
      const finalFileName = (exportFileName || 'video-editado').trim();
      const ext = format;
      if (buffer.byteLength < 2000) {
        finish(false, 'La exportación no produjo fotogramas (archivo vacío). Prueba con un vídeo de origen distinto o reinicia la app.', 'destructive');
        return;
      }

      const electronAPI: any = typeof window !== 'undefined' ? (window as any).electronAPI : null;
      if (!electronAPI?.fsGetLocalPaths) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([buffer], { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' }));
        a.download = `${finalFileName}.${ext}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        finish(true, `Vídeo ${ext.toUpperCase()} descargado (modo navegador).`);
        return;
      }

      try {
        setExportStatus('Guardando vídeo...');
        const paths = await getLocalPaths();
        const rootPath = paths?.video || paths?.proyectos_video || paths?.proyectos;
        if (!rootPath) throw new Error('Configura la ruta de vídeos o proyectos primero.');
        await ensureDir(rootPath);

        const videoFileName = `${finalFileName}.${ext}`;
        const videoPath = `${rootPath}\\${videoFileName}`;
        await writeFile(videoPath, new Uint8Array(buffer));
        // Sin transcodificación: mediabunny ya produce MP4/WebM en el formato final.

        const videoFolderPath = paths?.video;
        if (videoFolderPath && videoFolderPath !== rootPath) {
          await ensureDir(videoFolderPath);
          try { await copyFile(videoPath, `${videoFolderPath}\\${videoFileName}`); } catch {}
        }

        // Las exportaciones NO generan .zeus: el MP4/WebM ya es el resultado final y se
        // guarda en la carpeta de vídeos. (Antes se escribía además un .zeus normalizado
        // junto al vídeo; el usuario no lo quiere.)

        finish(true, `Vídeo guardado como ${videoFileName} (${ext.toUpperCase()}) en: ${rootPath}`);
      } catch (e: any) {
        console.error('Error guardando vídeo exportado:', e);
        finish(false, e?.message || 'Error al guardar el vídeo exportado', 'destructive');
      }
    } catch (e: any) {
      console.error('Error en exportación:', e);
      finish(false, e?.message || 'Error al exportar', 'destructive');
    }
  };

  const handleSplitClip = (clipId: string, splitTime: number) => {
    if (!editState.timeline) return;

    // No dividir un clip bloqueado individualmente.
    if (editState.timeline.tracks.flatMap(t => t.clips).find(c => c.id === clipId)?.locked) return;

    const trimStart = editState.trimStart ?? 0;
    const trimEnd = editState.trimEnd ?? (videoRef.current?.duration ?? 0);

    setEditState(prev => {
      const timeline = prev.timeline!;
      const newTracks = timeline.tracks.map(track => {
        const clipIndex = track.clips.findIndex(c => c.id === clipId);
        if (clipIndex === -1) return track;

        const clip = track.clips[clipIndex];
        if (clip.linkedGroupId) {
          toast({ title: 'Clip soldado', description: 'No se puede dividir un clip que está unido con otro.', variant: 'destructive' });
          return track;
        }

        // Verificar si el splitTime cae dentro del clip
        if (splitTime <= clip.startTime || splitTime >= clip.startTime + clip.duration) {
          return track;
        }

        const firstPartDuration = splitTime - clip.startTime;
        const secondPartDuration = clip.duration - firstPartDuration;
        const playbackRate = clip.playbackRate ?? 1;

        // Calcular sourceStartTime y sourceDuration para que cada fragmento reproduzca
        // la parte correcta del vídeo original (y funcione al moverlo en el timeline)
        let firstPartSourceStart: number;
        let firstPartSourceDuration: number;
        let secondPartSourceStart: number;
        let secondPartSourceDuration: number;

        if (clip.id.includes('main-video')) {
          // Fragmento del vídeo principal: usamos trimStart/trimEnd como espacio de origen
          firstPartSourceStart = trimStart;
          firstPartSourceDuration = firstPartDuration * playbackRate;
          secondPartSourceStart = trimStart + firstPartSourceDuration;
          secondPartSourceDuration = secondPartDuration * playbackRate;
        } else {
          // Clip de otro archivo: usamos sourceStartTime/sourceDuration del clip
          const baseSourceStart = clip.sourceStartTime ?? 0;
          const baseSourceDuration = (clip.sourceDuration ?? clip.duration) * playbackRate;
          firstPartSourceStart = baseSourceStart;
          firstPartSourceDuration = firstPartDuration * playbackRate;
          secondPartSourceStart = baseSourceStart + firstPartSourceDuration;
          secondPartSourceDuration = secondPartDuration * playbackRate;
        }

        const firstPart: TimelineClip = {
          ...clip,
          id: `${clip.id}-1`,
          duration: firstPartDuration,
          sourceStartTime: firstPartSourceStart,
          sourceDuration: firstPartSourceDuration
        };

        const secondPart: TimelineClip = {
          ...clip,
          id: `${clip.id}-2`,
          startTime: splitTime,
          duration: secondPartDuration,
          sourceStartTime: secondPartSourceStart,
          sourceDuration: secondPartSourceDuration
        };

        const newClips = [...track.clips];
        newClips.splice(clipIndex, 1, firstPart, secondPart);

        return { ...track, clips: newClips };
      });

      return {
        ...prev,
        timeline: { ...timeline, tracks: newTracks }
      };
    });
  };

  const handleStretchZone = (clipId: string, fromLocalSec: number, toLocalSec: number, newDurationSec: number): boolean => {
    if (!editState.timeline) return false;
    // No estirar la zona de un clip bloqueado individualmente.
    if (editState.timeline.tracks.flatMap(t => t.clips).find(c => c.id === clipId)?.locked) return false;
    const timeline = editState.timeline;
    const videoTrack = timeline.tracks.find(t => t.type === 'video');
    if (!videoTrack) return false;
    // Opera sobre el clip seleccionado (identificado por clipId). Antes buscaba
    // CUALQUIER clip que cubriera el rango absoluto [Desde,Hasta] en el timeline, así
    // que si el rango no cabía en un solo clip devolvía false y mostraba "asegúrate de
    // que hay un clip seleccionado" aunque sí lo hubiera. Ahora usamos coordenadas
    // LOCALES al clip (0 = inicio), que es justo lo que esperan los speedZones.
    const clip = videoTrack.clips.find(c => c.id === clipId && isPlayableVideoClip(c));
    if (clip?.linkedGroupId) {
      toast({ title: 'Clip soldado', description: 'No se puede estirar una región que pertenece a un clip unido.', variant: 'destructive' });
      return false;
    }
    if (!clip) return false;

    const zoneStart = Math.max(0, fromLocalSec);
    const zoneEnd = Math.min(clip.duration, toLocalSec);
    if (zoneStart >= zoneEnd || newDurationSec <= 0) return false;
    const speedZone = { startLocal: zoneStart, endLocal: zoneEnd, newDuration: newDurationSec };
    const existingZones = clip.speedZones ?? [];
    const newSpeedZones = [...existingZones, speedZone].sort((a, b) => a.startLocal - b.startLocal);
    const newDuration = clip.duration - (zoneEnd - zoneStart) + newDurationSec;

    const updatedClip: TimelineClip = {
      ...clip,
      duration: newDuration,
      speedZones: newSpeedZones
    };

    setEditState(prev => {
      const tl = prev.timeline!;
      const vt = tl.tracks.find(t => t.type === 'video')!;
      const newClips = vt.clips.map(c => c.id === clip.id ? updatedClip : c);
      const newTracks = tl.tracks.map(t =>
        t.id === videoTrack.id ? { ...t, clips: newClips } : t
      );
      return { ...prev, timeline: { ...tl, tracks: newTracks } };
    });
    return true;
  };

  // --- Recorte de pantalla / zona de exportación ---
  const updateCrop = (partial: Partial<VideoCropState>) => {
    setEditState(prev => {
      const cur = prev.crop ?? { enabled: true, aspect: null, x: 10, y: 10, width: 80, height: 80 };
      return { ...prev, crop: { ...cur, ...partial } };
    });
  };

  const applyCropPreset = (aspect: string | null) => {
    const target = parseCropAspect(aspect);
    const rect = target
      ? defaultCropRectForAspect(target, videoAspectRatio)
      : { x: 10, y: 10, width: 80, height: 80 };
    setEditState(prev => ({
      ...prev,
      crop: { enabled: true, aspect, ...rect },
    }));
  };

  const toggleCropEnabled = () => {
    setEditState(prev => {
      const cur = prev.crop ?? { enabled: false, aspect: null, x: 10, y: 10, width: 80, height: 80 };
      return { ...prev, crop: { ...cur, enabled: !cur.enabled } };
    });
  };

  const resetCrop = () => {
    setEditState(prev => ({
      ...prev,
      crop: { enabled: false, aspect: null, x: 0, y: 0, width: 100, height: 100 },
    }));
  };

  // ---- Selección / máscara de efectos (dentro / fuera) ----
  const defaultSelectionShape = (type: SelectionShape['type']): SelectionShape => {
    // Por defecto 60% de la dimensión menor, centrado
    const w = 60, h = 60;
    const base = { type, x: (100 - w) / 2, y: (100 - h) / 2, width: w, height: h, paths: [] };
    // La varita mágica selecciona por color (flood fill): la forma se rellena al
    // hacer clic sobre el reproductor (handleWandPick). Hasta entonces está vacía.
    if (type === 'wand') return { ...base, motionMasks: [] };
    return base;
  };

  // Campos por defecto del rango temporal (se rellena timeEnd al activar).
  const defaultSelectionTime = (): Pick<VideoSelectionState, 'timeEnabled' | 'timeStart' | 'timeEnd' | 'fadeIn' | 'fadeOut'> => ({
    timeEnabled: false, timeStart: 0, timeEnd: 0, fadeIn: 0, fadeOut: 0,
  });

  const ensureSelection = (prev: VideoEditState): VideoSelectionState => {
    return prev.selection ?? {
      enabled: true,
      shape: defaultSelectionShape('rect'),
      scope: 'inside',
      track: false,
      ...defaultSelectionTime(),
    };
  };

  const updateSelection = (partial: Partial<VideoSelectionState>) => {
    setEditState(prev => ({ ...prev, selection: { ...ensureSelection(prev), ...partial } }));
  };

  const setSelectionShapeType = (type: SelectionShape['type']) => {
    setEditState(prev => {
      const cur = ensureSelection(prev);
      const prevShape = cur.shape;
      // Volver a pulsar "Trazo" (freehand) con un lazo ya dibujado inicia un
      // REDIBUJADO nuevo (paths vacíos → modo dibujo activo) pero NUNCA destruye
      // las siluetas (motionMasks/motionPaths): la máscara la regenera la
      // segmentación posterior (fusionando si "Segunda pasada" está activa).
      // Antes se descartaban siempre, y la máscara "desaparecía" al pulsar Trazo
      // (también con una selección guardada).
      if (type === 'freehand' && prevShape?.type === 'freehand') {
        return { ...prev, selection: { ...cur, enabled: true, shape: { ...prevShape, paths: [] } } };
      }
      // Re-seleccionar la misma herramienta (rect/circle/wand): no-op, no destruye
      // nada (p. ej. la máscara de la varita al volver a pulsar "Varita").
      if (prevShape && prevShape.type === type) return prev;
      // Conservar el bounding box si ya existía y la nueva forma lo usa (rect/circle).
      // La varita (wand) y el trazo (freehand) no conservan caja: empiezan de cero.
      const keepBox = type !== 'freehand' && type !== 'wand' && prevShape && prevShape.type !== 'freehand' && prevShape.type !== 'wand';
      // Segunda pasada SAM2 aditiva / redibujado: al pasar a "Trazo" (lazo) se
      // CONSERVAN las siluetas existentes (motionMasks / motionPaths) vengan de
      // donde vengan (lazo o varita): la segmentación posterior las regenera
      // (reemplazando si no hay "Segunda pasada", fusionando si la hay). El lazo
      // nuevo arranca vacío y el usuario ve la máscara mientras dibuja.
      // Además, con el modo "Segunda pasada: añadir" (sam2Merge) activo las siluetas
      // NUNCA se destruyen al cambiar de herramienta (Varita/Rectángulo/Círculo):
      // son la base que se va a completar. Antes, pulsar "Varita" tras segmentar
      // borraba todas las máscaras (defaultSelectionShape('wand') las ponía a []).
      const mergeProtect = sam2Merge && !!prevShape && (!!prevShape.motionMasks?.length || !!prevShape.motionPaths);
      const keepSilhouette = mergeProtect || (type === 'freehand' && !!prevShape && (!!prevShape.motionMasks?.length || !!prevShape.motionPaths));
      let shape: SelectionShape;
      if (keepBox && !mergeProtect) {
        // Al cambiar de herramienta se descartan las siluetas raster/por-puntos
        // (motionMasks de la varita/SAM2 y motionPaths del lazo por puntos): dependen
        // de la herramienta con la que se generaron y tendrían prioridad sobre la nueva.
        shape = { ...prevShape, type, paths: [], motionMasks: undefined, motionPaths: undefined };
      } else if (keepSilhouette) {
        shape = { ...defaultSelectionShape(type), motionMasks: prevShape.motionMasks, motionPaths: prevShape.motionPaths };
      } else {
        shape = defaultSelectionShape(type);
      }
      return { ...prev, selection: { ...cur, enabled: true, shape } };
    });
  };

  // ---- Varita mágica: selección por color (flood fill) ----
  // Un clic sobre el reproductor (en % del área de vídeo, como SelectionOverlay)
  // captura el frame actual del vídeo fuente a resolución nativa, rellena la región
  // contigua de color similar (tolerancia ± por canal) y la guarda como máscara
  // raster estática (motionMasks con un único frame → aplica a todo el vídeo).
  // Modo según modificador: 'replace' (sin modificador) sustituye la selección,
  // 'add' (Ctrl+clic) une la nueva zona a la máscara existente y 'subtract'
  // (Shift+clic) la resta.
  const handleWandPick = async (xPct: number, yPct: number, mode: 'replace' | 'add' | 'subtract' = 'replace') => {
    const video = videoRef.current;
    if (!video) {
      toast({ title: 'Varita mágica', description: 'No hay vídeo cargado.', variant: 'destructive' });
      return;
    }
    const vw = video.videoWidth || videoNativeSize?.width || previewVideoSize.width;
    const vh = video.videoHeight || videoNativeSize?.height || previewVideoSize.height;
    if (!vw || !vh) {
      toast({ title: 'Varita mágica', description: 'El vídeo aún no tiene un frame decodificado.', variant: 'destructive' });
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    let imageData: ImageData;
    try {
      // El videoRef ya está en el frame del timeline (pausa o reproducción); drawImage
      // captura el frame actual. drawImage puede lanzar si el frame no está listo.
      ctx.drawImage(video, 0, 0, vw, vh);
      imageData = ctx.getImageData(0, 0, vw, vh);
    } catch {
      toast({ title: 'Varita mágica', description: 'No se pudo leer el frame actual (¿vídeo remoto sin CORS?).', variant: 'destructive' });
      return;
    }
    const px = Math.max(0, Math.min(vw - 1, Math.round((xPct / 100) * vw)));
    const py = Math.max(0, Math.min(vh - 1, Math.round((yPct / 100) * vh)));
    const data = imageData.data;
    const startIdx = (py * vw + px) * 4;
    const tR = data[startIdx], tG = data[startIdx + 1], tB = data[startIdx + 2];
    const tol = Math.max(0, Math.min(255, wandTolerance));
    // Flood fill 4-conectado con tolerancia por canal (mismo algoritmo que el bote).
    const out = new ImageData(vw, vh);
    const outData = out.data;
    const seen = new Uint8Array(vw * vh);
    const stack: number[] = [px, py];
    let minX = vw, minY = vh, maxX = -1, maxY = -1;
    let count = 0;
    while (stack.length > 0) {
      const cy = stack.pop()!;
      const cx = stack.pop()!;
      if (cx < 0 || cx >= vw || cy < 0 || cy >= vh) continue;
      const si = cy * vw + cx;
      if (seen[si]) continue;
      seen[si] = 1;
      const idx = si * 4;
      if (
        Math.abs(data[idx] - tR) <= tol &&
        Math.abs(data[idx + 1] - tG) <= tol &&
        Math.abs(data[idx + 2] - tB) <= tol
      ) {
        outData[idx] = 255;
        outData[idx + 1] = 255;
        outData[idx + 2] = 255;
        outData[idx + 3] = 255;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        count++;
        stack.push(cx - 1, cy, cx + 1, cy, cx, cy - 1, cx, cy + 1);
      }
    }
    if (count === 0) {
      toast({ title: 'Varita mágica', description: 'No se encontró ninguna región con esa tolerancia. Prueba a aumentarla.', variant: 'destructive' });
      return;
    }
    ctx.putImageData(out, 0, 0);
    const url = canvas.toDataURL('image/png');
    // Bounding box de la región en % (para la caja del overlay y el guardado).
    const bbox = {
      x: (minX / vw) * 100,
      y: (minY / vh) * 100,
      width: ((maxX - minX + 1) / vw) * 100,
      height: ((maxY - minY + 1) / vh) * 100,
    };

    // Ctrl+clic (add) / Shift+clic (subtract): combina la nueva zona con la
    // máscara existente de la varita en vez de sustituirla. Sin máscara previa
    // (o si el shape no es varita) se comporta como replace.
    if (mode === 'add' || mode === 'subtract') {
      const curShape = editState.selection?.enabled ? editState.selection.shape : null;
      const existing = curShape?.type === 'wand' && curShape.motionMasks?.length ? curShape.motionMasks[0] : null;
      if (existing && curShape) {
        try {
          const oldImg = await loadMaskImage(existing.url);
          const mc = document.createElement('canvas');
          mc.width = oldImg.naturalWidth;
          mc.height = oldImg.naturalHeight;
          const mctx = mc.getContext('2d');
          if (mctx) {
            mctx.drawImage(oldImg, 0, 0);
            mctx.globalCompositeOperation = mode === 'subtract' ? 'destination-out' : 'source-over';
            mctx.drawImage(canvas, 0, 0, mc.width, mc.height);
            mctx.globalCompositeOperation = 'source-over';
            const mergedUrl = mc.toDataURL('image/png');
            const oldBbox = { x: curShape.x, y: curShape.y, width: curShape.width, height: curShape.height };
            // add → unión de cajas; subtract → se conserva la caja anterior.
            const mergedBbox = mode === 'add'
              ? {
                  x: Math.min(oldBbox.x, bbox.x),
                  y: Math.min(oldBbox.y, bbox.y),
                  width: Math.max(oldBbox.x + oldBbox.width, bbox.x + bbox.width) - Math.min(oldBbox.x, bbox.x),
                  height: Math.max(oldBbox.y + oldBbox.height, bbox.y + bbox.height) - Math.min(oldBbox.y, bbox.y),
                }
              : oldBbox;
            const shape: SelectionShape = {
              type: 'wand',
              ...mergedBbox,
              paths: [],
              motionMasks: [{ time: 0, url: mergedUrl }],
            };
            updateSelection({ enabled: true, shape });
            snapshotHistory();
            return;
          }
        } catch (e) {
          console.error('Error al combinar zonas de la varita', e);
          // Cae a replace con la nueva zona.
        }
      }
    }

    const shape: SelectionShape = {
      type: 'wand',
      ...bbox,
      paths: [],
      // Un único frame en t=0 → la máscara estática vale para todo el vídeo
      // (nearestMotionFrame con un frame devuelve siempre éste).
      motionMasks: [{ time: 0, url }],
    };
    updateSelection({ enabled: true, shape });
    snapshotHistory();
  };

  const setSelectionScope = (scope: 'inside' | 'outside') => {
    updateSelection({ scope });
  };

  // Activa el rango temporal y, si timeEnd es 0, lo deja por defecto en la duración del timeline.
  const toggleSelectionTime = (enabled: boolean) => {
    setEditState(prev => {
      const cur = ensureSelection(prev);
      let timeStart = cur.timeStart ?? 0;
      let timeEnd = cur.timeEnd ?? 0;
      if (enabled && (!timeEnd || timeEnd <= timeStart)) {
        const dur = prev.timeline?.duration ?? 0;
        // Si la duración aún no se conoce, al menos un rango mínimo de 1s para
        // que el efecto se vea en el primer segundo (nunca un rango vacío).
        timeEnd = dur > timeStart ? dur : timeStart + 1;
      }
      return { ...prev, selection: { ...cur, timeEnabled: enabled, timeStart, timeEnd } };
    });
  };

  const setSelectionTime = (field: 'timeStart' | 'timeEnd', value: number) => {
    setEditState(prev => {
      const cur = ensureSelection(prev);
      const dur = prev.timeline?.duration ?? 0;
      let timeStart = Math.max(0, cur.timeStart ?? 0);
      let timeEnd = Math.max(0, cur.timeEnd ?? 0);
      if (field === 'timeStart') {
        timeStart = Math.max(0, value);
        // El rango nunca puede quedar vacío/invertido: si Hasta <= Desde, se empuja
        // Hasta a > Desde (duración del timeline o 1s). Antes un rango vacío
        // (p.ej. timeEnd=0 con timeStart=5) hacía que el efecto NO se viera en
        // ninguna parte y parecía que "el rango no funcionaba".
        if (timeEnd <= timeStart) timeEnd = dur > timeStart ? dur : timeStart + 1;
      } else {
        timeEnd = Math.max(0, value);
        if (timeEnd <= timeStart) timeStart = Math.max(0, timeEnd - 1);
      }
      return { ...prev, selection: { ...cur, timeStart, timeEnd } };
    });
  };

  const setSelectionFade = (field: 'fadeIn' | 'fadeOut', value: number) => {
    const v = isFinite(value) && value >= 0 ? value : 0;
    setEditState(prev => ({ ...prev, selection: { ...ensureSelection(prev), [field]: v } }));
  };

  const saveSelectionToFile = async () => {
    const selection = editState.selection;
    if (!selection?.enabled) {
      toast({ title: t('videoEditor.selection.noActiveSelection'), description: t('videoEditor.selection.noActiveSelectionDesc'), variant: 'destructive' });
      return;
    }
    const paths = await getLocalPaths();
    const root = paths?.mascaras_seleccion || paths?.mascaras || paths?.video || '';
    if (!root) {
      toast({ title: t('videoEditor.selection.folderNotConfigured'), description: t('videoEditor.selection.folderNotConfiguredDesc'), variant: 'destructive' });
      return;
    }
    await ensureDir(root);
    const raw = selectionSaveName.trim();
    const baseName = raw || `selection_${Date.now()}`;
    const safeName = baseName.replace(/[^a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ ]+/g, '').trim() || `selection_${Date.now()}`;
    const name = `${safeName}.json`;
const fullPath = `${root}\\${name}`;
    const payload = {
      enabled: selection.enabled,
      shape: selection.shape,
      scope: selection.scope,
      track: selection.track,
      timeEnabled: selection.timeEnabled,
      timeStart: selection.timeStart,
      timeEnd: selection.timeEnd,
    };
    const ok = await writeFile(fullPath, JSON.stringify(payload, null, 2));
    if (ok) {
      toast({ title: t('videoEditor.selection.selectionSaved'), description: name });
      setSelectionSaveName('');
    } else {
      toast({ title: t('videoEditor.selection.genericError'), description: t('videoEditor.selection.saveSelectionErrorDesc'), variant: 'destructive' });
    }
  };

  const loadSelectionFromFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.shape) {
        updateSelection({
          enabled: data.enabled ?? true,
          shape: data.shape,
          scope: data.scope ?? 'inside',
          track: data.track ?? false,
          timeEnabled: data.timeEnabled ?? false,
          timeStart: data.timeStart ?? 0,
          timeEnd: data.timeEnd ?? 0,
        });
        toast({ title: t('videoEditor.selection.selectionLoaded'), description: file.name });
      } else {
        toast({ title: t('videoEditor.selection.invalidFormat'), description: t('videoEditor.selection.invalidFormatDesc'), variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: t('videoEditor.selection.genericError'), description: t('videoEditor.selection.loadSelectionErrorDesc'), variant: 'destructive' });
    } finally {
      e.target.value = '';
    }
  };

  // ---- Seguimiento de objeto (keyframes de la caja, rect/circle) ----
  const toggleSelectionTrack = (enabled: boolean) => {
    updateSelection({ track: enabled, ...(enabled ? {} : { draftBox: null }) });
  };

  // Añade/reemplaza un keyframe en el tiempo actual con la caja actual. Éste es el ÚNICO
  // modo de fijar un keyframe de seguimiento: arrastrar la caja sólo deja un borrador
  // (selection.draftBox) visible en el tiempo actual; aquí se confirma como keyframe y se
  // descarta el borrador. Sin borrador, usa la caja interpolada/estática actual.
  // Para freehand (lazo), la caja es el bounding box de los paths (o la interpolada
  // si ya hay keyframes), y el seguimiento anima el lazo transformando los paths.
  // ADEMÁS, para freehand se guarda la FORMA EXACTA del lazo en este fotograma como
  // frame de motionPaths: entre dos keyframes con formas distintas, la selección se
  // transforma poco a poco (morph) de una forma a la otra (los frames de silueta
  // tienen prioridad sobre la transformación de caja).
  const addSelectionKeyframeHere = () => {
    setEditState(prev => {
      const cur = ensureSelection(prev);
      const t = prev.timeline?.currentTime ?? 0;
      const draft = cur.draftBox ?? null;
      let box;
      if (draft) {
        box = { x: draft.x, y: draft.y, width: draft.width, height: draft.height };
      } else if (cur.shape.type === 'freehand') {
        box = ((cur.shape.keyframes?.length ?? 0) > 0
            ? getSelectionBoxAtTime(cur.shape, t)
            : pathsBBox(cur.shape.paths));
      } else {
        box = getSelectionBoxAtTime(cur.shape, t);
      }
      const keyframes = upsertSelectionKeyframe(cur.shape, t, box);
      let motionPaths = cur.shape.motionPaths;
      if (cur.shape.type === 'freehand' && (cur.shape.paths?.length ?? 0) > 0) {
        // La forma que se guarda es la EFECTIVA: si hay borrador (arrastre sin
        // fijar), los paths transformados a esa posición; si no, los dibujados.
        const storedPaths = draft
          ? transformPaths(cur.shape.paths, pathsBBox(cur.shape.paths), draft)
          : cur.shape.paths;
        motionPaths = upsertSelectionMotionPath(cur.shape, t, storedPaths);
      }
      // Tras fijar el keyframe, el lazo dibujado se limpia del preview: la forma
      // queda guardada en memoria (motionPath frame) y el usuario puede dibujar
      // el lazo NUEVO del siguiente keyframe sobre un canvas limpio.
      const clearedPaths = cur.shape.type === 'freehand' ? [] : cur.shape.paths;
      return { ...prev, selection: { ...cur, track: true, draftBox: null, shape: { ...cur.shape, keyframes, motionPaths, paths: clearedPaths } } };
    });
    snapshotHistory();
  };

  const removeSelectionKeyframeAtTime = (t: number) => {
    setEditState(prev => {
      const cur = ensureSelection(prev);
      const keyframes = removeSelectionKeyframeAt(cur.shape, t);
      const motionPaths = (cur.shape.motionPaths ?? []).filter(f => Math.abs(f.time - t) > 0.001);
      return { ...prev, selection: { ...cur, shape: { ...cur.shape, keyframes, motionPaths } } };
    });
  };

  const clearSelectionKeyframes = () => {
    setEditState(prev => {
      const cur = ensureSelection(prev);
      return { ...prev, selection: { ...cur, track: false, draftBox: null, shape: { ...cur.shape, keyframes: [], motionPaths: [] } } };
    });
  };


  // SAM2 (Fase 2): segmenta el objeto con IA vía ComfyUI. Captura la máscara del
  // lazo dibujado en el frame actual (PNG blanco/negro), la sube junto al vídeo
  // fuente al bridge /sam2/, y al completar decodifica el vídeo de máscaras a PNGs
  // por frame (luminancia→alfa) → motionMasks. La silueta cambia al contorno REAL
  // del objeto cada frame (a diferencia del lazo por puntos, que deforma el lazo).
  const handleSam2Segment = async () => {
    setSam2Error(null);
    const es = editStateRef.current;
    const cur = es.selection;
    if (!cur?.enabled || !cur.shape) { setSam2Error('Activa la selección y dibuja el lazo sobre el objeto primero.'); return; }
    const isFreehandShape = cur.shape.type === 'freehand';
    const isWandShape = cur.shape.type === 'wand';
    if (!isFreehandShape && !isWandShape) {
      setSam2Error('SAM2 necesita un trazo libre (lazo) o una máscara de varita sobre el objeto como punto de partida.');
      return;
    }
    if (isFreehandShape && (!cur.shape.paths || cur.shape.paths.length === 0)) {
      setSam2Error('SAM2 necesita un trazo libre (lazo) sobre el objeto como máscara inicial.');
      return;
    }
    // SEGUNDA PASADA aditiva: si el modo "añadir" está activo y ya hay motionMasks,
    // se conservan para fusionarlas al final (unión) en vez de reemplazarlas. Los
    // retoques en memoria NO se descartan en este modo: la fusión parte de la
    // máscara EFECTIVA del frame (con retoques), que es la que ve el usuario.
    const existingMasks = sam2Merge ? (cur.shape.motionMasks ?? []) : [];
    if (!sam2Merge) {
      // (Re)segmentar regenera las máscaras: descarta retoques pendientes (en memoria)
      // para que no se cuelen overrides de URLs anteriores.
      discardPendingMaskEdits();
    }
    if (!sam2WorkflowJson) { setSam2Error('Carga un workflow SAM2 de ComfyUI (formato API).'); return; }
    if (!sam2VideoNode.trim()) { setSam2Error('Indica el ID del nodo LoadVideo del workflow.'); return; }
    if (!sam2PointsNode.trim()) { setSam2Error('Indica el ID del nodo Sam2Segmentation (donde se inyectan los puntos).'); return; }

    const timeline = es.timeline;
    const tNow = timeline?.currentTime ?? 0;
    const info = getActiveVideoInfo(tNow);
    if (!info) { setSam2Error('No hay ningún clip de vídeo en el tiempo actual.'); return; }
    const nativeSize = videoNativeSize ?? previewVideoSize;
    if (!nativeSize || !nativeSize.width || !nativeSize.height) { setSam2Error('El vídeo aún no tiene tamaño conocido; espera a que cargue.'); return; }
    const srcOsPath = urlToOsPath(info.url);
    if (!srcOsPath) { setSam2Error('No se pudo resolver la ruta local del vídeo (¿es remoto/PocketBase?). SAM2 necesita el archivo local.'); return; }

    // 1) Calcular puntos positivos DENTRO de la forma actual:
    //    - freehand: grilla dentro del bbox del lazo con point-in-polygon (paths
    //      Bézier en % 0-100).
    //    - wand: grilla dentro del bbox del shape muestreando la máscara raster
    //      efectiva (respeta los retoques en memoria del panel de retoque) con alfa
    //      > 50%.
    //    Los puntos se convierten a px nativos. SAM2 (modo vídeo) recibe
    //    coordinates_positive = [{"x":..,"y":..}] en el espacio de píxeles del frame
    //    que carga VHS_LoadVideo (res nativa, sin redimensionar antes de Sam2Segmentation).
    const sw = nativeSize.width, sh = nativeSize.height;
    let minX = 100, maxX = 0, minY = 100, maxY = 0;
    let promptPoints: { x: number; y: number }[] = [];
    // Fuerza del prompt: densidad de la grilla y tope de puntos (1x-4x).
    const strength = Math.max(1, Math.min(4, sam2PromptStrength || 1));
    if (isFreehandShape) {
      const poly = (cur.shape.paths[0] || []).map(a => ({ x: a.x, y: a.y }));
      if (poly.length < 3) { setSam2Error('El lazo es demasiado pequeño para calcular puntos de prompt.'); return; }
      const insidePoly = (px: number, py: number) => {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
          if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) c = !c;
        }
        return c;
      };
      for (const p of poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
      const cols = 12 * strength, rows = 12 * strength;
      for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) {
        const x = minX + (maxX - minX) * c / cols;
        const y = minY + (maxY - minY) * r / rows;
        if (insidePoly(x, y)) promptPoints.push({ x: Math.round(x * sw / 100), y: Math.round(y * sh / 100) });
      }
      // SEGUNDA PASADA (modo añadir): además de la zona del lazo nuevo, muestrea
      // puntos DENTRO de la máscara existente en el frame del prompt (el objeto
      // completo tal y como lo ve el usuario). Así SAM2 re-segmente el objeto
      // entero — no solo la zona dibujada — y la unión cubre las partes que la
      // primera pasada dejó sin marcar. Esto es la "fuerza" de la segunda pasada.
      if (sam2Merge && (cur.shape.motionMasks?.length ?? 0) > 0) {
        try {
          const maskUrl = effectiveSelectionMaskUrl(cur, tNow);
          if (maskUrl) {
            const maskImg = await loadMaskImage(maskUrl);
            const mc = document.createElement('canvas');
            mc.width = maskImg.naturalWidth;
            mc.height = maskImg.naturalHeight;
            const mctx = mc.getContext('2d', { willReadFrequently: true });
            if (mctx) {
              mctx.drawImage(maskImg, 0, 0);
              const mdata = mctx.getImageData(0, 0, mc.width, mc.height).data;
              const bx = cur.shape.x, by = cur.shape.y, bw = cur.shape.width, bh = cur.shape.height;
              const gx0 = bw > 0 && bh > 0 ? bx : 0, gy0 = bw > 0 && bh > 0 ? by : 0;
              const gx1 = bw > 0 && bh > 0 ? bx + bw : 100, gy1 = bw > 0 && bh > 0 ? by + bh : 100;
              const mcols = 10 * strength, mrows = 10 * strength;
              for (let r = 1; r < mrows; r++) for (let c = 1; c < mcols; c++) {
                const x = gx0 + (gx1 - gx0) * c / mcols;
                const y = gy0 + (gy1 - gy0) * r / mrows;
                const mpx = Math.min(mc.width - 1, Math.max(0, Math.round(x * mc.width / 100)));
                const mpy = Math.min(mc.height - 1, Math.max(0, Math.round(y * mc.height / 100)));
                if (mdata[(mpy * mc.width + mpx) * 4 + 3] > 128) {
                  promptPoints.push({ x: Math.round(x * sw / 100), y: Math.round(y * sh / 100) });
                }
              }
            }
          }
        } catch { /* máscara no disponible: se queda solo con los puntos del lazo */ }
      }
    } else {
      // Varita: muestrear la máscara raster efectiva del frame actual.
      const maskUrl = effectiveSelectionMaskUrl(cur, tNow);
      if (!maskUrl) { setSam2Error('Haz clic con la varita sobre el objeto para crear la máscara primero.'); return; }
      let maskImg: HTMLImageElement;
      try {
        maskImg = await loadMaskImage(maskUrl);
      } catch {
        setSam2Error('No se pudo cargar la máscara de la varita de este frame.');
        return;
      }
      const mc = document.createElement('canvas');
      mc.width = maskImg.naturalWidth;
      mc.height = maskImg.naturalHeight;
      const mctx = mc.getContext('2d', { willReadFrequently: true });
      if (!mctx) { setSam2Error('No se pudo leer la máscara de la varita.'); return; }
      mctx.drawImage(maskImg, 0, 0);
      const mdata = mctx.getImageData(0, 0, mc.width, mc.height).data;
      // Bbox del shape en % (la varita lo calcula al rellenar); si es nulo, todo el frame.
      const bx = cur.shape.x, by = cur.shape.y, bw = cur.shape.width, bh = cur.shape.height;
      if (bw > 0 && bh > 0) { minX = bx; maxX = bx + bw; minY = by; maxY = by + bh; }
      else { minX = 0; maxX = 100; minY = 0; maxY = 100; }
      const cols = 14 * strength, rows = 14 * strength;
      for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) {
        const x = minX + (maxX - minX) * c / cols;
        const y = minY + (maxY - minY) * r / rows;
        const mpx = Math.min(mc.width - 1, Math.max(0, Math.round(x * mc.width / 100)));
        const mpy = Math.min(mc.height - 1, Math.max(0, Math.round(y * mc.height / 100)));
        if (mdata[(mpy * mc.width + mpx) * 4 + 3] > 128) {
          promptPoints.push({ x: Math.round(x * sw / 100), y: Math.round(y * sh / 100) });
        }
      }
    }
    if (promptPoints.length === 0) promptPoints = [{ x: Math.round((minX + maxX) / 2 * sw / 100), y: Math.round((minY + maxY) / 2 * sh / 100) }];
    // Tope de puntos según la fuerza (12 por defecto, hasta 48 a 4x).
    const pointCap = Math.round(12 * strength);
    if (promptPoints.length > pointCap) { const step = Math.ceil(promptPoints.length / pointCap); promptPoints = promptPoints.filter((_, i) => i % step === 0).slice(0, pointCap); }
    const coordinates = JSON.stringify(promptPoints.map(p => ({ x: p.x, y: p.y })));

    // 2) Leer el vídeo fuente y subirlo. El bridge espera un fichero multipart.
    const vidBuf = await readFileBuffer(srcOsPath);
    if (!vidBuf) { setSam2Error('No se pudo leer el archivo de vídeo local.'); return; }
    const vidAb = new ArrayBuffer(vidBuf.byteLength);
    new Uint8Array(vidAb).set(vidBuf);
    const vidFile = new File([vidAb], srcOsPath.replace(/\\/g, '/').split('/').pop() || 'source.mp4', { type: 'video/mp4' });

    // Compensación de TIEMPO: el vídeo de máscaras que devuelve SAM2 cubre el
    // archivo fuente COMPLETO (VHS_LoadVideo carga todo el fichero). Mapeamos sólo
    // el tramo del clip: desde sourceStartTime (segundo real del source al inicio
    // del clip) durante fileSecondsToTrack = (clipDur)·rate segundos. El frame-N
    // del tramo → timeline clipStart + N/(30·rate). El lazo puede estar en cualquier
    // frame; el frame_index del prompt (0 en el nodo único, o el campo "Frame del
    // prompt" en la cadena AddPoints) debe apuntar al frame del archivo donde está
    // el lazo (info.sourceTime).
    const rate = info.playbackRate ?? 1;
    const clipStart = info.clip.startTime;
    const clipDur = info.clip.duration;
    const sourceStartTime = info.clip.sourceStartTime ?? 0;
    const fileSecondsToTrack = Math.max(0.1, clipDur * rate);

    setSam2Busy(true);
    setSam2Progress({ current: 0, total: 1, percent: 0 });
    try {
      const payload = new FormData();
      payload.append('workflow_json', JSON.stringify(sam2WorkflowJson));
      payload.append('comfyui_url', sam2ComfyUrl);
      payload.append('video_load_node', sam2VideoNode.trim());
      payload.append('points_node', sam2PointsNode.trim());
      payload.append('coordinates', coordinates);
      if (sam2FrameNode.trim()) {
        payload.append('frame_node', sam2FrameNode.trim());
        // En la SEGUNDA PASADA (modo añadir) el lazo se dibuja en el frame actual
        // del playhead: el prompt de SAM2 debe apuntar a ese frame del archivo
        // (igual que runSam2Tracking con timeOverride), no al campo manual.
        payload.append('frame_index', sam2Merge
          ? String(Math.round(info.sourceTime * 30))
          : String(sam2FrameIndex || '0'));
      } else if (sam2Merge) {
        // Segunda pasada SIN nodo de frame configurado: igualmente hay que mandar
        // el frame del playhead. El bridge lo aplica al propio nodo de segmentación
        // (Sam2Segmentation en modo vídeo). Sin esto, los puntos de la segunda
        // pasada caían siempre en el frame 0 y la zona dibujada no se cubría.
        payload.append('frame_node', '');
        payload.append('frame_index', String(Math.round(info.sourceTime * 30)));
      }
      payload.append('video_file', vidFile);

      const res = await fetch('http://localhost:5081/sam2/', { method: 'POST', body: payload });
      if (!res.ok) {
        if (res.status === 404) throw new Error('El Flux Bridge no está disponible. Inicia los servicios (ComfyUI + bridge).');
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `Error ${res.status}`);
      }
      const data = await res.json();
      const jobId = data?.job_id;
      if (!jobId) throw new Error('El bridge no devolvió job_id.');

      let maskVideoPath: string | null = null;
      for (let i = 0; i < 1800; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await fetch(`http://localhost:5081/sam2/status/${jobId}`);
        if (!st.ok) continue;
        const sd = await st.json();
        if (sd.progress) setSam2Progress(sd.progress);
        if (sd.status === 'completed') { maskVideoPath = sd?.video?.url || null; break; }
        if (sd.status === 'error') throw new Error(sd.error || 'Error en ComfyUI.');
      }
      if (!maskVideoPath) throw new Error('Timeout esperando el vídeo de máscaras de ComfyUI.');

      setSam2Progress({ current: 0, total: 1, percent: 95 });
      // 3) Decodificar el vídeo de máscaras a PNGs por frame → motionMasks.
      const frames = await decodeMaskVideoToPngs(
        maskVideoPath,
        clipStart,
        sourceStartTime,
        fileSecondsToTrack,
        rate,
        clipDur,
        (p) => setSam2Progress({ current: Math.round(p * 100), total: 100, percent: Math.round(95 + p * 5) }),
      );
      if (frames.length === 0) throw new Error('La decodificación no produjo máscaras.');

      // SEGUNDA PASADA aditiva: fusiona (unión) las máscaras nuevas con las
      // existentes frame a frame en vez de reemplazarlas. Si el usuario limitó el
      // rango, solo se toca la zona temporal alrededor del frame actual.
      let finalFrames = frames;
      if (sam2Merge && existingMasks.length > 0) {
        setSam2Progress({ current: 0, total: 1, percent: 96 });
        finalFrames = await mergeMaskFrameLists(
          existingMasks,
          frames,
          1 / (30 * (rate || 1)),
          (p) => setSam2Progress({ current: Math.round(p * 100), total: 100, percent: Math.round(96 + p * 4) }),
          sam2MergeRange && sam2MergeRangeSec > 0
            ? { center: tNow, sec: sam2MergeRangeSec }
            : null,
        );
      }

      // 4) Asignar motionMasks (silueta cambiante raster). track=true para que el
      //    render aplique la máscara; motionMasks tiene prioridad sobre todo.
      snapshotHistory();
      setEditState(prev => {
        const c = ensureSelection(prev);
        return {
          ...prev,
          selection: {
            ...c,
            track: true,
            draftBox: null,
            shape: { ...c.shape, motionMasks: finalFrames, motionPaths: undefined },
          },
        };
      });
      setSam2Progress(null);
      try {
        if (sam2Merge && existingMasks.length > 0) {
          toast({ title: 'SAM2: segunda pasada añadida', description: `${finalFrames.length} máscaras · lo capturado se ha fusionado con las máscaras existentes.` });
        } else {
          toast({ title: 'Segmentación SAM2 aplicada', description: `${frames.length} máscaras · la silueta sigue el contorno real del objeto.` });
        }
      } catch {}
    } catch (e: any) {
      setSam2Error(e?.message || 'Error en la segmentación SAM2.');
    } finally {
      setSam2Busy(false);
      setSam2Progress(null);
    }
  };

  // Decodifica un vídeo de máscaras SAM2 (ruta OS local o media://) a un TrackingData
  // (bbox/centro/escala por frame, en px nativos) para el tracking de OBJETOS. A
  // diferencia de decodeMaskVideoToPngs (que guarda PNGs para la silueta de selección),
  // aquí sólo necesitamos el bbox del objeto por frame → no escribe disco. Muestrea
  // el vídeo de máscaras a lo largo del tramo del clip: el frame k del tracking se
  // muestrea en t = sourceStartTime + k*rate/30, de modo que en tiempo LOCAL del clip
  // corresponde a k/30 s (encaja con trackingDataToKeyframes que usa frameDurationSec
  // 1/30 por defecto). El bbox se calcula con un stride (muestreo cada 4 px) para ir
  // rápido; suficiente para seguir el centro y el tamaño del objeto.
  const decodeMaskVideoToTrackingData = async (
    maskVideoPath: string,
    sourceStartTime: number,
    clipDur: number,
    rate: number,
    onProgress?: (p: number) => void,
  ): Promise<TrackingData> => {
    const src = maskVideoPath.startsWith('media://') || maskVideoPath.startsWith('http')
      ? maskVideoPath
      : (isElectron() && window.electronAPI?.getMediaUrl ? window.electronAPI.getMediaUrl(maskVideoPath) : maskVideoPath);
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.src = src;
    await new Promise<void>((res, rej) => { video.onloadeddata = () => res(); video.onerror = () => rej(new Error('No se pudo cargar el vídeo de máscaras.')); });
    const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (dur <= 0) throw new Error('El vídeo de máscaras no tiene duración.');
    const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
    const canvas = document.createElement('canvas');
    canvas.width = vw; canvas.height = vh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const clipFps = 30;
    const total = Math.max(1, Math.floor(clipDur * clipFps));
    const frames: number[] = [];
    const bboxes: number[][] = [];
    const centers: number[][] = [];
    const scales: number[] = [];
    const rotations: number[] = [];
    let initialW = 0;
    const stride = 4;
    const contours: { x: number; y: number }[][] = [];
    for (let k = 0; k < total; k++) {
      const tMask = Math.min(sourceStartTime + (k * rate) / clipFps, Math.max(0, dur - 0.001));
      await new Promise<void>((res) => { const on = () => { video.removeEventListener('seeked', on); res(); }; video.addEventListener('seeked', on); video.currentTime = tMask; });
      ctx.clearRect(0, 0, vw, vh);
      ctx.drawImage(video, 0, 0, vw, vh);
      const d = ctx.getImageData(0, 0, vw, vh).data;
      let minX = vw, minY = vh, maxX = -1, maxY = -1;
      for (let y = 0; y < vh; y += stride) {
        for (let x = 0; x < vw; x += stride) {
          const i = (y * vw + x) * 4;
          if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 127) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      frames.push(k);
      if (maxX < 0) {
        bboxes.push([0, 0, 0, 0]); centers.push([0, 0]); scales.push(0);
        contours.push([]);
      } else {
        const bx = Math.max(0, minX - stride);
        const by = Math.max(0, minY - stride);
        const bw = Math.min(vw - bx, maxX - minX + 2 * stride);
        const bh = Math.min(vh - by, maxY - minY + 2 * stride);
        bboxes.push([bx, by, bw, bh]);
        const cx = bx + bw / 2;
        const cy = by + bh / 2;
        centers.push([cx, cy]);
        if (k === 0) initialW = bw;
        scales.push(initialW > 0 ? bw / initialW : 1);
        const contour = extractMaskContourFromImageData(d, vw, vh, cx, cy, 48);
        contours.push(contour);
      }
      rotations.push(0);
      if (onProgress && (k % 5 === 0)) onProgress(k / total);
    }
    return { frames, bboxes, centers, scales, rotations, fps: clipFps, total_frames: total, initial_bbox: bboxes[0] || [0, 0, 0, 0], contours };
  };

  // Tracking de un objeto del vídeo con SAM2 (IA) para la pestaña Objetos: calcula
  // puntos positivos DENTRO de la región marcada, llama al bridge /sam2/ (mismo
  // pipeline que la silueta cambiante), y al completar decodifica el vídeo de
  // máscaras a un TrackingData (bbox/centro/escala por frame). Reutiliza la misma
  // configuración SAM2 (workflow + node IDs) que se carga en el bloque SAM2 de la
  // pestaña Efectos. La región debe estar sobre el objeto en el PRIMER frame del
  // clip (el prompt de SAM2 va al frame 0 del archivo en el nodo único). El
  // TrackingData resultante se pasa a trackingDataToKeyframes para generar los
  // instantes del objeto (editables).
   const runSam2Tracking = async (
     region: TrackingRegion,
     lazoPath?: BezierAnchor[] | null,
     onProgress?: (p: number) => void,
     timeOverride?: number,
   ): Promise<TrackingData | null> => {
     if (!sam2WorkflowJson) throw new Error('Carga un workflow SAM2 en el bloque SAM2 de la pestaña Efectos primero.');
     if (!sam2VideoNode.trim()) throw new Error('Indica el ID del nodo LoadVideo del workflow SAM2 (pestaña Efectos).');
     if (!sam2PointsNode.trim()) throw new Error('Indica el ID del nodo Sam2Segmentation del workflow SAM2 (pestaña Efectos).');
     const es = editStateRef.current;
     const tNow = timeOverride ?? (es.timeline?.currentTime ?? 0);
     const info = getActiveVideoInfo(tNow);
     if (!info) throw new Error('No hay ningún clip de vídeo en el tiempo actual.');
     const nativeSize = videoNativeSize ?? previewVideoSize;
     if (!nativeSize || !nativeSize.width || !nativeSize.height) throw new Error('El vídeo aún no tiene tamaño conocido.');
     const srcOsPath = urlToOsPath(info.url);
     if (!srcOsPath) throw new Error('No se pudo resolver la ruta local del vídeo (¿es remoto?). SAM2 necesita el archivo local.');

    // Puntos positivos dentro del lazo/región (coordenadas % → píxeles nativos)
    const sw = nativeSize.width, sh = nativeSize.height;
    let promptPoints: { x: number; y: number }[] = [];

    if (lazoPath && lazoPath.length >= 3) {
      const poly = lazoPath.map(a => ({ x: a.x, y: a.y }));
      const insidePoly = (px: number, py: number) => {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
          if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) c = !c;
        }
        return c;
      };
      let minX = 100, maxX = 0, minY = 100, maxY = 0;
      for (const p of poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
      const cols = 10, rows = 10;
      for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) {
        const x = minX + (maxX - minX) * c / cols;
        const y = minY + (maxY - minY) * r / rows;
        if (insidePoly(x, y)) promptPoints.push({ x: Math.round(x * sw / 100), y: Math.round(y * sh / 100) });
      }
      if (promptPoints.length === 0) {
        promptPoints = [{ x: Math.round((minX + maxX) / 2 * sw / 100), y: Math.round((minY + maxY) / 2 * sh / 100) }];
      }
    } else {
      const bx = Math.round((region.x / 100) * sw);
      const by = Math.round((region.y / 100) * sh);
      const bw = Math.round((region.width / 100) * sw);
      const bh = Math.round((region.height / 100) * sh);
      const cols = 5, rows = 5;
      for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) {
        promptPoints.push({ x: bx + Math.round((bw * c) / cols), y: by + Math.round((bh * r) / rows) });
      }
    }
    if (promptPoints.length > 12) { const step = Math.ceil(promptPoints.length / 12); promptPoints = promptPoints.filter((_, i) => i % step === 0).slice(0, 12); }
    const coordinates = JSON.stringify(promptPoints.map((p) => ({ x: p.x, y: p.y })));

    const vidBuf = await readFileBuffer(srcOsPath);
    if (!vidBuf) throw new Error('No se pudo leer el archivo de vídeo local.');
    const vidAb = new ArrayBuffer(vidBuf.byteLength);
    new Uint8Array(vidAb).set(vidBuf);
    const vidFile = new File([vidAb], srcOsPath.replace(/\\/g, '/').split('/').pop() || 'source.mp4', { type: 'video/mp4' });

    const rate = info.playbackRate ?? 1;
    const clipDur = info.clip.duration;
    const sourceStartTime = info.clip.sourceStartTime ?? 0;

    const payload = new FormData();
    payload.append('workflow_json', JSON.stringify(sam2WorkflowJson));
    payload.append('comfyui_url', sam2ComfyUrl);
    payload.append('video_load_node', sam2VideoNode.trim());
    payload.append('points_node', sam2PointsNode.trim());
    payload.append('coordinates', coordinates);
     if (sam2FrameNode.trim()) {
       payload.append('frame_node', sam2FrameNode.trim());
       const frameIdxForSam2 = timeOverride !== undefined
         ? String(Math.round(info.sourceTime * 30))
         : String(sam2FrameIndex || '0');
       payload.append('frame_index', frameIdxForSam2);
     } else if (timeOverride !== undefined) {
       // Tracking desde un keyframe distinto del 0 sin nodo de frame configurado:
       // el frame del prompt debe llegar igualmente al bridge (lo aplica al propio
       // nodo de segmentación). Sin esto, los puntos caían siempre en el frame 0.
       payload.append('frame_node', '');
       payload.append('frame_index', String(Math.round(info.sourceTime * 30)));
     }
    payload.append('video_file', vidFile);

    const res = await fetch('http://localhost:5081/sam2/', { method: 'POST', body: payload });
    if (!res.ok) {
      if (res.status === 404) throw new Error('El Flux Bridge no está disponible. Inicia los servicios (ComfyUI + bridge) desde el bloque SAM2 de la pestaña Efectos.');
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || `Error ${res.status}`);
    }
    const data = await res.json();
    const jobId = data?.job_id;
    if (!jobId) throw new Error('El bridge no devolvió job_id.');
    let maskVideoPath: string | null = null;
    for (let i = 0; i < 1800; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await fetch(`http://localhost:5081/sam2/status/${jobId}`);
      if (!st.ok) continue;
      const sd = await st.json();
      if (sd.progress) onProgress?.(Math.min(0.9, (sd.progress.percent ?? 0) / 100));
      if (sd.status === 'completed') { maskVideoPath = sd?.video?.url || null; break; }
      if (sd.status === 'error') throw new Error(sd.error || 'Error en ComfyUI.');
    }
    if (!maskVideoPath) throw new Error('Timeout o respuesta no válida esperando el vídeo de máscaras de ComfyUI.');
    const raw = await decodeMaskVideoToTrackingData(maskVideoPath, sourceStartTime, clipDur, rate, (p) => onProgress?.(0.9 + p * 0.1));
    const initialLazoPts = (lazoPath && lazoPath.length >= 3) ? lazoPath.map((a) => ({ x: a.x, y: a.y })) : undefined;
    const smoothed = smoothTrackingData(raw, 4);
    return { ...smoothed, initial_lazo_path: initialLazoPts };
  };

  // Copia las coordenadas de un keyframe al portapapeles (x, y, ancho, alto) para
  // verificarlas: el usuario las pega en el campo "Aplicar coordenadas" y comprueba que
  // la caja va donde debe.
  const copySelectionCoords = async (kf: SelectionKeyframe) => {
    const text = `${kf.time}, ${kf.x}, ${kf.y}, ${kf.width}, ${kf.height}`;
    try {
      const api = (typeof window !== 'undefined' ? (window as any).electronAPI : undefined);
      if (api?.clipboardWriteText) {
        await api.clipboardWriteText(text);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast({ title: t('videoEditor.selection.coordsCopied'), description: text });
    } catch {
      toast({ title: t('videoEditor.selection.coordsCopyFailed'), variant: 'destructive' });
    }
  };

  // Modo "rellenar todo menos la selección": rellena el vídeo con el color de pintura
  // excepto la selección (dentro/fuera según scope). El agujero sigue a la selección
  // (effectiveSelectionShape en cada frame), así que si la selección sigue al objeto
  // (keyframes), el agujero sigue al objeto sin deformarse. Botón "Aplicar relleno".
  const togglePaintInverseFill = () => {
    setEditState(prev => {
      const cur = ensurePaint(prev);
      const inverseFill = !cur.inverseFill;
      return { ...prev, paint: { ...cur, enabled: true, inverseFill } };
    });
    snapshotHistory();
  };

  // Aplica las coordenadas escritas. Formato del campo (lo que copia el botón Copy de
  // cada keyframe): "tiempo, x, y, ancho, alto" (5 números). Si vienen 5, ADEMÁS hace
  // seek al tiempo del keyframe para reproducir/verificar en ese instante. Si sólo 4
  // (x, y, ancho, alto), no hace seek. POSICIONA la caja en el tiempo actual SIN fijar
  // keyframe (sólo visual / borrador) y ADEMÁS aplica el relleno (paint.inverseFill)
  // con el color de pintura actual, para que el usuario vea el agujero en esas coords
  // y verifique que son correctas. Para fijar la posición, pulsa "Fijar keyframe aquí".
  const applySelectionCoords = () => {
    const nums = selCoordsInput
      .trim()
      .split(/[,\s]+/)
      .map((s) => parseFloat(s))
      .filter((n) => !isNaN(n));
    if (nums.length < 4) {
      toast({ title: t('videoEditor.selection.coordsInvalid'), description: t('videoEditor.selection.coordsInvalidDesc'), variant: 'destructive' });
      return;
    }
    const clampPct = (v: number) => Math.max(0, Math.min(100, v));
    // 5 números → el 1º es el tiempo (s) del keyframe: seek antes de posicionar.
    // 4 números → sólo caja, sin seek.
    const hasTime = nums.length >= 5;
    const seekTime = hasTime ? Math.max(0, nums[0]) : null;
    const bx = hasTime ? nums[1] : nums[0];
    const by = hasTime ? nums[2] : nums[1];
    const bw = hasTime ? nums[3] : nums[2];
    const bh = hasTime ? nums[4] : nums[3];
    const box = {
      x: clampPct(bx),
      y: clampPct(by),
      width: Math.max(1, clampPct(bw)),
      height: Math.max(1, clampPct(bh)),
    };
    if (seekTime !== null) handleTimelineTimeUpdate(seekTime);
    setEditState(prev => {
      const cur = ensureSelection(prev);
      // Con tracking activo, "Aplicar" CONFIRMA el keyframe en este momento
      // (como "Fijar keyframe aquí"): guarda la caja y, para freehand, la forma
      // exacta del lazo transformada a esa caja (morph). Sin tracking, mueve la
      // caja estática.
      const t = seekTime !== null ? seekTime : (currentTimeRef.current ?? 0);
      let nextSel: VideoSelectionState;
      if (cur.track) {
        const keyframes = upsertSelectionKeyframe(cur.shape, t, box);
        let motionPaths = cur.shape.motionPaths;
        let clearedPaths = cur.shape.paths;
        if (cur.shape.type === 'freehand' && (cur.shape.paths?.length ?? 0) > 0) {
          // La forma guardada va transformada a la caja aplicada: si el lazo ya
          // está en esa posición es identidad; si copiaste coordenadas de otro
          // keyframe, la silueta se mueve a esa ubicación.
          const storedPaths = transformPaths(cur.shape.paths, pathsBBox(cur.shape.paths), box);
          motionPaths = upsertSelectionMotionPath(cur.shape, t, storedPaths);
          clearedPaths = [];
        }
        nextSel = { ...cur, track: true, draftBox: null, shape: { ...cur.shape, keyframes, motionPaths, paths: clearedPaths } };
      } else {
        nextSel = { ...cur, shape: { ...cur.shape, ...box } };
      }
      // NOTA: ya no se activa el relleno de pintura (inverseFill) automáticamente:
      // pintaba de rojo todo lo de fuera de la selección. La selección se muestra
      // con su contorno verde transparente y borde discontinuo (SelectionOverlay).
      return { ...prev, selection: nextSel };
    });
    snapshotHistory();
    const tDesc = seekTime !== null ? ` · seek a ${fmtHMS(seekTime)}` : '';
    toast({ title: t('videoEditor.selection.coordsApplied'), description: t('videoEditor.selection.coordsAppliedDesc', { x: box.x, y: box.y, w: box.width, h: box.height, extra: tDesc }) });
  };

  const resetSelection = () => {
    setEditState(prev => ({
      ...prev,
      selection: { enabled: false, shape: defaultSelectionShape('rect'), scope: 'inside', track: false, draftBox: null, ...defaultSelectionTime() },
    }));
  };

  // ---- Capa de pintura (brocha/bote/gotero/borrador) — capa única ----
  // Lo que pintas es la capa: una sola máscara (paint.mask) dura todo el vídeo (o el
  // intervalo [timeStart,timeEnd] si timeEnabled). No hay keyframes de pintura. Si al
  // pintar hay selección 'inside', el commit fija baseBox y la pintura sigue a la
  // selección (interpola entre los KEYFRAMES DE LA SELECCIÓN).
  const defaultPaint = (prev: VideoEditState): VideoPaintState => ({
    enabled: true,
    mask: undefined,
    color: '#ff3b3b',
    brushSize: 40,
    opacity: 100,
    timeEnabled: false,
    timeStart: 0,
    timeEnd: prev.timeline?.duration ?? 0,
    fadeIn: 0,
    fadeOut: 0,
    baseBox: null,
    inverseFill: false,
  });

  const ensurePaint = (prev: VideoEditState): VideoPaintState => prev.paint ?? defaultPaint(prev);

  const updatePaint = (partial: Partial<VideoPaintState>) => {
    setEditState(prev => ({ ...prev, paint: { ...ensurePaint(prev), ...partial } }));
  };

  // Al activar la pintura, si timeEnd es 0 lo deja en la duración del timeline.
  const togglePaint = (enabled: boolean) => {
    setEditState(prev => {
      const cur = ensurePaint(prev);
      let timeEnd = cur.timeEnd ?? 0;
      if (enabled && (!timeEnd || timeEnd <= cur.timeStart)) {
        const dur = prev.timeline?.duration ?? 0;
        timeEnd = dur > 0 ? dur : 0;
      }
      if (!enabled) setPaintTool(null);
      return { ...prev, paint: { ...cur, enabled, timeEnd } };
    });
  };

  const togglePaintTime = (enabled: boolean) => {
    setEditState(prev => {
      const cur = ensurePaint(prev);
      let timeStart = cur.timeStart ?? 0;
      let timeEnd = cur.timeEnd ?? 0;
      if (enabled && (!timeEnd || timeEnd <= timeStart)) {
        const dur = prev.timeline?.duration ?? 0;
        // Si la duración aún no se conoce, al menos un rango mínimo de 1s para
        // que el efecto se vea en el primer segundo (nunca un rango vacío).
        timeEnd = dur > timeStart ? dur : timeStart + 1;
      }
      return { ...prev, paint: { ...cur, timeEnabled: enabled, timeStart, timeEnd } };
    });
  };

  const setPaintTime = (field: 'timeStart' | 'timeEnd', value: number) => {
    setEditState(prev => {
      const cur = ensurePaint(prev);
      const dur = prev.timeline?.duration ?? 0;
      let timeStart = Math.max(0, cur.timeStart ?? 0);
      let timeEnd = Math.max(0, cur.timeEnd ?? 0);
      if (field === 'timeStart') {
        timeStart = Math.max(0, value);
        if (timeEnd <= timeStart) timeEnd = dur > timeStart ? dur : timeStart + 1;
      } else {
        timeEnd = Math.max(0, value);
        if (timeEnd <= timeStart) timeStart = Math.max(0, timeEnd - 1);
      }
      return { ...prev, paint: { ...cur, timeStart, timeEnd } };
    });
  };

  const setPaintFade = (field: 'fadeIn' | 'fadeOut', value: number) => {
    const v = isFinite(value) && value >= 0 ? value : 0;
    setEditState(prev => ({ ...prev, paint: { ...ensurePaint(prev), [field]: v } }));
  };

  const resetPaint = () => {
    setPaintTool(null);
    setEditState(prev => ({ ...prev, paint: { ...defaultPaint(prev), enabled: false, mask: undefined, baseBox: null, inverseFill: false } }));
  };

  // Borra la pintura (la máscara y el modo relleno). Mantiene color/tamaño/intervalo.
  const clearPaintMask = () => {
    setEditState(prev => ({ ...prev, paint: { ...ensurePaint(prev), mask: undefined, baseBox: null, inverseFill: false } }));
    snapshotHistory();
  };

  const handleMergeClips = (clipIdA: string, clipIdB: string) => {
    if (!editState.timeline) return;

    // No unir clips bloqueados individualmente.
    const clips = editState.timeline.tracks.flatMap(t => t.clips);
    if (clips.find(c => c.id === clipIdA)?.locked || clips.find(c => c.id === clipIdB)?.locked) return;

    setEditState(prev => {
      const timeline = prev.timeline!;
      const clipA = timeline.tracks.flatMap(t => t.clips).find(c => c.id === clipIdA);
      const clipB = timeline.tracks.flatMap(t => t.clips).find(c => c.id === clipIdB);
      if (!clipA || !clipB || clipA.trackId !== clipB.trackId) return prev;

      const track = timeline.tracks.find(t => t.id === clipA.trackId);
      if (!track) return prev;

      const existingGroups = new Set<string>();
      if (clipA.linkedGroupId) existingGroups.add(clipA.linkedGroupId);
      if (clipB.linkedGroupId) existingGroups.add(clipB.linkedGroupId);
      const newGroupId = clipA.linkedGroupId || clipB.linkedGroupId || `linked-${Date.now()}`;

      const newTracks = timeline.tracks.map(t => {
        if (t.id !== track.id) return t;
        const newClips = t.clips.map(clip => {
          if (clip.linkedGroupId && existingGroups.has(clip.linkedGroupId)) {
            return { ...clip, linkedGroupId: newGroupId };
          }
          if (clip.id === clipA.id || clip.id === clipB.id) {
            return { ...clip, linkedGroupId: newGroupId };
          }
          return clip;
        });
        return { ...t, clips: newClips };
      });

      return {
        ...prev,
        timeline: { ...timeline, tracks: newTracks }
      };
    });
  };

  // Fin de handlers


  const handleCopyClip = (clipId: string) => {
    const clip = editState.timeline?.tracks
      .flatMap(t => t.clips)
      .find(c => c.id === clipId);

    if (clip) {
      setClipboardClip({ ...clip });
      console.log('Clip copiado:', clip.id);
    }
  };

  const handlePasteClip = (targetTrackId?: string) => {
    if (!clipboardClip || !editState.timeline) return;

    setEditState(prev => {
      const timeline = prev.timeline!;
      const currentTime = timeline.currentTime;

      // Intentar pegar en la pista original o en la primera compatible
      const targetTrack = timeline.tracks.find(t =>
        targetTrackId ? t.id === targetTrackId : t.type === clipboardClip.type
      );

      if (!targetTrack) return prev;

      const copyId = `clip-copy-${Date.now()}`;
      const newClip: TimelineClip = {
        ...clipboardClip,
        id: copyId,
        trackId: targetTrack.id,
        startTime: currentTime
      };

      const newTracks = timeline.tracks.map(t =>
        t.id === targetTrack.id ? { ...t, clips: [...t.clips, newClip] } : t
      );

      const sourceTextClip = (prev.textClips || []).find((clip) => clip.id === clipboardClip.id);
      const newTextClips = sourceTextClip
        ? [
          ...(prev.textClips || []),
          {
            ...sourceTextClip,
            id: copyId,
            startTime: currentTime,
            duration: newClip.duration,
          },
        ]
        : prev.textClips;

      const sourceObjectClip = (prev.objectClips || []).find((clip) => clip.id === clipboardClip.id);
      const newObjectClips = sourceObjectClip
        ? [
          ...(prev.objectClips || []),
          {
            ...sourceObjectClip,
            id: copyId,
            startTime: currentTime,
            duration: newClip.duration,
          },
        ]
        : prev.objectClips;

      return {
        ...prev,
        textClips: newTextClips,
        objectClips: newObjectClips,
        timeline: { ...timeline, tracks: newTracks }
      };
    });
  };

  const handleDeleteTrack = (trackId: string) => {
    if (!editState.timeline) return;

    setEditState(prev => ({
      ...prev,
      timeline: {
        ...prev.timeline!,
        tracks: prev.timeline!.tracks.filter(t => t.id !== trackId)
      }
    }));
  };

  const handleSnapToStart = (trackId: string) => {
    if (!editState.timeline) return;

    setEditState(prev => {
      const timeline = prev.timeline!;
      const newTracks = timeline.tracks.map(track => {
        if (track.id !== trackId || track.clips.length === 0) return track;

        // "Traer clips al inicio": imán que cierra huecos. Los clips
        // bloqueados individualmente se quedan fijos en su sitio; el resto
        // se compacta desde 0 rellenando los huecos libres (sin solaparse
        // con los bloqueados), en su orden relativo.
        const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
        const lockedRanges = sorted
          .filter(c => c.locked)
          .map(c => ({ start: c.startTime, end: c.startTime + c.duration }));
        let cursor = 0;
        const startById = new Map<string, number>();
        for (const clip of sorted) {
          if (clip.locked) {
            // Fijo: se respetan su posición y el cursor avanza si hace falta.
            startById.set(clip.id, clip.startTime);
            cursor = Math.max(cursor, clip.startTime + clip.duration);
            continue;
          }
          // Buscar el primer hueco libre (>= cursor) donde quepa el clip
          // sin solapar ningún rango bloqueado.
          let s = Math.max(cursor, 0);
          let collided = true;
          while (collided) {
            collided = false;
            for (const r of lockedRanges) {
              if (s < r.end && s + clip.duration > r.start) {
                s = r.end;
                collided = true;
                break;
              }
            }
          }
          startById.set(clip.id, s);
          cursor = s + clip.duration;
        }

        const newClips = track.clips.map(clip => ({
          ...clip,
          startTime: startById.get(clip.id) ?? clip.startTime
        }));

        return { ...track, clips: newClips };
      });

      return {
        ...prev,
        timeline: { ...timeline, tracks: newTracks }
      };
    });
  };

  const handleFileUpload = (files: File[]) => {
    if (!editState.timeline) return;

    console.log('=== FILE UPLOAD ===');
    console.log('Files received:', files.length);
    files.forEach((file, index) => {
      console.log(`File ${index}:`, {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified
      });
    });

    files.forEach(file => {
      const fileUrl = URL.createObjectURL(file);

      // Para audio, usar la duración real del archivo si es posible
      const getAudioDuration = (file: File, callback: (duration: number) => void) => {
        const audio = document.createElement('audio');
        audio.src = fileUrl;
        audio.addEventListener('loadedmetadata', () => {
          callback(audio.duration);
        });
        audio.addEventListener('error', () => {
          callback(5);
        });
      };

      // Para video, usar la duración real del archivo
      const getVideoDuration = (file: File, callback: (duration: number) => void) => {
        const video = document.createElement('video');
        video.src = fileUrl;
        video.preload = 'metadata';
        video.addEventListener('loadedmetadata', () => {
          callback(video.duration);
        });
        video.addEventListener('error', () => {
          callback(10); // Fallback si falla
        });
      };

      const trackType: TrackType = uploadType === 'image' ? 'video' : uploadType;

      // LOGICA INTELIGENTE DE SELECCIÓN DE PISTA Y TIEMPO
      const allTracksOfType = editState.timeline?.tracks.filter(t => t.type === trackType) || [];

      // 1. Buscar si hay alguna pista de este tipo totalmente vacía
      let targetTrack = allTracksOfType.find(t => t.clips.length === 0);
      let startTime = 0;

      if (targetTrack) {
        // Si hay una pista vacía, empezamos en el segundo 0 de esa pista
        startTime = 0;
        console.log(`Usando pista vacía: ${targetTrack.name}`);
      } else {
        // 2. Si no hay vacías, usamos la primera pista de ese tipo y lo ponemos al final de sus clips
        targetTrack = allTracksOfType[0];

        if (!targetTrack) {
          // Si no existe ninguna pista de ese tipo, creamos una
          handleAddTrack(trackType);
          // Re-intentar obtenerla (el estado se actualizará en el próximo render, pero necesitamos una referencia ahora)
          // Como handleAddTrack es asíncrono respecto al estado, usaremos una lógica de fallback
          startTime = 0;
        } else {
          // Calcular el final del último clip en esta pista para no solapar
          const lastClip = [...targetTrack.clips].sort((a, b) => (b.startTime + b.duration) - (a.startTime + a.duration))[0];
          startTime = lastClip ? (lastClip.startTime + lastClip.duration) : 0;
          console.log(`Añadiendo a continuación en ${targetTrack.name} en el segundo ${startTime}`);
        }
      }

      if (targetTrack) {
        let thumbnailUrl = fileUrl;
        let duration = 3;

        if (uploadType === 'audio') {
          getAudioDuration(file, (realDuration) => {
            duration = realDuration;
            addClipWithThumbnail(startTime);
          });
        } else if (uploadType === 'video') {
          getVideoDuration(file, (realDuration) => {
            duration = realDuration;
            generateVideoThumbnail(fileUrl, (thumb) => {
              thumbnailUrl = thumb;
              addClipWithThumbnail(startTime);
            });
          });
        } else {
          addClipWithThumbnail(startTime);
        }

        function addClipWithThumbnail(start: number) {
          const newClip: Omit<TimelineClip, 'id' | 'trackId'> = {
            type: trackType,
            startTime: start,
            duration: duration,
            thumbnailUrl: thumbnailUrl,
            mediaFileId: fileUrl,
            ...(uploadType === 'image' && {
              text: file.name.replace(/\.[^/.]+$/, ""),
              fontSize: 24,
              fontFamily: 'Arial',
              color: '#ffffff',
              backgroundColor: 'transparent'
            }),
            overlayTint: undefined
          };

          handleAddClip(targetTrack!.id, newClip);
        }
      }
    });
    setIsUploaderOpen(false);
  };

  const generateVideoThumbnail = (videoUrl: string, callback: (thumbnail: string) => void) => {
    const video = document.createElement('video');
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    if (!videoUrl.startsWith('blob:') && !videoUrl.startsWith('data:')) video.crossOrigin = 'anonymous';

    const timer = setTimeout(() => {
      callback(videoUrl);
    }, 8000);

    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(1, video.duration / 2 || 1);
      } catch {
        clearTimeout(timer);
        callback(videoUrl);
      }
    };

    video.onseeked = () => {
      clearTimeout(timer);
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 180;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.7);
        callback(thumbnailUrl);
      } else {
        callback(videoUrl);
      }
    };

    video.onerror = () => {
      clearTimeout(timer);
      callback(videoUrl);
    };

    video.load();
  };

  const handleStartLtxServers = async () => {
    if (!isElectron()) { setLtxServerMessage('Solo disponible en la app de escritorio'); return; }
    setIsStartingLtxServers(true);
    setLtxServerMessage(null);
    try {
      setLtxServerMessage('Iniciando ComfyUI...');
      const c = await startComfyUI();
      if (!c.success) throw new Error(c.error || 'No se pudo iniciar ComfyUI');
      setLtxServerMessage('ComfyUI listo. Iniciando Flux Bridge...');
      const b = await startFluxBridge();
      if (!b.success) throw new Error(b.error || 'No se pudo iniciar Flux Bridge');
      setLtxServerStatus({ comfyui: true, fluxBridge: true });
      setLtxServerMessage('Servidores listos. Ya puedes generar vídeo.');
      // Recargar el workflow guardado desde disco (por si lo re-exportaste en ComfyUI)
      if (ltxWorkflowPath) await loadLtxWorkflowFromPath(ltxWorkflowPath);
    } catch (e: any) {
      setLtxServerMessage(e.message || 'Error iniciando servidores');
    } finally {
      setIsStartingLtxServers(false);
    }
  };

  // Parar y rearrancar solo el Flux Bridge (para que coja cambios de flux-bridge.py sin reiniciar toda la app)
  const handleRestartBridge = async () => {
    if (!isElectron()) { setLtxServerMessage('Solo disponible en la app de escritorio'); return; }
    setIsStartingLtxServers(true);
    setLtxServerMessage('Reiniciando Flux Bridge...');
    try {
      await stopFluxBridge();
      // pequeña espera para que libere el puerto 5081
      await new Promise((r) => setTimeout(r, 1500));
      const b = await startFluxBridge();
      if (!b.success) throw new Error(b.error || 'No se pudo iniciar Flux Bridge');
      setLtxServerMessage('Flux Bridge reiniciado con el código actualizado.');
      if (ltxWorkflowPath) await loadLtxWorkflowFromPath(ltxWorkflowPath);
    } catch (e: any) {
      setLtxServerMessage(e.message || 'Error reiniciando Flux Bridge');
    } finally {
      setIsStartingLtxServers(false);
    }
  };

  const handleLtxWorkflowFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    try {
      const txt = await f.text();
      const parsed = JSON.parse(txt);
      setLtxWorkflowJson(parsed);
      setLtxWorkflowName(f.name);
      // Guardar la ruta absoluta para recargarlo solo la próxima vez
      const path = getFilePath(f);
      if (path) setLtxWorkflowPath(path);
      setLtxError(null);
    } catch {
      setLtxWorkflowJson(null);
      setLtxWorkflowName('');
      setLtxError('El archivo no es un JSON de workflow válido.');
    }
  };

  const handleSam2WorkflowFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    try {
      const txt = await f.text();
      const parsed = JSON.parse(txt);
      setSam2WorkflowJson(parsed);
      setSam2WorkflowName(f.name);
      const path = getFilePath(f);
      if (path) {
        setSam2WorkflowPath(path);
        try { const c = loadSam2Settings(); localStorage.setItem(SAM2_SETTINGS_KEY, JSON.stringify({ ...c, workflowPath: path })); } catch {}
      }
      setSam2Error(null);
    } catch {
      setSam2WorkflowJson(null);
      setSam2WorkflowName('');
      setSam2Error('El archivo no es un JSON de workflow válido.');
    }
  };

  const handleLtxImageFile = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    if (ltxImagePreviewUrl) URL.revokeObjectURL(ltxImagePreviewUrl);
    setLtxImageFile(f);
    setLtxImagePreviewUrl(URL.createObjectURL(f));
  };

  const captureCurrentPreviewFrame = () => {
    setLtxError(null);
    // El preview visible ahora es el <canvas> compuesto por el scene graph
    // (previewCanvasRef), no el <video> oculto (videoRef). Capturamos de ahí
    // para obtener exactamente lo que ve el usuario (con transiciones/filtros)
    // y porque sus frames vienen de mediabunny (ImageBitmap) -> no tainta el
    // canvas, a diferencia del <video> con URL media:// sin crossOrigin.
    const previewCanvas = previewCanvasRef.current;
    const video = videoRef.current;
    const useCanvas = previewCanvas && previewCanvas.width > 0 && previewCanvas.height > 0;
    const source: HTMLCanvasElement | HTMLVideoElement | null =
      useCanvas
        ? previewCanvas!
        : (video && video.videoWidth ? video : null);
    if (!source) {
      setLtxError('No hay frame disponible en el preview para capturar. Carga un vídeo o pulsa play/pausa primero.');
      return;
    }
    try {
      const w = (source as any).videoWidth || (source as any).width;
      const h = (source as any).videoHeight || (source as any).height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { setLtxError('No se pudo crear el canvas.'); return; }
      ctx.drawImage(source as any, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) { setLtxError('Frame vacío o canvas bloqueado (vídeo de otro origen). Sube la imagen manualmente.'); return; }
        if (ltxImagePreviewUrl) URL.revokeObjectURL(ltxImagePreviewUrl);
        const file = new File([blob], 'frame.png', { type: 'image/png' });
        setLtxImageFile(file);
        setLtxImagePreviewUrl(URL.createObjectURL(file));
        setLtxError(null);
      }, 'image/png');
    } catch {
      setLtxError('No se pudo capturar el frame (canvas taint). Sube la imagen manualmente.');
    }
  };

  const addVideoFileAsClip = (videoUrl: string, label: string) => {
    if (!editState.timeline) return;
    const videoTracks = editState.timeline.tracks.filter((t) => t.type === 'video') || [];
    let targetTrack = videoTracks.find((t) => t.clips.length === 0) || videoTracks[0];
    let startTime = 0;
    if (!targetTrack) {
      handleAddTrack('video');
      const nextTracks = editState.timeline.tracks.filter((t) => t.type === 'video');
      targetTrack = nextTracks[0] || editState.timeline.tracks.find((t) => t.type === 'video');
      if (!targetTrack) return;
    } else {
      const lastClip = [...targetTrack.clips].sort((a, b) => (b.startTime + b.duration) - (a.startTime + a.duration))[0];
      startTime = lastClip ? lastClip.startTime + lastClip.duration : 0;
    }
    const addClip = (duration: number, thumbnailUrl: string) => {
      const newClip: Omit<TimelineClip, 'id' | 'trackId'> = {
        type: 'video',
        startTime,
        duration,
        thumbnailUrl,
        mediaFileId: videoUrl,
        label,
        overlayTint: undefined,
        reversed: false,
      };
      handleAddClip(targetTrack!.id, newClip);
    };
    loadVideoMetadata(videoUrl)
      .then(({ duration }) => generateVideoThumbnail(videoUrl, (thumb) => addClip(duration, thumb)))
      .catch(() => addClip(5, videoUrl));
  };

  // Añade un clip ya construido (captura de pantalla: vídeo/imagen o audio de micrófono)
  // al timeline, colocándolo al final de una pista del tipo adecuado. Como addVideoFileAsClip
  // pero el clip ya trae duration/thumbnailUrl/mediaFileId (no hay que leer metadatos).
  const addCapturedClip = (clip: Omit<TimelineClip, 'id' | 'trackId'>) => {
    if (!editState.timeline) return;
    const trackType: TrackType = clip.type === 'audio' ? 'audio' : 'video';
    let targetTrack = (editState.timeline.tracks.filter((t) => t.type === trackType) || [])
      .find((t) => t.clips.length === 0)
      || editState.timeline.tracks.find((t) => t.type === trackType);
    if (!targetTrack) {
      handleAddTrack(trackType);
      targetTrack = editState.timeline.tracks.find((t) => t.type === trackType);
      if (!targetTrack) return;
    }
    const lastClip = [...targetTrack.clips].sort((a, b) => (b.startTime + b.duration) - (a.startTime + a.duration))[0];
    const startTime = lastClip ? lastClip.startTime + lastClip.duration : 0;
    handleAddClip(targetTrack.id, { ...clip, startTime });
  };

  // Convierte una URL media:// del vídeo cargado de vuelta a ruta de disco (para pasársela a ffmpeg).
  // Sin useCallback: es pura y sin dependencias, y debe quedarse fuera del orden de hooks
  // (está después del guard `if (!mounted)`).
  const mediaUrlToPath = (url: string): string => {
    if (!url || typeof url !== 'string') return '';
    if (url.startsWith('media://file?path=')) {
      try { return decodeURIComponent(url.split('path=')[1]); } catch { return ''; }
    }
    return '';
  };

  const handleEnhanceVideo = async (overrides?: {
    scale?: 'no' | '1.5x' | '2x' | '1080p' | '4k'; sharpen?: number; denoise?: number;
    fps?: 'no' | '30' | '60'; motionMci?: boolean; inputPath?: string; fileName?: string;
  }) => {
    setEnhanceError(null);
    let inputPath = overrides?.inputPath ?? enhanceSourcePath;
    if (!inputPath && enhanceSourceFile) {
      inputPath = getFilePath(enhanceSourceFile) || '';
    }
    if (!inputPath) {
      setEnhanceError('Selecciona un vídeo local (o usa "Usar vídeo cargado" si el vídeo cargado es un archivo local).');
      return;
    }

    let paths: any;
    try { paths = await getLocalPaths(); } catch { paths = null; }
    const rootPath = paths?.video || paths?.proyectos_video || paths?.proyectos;
    if (!rootPath) {
      setEnhanceError('No se encontró la carpeta de vídeos. Configura las rutas locales.');
      return;
    }
    try { await ensureDir(rootPath); } catch {}

    const autoBaseName = (enhanceSourceFile?.name || inputPath.replace(/\\/g, '/').split('/').pop() || 'video')
      .replace(/\.[^.]+$/, '');
    const autoName = `Mejorado_${autoBaseName}.mp4`;
    const customRaw = (overrides?.fileName ?? enhanceFileName ?? '').trim();
    const outName = customRaw
      ? (customRaw.toLowerCase().endsWith('.mp4') ? customRaw : `${customRaw.replace(/\.[^.]+$/, '')}.mp4`)
      : autoName;
    const safeOutName = outName.replace(/[\\/:*?"<>|]+/g, '_');
    const outputPath = `${rootPath}\\${safeOutName}`;

    setEnhanceBusy(true);
    setEnhanceProgress(0);
    try {
      const res = await enhanceVideo(
        {
          inputPath, outputPath,
          scale: overrides?.scale ?? enhanceScale,
          sharpen: overrides?.sharpen ?? enhanceSharpen,
          denoise: overrides?.denoise ?? enhanceDenoise,
          fps: overrides?.fps ?? enhanceFps,
          motionMci: overrides?.motionMci ?? enhanceMotion,
        },
        (p) => setEnhanceProgress(p < 0 ? 0 : p)
      );
      if (res.success && res.outputPath) {
        const mediaUrl = (window as any).electronAPI?.getMediaUrl ? (window as any).electronAPI.getMediaUrl(res.outputPath) : res.outputPath;
        try { toast({ title: 'Vídeo mejorado', description: `${safeOutName} guardado en ${rootPath}` }); } catch {}
        addVideoFileAsClip(mediaUrl, `Mejorado · ${safeOutName.replace(/\.mp4$/i, '')}`);
        setEnhanceSourceFile(null);
        setEnhanceSourcePath('');
      } else {
        setEnhanceError(res.error || 'No se pudo mejorar el vídeo.');
        try { toast({ title: 'No se pudo mejorar el vídeo', description: res.error || '', variant: 'destructive' }); } catch {}
      }
    } catch (e: any) {
      setEnhanceError(e?.message || 'Error al mejorar el vídeo.');
    } finally {
      setEnhanceBusy(false);
    }
  };

  // --- HTML/Web a MP4: renderiza el HTML o una URL en una ventana oculta de Electron y lo pasa a MP4 ---
  const handleHtmlToMp4 = async (overrides?: {
    htmlPath?: string; zipPath?: string; url?: string; duration?: number; speed?: number;
    fps?: number; width?: number; height?: number; fileName?: string;
  }) => {
    setHtmlError(null);
    // El path/url puede venir por overrides (IA) o desde la UI (htmlSrcFile / webUrl + htmlMode).
    const ovUrl = overrides?.url?.trim();
    const ovPath = overrides?.zipPath ?? overrides?.htmlPath;
    const inputPath = (ovPath ?? (htmlSrcFile ? getFilePath(htmlSrcFile) : '')) ?? '';
    const url = ovUrl ?? (htmlMode === 'url' ? webUrl.trim() : '');
    if (!inputPath && !url) {
      setHtmlError(htmlMode === 'url' ? 'Pega una URL web (https://…).' : 'Selecciona un archivo ZIP (proyecto HTML) o un .html.');
      return;
    }
    const isZip = !url && ((overrides?.zipPath ? true : overrides?.htmlPath ? false : htmlSrcFile?.name.toLowerCase().endsWith('.zip')) as boolean);

    let paths: any;
    try { paths = await getLocalPaths(); } catch { paths = null; }
    const rootPath = paths?.video || paths?.proyectos_video || paths?.proyectos;
    if (!rootPath) { setHtmlError('No se encontró la carpeta de vídeos. Configura las rutas locales.'); return; }
    try { await ensureDir(rootPath); } catch {}

    const fileBaseName = (htmlSrcFile?.name || inputPath.replace(/\\/g, '/').split('/').pop() || 'html').replace(/\.[^.]+$/, '');
    let urlBaseName = 'web';
    if (url) { try { urlBaseName = (new URL(url).hostname || 'web').replace(/^www\./, ''); } catch {} }
    const autoBaseName = url ? urlBaseName : fileBaseName;
    const autoName = `${url ? 'Web' : 'HTML'}_${autoBaseName}.mp4`;
    const customRaw = (overrides?.fileName ?? (htmlMode === 'url' ? webFileName : htmlFileName) ?? '').trim();
    const outName = customRaw
      ? (customRaw.toLowerCase().endsWith('.mp4') ? customRaw : `${customRaw.replace(/\.[^.]+$/, '')}.mp4`)
      : autoName;
    const safeOutName = outName.replace(/[\\/:*?"<>|]+/g, '_');
    const outputPath = `${rootPath}\\${safeOutName}`;
    const jobId = `html-${Date.now()}`;

    let w: number, h: number;
    if (overrides?.width && overrides?.height) {
      w = overrides.width; h = overrides.height;
    } else {
      [w, h] = htmlResolution.split('x').map(Number);
    }

    setHtmlBusy(true);
    setHtmlProgress(0);
    try {
      const res = await htmlToMp4(
        {
          zipPath: url ? null : (isZip ? inputPath : null),
          htmlPath: url ? null : (isZip ? null : inputPath),
          url: url || null,
          duration: overrides?.duration ?? htmlDuration,
          speed: overrides?.speed ?? htmlSpeed,
          fps: overrides?.fps ?? htmlFps,
          width: w,
          height: h,
          outputPath,
          jobId,
        },
        (p) => setHtmlProgress(p < 0 ? 0 : p)
      );
      if (res.success && res.outputPath) {
        const mediaUrl = (window as any).electronAPI?.getMediaUrl ? (window as any).electronAPI.getMediaUrl(res.outputPath) : res.outputPath;
        try { toast({ title: url ? 'Web convertida a MP4' : 'HTML convertido a MP4', description: `${safeOutName} guardado en ${rootPath}` }); } catch {}
        addVideoFileAsClip(mediaUrl, `${url ? 'Web' : 'HTML'} · ${safeOutName.replace(/\.mp4$/i, '')}`);
        setHtmlSrcFile(null);
        if (url) setWebUrl('');
      } else {
        setHtmlError(res.error || 'No se pudo convertir a MP4.');
        try { toast({ title: 'No se pudo convertir', description: res.error || '', variant: 'destructive' }); } catch {}
      }
    } catch (e: any) {
      setHtmlError(e?.message || 'Error al convertir a MP4.');
    } finally {
      setHtmlBusy(false);
    }
  };

  // --- WebM/Vídeo a MP4: transcodea un archivo de vídeo existente (WebM, MOV, AVI…)
  //     a MP4/H.264 con ffmpeg (IPC video:transcode). No captura frames, sólo transcodea.
  //     Reutiliza el estado de progreso/ocupado de la pestaña (htmlBusy/htmlProgress).
  const handleWebToMp4 = async (overrides?: { inputPath?: string; fileName?: string }) => {
    setHtmlError(null);
    const ovPath = overrides?.inputPath?.trim();
    const inputPath = (ovPath ?? (webSrcFile ? getFilePath(webSrcFile) : '')) ?? '';
    if (!inputPath) {
      setHtmlError('Selecciona un archivo de vídeo (WebM, MP4, MOV, AVI…).');
      return;
    }

    let paths: any;
    try { paths = await getLocalPaths(); } catch { paths = null; }
    const rootPath = paths?.video || paths?.proyectos_video || paths?.proyectos;
    if (!rootPath) { setHtmlError('No se encontró la carpeta de vídeos. Configura las rutas locales.'); return; }
    try { await ensureDir(rootPath); } catch {}

    const fileBaseName = (webSrcFile?.name || overrides?.inputPath || inputPath.replace(/\\/g, '/').split('/').pop() || 'video').replace(/\.[^.]+$/, '');
    const autoName = `${fileBaseName}.mp4`;
    const customRaw = (overrides?.fileName ?? webmFileName ?? '').trim();
    const outName = customRaw
      ? (customRaw.toLowerCase().endsWith('.mp4') ? customRaw : `${customRaw.replace(/\.[^.]+$/, '')}.mp4`)
      : autoName;
    const safeOutName = outName.replace(/[\\/:*?"<>|]+/g, '_');
    const outputPath = `${rootPath}\\${safeOutName}`;

    setHtmlBusy(true);
    setHtmlProgress(0);
    try {
      const res = await transcodeVideo(inputPath, outputPath, (percent) => {
        setHtmlProgress(percent < 0 ? 0 : percent);
      });
      if (res.success && res.outputPath) {
        const mediaUrl = (window as any).electronAPI?.getMediaUrl ? (window as any).electronAPI.getMediaUrl(res.outputPath) : res.outputPath;
        try { toast({ title: 'Vídeo convertido a MP4', description: `${safeOutName} guardado en ${rootPath}` }); } catch {}
        addVideoFileAsClip(mediaUrl, `Vídeo · ${safeOutName.replace(/\.mp4$/i, '')}`);
        setWebSrcFile(null);
        setWebmFileName('');
      } else {
        setHtmlError(res.error || 'No se pudo convertir el vídeo a MP4.');
        try { toast({ title: 'No se pudo convertir', description: res.error || '', variant: 'destructive' }); } catch {}
      }
    } catch (e: any) {
      setHtmlError(e?.message || 'Error al convertir el vídeo.');
    } finally {
      setHtmlBusy(false);
    }
  };

  const ensureLtxWorkflowFormat = (wf: Record<string, any>, promptNodeId: string, promptText: string) => {
    let out = JSON.parse(JSON.stringify(wf)) as Record<string, any>;

    // Si es formato grafo, normalizar a formato API
    if (Array.isArray(out.nodes)) {
      const apiFormat: Record<string, any> = {};
      out.nodes.forEach((node: any) => {
        const id = String(node.id ?? '');
        if (!id) return;
        apiFormat[id] = { ...node };
      });
      out = apiFormat;
    }

    // Asegurar que el nodo de prompt existe y tiene el texto
    const nodeId = String(promptNodeId);
    if (!out[nodeId]) {
      out[nodeId] = {
        id: Number(promptNodeId),
        class_type: 'PrimitiveStringMultiline',
        inputs: {},
        widgets_values: [promptText],
      };
    } else {
      out[nodeId].widgets_values = out[nodeId].widgets_values || [];
      out[nodeId].widgets_values[0] = promptText;
    }

    return out;
  };

  const findActualPromptNodeId = (wf: Record<string, any>) => {
    const nodes: any[] = [];
    if (Array.isArray(wf.nodes)) nodes.push(...wf.nodes);
    if (Array.isArray(wf.groups)) {
      wf.groups.forEach((g: any) => {
        const subs = g?.subgraphs;
        if (Array.isArray(subs)) subs.forEach((sg: any) => { if (Array.isArray(sg?.nodes)) nodes.push(...sg.nodes); });
      });
    }
    for (const key of Object.keys(wf)) {
      const n = wf[key];
      if (n && typeof n === 'object' && n.class_type) nodes.push({ id: key, ...n });
    }
    const textNode = nodes.find((n) => /TextEncode|TextEncoder|Prompt|String|Multiline/i.test(n.class_type || '') || (n.inputs && (n.inputs.text || n.inputs.prompt)));
    return textNode ? String((textNode.id ?? textNode.id_str) || '') : '';
  };

  const generateLtxVideo = async (overrides?: {
    prompt?: string; seed?: number; duration?: number; fps?: number;
    width?: number; height?: number; fileName?: string;
  }) => {
    setLtxError(null);
    const prompt = overrides?.prompt ?? ltxPrompt;
    const seed = overrides?.seed ?? ltxSeed;
    const duration = overrides?.duration ?? ltxDuration;
    const fps = overrides?.fps ?? ltxFps;
    const width = overrides?.width ?? ltxWidth;
    const height = overrides?.height ?? ltxHeight;
    const fileName = overrides?.fileName ?? ltxFileName;
    if (!prompt.trim()) { setLtxError('Escribe un prompt.'); return; }
    if (!ltxWorkflowJson) { setLtxError('Carga un workflow de ComfyUI (formato API).'); return; }

    // El ID fijado a mano en la UI manda; la auto-detección es sólo fallback.
    // Antes era al revés y podía elegir el codificador NEGATIVO del workflow,
    // con lo que el vídeo se generaba con el prompt que traía el workflow.
    const actualPromptNodeId = findActualPromptNodeId(ltxWorkflowJson as Record<string, any>);
    const promptNodeToUse = ltxPromptNode.trim() || actualPromptNodeId;
    if (!promptNodeToUse) {
      setLtxError('No se encontró ningún nodo de texto (prompt) en este workflow.');
      return;
    }
    // Nunca inyectar el negativo en el mismo nodo que el prompt: el bridge
    // escribiría el negativo ENCIMA del prompt (condicionamiento vacío o raro).
    const negativeNodeToUse = (ltxNegativeNode.trim() && ltxNegativeNode.trim() !== promptNodeToUse) ? ltxNegativeNode.trim() : '';
    if (duration > 0 && !ltxDurationNode.trim()) {
      setLtxError('Para aplicar la duración, indica también el ID del nodo de frames/length del workflow (campo "Duración del vídeo · opcional").');
      return;
    }

    if (ltxMode === 'i2v') {
      if (!ltxImageNode.trim()) { setLtxError('Indica el ID del nodo LoadImage (modo imagen-a-vídeo).'); return; }
      if (!ltxImageFile) { setLtxError('Sube o captura una imagen de entrada.'); return; }
    } else {
      if (!ltxT2vSwitchNode.trim()) { setLtxError('En modo texto-a-vídeo, indica el ID del nodo "Switch to Text to Video" (ej. 320:302). Sin él, el workflow usará la imagen que tenga el nodo LoadImage.'); return; }
    }

    const workflowForBackend = ensureLtxWorkflowFormat(ltxWorkflowJson as Record<string, any>, promptNodeToUse, prompt);

    setIsGeneratingLtx(true);
    setLtxProgress({ current: 0, total: 1, percent: 0 });
    try {
      const payload = new FormData();
      payload.append('workflow_json', JSON.stringify(workflowForBackend));
      payload.append('prompt', prompt);
      payload.append('negative', ltxNegative);
      payload.append('seed', String(seed));
      payload.append('comfyui_url', ltxComfyUrl);
      payload.append('prompt_node', promptNodeToUse);
      payload.append('negative_node', negativeNodeToUse);
      payload.append('seed_node', ltxSeedNode.trim());
      if (ltxMode === 'i2v') {
        payload.append('image_node', ltxImageNode.trim());
        if (ltxImageFile) payload.append('image_file', ltxImageFile);
      } else {
        if (ltxT2vSwitchNode.trim()) payload.append('t2v_switch_node', ltxT2vSwitchNode.trim());
      }
      if (ltxDurationNode.trim() && duration > 0) {
        // El campo UI es en SEGUNDOS pero el nodo del workflow espera FRAMES:
        // frames = duración × FPS + 1 (antes se mandaban los segundos tal cual
        // y salían vídeos de una fracción de segundo).
        const wf = ltxWorkflowJson as Record<string, any>;
        let wfFps = 0;
        try {
          const fpsInputs = wf?.[ltxFpsNode.trim()]?.inputs;
          for (const k of ['fps', 'frame_rate', 'frames_per_second', 'value']) {
            const v = fpsInputs?.[k];
            if (typeof v === 'number' && v > 0) { wfFps = v; break; }
          }
        } catch {}
        const effFps = fps > 0 ? fps : (wfFps > 0 ? wfFps : 24);
        payload.append('frames_node', ltxDurationNode.trim());
        payload.append('frames', String(Math.max(1, Math.round(duration * effFps) + 1)));
      }
      if (ltxFpsNode.trim() && fps > 0) {
        payload.append('fps_node', ltxFpsNode.trim());
        payload.append('fps', String(fps));
      }
      if (ltxWidthNode.trim() && width > 0) {
        payload.append('width_node', ltxWidthNode.trim());
        payload.append('width', String(width));
      }
      if (ltxHeightNode.trim() && height > 0) {
        payload.append('height_node', ltxHeightNode.trim());
        payload.append('height', String(height));
      }

      const res = await fetch('http://localhost:5081/ltx/', { method: 'POST', body: payload });
      if (!res.ok) {
        if (res.status === 404) throw new Error('El Flux Bridge no está disponible. Pulsa "Iniciar Servidores".');
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `Error ${res.status}`);
      }
      const data = await res.json();
      const jobId = data?.job_id;
      if (!jobId) throw new Error('El bridge no devolvió job_id.');

      let videoPath: string | null = null;
      // 3600 × 2s = 120 min de espera máx: con el modelo LTX 22B + upscaler una
      // generación puede superar los 30 min (el límite anterior daba timeout).
      for (let i = 0; i < 3600; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await fetch(`http://localhost:5081/ltx/status/${jobId}`);
        if (!st.ok) continue;
        const sd = await st.json();
        if (sd.progress) setLtxProgress(sd.progress);
        if (sd.status === 'completed') { videoPath = sd?.video?.url || null; break; }
        if (sd.status === 'error') throw new Error(sd.error || 'Error en ComfyUI.');
      }
      setLtxProgress(null);
      if (!videoPath) throw new Error('Timeout esperando el vídeo de ComfyUI.');

      // Persistir el MP4 generado en la carpeta de vídeos (igual que HTML→MP4 y
      // Mejorar calidad): el bridge lo deja en un temporal (%TEMP%\zms-ltx\...), así
      // que lo copiamos a paths.video y montamos el clip desde ese archivo real. Así
      // el usuario no tiene que exportar después para tener el MP4 en su carpeta.
      let finalVideoPath = videoPath;
      if (isElectron() && window.electronAPI && /^[A-Za-z]:\\/.test(videoPath)) {
        try {
          const lpaths = await getLocalPaths();
          const vroot = lpaths?.video || lpaths?.proyectos_video || lpaths?.proyectos;
          if (vroot) {
            await ensureDir(vroot);
            const autoBase = ((prompt.slice(0, 24) || 'ltx')
              .replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')).slice(0, 24) || 'ltx';
            const autoName = `LTX_${autoBase}.mp4`;
            const customRaw = (fileName || '').trim();
            const rawName = customRaw
              ? (customRaw.toLowerCase().endsWith('.mp4') ? customRaw : `${customRaw.replace(/\.[^.]+$/, '')}.mp4`)
              : autoName;
            const destName = rawName.replace(/[\\/:*?"<>|]+/g, '_');
            const destPath = `${vroot}\\${destName}`;
            try {
              await copyFile(videoPath, destPath);
              finalVideoPath = destPath;
              try { toast({ title: 'Vídeo LTX guardado', description: `${destName} en ${vroot}` }); } catch {}
            } catch (e) {
              console.warn('No se pudo copiar el MP4 de LTX a la carpeta de vídeos (se usa el temporal):', e);
            }
          }
        } catch (e) {
          console.warn('getLocalPaths falló en LTX (se usa el temporal):', e);
        }
      }

      let mediaUrl = finalVideoPath;
      if (isElectron() && window.electronAPI?.getMediaUrl && /^[A-Za-z]:\\/.test(finalVideoPath)) {
        mediaUrl = window.electronAPI.getMediaUrl(finalVideoPath);
      }
      addVideoFileAsClip(mediaUrl, `LTX · ${prompt.slice(0, 24) || 'vídeo'}`);
    } catch (e: any) {
      console.error(e);
      setLtxError(e.message || 'Error al generar el vídeo.');
    } finally {
      setIsGeneratingLtx(false);
    }
  };

  const openUploader = (type: 'video' | 'audio' | 'image') => {
    setUploadType(type);
    setFileNotAllowedMessage(null);
    setPbLoadStep('collection');
    setSelectedPbCollection(null);
    setPbRecords([]);
    setSelectedPbRecordFiles(null);
    setPbLoading(true);
    setIsUploaderOpen(true);

    const applyCollections = (items: { id: string; name: string }[]) => {
      setPbCollections(items);
      setPbLoading(false);
    };

    const fallbackCollections = [
      { id: 'video', name: 'video' },
      { id: 'audio', name: 'audio' },
      { id: 'imagen', name: 'imagen' },
    ];

    const useApi = () => {
      fetch('/api/collections')
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
        .then((data) => {
          const items = Array.isArray(data?.items) ? data.items : [];
          if (items.length > 0) applyCollections(items.map((c: any) => ({ id: c.id || c.name, name: c.name })));
          else applyCollections(fallbackCollections);
        })
        .catch(() => applyCollections(fallbackCollections));
    };

    // Primero desde el cliente (1 petición directa a PocketBase = más rápido)
    if (pb.authStore.isValid) {
      pb.collections
        .getFullList({ requestKey: 'uploader-collections' })
        .then((all) => {
          const filtered = all.filter(
            (c: { type?: string; name?: string }) =>
              c.type === 'base' && !['users', 'proyectos', 'notificaciones', 'logs'].includes(c.name || '')
          );
          if (filtered.length > 0) {
            applyCollections(filtered.map((c: { id: string; name: string }) => ({ id: c.id || c.name, name: c.name })));
          } else {
            useApi();
          }
        })
        .catch(() => useApi());
    } else {
      useApi();
    }
  };

  const VIDEO_EXT = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogv'];
  const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'webm'];
  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];

  const getExtensionsForType = (type: 'video' | 'audio' | 'image') => {
    if (type === 'video') return VIDEO_EXT;
    if (type === 'audio') return AUDIO_EXT;
    return IMAGE_EXT;
  };

  const isFileAllowed = (fileName: string, type: 'video' | 'audio' | 'image') => {
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    return getExtensionsForType(type).includes(ext);
  };

  const openLocalFilePicker = (type: 'video' | 'audio' | 'image') => {
    pendingLocalUploadTypeRef.current = type;
    setUploadType(type);
    setFileNotAllowedMessage(null);
    const accept = type === 'video'
      ? 'video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska,video/ogg'
      : type === 'audio'
        ? 'audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/flac,audio/aac,audio/webm'
        : 'image/jpeg,image/png,image/gif,image/webp,image/bmp,image/svg+xml';
    const input = uploadLocalInputRef;
    if (input) {
      input.accept = accept;
      input.value = '';
      input.click();
    }
  };

  const handleLocalFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editState.timeline) return;
    const type = pendingLocalUploadTypeRef.current;
    if (!isFileAllowed(file.name, type)) {
      alert('Archivo no permitido para este tipo. Formatos: ' + (type === 'video' ? 'mp4, webm, mov, avi, mkv, ogv' : type === 'audio' ? 'mp3, wav, ogg, m4a, flac, aac, webm' : 'jpg, png, gif, webp, bmp, svg'));
      return;
    }
    setFileNotAllowedMessage(null);
    const fileUrl = URL.createObjectURL(file);
    const trackType: TrackType = type === 'image' ? 'video' : type;
    const allTracksOfType = editState.timeline.tracks.filter((t) => t.type === trackType) || [];
    let targetTrack = allTracksOfType.find((t) => t.clips.length === 0);
    let startTime = 0;
    if (!targetTrack) {
      targetTrack = allTracksOfType[0];
      if (targetTrack) {
        const lastClip = [...targetTrack.clips].sort((a, b) => b.startTime + b.duration - (a.startTime + a.duration))[0];
        startTime = lastClip ? lastClip.startTime + lastClip.duration : 0;
      } else {
        handleAddTrack(trackType);
        const nextTracks = editState.timeline.tracks.filter((t) => t.type === trackType);
        targetTrack = nextTracks[0] || editState.timeline.tracks.find((t) => t.type === trackType);
      }
    }
    if (!targetTrack) return;
    const addClip = (duration: number, thumbnailUrl: string) => {
      const newClip: Omit<TimelineClip, 'id' | 'trackId'> = {
        type: trackType,
        startTime,
        duration,
        thumbnailUrl,
        mediaFileId: fileUrl,
        label: cleanDisplayFileName(file.name),
        ...(type === 'image' && {
          text: cleanDisplayFileName(file.name).replace(/\.[^/.]+$/, ''),
          fontSize: 24,
          fontFamily: 'Arial',
          color: '#ffffff',
          backgroundColor: 'transparent',
        }),
        overlayTint: undefined
      };
      handleAddClip(targetTrack!.id, newClip);
    };
    if (type === 'audio') {
      loadAudioMetadata(fileUrl).then(({ duration }) => addClip(duration, fileUrl)).catch(() => addClip(5, fileUrl));
    } else if (type === 'video') {
      loadVideoMetadata(fileUrl).then(({ duration }) => {
        generateVideoThumbnail(fileUrl, (thumb) => addClip(duration, thumb));
      }).catch(() => addClip(10, fileUrl));
    } else {
      addClip(3, fileUrl);
    }
  };

  const fetchPbRecordsForCollection = (collectionName: string) => {
    setPbLoading(true);
    setSelectedPbCollection(collectionName);
    const allowedExt = getExtensionsForType(uploadType);
    pb.collection(collectionName)
      .getFullList({ sort: '-created', requestKey: `records_${collectionName}` })
      .then((records: any[]) => {
        const out: { recordId: string; recordName: string; files: { url: string; fileName: string }[] }[] = [];
        for (const record of records) {
          const fileFields = Object.keys(record).filter((k) => {
            const v = record[k];
            if (!v) return false;
            if (typeof v === 'string' && v.includes('.')) return true;
            if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') return true;
            return false;
          }).filter((k) => !['id', 'collectionId', 'collectionName', 'created', 'updated'].includes(k));
          const files: { url: string; fileName: string }[] = [];
          for (const fieldName of fileFields) {
            const fileValue = record[fieldName];
            const list = Array.isArray(fileValue) ? fileValue : [fileValue];
            for (const file of list) {
              if (typeof file !== 'string' || !file.includes('.')) continue;
              const ext = (file.split('.').pop() || '').toLowerCase();
              if (!allowedExt.includes(ext)) continue;
              files.push({ url: pb.files.getURL(record, file), fileName: file });
            }
          }
          if (files.length > 0) {
            out.push({
              recordId: record.id,
              recordName: record.titulo || record.name || record.id,
              files,
            });
          }
        }
        setPbRecords(out);
        setPbLoadStep('record');
      })
      .catch((e) => console.error(e))
      .finally(() => setPbLoading(false));
  };

  const openLocalFolderResources = async (type: 'video' | 'audio' | 'image') => {
    setUploadType(type);
    setPbLoading(true);
    try {
      const paths = await getLocalPaths();

      const category = type === 'image' ? 'imagen' : type;
      const folder = paths[category];

      if (!folder) {
        alert(`No hay una carpeta configurada para ${type === 'image' ? 'imagen' : type} en la pestaña Archivos.`);
        return;
      }

      setIsUploaderOpen(true);
      setPbLoadStep('local');

      const files = await listDirectory(folder, category);
      setLocalFolderFiles(files || []);
    } catch (e) {
      console.error(e);
      alert('Error al cargar recursos locales.');
    } finally {
      setPbLoading(false);
    }
  };

  const addMediaFileToTimeline = (file: { url?: string; path?: string; fileName?: string; name?: string }) => {
    if (!editState.timeline) return;
    const actualName = file.name || file.fileName || 'archivo';
    if (!isFileAllowed(actualName, uploadType)) {
      setFileNotAllowedMessage('Archivo no permitido');
      return;
    }
    setFileNotAllowedMessage(null);

    const fileUrl = file.path
      ? `${getMediaUrl(file.path)}`
      : resolveUrl(file.url!);

    // Si es una imagen, descargarla y convertirla en efecto personalizado
    if (uploadType === 'image') {
      setPbLoading(true);
      fetch(fileUrl)
        .then(response => {
          if (!response.ok) throw new Error('Error al descargar la imagen');
          return response.blob();
        })
        .then(blob => {
          const extension = actualName.toLowerCase().endsWith('.jpg') || actualName.toLowerCase().endsWith('.jpeg') ? 'jpg' : 
                          actualName.toLowerCase().endsWith('.gif') ? 'gif' : 'png';
          const mimeType = extension === 'jpg' ? 'image/jpeg' : 
                          extension === 'gif' ? 'image/gif' : 'image/png';
          const fileObj = new File([blob], actualName, { type: mimeType });
          
          createCustomEffectFromFile(
            fileObj,
            actualName.replace(/\.[^/.]+$/, ''),
            (effect) => {
              // El efecto se ha creado y registrado automáticamente
              setIsUploaderOpen(false);
              setPbLoadStep('collection');
              setSelectedPbRecordFiles(null);
              setSelectedPbCollection(null);
              setLocalFolderFiles([]);
              setPbLoading(false);
            },
            (error) => {
              console.error('Error al crear efecto:', error);
              alert('Error al crear efecto: ' + error);
              setPbLoading(false);
            }
          );
        })
        .catch(error => {
          console.error('Error al descargar imagen:', error);
          alert('Error al descargar la imagen');
          setPbLoading(false);
        });
      return;
    }

    const trackType: TrackType = uploadType as 'video' | 'audio';
    const allTracksOfType = editState.timeline.tracks.filter((t) => t.type === trackType) || [];
    let targetTrack = allTracksOfType.find((t) => t.clips.length === 0);
    let startTime = 0;
    if (!targetTrack) {
      targetTrack = allTracksOfType[0];
      if (targetTrack) {
        const lastClip = [...targetTrack.clips].sort((a, b) => b.startTime + b.duration - (a.startTime + a.duration))[0];
        startTime = lastClip ? lastClip.startTime + lastClip.duration : 0;
      }
    }

    if (targetTrack) {
      const addClip = (duration: number, thumbnailUrl: string) => {
        const newClip: Omit<TimelineClip, 'id' | 'trackId'> = {
          type: trackType,
          startTime,
          duration,
          thumbnailUrl,
          mediaFileId: fileUrl,
          label: cleanDisplayFileName(actualName),
          overlayTint: undefined
        };
        handleAddClip(targetTrack!.id, newClip);
        setIsUploaderOpen(false);
      };

      if (uploadType === 'audio') {
        loadAudioMetadata(fileUrl).then(({ duration }) => {
          addClip(duration, fileUrl);
        }).catch(() => addClip(5, fileUrl));
      } else if (uploadType === 'video') {
        loadVideoMetadata(fileUrl).then(({ duration }) => {
          generateVideoThumbnail(fileUrl, (thumb) => addClip(duration, thumb));
        }).catch(() => addClip(10, fileUrl));
      } else {
        addClip(3, fileUrl);
      }
    }
  };

  const addExportedVideoToTimeline = (url: string, name: string) => {
    if (!editState.timeline) return;
    const targetTrack = editState.timeline.tracks.find((t) => t.type === 'video');
    if (!targetTrack) return;
    loadVideoMetadata(url).then(({ duration }) => {
      generateVideoThumbnail(url, (thumb) => {
        handleAddClip(targetTrack.id, {
          type: 'video',
          startTime: 0,
          duration,
          thumbnailUrl: thumb,
          mediaFileId: url,
          label: cleanDisplayFileName(name),
          overlayTint: undefined
        });
      });
    }).catch(() => {
      handleAddClip(targetTrack.id, {
        type: 'video',
        startTime: 0,
        duration: 10,
        thumbnailUrl: url,
        mediaFileId: url,
        label: cleanDisplayFileName(name),
        overlayTint: undefined
      });
    });
  };

  const selectPbRecordForFiles = (record: { recordId: string; recordName: string; files: { url: string; fileName: string }[] }) => {
    setSelectedPbRecordFiles(record.files);
    setPbLoadStep('file');
  };

  const addOneClipFromPb = (item: { url: string; fileName: string }) => {
    addMediaFileToTimeline(item);
  };

  const handleAddTrack = (type: TrackType) => {
    if (!editState.timeline) return;

    const newTrack: TimelineTrack = {
      id: `${type}-${Date.now()}`,
      type,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${editState.timeline.tracks.filter(t => t.type === type).length + 1}`,
      clips: [],
      isLocked: false
    };

    if (type === 'audio') {
      newTrack.isMuted = false;
      newTrack.volume = 1;
    }

    setEditState(prev => ({
      ...prev,
      timeline: {
        ...prev.timeline!,
        tracks: [...prev.timeline!.tracks, newTrack]
      }
    }));
   };

   const handleAddEffectsTrack = (afterTrackId: string) => {
     if (!editState.timeline) return;
     const tracks = editState.timeline.tracks;
     const insertIdx = tracks.findIndex(t => t.id === afterTrackId);
     if (insertIdx < 0) return;
     const newTrack = createEffectsTrack();
     const nextTracks = [
       ...tracks.slice(0, insertIdx + 1),
       newTrack,
       ...tracks.slice(insertIdx + 1),
     ];
     setEditState(prev => ({
       ...prev,
       timeline: {
         ...prev.timeline!,
         tracks: nextTracks
       }
     }));
   };

   const fetchTtsAudio = async (textToSpeak?: string) => {
    const text = (textToSpeak ?? ttsText).trim();
    if (!text) return null;
    const res = await fetch(`/api/text-to-speech?t=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: ttsVoice,
        rate: ttsRate,
        pitch: ttsPitch,
        volume: ttsVolume,
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Error ${res.status}`);
    }
    return res.blob();
  };

  const handleTextToSpeechPreview = async () => {
    const text = ttsText.trim();
    if (!text) return;
    setTtsError(null);
    setTtsLoading(true);
    try {
      const blob = await fetchTtsAudio(text);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (e) {
      setTtsError(e instanceof Error ? e.message : 'Error al generar el audio');
    } finally {
      setTtsLoading(false);
    }
  };

  const handleTextToSpeech = async () => {
    const text = ttsText.trim();
    if (!text || !editState.timeline) return;

    setTtsError(null);
    setTtsLoading(true);
    try {
      const blob = await fetchTtsAudio(text);
      if (!blob) return;
      const sequence = generatedAudioSequenceRef.current + 1;
      generatedAudioSequenceRef.current = sequence;
      const fileName = createGeneratedAudioFileName(ttsVoice, text, blob.type, sequence);
      const fileUrl = URL.createObjectURL(blob);
      const asset: GeneratedAudioAsset = { blob, voice: ttsVoice, text, fileName };
      generatedAssetsRef.current.set(fileUrl, asset);
      generatedAudioMetadataRef.current.set(fileUrl, fileName);
      const audio = document.createElement('audio');
      audio.src = fileUrl;
      await new Promise<void>((resolve, reject) => {
        audio.addEventListener('loadedmetadata', () => resolve());
        audio.addEventListener('error', () => reject(new Error('No se pudo cargar el audio')));
      });
      const duration = audio.duration;
      uploadGeneratedAudioToLocalFolder(asset).catch(() => { });

      const allAudioTracks = editState.timeline.tracks.filter((t) => t.type === 'audio');
      let targetTrack = allAudioTracks.find((t) => t.clips.length === 0);
      let startTime = 0;
      if (!targetTrack) {
        targetTrack = allAudioTracks[0];
        if (targetTrack) {
          const lastClip = [...targetTrack.clips].sort(
            (a, b) => b.startTime + b.duration - (a.startTime + a.duration)
          )[0];
          startTime = lastClip ? lastClip.startTime + lastClip.duration : 0;
        }
      }

      if (targetTrack) {
        handleAddClip(targetTrack.id, {
          type: 'audio',
          startTime,
          duration,
          mediaFileId: fileUrl,
          thumbnailUrl: fileUrl,
          label: 'Texto a audio',
          overlayTint: undefined
        });
      } else {
        const tl = editState.timeline;
        const trackId = `audio-${Date.now()}`;
        const clipId = `clip-${Date.now()}`;
        const newAudioTrack: TimelineTrack = {
          id: trackId,
          type: 'audio',
          name: `Audio ${tl.tracks.filter((t) => t.type === 'audio').length + 1}`,
          clips: [{
            id: clipId,
            trackId,
            type: 'audio',
            startTime,
            duration,
            mediaFileId: fileUrl,
            thumbnailUrl: fileUrl,
            label: 'Texto a audio',
            overlayTint: undefined
          }],
          isLocked: false,
          isMuted: false,
          volume: 1,
        };
        setEditState((prev) => ({
          ...prev,
          timeline: {
            ...prev.timeline!,
            tracks: [...prev.timeline!.tracks, newAudioTrack],
          },
        }));
      }
      setTtsText('');
    } catch (e) {
      setTtsError(e instanceof Error ? e.message : 'Error al generar el audio');
    } finally {
      setTtsLoading(false);
    }
  };

  const handleReadScriptAloud = (startIndex: number = 0) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    // Detener todo antes de empezar
    window.speechSynthesis.cancel();

    // Si ya está leyendo y pulsamos el botón de inicio (0), es un STOP total
    if (isReadingRef.current && startIndex === 0) {
      isReadingRef.current = false;
      isPausedRef.current = false;
      setTimeout(() => {
        setIsReadingScript(false);
        setIsReadingPaused(false);
        setCurrentScriptIndex(-1);
      }, 0);
      return;
    }

    if (scriptSentences.length === 0) return;

    // Activamos refs de inmediato para que la lógica fluya sin esperar a React
    isReadingRef.current = true;
    isPausedRef.current = false;

    // Actualizamos UI en segundo plano para no bloquear el inicio de la voz
    setTimeout(() => {
      setIsReadingScript(true);
      setIsReadingPaused(false);
    }, 0);

    const speakSentence = (index: number) => {
      // Verificamos contra la REF, que es síncrona
      if (index >= scriptSentences.length || !isReadingRef.current) {
        isReadingRef.current = false;
        setTimeout(() => {
          setIsReadingScript(false);
          setIsReadingPaused(false);
          setCurrentScriptIndex(-1);
        }, 0);
        return;
      }

      // Actualizamos índice (esto disparará el resaltado visual)
      setCurrentScriptIndex(index);

      const utterance = new SpeechSynthesisUtterance(scriptSentences[index]);
      utteranceRef.current = utterance;

      utterance.lang = 'es-ES';
      utterance.rate = readingRate;

      const voices = window.speechSynthesis.getVoices();
      const esVoice = voices.find(v => v.lang.startsWith('es')) || voices[0];
      if (esVoice) utterance.voice = esVoice;

      utterance.onend = () => {
        // Solo continuamos si la REF dice que seguimos leyendo y NO estamos pausados
        if (isReadingRef.current && !isPausedRef.current) {
          setTimeout(() => speakSentence(index + 1), 50);
        }
      };

      utterance.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
          console.error('Error voz:', e);
          if (isReadingRef.current && !isPausedRef.current) {
            setTimeout(() => speakSentence(index + 1), 100);
          }
        }
      };

      window.speechSynthesis.speak(utterance);
    };

    speakSentence(startIndex);
  };

  const handlePauseResumeScript = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    if (isPausedRef.current) {
      // Reanudar
      isPausedRef.current = false;
      setIsReadingPaused(false);
      window.speechSynthesis.resume();

      // Si el motor de voz se quedó colgado tras la pausa (pasa en Chrome), re-lanzamos la frase
      if (!window.speechSynthesis.speaking && isReadingRef.current) {
        handleReadScriptAloud(currentScriptIndex !== -1 ? currentScriptIndex : 0);
      }
    } else {
      // Pausar
      isPausedRef.current = true;
      setIsReadingPaused(true);
      window.speechSynthesis.pause();
    }
  };

  const handleAddClip = (trackId: string, clip: Omit<TimelineClip, 'id' | 'trackId'>) => {
    if (!editState.timeline) return;

    const newClip: TimelineClip = {
      ...clip,
      id: `clip-${Date.now()}`,
      trackId
    };

    setEditState(prev => ({
      ...prev,
      timeline: {
        ...prev.timeline!,
        tracks: prev.timeline!.tracks.map(track =>
          track.id === trackId
            ? { ...track, clips: [...track.clips, newClip] }
            : track
        )
      }
    }));
  };

  const handleAddEffectClip = (clip: Omit<TimelineClip, 'id' | 'trackId'>) => {
    if (!editState.timeline) return;

    setEditState((prev) => {
      const timeline = prev.timeline!;
      let effectsTrack = timeline.tracks.find(isEffectsTrack);
      let nextTracks = timeline.tracks;

      if (!effectsTrack) {
        effectsTrack = createEffectsTrack();
        nextTracks = placeEffectsTrackBelowMainVideo([...timeline.tracks, effectsTrack]);
      }

      const newClip: TimelineClip = {
        ...clip,
        id: `clip-${Date.now()}`,
        overlayKind: clip.overlayKind ?? 'effect',
        trackId: effectsTrack.id,
      };

      return {
        ...prev,
        timeline: {
          ...timeline,
          tracks: nextTracks.map((track) =>
            track.id === effectsTrack!.id
              ? { ...track, clips: [...track.clips, newClip] }
              : track
          ),
        },
      };
    });
  };

  const handleUpdateClip = (clipId: string, updates: Partial<TimelineClip>) => {
    if (!editState.timeline) return;

    // Clip bloqueado individualmente: sólo se permite cambiar el propio
    // candado (para poder desbloquear). Cualquier otro ajuste (posición,
    // duración, volumen, velocidad, fundidos, opacidad, pista...) se rechaza.
    const existing = editState.timeline.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    if (existing?.locked) {
      const onlyLockToggle = Object.keys(updates).every(k => k === 'locked');
      if (!onlyLockToggle) return;
    }

    setEditState(prev => {
      const timeline = prev.timeline!;
      const syncedTextClips = (prev.textClips || []).map((clip) =>
        clip.id === clipId
          ? {
            ...clip,
            ...(updates.startTime !== undefined ? { startTime: updates.startTime } : {}),
            ...(updates.duration !== undefined ? { duration: updates.duration } : {}),
            ...(updates.opacity !== undefined ? { opacity: Math.round(updates.opacity * 100) } : {}),
            ...(updates.fadeInDuration !== undefined ? { fadeInDuration: updates.fadeInDuration } : {}),
            ...(updates.fadeOutDuration !== undefined ? { fadeOutDuration: updates.fadeOutDuration } : {}),
          }
          : clip
      );
      const syncedObjectClips = (prev.objectClips || []).map((clip) =>
        clip.id === clipId
          ? {
            ...clip,
            ...(updates.startTime !== undefined ? { startTime: updates.startTime } : {}),
            ...(updates.duration !== undefined ? { duration: updates.duration } : {}),
            ...(updates.opacity !== undefined ? { opacity: Math.round(updates.opacity * 100) } : {}),
            ...(updates.fadeInDuration !== undefined ? { fadeInDuration: updates.fadeInDuration } : {}),
            ...(updates.fadeOutDuration !== undefined ? { fadeOutDuration: updates.fadeOutDuration } : {}),
            ...(updates.mirrored !== undefined ? { mirrored: updates.mirrored } : {}),
          }
          : clip
      );

      // Si hay cambio de pista (trackId)
      if (updates.trackId) {
        let movedClip: TimelineClip | null = null;

        // 1. Quitar el clip de su pista actual
        const tracksAfterRemoval = timeline.tracks.map(track => {
          const clip = track.clips.find(c => c.id === clipId);
          if (clip) {
            movedClip = { ...clip, ...updates };
            return { ...track, clips: track.clips.filter(c => c.id !== clipId) };
          }
          return track;
        });

        if (!movedClip) return prev;

        // 2. Añadir el clip a la nueva pista
        const finalTracks = tracksAfterRemoval.map(track => {
          if (track.id === updates.trackId) {
            return { ...track, clips: [...track.clips, movedClip!] };
          }
          return track;
        });

        return {
          ...prev,
          textClips: syncedTextClips,
          objectClips: syncedObjectClips,
          timeline: { ...timeline, tracks: finalTracks }
        };
      }

      // Comportamiento normal (mismo track)
      // Si llega un cambio de playbackRate para un clip de vídeo/audio (campo
      // "Velocidad" del modal de configuración), se RECALCULA la duración a partir
      // de la velocidad elegida, para que el clip cubra EXACTAMENTE su contenido de
      // origen: ni se corta el final ni se repite/suma footage. Antes se hacía al
      // revés (duración → velocidad) y fallaba porque el sourceDuration del clip
      // principal no refleja el trozo recortado.
      //   contenido de origen = trimEnd-trimStart para el clip principal (su extensión
      //   la gobierna el recorte, no clip.duration); = sourceDuration o duración×rate
      //   para el resto.
      //   Para el clip principal, además se sincroniza trimEnd = trimStart + nueva
      //   duración, porque la exportación usa trimEnd-trimStart (no clip.duration).
      let effectiveUpdates = updates;
      let newTrimEnd: number | undefined;
      if (updates.playbackRate !== undefined && updates.duration === undefined) {
        const targetClip = timeline.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
        if (targetClip && (targetClip.type === 'video' || targetClip.type === 'audio')) {
          const isMain = targetClip.id.includes('main-video') || targetClip.id.includes('main-audio');
          const newRate = Math.max(0.0625, Math.min(16, updates.playbackRate));
          const sourceContent = isMain
            ? Math.max(0.1, (prev.trimEnd ?? 0) - (prev.trimStart ?? 0))
            : Math.max(0.1, targetClip.sourceDuration ?? targetClip.duration * (targetClip.playbackRate ?? 1));
          const newDuration = Math.max(0.1, sourceContent / newRate);
          effectiveUpdates = { ...updates, duration: newDuration };
          if (isMain) newTrimEnd = (prev.trimStart ?? 0) + newDuration;
        }
      }

      const updatedTimeline = {
        ...timeline,
        tracks: timeline.tracks.map(track => ({
          ...track,
          clips: track.clips.map(clip =>
            clip.id === clipId ? { ...clip, ...effectiveUpdates } : clip
          )
        }))
      };
      if (newTrimEnd !== undefined) {
        updatedTimeline.duration = Math.max(updatedTimeline.duration ?? 0, newTrimEnd);
      }

      return {
        ...prev,
        ...(newTrimEnd !== undefined ? { trimEnd: newTrimEnd } : {}),
        textClips: syncedTextClips,
        objectClips: syncedObjectClips,
        timeline: updatedTimeline
      };
    });
  };

  const handleDeleteClip = (clipId: string) => {
    if (!editState.timeline) return;

    // No borrar un clip bloqueado individualmente.
    if (editState.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)?.locked) return;

    const deletedClip = editState.timeline.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === clipId);
    const mediaFileId = deletedClip?.mediaFileId;

    setEditState(prev => ({
      ...prev,
      textClips: (prev.textClips || []).filter((clip) => clip.id !== clipId),
      objectClips: (prev.objectClips || []).filter((clip) => clip.id !== clipId),
      timeline: {
        ...prev.timeline!,
        tracks: prev.timeline!.tracks.map(track => ({
          ...track,
          clips: track.clips.filter(clip => clip.id !== clipId)
        }))
      }
    }));

    // Limpieza de memoria: si ningún clip restante usa el medio del clip borrado,
    // libera el sink del videoCache (decoders mediabunny) y, si era un blob local,
    // revoca su URL. Evita retención de decoders/memoria en sesiones largas (jank).
    if (mediaFileId) {
      const stillUsed = editState.timeline.tracks.some((t) =>
        t.clips.some((c) => c.id !== clipId && c.mediaFileId === mediaFileId)
      );
      if (!stillUsed) {
        try { videoCache.clearMedia(mediaFileId); } catch {}
        if (mediaFileId.startsWith('blob:')) {
          try { URL.revokeObjectURL(mediaFileId); } catch {}
        }
      }
    }
  };

  const handleSeparateAudio = (clipId: string) => {
    if (!editState.timeline) return;

    // No separar audio de un clip bloqueado individualmente.
    if (editState.timeline.tracks.flatMap(t => t.clips).find(c => c.id === clipId)?.locked) return;

    const videoClip = editState.timeline.tracks
      .flatMap(track => track.clips)
      .find(clip => clip.id === clipId && clip.type === 'video');

    if (!videoClip || !videoClip.mediaFileId) {
      alert('Este clip no tiene audio para separar o no es un clip de vídeo.');
      return;
    }

    // Buscar o crear una pista de audio
    let audioTrack = editState.timeline.tracks.find(t => t.type === 'audio');
    if (!audioTrack) {
      handleAddTrack('audio');
      const audioTracks = editState.timeline.tracks.filter(t => t.type === 'audio');
      audioTrack = audioTracks[audioTracks.length - 1];
    }

    if (!audioTrack) return;

    // Crear el clip de audio con las mismas propiedades temporales que el clip de vídeo
    const audioClip: Omit<TimelineClip, 'id' | 'trackId'> = {
      type: 'audio',
      startTime: videoClip.startTime,
      duration: videoClip.duration,
      thumbnailUrl: videoClip.thumbnailUrl,
      mediaFileId: videoClip.mediaFileId,
      label: `${videoClip.label || 'Audio'} (separado)`,
      sourceStartTime: videoClip.sourceStartTime,
      sourceDuration: videoClip.sourceDuration,
      volume: 1,
      overlayTint: undefined
    };

    // Añadir el clip de audio a la pista de audio
    handleAddClip(audioTrack.id, audioClip);

    // Silenciar el clip de vídeo original (quitarle el audio)
    handleUpdateClip(videoClip.id, { volume: 0 });

    // Silenciar también la pista de vídeo que tenía el clip para no reproducir audio duplicado
    setEditState(prev => {
      if (!prev.timeline) return prev;
      return {
        ...prev,
        timeline: {
          ...prev.timeline,
          tracks: prev.timeline.tracks.map(track =>
            track.id === videoClip.trackId ? { ...track, isMuted: true } : track
          )
        }
      };
    });
  };

  // ── Acciones locales del editor expuestas al chat IA ([ZEUS_ACTION]) ──
  // Se reconstruye cada render para capturar handlers frescos; el executor
  // (registerActionExecutor, registrado una sola vez) lo lee por ref al dispararse.
  const findClipById = (cid: string) => {
    for (const t of (editStateRef.current.timeline?.tracks ?? [])) {
      const c = t.clips.find(x => x.id === cid);
      if (c) return { clip: c, track: t };
    }
    return null;
  };
  const noClipErr = (cid: string) => ({
    ok: false,
    error: `clipId "${cid}" no encontrado. Llama a getEditState y usa el campo "id" real de un clip (formato "clip-<número>"); no inventes ids a partir del nombre del archivo.`,
  });
  localActionsRef.current = {
    // ── Inspección ──
    getEditState: () => {
      const es = editStateRef.current;
      const fmt = (s: number) => {
        if (!s || isNaN(s)) return '0:00';
        const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, '0')}`;
      };
      const clips = (es.timeline?.tracks ?? []).flatMap(t => t.clips).map(c => ({
        id: c.id, trackId: c.trackId, type: c.type, label: c.label || c.text || '',
        startTime: c.startTime, duration: c.duration, start: fmt(c.startTime), end: fmt(c.startTime + c.duration),
        mediaFileId: c.mediaFileId, opacity: c.opacity, volume: c.volume, playbackRate: c.playbackRate, reversed: c.reversed,
      }));
      return {
        timelineDuration: es.timeline?.duration ?? 0,
        currentTime: es.timeline?.currentTime ?? 0,
        tracks: (es.timeline?.tracks ?? []).map(t => ({ id: t.id, type: t.type, name: t.name, clips: t.clips.length })),
        clips,
        textClips: (es.textClips ?? []).map(t => ({ id: t.id, text: t.text, startTime: t.startTime, duration: t.duration })),
        objectClips: (es.objectClips ?? []).map(o => ({ id: o.id, name: o.name, startTime: o.startTime, duration: o.duration })),
        crop: es.crop ?? null,
        selection: es.selection ? { enabled: es.selection.enabled, shapeType: es.selection.shape.type, scope: es.selection.scope, track: es.selection.track, timeEnabled: es.selection.timeEnabled, timeStart: es.selection.timeStart, timeEnd: es.selection.timeEnd, keyframeCount: es.selection.shape.keyframes?.length ?? 0 } : null,
        filters: { brightness: es.brightness ?? 0, contrast: es.contrast ?? 0, saturation: es.saturation ?? 0, hue: es.hue ?? 0, blur: es.blur ?? 0, intensity: es.intensity ?? 0 },
        trim: { trimStart: es.trimStart ?? 0, trimEnd: es.trimEnd ?? 0 },
      };
    },

    // ── Timeline ──
    addClip: (p: any) => {
      const es = editStateRef.current; const tl = es.timeline;
      if (!tl) return { ok: false, error: 'No hay timeline' };
      const type = (p.type as TrackType) || 'video';
      const id = `clip-${Date.now()}`;
      const baseClip: any = { type, mediaFileId: p.mediaFileId, label: p.label, startTime: p.startTime ?? tl.currentTime ?? 0, duration: p.duration ?? 5, sourceStartTime: p.sourceStartTime, sourceDuration: p.sourceDuration, opacity: p.opacity ?? 1, volume: p.volume ?? 1, overlayTint: undefined, id };
      const track = p.trackId ? tl.tracks.find(t => t.id === p.trackId) : tl.tracks.find(t => t.type === type);
      snapshotHistory();
      if (track) {
        const tid = track.id;
        setEditState(prev => ({ ...prev, timeline: { ...prev.timeline!, tracks: prev.timeline!.tracks.map(t => t.id === tid ? { ...t, clips: [...t.clips, { ...baseClip, trackId: tid }] } : t) } }));
      } else {
        const newTrack: TimelineTrack = { id: `${type}-${Date.now()}`, type, name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${tl.tracks.filter(t => t.type === type).length + 1}`, clips: [{ ...baseClip, trackId: '' }], isLocked: false };
        newTrack.clips[0].trackId = newTrack.id;
        setEditState(prev => ({ ...prev, timeline: { ...prev.timeline!, tracks: [...prev.timeline!.tracks, newTrack] } }));
      }
      return { ok: true, clipId: id };
    },
    deleteClip: (p: any) => { if (!findClipById(p.clipId)) return noClipErr(p.clipId); snapshotHistory(); handleDeleteClip(p.clipId); return { ok: true }; },
    splitClip: (p: any) => {
      const f = findClipById(p.clipId);
      if (!f) return noClipErr(p.clipId);
      const t = Number(p.time);
      if (!(t > f.clip.startTime && t < f.clip.startTime + f.clip.duration)) {
        return { ok: false, error: `time ${t} cae fuera del clip (rango ${f.clip.startTime}..${f.clip.startTime + f.clip.duration}).` };
      }
      snapshotHistory(); handleSplitClip(p.clipId, t); return { ok: true };
    },
    mergeClips: (p: any) => {
      if (!findClipById(p.clipIdA)) return noClipErr(p.clipIdA);
      if (!findClipById(p.clipIdB)) return noClipErr(p.clipIdB);
      snapshotHistory(); handleMergeClips(p.clipIdA, p.clipIdB); return { ok: true };
    },
    setClipProp: (p: any) => {
      const found = findClipById(p.clipId);
      if (!found) return noClipErr(p.clipId);
      let v = p.value;
      if (p.prop === 'opacity' && typeof v === 'number' && v > 1) v = v / 100;
      if (p.prop === 'volume' && typeof v === 'number' && v > 1) v = v / 100;
      const updates: Partial<TimelineClip> = { [p.prop]: v } as any;
      snapshotHistory();
      handleUpdateClip(p.clipId, updates);
      return { ok: true };
    },
    addSpeedZone: (p: any) => { if (!findClipById(p.clipId)) return noClipErr(p.clipId); snapshotHistory(); const ok = handleStretchZone(p.clipId, p.startLocal, p.endLocal, p.newDuration); return { ok, error: ok ? undefined : 'No se pudo crear la zona de velocidad (rango local inválido).' }; },
    snapTrackToStart: (p: any) => { snapshotHistory(); handleSnapToStart(p.trackId); return { ok: true }; },
    deleteTrack: (p: any) => { snapshotHistory(); handleDeleteTrack(p.trackId); return { ok: true }; },
    addTrack: (p: any) => { snapshotHistory(); handleAddTrack((p.type as TrackType) || 'video'); return { ok: true }; },
    separateAudio: (p: any) => { if (!findClipById(p.clipId)) return noClipErr(p.clipId); snapshotHistory(); handleSeparateAudio(p.clipId); return { ok: true }; },
    duplicateClip: (p: any) => { if (!findClipById(p.clipId)) return noClipErr(p.clipId); snapshotHistory(); handleCopyClip(p.clipId); handlePasteClip(); return { ok: true }; },

    // ── Crop / Zona ──
    setCrop: (p: any) => { snapshotHistory(); updateCrop({ enabled: true, x: p.x, y: p.y, width: p.width, height: p.height, ...(p.aspect !== undefined ? { aspect: p.aspect } : {}) }); return { ok: true }; },
    applyCropPreset: (p: any) => { snapshotHistory(); applyCropPreset(p.aspect ?? null); return { ok: true }; },
    toggleCrop: () => { snapshotHistory(); toggleCropEnabled(); return { ok: true }; },
    resetCrop: () => { snapshotHistory(); resetCrop(); return { ok: true }; },

    // ── Selección / máscara ──
    setSelectionShape: (p: any) => { snapshotHistory(); updateSelection({ enabled: true, shape: { type: p.type, x: p.x, y: p.y, width: p.width, height: p.height, paths: [] } as any }); return { ok: true }; },
    setSelectionScope: (p: any) => { snapshotHistory(); setSelectionScope(p.scope); return { ok: true }; },
    setSelectionTimeRange: (p: any) => { snapshotHistory(); if (p.enabled !== undefined) toggleSelectionTime(p.enabled); if (p.timeStart !== undefined) setSelectionTime('timeStart', p.timeStart); if (p.timeEnd !== undefined) setSelectionTime('timeEnd', p.timeEnd); return { ok: true }; },
    toggleSelectionTrack: (p: any) => { snapshotHistory(); toggleSelectionTrack(p.enabled ?? true); return { ok: true }; },
    addSelectionKeyframe: (p: any) => {
      snapshotHistory();
      setEditState(prev => {
        const cur = prev.selection ?? { enabled: true, shape: { type: 'rect' as const, x: 25, y: 25, width: 50, height: 50, paths: [] }, scope: 'inside' as const, track: false, timeEnabled: false, timeStart: 0, timeEnd: 0 };
        const t = p.time ?? prev.timeline?.currentTime ?? 0;
        const box = { x: p.x, y: p.y, width: p.width, height: p.height };
        const keyframes = upsertSelectionKeyframe(cur.shape, t, box);
        return { ...prev, selection: { ...cur, track: true, shape: { ...cur.shape, keyframes } } };
      });
      return { ok: true };
    },
    removeSelectionKeyframe: (p: any) => { snapshotHistory(); removeSelectionKeyframeAtTime(p.time); return { ok: true }; },
    clearSelectionKeyframes: () => { snapshotHistory(); clearSelectionKeyframes(); return { ok: true }; },
    // SAM2 (IA): segmenta el objeto con ComfyUI y propaga la máscara por el vídeo.
    // Genera motionMasks (silueta cambiante raster, contorno real por frame).
    sam2Segment: async () => {
      await handleSam2Segment();
      return { ok: !sam2Error, note: sam2Error ? `Error: ${sam2Error}` : 'Segmentación SAM2 aplicada: la silueta sigue el contorno real del objeto.' };
    },
    resetSelection: () => { snapshotHistory(); resetSelection(); return { ok: true }; },

    // ── Objetos ──
    addObject: (p: any) => {
      const asset: OverlayObjectAsset = { id: `ai-obj-${Date.now()}`, name: p.name || 'Objeto IA', dataUrl: p.src, mediaType: p.mediaType || 'png' };
      snapshotHistory();
      handleAddObjectClip(asset);
      return { ok: true, note: 'Usa getEditState para obtener el id del nuevo objeto y updateObject para ajustarlo.' };
    },
    updateObject: (p: any) => {
      const { id, ...updates } = p;
      if (!id) return { ok: false, error: 'Falta id.' };
      if (!(editStateRef.current.objectClips ?? []).find(o => o.id === id))
        return { ok: false, error: `Objeto id "${id}" no encontrado. Usa getEditState para ver los objectClips reales.` };
      snapshotHistory(); handleUpdateObjectClip(id, updates); return { ok: true };
    },
    deleteObject: (p: any) => {
      if (!(editStateRef.current.objectClips ?? []).find(o => o.id === p.id))
        return { ok: false, error: `Objeto id "${p.id}" no encontrado. Usa getEditState para ver los objectClips reales.` };
      snapshotHistory(); handleDeleteObjectClip(p.id); return { ok: true };
    },

    // ── Texto ──
    addTextOverlay: (p: any) => {
      const clip: Omit<TextClip, 'id'> = {
        text: p.text || 'Texto', startTime: p.startTime ?? editStateRef.current.timeline?.currentTime ?? 0, duration: p.duration ?? 3,
        fontSize: p.fontSize ?? 48, fontFamily: p.fontFamily ?? 'Arial', color: p.color ?? '#ffffff',
        backgroundColor: p.backgroundColor ?? '#000000', position: { x: p.x ?? 50, y: p.y ?? 50 }, opacity: p.opacity ?? 100,
        textAlign: p.textAlign ?? 'center',
      } as any;
      snapshotHistory();
      handleAddTextClip(clip);
      return { ok: true, note: 'Usa getEditState para obtener el id del nuevo texto y updateText para ajustarlo.' };
    },
    updateText: (p: any) => {
      const { id, ...updates } = p;
      if (!id) return { ok: false, error: 'Falta id.' };
      if (!(editStateRef.current.textClips ?? []).find(t => t.id === id))
        return { ok: false, error: `Texto id "${id}" no encontrado. Usa getEditState para ver los textClips reales.` };
      snapshotHistory(); handleUpdateTextClip(id, updates); return { ok: true };
    },
    deleteText: (p: any) => {
      if (!(editStateRef.current.textClips ?? []).find(t => t.id === p.id))
        return { ok: false, error: `Texto id "${p.id}" no encontrado. Usa getEditState para ver los textClips reales.` };
      snapshotHistory(); handleDeleteTextClip(p.id); return { ok: true };
    },

    // ── Filtros / trim ──
    setFilter: (p: any) => {
      const allowed = ['brightness', 'contrast', 'saturation', 'hue', 'blur', 'intensity'];
      const patch: any = {}; for (const k of allowed) if (p[k] !== undefined) patch[k] = p[k];
      snapshotHistory(); setEditState(prev => ({ ...prev, ...patch })); return { ok: true };
    },
    setTrim: (p: any) => { snapshotHistory(); setEditState(prev => ({ ...prev, ...(p.trimStart !== undefined ? { trimStart: p.trimStart } : {}), ...(p.trimEnd !== undefined ? { trimEnd: p.trimEnd } : {}) })); return { ok: true }; },
    resetFilters: () => { snapshotHistory(); setEditState(prev => ({ ...prev, brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, intensity: 0 })); return { ok: true }; },
    resetTrim: () => { snapshotHistory(); setEditState(prev => ({ ...prev, trimStart: 0, trimEnd: prev.timeline?.duration ?? videoRef.current?.duration ?? 0 })); return { ok: true }; },

    // ── Transporte / global ──
    seek: (p: any) => { handleTimelineTimeUpdate(p.time); return { ok: true }; },
    playPause: (p: any) => { handleTimelinePlayPause(p.playing ?? true); return { ok: true }; },
    refreshPreview: () => { handleRefreshPreview(); return { ok: true }; },
    undo: () => { handleUndo(); return { ok: true }; },
    redo: () => { handleRedo(); return { ok: true }; },
    newProject: () => { handleNewProject(); return { ok: true }; },

    // ── Generación de media (segunda tanda) ──
    // Arranca ComfyUI + Flux Bridge para LTX. Requiere app de escritorio.
    startLtxServers: async () => {
      if (!isElectron()) return { ok: false, error: 'Solo disponible en la app de escritorio.' };
      await handleStartLtxServers();
      return { ok: true, message: ltxServerMessage };
    },
    // Rearranca solo el Flux Bridge (para que coja cambios de flux-bridge.py).
    restartBridge: async () => {
      if (!isElectron()) return { ok: false, error: 'Solo disponible en la app de escritorio.' };
      await handleRestartBridge();
      return { ok: true, message: ltxServerMessage };
    },
    // Captura el frame actual del preview compuesto y lo deja como imagen de entrada del LTX i2v.
    capturePreviewFrame: () => {
      captureCurrentPreviewFrame();
      return { ok: true, note: 'Frame capturado como imagen de entrada del LTX i2v.' };
    },
    // Añade un archivo local por ruta como clip del timeline (video/audio/imagen).
    addLocalFile: (p: any) => {
      const filePath: string = p.filePath;
      if (!filePath) return { ok: false, error: 'Falta filePath.' };
      if (!editStateRef.current.timeline) return { ok: false, error: 'No hay timeline.' };
      const ext = (filePath.split('.').pop() || '').toLowerCase();
      let type: 'video' | 'audio' | 'image' = p.type;
      if (!type) {
        if (VIDEO_EXT.includes(ext)) type = 'video';
        else if (AUDIO_EXT.includes(ext)) type = 'audio';
        else if (IMAGE_EXT.includes(ext)) type = 'image';
        else return { ok: false, error: `Extensión .${ext} no soportada.` };
      }
      const mediaUrl = (window as any).electronAPI?.getMediaUrl ? (window as any).electronAPI.getMediaUrl(filePath) : filePath;
      const label = (p.label as string | undefined) || cleanDisplayFileName(filePath.split(/[\\/]/).pop() || filePath);
      if (type === 'video') {
        addVideoFileAsClip(mediaUrl, label);
        return { ok: true, type, mediaUrl };
      }
      const trackType: TrackType = type === 'image' ? 'video' : 'audio';
      const tracks = editStateRef.current.timeline.tracks.filter((t) => t.type === trackType) || [];
      let targetTrack = tracks.find((t) => t.clips.length === 0) || tracks[0];
      let startTime = 0;
      if (!targetTrack) {
        handleAddTrack(trackType);
        const next = editStateRef.current.timeline.tracks.filter((t) => t.type === trackType);
        targetTrack = next[0] || editStateRef.current.timeline.tracks.find((t) => t.type === trackType);
        if (!targetTrack) return { ok: false, error: 'No se pudo crear la pista.' };
      } else {
        const last = [...targetTrack.clips].sort((a, b) => (b.startTime + b.duration) - (a.startTime + a.duration))[0];
        startTime = last ? last.startTime + last.duration : 0;
      }
      const addClip = (duration: number, thumbnailUrl: string) => {
        const newClip: Omit<TimelineClip, 'id' | 'trackId'> = {
          type: trackType, startTime, duration, thumbnailUrl, mediaFileId: mediaUrl, label,
          ...(type === 'image' && { text: label.replace(/\.[^/.]+$/, ''), fontSize: 24, fontFamily: 'Arial', color: '#ffffff', backgroundColor: 'transparent' }),
          overlayTint: undefined, reversed: false,
        };
        handleAddClip(targetTrack!.id, newClip);
      };
      if (type === 'audio') {
        loadAudioMetadata(mediaUrl).then(({ duration }) => addClip(duration, mediaUrl)).catch(() => addClip(5, mediaUrl));
      } else {
        addClip(typeof p.duration === 'number' ? p.duration : 3, mediaUrl);
      }
      return { ok: true, type, mediaUrl };
    },
    // Mejora un vídeo local con ffmpeg (escalar/afilar/denoise/interpolación de frames).
    enhanceVideo: async (p: any) => {
      if (!isElectron()) return { ok: false, error: 'Solo disponible en la app de escritorio.' };
      let inputPath = (p.inputPath as string | undefined) || '';
      if (!inputPath) inputPath = mediaUrlToPath(getCurrentVideoSource()) || '';
      if (!inputPath) return { ok: false, error: 'No hay vídeo local cargado para mejorar; pasa inputPath.' };
      // Coerción de scale/fps (la IA puede pasar números sueltos) a los presets válidos.
      const coerceScale = (v: any): 'no' | '1.5x' | '2x' | '1080p' | '4k' => {
        if (v === 'no' || v === '1.5x' || v === '2x' || v === '1080p' || v === '4k') return v;
        const n = typeof v === 'string' ? parseFloat(v) : v;
        if (n === 1.5) return '1.5x';
        if (n === 2) return '2x';
        if (n === 1080) return '1080p';
        if (n === 4 || n === 2160) return '4k';
        return 'no';
      };
      const coerceFps = (v: any): 'no' | '30' | '60' => {
        if (v === 'no' || v === '30' || v === '60') return v;
        const n = typeof v === 'string' ? parseFloat(v) : v;
        if (n === 30) return '30';
        if (n === 60) return '60';
        return 'no';
      };
      await handleEnhanceVideo({
        inputPath,
        scale: p.scale !== undefined ? coerceScale(p.scale) : undefined,
        sharpen: p.sharpen, denoise: p.denoise,
        fps: p.fps !== undefined ? coerceFps(p.fps) : undefined,
        motionMci: p.motionMci, fileName: p.fileName,
      });
      return { ok: true, note: enhanceError ? `Error: ${enhanceError}` : 'Vídeo mejorado y añadido al timeline.' };
    },
    // Renderiza un HTML/ZIP o una URL web a MP4 en una ventana oculta de Electron.
    htmlToMp4: async (p: any) => {
      if (!isElectron()) return { ok: false, error: 'Solo disponible en la app de escritorio.' };
      if (!p.htmlPath && !p.zipPath && !p.url) return { ok: false, error: 'Falta htmlPath, zipPath o url.' };
      await handleHtmlToMp4({
        htmlPath: p.htmlPath, zipPath: p.zipPath, url: p.url,
        duration: p.duration, speed: p.speed, fps: p.fps,
        width: p.width, height: p.height, fileName: p.fileName,
      });
      return { ok: true, note: htmlError ? `Error: ${htmlError}` : (p.url ? 'Web convertida a MP4 y añadida al timeline.' : 'HTML convertido a MP4 y añadido al timeline.') };
    },
    // Transcodea un archivo de vídeo existente (WebM, MOV, AVI…) a MP4/H.264 con ffmpeg.
    webToMp4: async (p: any) => {
      if (!isElectron()) return { ok: false, error: 'Solo disponible en la app de escritorio.' };
      if (!p.inputPath) return { ok: false, error: 'Falta inputPath (ruta del vídeo a convertir).' };
      await handleWebToMp4({ inputPath: p.inputPath, fileName: p.fileName });
      return { ok: true, note: htmlError ? `Error: ${htmlError}` : 'Vídeo convertido a MP4 y añadido al timeline.' };
    },
    // Genera vídeo con LTX (ComfyUI). Requiere workflow + node IDs cargados en la UI;
    // la IA puede pasar prompt/seed/duración/fps/resolución/nombre.
    generateLtx: async (p: any) => {
      if (!ltxWorkflowJson) return { ok: false, error: 'No hay workflow de ComfyUI cargado en la pestaña LTX. Carga uno primero desde la UI.' };
      await generateLtxVideo({
        prompt: p.prompt, seed: p.seed, duration: p.duration, fps: p.fps,
        width: p.width, height: p.height, fileName: p.fileName,
      });
      return { ok: true, note: ltxError ? `Error: ${ltxError}` : 'Vídeo LTX generado y añadido al timeline.' };
    },
  };

  // Materializa el JSON de animación IA en la timeline de una sola setEditState.
  // Reasignado cada render → captura handlers frescos (snapshotHistory, handleUpdateClip,
  // generateVideoThumbnail, loadVideoMetadata, setLocalScriptContent, toast).
  materializeAnimRef.current = (anim: AIAnimationData) => {
    const es = editStateRef.current;
    const tl = es.timeline;
    if (!tl) return;

    const a = anim.animation;
    const mediaUrls = anim.mediaUrls || {};

    // 1. Snapshot del estado actual (vacío) → un solo Ctrl+Z deshace toda la pieza.
    snapshotHistory();

    // 2. Pistas base: reutilizar las existentes (video-1, audio-1, text-1, image-1) sin clips.
    const baseTracks: TimelineTrack[] = (tl.tracks && tl.tracks.length ? tl.tracks : createDefaultEditState().timeline!.tracks)
      .map(t => ({ ...t, clips: [] }));
    const ensureTrack = (type: TrackType, predicate?: (t: TimelineTrack) => boolean): TimelineTrack => {
      let t = baseTracks.find(tr => tr.type === type && (!predicate || predicate(tr)));
      if (!t) {
        t = { id: `${type}-${Date.now()}`, type, name: type.charAt(0).toUpperCase() + type.slice(1), clips: [], isLocked: false };
        baseTracks.push(t);
      }
      return t;
    };
    // Pista de vídeo principal: type 'video' pero NO la "Pista de efectos" (que
    // también es type 'video' pero lleva overlays, no medios decodificables).
    const videoTrack = ensureTrack('video', (t) => !isEffectsTrack(t));
    const audioTrack = ensureTrack('audio');
    const textTrack = ensureTrack('text');
    // Pista de efectos ("Pista de efectos"): la usa "Añadir al timeline" desde la
    // librería. Es type:'video' pero sus clips llevan overlayKind:'effect', lo que los
    // EXCLUYE de VideoNode (mediabunny no decodifica imágenes → "unsupported format")
    // y los enruta a ObjectOverlay (<img>) en preview + ObjectNode en export. Por eso
    // las imágenes van aquí, no en la pista de vídeo ni en la de imagen.
    let effectsTrack = baseTracks.find(isEffectsTrack);
    if (!effectsTrack) {
      effectsTrack = createEffectsTrack();
      baseTracks.push(effectsTrack);
    }

    // 3. Mapear clips de medios a TimelineClip[].
    // Ruteo por tipo/extension (NO por c.track, que el modelo suele mal etiquetar):
    // imágenes → pista de efectos como overlay (overlayKind:'effect', mismo shape
    // que "Añadir al timeline" de la librería), vídeo → pista de vídeo, audio → pista
    // de audio.
    const newClips: TimelineClip[] = [];
    let maxEnd = 0;
    (a.clips || []).forEach((c, i) => {
      const url = mediaUrls[c.mediaName];
      if (!url) {
        console.warn(`[aiAnimation] No se resolvió mediaName "${c.mediaName}" (clip ${i}). Saltándolo.`);
        return;
      }
      const ext = (c.mediaName.split('.').pop() || '').toLowerCase();
      const isAudio = c.type === 'audio' || AUDIO_EXT.includes(ext);
      const isImage = !isAudio && (c.type === 'image' || IMAGE_EXT.includes(ext));
      const duration = c.duration ?? 5;
      const startTime = c.startTime ?? 0;

      if (isImage) {
        // Imagen → overlay de efecto. position/width/height por defecto ({x:50,y:50}/100)
        // los resuelve resolvedEffectClips. No lleva sourceStartTime/playbackRate/reversed:
        // no es medio decodificable, es un <img> posicionado sobre el frame.
        const clip: TimelineClip = {
          id: `anim-clip-${Date.now()}-${i}`,
          trackId: effectsTrack.id,
          type: 'video',
          overlayKind: 'effect',
          mediaFileId: url,
          thumbnailUrl: url,
          label: c.label || c.mediaName,
          startTime,
          duration,
          opacity: c.opacity ?? 1,
          overlayTint: undefined,
        };
        effectsTrack.clips.push(clip);
        newClips.push(clip);
        maxEnd = Math.max(maxEnd, startTime + duration);
        return;
      }

      // Vídeo o audio → pista propia (mediabunny decodifica vídeo; audio va aparte).
      const playbackRate = c.playbackRate ?? 1;
      const clipType: TrackType = isAudio ? 'audio' : 'video';
      const targetTrack = isAudio ? audioTrack : videoTrack;
      const clip: TimelineClip = {
        id: `anim-clip-${Date.now()}-${i}`,
        trackId: targetTrack.id,
        type: clipType,
        mediaFileId: url,
        label: c.label || c.mediaName,
        startTime,
        duration,
        sourceStartTime: c.sourceStartTime ?? 0,
        sourceDuration: duration * playbackRate,
        playbackRate,
        reversed: c.reversed ?? false,
        opacity: c.opacity ?? 1,
        volume: c.volume ?? 1,
        thumbnailUrl: url,
        transitionIn: c.transitionIn as any,
        transitionOut: c.transitionOut as any,
        overlayTint: undefined,
      };
      targetTrack.clips.push(clip);
      newClips.push(clip);
      maxEnd = Math.max(maxEnd, startTime + duration);
    });

    // 4. textOverlays → textClips + clips de pista de texto (mismo id para sincronizar).
    const newTextClips: TextClip[] = [];
    (a.textOverlays || []).forEach((t, i) => {
      const id = `anim-text-${Date.now()}-${i}`;
      const startTime = t.startTime ?? 0;
      const duration = t.duration ?? 3;
      const opacity = t.opacity ?? 100;
      newTextClips.push({
        id,
        text: t.text,
        fontSize: t.fontSize ?? 48,
        fontFamily: t.fontFamily ?? 'Inter',
        color: t.color ?? '#ffffff',
        // Sin fondo: los títulos flotan sobre el vídeo sin taparlo. El modelo puede
        // pedir fondo vía chat si lo necesita (updateText con backgroundColor).
        backgroundColor: 'transparent',
        backgroundOpacity: 0,
        position: { x: t.x ?? 50, y: t.y ?? 50 },
        startTime,
        duration,
        opacity,
        textAlign: t.textAlign ?? 'center',
      });
      textTrack.clips.push({
        id,
        trackId: textTrack.id,
        type: 'text',
        startTime,
        duration,
        text: t.text,
        fontSize: t.fontSize ?? 48,
        fontFamily: t.fontFamily ?? 'Inter',
        color: t.color ?? '#ffffff',
        position: { x: t.x ?? 50, y: t.y ?? 50 },
        opacity: opacity / 100,
        textAlign: t.textAlign ?? 'center',
        overlayTint: undefined,
      });
      maxEnd = Math.max(maxEnd, startTime + duration);
    });

    // 5/6. Filtro global + crop opcional.
    const gf = a.globalFilter;
    const crop = a.crop
      ? { enabled: true, aspect: a.crop.aspect ?? null, x: a.crop.x ?? 0, y: a.crop.y ?? 0, width: a.crop.width ?? 100, height: a.crop.height ?? 100 }
      : es.crop;

    // 7/8. Una sola setEditState con toda la pieza.
    // La "Pista de efectos" se coloca justo debajo del vídeo principal (igual que
    // hace handleAddEffectClip), para que los overlays se vean en su sitio.
    const orderedTracks = placeEffectsTrackBelowMainVideo(baseTracks);
    const totalDuration = Math.max(maxEnd, a.durationSec ?? 0, 1);
    setEditState(prev => ({
      ...prev,
      brightness: gf?.brightness ?? prev.brightness ?? 0,
      contrast: gf?.contrast ?? prev.contrast ?? 0,
      saturation: gf?.saturation ?? prev.saturation ?? 0,
      hue: gf?.hue ?? prev.hue ?? 0,
      blur: gf?.blur ?? prev.blur ?? 0,
      intensity: gf?.intensity ?? prev.intensity ?? 0,
      crop,
      textClips: [...(prev.textClips || []), ...newTextClips],
      timeline: {
        ...(prev.timeline ?? tl),
        duration: totalDuration,
        currentTime: 0,
        tracks: orderedTracks,
      },
    }));

    // 9. Thumbnails diferidos para clips de vídeo (no bloqueante, para el filmstrip).
    // Los overlays de efecto (imágenes) ya usan la propia imagen como thumbnailUrl y
    // no son medios decodificables, así que se saltan este paso.
    newClips.forEach(clip => {
      if (clip.type === 'video' && !clip.overlayKind && clip.mediaFileId) {
        const id = clip.id;
        const url = clip.mediaFileId;
        loadVideoMetadata(url)
          .then(() => generateVideoThumbnail(url, (thumb) => handleUpdateClip(id, { thumbnailUrl: thumb })))
          .catch(() => {});
      }
    });

    // 10. Resumen textual en el panel de guion + toast.
    const resumen = `# ${a.title || 'Animación IA'}\nEstilo: ${a.style || '—'} · Duración: ${totalDuration.toFixed(0)}s\n\n## Clips (${newClips.length})\n${newClips.map(c => `- ${c.label} @${c.startTime.toFixed(1)}s (${c.duration.toFixed(1)}s) [${c.type}]`).join('\n')}\n\n## Textos (${newTextClips.length})\n${newTextClips.map(t => `- "${t.text}" @${t.startTime.toFixed(1)}s (${t.duration.toFixed(1)}s)`).join('\n')}`;
    setLocalScriptContent(resumen);
    setPresentationSnapshot(resumen);
    toast({ title: 'Animación generada', description: `${newClips.length} clip(s) y ${newTextClips.length} texto(s) creados en la timeline.` });
  };

  return (
    <div className="flex-1 w-full h-full relative flex flex-col overflow-hidden bg-gray-950">
      {/* Header con título y botones de acción */}
      <div className="h-16 bg-gray-900 border-b border-gray-800 flex items-center px-6 gap-4">
        <div className="flex-1 flex items-center min-w-0">
          <h1 className="text-xl font-bold text-white shrink-0">{t('videoEditor.app.title')}</h1>
          {showSavedMessage && (
            <div className="flex items-center gap-2 text-green-400 bg-green-900/20 px-3 py-1 rounded-md border border-green-700/50 ml-4">
              <Check className="w-4 h-4" />
              <span className="text-sm">{t('videoEditor.app.savedMsg')}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 justify-center">
          <EditorFileNameBar
            items={timelineFileNameItems}
            icon={<Film className="w-4 h-4" />}
            colorClass="text-emerald-400"
            className="w-full max-w-md xl:max-w-xl"
          />
        </div>
        <div className="flex-1 flex items-center justify-end space-x-3 min-w-0">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="border-emerald-500/80 border bg-gradient-to-b from-white/[0.08] to-transparent text-white hover:bg-white/[0.15] transition-all shadow-lg"
          >
            {t('videoEditor.app.close')}
          </Button>
          <Button
            variant="ghost"
            onClick={handleNewProject}
            title={t('videoEditor.app.newTitle')}
            className="border-emerald-500/80 border bg-gradient-to-b from-white/[0.08] to-transparent text-white hover:bg-white/[0.15] transition-all shadow-lg"
          >
            <Plus className="w-4 h-4 mr-2" />
            {t('videoEditor.app.new')}
          </Button>
          <Button
            variant="ghost"
            onClick={handleLoadProject}
            className="border-emerald-500/80 border bg-gradient-to-b from-white/[0.08] to-transparent text-white hover:bg-white/[0.15] transition-all shadow-lg"
          >
            <FolderOpen className="w-4 h-4 mr-2" />
            {t('videoEditor.app.load')}
          </Button>
          <Button
            variant="ghost"
            onClick={handleExportVideo}
            className="border-emerald-500/80 border bg-gradient-to-b from-white/[0.08] to-transparent text-white hover:bg-white/[0.15] transition-all shadow-lg"
          >
            <Download className="w-4 h-4 mr-2" />
            {t('videoEditor.app.export')}
          </Button>
          <Button
            variant="ghost"
            onClick={handleSave}
            className="border-emerald-500/80 border bg-gradient-to-b from-white/[0.08] to-transparent text-white hover:bg-white/[0.15] transition-all shadow-lg"
          >
            {t('videoEditor.app.save')}
          </Button>
        </div>

        {/* Input oculto para cargar proyectos */}
        <input
          ref={setProjectInputRef}
          type="file"
          accept=".Zeus"
          onChange={handleProjectFileSelect}
          style={{ display: 'none' }}
        />
        {/* Input oculto para cargar vídeo/audio/imagen desde almacenamiento local */}
        <input
          ref={setUploadLocalInputRef}
          type="file"
          accept="video/*,audio/*,image/*"
          onChange={handleLocalFileSelect}
          style={{ display: 'none' }}
        />
      </div>

      {/* Contenedor principal - Layout flexible con altura restringida */}
      <div className="flex-1 flex overflow-hidden">
        {/* Panel izquierdo - Controles de edición */}
        <div className="w-[600px] bg-gray-900 border-r border-gray-800 flex flex-col h-full overflow-hidden">
          <div className="p-4 border-b border-gray-800 flex-none">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Settings className="w-4 h-4" />
              {t('videoEditor.app.editControls')}
            </h2>
          </div>

          <div className="flex-1 p-4 overflow-y-auto custom-scrollbar-thin">
            <Tabs defaultValue="trim" className="w-full">
              <TabsList className="grid w-full grid-cols-4 gap-1.5 mt-3 bg-transparent">
                <TabsTrigger
                  value="trim"
                  className="inline-flex items-center gap-1 py-2 px-2.5 border-emerald-500/50 border bg-gradient-to-b from-white/[0.05] to-transparent text-white data-[state=active]:bg-gradient-to-b data-[state=active]:from-emerald-500/40 data-[state=active]:to-emerald-900/20 data-[state=active]:text-emerald-400 data-[state=active]:border-emerald-400 transition-all"
                >
                  <Scissors className="w-3 h-3" />
                  {t('videoEditor.trim.tab')}
                </TabsTrigger>
                <TabsTrigger
                  value="effects"
                  className="inline-flex items-center gap-1 py-2 px-2.5 border-emerald-500/50 border bg-gradient-to-b from-white/[0.05] to-transparent text-white data-[state=active]:bg-gradient-to-b data-[state=active]:from-emerald-500/40 data-[state=active]:to-emerald-900/20 data-[state=active]:text-emerald-400 data-[state=active]:border-emerald-400 transition-all"
                >
                  <Volume2 className="w-3 h-3" />
                  {t('videoEditor.effects.tab')}
                </TabsTrigger>
                <TabsTrigger
                  value="text"
                  className="inline-flex items-center justify-center py-2 px-2.5 border-emerald-500/50 border bg-gradient-to-b from-white/[0.05] to-transparent text-white data-[state=active]:bg-gradient-to-b data-[state=active]:from-emerald-500/40 data-[state=active]:to-emerald-900/20 data-[state=active]:text-emerald-400 data-[state=active]:border-emerald-400 transition-all"
                >
                  {t('videoEditor.text.tab')}
                </TabsTrigger>
                <TabsTrigger
                  value="objects"
                  className="inline-flex items-center gap-1 py-2 px-2.5 border-emerald-500/50 border bg-gradient-to-b from-white/[0.05] to-transparent text-white data-[state=active]:bg-gradient-to-b data-[state=active]:from-emerald-500/40 data-[state=active]:to-emerald-900/20 data-[state=active]:text-emerald-400 data-[state=active]:border-emerald-400 transition-all"
                >
                  <Layers className="w-3 h-3" />
                  {t('videoEditor.objects.tab')}
                </TabsTrigger>
                <TabsTrigger
                  value="vertex"
                  className="inline-flex items-center gap-1 py-2 px-2.5 border-emerald-500/50 border bg-gradient-to-b from-white/[0.05] to-transparent text-white data-[state=active]:bg-gradient-to-b data-[state=active]:from-emerald-500/40 data-[state=active]:to-emerald-900/20 data-[state=active]:text-emerald-400 data-[state=active]:border-emerald-400 transition-all"
                >
                  <Grid3x3 className="w-3 h-3" />
                  {t('videoEditor.vertex.tab')}
                </TabsTrigger>
                <TabsTrigger
                  value="transition"
                  className="inline-flex items-center justify-center py-2 px-2.5 border-emerald-500/50 border bg-gradient-to-b from-white/[0.05] to-transparent text-white data-[state=active]:bg-gradient-to-b data-[state=active]:from-emerald-500/40 data-[state=active]:to-emerald-900/20 data-[state=active]:text-emerald-400 data-[state=active]:border-emerald-400 transition-all"
                >
                  {t('videoEditor.transition.tab')}
                </TabsTrigger>
                <TabsTrigger
                  value="cropscreen"
                  className="inline-flex items-center justify-center py-2 px-2.5 border-emerald-500/50 border bg-gradient-to-b from-white/[0.05] to-transparent text-white data-[state=active]:bg-gradient-to-b data-[state=active]:from-emerald-500/40 data-[state=active]:to-emerald-900/20 data-[state=active]:text-emerald-400 data-[state=active]:border-emerald-400 transition-all"
                >
                  {t('videoEditor.crop.tab')}
                </TabsTrigger>
                <TabsTrigger
                  value="overlay-video"
                  className="inline-flex items-center justify-center py-2 px-2.5 border-emerald-500/50 border bg-gradient-to-b from-white/[0.05] to-transparent text-white data-[state=active]:bg-gradient-to-b data-[state=active]:from-emerald-500/40 data-[state=active]:to-emerald-900/20 data-[state=active]:text-emerald-400 data-[state=active]:border-emerald-400 transition-all"
                >
                  {t('videoEditor.overlay.tab')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="trim" className="space-y-6 mt-16">
                {/* Información del video */}
                <div className="bg-gray-800 rounded-lg p-3">
                  <div className="text-sm text-gray-300">
                    <div className="flex justify-between items-center">
                      <span>{t('videoEditor.trim.totalDuration')}</span>
                      <span className="text-emerald-400 font-mono">
                        {formatTime(videoDuration)}
                      </span>
                    </div>
                    {editState.trimStart !== undefined && editState.trimEnd !== undefined && (
                      <div className="flex justify-between items-center mt-1">
                        <span>{t('videoEditor.trim.trimmedDuration')}</span>
                        <span className="text-blue-400 font-mono">
                          {formatTime(editState.trimEnd - editState.trimStart)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-emerald-400 block mb-2">
                    {t('videoEditor.trim.start', { time: formatTime(editState.trimStart || 0) })}
                  </label>
                  <Slider
                    value={[editState.trimStart || 0]}
                    max={videoDuration || 100}
                    step={0.1}
                    onValueChange={handleTrimStartChange}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-emerald-300 mt-1">
                    <span>0:00</span>
                    <span>{formatTime(videoDuration)}</span>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-emerald-400 block mb-2">
                    {t('videoEditor.trim.end', { time: formatTime(editState.trimEnd || videoDuration) })}
                  </label>
                  <Slider
                    value={[editState.trimEnd || videoDuration]}
                    max={videoDuration || 100}
                    step={0.1}
                    onValueChange={handleTrimEndChange}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-emerald-300 mt-1">
                    <span>0:00</span>
                    <span>{formatTime(videoDuration)}</span>
                  </div>
                </div>

                {/* Botones de acceso rápido */}
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditState(prev => ({
                        ...prev,
                        trimStart: 0,
                        trimEnd: videoDuration
                      }));
                    }}
                    className="text-xs border-emerald-500/80 border bg-gradient-to-b from-white/[0.08] to-transparent text-white hover:bg-white/[0.15] transition-all shadow-md"
                  >
                    {t('videoEditor.trim.reset')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCalculateTimelineLength}
                    className="text-xs border-emerald-500/80 border bg-gradient-to-b from-white/[0.08] to-transparent text-white hover:bg-white/[0.15] transition-all shadow-md"
                  >
                    {t('videoEditor.trim.calcTime')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      // Recortar últimos 10 segundos
                      const newEnd = Math.max(0, videoDuration - 10);
                      setEditState(prev => ({
                        ...prev,
                        trimEnd: newEnd
                      }));
                    }}
                    className="text-xs border-emerald-500/80 border bg-gradient-to-b from-white/[0.08] to-transparent text-white hover:bg-white/[0.15] transition-all shadow-md"
                    disabled={videoDuration <= 10}
                  >
                    {t('videoEditor.trim.minus10sEnd')}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="effects" className="space-y-6 mt-16">
                {/* Comparar original / cambios: alterna el preview entre el vídeo
                    limpio (sin efectos) y el vídeo con los cambios aplicados, sin
                    tocar los datos. Útil para ver el antes/después en bruto. */}
                <div className="flex items-center justify-between bg-gray-900/60 rounded-lg px-3 py-2 border border-emerald-500/40">
                  <div className="flex items-center gap-2 text-sm text-gray-200">
                    {previewOriginal ? <EyeOff className="w-4 h-4 text-emerald-400" /> : <Eye className="w-4 h-4 text-emerald-400" />}
                    <span>{previewOriginal ? t('videoEditor.effects.previewOriginal') : t('videoEditor.effects.previewChanges')}</span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 select-none"
                    onPointerDown={() => setPreviewOriginal(true)}
                    onPointerUp={() => setPreviewOriginal(false)}
                    onPointerLeave={() => setPreviewOriginal(false)}
                    onPointerCancel={() => setPreviewOriginal(false)}
                    title={t('videoEditor.effects.previewHoldTitle')}
                  >
                    {previewOriginal ? t('videoEditor.effects.release') : t('videoEditor.effects.viewOriginal')}
                  </Button>
                </div>
                <div>
                  <label className="text-sm font-medium flex justify-between text-emerald-400 mb-2">
                    {t('videoEditor.effects.brightness')}
                    <span className="text-xs text-emerald-300">{editState.brightness} %</span>
                  </label>
                  <Slider
                    value={[editState.brightness ?? 0]}
                    min={-100}
                    max={100}
                    step={1}
                    onValueChange={handleEffectChange('brightness')}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium flex justify-between text-emerald-400 mb-2">
                    {t('videoEditor.effects.contrast')}
                    <span className="text-xs text-emerald-300">{editState.contrast} %</span>
                  </label>
                  <Slider
                    value={[editState.contrast ?? 0]}
                    min={-100}
                    max={100}
                    step={1}
                    onValueChange={handleEffectChange('contrast')}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium flex justify-between text-emerald-400 mb-2">
                    {t('videoEditor.effects.saturation')}
                    <span className="text-xs text-emerald-300">{editState.saturation} %</span>
                  </label>
                  <Slider
                    value={[editState.saturation ?? 0]}
                    min={-100}
                    max={100}
                    step={1}
                    onValueChange={handleEffectChange('saturation')}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium flex justify-between text-emerald-400 mb-2">
                    {t('videoEditor.effects.hue')}
                    <span className="text-xs text-emerald-300">{editState.hue}°</span>
                  </label>
                  <Slider
                    value={[editState.hue ?? 0]}
                    min={-180}
                    max={180}
                    step={1}
                    onValueChange={handleEffectChange('hue')}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium flex justify-between text-emerald-400 mb-2">
                    {t('videoEditor.effects.blur')}
                    <span className="text-xs text-emerald-300">{editState.blur} px</span>
                  </label>
                  <Slider
                    value={[editState.blur ?? 0]}
                    min={0}
                    max={20}
                    step={0.5}
                    onValueChange={handleEffectChange('blur')}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium flex justify-between text-emerald-400 mb-2">
                    {t('videoEditor.effects.intensity')}
                    <span className="text-xs text-emerald-300">{editState.intensity ?? 0} %</span>
                  </label>
                  <Slider
                    value={[editState.intensity ?? 0]}
                    min={-100}
                    max={100}
                    step={1}
                    onValueChange={handleEffectChange('intensity')}
                  />
                  <p className="text-[10px] text-gray-500 mt-1">
                    {t('videoEditor.effects.intensityHelp')}
                  </p>
                </div>

                {/* Selección / máscara de efectos */}
                <div className="pt-4 border-t border-emerald-500/30 space-y-3">
                  <label className="text-sm font-medium text-emerald-400 block">{t('videoEditor.selection.title')}</label>
                  <p className="text-xs text-gray-400">
                    {t('videoEditor.selection.descPre')} <strong>{t('videoEditor.selection.descInside')}</strong> {t('videoEditor.selection.descOr')} <strong>{t('videoEditor.selection.descOutside')}</strong> {t('videoEditor.selection.descPost')}
                  </p>

                  <div className="flex items-center justify-between bg-gray-900/60 rounded-lg px-3 py-2 border border-gray-700">
                    <span className="text-sm text-gray-200">{t('videoEditor.selection.enable')}</span>
                    <Switch
                      checked={!!editState.selection?.enabled}
                      onCheckedChange={(v) => updateSelection({ enabled: v })}
                    />
                  </div>

                  {editState.selection?.enabled && (
                    <>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1.5">{t('videoEditor.selection.shape')}</label>
                        <div className="grid grid-cols-4 gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectionShapeType('rect')}
                            className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs transition-all ${editState.selection.shape.type === 'rect' ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                          >
                            <Square className="w-3.5 h-3.5" /> {t('videoEditor.selection.shapeRect')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectionShapeType('circle')}
                            className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs transition-all ${editState.selection.shape.type === 'circle' ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                          >
                            <Circle className="w-3.5 h-3.5" /> {t('videoEditor.selection.shapeCircle')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectionShapeType('freehand')}
                            className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs transition-all ${editState.selection.shape.type === 'freehand' ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                          >
                            <PenTool className="w-3.5 h-3.5" /> {t('videoEditor.selection.shapeFreehand')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectionShapeType('wand')}
                            className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs transition-all ${editState.selection.shape.type === 'wand' ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                          >
                            <Wand2 className="w-3.5 h-3.5" /> {t('videoEditor.selection.shapeWand')}
                          </button>
                        </div>
                      </div>

                      {/* Copiar / pegar la zona seleccionada como objeto */}
                      <div>
                        <label className="text-xs text-gray-400 block mb-1.5">{t('videoEditor.selection.copyPasteTitle')}</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={handleCopySelection}
                            className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs transition-all bg-blue-600/15 border-blue-500/40 text-blue-300 hover:bg-blue-600/30"
                          >
                            <Copy className="w-3.5 h-3.5" /> {t('videoEditor.selection.copyZone')}
                          </button>
                          <button
                            type="button"
                            onClick={handlePasteSelection}
                            className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs transition-all ${copiedZoneDataUrl ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30' : 'bg-gray-900 border-gray-700 text-gray-500 hover:bg-gray-800'}`}
                          >
                            <ClipboardPaste className="w-3.5 h-3.5" /> {t('videoEditor.selection.paste')}
                          </button>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1">
                          {t('videoEditor.selection.copyPasteHelp')}
                        </p>
                      </div>

                      {/* Varita mágica: tolerancia de color del flood fill */}
                      {editState.selection.shape.type === 'wand' && (
                        <div className="space-y-1.5 bg-gray-900/50 rounded-lg p-3 border border-gray-700/60">
                          <label className="text-xs text-gray-300 flex justify-between">
                            {t('videoEditor.selection.wandTolerance')}
                            <span className="text-emerald-300 font-mono">{wandTolerance}</span>
                          </label>
                          <Slider
                            value={[wandTolerance]}
                            min={0}
                            max={100}
                            step={1}
                            onValueChange={(v) => setWandTolerance(v[0] ?? 15)}
                          />
                          <p className="text-[10px] text-gray-500">
                            {t('videoEditor.selection.wandHelp1')} <strong className="text-gray-400">{t('videoEditor.selection.wandHelpCtrl')}</strong>{' '}
                            {t('videoEditor.selection.wandHelp2')} <strong className="text-gray-400">{t('videoEditor.selection.wandHelpShift')}</strong>{' '}
                            {t('videoEditor.selection.wandHelp3')}
                          </p>
                          {(editState.selection.shape.motionMasks?.length ?? 0) > 0 && (
                            <button
                              type="button"
                              onClick={() => setSelectionShapeType('wand')}
                              className="w-full h-7 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-gray-800/80 text-gray-300 hover:bg-gray-700/80 border border-gray-600/60 transition-all"
                            >
                              {t('videoEditor.selection.clearSelection')}
                            </button>
                          )}
                        </div>
                      )}

                      <div>
                        <label className="text-xs text-gray-400 block mb-1.5">{t('videoEditor.selection.applyEffects')}</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectionScope('inside')}
                            className={`px-2 py-2 rounded-lg border text-xs transition-all ${editState.selection.scope === 'inside' ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                          >
                            {t('videoEditor.selection.scopeInside')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectionScope('outside')}
                            className={`px-2 py-2 rounded-lg border text-xs transition-all ${editState.selection.scope === 'outside' ? 'bg-amber-500/20 border-amber-500/60 text-amber-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                          >
                            {t('videoEditor.selection.scopeOutside')}
                          </button>
                        </div>
                      </div>

                      {/* Rango temporal: los efectos (y la máscara) sólo aplican en [Desde, Hasta] */}
                      <div className="flex items-center justify-between bg-gray-900/60 rounded-lg px-3 py-2 border border-gray-700">
                        <span className="text-sm text-gray-200">{t('videoEditor.selection.timeOnly')}</span>
                        <Switch
                          checked={!!editState.selection.timeEnabled}
                          onCheckedChange={toggleSelectionTime}
                        />
                      </div>
                      {editState.selection.timeEnabled && (
                        <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.selection.timeFrom')}</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              defaultValue={fmtHMS(editState.selection.timeStart ?? 0)}
                              key={`ts-${editState.selection.timeStart ?? 0}`}
                              onBlur={(e) => {
                                const v = parseHMS(e.target.value);
                                if (v !== null) setSelectionTime('timeStart', v);
                                else e.target.value = fmtHMS(editState.selection?.timeStart ?? 0);
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.selection.timeTo')}</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              defaultValue={fmtHMS(editState.selection.timeEnd ?? 0)}
                              key={`te-${editState.selection.timeEnd ?? 0}`}
                              onBlur={(e) => {
                                const v = parseHMS(e.target.value);
                                if (v !== null) setSelectionTime('timeEnd', v);
                                else e.target.value = fmtHMS(editState.selection?.timeEnd ?? 0);
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.selection.fadeIn')}</label>
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              defaultValue={editState.selection.fadeIn ?? 0}
                              key={`sfi-${editState.selection.fadeIn ?? 0}`}
                              onBlur={(e) => setSelectionFade('fadeIn', parseFloat(e.target.value))}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.selection.fadeOut')}</label>
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              defaultValue={editState.selection.fadeOut ?? 0}
                              key={`sfo-${editState.selection.fadeOut ?? 0}`}
                              onBlur={(e) => setSelectionFade('fadeOut', parseFloat(e.target.value))}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                            />
                          </div>
                        </div>
                        </>
                      )}
                      {editState.selection.timeEnabled && (
                        <p className="text-xs text-gray-500">
                          {t('videoEditor.selection.timeRangeNote', { duration: fmtHMS(editState.timeline?.duration ?? 0) })}
                        </p>
                      )}

                      {/* Seguimiento de objeto (keyframes de la caja) — rect/circle y lazo.
                          La varita mágica (máscara raster estática) no lo usa. */}
                      {editState.selection.shape.type !== 'wand' && (
                        <div className="flex items-center justify-between bg-gray-900/60 rounded-lg px-3 py-2 border border-gray-700">
                          <span className="text-sm text-gray-200">{t('videoEditor.selection.trackObject')}</span>
                          <Switch
                            checked={!!editState.selection.track}
                            onCheckedChange={toggleSelectionTrack}
                          />
                        </div>
                      )}
                      {/* SAM2 (Fase 2): segmentación de vídeo con IA vía ComfyUI. El
                          contorno del objeto cambia por frame al REAL (no deforma el
                          lazo, lo redibuja). Requiere ComfyUI + nodos SAM2. Funciona
                          con lazo (freehand) o máscara de varita como prompt inicial. */}
                      {(editState.selection.shape.type === 'freehand' || editState.selection.shape.type === 'wand') && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-200">{t('videoEditor.selection.sam2Title')}</span>
                          </div>
                          {/* Servidores (ComfyUI + Bridge, compartidos con el generador LTX) */}
                          <div className="flex items-center gap-2 bg-gray-950/50 p-1.5 rounded-lg border border-gray-700/50">
                            <div className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${ltxServerStatus.comfyui ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'}`} />
                              <span className="text-[9px] text-gray-400">{t('videoEditor.selection.sam2Comfyui')}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${ltxServerStatus.fluxBridge ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'}`} />
                              <span className="text-[9px] text-gray-400">{t('videoEditor.selection.sam2Bridge')}</span>
                            </div>
                            <button
                              type="button"
                              onClick={handleStartLtxServers}
                              disabled={isStartingLtxServers || (ltxServerStatus.comfyui && ltxServerStatus.fluxBridge)}
                              className="ml-auto text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-violet-500/20 text-violet-300 hover:bg-violet-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-violet-500/30"
                            >
                              {isStartingLtxServers ? t('videoEditor.selection.sam2Starting') : ltxServerStatus.comfyui && ltxServerStatus.fluxBridge ? t('videoEditor.selection.sam2Ready') : t('videoEditor.selection.sam2StartServers')}
                            </button>
                            <button
                              type="button"
                              onClick={handleRestartBridge}
                              disabled={isStartingLtxServers}
                              title={t('videoEditor.selection.sam2RestartBridgeTitle')}
                              className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-gray-700/40 text-gray-300 hover:bg-gray-600/60 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-gray-600/40"
                            >
                              {t('videoEditor.selection.sam2RestartBridge')}
                            </button>
                     </div>
                     {ltxServerMessage && (
                       <p className={`text-[9px] uppercase tracking-wider ${ltxServerMessage.includes('listo') ? 'text-green-400' : ltxServerMessage.includes('Error') ? 'text-red-400' : 'text-violet-300'}`}>
                         {ltxServerMessage}
                       </p>
                     )}
                     {vertexTrackEngine === 'sam2' && (
                       <p className={`text-[9px] ${!!sam2WorkflowJson && !!sam2VideoNode.trim() && !!sam2PointsNode.trim() && ltxServerStatus.comfyui && ltxServerStatus.fluxBridge ? 'text-green-400' : 'text-red-400'}`}>
                         {sam2WorkflowName ? t('videoEditor.selection.sam2WorkflowName', { name: sam2WorkflowName }) : t('videoEditor.selection.sam2NotConfigured')} · {ltxServerStatus.comfyui && ltxServerStatus.fluxBridge ? t('videoEditor.selection.sam2ServersOk') : t('videoEditor.selection.sam2ServersDown')}
                       </p>
                     )}
                          <label className="block">
                            <span className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.selection.sam2WorkflowLabel')}</span>
                            <input
                              type="file"
                              accept=".json,application/json"
                              onChange={(e) => handleSam2WorkflowFile(e.target.files)}
                              className="text-[10px] text-gray-300 w-full"
                            />
                          </label>
                          {sam2WorkflowName && (
                            <p className="text-[10px] text-emerald-400/80 truncate">{t('videoEditor.selection.sam2WorkflowName', { name: sam2WorkflowName })}</p>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-[10px] text-gray-400">
                              {t('videoEditor.selection.sam2NodeVideo')}
                              {renderLtxNodeSelect(sam2VideoNode, (v) => { setSam2VideoNode(v); try { const c = loadSam2Settings(); localStorage.setItem(SAM2_SETTINGS_KEY, JSON.stringify({ ...c, videoNode: v })); } catch {} }, sam2NodeCandidates.video, 'ID del LoadVideo', 'sam2vid')}
                            </label>
                            <label className="text-[10px] text-gray-400">
                              {t('videoEditor.selection.sam2NodeSam2')}
                              {renderLtxNodeSelect(sam2PointsNode, (v) => { setSam2PointsNode(v); try { const c = loadSam2Settings(); localStorage.setItem(SAM2_SETTINGS_KEY, JSON.stringify({ ...c, pointsNode: v })); } catch {} }, sam2NodeCandidates.points, 'ID del Sam2Segmentation', 'sam2pts')}
                            </label>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-[10px] text-gray-400">
                              {t('videoEditor.selection.sam2NodeFrame')}
                              {renderLtxNodeSelect(sam2FrameNode, (v) => { setSam2FrameNode(v); try { const c = loadSam2Settings(); localStorage.setItem(SAM2_SETTINGS_KEY, JSON.stringify({ ...c, frameNode: v })); } catch {} }, sam2NodeCandidates.frame, 'frame_index', 'sam2frame')}
                            </label>
                            <label className="text-[10px] text-gray-400">
                              {t('videoEditor.selection.sam2FramePrompt')}
                              <input
                                type="number"
                                min={0}
                                value={sam2FrameIndex}
                                onChange={(e) => { setSam2FrameIndex(e.target.value); try { const c = loadSam2Settings(); localStorage.setItem(SAM2_SETTINGS_KEY, JSON.stringify({ ...c, frameIndex: e.target.value })); } catch {} }}
                                placeholder="0"
                                className="w-full bg-transparent border border-gray-700 rounded-lg p-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-emerald-400"
                              />
                            </label>
                          </div>
                          <label className="flex items-center gap-2 text-[10px] text-gray-400 select-none cursor-pointer">
                            <input
                              type="checkbox"
                              checked={sam2Merge}
                              onChange={(e) => setSam2Merge(e.target.checked)}
                              className="accent-violet-500 w-3.5 h-3.5"
                            />
                            <span>
                              {t('videoEditor.selection.sam2SecondPass')} <strong className="text-violet-300">{t('videoEditor.selection.sam2SecondPassAdd')}</strong> {t('videoEditor.selection.sam2SecondPass2')}
                            </span>
                          </label>
                          {sam2Merge && (
                            <div className="space-y-1.5 rounded-lg bg-violet-500/5 border border-violet-500/20 px-2 py-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] text-gray-400 w-20 shrink-0">{t('videoEditor.selection.sam2PromptStrength')}</span>
                                <Slider
                                  min={1}
                                  max={4}
                                  step={1}
                                  value={[sam2PromptStrength]}
                                  onValueChange={(v) => setSam2PromptStrength(v[0] ?? 2)}
                                  className="flex-1"
                                />
                                <span className="text-[10px] text-violet-300 font-mono w-7 text-right">{sam2PromptStrength}x</span>
                              </div>
                              <p className="text-[9px] text-gray-500 leading-snug">
                                {t('videoEditor.selection.sam2PromptStrengthHelp')}
                              </p>
                              <label className="flex items-center gap-2 text-[10px] text-gray-400 select-none cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={sam2MergeRange}
                                  onChange={(e) => setSam2MergeRange(e.target.checked)}
                                  className="accent-violet-500 w-3.5 h-3.5"
                                />
                                <span>
                                  {t('videoEditor.selection.sam2LimitToFrame')} <span className="text-gray-600">{t('videoEditor.selection.sam2LimitToFrameSuffix', { sec: sam2MergeRangeSec })}</span>
                                </span>
                              </label>
                              {sam2MergeRange && (
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] text-gray-500 w-7 shrink-0">±{sam2MergeRangeSec}s</span>
                                  <Slider
                                    min={0.5}
                                    max={10}
                                    step={0.5}
                                    value={[sam2MergeRangeSec]}
                                    onValueChange={(v) => setSam2MergeRangeSec(v[0] ?? 2)}
                                    className="flex-1"
                                  />
                                </div>
                              )}
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={handleSam2Segment}
                            disabled={sam2Busy || !editState.selection?.enabled || !sam2WorkflowJson}
                            className="w-full h-9 text-xs border border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
                            title={sam2Merge
                              ? t('videoEditor.selection.sam2BtnTitleMerge')
                              : t('videoEditor.selection.sam2BtnTitleNormal')}
                          >
                            {sam2Busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5 mr-1.5" />}
                            {sam2Busy && sam2Progress ? t('videoEditor.selection.sam2Segmenting', { percent: sam2Progress.percent }) : (sam2Merge ? t('videoEditor.selection.sam2SegmentAddBtn') : t('videoEditor.selection.sam2SegmentBtn'))}
                          </Button>
                          {sam2Busy && (
                            <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full bg-violet-500 transition-all" style={{ width: `${Math.max(2, Math.min(100, sam2Progress?.percent ?? 0))}%` }} />
                            </div>
                          )}
                          <p className="text-[10px] text-gray-500 leading-snug">
                            Máxima precisión: dibuja el lazo sobre el objeto (o haz una selección con la <strong className="text-gray-400">varita</strong> por color) en el frame del prompt y pulsa. El editor calcula puntos dentro del lazo / de la máscara de varita y SAM2 propaga la segmentación por el vídeo siguiendo el contorno real del objeto cada frame (la silueta cambia de forma, no sólo se deforma). Necesitas ComfyUI con los nodos kijai SAM2 y un workflow (formato API) con: un VHS LoadVideo → DownloadAndLoadSAM2Model (modo vídeo) → Sam2Segmentation → MaskToImage → VHS_VideoCombine, más un PrimitiveNode conectado a coordinates_positive. Dibuja el lazo (o la varita) en el primer frame del clip (frame 0) para que coincida con el prompt.
                            <br /><br />
                            <strong className="text-violet-300">Segunda pasada (añadir):</strong> si tras segmentar hay frames donde parte del objeto quedó sin marcar, activa la casilla <em>Segunda pasada</em>, ve al frame que falla, dibuja el lazo (o Redibujar) alrededor de la parte que falta y pulsa de nuevo. SAM2 segmenta desde ESE frame y el resultado se <strong className="text-violet-300">fusiona (unión)</strong> con las máscaras existentes en vez de reemplazarlas: lo que capture se suma a lo ya marcado. Puedes repetirlo en varios frames; cada pasada añade a lo anterior. Si la zona sigue sin cubrirse, sube la <em>Fuerza prompt</em>: la segunda pasada usará más puntos y también tomará como referencia la máscara existente del frame para que SAM2 re-segmente el objeto completo. Si activas <em>Limitar al entorno del frame actual</em>, la fusión solo toca los frames dentro de ±N segundos alrededor del frame donde dibujaste (el resto del vídeo queda intacto, ideal cuando SAM2 propaga bien cerca del prompt pero se va de madre lejos de él).
                          </p>
                          {sam2Error && (
                            <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-2.5 py-1.5">{sam2Error}</div>
                          )}
                        </div>
                      )}
                      {/* Silueta cambiante activa (motionPaths / motionMasks): aviso + limpiar. */}
                      {hasMotionSilhouette(editState.selection) && (
                        <div className="space-y-1.5 bg-fuchsia-500/5 border border-fuchsia-500/20 rounded-lg px-2.5 py-2">
                          <p className="text-[11px] text-fuchsia-300 leading-snug">
                            {t('videoEditor.selection.silhouetteTitle')}
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => { snapshotHistory(); discardPendingMaskEdits(); setEditState(prev => { const c = ensureSelection(prev); return { ...prev, selection: { ...c, shape: { ...c.shape, motionPaths: undefined, motionMasks: undefined } } }; }); }}
                            className="w-full h-8 text-xs border border-gray-600 text-gray-300 hover:bg-gray-700/40"
                          >
                            {t('videoEditor.selection.removeSilhouette')}
                          </Button>
                        </div>
                      )}
                      {/* Retoque de máscaras SAM2 (sólo si hay motionMasks): borrar/añadir/varita al frame. */}
                      {editState.selection?.shape?.motionMasks?.length ? (
                        <div className="space-y-2 bg-teal-500/5 border border-teal-500/20 rounded-lg px-2.5 py-2">
                          <p className="text-[11px] text-teal-300 leading-snug">
                            Retoca la máscara del frame actual: <strong>Borrar</strong> quita lo que se sale del objeto, <strong>Brocha</strong> añade lo que falta y la <strong>Varita</strong> añade o borra la región contigua de color similar (<strong>Ctrl+clic</strong> añade, <strong>Shift+clic</strong> borra; sin modificador, clic dentro de la máscara la borra y fuera la añade). Avanza fotograma a fotograma para corregir los que fallen. Los retoques se quedan en memoria hasta que pulses <strong>Listo</strong> (o <strong>Guardar proyecto</strong>); si no, se descartan y el disco queda como estaba.
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            <button
                              type="button"
                              onClick={() => setMaskEditMode(maskEditMode === 'erase' ? null : 'erase')}
                              className={`px-2 py-2 rounded-lg border text-xs transition-all ${maskEditMode === 'erase' ? 'bg-red-500/20 border-red-500/60 text-red-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                            >
                              {t('videoEditor.selection.retouchErase')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setMaskEditMode(maskEditMode === 'add' ? null : 'add')}
                              className={`px-2 py-2 rounded-lg border text-xs transition-all ${maskEditMode === 'add' ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                            >
                              {t('videoEditor.selection.retouchAdd')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setMaskEditMode(maskEditMode === 'wand' ? null : 'wand')}
                              className={`flex items-center justify-center gap-1 px-2 py-2 rounded-lg border text-xs transition-all ${maskEditMode === 'wand' ? 'bg-violet-500/20 border-violet-500/60 text-violet-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                            >
                              <Wand2 className="w-3.5 h-3.5" /> {t('videoEditor.selection.retouchWand')}
                            </button>
                          </div>
                          {maskEditMode && (
                            <>
                              {maskEditMode === 'wand' ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-gray-400 w-20">{t('videoEditor.selection.retouchTolerance', { value: wandTolerance })}</span>
                                  <Slider
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={[wandTolerance]}
                                    onValueChange={(v) => setWandTolerance(v[0] ?? 15)}
                                    className="flex-1"
                                  />
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-gray-400 w-20">{t('videoEditor.selection.retouchBrush', { value: maskBrushSize })}</span>
                                  <Slider
                                    min={4}
                                    max={80}
                                    step={1}
                                    value={[maskBrushSize]}
                                    onValueChange={([v]) => setMaskBrushSize(v)}
                                    className="flex-1"
                                  />
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={async () => { await flushPendingMaskEdits(); setMaskEditMode(null); }}
                                className="w-full h-8 text-xs border border-teal-500/60 text-teal-200 hover:bg-teal-500/15 rounded-lg"
                              >
                                {t('videoEditor.selection.retouchDone')}
                              </button>
                            </>
                          )}
                        </div>
                      ) : null}
                      {editState.selection.track && (
                        <div className="space-y-2">
                          <p className="text-xs text-gray-500">
                            {editState.selection.shape.type === 'freehand'
                              ? t('videoEditor.selection.trackHelpFreehand')
                              : t('videoEditor.selection.trackHelpRect')}
                          </p>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-400">{t('videoEditor.selection.trackCurrentTime')} <strong className="text-emerald-300 font-mono">{fmtHMS(currentTime)}</strong></span>
                                <Button
                                  variant="ghost"
                                  type="button"
                                  onClick={addSelectionKeyframeHere}
                                  className="ml-auto h-8 px-3 text-xs border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                                >
                                  <Plus className="w-3.5 h-3.5 mr-1" /> {t('videoEditor.selection.pinKeyframe')}
                                </Button>
                              </div>
                              {(editState.selection.shape.keyframes?.length ?? 0) > 0 && (
                                <div className="space-y-1 max-h-40 overflow-y-auto pr-1 scrollbar-thin-transparent">
                                  {[...(editState.selection.shape.keyframes ?? [])]
                                    .sort((a, b) => a.time - b.time)
                                    .map((kf, i) => (
                                      <div key={i} className="flex items-center justify-between bg-gray-900/70 rounded px-2 py-1 border border-gray-700">
                                        <span className="text-xs text-gray-300 font-mono">{fmtHMS(kf.time)}</span>
                                        <span className="text-[10px] text-gray-500">
                                          {t('videoEditor.selection.keyframeCoords', { x: Math.round(kf.x), y: Math.round(kf.y), w: Math.round(kf.width), h: Math.round(kf.height) })}
                                        </span>
                                        <div className="flex items-center gap-1 ml-1">
                                          <button
                                            type="button"
                                            onClick={() => copySelectionCoords(kf)}
                                            className="text-gray-400 hover:text-emerald-300"
                                            title={t('videoEditor.selection.copyCoordsTitle')}
                                          >
                                            <Copy className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => removeSelectionKeyframeAtTime(kf.time)}
                                            className="text-red-400 hover:text-red-300"
                                            title={t('videoEditor.selection.deleteKeyframeTitle')}
                                          >
                                            <X className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              )}

                              <div className="space-y-1 pt-1 border-t border-gray-700/60">
                                <label className="text-[11px] text-gray-400">
                                  {t('videoEditor.selection.applyCoordsLabel')}
                                </label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={selCoordsInput}
                                    onChange={(e) => setSelCoordsInput(e.target.value)}
                                    placeholder={t('videoEditor.selection.applyCoordsPlaceholder')}
                                    className="flex-1 h-8 px-2 text-xs font-mono bg-gray-900/70 border border-gray-600 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/60"
                                  />
                                  <Button
                                    variant="ghost"
                                    type="button"
                                    onClick={applySelectionCoords}
                                    className="h-8 px-3 text-xs border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                                  >
                                    {t('videoEditor.selection.applyCoordsBtn')}
                                  </Button>
                                </div>
                                <p className="text-[10px] text-gray-500">
                                  {t('videoEditor.selection.applyCoordsHelp1')} <Copy className="inline w-2.5 h-2.5" /> {t('videoEditor.selection.applyCoordsHelp2')} <strong>{t('videoEditor.selection.applyCoordsBtn')}</strong> {t('videoEditor.selection.applyCoordsHelp3')}
                                </p>
                              </div>

                              {(editState.selection.shape.keyframes?.length ?? 0) > 0 && (
                                <Button
                                  variant="ghost"
                                  type="button"
                                  onClick={clearSelectionKeyframes}
                                  className="w-full h-8 text-xs border border-gray-600 text-gray-300 hover:bg-white/5"
                                >
                                  {t('videoEditor.selection.clearTracking')}
                                </Button>
                              )}
                            </div>
                          )}

                      {editState.selection.shape.type === 'freehand' && (
                        <p className="text-xs text-gray-500">
                          {t('videoEditor.selection.freehandHelp1')} <strong>{t('videoEditor.selection.freehandHelpHold')}</strong>{' '}
                          {t('videoEditor.selection.freehandHelp2')} {t('videoEditor.selection.freehandHelp3')} <strong>{t('videoEditor.selection.freehandHelpEnter')}</strong>{' '}
                          {t('videoEditor.selection.freehandHelp4')} <strong>{t('videoEditor.selection.freehandHelpPlus')}</strong>{' '}
                          {t('videoEditor.selection.freehandHelp5')}
                          <br />
                          <strong className="text-emerald-400">{t('videoEditor.selection.maskHelp1')}</strong> {t('videoEditor.selection.maskHelp2')} <strong>{t('videoEditor.selection.maskHelpCtrl')}</strong> {t('videoEditor.selection.maskHelp3')} <strong>{t('videoEditor.selection.maskHelpAdd')}</strong>{' '}
                          {t('videoEditor.selection.maskHelp4')} <strong>{t('videoEditor.selection.maskHelpShift')}</strong> {t('videoEditor.selection.maskHelp5')} <strong>{t('videoEditor.selection.maskHelpSubtract')}</strong>{' '}
                          {t('videoEditor.selection.maskHelp6')}
                        </p>
                      )}
                      {editState.selection.shape.type === 'wand' && (
                        <p className="text-xs text-gray-500">
                          {t('videoEditor.selection.wandTip1')} <strong>{t('videoEditor.selection.wandTip2')}</strong> {t('videoEditor.selection.wandTip3')}
                        </p>
                      )}
                      {editState.selection.shape.type !== 'freehand' && editState.selection.shape.type !== 'wand' && (
                        <p className="text-xs text-gray-500">
                          {t('videoEditor.selection.moveHelp')}
                        </p>
                      )}
                      <p className="text-[11px] text-gray-600">
                        {t('videoEditor.selection.transitionsNote')}
                      </p>

                      <Button variant="ghost" onClick={resetSelection} className="w-full border border-gray-600 text-gray-300 hover:bg-white/5">
                        <RefreshCw className="w-4 h-4 mr-2" /> {t('videoEditor.selection.removeSelection')}
                      </Button>

                      {/* Guardar / Cargar selección */}
                      <div className="pt-3 border-t border-emerald-500/20 space-y-2">
                        <label className="text-xs font-medium text-emerald-400 block">{t('videoEditor.selection.saveLoadTitle')}</label>
                        <p className="text-[10px] text-gray-500">
                          {t('videoEditor.selection.saveLoadHelp')}
                        </p>
                        <input
                          type="text"
                          value={selectionSaveName}
                          onChange={(e) => setSelectionSaveName(e.target.value)}
                          placeholder={t('videoEditor.selection.saveNamePlaceholder')}
                          className="w-full h-8 px-2 text-xs bg-gray-900/70 border border-gray-600 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/60"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={saveSelectionToFile}
                            disabled={!editState.selection?.enabled}
                            className="flex-1 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                          >
                            <Save className="w-4 h-4 mr-2" />
                            {t('videoEditor.selection.saveSelection')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => selectionFileInputRef.current?.click()}
                            disabled={!editState.selection?.enabled}
                            className="flex-1 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                          >
                            <FolderOpen className="w-4 h-4 mr-2" />
                            {t('videoEditor.selection.loadSelection')}
                          </Button>
                          <input
                            ref={selectionFileInputRef}
                            type="file"
                            accept=".json"
                            className="hidden"
                            onChange={loadSelectionFromFile}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>


                {/* Crear capa a partir de la selección (recorta video con máscara de selección) */}
                <div className="pt-4 border-t border-emerald-500/30 space-y-3">
                  <label className="text-sm font-medium text-emerald-400 block">{t('videoEditor.selection.layerTitle')}</label>
                  <p className="text-xs text-gray-400">
                    {t('videoEditor.selection.layerDesc1')}{' '}
                    <strong>{t('videoEditor.selection.layerDescPng')}</strong>{t('videoEditor.selection.layerDescPng2')}{' '}
                    <strong>{t('videoEditor.selection.layerDescVideo')}</strong>{t('videoEditor.selection.layerDescVideo2')}
                  </p>
                  {/* Modo de captura: PNG (foto fija) o Vídeo (animado) */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectionLayerMode('png')}
                      className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs transition-all ${selectionLayerMode === 'png' ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                    >
                      <ImagePlus className="w-3.5 h-3.5" /> {t('videoEditor.selection.pngMode')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectionLayerMode('video')}
                      className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs transition-all ${selectionLayerMode === 'video' ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                    >
                      <Video className="w-3.5 h-3.5" /> {t('videoEditor.selection.videoMode')}
                    </button>
                  </div>
                  {selectionLayerMode === 'video' && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-400 shrink-0">{t('videoEditor.selection.duration')}</label>
                      <input
                        type="number"
                        min={0.5}
                        max={20}
                        step={0.5}
                        value={selectionVideoDuration}
                        onChange={(e) => setSelectionVideoDuration(Number(e.target.value))}
                        className="w-24 h-8 px-2 text-xs bg-gray-900/70 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-emerald-500/60"
                      />
                      <span className="text-[10px] text-gray-500">{t('videoEditor.selection.durationHelp')}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={selectionLayerMode === 'video' ? createSelectionVideoLayer : createSelectionLayer}
                      disabled={!editState.selection?.enabled || isCapturingSlides}
                      className="flex-1 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                    >
                      {isCapturingSlides ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {copyProgress ? t('videoEditor.selection.capturingProgress', { current: copyProgress.current, total: copyProgress.total }) : t('videoEditor.selection.capturing')}
                        </>
                      ) : (
                        <>
                          <Scissors className="w-4 h-4 mr-2" />
                          {t('videoEditor.selection.createLayer')}
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={selectionLayerMode === 'video' ? saveSelectionVideoAsWebm : saveSelectionLayerAsPng}
                      disabled={!editState.selection?.enabled || isCapturingSlides}
                      className="flex-1 border-blue-500/40 text-blue-300 hover:bg-blue-500/10"
                    >
                      <Download className="w-4 h-4" />
                      {selectionLayerMode === 'video' ? t('videoEditor.selection.downloadWebm') : t('videoEditor.selection.downloadPng')}
                    </Button>
                  </div>
                </div>
                {/* Pintar sobre el vídeo (brocha / bote / gotero) */}
                <div className="pt-4 border-t border-emerald-500/30 space-y-3">
                  <label className="text-sm font-medium text-emerald-400 block">{t('videoEditor.paint.title')}</label>
                  <p className="text-xs text-gray-400">
                    {t('videoEditor.paint.descPre')} <strong>{t('videoEditor.paint.descBrush')}</strong>{t('videoEditor.paint.descMid')} <strong>{t('videoEditor.paint.descBucket')}</strong> {t('videoEditor.paint.descBucket2')} <strong>{t('videoEditor.paint.descEyedropper')}</strong> {t('videoEditor.paint.descPost')}
                  </p>

                  <div className="flex items-center justify-between bg-gray-900/60 rounded-lg px-3 py-2 border border-gray-700">
                    <span className="text-sm text-gray-200">{t('videoEditor.paint.enable')}</span>
                    <Switch
                      checked={!!editState.paint?.enabled}
                      onCheckedChange={(v) => togglePaint(v)}
                    />
                  </div>

                  {editState.paint?.enabled && (
                    <>
                      {/* Color + herramientas */}
                      <div className="flex items-center gap-2">
                        <label className="relative shrink-0 cursor-pointer" title={t('videoEditor.paint.colorTitle')}>
                          <span
                            className="block h-9 w-9 rounded-lg border border-gray-600"
                            style={{ background: editState.paint.color }}
                          />
                          <input
                            type="color"
                            value={editState.paint.color}
                            onChange={(e) => updatePaint({ color: e.target.value })}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                        </label>
                        <div className="grid grid-cols-4 gap-2 flex-1">
                          <button
                            type="button"
                            title={t('videoEditor.paint.brush')}
                            onClick={() => setPaintTool(paintTool === 'brush' ? null : 'brush')}
                            className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs transition-all ${paintTool === 'brush' ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                          >
                            <Paintbrush className="w-3.5 h-3.5" /> {t('videoEditor.paint.brush')}
                          </button>
                          <button
                            type="button"
                            title={t('videoEditor.paint.bucketTitle')}
                            onClick={() => setPaintTool(paintTool === 'bucket' ? null : 'bucket')}
                            className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs transition-all ${paintTool === 'bucket' ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                          >
                            <PaintBucket className="w-3.5 h-3.5" /> {t('videoEditor.paint.bucket')}
                          </button>
                          <button
                            type="button"
                            title={t('videoEditor.paint.eyedropperTitle')}
                            onClick={() => setPaintTool(paintTool === 'eyedropper' ? null : 'eyedropper')}
                            className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs transition-all ${paintTool === 'eyedropper' ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                          >
                            <Pipette className="w-3.5 h-3.5" /> {t('videoEditor.paint.eyedropper')}
                          </button>
                          <button
                            type="button"
                            title={t('videoEditor.paint.eraser')}
                            onClick={() => setPaintTool(paintTool === 'eraser' ? null : 'eraser')}
                            className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs transition-all ${paintTool === 'eraser' ? 'bg-red-500/20 border-red-500/60 text-red-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}
                          >
                            <Eraser className="w-3.5 h-3.5" /> {t('videoEditor.paint.eraser')}
                          </button>
                        </div>
                      </div>

                      {(paintTool === 'brush' || paintTool === 'bucket' || paintTool === 'eraser') && (
                        <p className="text-[11px] text-gray-500">
                          {(() => {
                            const selSuffix = editState.selection?.enabled
                              ? (editState.selection.scope === 'inside' ? t('videoEditor.paint.selInside') : t('videoEditor.paint.selOutside'))
                              : '';
                            if (paintTool === 'brush') return t('videoEditor.paint.brushHelp', { sel: selSuffix });
                            if (paintTool === 'eraser') return t('videoEditor.paint.eraserHelp');
                            return t('videoEditor.paint.bucketHelp', { sel: selSuffix });
                          })()}
                        </p>
                      )}
                      {editState.selection?.enabled && editState.selection.scope === 'inside' && (paintTool === 'brush' || paintTool === 'bucket') && (
                        <p className="text-[11px] text-emerald-400/80">
                          {t('videoEditor.paint.selNote')}
                        </p>
                      )}
                      {paintTool === 'eyedropper' && (
                        <p className="text-[11px] text-gray-500">
                          {t('videoEditor.paint.eyedropperHelp')}
                        </p>
                      )}

                      {/* Tamaño del pincel / borrador */}
                      <div>
                        <label className="text-xs text-gray-400 flex justify-between mb-1.5">
                          {paintTool === 'eraser' ? t('videoEditor.paint.eraserSize') : t('videoEditor.paint.brushSize')}
                          <span className="text-gray-300">{editState.paint.brushSize} px</span>
                        </label>
                        <Slider
                          value={[editState.paint.brushSize]}
                          min={5}
                          max={400}
                          step={1}
                          onValueChange={(v) => updatePaint({ brushSize: v[0] })}
                        />
                      </div>

                      {/* Opacidad de la capa */}
                      <div>
                        <label className="text-xs text-gray-400 flex justify-between mb-1.5">
                          {t('videoEditor.paint.layerOpacity')}
                          <span className="text-gray-300">{editState.paint.opacity} %</span>
                        </label>
                        <Slider
                          value={[editState.paint.opacity]}
                          min={0}
                          max={100}
                          step={1}
                          onValueChange={(v) => updatePaint({ opacity: v[0] })}
                        />
                      </div>

                      {/* Rango temporal */}
                      <div className="flex items-center justify-between bg-gray-900/60 rounded-lg px-3 py-2 border border-gray-700">
                        <span className="text-sm text-gray-200">{t('videoEditor.selection.timeOnly')}</span>
                        <Switch
                          checked={!!editState.paint.timeEnabled}
                          onCheckedChange={togglePaintTime}
                        />
                      </div>
                      {editState.paint.timeEnabled && (
                        <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.selection.timeFrom')}</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              defaultValue={fmtHMS(editState.paint.timeStart ?? 0)}
                              key={`pts-${editState.paint.timeStart ?? 0}`}
                              onBlur={(e) => {
                                const v = parseHMS(e.target.value);
                                if (v !== null) setPaintTime('timeStart', v);
                                else e.target.value = fmtHMS(editState.paint?.timeStart ?? 0);
                              }}
                              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.selection.timeTo')}</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              defaultValue={fmtHMS(editState.paint.timeEnd ?? 0)}
                              key={`pte-${editState.paint.timeEnd ?? 0}`}
                              onBlur={(e) => {
                                const v = parseHMS(e.target.value);
                                if (v !== null) setPaintTime('timeEnd', v);
                                else e.target.value = fmtHMS(editState.paint?.timeEnd ?? 0);
                              }}
                              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.selection.fadeIn')}</label>
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              defaultValue={editState.paint.fadeIn ?? 0}
                              key={`pfi-${editState.paint.fadeIn ?? 0}`}
                              onBlur={(e) => setPaintFade('fadeIn', parseFloat(e.target.value))}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.selection.fadeOut')}</label>
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              defaultValue={editState.paint.fadeOut ?? 0}
                              key={`pfo-${editState.paint.fadeOut ?? 0}`}
                              onBlur={(e) => setPaintFade('fadeOut', parseFloat(e.target.value))}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                            />
                          </div>
                        </div>
                        </>
                      )}
                      {editState.paint.timeEnabled && (
                        <p className="text-xs text-gray-500">
                          {t('videoEditor.paint.timeRangeNote', { duration: fmtHMS(editState.timeline?.duration ?? 0) })}
                        </p>
                      )}

                      {!editState.paint.timeEnabled && (
                        <p className="text-xs text-gray-500">
                          {t('videoEditor.paint.noTimeRangeNote')}
                        </p>
                      )}

                      {/* Rellenar todo menos la selección: rellena el vídeo con el color de
                          pintura excepto la selección (dentro/fuera según scope). El
                          agujero sigue a la selección en cada frame (sin raster). */}
                      <div className="space-y-1.5">
                        <Button
                          variant="ghost"
                          type="button"
                          onClick={togglePaintInverseFill}
                          className={`w-full h-8 text-xs border ${editState.paint?.inverseFill ? 'border-emerald-500/60 text-emerald-300 bg-emerald-500/15' : 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10'}`}
                        >
                          {editState.paint?.inverseFill ? t('videoEditor.paint.removeFill') : t('videoEditor.paint.applyFill')}
                        </Button>
                        <p className="text-[11px] text-gray-500">
                          {t('videoEditor.paint.fillHelp1')} <strong>{t('videoEditor.paint.fillHelpInside')}</strong> {t('videoEditor.paint.fillHelp2')} <strong>{t('videoEditor.paint.fillHelpOutside')}</strong> {t('videoEditor.paint.fillHelp3')}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={clearPaintMask} className="flex-1 border border-gray-600 text-gray-300 hover:bg-white/5">
                          <Trash2 className="w-4 h-4 mr-2" /> {t('videoEditor.paint.clearPaint')}
                        </Button>
                        <Button variant="ghost" onClick={resetPaint} className="flex-1 border border-gray-600 text-gray-300 hover:bg-white/5">
                          <RefreshCw className="w-4 h-4 mr-2" /> {t('videoEditor.paint.remove')}
                        </Button>
                      </div>
                    </>
                  )}
                </div>

              </TabsContent>

              <TabsContent value="text" className="mt-2">
                <VideoTextEditor
                  textClips={editState.textClips || []}
                  onAddTextClip={handleAddTextClip}
                  onUpdateTextClip={handleUpdateTextClip}
                  onDeleteTextClip={handleDeleteTextClip}
                  currentTime={editState.timeline?.currentTime || 0}
                  videoDuration={editState.timeline?.duration || 60}
                  customStyle={customFontStyle}
                  pendingStyleApplication={pendingTextStyleApplication}
                  onSeek={handleTimelineTimeUpdate}
                />
              </TabsContent>
              <TabsContent value="objects" className="mt-2 flex-1 flex flex-col min-h-0">
                <VideoObjectEditor
                  objectClips={[...deformableObjectClips, ...normalObjectClips]}
                  availableObjects={getOverlayObjects()}
                  currentTime={editState.timeline?.currentTime || 0}
                  videoDuration={editState.timeline?.duration || 60}
                  selectedObjectId={selectedObjectId}
                  onSelectObject={setSelectedObjectId}
                  onAddObjectClip={handleAddObjectClip}
                  onUpdateObjectClip={handleUpdateObjectClip}
                  onDeleteObjectClip={handleDeleteObjectClip}
                  onMoveObjectLayer={handleMoveObjectLayer}
                  onSeek={handleTimelineTimeUpdate}
                  videoSrcUrl={getCurrentVideoSource()}
                  videoNativeSize={videoNativeSize ?? previewVideoSize}
                  trackingRegion={trackingRegion}
                  onTrackingRegionChange={setTrackingRegion}
                  trackingLazoPath={trackingLazoPath}
                  onTrackingLazoPathChange={setTrackingLazoPath}
                  trackingMode={trackingMode}
                  onTrackingModeChange={setTrackingMode}
                  isDrawingTrackingRegion={isDrawingTrackingRegion}
                  onDrawingTrackingRegionChange={setIsDrawingTrackingRegion}
                  onToast={(title, description) => toast({ title, description })}
                  onMotionDataChange={setTrackingPreviewData}
                  onClearSelection={() => setEditState(prev => prev.selection ? { ...prev, selection: { ...prev.selection, enabled: false } } : prev)}
                  serverStatus={ltxServerStatus}
                  serverMessage={ltxServerMessage}
                  isStartingServers={isStartingLtxServers}
                  onStartServers={handleStartLtxServers}
                  onRestartBridge={handleRestartBridge}
                  onSam2Track={runSam2Tracking}
                  sam2Ready={
                    !!sam2WorkflowJson
                    && !!sam2VideoNode.trim()
                    && !!sam2PointsNode.trim()
                    && !!ltxServerStatus.comfyui
                    && !!ltxServerStatus.fluxBridge
                  }
                  selectionRegionFallback={(() => {
                    const sel = editState.selection;
                    if (!sel?.enabled) return null;
                    const shape = effectiveSelectionShape(sel, editState.timeline?.currentTime || 0);
                    if (!shape) return null;
                    if (shape.type === 'freehand' && shape.paths?.length) {
                      const b = pathsBBox(shape.paths);
                      if (b.width > 0.5 && b.height > 0.5) return b;
                    }
                    if (shape.width > 0.5 && shape.height > 0.5) {
                      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
                    }
                    return null;
                  })()}
                />
              </TabsContent>
              <TabsContent value="vertex" className="mt-14 space-y-4">
                <div className="rounded-xl bg-gray-800/60 border border-emerald-500/30 p-4 space-y-4">
                  <h4 className="text-sm font-bold text-emerald-400 flex items-center gap-2 uppercase tracking-wider text-[10px]">
                    <Grid3x3 className="w-4 h-4" />
                    {t('videoEditor.vertex.title')}
                  </h4>
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    {t('videoEditor.vertex.desc')}
                  </p>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsCalibrating(!isCalibrating)}
                      className={cn(
                        "border-gray-700 hover:bg-gray-700",
                        isCalibrating ? "bg-red-900/40 border-red-500/50 text-red-300" : "bg-gray-800/50"
                      )}
                    >
                      {isCalibrating ? (
                        <><Video className="h-4 w-4 mr-2 text-red-400" /> {t('videoEditor.vertex.confirmArea')}</>
                      ) : (
                        <><Video className="h-4 w-4 mr-2" /> {t('videoEditor.vertex.adjustArea')}</>
                      )}
                    </Button>
                    {!isCalibrating && (
                      <span className="text-[10px] text-gray-500 font-mono">
                        {recordingArea.width}×{recordingArea.height} @ ({recordingArea.x},{recordingArea.y})
                      </span>
                    )}
                  </div>

                  {!isCalibrating && (
                    <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-3 space-y-4">
                      <p className="text-xs font-semibold text-gray-300 flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-red-500" /> {t('videoEditor.vertex.redCorrection')}
                      </p>
                      <p className="text-[10px] text-gray-500 leading-tight">{t('videoEditor.vertex.redCorrectionHelp')}</p>
                      <div className="flex gap-2">
                        <div className="flex-1 space-y-1">
                          <span className="text-[10px] text-gray-500">{t('videoEditor.vertex.offsetX')}</span>
                          <input
                            type="number"
                            value={mouseOffsetX}
                            onChange={(e) => setMouseOffsetX(parseInt(e.target.value || '0', 10))}
                            className="w-full h-8 bg-gray-900 border border-gray-600 rounded-lg px-2 text-xs text-white outline-none focus:ring-1 focus:ring-emerald-400"
                          />
                        </div>
                        <div className="flex-1 space-y-1">
                          <span className="text-[10px] text-gray-500">{t('videoEditor.vertex.offsetY')}</span>
                          <input
                            type="number"
                            value={mouseOffsetY}
                            onChange={(e) => setMouseOffsetY(parseInt(e.target.value || '0', 10))}
                            className="w-full h-8 bg-gray-900 border border-gray-600 rounded-lg px-2 text-xs text-white outline-none focus:ring-1 focus:ring-emerald-400"
                          />
                        </div>
                      </div>

                      <p className="text-xs font-semibold text-gray-300 flex items-center gap-2 pt-1 border-t border-gray-700">
                        <span className="h-2 w-2 rounded-full bg-amber-500" /> {t('videoEditor.vertex.captureOffset')}
                      </p>
                      <p className="text-[10px] text-gray-500 leading-tight">{t('videoEditor.vertex.captureOffsetHelp')}</p>
                      <div className="flex gap-2">
                        <div className="flex-1 space-y-1">
                          <span className="text-[10px] text-gray-500">{t('videoEditor.vertex.offsetX')}</span>
                          <input
                            type="number"
                            value={vertexAreaOffsetX}
                            onChange={(e) => setVertexAreaOffsetX(parseInt(e.target.value || '0', 10))}
                            className="w-full h-8 bg-gray-900 border border-gray-600 rounded-lg px-2 text-xs text-white outline-none focus:ring-1 focus:ring-amber-400"
                          />
                        </div>
                        <div className="flex-1 space-y-1">
                          <span className="text-[10px] text-gray-500">{t('videoEditor.vertex.offsetY')}</span>
                          <input
                            type="number"
                            value={vertexAreaOffsetY}
                            onChange={(e) => setVertexAreaOffsetY(parseInt(e.target.value || '0', 10))}
                            className="w-full h-8 bg-gray-900 border border-gray-600 rounded-lg px-2 text-xs text-white outline-none focus:ring-1 focus:ring-amber-400"
                          />
                        </div>
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {t('videoEditor.vertex.areaInfo', { w: Math.round(vertexCaptureArea.width), h: Math.round(vertexCaptureArea.height), x: Math.round(vertexCaptureArea.x), y: Math.round(vertexCaptureArea.y) })}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="w-full h-11 border-emerald-700 bg-emerald-900/20 hover:bg-emerald-900/40 text-emerald-300 font-bold rounded-lg"
                    onClick={() => {
                      const capturedCount = verticesCaptured.filter(v => v !== null).length;
                      if (capturedCount < 4) {
                        setIsCapturingVertex(true);
                        toast({ title: t('videoEditor.vertex.captureModeOn'), description: t('videoEditor.vertex.captureModeOnDesc', { n: capturedCount + 1 }) });
                      }
                    }}
                    disabled={isCapturingVertex || verticesCaptured.filter(v => v !== null).length >= 4}
                  >
                    {isCapturingVertex ? t('videoEditor.vertex.selecting') : t('videoEditor.vertex.selectVertex', { n: verticesCaptured.filter(v => v !== null).length + 1 })}
                  </Button>

                  {verticesCaptured.some(v => v !== null) && (
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      {verticesCaptured.map((v, i) => (
                        <div key={i} className={cn(
                          "flex items-center justify-between px-2 py-1 rounded border",
                          v ? "border-emerald-500/30 bg-emerald-900/20 text-emerald-300" : "border-gray-700 bg-gray-800 text-gray-500"
                        )}>
                          <span>{t('videoEditor.vertex.vertBadge', { n: i + 1, label: t(`videoEditor.vertex.pos${['TL', 'TR', 'BR', 'BL'][i]}`) })}</span>
                          {v ? <span className="font-mono">{v.x},{v.y}</span> : <span>—</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {verticesCaptured.filter(v => v !== null).length === 4 && (
                  <Button
                    className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 font-bold rounded-lg shadow-lg shadow-emerald-500/30"
                    onClick={() => {
                      const instant = {
                        id: crypto.randomUUID(),
                        time: currentTime,
                        vertices: [...verticesCaptured],
                        width: previewVideoSize?.width ?? videoNativeSize?.width ?? 1920,
                        height: previewVideoSize?.height ?? videoNativeSize?.height ?? 1080,
                        opacity: 100,
                      };
                      setVertexInstants(prev => [...prev, instant]);
                      if (typeof window !== 'undefined') {
                        localStorage.setItem('zeus-vertex-instants', JSON.stringify([...vertexInstants, instant]));
                      }
                      setVerticesCaptured([null, null, null, null]);
                      setIsCapturingVertex(false);
                      toast({ title: t('videoEditor.vertex.instantCreated'), description: t('videoEditor.vertex.instantCreatedDesc', { time: currentTime.toFixed(2) }) });
                    }}
                  >
                    <Save className="h-4 w-4 mr-2" /> {t('videoEditor.vertex.createInstant')}
                  </Button>
                )}

                {vertexInstants.length > 0 && (
                  <div className="rounded-lg border border-blue-500/30 bg-blue-950/20 p-3 space-y-3">
                    <h5 className="text-xs font-bold text-blue-300 uppercase tracking-wider flex items-center gap-2">
                      <Wand2 className="w-3.5 h-3.5" /> {t('videoEditor.vertex.applyToObject')}
                    </h5>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      {t('videoEditor.vertex.applyDesc1')} <b className="text-blue-300">{t('videoEditor.vertex.applyDescDeforms')}</b>
                      {t('videoEditor.vertex.applyDesc2')} <b className="text-blue-300">{t('videoEditor.vertex.applyDescAnimates')}</b>
                      {t('videoEditor.vertex.applyDesc3')}
                    </p>
                    <div className="space-y-1">
                      <span className="text-[10px] text-gray-500">{t('videoEditor.vertex.targetObject')}</span>
                      <select
                        value={vertexTargetObjectId}
                        onChange={(e) => setVertexTargetObjectId(e.target.value)}
                        className="w-full h-9 bg-gray-900 border border-gray-600 rounded-lg px-2 text-xs text-white outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        <option value="">{t('videoEditor.vertex.selectObject')}</option>
                        {resolvedObjectClips.map((clip) => (
                          <option key={clip.id} value={clip.id}>{clip.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-1 border-t border-blue-500/20 pt-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] text-gray-300 block">{t('videoEditor.vertex.trackEngine')}</span>
                        <span className="text-[9px] text-gray-500">{t('videoEditor.vertex.trackEngineHelp')}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <div className="flex items-center gap-1 bg-gray-950/60 rounded-lg p-0.5 border border-gray-700">
                          <button
                            type="button"
                            onClick={() => setVertexTrackEngine('sam2')}
                            className={`px-2 py-1 text-[10px] uppercase font-bold rounded-md tracking-wider transition-colors ${vertexTrackEngine === 'sam2' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                            title={t('videoEditor.vertex.sam2EngineTitle2')}
                          >{t('videoEditor.objects.engineSam2')}</button>
                          <button
                            type="button"
                            onClick={() => setVertexTrackEngine('pattern')}
                            className={`px-2 py-1 text-[10px] uppercase font-bold rounded-md tracking-wider transition-colors ${vertexTrackEngine === 'pattern' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                            title={t('videoEditor.objects.patternTitle')}
                          >{t('videoEditor.objects.enginePattern')}</button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-1">
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] text-gray-300 block">{t('videoEditor.vertex.interpolateTitle')}</span>
                        <span className="text-[9px] text-gray-500">{t('videoEditor.vertex.interpolateHelp')}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-gray-400">{t('videoEditor.vertex.everyNFrames')}</span>
                        <input
                          type="number"
                          min={1}
                          max={120}
                          value={vertexSampleFps}
                          onChange={(e) => setVertexSampleFps(Math.max(1, parseInt(e.target.value || '1', 10) || 1))}
                          className="w-20 h-8 bg-gray-900 border border-gray-600 rounded-lg px-2 text-xs text-white outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </div>
                    </div>
                  {verticesCaptured.filter(v => v !== null).length === 4 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-gray-700 hover:bg-gray-700 text-xs"
                      onClick={() => setVerticesCaptured(prev => sortVerticesClockwise(prev))}
                      title={t('videoEditor.vertex.reorderTitle')}
                    >
                      {t('videoEditor.vertex.reorderBtn')}
                    </Button>
                    )}
                    <Button
                      className="w-full h-10 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 font-bold rounded-lg"
                      disabled={!vertexTargetObjectId || selectedInstantIds.size === 0}
                      onClick={() => applyVertexInstantsToObject(vertexTargetObjectId, Array.from(selectedInstantIds))}
                    >
                      <Wand2 className="w-4 h-4 mr-2" /> {t('videoEditor.vertex.applyCount', { n: selectedInstantIds.size, s: selectedInstantIds.size === 1 ? '' : 's' })}
                    </Button>
                    {selectedInstantIds.size >= 1 && vertexInstants.filter(iv => selectedInstantIds.has(iv.id) && iv.vertices.filter(v => v !== null).length === 4).length >= 1 && (
                    <Button
                      variant="outline"
                      className={`w-full h-10 font-bold rounded-lg ${vertexTrackEngine === 'sam2' ? 'border-violet-700 bg-violet-900/20 hover:bg-violet-900/40 text-violet-300' : 'border-emerald-700 bg-emerald-900/20 hover:bg-emerald-900/40 text-emerald-300'}`}
                      disabled={isVertexTracking}
                      onClick={async () => {
                        const ids = Array.from(selectedInstantIds);
                        setIsVertexTracking(true);
                        try {
                          await trackVertexBetweenMarks(ids, (p, msg) => {
                            toast({ title: t('videoEditor.vertex.vertexTracking'), description: t('videoEditor.vertex.vertexTrackingDesc', { percent: Math.round(p * 100), msg }) });
                          });
                        } finally {
                          setIsVertexTracking(false);
                        }
                      }}
                    >
                      {isVertexTracking ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('videoEditor.vertex.trackDots')}</>
                      ) : (
                          <>
                          <KeyRound className="w-4 h-4 mr-2" />
                          {t('videoEditor.vertex.trackFromMarks')}{vertexTrackEngine === 'sam2' ? t('videoEditor.vertex.trackFromMarksSam2') : t('videoEditor.vertex.trackFromMarksPattern')}
                        </>
                      )}
                    </Button>
                    )}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <div className={`w-2 h-2 rounded-full ${ltxServerStatus.comfyui ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'}`} />
                        <span className="text-[9px] text-gray-400">{t('videoEditor.selection.sam2Comfyui')}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className={`w-2 h-2 rounded-full ${ltxServerStatus.fluxBridge ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'}`} />
                        <span className="text-[9px] text-gray-400">{t('videoEditor.selection.sam2Bridge')}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleStartLtxServers}
                        disabled={isStartingLtxServers || (ltxServerStatus.comfyui && ltxServerStatus.fluxBridge)}
                        className="ml-auto text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-violet-500/20 text-violet-300 hover:bg-violet-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-violet-500/30"
                      >
                        {isStartingLtxServers ? t('videoEditor.selection.sam2Starting') : ltxServerStatus.comfyui && ltxServerStatus.fluxBridge ? t('videoEditor.vertex.serversReady2') : t('videoEditor.vertex.startComfyBridge')}
                      </button>
                    </div>
                    {ltxServerMessage && (
                      <p className={`text-[9px] uppercase tracking-wider ${ltxServerMessage.includes('listo') ? 'text-green-400' : ltxServerMessage.includes('Error') ? 'text-red-400' : 'text-violet-300'}`}>
                        {ltxServerMessage}
                      </p>
                    )}
                    {lastVertexApply && (
                      <div className="text-[10px] text-emerald-300 bg-emerald-900/20 border border-emerald-500/30 rounded-lg px-2 py-1.5 leading-tight">
                        {t('videoEditor.vertex.generated', { count: lastVertexApply.count, name: lastVertexApply.objectName })}
                        {lastVertexApply.dense ? t('videoEditor.vertex.generatedDense') : t('videoEditor.vertex.generatedSparse')}
                        {t('videoEditor.vertex.generatedPost')}
                      </div>
                    )}
                  </div>
                )}

                {vertexInstants.length > 0 && (
                  <div className="space-y-1 max-h-60 overflow-y-auto thin-scrollbar">
                    <div className="flex items-center justify-between mb-2">
                      <h5 className="text-xs font-semibold text-gray-300">{t('videoEditor.vertex.instantsCreated', { n: vertexInstants.length })}</h5>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setSelectedInstantIds(new Set(vertexInstants.map((v) => v.id)))}
                          className="text-[9px] px-2 py-0.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-700"
                        >{t('videoEditor.vertex.all')}</button>
                        <button
                          type="button"
                          onClick={() => setSelectedInstantIds(new Set())}
                          className="text-[9px] px-2 py-0.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-700"
                        >{t('videoEditor.vertex.none')}</button>
                      </div>
                    </div>
                    {vertexInstants.map((instant, idx) => {
                      const isActive = editingInstantId === instant.id;
                      const isSelected = selectedInstantIds.has(instant.id);
                      const has4 = instant.vertices.filter(v => v !== null).length === 4;
                      return (
                        <div
                          key={instant.id}
                          className={`w-full text-left rounded-lg border p-3 transition-colors ${
                            isActive
                              ? 'border-purple-500 bg-purple-500/10'
                              : isSelected
                                ? 'border-blue-500/50 bg-blue-500/5'
                                : 'border-gray-700 bg-gray-800/40 hover:border-gray-500'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={!has4}
                                onChange={(e) => {
                                  setSelectedInstantIds(prev => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(instant.id);
                                    else next.delete(instant.id);
                                    return next;
                                  });
                                }}
                                className="w-4 h-4 accent-blue-500 shrink-0"
                                title={has4 ? t('videoEditor.vertex.markTitle') : t('videoEditor.vertex.missingVertsTitle')}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-white truncate">{t('videoEditor.vertex.instantNum', { n: idx + 1 })}</div>
                                <div className="text-[11px] text-gray-400 mt-1">
                                  {t('videoEditor.vertex.timeLabel')} <span className="font-mono text-emerald-300">{instant.time.toFixed(2)}s</span>
                                  {' · '}{t('videoEditor.vertex.frameLabel')} <span className="font-mono text-emerald-300">{Math.floor(instant.time * 30)}</span>
                                  {' · '}{t('videoEditor.vertex.dimsLabel')} <span className="font-mono text-emerald-300">{instant.width}×{instant.height}</span>
                                  {' · '}{t('videoEditor.vertex.opacityLabel')} <span className="font-mono text-emerald-300">{instant.opacity}%</span>
                                  {' · '}{t('videoEditor.vertex.vertsLabel')} <span className="font-mono text-emerald-300">{instant.vertices.filter(v => v !== null).length}/4</span>
                                </div>
                                <div className="text-[10px] text-gray-500 mt-1 font-mono">
                                  {instant.vertices.map((v, j) => v ? t('videoEditor.vertex.vEq', { n: j + 1, x: v.x, y: v.y }) : t('videoEditor.vertex.vMissing', { n: j + 1 })).join(' ')}
                                </div>
                              </div>
                            </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const validVerts = instant.vertices.filter(v => v !== null);
                                  const coordsText = validVerts.map(v => `${v!.x},${v!.y}`).join(' ');
                                  try {
                                    const api = (typeof window !== 'undefined' ? (window as any).electronAPI : undefined);
                                    if (api?.clipboardWriteText) {
                                      await api.clipboardWriteText(coordsText);
                                    } else {
                                      await navigator.clipboard.writeText(coordsText);
                                    }
                                    setManualPointText(coordsText);
                                    toast({ title: t('videoEditor.selection.coordsCopied'), description: coordsText });
                                  } catch {
                                    const ta = document.createElement('textarea');
                                    ta.value = coordsText;
                                    ta.style.position = 'fixed';
                                    ta.style.opacity = '0';
                                    document.body.appendChild(ta);
                                    ta.select();
                                    document.execCommand('copy');
                                    document.body.removeChild(ta);
                                    setManualPointText(coordsText);
                                    toast({ title: t('videoEditor.selection.coordsCopied'), description: coordsText });
                                  }
                                }}
                                className="p-1 rounded border border-white/5 text-gray-400 hover:text-blue-400 transition-colors"
                                title={t('videoEditor.vertex.copyCoordsToTest')}
                                disabled={instant.vertices.filter(v => v !== null).length < 4}
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isActive) {
                                      setEditingInstantId(null);
                                    } else {
                                      setEditingInstantId(instant.id);
                                    }
                                  }}
                                  className={cn(
                                    "p-1 rounded border border-white/5 transition-colors",
                                    isActive ? "text-purple-400 hover:text-purple-300" : "text-gray-400 hover:text-purple-400"
                                  )}
                                  title={isActive ? t('videoEditor.vertex.cancelEdit') : t('videoEditor.text.editKfTitle')}
                                >
                                  <PenTool className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setVertexInstants(prevInstants => {
                                      const filtered = prevInstants.filter(v => v.id !== instant.id);
                                      if (typeof window !== 'undefined') {
                                        localStorage.setItem('zeus-vertex-instants', JSON.stringify(filtered));
                                      }
                                      return filtered;
                                    });
                                    toast({ title: t('videoEditor.vertex.instantDeleted'), variant: 'default' });
                                  }}
                                  className="p-1 rounded border border-white/5 text-gray-400 hover:text-red-400 transition-colors"
                                  title={t('videoEditor.text.deleteKfTitle')}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                          </div>
                          {isActive && (
                            <div className="mt-3 space-y-3 pt-3 border-t border-purple-500/30">
                              <div>
                                <span className="text-[10px] text-gray-500">{t('videoEditor.vertex.timeSec')}</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={instant.time.toFixed(2)}
                                  onChange={(e) => {
                                    const newTime = parseFloat(e.target.value || '0');
                                    setVertexInstants(prev => {
                                      const updated = prev.map(v => v.id === instant.id ? { ...v, time: newTime } : v);
                                      if (typeof window !== 'undefined') localStorage.setItem('zeus-vertex-instants', JSON.stringify(updated));
                                      return updated;
                                    });
                                  }}
                                  className="w-full h-8 bg-gray-900 border border-purple-500/30 rounded px-2 text-xs text-white outline-none focus:ring-1 focus:ring-purple-400"
                                />
                              </div>
                              <div>
                                <span className="text-[10px] text-gray-500">{t('videoEditor.vertex.opacityPct')}</span>
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={instant.opacity}
                                  onChange={(e) => {
                                    const newOpacity = parseInt(e.target.value || '100', 10);
                                    setVertexInstants(prev => {
                                      const updated = prev.map(v => v.id === instant.id ? { ...v, opacity: newOpacity } : v);
                                      if (typeof window !== 'undefined') localStorage.setItem('zeus-vertex-instants', JSON.stringify(updated));
                                      return updated;
                                    });
                                  }}
                                  className="w-full h-8 bg-gray-900 border border-purple-500/30 rounded px-2 text-xs text-white outline-none focus:ring-1 focus:ring-purple-400"
                                />
                              </div>
                              <div>
                                <span className="text-[10px] text-gray-500">{t('videoEditor.vertex.dimsWH')}</span>
                                <input
                                  type="text"
                                  value={`${instant.width}×${instant.height}`}
                                  onChange={(e) => {
                                    const match = e.target.value.match(/(\d+)\s*[×xX]\s*(\d+)/);
                                    if (match) {
                                      const w = parseInt(match[1], 10);
                                      const h = parseInt(match[2], 10);
                                      setVertexInstants(prev => {
                                        const updated = prev.map(v => v.id === instant.id ? { ...v, width: w, height: h } : v);
                                        if (typeof window !== 'undefined') localStorage.setItem('zeus-vertex-instants', JSON.stringify(updated));
                                        return updated;
                                      });
                                    }
                                  }}
                                  className="w-full h-8 bg-gray-900 border border-purple-500/30 rounded px-2 text-xs text-white outline-none focus:ring-1 focus:ring-purple-400"
                                />
                              </div>
                              {instant.vertices.filter(v => v !== null).length === 4 && (
                                <div className="space-y-2">
                                  <span className="text-[10px] text-gray-500">{t('videoEditor.vertex.vertCoordsEditable')}</span>
                                  {instant.vertices.map((v, j) => v && (
                                    <div key={j} className="grid grid-cols-2 gap-2">
                                      <div>
                                        <span className="text-[9px] text-gray-500">{t('videoEditor.vertex.vertXY', { n: j + 1, axis: 'X', label: t(`videoEditor.vertex.pos${['TL', 'TR', 'BR', 'BL'][j]}`) })}</span>
                                        <input
                                          type="number"
                                          value={v.x}
                                          onChange={(e) => {
                                            const newX = parseInt(e.target.value || '0', 10);
                                            setVertexInstants(prev => {
                                              const updated = prev.map(iv => {
                                                if (iv.id !== instant.id) return iv;
                                                const nextVerts = [...(iv.vertices as Array<{ x: number; y: number } | null>)];
                                                nextVerts[j] = { x: newX, y: v.y };
                                                return { ...iv, vertices: nextVerts };
                                              });
                                              if (typeof window !== 'undefined') localStorage.setItem('zeus-vertex-instants', JSON.stringify(updated));
                                              return updated;
                                            });
                                          }}
                                          className="w-full h-7 bg-gray-900 border border-purple-500/30 rounded px-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-purple-400"
                                        />
                                      </div>
                                      <div>
                                        <span className="text-[9px] text-gray-500">{t('videoEditor.vertex.vertXY', { n: j + 1, axis: 'Y', label: t(`videoEditor.vertex.pos${['TL', 'TR', 'BR', 'BL'][j]}`) })}</span>
                                        <input
                                          type="number"
                                          value={v.y}
                                          onChange={(e) => {
                                            const newY = parseInt(e.target.value || '0', 10);
                                            setVertexInstants(prev => {
                                              const updated = prev.map(iv => {
                                                if (iv.id !== instant.id) return iv;
                                                const nextVerts = [...(iv.vertices as Array<{ x: number; y: number } | null>)];
                                                nextVerts[j] = { x: v.x, y: newY };
                                                return { ...iv, vertices: nextVerts };
                                              });
                                              if (typeof window !== 'undefined') localStorage.setItem('zeus-vertex-instants', JSON.stringify(updated));
                                              return updated;
                                            });
                                          }}
                                          className="w-full h-7 bg-gray-900 border border-purple-500/30 rounded px-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-purple-400"
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                  <Button
                    className="w-full h-11 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 font-bold rounded-lg shadow-lg shadow-blue-500/20"
                    onClick={async () => {
                      if (typeof window !== 'undefined') {
                        localStorage.setItem('zeus-recording-area', JSON.stringify(recordingArea));
                        localStorage.setItem('zeus-mouse-offset-x', String(mouseOffsetX));
                        localStorage.setItem('zeus-mouse-offset-y', String(mouseOffsetY));
                        localStorage.setItem('zeus-real-mouse-offset-x', String(realMouseOffsetX));
                        localStorage.setItem('zeus-real-mouse-offset-y', String(realMouseOffsetY));
                        localStorage.setItem('zeus-real-mouse-scale-x', String(realMouseScaleX));
                         localStorage.setItem('zeus-real-mouse-scale-y', String(realMouseScaleY));
                         localStorage.setItem('zeus-vertex-area-offset-x', String(vertexAreaOffsetX));
                         localStorage.setItem('zeus-vertex-area-offset-y', String(vertexAreaOffsetY));
                      }
                      setIsCalibrating(false);
                      toast({ title: t('videoEditor.vertex.correctionsSaved'), description: t('videoEditor.vertex.correctionsSavedDesc') });
                    }}
                  >
                    <Save className="h-4 w-4 mr-2" /> {t('videoEditor.vertex.saveCorrections')}
                  </Button>

                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder={t('videoEditor.vertex.pointPlaceholder')}
                        value={manualPointText}
                        onChange={(e) => setManualPointText(e.target.value)}
                        className="flex-1 h-10 bg-[#0d1117] border border-gray-700 rounded-lg px-3 text-xs text-white outline-none focus:ring-1 focus:ring-blue-400"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-blue-700 bg-blue-900/20 hover:bg-blue-900/40 text-blue-200"
                        onClick={async () => {
                          const match = manualPointText.match(/(\d+)\s*,\s*(\d+)/);
                          if (!match) {
                            toast({ title: t('videoEditor.selection.invalidFormat'), description: t('videoEditor.vertex.invalidFormatDesc2'), variant: 'destructive' });
                            return;
                          }
                          const x = parseInt(match[1], 10);
                          const y = parseInt(match[2], 10);
                          if (x < 0 || y < 0 || x > recordingArea.width || y > recordingArea.height) {
                            toast({
                              title: t('videoEditor.vertex.outOfArea'),
                              description: t('videoEditor.vertex.outOfAreaDesc', { w: recordingArea.width, h: recordingArea.height }),
                              variant: 'destructive',
                            });
                            return;
                          }
                          try {
                            setIsCapturingTest(true);
                            const apiBase = typeof window !== 'undefined' && (window as any).ZEUS_SERVE_PORT
                              ? `http://localhost:${(window as any).ZEUS_SERVE_PORT}`
                              : 'http://localhost:3032';
                            const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
                            let windowX = window.screenLeft || window.screenX || 0;
                            let windowY = window.screenTop || window.screenY || 0;
                            if ((window as any).electronAPI?.getWindowBounds) {
                              const bounds = await (window as any).electronAPI.getWindowBounds();
                              if (bounds && bounds.content) {
                                windowX = bounds.content.x;
                                windowY = bounds.content.y;
                              }
                            }
                            const areaPhysicalX = Math.round((windowX + recordingArea.x + mouseOffsetX) * dpr);
                            const areaPhysicalY = Math.round((windowY + recordingArea.y + mouseOffsetY) * dpr);
                            const physicalX = areaPhysicalX + Math.round(x * dpr * realMouseScaleX) + realMouseOffsetX;
                            const physicalY = areaPhysicalY + Math.round(y * dpr * realMouseScaleY) + realMouseOffsetY;

                            if (captureTestScreenshot) {
                              const clip = {
                                x: areaPhysicalX,
                                y: areaPhysicalY,
                                width: Math.round(recordingArea.width * dpr),
                                height: Math.round(recordingArea.height * dpr),
                              };
                              const virtualCursorX = areaPhysicalX + Math.round(x * dpr);
                              const virtualCursorY = areaPhysicalY + Math.round(y * dpr);
                              const response = await fetch(`${apiBase}/api/desktop/screenshot`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  filename: `test-point-${Date.now()}.png`,
                                  clip,
                                  cursorPosition: { x: virtualCursorX, y: virtualCursorY },
                                }),
                              });
                              if (!response.ok) throw new Error(t('videoEditor.vertex.captureError'));
                              const data = await response.json();
                              if (data.screenshot) {
                                console.log('[Zeus] Test screenshot captured:', data.screenshot);
                              }
                            } else {
                              await fetch(`${apiBase}/api/desktop/action`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ type: 'click', x: physicalX, y: physicalY }),
                              });
                            }
                            toast({ title: t('videoEditor.vertex.testCoord', { x, y }), description: t('videoEditor.vertex.testCoordDesc') });
                            // Muestra el rectángulo rojo usando: coordenadas del campo de texto (4 puntos), o instante editado, o primer instante válido
                            const parseFourPoints = (text: string): Array<{x: number; y: number}> | null => {
                              const matches = [...text.matchAll(/(\d+)\s*,\s*(\d+)/g)];
                              if (matches.length >= 4) {
                                return matches.slice(0, 4).map(m => ({ x: parseInt(m[1], 10), y: parseInt(m[2], 10) }));
                              }
                              return null;
                            };
                            const fourPoints = parseFourPoints(manualPointText);
                            if (fourPoints) {
                              setTestRect({
                                v1: fourPoints[0],
                                v2: fourPoints[1],
                                v3: fourPoints[2],
                                v4: fourPoints[3],
                              });
                            } else if (editingInstantId) {
                              const editingInstant = vertexInstants.find(iv => iv.id === editingInstantId);
                              if (editingInstant && editingInstant.vertices.filter(v => v !== null).length === 4) {
                                setTestRect({
                                  v1: { x: editingInstant.vertices[0]!.x, y: editingInstant.vertices[0]!.y },
                                  v2: { x: editingInstant.vertices[1]!.x, y: editingInstant.vertices[1]!.y },
                                  v3: { x: editingInstant.vertices[2]!.x, y: editingInstant.vertices[2]!.y },
                                  v4: { x: editingInstant.vertices[3]!.x, y: editingInstant.vertices[3]!.y },
                                });
                              }
                            } else {
                              const instantWithVerts = vertexInstants.find(iv => iv.vertices.filter(v => v !== null).length === 4);
                              if (instantWithVerts) {
                                setTestRect({
                                  v1: { x: instantWithVerts.vertices[0]!.x, y: instantWithVerts.vertices[0]!.y },
                                  v2: { x: instantWithVerts.vertices[1]!.x, y: instantWithVerts.vertices[1]!.y },
                                  v3: { x: instantWithVerts.vertices[2]!.x, y: instantWithVerts.vertices[2]!.y },
                                  v4: { x: instantWithVerts.vertices[3]!.x, y: instantWithVerts.vertices[3]!.y },
                                });
                              }
                            }
                            setTimeout(() => setTestRect(null), 5000);
                          } catch (err: any) {
                            toast({ title: t('videoEditor.selection.genericError'), description: err.message, variant: 'destructive' });
                          } finally {
                            setIsCapturingTest(false);
                          }
                        }}
                        disabled={isCapturingTest}
                      >
                        <Camera className={cn("h-4 w-4 mr-2", isCapturingTest && "animate-pulse")} />
                        {isCapturingTest ? '...' : t('videoEditor.vertex.test')}
                      </Button>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
                        checked={captureTestScreenshot}
                        onChange={(e) => setCaptureTestScreenshot(e.target.checked)}
                      />
                      {t('videoEditor.vertex.captureScreenOnTest')}
                    </label>
                  </div>

                  {/* ── Editor de instantes del objeto seleccionado (ajuste fino post-tracking) ── */}
                  <div className="border-t border-gray-700 pt-4 space-y-3">
                    <h5 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                      <KeyRound className="w-3.5 h-3.5" /> {t('videoEditor.vertex.selObjectInstants')}
                    </h5>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      {t('videoEditor.vertex.selObjectInstantsHelp')}
                    </p>

                    <select
                      value={selectedObjectId ?? ''}
                      onChange={(e) => setSelectedObjectId(e.target.value || null)}
                      className="w-full h-9 bg-gray-900 border border-gray-600 rounded-lg px-2 text-xs text-white outline-none focus:ring-1 focus:ring-emerald-400"
                    >
                      <option value="">{t('videoEditor.vertex.selectObject')}</option>
                      {resolvedObjectClips.map((clip) => (
                        <option key={clip.id} value={clip.id}>{clip.name}</option>
                      ))}
                    </select>

                    {selectedObjectId && (() => {
                      const clip = resolvedObjectClips.find((c) => c.id === selectedObjectId);
                      if (!clip) return null;
                      const sortedKfs = [...(clip.keyframes || [])].sort((a, b) => a.time - b.time);
                      const localT = clamp(currentTime - clip.startTime, 0, clip.duration);
                      const nearestKf = sortedKfs.reduce(
                        (best, kf) =>
                          Math.abs(kf.time - localT) < Math.abs(best.time - localT) ? kf : best,
                        sortedKfs[0] ?? null
                      );
                      const editingKfIdLocal = editingKfId ?? null;
                      const editingKf = sortedKfs.find((k) => k.id === editingKfIdLocal) ?? null;

                      return (
                        <div className="space-y-3">
                          {/* Resumen del keyframe más cercano al cursor */}
                          <div className="text-[10px] text-gray-500 font-mono">
                            {t('videoEditor.vertex.cursorInfo', { time: localT.toFixed(2) })}{' '}
                            {nearestKf
                              ? t('videoEditor.vertex.kfInfo', { time: nearestKf.time.toFixed(2), x: Math.round(nearestKf.x), y: Math.round(nearestKf.y), w: Math.round(nearestKf.width) })
                              : t('videoEditor.vertex.noneKf')}
                          </div>

                          {!editingKf && sortedKfs.length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full border-emerald-700 bg-emerald-900/20 hover:bg-emerald-900/40 text-emerald-300"
                              onClick={() => nearestKf && startEditKeyframeLocal(clip, nearestKf)}
                              title={t('videoEditor.vertex.editNearestTitle')}
                            >
                              <Pencil className="w-3.5 h-3.5 mr-1" /> {t('videoEditor.vertex.editKfAt', { time: nearestKf?.time.toFixed(2) })}
                            </Button>
                          )}

                          {sortedKfs.length > 0 && (
                            <div className="max-h-48 overflow-y-auto thin-scrollbar space-y-1">
                              {sortedKfs.map((kf, i) => (
                                <div
                                  key={kf.id}
                                  className={`rounded-md border p-2 text-[10px] ${
                                    editingKf?.id === kf.id
                                      ? 'border-emerald-500 bg-emerald-900/20'
                                      : 'border-gray-700 bg-gray-800/30'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-gray-300">
                                      {t('videoEditor.vertex.kfBadge2', { n: i + 1, time: fmtHMS(clip.startTime + kf.time), frame: Math.floor((clip.startTime + kf.time) * 30) })}
                                    </span>
                                    <div className="flex gap-1">
                                      <button
                                        type="button"
                                        onClick={() => editingKf?.id === kf.id ? cancelEditingLocal() : startEditKeyframeLocal(clip, kf)}
                                        className="p-0.5 rounded border border-white/5 text-gray-400 hover:text-emerald-400"
                                        title={editingKf?.id === kf.id ? t('videoEditor.vertex.cancelEdit') : t('videoEditor.vertex.editThis')}
                                      >
                                        {editingKf?.id === kf.id ? <X className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => deleteKeyframeLocal(clip.id, kf.id)}
                                        className="p-0.5 rounded border border-white/5 text-gray-400 hover:text-red-400"
                                        title={t('videoEditor.text.deleteKfTitle')}
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-1 mt-1">
                                    <span>{t('videoEditor.vertex.xShort', { value: kf.x.toFixed(1) })}</span>
                                    <span>{t('videoEditor.vertex.yShort', { value: kf.y.toFixed(1) })}</span>
                                    <span>{t('videoEditor.vertex.sizeShort', { value: kf.width.toFixed(1) })}</span>
                                    <span>{t('videoEditor.vertex.opShort', { value: kf.opacity.toFixed(0) })}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Editor activo del instante */}
                          {editingKf && (
                            <div className="rounded-md border border-emerald-500/60 bg-emerald-500/5 p-3 space-y-3">
                               <div className="text-[10px] font-bold text-emerald-300 uppercase">
                                  {t('videoEditor.vertex.editingKfAt', { time: (clip.startTime + editingKf.time).toFixed(1), frame: Math.floor((clip.startTime + editingKf.time) * 30) })}
                                </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-[9px] text-gray-500 uppercase">{t('videoEditor.vertex.xPct')}</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={0.1}
                                    value={editingKf.x}
                                    onChange={(e) => updateKeyframeLocal(clip.id, editingKf.id, { x: clamp(Number(e.target.value), 0, 100) })
                                    }
                                    className="bg-gray-950 border-emerald-500/30 text-white h-8 text-xs"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[9px] text-gray-500 uppercase">{t('videoEditor.vertex.yPct')}</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={0.1}
                                    value={editingKf.y}
                                    onChange={(e) => updateKeyframeLocal(clip.id, editingKf.id, { y: clamp(Number(e.target.value), 0, 100) })
                                    }
                                    className="bg-gray-950 border-emerald-500/30 text-white h-8 text-xs"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[9px] text-gray-500 uppercase">{t('videoEditor.vertex.sizePct')}</Label>
                                  <Input
                                    type="number"
                                    min={5}
                                    max={95}
                                    step={0.1}
                                    value={editingKf.width}
                                    onChange={(e) => updateKeyframeLocal(clip.id, editingKf.id, { width: clamp(Number(e.target.value), 5, 95) })
                                    }
                                    className="bg-gray-950 border-emerald-500/30 text-white h-8 text-xs"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[9px] text-gray-500 uppercase">{t('videoEditor.vertex.opacityPct2')}</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={editingKf.opacity}
                                    onChange={(e) => updateKeyframeLocal(clip.id, editingKf.id, { opacity: clamp(Number(e.target.value), 0, 100) })
                                    }
                                    className="bg-gray-950 border-emerald-500/30 text-white h-8 text-xs"
                                  />
                                </div>
                              </div>

                              {editingKf.corners && editingKf.corners.length === 4 && (
                                <div className="space-y-2">
                                  <Label className="text-[9px] text-gray-500 uppercase font-black">{t('videoEditor.vertex.vertsPm50')}</Label>
                                  <div className="grid grid-cols-4 gap-2 text-[9px] text-gray-500 mb-1">
                                    <span>{t('videoEditor.objects.corner1')}</span><span>{t('videoEditor.objects.corner2')}</span><span>{t('videoEditor.objects.corner3')}</span><span>{t('videoEditor.objects.corner4')}</span>
                                  </div>
                                  {editingKf.corners.map((c, j) => (
                                    <div key={j} className="grid grid-cols-4 gap-2">
                                      <Input
                                        type="number"
                                        min={-90}
                                        max={90}
                                        step={0.1}
                                        value={c.x}
                                        onChange={(e) => updateKeyframeCornerLocal(clip.id, editingKf.id, j, 'x', Number(e.target.value))
                                        }
                                        className="bg-gray-950 border-emerald-500/30 text-white h-7 text-xs"
                                      />
                                      <Input
                                        type="number"
                                        min={-90}
                                        max={90}
                                        step={0.1}
                                        value={c.y}
                                        onChange={(e) => updateKeyframeCornerLocal(clip.id, editingKf.id, j, 'y', Number(e.target.value))
                                        }
                                        className="bg-gray-950 border-emerald-500/30 text-white h-7 text-xs"
                                      />
                                    </div>
                                  ))}
                                  <p className="text-[9px] text-gray-500">{t('videoEditor.objects.cornersHelp')}</p>
                                </div>
                              )}

                              <div className="flex items-center gap-2 pt-1">
                                <Button size="sm" variant="ghost" onClick={cancelEditingLocal} className="text-gray-300">
                                  <X className="w-3.5 h-3.5 mr-1" /> {t('videoEditor.text.cancel')}
                                </Button>
                                <Button size="sm" onClick={finishEditingLocal} className="bg-emerald-600 hover:bg-emerald-500">
                                  <Save className="w-3.5 h-3.5 mr-1" /> {t('videoEditor.text.save')}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="overlay-video" className="mt-14 space-y-4">
                <input
                  ref={overlayFileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleAddVideoOverlay(f);
                    e.target.value = '';
                  }}
                />
                {!editState.videoOverlay ? (
                  <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50 space-y-3">
                    <div className="flex items-center gap-2 text-emerald-400/90 text-sm font-medium">
                      <Film className="w-4 h-4" />
                      {t('videoEditor.overlay.title')}
                    </div>
                    <p className="text-xs text-gray-400">
                      {t('videoEditor.overlay.desc')}
                    </p>
                    <Button
                      onClick={() => overlayFileInputRef.current?.click()}
                      className="w-full border-emerald-500/50 border !bg-gray-800/80 !text-emerald-300 hover:!bg-gray-700 hover:!text-emerald-200 transition-all"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {t('videoEditor.overlay.load')}
                    </Button>
                  </div>
                ) : (
                  <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-emerald-400/90 text-sm font-medium truncate">
                        <Film className="w-4 h-4 shrink-0" />
                        <span className="truncate">{t('videoEditor.overlay.title')}</span>
                      </div>
                      <Button
                        onClick={handleRemoveVideoOverlay}
                        variant="ghost"
                        className="h-7 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        {t('videoEditor.paint.remove')}
                      </Button>
                    </div>

                    {/* Transporte: play/pause + barra de seek */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={toggleOverlayPlay}
                          className="h-8 w-8 p-0 border-emerald-500/50 border !bg-gray-800/80 !text-emerald-300 hover:!bg-gray-700"
                          title={overlayPlaying ? t('videoEditor.overlay.pause') : t('videoEditor.overlay.play')}
                        >
                          {overlayPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </Button>
                        <span className="text-[11px] text-gray-300 tabular-nums">
                          {formatTime(overlayCurrentTime)} / {formatTime(editState.videoOverlay.sourceDuration)}
                        </span>
                      </div>
                      <Slider
                        min={0}
                        max={Math.max(0.01, editState.videoOverlay.sourceDuration)}
                        step={0.01}
                        value={[Math.min(overlayCurrentTime, editState.videoOverlay.sourceDuration)]}
                        onValueChange={([v]) => handleOverlaySeek(v)}
                        onPointerDown={() => { overlaySeekDraggingRef.current = true; if (overlayVideoRef.current) overlayVideoRef.current.pause(); }}
                        onPointerUp={() => { overlaySeekDraggingRef.current = false; }}
                        className="w-full"
                      />
                    </div>

                    {/* Opacidad */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-300">{t('videoEditor.overlay.opacity')}</span>
                        <span className="text-emerald-400/90 tabular-nums">{editState.videoOverlay.opacity}%</span>
                      </div>
                      <Slider
                        value={[editState.videoOverlay.opacity]}
                        min={0}
                        max={100}
                        step={1}
                        onValueChange={([v]) => handleUpdateVideoOverlay({ opacity: v })}
                      />
                    </div>

                    {/* Zoom */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-300">{t('videoEditor.overlay.zoom')}</span>
                        <span className="text-emerald-400/90 tabular-nums">{editState.videoOverlay.zoom.toFixed(2)}x</span>
                      </div>
                      <Slider
                        value={[Math.round(editState.videoOverlay.zoom * 100)]}
                        min={100}
                        max={400}
                        step={5}
                        onValueChange={([v]) => handleUpdateVideoOverlay({ zoom: v / 100 })}
                      />
                    </div>

                    <Button
                      onClick={() => overlayFileInputRef.current?.click()}
                      variant="ghost"
                      className="w-full h-8 text-xs text-gray-300 hover:bg-gray-700/50"
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                      {t('videoEditor.overlay.change')}
                    </Button>
                    <p className="text-[11px] text-gray-500 leading-relaxed">
                      {t('videoEditor.overlay.exportNote')}
                    </p>
                  </div>
                )}

                {/* Texto a audio (movido desde la pestaña Efectos) */}
                <div className="pt-4 border-t border-emerald-500/30">
                  <label className="text-sm font-medium text-emerald-400 mb-2 block">{t('videoEditor.overlay.ttsTitle')}</label>
                  <p className="text-xs text-gray-400 mb-2">
                    {t('videoEditor.overlay.ttsDesc')}
                  </p>
                  <textarea
                    value={ttsText}
                    onChange={(e) => setTtsText(e.target.value)}
                    placeholder={t('videoEditor.overlay.ttsPlaceholder')}
                    className="w-full min-h-[80px] bg-gray-800/80 border border-emerald-500/30 rounded-lg px-3 py-2 text-white text-sm placeholder:text-gray-500 outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
                    disabled={ttsLoading}
                    maxLength={4096}
                  />
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="text-xs text-emerald-400/90 mb-1 block">{t('videoEditor.overlay.ttsGender')}</label>
                      <Select value={ttsGender} onValueChange={(v) => {
                        setTtsGender(v);
                        const voicesByGender = TTS_VOICES.filter(vo => v === 'neutro' || vo.gender === v);
                        if (!voicesByGender.some(vo => vo.id === ttsVoice)) {
                          setTtsVoice(voicesByGender[0]?.id ?? 'es-ES-AlvaroNeural');
                        }
                      }} disabled={ttsLoading}>
                        <SelectTrigger className="h-8 text-xs bg-gray-800/80 border-emerald-500/30 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[
                            { id: 'neutro', label: t('videoEditor.overlay.ttsNeutral') },
                            { id: 'masculino', label: t('videoEditor.overlay.ttsMale') },
                            { id: 'femenino', label: t('videoEditor.overlay.ttsFemale') },
                          ].map((o) => (
                            <SelectItem key={o.id} value={o.id} className="text-xs text-white">
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs text-emerald-400/90 mb-1 block">{t('videoEditor.overlay.ttsVoice')}</label>
                      <Select value={ttsVoice} onValueChange={setTtsVoice} disabled={ttsLoading}>
                        <SelectTrigger className="h-8 text-xs bg-gray-800/80 border-emerald-500/30 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TTS_VOICES.filter(v => ttsGender === 'neutro' || v.gender === ttsGender).map((v) => (
                            <SelectItem key={v.id} value={v.id} className="text-xs text-white">
                              {v.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs text-emerald-400/90 mb-1 block">{t('videoEditor.overlay.ttsRate')}</label>
                      <Select value={ttsRate} onValueChange={setTtsRate} disabled={ttsLoading}>
                        <SelectTrigger className="h-8 text-xs bg-gray-800/80 border-emerald-500/30 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['-50%', '-25%', '0%', '+25%', '+50%', '+75%', '+100%'].map((r) => (
                            <SelectItem key={r} value={r} className="text-xs text-white">
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs text-emerald-400/90 mb-1 block">{t('videoEditor.overlay.ttsPitch')}</label>
                      <Select value={ttsPitch} onValueChange={setTtsPitch} disabled={ttsLoading}>
                        <SelectTrigger className="h-8 text-xs bg-gray-800/80 border-emerald-500/30 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['-20Hz', '-10Hz', '0Hz', '+10Hz', '+20Hz'].map((p) => (
                            <SelectItem key={p} value={p} className="text-xs text-white">
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs text-emerald-400/90 mb-1 block">{t('videoEditor.overlay.ttsVolume')}</label>
                      <Select value={ttsVolume} onValueChange={setTtsVolume} disabled={ttsLoading}>
                        <SelectTrigger className="h-8 text-xs bg-gray-800/80 border-emerald-500/30 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['-20%', '-10%', '0%', '+10%', '+20%'].map((v) => (
                            <SelectItem key={v} value={v} className="text-xs text-white">
                              {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Button
                      onClick={handleTextToSpeechPreview}
                      disabled={ttsLoading || !ttsText.trim()}
                      className="text-xs border-emerald-500/50 border !bg-gray-800/80 !text-emerald-300 hover:!bg-gray-700 hover:!text-emerald-200 transition-all shadow-md"
                    >
                      {ttsLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-1.5" />
                          {t('videoEditor.overlay.preview')}
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={handleTextToSpeech}
                      disabled={ttsLoading || !ttsText.trim() || !editState.timeline}
                      className="text-xs border-emerald-500/80 border !bg-gray-800 !text-emerald-300 hover:!bg-gray-700 hover:!text-emerald-200 transition-all shadow-md"
                    >
                      {ttsLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                          {t('videoEditor.overlay.generating')}
                        </>
                      ) : (
                        <>
                          <Music className="w-4 h-4 mr-1.5" />
                          {t('videoEditor.overlay.generateAdd')}
                        </>
                      )}
                    </Button>
                  </div>
                  {ttsError && (
                    <p className="text-xs text-red-400 mt-2">{ttsError}</p>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="transition" className="space-y-6 mt-16">
                <p className="text-sm text-gray-400">
                  {t('videoEditor.transition.desc')}
                </p>
                <div className="text-sm font-medium text-emerald-400/90 bg-emerald-950/30 border border-emerald-500/30 rounded-lg p-3">
                  <strong>{t('videoEditor.transition.needTitle')}</strong> {t('videoEditor.transition.need1')} <em>{t('videoEditor.transition.need2')}</em> {t('videoEditor.transition.need3')} <strong>{t('videoEditor.transition.need4')}</strong> {t('videoEditor.transition.need5')} <strong>{t('videoEditor.transition.need6')}</strong> {t('videoEditor.transition.need7')}
                </div>
                {(() => {
                  const videoTrack = editState.timeline?.tracks.find(t => t.type === 'video');
                  const videoClips = (videoTrack?.clips || [])
                    .filter(isPlayableVideoClip)
                    .sort((a, b) => a.startTime - b.startTime);
                  if (videoClips.length < 2) {

                  }
                  const transitionOptions: { value: TransitionType; label: string }[] = [
                    { value: 'none', label: t('videoEditor.transition.typeNone') },
                    { value: 'fade', label: t('videoEditor.transition.typeFade') },
                    { value: 'dissolve', label: t('videoEditor.transition.typeDissolve') },
                    { value: 'slide-left', label: t('videoEditor.transition.typeSlideLeft') },
                    { value: 'slide-right', label: t('videoEditor.transition.typeSlideRight') },
                    { value: 'slide-up', label: t('videoEditor.transition.typeSlideUp') },
                    { value: 'slide-down', label: t('videoEditor.transition.typeSlideDown') },
                    { value: 'zoom-in', label: t('videoEditor.transition.typeZoomIn') },
                    { value: 'zoom-out', label: t('videoEditor.transition.typeZoomOut') },
                    { value: 'blur', label: t('videoEditor.transition.typeBlur') },
                  ];
                  return (
                    <div className="space-y-6">
                      {videoClips.slice(0, -1).map((clipA, index) => {
                        const clipB = videoClips[index + 1];
                        const transitionOut = clipA.transitionOut ?? { type: 'none' as TransitionType, duration: 0.5 };
                        const labelA = clipA.id.includes('main-video') ? t('videoEditor.transition.mainVideo') : t('videoEditor.transition.clipN', { n: index + 1 });
                        const labelB = clipB.id.includes('main-video') ? t('videoEditor.transition.mainVideo') : t('videoEditor.transition.clipN', { n: index + 2 });
                        return (
                          <div key={clipA.id} className="bg-gray-800 rounded-lg p-4 border border-gray-700 space-y-4">
                            <h3 className="text-sm font-medium text-emerald-400 flex items-center gap-2">
                              <ArrowRightLeft className="w-4 h-4" />
                              {labelA} → {labelB}
                            </h3>
                            <div>
                              <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.transition.typeLabel')}</label>
                              <select
                                value={transitionOut.type}
                                onChange={(e) => handleUpdateClip(clipA.id, {
                                  transitionOut: { type: e.target.value as TransitionType, duration: transitionOut.duration }
                                })}
                                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                              >
                                {transitionOptions.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                            {transitionOut.type !== 'none' && (
                              <div>
                                <label className="text-xs text-gray-400 block mb-1">
                                  {t('videoEditor.transition.durationLabel', { duration: transitionOut.duration.toFixed(1) })}
                                </label>
                                <Slider
                                  value={[transitionOut.duration]}
                                  min={0.2}
                                  max={2}
                                  step={0.1}
                                  onValueChange={([v]) => handleUpdateClip(clipA.id, {
                                    transitionOut: { type: transitionOut.type, duration: v }
                                  })}
                                  className="w-full"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </TabsContent>

              {/* Recortar pantalla / zona de exportación */}
              <TabsContent value="cropscreen" className="space-y-6 mt-16">
                <p className="text-sm text-gray-400">
                  {t('videoEditor.crop.desc1')} <strong>{t('videoEditor.crop.descExport')}</strong>{t('videoEditor.crop.desc2')}
                </p>

                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 space-y-4">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.crop.aspectLabel')}</label>
                    <select
                      value={editState.crop?.aspect ?? 'libre'}
                      onChange={(e) => {
                        const v = e.target.value;
                        applyCropPreset(v === 'libre' ? null : v);
                      }}
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                    >
                      <option value="libre">{t('videoEditor.crop.free')}</option>
                      {(() => {
                        const suffix = getCropPresetLabels(t);
                        return CROP_PRESETS.map(p => (
                          <option key={p.aspect} value={p.aspect}>{suffix[p.aspect] ? `${p.aspect} · ${suffix[p.aspect]}` : p.label}</option>
                        ));
                      })()}
                    </select>
                  </div>

                  <div className="flex items-center justify-between bg-gray-900/60 rounded-lg px-3 py-2 border border-gray-700">
                    <span className="text-sm text-gray-200">{t('videoEditor.crop.cropOnExport')}</span>
                    <Switch
                      checked={!!editState.crop?.enabled}
                      onCheckedChange={toggleCropEnabled}
                    />
                  </div>

                  {editState.crop?.enabled && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.vertex.xPct')}</label>
                          <input
                            type="number" min={0} max={100} step={1}
                            value={Math.round(editState.crop.x)}
                            onChange={(e) => updateCrop({ x: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.vertex.yPct')}</label>
                          <input
                            type="number" min={0} max={100} step={1}
                            value={Math.round(editState.crop.y)}
                            onChange={(e) => updateCrop({ y: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.objects.widthField')}</label>
                          <input
                            type="number" min={5} max={100} step={1}
                            value={Math.round(editState.crop.width)}
                            onChange={(e) => updateCrop({ width: Math.max(5, Math.min(100, Number(e.target.value) || 5)) })}
                            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.objects.heightField')}</label>
                          <input
                            type="number" min={5} max={100} step={1}
                            value={Math.round(editState.crop.height)}
                            onChange={(e) => updateCrop({ height: Math.max(5, Math.min(100, Number(e.target.value) || 5)) })}
                            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">
                        {t('videoEditor.crop.dragHint')}
                      </p>
                      <Button variant="ghost" onClick={resetCrop} className="w-full border border-gray-600 text-gray-300 hover:bg-white/5">
                        <RefreshCw className="w-4 h-4 mr-2" /> {t('videoEditor.crop.resetFull')}
                      </Button>
                    </>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Panel central - Reproductor de video */}
        <div className="flex-1 bg-black flex flex-col">
          <div className="py-1 px-4 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-white font-bold text-[11px] uppercase tracking-wider opacity-80">Reproductor Principal</h2>

            {/* Controles de Zoom del Reproductor */}
            <div className="flex items-center space-x-3 bg-gray-900/90 p-1 px-3 rounded-lg border border-white/20 shadow-xl">
              <Button size="sm" variant="ghost" onClick={() => handlePlayerZoom(-10)} className="h-10 w-10 p-0 text-gray-300 hover:text-white hover:bg-white/10 rounded-md" title="Reducir vista">
                <ZoomOut className="w-7 h-7" />
              </Button>
              <button
                onClick={resetPlayerZoom}
                className="text-[16px] font-black text-emerald-400 hover:text-emerald-300 min-w-[50px] transition-colors"
                title="Restablecer vista (100%)"
              >
                {playerZoom}%
              </button>
              <Button size="sm" variant="ghost" onClick={() => handlePlayerZoom(10)} className="h-10 w-10 p-0 text-gray-300 hover:text-white hover:bg-white/10 rounded-md" title="Ampliar vista">
                <ZoomIn className="w-7 h-7" />
              </Button>
              <div className="w-px h-8 bg-gray-700 mx-2" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPlayerZoom(100);
                  if (playerContainerRef.current?.parentElement) {
                    playerContainerRef.current.parentElement.scrollLeft = 0;
                    playerContainerRef.current.parentElement.scrollTop = 0;
                  }
                }}
                className="h-10 w-10 p-0 text-gray-300 hover:text-white hover:bg-white/10 rounded-md"
                title="Ajustar a pantalla"
              >
                <Maximize className="w-7 h-7" />
              </Button>

              <div className="w-px h-8 bg-gray-700 mx-2" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsHandMode(!isHandMode)}
                className={cn("h-10 w-10 p-0 rounded-md transition-colors", isHandMode ? "bg-emerald-600 text-white" : "text-gray-300 hover:text-white hover:bg-white/10")}
                title="Modo Mano (Arrastrar vista)"
              >
                <Hand className="w-7 h-7" />
              </Button>
            </div>
          </div>

          <div className="flex-1 p-4 overflow-auto bg-black/20 no-scrollbar"
            ref={playerScrollContainerRef}
            style={{
              cursor: isHandMode ? (isDraggingPlayer ? 'grabbing' : 'grab') : 'default',
              msOverflowStyle: 'none',
              scrollbarWidth: 'none'
            }}
            onMouseDown={(e) => {
              if (isHandMode) setIsDraggingPlayer(true);
            }}
            onMouseMove={(e) => {
              if (isDraggingPlayer) {
                const container = e.currentTarget;
                container.scrollLeft -= e.movementX;
                container.scrollTop -= e.movementY;
              }
            }}
            onMouseUp={() => setIsDraggingPlayer(false)}
            onMouseLeave={() => setIsDraggingPlayer(false)}
          >
            <div
              ref={playerContainerRef}
              className="relative transition-transform duration-200 ease-out flex-shrink-0"
              style={{
                transform: `scale(${playerZoom / 100})`,
                transformOrigin: 'center center',
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: playerZoom > 100 ? `${(playerZoom - 100) / 2}%` : 'auto'
              }}
            >

              <div
                ref={previewStageRef}
                className="relative flex items-center justify-center"
                style={videoAspectRatio ? {
                  aspectRatio: videoAspectRatio,
                  maxWidth: '100%',
                  maxHeight: '600px',
                  width: 'auto',
                  height: 'auto'
                } : { width: '100%', height: '100%' }}
              >
                {videoHasError || (!getCurrentVideoSource() && !activeCaptureStream) ? (
                  <div className="relative w-full aspect-video bg-gray-900 border-2 border-dashed border-gray-800 rounded-lg overflow-hidden p-8 group hover:border-emerald-500/50 transition-colors">
                    {/* Vídeo Grande de Bienvenida — ocupa el espacio interior (con margen) */}
                    <div className="relative w-full h-full overflow-hidden rounded-lg">
                      <video
                        src="/VIDEO.mp4"
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity duration-700"
                      />
                    </div>

                    {/* Botón Encima */}
                    <div className="absolute inset-x-0 bottom-8 flex justify-center">
                      <Button
                        onClick={() => openLocalFolderResources('video')}
                        className="group relative px-8 h-10 bg-transparent overflow-hidden rounded-xl transition-all shadow-[0_8px_25px_rgba(59,130,246,0.4)] hover:scale-105"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-blue-400 opacity-90 group-hover:opacity-100 transition-opacity" />
                        <div className="absolute inset-0 shadow-[inset_0_0_12px_rgba(255,255,255,0.4)]" />
                        <div className="relative flex items-center gap-2.5 text-white font-black uppercase text-[10px] tracking-[0.2em]">
                          <FolderOpen className="w-4 h-4" />
                          {t('videoEditor.app.selectLocalVideo')}
                        </div>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="relative w-full h-full">
                     <video
                       ref={videoRef}
                       muted={isTimelinePlaying ? (useSimplePlayer ? false : true) : isScreenshotPreviewMuted}
                       preload="auto"
                       controls={isTimelinePlaying && useSimplePlayer}
                       loop={isLoopEnabled && useSimplePlayer}
                       className={isTimelinePlaying && useSimplePlayer && !mainVideoClipHidden ? "w-full h-full object-contain rounded-lg shadow-2xl" : "hidden"}
                       onLoadedMetadata={(e) => {
                        setVideoHasError(false);
                        const v = e.currentTarget;
                        const duration = v.duration;

                        if (v.videoWidth && v.videoHeight) {
                          setVideoAspectRatio(v.videoWidth / v.videoHeight);
                          setVideoNativeSize({ width: v.videoWidth, height: v.videoHeight });
                          // Tamaño del canvas de preview =.aspecto del vídeo principal,
                          // cap a 1280 en el lado mayor (render más ligero; el CSS lo escala).
                          const maxSide = 1280;
                          const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
                          const w = Math.max(2, Math.round((v.videoWidth * scale) / 2) * 2);
                          const h = Math.max(2, Math.round((v.videoHeight * scale) / 2) * 2);
                          setPreviewVideoSize({ width: w, height: h });
                        }

                        // Si hay un clip con duración 0 (recién cargado desde URL), le asignamos la duración real
                        if (duration > 0 && editState.timeline) {
                          setEditState(prev => {
                            if (!prev.timeline) return prev;
                            let changed = false;
                            const newTracks = prev.timeline.tracks.map(track => {
                              const newClips = track.clips.map(clip => {
                                if (clip.duration === 0) {
                                  changed = true;
                                  return {
                                    ...clip,
                                    duration: duration,
                                    sourceDuration: duration
                                  };
                                }
                                return clip;
                              });
                              return { ...track, clips: newClips };
                            });

                            if (!changed) return prev;
                            return {
                              ...prev,
                              timeline: {
                                ...prev.timeline!,
                                duration: Math.max(prev.timeline!.duration, duration),
                                tracks: newTracks
                              }
                            };
                          });
                        }
                      }}
                    />
                    {/* Canvas visible del scene graph (vídeo+transiciones+filtro global+
                        máscara de selección). Los objetos/texto/imagen los pintan los
                        overlays DOM de debajo (handlers de edición). Ocupa el sitio del
                        <video> anterior (en flujo) para que el contenedor aspect-ratio
                        conserve su tamaño; el <video> real queda hidden. */}
                    <canvas
                      ref={previewCanvasRef}
                       className={`w-full h-full object-contain bg-black rounded-lg shadow-2xl ${isTimelinePlaying && useSimplePlayer ? 'hidden' : ''}`}
                      style={{ maxHeight: '600px' }}
                    />
                    {/* Imagen overlay - llena todo el espacio */}
                    {activeImageClips.length > 0 && (
                      <div className="absolute inset-0 w-full h-full flex items-center justify-center z-5 pointer-events-none">
                        <img
                          ref={imageOverlayRef}
                          src={activeImageClips[activeImageClips.length - 1].mediaFileId}
                          alt="Image Overlay"
                          className="w-full h-full object-cover rounded-lg shadow-2xl"
                          style={{ transform: activeImageClips[activeImageClips.length - 1].mirrored ? 'scaleX(-1)' : undefined }}
                          crossOrigin={activeImageClips[activeImageClips.length - 1].mediaFileId?.startsWith('http') ? 'anonymous' : undefined}
                        />
                      </div>
                    )}
                    {/* Vídeo superpuesto a pantalla completa (opacidad + zoom).
                        Transporte (play/pause + seek) se controla desde la pestaña
                        "Vídeo". El export lo pinta el OverlayVideoNode del scene graph. */}
                    {editState.videoOverlay && (
                      <div
                        className="absolute inset-0 overflow-hidden pointer-events-none z-[12]"
                        style={{ opacity: (editState.videoOverlay.opacity ?? 100) / 100 }}
                      >
                        <video
                          ref={overlayVideoRef}
                          src={resolveUrl(editState.videoOverlay.src)}
                          muted
                          loop
                          playsInline
                          crossOrigin={editState.videoOverlay.src.startsWith('http') ? 'anonymous' : undefined}
                          className="w-full h-full object-contain"
                          style={{
                            transform: `scale(${editState.videoOverlay.zoom ?? 1})`,
                            transformOrigin: 'center',
                          }}
                          onTimeUpdate={(e) => {
                            if (overlaySeekDraggingRef.current) return;
                            setOverlayCurrentTime(e.currentTarget.currentTime);
                          }}
                          onPlay={() => setOverlayPlaying(true)}
                          onPause={() => setOverlayPlaying(false)}
                        />
                      </div>
                    )}
                  </div>
                )}
                {editState.timeline && (
                  <EffectsOverlay
                    timeline={editState.timeline}
                    currentTime={editState.timeline.currentTime ?? 0}
                  />
                )}
                <ObjectOverlay
                  objectClips={visibleDeformableObjectClips}
                  currentTime={editState.timeline?.currentTime || 0}
                  selectedObjectId={selectedObjectId}
                  onSelectObject={setSelectedObjectId}
                  onUpdateObjectClip={handleUpdateObjectClip}
                  playerZoom={playerZoom}
                  isPlaying={isTimelinePlaying}
                />
                <ObjectOverlay2
                  objectClips={visibleNormalObjectClips}
                  currentTime={editState.timeline?.currentTime || 0}
                  selectedObjectId={selectedObjectId}
                  onSelectObject={setSelectedObjectId}
                  onUpdateObjectClip={handleUpdateObjectClip}
                  isPlaying={isTimelinePlaying}
                />
                <TextOverlay
                  textClips={editState.textClips || []}
                  currentTime={editState.timeline?.currentTime || 0}
                  onUpdateTextClip={handleUpdateTextClip}
                />
                {editState.crop?.enabled && (
                  <CropOverlay
                    crop={editState.crop}
                    videoAspectRatio={videoAspectRatio}
                    onChange={(next) => setEditState(prev => ({ ...prev, crop: next }))}
                  />
                )}
                {editState.selection?.enabled && (
                  <SelectionOverlay
                    selection={editState.selection}
                    videoAspectRatio={videoAspectRatio}
                    currentTime={currentTime}
                    onChange={(next) => setEditState(prev => ({ ...prev, selection: next }))}
                    maskEditMode={maskEditMode}
                    maskBrushSize={maskBrushSize}
                    maskEditVersion={maskEditVersion}
                    onMaskEditCommit={onMaskEditCommit}
                    playerZoom={playerZoom}
                    onWandPick={handleWandPick}
                    onMaskWandPick={handleMaskWandPick}
                    onLazoApply={handleLazoApply}
                    maskMergeMode={sam2Merge}
                  />
                )}
                {editState.paint?.enabled && (
                  <PaintOverlay
                    paint={editState.paint}
                    tool={paintTool}
                    videoNativeSize={videoNativeSize ?? previewVideoSize}
                    previewVideoSize={previewVideoSize}
                    previewCanvasRef={previewCanvasRef}
                    currentTime={currentTime}
                    previewOriginal={previewOriginal}
                    selection={editState.selection}
                    onChange={(next) => setEditState(prev => ({ ...prev, paint: next }))}
                    onCommit={snapshotHistory}
                  />
                )}
                {isCapturingVertex && vertexAlignClip && (() => {
                  const ct = editState.timeline?.currentTime || 0;
                  const vals = getObjectValuesAtTime(vertexAlignClip, ct);
                  const op = getObjectOpacityAtTime(vertexAlignClip, ct);
                  return (
                    <div className="absolute inset-0 z-[48] pointer-events-none overflow-hidden">
                      {vertexAlignClip.mediaType === 'video' ? (
                        <video
                          src={vertexAlignClip.src}
                          muted
                          loop
                          autoPlay
                          playsInline
                          preload="auto"
                          draggable={false}
                          className="absolute max-w-none select-none"
                          style={{
                            left: `${vals.x}%`,
                            top: `${vals.y}%`,
                            width: `${vals.width}%`,
                            height: vals.height !== undefined ? `${vals.height}%` : 'auto',
                            transform: 'translate(-50%, -50%)',
                            opacity: op,
                            objectFit: 'contain',
                            outline: '1px dashed rgba(59,130,246,0.5)',
                          }}
                        />
                      ) : (
                        <img
                          src={vertexAlignClip.src}
                          alt={vertexAlignClip.name || 'Objeto'}
                          draggable={false}
                          className="absolute max-w-none select-none"
                          style={{
                            left: `${vals.x}%`,
                            top: `${vals.y}%`,
                            width: `${vals.width}%`,
                            height: vals.height !== undefined ? `${vals.height}%` : 'auto',
                            transform: 'translate(-50%, -50%)',
                            opacity: op,
                            objectFit: 'contain',
                            outline: '1px dashed rgba(59,130,246,0.5)',
                          }}
                        />
                      )}
                      <div className="absolute top-1 left-1/2 -translate-x-1/2 bg-blue-600/90 text-white text-[10px] px-3 py-1 rounded-full font-semibold pointer-events-none whitespace-nowrap">
                        Alineando vértices a: {vertexAlignClip.name || 'objeto'}
                      </div>
                    </div>
                  );
                })()}
                {isCapturingVertex && (
                   <div
                     className="absolute z-50 cursor-crosshair bg-red-500/5 border-2 border-dashed border-red-500 animate-pulse"
                     style={{
                       left: vertexCaptureArea.x,
                       top: vertexCaptureArea.y,
                       width: vertexCaptureArea.width,
                       height: vertexCaptureArea.height,
                     }}
                     onClick={(e) => {
                       const rect = e.currentTarget.getBoundingClientRect();
                       const relX = e.clientX - rect.left;
                       const relY = e.clientY - rect.top;
                       const raScaleX = vertexCaptureArea.width / rect.width;
                       const raScaleY = vertexCaptureArea.height / rect.height;
                       let vX = Math.round(relX * raScaleX);
                       let vY = Math.round(relY * raScaleY);
                      const capturedCount = verticesCaptured.filter(v => v !== null).length;
                      const index = capturedCount;
                      setVerticesCaptured(prev => {
                         const next = [...prev];
                         next[index] = { x: vX, y: vY };
                         if (next.filter(v => v !== null).length === 4) {
                           // No reordenar: respetar el orden en que el usuario marcó
                           // los vértices (V1=sup-izq, V2=sup-der, V3=inf-der, V4=inf-izq).
                           // sortVerticesClockwise se ofrecerá como botón manual si
                           // el usuario los marcó en posiciones cruzadas.
                         }
                         return next;
                       });
                      toast({
                        title: `Vértice ${index + 1} capturado`,
                        description: `Coordenadas: (${vX}, ${vY})`,
                      });
                      if (capturedCount + 1 >= 4) {
                        setIsCapturingVertex(false);
                        toast({ title: '¡4 vértices capturados!', description: 'Puedes guardar los vértices o continuar editando.' });
                      }
                    }}
                  >
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] px-3 py-1 rounded-full font-bold pointer-events-none">
                      Haz clic para seleccionar el vértice {verticesCaptured.filter(v => v !== null).length + 1}
                    </div>
                  </div>
                )}
                {testRect && (
                   <div
                     className="absolute z-[51] pointer-events-none"
                     style={{
                       left: vertexCaptureArea.x,
                       top: vertexCaptureArea.y,
                       width: vertexCaptureArea.width,
                       height: vertexCaptureArea.height,
                     }}
                   >
                    <svg
                      className="w-full h-full"
                      style={{ position: 'absolute', inset: 0 }}
                      viewBox={`0 0 ${vertexCaptureArea.width} ${vertexCaptureArea.height}`}
                      preserveAspectRatio="none"
                    >
                      <polygon
                        points={`${testRect.v1.x},${testRect.v1.y} ${testRect.v2.x},${testRect.v2.y} ${testRect.v3.x},${testRect.v3.y} ${testRect.v4.x},${testRect.v4.y}`}
                        fill="none"
                        stroke="red"
                        strokeWidth="2"
                        strokeDasharray="5,5"
                      />
                      <circle cx={testRect.v1.x} cy={testRect.v1.y} r="5" fill="red" fillOpacity="0.7" />
                      <circle cx={testRect.v2.x} cy={testRect.v2.y} r="5" fill="red" fillOpacity="0.7" />
                      <circle cx={testRect.v3.x} cy={testRect.v3.y} r="5" fill="red" fillOpacity="0.7" />
                      <circle cx={testRect.v4.x} cy={testRect.v4.y} r="5" fill="red" fillOpacity="0.7" />
                    </svg>
                   </div>
                 )}
                 {/* Overlay de edición de vértices del instante activo (Punto de vértice) */}
                 {(() => {
                   const editingInstant = vertexInstants.find(iv => iv.id === editingInstantId);
                   if (!editingInstant || editingInstant.vertices.filter(v => v !== null).length !== 4) return null;
                   const verts = editingInstant.vertices as Array<{ x: number; y: number }>;
                   const displayVerts = draggedVertex !== null
                     ? verts.map((v, i) => i === draggedVertex.index ? { x: draggedVertex.x, y: draggedVertex.y } : v)
                     : verts;
                   return (
                      <div
                        className="absolute z-[51] pointer-events-auto"
                        style={{
                         left: vertexCaptureArea.x,
                         top: vertexCaptureArea.y,
                         width: vertexCaptureArea.width,
                         height: vertexCaptureArea.height,
                       }}
                     >
                       <svg
                         className="w-full h-full"
                         style={{ position: 'absolute', inset: 0 }}
                         viewBox={`0 0 ${vertexCaptureArea.width} ${vertexCaptureArea.height}`}
                         preserveAspectRatio="none"
                       >
                         <polygon
                           points={`${displayVerts[0].x},${displayVerts[0].y} ${displayVerts[1].x},${displayVerts[1].y} ${displayVerts[2].x},${displayVerts[2].y} ${displayVerts[3].x},${displayVerts[3].y}`}
                           fill="none"
                           stroke="rgba(139, 92, 247, 0.8)"
                           strokeWidth="2"
                           strokeDasharray="4,3"
                         />
                         {displayVerts.map((v, i) => (
                           <circle
                             key={i}
                             cx={v.x}
                             cy={v.y}
                             r="8"
                             fill={draggedVertex?.index === i ? "rgba(139, 92, 247, 1)" : "rgba(139, 92, 247, 0.9)"}
                             stroke="white"
                             strokeWidth="1.5"
                             style={{ touchAction: 'none' }}
                             onMouseDown={(e) => {
                               e.preventDefault();
                               e.stopPropagation();
                                const svgEl = e.currentTarget.ownerSVGElement;
                                if (!svgEl) return;
                                const overlayRect = svgEl.parentElement!.getBoundingClientRect();
                                const scaleX = vertexCaptureArea.width / overlayRect.width;
                               const scaleY = vertexCaptureArea.height / overlayRect.height;
                               const relX = (e.clientX - overlayRect.left) * scaleX;
                               const relY = (e.clientY - overlayRect.top) * scaleY;
                               setDraggedVertex({ index: i, x: relX, y: relY });
                               const onMouseMove = (ev: MouseEvent) => {
                                 const nx = (ev.clientX - overlayRect.left) * scaleX;
                                 const ny = (ev.clientY - overlayRect.top) * scaleY;
                                 setDraggedVertex(prev => prev ? { index: prev.index, x: nx, y: ny } : null);
                               };
                                const onMouseUp = () => {
                                  setDraggedVertex(prev => {
                                    if (!prev) return null;
                                    const editingInstantNow = vertexInstants.find(iv => iv.id === editingInstantId);
                                    if (!editingInstantNow) return null;
                                    const vx = editingInstantNow.vertices.map(v => v ? { x: v.x, y: v.y } : null) as Array<{ x: number; y: number } | null>;
                                    vx[prev.index] = { x: prev.x, y: prev.y };
                                    setVertexInstants(ip => {
                                      const updated = ip.map(iv => iv.id === editingInstantId ? { ...iv, vertices: vx } : iv);
                                      if (typeof window !== 'undefined') localStorage.setItem('zeus-vertex-instants', JSON.stringify(updated));
                                      return updated;
                                    });
                                    return null;
                                  });
                                 document.removeEventListener('mousemove', onMouseMove);
                                 document.removeEventListener('mouseup', onMouseUp);
                               };
                               document.addEventListener('mousemove', onMouseMove);
                               document.addEventListener('mouseup', onMouseUp);
                      }}
                    />
                      ))}
                      </svg>
                    </div>
                  )
                })()}

                    {/* Overlay de dibujo de la región de tracking (pestaña Objetos) */}
                 {isDrawingTrackingRegion && (
                  <div
                    className="absolute inset-0 z-[52] cursor-crosshair"
                    style={{ background: 'rgba(6,182,212,0.04)' }}
                    onPointerMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const cx = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
                      const cy = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
                      setTrackingCursor({ x: cx, y: cy });

                      if (trackingMode === 'rect' && trackingDraft) {
                        const x = Math.min(trackingDraft.startX, cx);
                        const y = Math.min(trackingDraft.startY, cy);
                        const width = Math.min(100, Math.abs(cx - trackingDraft.startX));
                        const height = Math.min(100, Math.abs(cy - trackingDraft.startY));
                        setTrackingRegion({ x, y, width, height });
                      }
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const xPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
                      const yPct = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

                      if (trackingMode === 'lazo') {
                        if (trackingLazoPoints.length >= 3) {
                          const p0 = trackingLazoPoints[0];
                          const dist = Math.hypot(xPct - p0.x, yPct - p0.y);
                          if (dist < 3.5) {
                            finishTrackingLazo(trackingLazoPoints);
                            return;
                          }
                        }
                        setTrackingLazoPoints((prev) => [...prev, { x: xPct, y: yPct }]);
                      } else {
                        setTrackingDraft({ startX: xPct, startY: yPct });
                        setTrackingRegion({ x: xPct, y: yPct, width: 0, height: 0 });
                        (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
                      }
                    }}
                    onPointerUp={(e) => {
                      if (trackingMode === 'rect') {
                        (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
                        setTrackingDraft(null);
                        setIsDrawingTrackingRegion(false);
                        setTrackingRegion((r) => {
                          if (!r) return r;
                          if (r.width >= 1 && r.height >= 1) return r;
                          const w = 20, h = 20;
                          const nx = Math.max(0, Math.min(100 - w, r.x - w / 2));
                          const ny = Math.max(0, Math.min(100 - h, r.y - h / 2));
                          return { x: nx, y: ny, width: w, height: h };
                        });
                      }
                    }}
                  >
                    {trackingMode === 'lazo' ? (
                      <>
                        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-gray-900/90 text-white text-[10px] px-3 py-1.5 rounded-full font-semibold pointer-events-auto flex items-center gap-2 border border-cyan-500/40 shadow-lg">
                          <span className="text-cyan-300">
                            {trackingLazoPoints.length === 0
                              ? 'Haz clic para poner el 1.er punto'
                              : `Vértices: ${trackingLazoPoints.length} · Clica para añadir otro punto o en el 1.er punto para cerrar`}
                          </span>
                          {trackingLazoPoints.length >= 3 && (
                            <button
                              type="button"
                              onClick={(ev) => { ev.stopPropagation(); finishTrackingLazo(trackingLazoPoints); }}
                              className="bg-cyan-600 hover:bg-cyan-500 text-white px-2 py-0.5 rounded font-bold transition text-[9px]"
                            >
                              Cerrar lazo
                            </button>
                          )}
                        </div>
                        {trackingLazoPoints.length > 0 && (
                          <svg className="absolute inset-0 z-[53] pointer-events-none w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                            <path
                              d={contourToSvgPath(trackingLazoPoints)}
                              fill="rgba(6,182,212,0.12)"
                              stroke="#06b6d4"
                              strokeWidth="1.5"
                              strokeDasharray="2 1.5"
                              vectorEffect="non-scaling-stroke"
                            />
                            {trackingCursor && trackingLazoPoints.length > 0 && (
                              <line
                                x1={trackingLazoPoints[trackingLazoPoints.length - 1].x}
                                y1={trackingLazoPoints[trackingLazoPoints.length - 1].y}
                                x2={trackingCursor.x}
                                y2={trackingCursor.y}
                                stroke="#06b6d4"
                                strokeWidth="1.2"
                                strokeDasharray="2 1.5"
                                opacity="0.85"
                                vectorEffect="non-scaling-stroke"
                              />
                            )}
                          </svg>
                        )}
                      </>
                    ) : (
                      <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-cyan-600 text-white text-[10px] px-3 py-1 rounded-full font-bold pointer-events-none whitespace-nowrap shadow-md">
                        Arrastra para marcar el objeto a seguir
                      </div>
                    )}
                  </div>
                )}
                {/* Región de tracking dibujada (Lazo SVG o Rectángulo) */}
                {trackingLazoPath && trackingLazoPath.length >= 3 ? (
                  <div className="absolute inset-0 z-[53] pointer-events-none">
                    <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                      <path
                        d={contourToSvgPath(trackingLazoPath)}
                        fill="rgba(6,182,212,0.15)"
                        stroke="#06b6d4"
                        strokeWidth="1.5"
                        strokeDasharray="2 1.5"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                    {trackingRegion && (
                      <span
                        className="absolute text-[9px] text-cyan-300 font-mono bg-cyan-900/80 px-1.5 py-0.5 rounded whitespace-nowrap border border-cyan-500/30 shadow"
                        style={{ left: `${trackingRegion.x}%`, top: `${Math.max(0, trackingRegion.y - 4)}%` }}
                      >
                        lazo tracking · SAM2
                      </span>
                    )}
                  </div>
                ) : trackingRegion ? (
                  <div
                    className="absolute z-[53] pointer-events-none border-2 border-dashed border-cyan-400 bg-cyan-400/15"
                    style={{
                      left: `${trackingRegion.x}%`,
                      top: `${trackingRegion.y}%`,
                      width: `${trackingRegion.width}%`,
                      height: `${trackingRegion.height}%`,
                    }}
                  >
                    <span className="absolute -top-5 left-0 text-[9px] text-cyan-300 font-mono bg-cyan-900/70 px-1 rounded whitespace-nowrap">
                      región tracking · {Math.round(trackingRegion.width)}×{Math.round(trackingRegion.height)}%
                    </span>
                  </div>
                ) : null}

                {/* Previsualización del movimiento trackeado: Contorno en líneas discontinuas por cada frame */}
                {(() => {
                  if (!trackingPreviewData || !trackingPreviewData.centers?.length) return null;
                  const fps = trackingPreviewData.fps && trackingPreviewData.fps > 0 ? trackingPreviewData.fps : 30;
                  const t = editState.timeline?.currentTime ?? 0;
                  const idx = Math.min(
                    trackingPreviewData.centers.length - 1,
                    Math.max(0, Math.round(t * fps)),
                  );
                  const size = videoNativeSize ?? previewVideoSize;
                  const center0 = trackingPreviewData.centers?.[0] || [0, 0];
                  const centerK = trackingPreviewData.centers?.[idx] || [0, 0];
                  // 1) Si existe el lazo inicial dibujado con líneas rectas, transformarlo para este frame (mantiene líneas rectas):
                  const bb0 = trackingPreviewData.bboxes?.[0] || [0, 0, 0, 0];
                  const bbK = trackingPreviewData.bboxes?.[idx] || [0, 0, 0, 0];
                  const scaleFromBb = (bb0[2] > 0 && bbK[2] > 0) ? bbK[2] / bb0[2] : 1;
                  // Escala lineal basada en el ancho/alto del bbox (coherente con el rectángulo)
                  // para que el lazo ajuste su tamaño al mismo ritmo que el objeto, incluyendo
                  // la altura que antes no se respetaba (usábamos escala uniforme).
                  const lazyScale = isFinite(scaleFromBb) && scaleFromBb > 0 ? scaleFromBb : 1;
                  const lazyScaleX = (bb0[2] > 0 && bbK[2] > 0) ? (isFinite(bbK[2]) ? bbK[2] / bb0[2] : 1) : 1;
                  const lazyScaleY = (bb0[3] > 0 && bbK[3] > 0) ? (isFinite(bbK[3]) ? bbK[3] / bb0[3] : 1) : 1;
                  const lazyRot = trackingPreviewData.rotations?.[idx] ?? 0;
                  let currentPolygon: { x: number; y: number }[] | null = null;
                  if (trackingPreviewData.initial_lazo_path && trackingPreviewData.initial_lazo_path.length >= 3 && size.width && size.height) {
                    currentPolygon = transformLazoForFrame(
                      trackingPreviewData.initial_lazo_path,
                      center0 as [number, number],
                      centerK as [number, number],
                      lazyScale,
                      size.width,
                      size.height,
                      lazyScaleX,
                      lazyScaleY,
                      lazyRot
                    );
                  }

                  // 2) Contorno por frame: preferir el lazo transformado (líneas rectas); si no, el contorno de máscara de SAM2 (ondulado).
                  const contour = trackingPreviewData.contours?.[idx];
                  const usePolygon = currentPolygon && currentPolygon.length >= 3;
                  const drawContour = usePolygon ? currentPolygon! : (contour && contour.length >= 3 ? contour : null);

                  // 3) BBox del tracking (rectángulo que se ajusta al tamaño del objeto por frame).
                  const bb = trackingPreviewData.bboxes?.[idx] || [0, 0, 0, 0];
                  const scale = trackingPreviewData.scales?.[idx] ?? 1;
                  const hasBb = size.width && size.height && bb[2] && bb[3];
                  const xPct = hasBb ? (bb[0] / size.width) * 100 : 0;
                  const yPct = hasBb ? (bb[1] / size.height) * 100 : 0;
                  const wPct = hasBb ? (bb[2] / size.width) * 100 : 0;
                  const hPct = hasBb ? (bb[3] / size.height) * 100 : 0;

                  if (!drawContour && !hasBb) return null;
                  return (
                    <div className="absolute inset-0 z-[54] pointer-events-none">
                      {drawContour && (() => {
                        let minX = 100, minY = 100;
                        for (const p of drawContour) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
                        return (
                          <>
                            <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                              <path
                                d={contourToSvgPath(drawContour)}
                                fill="rgba(16,185,129,0.12)"
                                stroke="#10b981"
                                strokeWidth="1.5"
                                strokeDasharray="2 1.5"
                                vectorEffect="non-scaling-stroke"
                              />
                            </svg>
                            <span
                              className="absolute text-[9px] text-emerald-300 font-mono bg-emerald-950/80 px-1.5 py-0.5 rounded whitespace-nowrap border border-emerald-500/30 shadow"
                              style={{ left: `${Math.max(0, minX)}%`, top: `${Math.max(0, minY - 4)}%` }}
                            >
                              track (SAM2) · frame {idx} · contorno
                            </span>
                          </>
                        );
                      })()}
                      {hasBb && (
                        <div
                          className="absolute z-[55] pointer-events-none border-2 border-emerald-400 bg-emerald-400/20"
                          style={{
                            left: `${xPct}%`,
                            top: `${yPct}%`,
                            width: `${wPct}%`,
                            height: `${hPct}%`,
                          }}
                        >
                          <span className="absolute -top-5 left-0 text-[9px] text-emerald-300 font-mono bg-emerald-900/70 px-1 rounded whitespace-nowrap">
                            track · frame {idx} · {Math.round(wPct)}×{Math.round(hPct)}% · s{scale.toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
        {/* Global Recording Area Calibration Overlay (Fixed relative to window) */}
        {isCalibrating && (
          <div
            className="fixed inset-0 z-[100] bg-black/20"
            onMouseMove={(e) => {
              if (isDraggingCal) {
                const dx = e.clientX - dragStartCal.x;
                const dy = e.clientY - dragStartCal.y;
                setRecordingArea(prev => ({
                  ...prev,
                  x: Math.max(0, prev.x + dx),
                  y: Math.max(0, prev.y + dy),
                }));
                setDragStartCal({ x: e.clientX, y: e.clientY });
              } else if (resizeHandleCal) {
                const dx = e.clientX - dragStartCal.x;
                const dy = e.clientY - dragStartCal.y;
                setRecordingArea(prev => {
                  const newArea = { ...prev };
                  if (resizeHandleCal.includes('e')) newArea.width = Math.max(100, prev.width + dx);
                  if (resizeHandleCal.includes('s')) newArea.height = Math.max(100, prev.height + dy);
                  if (resizeHandleCal.includes('w')) {
                    const newWidth = Math.max(100, prev.width - dx);
                    if (newWidth !== prev.width) {
                      newArea.x = prev.x + (prev.width - newWidth);
                      newArea.width = newWidth;
                    }
                  }
                  if (resizeHandleCal.includes('n')) {
                    const newHeight = Math.max(100, prev.height - dy);
                    if (newHeight !== prev.height) {
                      newArea.y = prev.y + (prev.height - newHeight);
                      newArea.height = newHeight;
                    }
                  }
                  return newArea;
                });
                setDragStartCal({ x: e.clientX, y: e.clientY });
              }
            }}
            onMouseUp={() => {
              setIsDraggingCal(false);
              setResizeHandleCal(null);
            }}
          >
            <div
              className={cn(
                "absolute border-2 border-dashed border-red-500 bg-red-500/10 pointer-events-auto cursor-move shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]",
                isDraggingCal && "border-solid bg-red-500/20"
              )}
                     style={{
                      left: recordingArea.x + vertexAreaOffsetX,
                      top: recordingArea.y + vertexAreaOffsetY,
                      width: recordingArea.width,
                      height: recordingArea.height,
                    }}
              onMouseDown={(e) => {
                e.stopPropagation();
                setIsDraggingCal(true);
                setDragStartCal({ x: e.clientX, y: e.clientY });
              }}
            >
              <div className="absolute -top-6 left-0 bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded font-mono whitespace-nowrap pointer-events-none">
                {Math.round(recordingArea.width)}x{Math.round(recordingArea.height)} | x:{Math.round(recordingArea.x)} y:{Math.round(recordingArea.y)}
              </div>

              {/* Resize Handles */}
              <div className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize hover:bg-red-500/50" onMouseDown={(e) => { e.stopPropagation(); setResizeHandleCal('nw'); setDragStartCal({ x: e.clientX, y: e.clientY }); }} />
              <div className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize hover:bg-red-500/50" onMouseDown={(e) => { e.stopPropagation(); setResizeHandleCal('ne'); setDragStartCal({ x: e.clientX, y: e.clientY }); }} />
              <div className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize hover:bg-red-500/50" onMouseDown={(e) => { e.stopPropagation(); setResizeHandleCal('sw'); setDragStartCal({ x: e.clientX, y: e.clientY }); }} />
              <div className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize hover:bg-red-500/50" onMouseDown={(e) => { e.stopPropagation(); setResizeHandleCal('se'); setDragStartCal({ x: e.clientX, y: e.clientY }); }} />
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1 cursor-n-resize" onMouseDown={(e) => { e.stopPropagation(); setResizeHandleCal('n'); setDragStartCal({ x: e.clientX, y: e.clientY }); }} />
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full h-1 cursor-s-resize" onMouseDown={(e) => { e.stopPropagation(); setResizeHandleCal('s'); setDragStartCal({ x: e.clientX, y: e.clientY }); }} />
              <div className="absolute left-0 top-1/2 -translate-y-1/2 h-full w-1 cursor-w-resize" onMouseDown={(e) => { e.stopPropagation(); setResizeHandleCal('w'); setDragStartCal({ x: e.clientX, y: e.clientY }); }} />
              <div className="absolute right-0 top-1/2 -translate-y-1/2 h-full w-1 cursor-e-resize" onMouseDown={(e) => { e.stopPropagation(); setResizeHandleCal('e'); setDragStartCal({ x: e.clientX, y: e.clientY }); }} />

              {/* Calibration Controls */}
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[101] flex items-center gap-2 bg-black/90 backdrop-blur-md border border-red-500/50 rounded-2xl p-4 flex-wrap pointer-events-auto shadow-2xl">
                <div className="flex flex-col gap-1 mr-4">
                  <span className="text-[10px] text-red-400 uppercase font-bold">{t('videoEditor.calibrationMode')}</span>
                  <span className="text-[9px] text-gray-400">Punto (0,0) en esquina de la ventana</span>
                </div>

                <Button
                  className="ml-4 bg-red-600 hover:bg-red-500 text-white rounded-lg px-6 h-9 transition-all active:scale-95"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      localStorage.setItem('zeus-recording-area', JSON.stringify(recordingArea));
                    }
                    setIsCalibrating(false);
                  }}
                >
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        )}
        {/* Panel derecho - Controles de medios */}
        {/* Panel derecho - Editor de Recursos y Estilo (Fixed width) */}
        <div className="w-[600px] bg-gray-900 border-l border-gray-800 flex flex-col h-full overflow-hidden flex-none">
          <div className="p-4 border-b border-gray-800 flex-none">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Settings className="w-4 h-4 text-emerald-500" />
              {t('videoEditor.app.styleResources')}
            </h2>
          </div>

          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <Tabs defaultValue={localScriptContent ? "script" : "resources"} className="flex-1 flex flex-col min-h-0">
              <div className="p-4 pb-2 flex-none">
                 <TabsList className="bg-gray-800/30 p-1 border border-gray-700/50 rounded-lg flex flex-wrap gap-1 w-full h-auto items-stretch mt-3">
                  <TabsTrigger
                    value="script"
                    className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-lg rounded-md transition-all px-2 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 flex-1 min-w-[calc(25%-3px)]"
                  >
                    {t('videoEditor.script.tab')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="resources"
                    className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-lg rounded-md transition-all px-2 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 flex-1 min-w-[calc(25%-3px)]"
                  >
                    {t('videoEditor.resources.tab')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="font-editor"
                    className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-lg rounded-md transition-all px-2 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 flex-1 min-w-[calc(25%-3px)]"
                  >
                    {t('videoEditor.style.tab')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="html2mp4"
                    className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-lg rounded-md transition-all px-2 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 flex-1 min-w-[calc(25%-3px)]"
                  >
                    {t('videoEditor.html2mp4.tab')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="library"
                    className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-lg rounded-md transition-all px-2 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 flex-1 min-w-[calc(25%-3px)]"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    {t('videoEditor.library.tab')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="ltx"
                    className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-lg rounded-md transition-all px-2 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 flex-1 min-w-[calc(25%-3px)]"
                  >
                    <Film className="w-3.5 h-3.5" />
                    {t('videoEditor.ltx.tab')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="enhance"
                    className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-lg rounded-md transition-all px-2 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 flex-1 min-w-[calc(25%-3px)]"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {t('videoEditor.enhance.tab')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="capture"
                    className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-lg rounded-md transition-all px-2 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 flex-1 min-w-[calc(25%-3px)]"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    {t('videoEditor.capture.tab')}
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Contenedor del contenido de pestañas con Scroll Personalizado */}
              <div className="flex-1 overflow-y-auto p-4 pt-0 min-h-0 custom-scrollbar-thin">
                <style jsx global>{`
                  .custom-scrollbar-thin::-webkit-scrollbar {
                    width: 4px;
                  }
                  .custom-scrollbar-thin::-webkit-scrollbar-track {
                    background: transparent;
                  }
                  .custom-scrollbar-thin::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 10px;
                  }
                  .custom-scrollbar-thin::-webkit-scrollbar-thumb:hover {
                    background: rgba(16, 185, 129, 0.3);
                  }
                `}</style>

                {localScriptContent !== undefined && (
                  <TabsContent value="script" className="mt-0 outline-none animate-in fade-in duration-300">
                    <div className="rounded-xl bg-gray-800/60 border border-emerald-500/30 p-4 pb-5">
                      <h4 className="text-sm font-bold text-emerald-400 mb-2 flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        {t('videoEditor.script.proposal')}
                      </h4>
                      <textarea
                        value={localScriptContent}
                        onChange={(e) => setLocalScriptContent(e.target.value)}
                        className="w-full min-h-[120px] max-h-[60vh] p-3 rounded-lg bg-gray-900/80 border border-gray-700 text-gray-300 text-sm whitespace-pre-wrap resize-y outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent custom-scrollbar-thin"
                        placeholder={t('videoEditor.script.placeholder')}
                      />
                      <button
                        type="button"
                        onClick={handleOpenPresentationView}
                        disabled={!localScriptContent.trim()}
                        className="mt-3 w-auto min-w-0 max-w-[180px] flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
                      >
                        <Presentation className="w-4 h-4 shrink-0" />
                        {t('videoEditor.script.viewPresentation')}
                      </button>
                    </div>
                  </TabsContent>
                )}

                {/* Pestaña de Recursos (Botones + Preview) */}
                <TabsContent value="resources" className="mt-0 outline-none animate-in fade-in slide-in-from-left-2 duration-300 space-y-6">
                  <div className="space-y-4 pt-2">
                    {/* Vídeo */}
                    <div>
                      <p className="text-xs text-gray-400 mb-2 flex items-center gap-1.5">
                        <FileVideo className="w-3.5 h-3.5 text-emerald-400" />
                        {t('videoEditor.resources.videoLabel')}
                      </p>
                      <Button
                        onClick={() => openLocalFolderResources('video')}
                        variant="ghost"
                        className="w-full flex items-center justify-center gap-2 border-emerald-500/80 border bg-gradient-to-b from-white/[0.08] to-transparent text-white hover:bg-white/[0.15] transition-all shadow-md h-12 text-sm font-medium rounded-xl group"
                      >
                        <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 group-hover:bg-emerald-500/30 transition-colors">
                          <FolderOpen className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col items-start leading-tight">
                          <span className="font-bold">{t('videoEditor.resources.openVideos')}</span>
                          <span className="text-[10px] text-gray-400 font-normal">{t('videoEditor.resources.locationNote')}</span>
                        </div>
                      </Button>
                    </div>
                    {/* Audio */}
                    <div>
                      <p className="text-xs text-gray-400 mb-2 flex items-center gap-1.5">
                        <FileAudio className="w-3.5 h-3.5 text-emerald-400" />
                        {t('videoEditor.resources.audioLabel')}
                      </p>
                      <Button
                        onClick={() => openLocalFolderResources('audio')}
                        variant="ghost"
                        className="w-full flex items-center justify-center gap-2 border-emerald-500/80 border bg-gradient-to-b from-white/[0.08] to-transparent text-white hover:bg-white/[0.15] transition-all shadow-md h-12 text-sm font-medium rounded-xl group"
                      >
                        <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 group-hover:bg-emerald-500/30 transition-colors">
                          <FolderOpen className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col items-start leading-tight">
                          <span className="font-bold">{t('videoEditor.resources.openAudios')}</span>
                          <span className="text-[10px] text-gray-400 font-normal">{t('videoEditor.resources.locationNote')}</span>
                        </div>
                      </Button>
                    </div>
                    {/* Imagen */}
                    <div>
                      <p className="text-xs text-gray-400 mb-2 flex items-center gap-1.5">
                        <FileImage className="w-3.5 h-3.5 text-emerald-400" />
                        {t('videoEditor.resources.imageLabel')}
                      </p>
                      <Button
                        onClick={() => openLocalFolderResources('image')}
                        variant="ghost"
                        className="w-full flex items-center justify-center gap-2 border-emerald-500/80 border bg-gradient-to-b from-white/[0.08] to-transparent text-white hover:bg-white/[0.15] transition-all shadow-md h-12 text-sm font-medium rounded-xl group"
                      >
                        <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 group-hover:bg-emerald-500/30 transition-colors">
                          <FolderOpen className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col items-start leading-tight">
                          <span className="font-bold">{t('videoEditor.resources.openImages')}</span>
                          <span className="text-[10px] text-gray-400 font-normal">{t('videoEditor.resources.locationNote')}</span>
                        </div>
                      </Button>
                    </div>

                    {/* Captura de Pantalla (eliminado) */}
                  </div>

                  {/* Crear diapositivas desde vídeo */}
                  <div className="rounded-xl bg-gray-800/60 border border-emerald-500/30 p-4 space-y-4">
                    <h4 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                      <ImagePlus className="w-4 h-4" />
                      {t('videoEditor.resources.slidesTitle')}
                    </h4>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setSlideSource('timeline')}
                        className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${slideSource === 'timeline' ? 'text-sm font-medium text-emerald-400/90 bg-emerald-950/30 border border-emerald-500/30 rounded-lg p-3' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'}`}
                      >
                        <Film className="w-3.5 h-3.5" />
                        {t('videoEditor.resources.sourceTimeline')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSlideSource('url')}
                        className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${slideSource === 'url' ? 'text-sm font-medium text-emerald-400/90 bg-emerald-950/30 border border-emerald-500/30 rounded-lg p-3' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'}`}
                      >
                        <Link className="w-3.5 h-3.5" />
                        {t('videoEditor.resources.sourceUrl')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSlideSource('photos')}
                        className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${slideSource === 'photos' ? 'text-sm font-medium text-emerald-400/90 bg-emerald-950/30 border border-emerald-500/30 rounded-lg p-3' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'}`}
                      >
                        <FileImage className="w-3.5 h-3.5" />
                        {t('videoEditor.resources.sourcePhotos')}
                      </button>
                    </div>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      ref={photoInputRef}
                      className="hidden"
                      onChange={async (e) => {
                        const files = e.target.files;
                        if (!files?.length) return;
                        setIsCapturingSlides(true);
                        try {
                          const result = await createSlidesFromPhotos(files);
                          setSlides((prev) => [...prev, ...result]);
                        } catch (err) {
                          console.error(err);
                          alert(err instanceof Error ? err.message : t('videoEditor.resources.photosError'));
                        } finally {
                          setIsCapturingSlides(false);
                          if (photoInputRef.current) photoInputRef.current.value = '';
                        }
                      }}
                    />
                    {slideSource === 'url' && (
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.resources.videoUrl')}</label>
                        <input
                          type="url"
                          value={slideVideoUrl}
                          onChange={(e) => setSlideVideoUrl(e.target.value)}
                          placeholder="https://..."
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    )}
                    {slideSource === 'photos' && (
                      <div className="rounded-lg border border-dashed border-gray-600 bg-gray-900/50 p-4 text-center">
                        <button
                          type="button"
                          onClick={() => photoInputRef.current?.click()}
                          className="text-sm text-gray-300 hover:text-emerald-400 transition-colors flex flex-col items-center gap-2 mx-auto"
                        >
                          <Upload className="w-6 h-6" />
                          <span>{t('videoEditor.resources.clickSelectPhotos')}</span>
                        </button>
                        <p className="text-xs text-gray-500 mt-2">{t('videoEditor.resources.photosAddedNote')}</p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3 items-end">
                      {slideSource !== 'photos' && (
                        <>
                          <div className="flex-1 min-w-[100px]">
                            <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.resources.everySeconds')}</label>
                            <input
                              type="number"
                              min={1}
                              max={120}
                              value={slideIntervalSeconds}
                              onChange={(e) => setSlideIntervalSeconds(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
                              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                          </div>
                          <div className="w-[140px]">
                            <label className="text-xs text-gray-400 block mb-1">{t('videoEditor.resources.quality')}</label>
                            <Select value={slideQuality} onValueChange={(v: 'low' | 'medium' | 'high' | 'ultra' | 'max') => setSlideQuality(v)}>
                              <SelectTrigger className="bg-gray-900 border-gray-700 text-white text-sm h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="low">{t('videoEditor.resources.qualityLow')}</SelectItem>
                                <SelectItem value="medium">{t('videoEditor.resources.qualityMedium')}</SelectItem>
                                <SelectItem value="high">{t('videoEditor.resources.qualityHigh')}</SelectItem>
                                <SelectItem value="ultra">{t('videoEditor.resources.qualityUltra')}</SelectItem>
                                <SelectItem value="max">{t('videoEditor.resources.qualityMax')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      )}
                      <Button
                        disabled={isCapturingSlides || (slideSource === 'url' && !slideVideoUrl.trim())}
                        onClick={async () => {
                          if (slideSource === 'photos') {
                            photoInputRef.current?.click();
                            return;
                          }
                          const src = slideSource === 'timeline' ? getCurrentVideoSource() : slideVideoUrl.trim();
                          if (!src) {
                            alert(slideSource === 'timeline'
                              ? t('videoEditor.resources.noTimelineVideo')
                              : t('videoEditor.resources.writeUrl'));
                            return;
                          }
                          setIsCapturingSlides(true);
                          try {
                            const result = await captureSlidesFromVideo(src, slideIntervalSeconds, slideQuality);
                            setSlides(result);
                          } catch (err) {
                            console.error(err);
                            alert(err instanceof Error ? err.message : t('videoEditor.resources.slidesError'));
                          } finally {
                            setIsCapturingSlides(false);
                          }
                        }}
                        className={`text-sm font-medium text-emerald-400/90 bg-emerald-950/30 border border-emerald-500/30 rounded-lg p-3 hover:bg-emerald-600 hover:text-black transition-colors`}
                      >
                        {isCapturingSlides ? <Loader2 className="w-4 h-4 animate-spin" /> : slideSource === 'photos' ? <Upload className="w-4 h-4" /> : <ImagePlus className="w-4 h-4" />}
                        <span>{isCapturingSlides ? t('videoEditor.resources.generating') : slideSource === 'photos' ? t('videoEditor.resources.selectPhotos') : t('videoEditor.resources.generateSlides')}</span>
                      </Button>
                    </div>
                  </div>


                  {/* Lista de diapositivas: reordenar, títulos, descripciones */}
                  {slides.length > 0 && (
                    <div className="rounded-xl bg-gray-800/60 border border-emerald-500/30 p-4 space-y-4">
                      <h4 className="text-sm font-bold text-gray-300">{t('videoEditor.resources.slidesCount', { n: slides.length })}</h4>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 text-sm text-gray-400">
                          <input
                            type="checkbox"
                            checked={sameTitleForAll}
                            onChange={(e) => setSameTitleForAll(e.target.checked)}
                            className="rounded border-gray-600 bg-gray-800 text-emerald-500"
                          />
                          {t('videoEditor.resources.sameTitle')}
                        </label>
                        {sameTitleForAll && (
                          <>
                            <input
                              type="text"
                              value={globalSlideTitle}
                              onChange={(e) => setGlobalSlideTitle(e.target.value)}
                              placeholder={t('videoEditor.resources.commonTitle')}
                              className="flex-1 min-w-[120px] bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm"
                            />
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setSlides(prev => prev.map(s => ({ ...s, title: globalSlideTitle })))}
                              className="bg-gray-700 text-white hover:bg-gray-600"
                            >
                              {t('videoEditor.resources.apply')}
                            </Button>
                          </>
                        )}
                      </div>
                      <div className="space-y-3 max-h-[280px] overflow-y-auto custom-scrollbar-thin">
                        {slides.map((slide, index) => (
                          <div key={slide.id} className="flex gap-3 p-3 bg-gray-900/80 rounded-lg border border-gray-700/50">
                            <div className="flex flex-col items-center justify-center shrink-0 w-8 h-12 rounded bg-gray-800 border border-gray-600 text-gray-300 font-bold text-sm" title={t('videoEditor.resources.position', { n: index + 1, total: slides.length })}>
                              {index + 1}
                            </div>
                            <div className="flex flex-col gap-0.5 shrink-0">
                              <button
                                type="button"
                                disabled={index === 0}
                                onClick={() => {
                                  const next = [...slides];
                                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                  setSlides(next);
                                }}
                                className="p-1 rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                title={t('videoEditor.resources.moveUp')}
                              >
                                <ArrowUp className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                disabled={index === slides.length - 1}
                                onClick={() => {
                                  const next = [...slides];
                                  [next[index], next[index + 1]] = [next[index + 1], next[index]];
                                  setSlides(next);
                                }}
                                className="p-1 rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                title={t('videoEditor.resources.moveDown')}
                              >
                                <ArrowDown className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm(t('videoEditor.resources.deleteSlideConfirm'))) {
                                    setSlides(prev => prev.filter((_, i) => i !== index));
                                  }
                                }}
                                className="p-1 rounded text-gray-400 hover:text-red-400 transition-colors"
                                title={t('videoEditor.resources.deleteSlide')}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => setSlidePreviewImageUrl(slide.imageDataUrl)}
                              className="w-16 h-12 shrink-0 rounded overflow-hidden border border-gray-600 hover:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              title={t('videoEditor.resources.viewImage')}
                            >
                              <img src={slide.imageDataUrl} alt="" className="w-full h-full object-cover" />
                            </button>
                            <div className="flex-1 min-w-0 space-y-1">
                              <input
                                type="text"
                                value={slide.title}
                                onChange={(e) => setSlides(prev => prev.map(s => s.id === slide.id ? { ...s, title: e.target.value } : s))}
                                placeholder={t('videoEditor.resources.titlePh')}
                                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs"
                              />
                              <input
                                type="text"
                                value={slide.description}
                                onChange={(e) => setSlides(prev => prev.map(s => s.id === slide.id ? { ...s, description: e.target.value } : s))}
                                placeholder={t('videoEditor.resources.descPh')}
                                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs"
                              />
                              <select
                                value={slide.overlayEffectId || ''}
                                onChange={(e) => setSlides(prev => prev.map(s => s.id === slide.id ? { ...s, overlayEffectId: e.target.value || null } : s))}
                                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs"
                                title={t('videoEditor.resources.overlayEffect')}
                              >
                                <option value="">{t('videoEditor.resources.noEffect')}</option>
                                {getAllEffects().map((eff) => (
                                  <option key={eff.id} value={eff.id}>{eff.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-3 pt-3 border-t border-gray-700">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-xs text-gray-400 font-medium">{t('videoEditor.resources.transitionBetween')}</span>
                        </div>
                        {presentationTransitionsByGap.length > 0 ? (
                          <div className="space-y-2">
                            {presentationTransitionsByGap.map((trans, gapIndex) => (
                              <div key={gapIndex} className="flex flex-wrap items-center gap-2">
                                <span className="text-xs text-gray-500 w-24 shrink-0">
                                  {t('videoEditor.resources.betweenGap', { a: gapIndex + 1, b: gapIndex + 2 })}
                                </span>
                                <select
                                  value={trans.type}
                                  onChange={(e) =>
                                    setPresentationTransitionsByGap((prev) =>
                                      prev.map((t, i) => (i === gapIndex ? { ...t, type: e.target.value as TransitionType } : t))
                                    )
                                  }
                                  className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-xs"
                                >
                                  <option value="none">{t('videoEditor.transition.typeNone')}</option>
                                  <option value="fade">{t('videoEditor.transition.typeFade')}</option>
                                  <option value="dissolve">{t('videoEditor.transition.typeDissolve')}</option>
                                  <option value="slide-left">{t('videoEditor.transition.typeSlideLeft')}</option>
                                  <option value="slide-right">{t('videoEditor.transition.typeSlideRight')}</option>
                                  <option value="slide-up">{t('videoEditor.transition.typeSlideUp')}</option>
                                  <option value="slide-down">{t('videoEditor.transition.typeSlideDown')}</option>
                                  <option value="zoom-in">{t('videoEditor.transition.typeZoomIn')}</option>
                                  <option value="zoom-out">{t('videoEditor.transition.typeZoomOut')}</option>
                                  <option value="blur">{t('videoEditor.transition.typeBlur')}</option>
                                </select>
                                {trans.type !== 'none' && (
                                  <input
                                    type="number"
                                    min={0.2}
                                    max={2}
                                    step={0.1}
                                    value={trans.duration}
                                    onChange={(e) =>
                                      setPresentationTransitionsByGap((prev) =>
                                        prev.map((t, i) =>
                                          i === gapIndex ? { ...t, duration: Math.max(0.2, Math.min(2, Number(e.target.value) || 0.5)) } : t
                                        )
                                      )
                                    }
                                    className="w-14 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white text-xs"
                                  />
                                )}
                                <span className="text-[10px] text-gray-500">{trans.type !== 'none' ? 's' : ''}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">{t('videoEditor.resources.genSlidesHint')}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-700">
                        <span className="text-xs text-gray-400">{t('videoEditor.resources.musicFromTimeline')}</span>
                        <Select
                          value={presentationMusicClip ? presentationMusicClip.url : 'none'}
                          onValueChange={(v) => {
                            if (v === 'none') {
                              setPresentationMusicClip(null);
                              return;
                            }
                            const audioTracks = editState.timeline?.tracks.filter(t => t.type === 'audio') || [];
                            const clips = audioTracks.flatMap(t => t.clips).filter(c => c.mediaFileId);
                            const clip = clips.find(c => resolveUrl(c.mediaFileId!) === v);
                            if (clip) setPresentationMusicClip({ url: v, duration: clip.duration });
                          }}
                        >
                          <SelectTrigger className="w-[180px] bg-gray-900 border-gray-700 text-white text-xs h-8">
                            <SelectValue placeholder={t('videoEditor.resources.none')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t('videoEditor.resources.none')}</SelectItem>
                            {editState.timeline?.tracks
                              ?.filter(t => t.type === 'audio')
                              .flatMap(t => t.clips)
                              .filter(c => c.mediaFileId)
                              .map((c, i) => (
                                <SelectItem key={c.id} value={resolveUrl(c.mediaFileId!)}>
                                  {c.label || t('videoEditor.resources.audioN', { n: i + 1 })}
                                </SelectItem>
                              )) || []}
                          </SelectContent>
                        </Select>
                        <Button
                          onClick={() => {
                            setPresentationSlideIndex(0);
                            setPresentationSlidesPlaying(false);
                            setPresentationSlidesOpen(true);
                          }}
                          className="!bg-emerald-600 hover:!bg-emerald-500 !text-white ml-auto gap-2"
                        >
                          <Presentation className="w-4 h-4" />
                          {t('videoEditor.resources.createPresentation')}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setPresentationSaveModalOpen(true)}
                          className="border-gray-600 text-gray-300 hover:bg-gray-800 gap-2"
                          title={t('videoEditor.resources.saveDbTitle')}
                        >
                          <Save className="w-4 h-4" />
                          {t('videoEditor.resources.saveDb')}
                        </Button>
                      </div>
                    </div>
                  )}

                  {editState.timeline && (
                    <div className="bg-gray-800/40 rounded-xl p-4 border border-emerald-500/30 shadow-xl">
                      <h4 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2 uppercase tracking-widest text-[10px]">
                        <Play className="w-3 h-3 text-emerald-500" />
                        {t('videoEditor.resources.previewTimeline')}
                      </h4>
                      <div className="bg-black rounded-lg overflow-hidden border border-gray-950 shadow-inner" style={{ height: '120px' }}>
                        <TimelinePreview
                          timeline={editState.timeline}
                          isPlaying={isTimelinePlaying}
                          previewTimeRef={previewTimeRef}
                        />
                      </div>
                      <p className="text-[10px] text-gray-500 mt-3 italic text-center">
                        {t('videoEditor.resources.quickView')}
                      </p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="enhance" className="mt-0 outline-none animate-in fade-in duration-300 space-y-4">
                  <div className="rounded-xl bg-gray-800/60 border border-emerald-500/30 p-4 space-y-4">
                    <h4 className="text-sm font-bold text-emerald-400 flex items-center gap-2 uppercase tracking-widest text-[10px]">
                      <Sparkles className="w-4 h-4" />
                      {t('videoEditor.enhance.title')}
                    </h4>
                    <p className="text-[11px] text-gray-400 leading-snug">
                      {t('videoEditor.enhance.desc')}
                    </p>

                    {/* Origen (común a ambos modos) */}
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.enhance.sourceLabel')}</label>
                      <div className="flex items-center gap-2">
                        <label className="flex-1 cursor-pointer">
                          <span className="block w-full px-3 py-2 rounded-lg border border-dashed border-gray-600 hover:border-emerald-500/60 text-[11px] text-gray-300 bg-gray-900/40 text-center truncate">
                            {enhanceSourceFile ? enhanceSourceFile.name : (enhanceSourcePath ? enhanceSourcePath.replace(/\\/g, '/').split('/').pop() : t('videoEditor.enhance.chooseVideo'))}
                          </span>
                          <input
                            type="file"
                            accept="video/*"
                            className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0] || null; setEnhanceSourceFile(f); setEnhanceSourcePath(''); setEnhanceError(null); }}
                          />
                        </label>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={enhanceBusy || !mediaUrlToPath(videoUrl)}
                          onClick={() => { setEnhanceSourcePath(mediaUrlToPath(videoUrl)); setEnhanceSourceFile(null); setEnhanceError(null); }}
                          className="border-gray-600 text-gray-300 hover:bg-gray-800 text-[10px] whitespace-nowrap"
                          title={mediaUrlToPath(videoUrl) ? t('videoEditor.enhance.useLoadedTitle') : t('videoEditor.enhance.notLocalTitle')}
                        >
                          {t('videoEditor.enhance.useLoaded')}
                        </Button>
                      </div>
                    </div>

                    {/* Nombre del archivo de salida */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.html2mp4.fileNameLabel')}</label>
                      <input
                        type="text"
                        value={enhanceFileName}
                        onChange={(e) => setEnhanceFileName(e.target.value)}
                        placeholder={`Mejorado_${(enhanceSourceFile?.name || 'video').replace(/\.[^.]+$/, '')}`}
                        disabled={enhanceBusy}
                        className="w-full bg-gray-900/40 border border-gray-700 rounded-lg p-2 text-xs text-white outline-none focus:ring-1 focus:ring-emerald-400"
                      />
                    </div>

                    {/* ===== Controles de mejora (ffmpeg) ===== */}
                    {/* Escalado */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.enhance.rescale')}</label>
                      <Select value={enhanceScale} onValueChange={(v) => setEnhanceScale(v as any)}>
                        <SelectTrigger className="bg-gray-900/40 border-gray-700 text-gray-200 text-xs h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="no">{t('videoEditor.enhance.noScale')}</SelectItem>
                          <SelectItem value="1.5x">1.5×</SelectItem>
                          <SelectItem value="2x">2×</SelectItem>
                          <SelectItem value="1080p">{t('videoEditor.enhance.to1080p')}</SelectItem>
                          <SelectItem value="4k">{t('videoEditor.enhance.to4k')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Nitidez */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between"><label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.enhance.sharpness')}</label><span className="text-[10px] text-gray-500">{enhanceSharpen.toFixed(1)}{enhanceSharpen === 0 ? t('videoEditor.enhance.offSuffix') : ''}</span></div>
                      <Slider value={[enhanceSharpen]} min={0} max={2} step={0.1} onValueChange={(v) => setEnhanceSharpen(v[0])} />
                    </div>

                    {/* Reducir ruido */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between"><label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.enhance.denoise')}</label><span className="text-[10px] text-gray-500">{enhanceDenoise.toFixed(1)}{enhanceDenoise === 0 ? t('videoEditor.enhance.offSuffix') : ''}</span></div>
                      <Slider value={[enhanceDenoise]} min={0} max={3} step={0.5} onValueChange={(v) => setEnhanceDenoise(v[0])} />
                    </div>

                    {/* FPS */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.enhance.interpolate')}</label>
                      <Select value={enhanceFps} onValueChange={(v) => setEnhanceFps(v as any)}>
                        <SelectTrigger className="bg-gray-900/40 border-gray-700 text-gray-200 text-xs h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="no">{t('videoEditor.enhance.noChange')}</SelectItem>
                          <SelectItem value="30">30 FPS</SelectItem>
                          <SelectItem value="60">60 FPS</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex items-center justify-between gap-3 py-1">
                        <div className="flex-1">
                          <span className="text-[10px] text-gray-300 block">{t('videoEditor.enhance.motionInterp')}</span>
                          <span className="text-[9px] text-gray-500">{t('videoEditor.enhance.motionInterpHelp')}</span>
                        </div>
                        <Switch checked={enhanceMotion} onCheckedChange={setEnhanceMotion} disabled={enhanceFps === 'no'} />
                      </div>
                    </div>

                    {enhanceError && (
                      <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{enhanceError}</div>
                    )}

                    {enhanceBusy && (
                      <div className="space-y-1.5">
                        <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.max(2, Math.min(100, enhanceProgress))}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400 text-center">{t('videoEditor.enhance.improvingPct', { progress: Math.round(enhanceProgress) })}</p>
                      </div>
                    )}

                    <Button
                      type="button"
                      onClick={() => handleEnhanceVideo()}
                      disabled={enhanceBusy || (!enhanceSourceFile && !enhanceSourcePath)}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
                    >
                      {enhanceBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {enhanceBusy ? t('videoEditor.enhance.improving') : t('videoEditor.enhance.improveBtn')}
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="capture" forceMount className="mt-0 outline-none animate-in fade-in duration-300 space-y-4 data-[state=inactive]:hidden">
                  <div className="rounded-xl bg-gray-800/60 border border-emerald-500/30 p-4 space-y-4">
                    <h4 className="text-sm font-bold text-emerald-400 flex items-center gap-2 uppercase tracking-widest text-[10px]">
                      <Camera className="w-4 h-4" />
                      {t('videoEditor.capture.title')}
                    </h4>
                    <p className="text-[11px] text-gray-400 leading-snug">
                      {t('videoEditor.capture.desc')}
                    </p>
                    <ScreenshotCapture
                      videoRef={videoRef}
                      onAddClipToTimeline={addCapturedClip}
                      currentTime={editState.timeline?.currentTime ?? 0}
                      isPreviewAudioMuted={captureAudioMuted}
                      onPreviewAudioMutedChange={setCaptureAudioMuted}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="html2mp4" className="mt-0 outline-none animate-in fade-in duration-300 space-y-4">
                  <div className="rounded-xl bg-gray-800/60 border border-emerald-500/30 p-4 space-y-4">
                    <h4 className="text-sm font-bold text-emerald-400 flex items-center gap-2 uppercase tracking-widest text-[10px]">
                      <Code2 className="w-4 h-4" />
                      {t('videoEditor.html2mp4.title')}
                    </h4>
                    <p className="text-[11px] text-gray-400 leading-snug">
                      {t('videoEditor.html2mp4.desc')}
                    </p>

                    {/* Conmutador de modo: Archivo HTML/ZIP | URL Web | Archivo WebM */}
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => { setHtmlMode('file'); setHtmlError(null); setHtmlProgress(0); }}
                        disabled={htmlBusy}
                        className={`px-2 py-2 rounded-lg border text-xs transition-all flex items-center justify-center gap-1.5 ${htmlMode === 'file' ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <FileArchive className="w-3.5 h-3.5" /> {t('videoEditor.html2mp4.modeFile')}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setHtmlMode('url'); setHtmlError(null); setHtmlProgress(0); }}
                        disabled={htmlBusy}
                        className={`px-2 py-2 rounded-lg border text-xs transition-all flex items-center justify-center gap-1.5 ${htmlMode === 'url' ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <Globe className="w-3.5 h-3.5" /> {t('videoEditor.html2mp4.modeUrl')}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setHtmlMode('webm'); setHtmlError(null); setHtmlProgress(0); }}
                        disabled={htmlBusy}
                        className={`px-2 py-2 rounded-lg border text-xs transition-all flex items-center justify-center gap-1.5 ${htmlMode === 'webm' ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <FileVideo className="w-3.5 h-3.5" /> {t('videoEditor.html2mp4.modeVideo')}
                      </button>
                    </div>

                    {/* Origen según modo */}
                    {htmlMode === 'file' ? (
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.html2mp4.fileLabel')}</label>
                        <label className="block cursor-pointer">
                          <span className="block w-full px-3 py-2 rounded-lg border border-dashed border-gray-600 hover:border-emerald-500/60 text-[11px] text-gray-300 bg-gray-900/40 text-center truncate">
                            {htmlSrcFile ? htmlSrcFile.name : t('videoEditor.html2mp4.chooseZip')}
                          </span>
                          <input
                            type="file"
                            accept=".zip,.html"
                            className="hidden"
                            onChange={(e) => { setHtmlSrcFile(e.target.files?.[0] || null); setHtmlError(null); setHtmlProgress(0); }}
                          />
                        </label>
                      </div>
                    ) : htmlMode === 'url' ? (
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.html2mp4.urlLabel')}</label>
                        <input
                          type="url"
                          value={webUrl}
                          onChange={(e) => { setWebUrl(e.target.value); setHtmlError(null); setHtmlProgress(0); }}
                          placeholder={t('videoEditor.html2mp4.urlPh')}
                          disabled={htmlBusy}
                          className="w-full bg-gray-900/40 border border-gray-700 rounded-lg p-2 text-xs text-white outline-none focus:ring-1 focus:ring-emerald-400"
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.html2mp4.videoLabel')}</label>
                        <label className="block cursor-pointer">
                          <span className="block w-full px-3 py-2 rounded-lg border border-dashed border-gray-600 hover:border-emerald-500/60 text-[11px] text-gray-300 bg-gray-900/40 text-center truncate">
                            {webSrcFile ? webSrcFile.name : t('videoEditor.html2mp4.chooseVideo')}
                          </span>
                          <input
                            type="file"
                            accept="video/*,.webm,.mkv,.mov,.avi,.ogv,.flv"
                            className="hidden"
                            onChange={(e) => { setWebSrcFile(e.target.files?.[0] || null); setHtmlError(null); setHtmlProgress(0); }}
                          />
                        </label>
                        <p className="text-[10px] text-gray-500 leading-snug">{t('videoEditor.html2mp4.webmNote')}</p>
                      </div>
                    )}

                    {/* Nombre del archivo de salida */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.html2mp4.fileNameLabel')}</label>
                      <input
                        type="text"
                        value={htmlMode === 'url' ? webFileName : htmlMode === 'webm' ? webmFileName : htmlFileName}
                        onChange={(e) => htmlMode === 'url' ? setWebFileName(e.target.value) : htmlMode === 'webm' ? setWebmFileName(e.target.value) : setHtmlFileName(e.target.value)}
                        placeholder={htmlMode === 'url' ? 'Web_pagina' : htmlMode === 'webm' ? (webSrcFile?.name || 'video').replace(/\.[^.]+$/, '') : `HTML_${(htmlSrcFile?.name || 'animacion').replace(/\.[^.]+$/, '')}`}
                        disabled={htmlBusy}
                        className="w-full bg-gray-900/40 border border-gray-700 rounded-lg p-2 text-xs text-white outline-none focus:ring-1 focus:ring-emerald-400"
                      />
                    </div>

                    {/* Resolución (no aplica al transcode de un vídeo existente) */}
                    {htmlMode !== 'webm' && (
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.html2mp4.resolution')}</label>
                      <Select value={htmlResolution} onValueChange={(v) => setHtmlResolution(v as any)}>
                        <SelectTrigger className="bg-gray-900/40 border-gray-700 text-gray-200 text-xs h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1920x1080">{t('videoEditor.html2mp4.resHorizontal')}</SelectItem>
                          <SelectItem value="1280x720">{t('videoEditor.html2mp4.res720p')}</SelectItem>
                          <SelectItem value="1080x1920">{t('videoEditor.html2mp4.resVertical')}</SelectItem>
                          <SelectItem value="1080x1080">{t('videoEditor.html2mp4.resSquare')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    )}

                    {/* Duración / Velocidad / FPS (no aplican al transcode) */}
                    {htmlMode !== 'webm' && (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.html2mp4.duration')}</label>
                        <input
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={htmlDuration}
                          onChange={(e) => setHtmlDuration(Math.max(0.5, Number(e.target.value) || 0.5))}
                          className="w-full bg-gray-900/40 border border-gray-700 text-gray-200 text-xs h-9 rounded-md px-2 outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.html2mp4.speed')}</label>
                        <input
                          type="number"
                          min={0.05}
                          step={0.05}
                          value={htmlSpeed}
                          onChange={(e) => setHtmlSpeed(Math.max(0.05, Number(e.target.value) || 1))}
                          className="w-full bg-gray-900/40 border border-gray-700 text-gray-200 text-xs h-9 rounded-md px-2 outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.html2mp4.fps')}</label>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          step={1}
                          value={htmlFps}
                          onChange={(e) => setHtmlFps(Math.min(60, Math.max(1, Number(e.target.value) || 30)))}
                          className="w-full bg-gray-900/40 border border-gray-700 text-gray-200 text-xs h-9 rounded-md px-2 outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                    )}

                    {htmlError && (
                      <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{htmlError}</div>
                    )}

                    {htmlBusy && (
                      <div className="space-y-1.5">
                        <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.max(2, Math.min(100, htmlProgress))}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400 text-center">{t('videoEditor.html2mp4.convertingPct', { progress: Math.round(htmlProgress) })}</p>
                      </div>
                    )}

                    <Button
                      type="button"
                      onClick={() => htmlMode === 'webm' ? handleWebToMp4() : handleHtmlToMp4()}
                      disabled={htmlBusy || (htmlMode === 'url' ? !webUrl.trim() : htmlMode === 'webm' ? !webSrcFile : !htmlSrcFile)}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
                    >
                      {htmlBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : (htmlMode === 'url' ? <Globe className="w-4 h-4" /> : htmlMode === 'webm' ? <FileVideo className="w-4 h-4" /> : <Code2 className="w-4 h-4" />)}
                      {htmlBusy ? t('videoEditor.html2mp4.converting') : (htmlMode === 'url' ? t('videoEditor.html2mp4.convertWeb') : htmlMode === 'webm' ? t('videoEditor.html2mp4.convertVideo') : t('videoEditor.html2mp4.convert'))}
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="font-editor" className="mt-0 outline-none animate-in fade-in slide-in-from-right-2 duration-300">
                  <FontPreview
                    style={customFontStyle}
                    onChange={(updates) => setCustomFontStyle(prev => ({ ...prev, ...updates }))}
                    savedTexts={savedTextPresets}
                    onSaveText={handleSaveCurrentTextPreset}
                    onUseCurrentText={() => applyTextPreset(customFontStyle)}
                    onUseSavedText={handleUseSavedTextPreset}
                    onDeleteSavedText={handleDeleteSavedTextPreset}
                  />
                </TabsContent>

                <TabsContent value="library" className="mt-0 outline-none animate-in fade-in duration-300 space-y-4">
                  <div className="rounded-xl bg-gray-800/60 border border-emerald-500/30 p-4">
                    <h4 className="text-sm font-bold text-emerald-400 flex items-center gap-2 mb-4">
                      <Sparkles className="w-4 h-4" />
                      {t('videoEditor.library.effectsTitle')}
                    </h4>
                    <p className="text-xs text-gray-400 mb-4">{t('videoEditor.library.effectsDesc')}</p>
                    <div className="flex flex-wrap gap-2 mb-4">
                      <input
                        ref={createEffectInputRef}
                        type="file"
                        accept="image/*,video/mp4,video/webm,video/quicktime,.gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const defaultName = file.name.replace(/\.[^/.]+$/, '');
                          let name = defaultName;
                          try {
                            if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
                              const result = window.prompt(t('videoEditor.library.effectNamePrompt'), defaultName);
                              if (result !== null) name = result.trim() || defaultName;
                            }
                          } catch (e) {
                            console.warn('window.prompt no soportado');
                          }
                          setIsCreatingEffect(true);
                          createCustomEffectFromFile(
                            file,
                            name,
                            () => {
                              setCustomEffectsVersion((v) => v + 1);
                              setIsCreatingEffect(false);
                              alert(t('videoEditor.library.effectCreated'));
                            },
                            (err) => {
                              setIsCreatingEffect(false);
                              alert(err);
                            }
                          );
                          e.target.value = '';
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-emerald-500/60 text-emerald-400 hover:bg-emerald-500/20 gap-2"
                        onClick={() => createEffectInputRef.current?.click()}
                        disabled={isCreatingEffect}
                      >
                        {isCreatingEffect ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {t('videoEditor.library.createEffect')}
                      </Button>
                      {slides.some((s) => s.overlayEffectId) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-gray-600 text-gray-400 hover:bg-gray-700"
                          onClick={() => {
                            setSlides((prev) => prev.map((s) => ({ ...s, overlayEffectId: null })));
                          }}
                        >
                          {t('videoEditor.library.removeAllSlideEffects')}
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {getAllEffects().map((eff) => (
                        <div
                          key={eff.id}
                          className="rounded-lg bg-gray-900/80 border border-gray-700 overflow-hidden hover:border-emerald-500/50 transition-colors relative"
                        >
                          {eff.id.startsWith('custom-') && (
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(t('videoEditor.library.deleteEffectConfirm', { name: eff.name }))) {
                                  removeCustomEffectAndSave(eff.id);
                                  setCustomEffectsVersion((v) => v + 1);
                                }
                              }}
                              className="absolute top-1 right-1 z-10 p-1.5 bg-black/70 hover:bg-red-500 rounded-lg text-white transition-colors"
                              title={t('videoEditor.library.deleteEffect')}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <div className="aspect-video relative bg-black flex items-center justify-center">
                            <img
                              src={eff.getDataUrl(320, 180)}
                              alt=""
                              className="w-full h-full object-cover opacity-80"
                            />
                          </div>
                          <div className="p-2">
                            <p className="text-xs font-medium text-white truncate">{eff.name}</p>
                            <div className="mt-2 mb-2">
                              <label className="text-[10px] text-gray-400 block mb-1">{t('videoEditor.library.applyToSlides')}</label>
                              <select
                                value={libraryEffectTarget === 'all' || (typeof libraryEffectTarget === 'number' && libraryEffectTarget >= slides.length) ? 'all' : String(libraryEffectTarget)}
                                onChange={(e) => setLibraryEffectTarget(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-white text-[10px] outline-none focus:ring-1 focus:ring-emerald-500"
                              >
                                <option value="all">{t('videoEditor.library.all')}</option>
                                {slides.map((_, i) => (
                                  <option key={i} value={i}>{t('videoEditor.library.onlySlide', { n: i + 1 })}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex flex-col gap-2 mt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full text-[10px] h-8 px-2 border-gray-600 text-gray-300 hover:bg-gray-700"
                                onClick={() => {
                                  if (slides.length === 0) {
                                    alert(t('videoEditor.library.noSlidesAlert'));
                                    return;
                                  }
                                  setSlides((prev) =>
                                    libraryEffectTarget === 'all'
                                      ? prev.map((s) => ({ ...s, overlayEffectId: eff.id }))
                                      : prev.map((s, i) => (i === libraryEffectTarget ? { ...s, overlayEffectId: eff.id } : s))
                                  );
                                  const targetLabel = libraryEffectTarget === 'all' ? t('videoEditor.library.allSlides') : t('videoEditor.library.slideN', { n: libraryEffectTarget + 1 });
                                  alert(t('videoEditor.library.effectApplied', { name: eff.name, target: targetLabel }));
                                }}
                              >
                                {libraryEffectTarget === 'all' ? t('videoEditor.library.applyAll') : t('videoEditor.library.applySlideN', { n: libraryEffectTarget + 1 })}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full text-[10px] h-8 px-2 border-gray-600 text-gray-300 hover:bg-gray-700"
                                onClick={() => {
                                  const currentTime = editState.timeline?.currentTime ?? 0;
                                  const dataUrl = eff.getDataUrl();
                                  handleAddEffectClip({
                                    type: 'video',
                                    startTime: currentTime,
                                    duration: 3,
                                    mediaFileId: dataUrl,
                                    thumbnailUrl: dataUrl,
                                    label: t('videoEditor.library.effectPrefix', { name: eff.name }),
                                    opacity: 0.8,
                                    overlayTint: undefined
                                  });
                                }}
                              >
                                {t('videoEditor.library.addToTimeline')}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-800/60 border border-blue-500/30 p-4">
                    <h4 className="text-sm font-bold text-blue-300 flex items-center gap-2 mb-4">
                      <Layers className="w-4 h-4" />
                      {t('videoEditor.library.objectsTitle')}
                    </h4>
                    <p className="text-xs text-gray-400 mb-4">
                      {t('videoEditor.library.objectsDesc')}
                    </p>
                    <input
                      ref={createOverlayObjectInputRef}
                      type="file"
                      accept="image/png,image/gif,.png,.gif,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const defaultName = file.name.replace(/\.[^/.]+$/, '');
                        let name = defaultName;
                        try {
                          if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
                            const result = window.prompt(t('videoEditor.library.objectNamePrompt'), defaultName);
                            if (result !== null) name = result.trim() || defaultName;
                          }
                        } catch (e) {
                          console.warn('window.prompt no soportado');
                        }
                        setIsCreatingOverlayObject(true);
                        createOverlayObjectFromFile(
                          file,
                          name,
                          () => {
                            setOverlayObjectsVersion((v) => v + 1);
                            setIsCreatingOverlayObject(false);
                            alert(t('videoEditor.library.objectSaved'));
                          },
                          (err) => {
                            setIsCreatingOverlayObject(false);
                            alert(err);
                          }
                        );
                        e.target.value = '';
                      }}
                    />
                    <div className="mb-4 flex flex-col gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-blue-500/60 text-blue-300 hover:bg-blue-500/20 gap-2 w-full"
                        onClick={() => {
                          setUseDeformableObjectOverlay(true);
                          createOverlayObjectInputRef.current?.click();
                        }}
                        disabled={isCreatingOverlayObject}
                      >
                        {isCreatingOverlayObject ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {t('videoEditor.library.createDeformable')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-purple-500/60 text-purple-300 hover:bg-purple-500/20 gap-2 w-full"
                        onClick={() => {
                          setUseDeformableObjectOverlay(false);
                          createOverlayObjectInputRef.current?.click();
                        }}
                        disabled={isCreatingOverlayObject}
                      >
                        {isCreatingOverlayObject ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {t('videoEditor.library.createObject')}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {getOverlayObjects().map((asset) => (
                        <div
                          key={asset.id}
                          className="rounded-lg bg-gray-900/80 border border-gray-700 overflow-hidden hover:border-blue-400/50 transition-colors relative"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(t('videoEditor.library.deleteObjectConfirm', { name: asset.name }))) {
                                removeOverlayObjectAndSave(asset.id);
                                setOverlayObjectsVersion((v) => v + 1);
                              }
                            }}
                            className="absolute top-1 right-1 z-10 p-1.5 bg-black/70 hover:bg-red-500 rounded-lg text-white transition-colors"
                            title={t('videoEditor.library.deleteObject')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <div className="aspect-video relative bg-[linear-gradient(45deg,#111_25%,#1f2937_25%,#1f2937_50%,#111_50%,#111_75%,#1f2937_75%,#1f2937_100%)] bg-[length:16px_16px] flex items-center justify-center p-3">
                            {asset.mediaType === 'video' ? (
                              <video
                                src={asset.dataUrl}
                                muted
                                loop
                                autoPlay
                                playsInline
                                preload="metadata"
                                className="max-w-full max-h-full object-contain pointer-events-none"
                              />
                            ) : (
                              <img
                                src={asset.dataUrl}
                                alt={asset.name}
                                className="max-w-full max-h-full object-contain"
                              />
                            )}
                          </div>
                          <div className="p-2 space-y-2">
                            <p className="text-xs font-medium text-white truncate">{asset.name}</p>
                            <div className="text-[10px] text-gray-400 uppercase">{asset.mediaType}</div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full text-[10px] h-8 px-2 border-gray-600 text-gray-300 hover:bg-gray-700"
                              onClick={() => handleAddObjectClip(asset, useDeformableObjectOverlay)}
                            >
                              {t('videoEditor.library.addToProject')}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {getOverlayObjects().length === 0 && (
                      <div className="mt-4 rounded-lg border border-dashed border-gray-700 p-6 text-center text-sm text-gray-500">
                        {t('videoEditor.library.noObjects')}
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="ltx" className="mt-0 outline-none animate-in fade-in duration-300 space-y-4">
                  <div className="rounded-xl bg-gray-800/60 border border-emerald-500/30 p-4 space-y-3">
                    <h4 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                      <Film className="w-4 h-4" />
                      {t('videoEditor.ltx.title')}
                    </h4>
                    <p className="text-[11px] text-gray-400 leading-snug">
                      {t('videoEditor.ltx.desc')}
                    </p>

                    {/* Modo: Imagen-a-vídeo / Texto-a-vídeo */}
                    <div className="flex gap-1 bg-gray-950/50 p-1 rounded-lg border border-gray-700/50">
                      <button
                        onClick={() => setLtxMode('i2v')}
                        className={`flex-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1.5 rounded transition-all ${ltxMode === 'i2v' ? 'bg-emerald-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                      >
                        {t('videoEditor.ltx.modeI2v')}
                      </button>
                      <button
                        onClick={() => setLtxMode('t2v')}
                        className={`flex-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1.5 rounded transition-all ${ltxMode === 't2v' ? 'bg-emerald-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                      >
                        {t('videoEditor.ltx.modeT2v')}
                      </button>
                    </div>

                    {/* Servidores */}
                    <div className="flex items-center gap-2 bg-gray-950/50 p-2 rounded-lg border border-gray-700/50">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${ltxServerStatus.comfyui ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'}`} />
                        <span className="text-[9px] text-gray-400">{t('videoEditor.selection.sam2Comfyui')}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${ltxServerStatus.fluxBridge ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'}`} />
                        <span className="text-[9px] text-gray-400">{t('videoEditor.selection.sam2Bridge')}</span>
                      </div>
                      <button
                        onClick={handleStartLtxServers}
                        disabled={isStartingLtxServers || (ltxServerStatus.comfyui && ltxServerStatus.fluxBridge)}
                        className="ml-auto text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-emerald-500/30"
                      >
                        {isStartingLtxServers ? t('videoEditor.selection.sam2Starting') : ltxServerStatus.comfyui && ltxServerStatus.fluxBridge ? t('videoEditor.selection.sam2Ready') : t('videoEditor.selection.sam2StartServers')}
                      </button>
                      <button
                        onClick={handleRestartBridge}
                        disabled={isStartingLtxServers}
                        title={t('videoEditor.selection.sam2RestartBridgeTitle')}
                        className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-gray-700/40 text-gray-300 hover:bg-gray-600/60 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-gray-600/40"
                      >
                        {t('videoEditor.selection.sam2RestartBridge')}
                      </button>
                    </div>
                    {ltxServerMessage && (
                      <p className={`text-[9px] uppercase tracking-wider ${ltxServerMessage.includes('listos') ? 'text-green-400' : ltxServerMessage.includes('Error') ? 'text-red-400' : 'text-emerald-300'}`}>
                        {ltxServerMessage}
                      </p>
                    )}

                    {/* Workflow JSON */}
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.ltx.workflowLabel')}</label>
                      <input
                        type="file"
                        accept=".json,application/json"
                        onChange={(e) => handleLtxWorkflowFile(e.target.files)}
                        className="text-[10px] text-gray-300 w-full"
                      />
                      {ltxWorkflowJson && (
                        <p className="text-[9px] text-green-400 uppercase tracking-wider">{t('videoEditor.ltx.workflowLoaded', { name: ltxWorkflowName })}</p>
                      )}
                    </div>

                    {/* Prompt */}
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.ltx.prompt')}</label>
                      <textarea
                        value={ltxPrompt}
                        onChange={(e) => setLtxPrompt(e.target.value)}
                        placeholder={t('videoEditor.ltx.promptPh')}
                        className="w-full bg-transparent border border-gray-700 rounded-lg p-2 text-xs text-white outline-none focus:ring-1 focus:ring-emerald-400 resize-none h-20"
                      />
                      <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.ltx.negative')}</label>
                      <textarea
                        value={ltxNegative}
                        onChange={(e) => setLtxNegative(e.target.value)}
                        placeholder={t('videoEditor.ltx.negativePh')}
                        className="w-full bg-transparent border border-gray-700 rounded-lg p-2 text-xs text-white outline-none focus:ring-1 focus:ring-emerald-400 resize-none h-14"
                      />
                    </div>

                    {/* Imagen de entrada (solo i2v) */}
                    {ltxMode === 'i2v' && (
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.ltx.inputImage')}</label>
                      <div className="flex gap-2">
                        <input type="file" accept="image/*" onChange={(e) => handleLtxImageFile(e.target.files)} className="text-[10px] text-gray-300 flex-1" />
                        <button
                          onClick={captureCurrentPreviewFrame}
                          className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 border border-emerald-500/30 whitespace-nowrap"
                          title={t('videoEditor.ltx.captureFrameTitle')}
                        >
                          {t('videoEditor.ltx.captureFrame')}
                        </button>
                      </div>
                      {ltxImagePreviewUrl && (
                        <div className="w-full rounded-lg overflow-hidden border border-gray-700 bg-black flex items-center justify-center">
                          <img src={ltxImagePreviewUrl} alt="Entrada LTX" className="max-w-full max-h-40 object-contain" />
                        </div>
                      )}
                    </div>
                    )}

                    {/* Nodo switch texto-a-vídeo (solo t2v) */}
                    {ltxMode === 't2v' && (
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.ltx.t2vSwitch')}</label>
                        {renderLtxNodeSelect(ltxT2vSwitchNode, setLtxT2vSwitchNode, ltxNodeCandidates.boolean, t('videoEditor.ltx.nodePlaceholder'), 'boolean')}
                        <p className="text-[9px] text-gray-500 leading-snug normal-case tracking-normal">{t('videoEditor.ltx.t2vHelp1')} <span className="text-gray-400">{t('videoEditor.ltx.t2vHelpYour')}</span> {t('videoEditor.ltx.t2vHelp2')}</p>
                      </div>
                    )}

                    {/* IDs de nodos — los IDs dependen de TU workflow (cambian en cada export).
                        Al hacer clic en cada campo aparecen los nodos detectados en tu archivo. */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase text-gray-400 tracking-wider">{t('videoEditor.ltx.nodePrompt')}</label>
                        {renderLtxNodeSelect(ltxPromptNode, setLtxPromptNode, ltxNodeCandidates.text, t('videoEditor.ltx.nodePlaceholder'), 'prompt')}
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase text-gray-400 tracking-wider">{t('videoEditor.ltx.nodeNegative')}</label>
                        {renderLtxNodeSelect(ltxNegativeNode, setLtxNegativeNode, ltxNodeCandidates.text, t('videoEditor.ltx.nodePlaceholder'), 'negative')}
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase text-gray-400 tracking-wider">{t('videoEditor.ltx.nodeSeed')}</label>
                        {renderLtxNodeSelect(ltxSeedNode, setLtxSeedNode, ltxNodeCandidates.seed, t('videoEditor.ltx.nodePlaceholder'), 'seed')}
                      </div>
                      {ltxMode === 'i2v' && (
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase text-gray-400 tracking-wider">{t('videoEditor.ltx.nodeLoadImage')}</label>
                        {renderLtxNodeSelect(ltxImageNode, setLtxImageNode, ltxNodeCandidates.image, t('videoEditor.ltx.nodePlaceholder'), 'image')}
                      </div>
                      )}
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase text-gray-400 tracking-wider">{t('videoEditor.ltx.seed')}</label>
                        <div className="flex gap-1">
                          <input type="number" min={0} value={ltxSeed} onChange={(e) => setLtxSeed(parseInt(e.target.value) || 0)} className="w-full bg-transparent border border-gray-700 rounded-lg p-1.5 text-xs text-white outline-none focus:ring-1 focus:ring-emerald-400" />
                          <button onClick={() => setLtxSeed(Math.floor(Math.random() * 1e9))} className="text-[9px] px-2 rounded bg-gray-700 text-gray-300 hover:bg-gray-600" title={t('videoEditor.ltx.random')}>⟳</button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 pt-1">
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase text-gray-400 tracking-wider">{t('videoEditor.ltx.durationOpt')}</label>
                        <div className="flex gap-1">
                          {renderLtxNodeSelect(ltxDurationNode, setLtxDurationNode, ltxNodeCandidates.frames, t('videoEditor.ltx.nodeFrames'))}
                          <input type="number" min={0} step={1} value={ltxDuration || ''} onChange={(e) => setLtxDuration(parseInt(e.target.value) || 0)} placeholder={t('videoEditor.ltx.secPh')} className="w-24 bg-transparent border border-gray-700 rounded-lg p-1.5 text-[10px] text-white outline-none focus:ring-1 focus:ring-emerald-400" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase text-gray-400 tracking-wider">{t('videoEditor.ltx.fpsOpt')}</label>
                        <div className="flex gap-1">
                          {renderLtxNodeSelect(ltxFpsNode, setLtxFpsNode, ltxNodeCandidates.fps, t('videoEditor.ltx.nodeFps'))}
                          <input type="number" min={0} value={ltxFps || ''} onChange={(e) => setLtxFps(parseInt(e.target.value) || 0)} placeholder={t('videoEditor.ltx.fpsPh')} className="w-24 bg-transparent border border-gray-700 rounded-lg p-1.5 text-[10px] text-white outline-none focus:ring-1 focus:ring-emerald-400" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase text-gray-400 tracking-wider">{t('videoEditor.ltx.cropOpt')}</label>
                        <div className="flex gap-1">
                          {renderLtxNodeSelect(ltxWidthNode, setLtxWidthNode, ltxNodeCandidates.width, t('videoEditor.ltx.nodeWidth'))}
                          <input type="number" min={0} value={ltxWidth || ''} onChange={(e) => setLtxWidth(parseInt(e.target.value) || 0)} placeholder={t('videoEditor.ltx.widthPh')} className="w-24 bg-transparent border border-gray-700 rounded-lg p-1.5 text-[10px] text-white outline-none focus:ring-1 focus:ring-emerald-400" />
                        </div>
                        <div className="flex gap-1">
                          {renderLtxNodeSelect(ltxHeightNode, setLtxHeightNode, ltxNodeCandidates.height, t('videoEditor.ltx.nodeHeight'))}
                          <input type="number" min={0} value={ltxHeight || ''} onChange={(e) => setLtxHeight(parseInt(e.target.value) || 0)} placeholder={t('videoEditor.ltx.heightPh')} className="w-24 bg-transparent border border-gray-700 rounded-lg p-1.5 text-[10px] text-white outline-none focus:ring-1 focus:ring-emerald-400" />
                        </div>
                      </div>
                      <p className="text-[9px] text-gray-500 leading-snug normal-case tracking-normal">{t('videoEditor.ltx.framesHelp1')} <span className="text-gray-400">{t('videoEditor.ltx.framesHelpFormula')}</span> {t('videoEditor.ltx.framesHelp2')} <span className="text-gray-400">{t('videoEditor.ltx.framesHelpNode')}</span> {t('videoEditor.ltx.framesHelp3')}</p>
                    </div>

                    {ltxError && <p className="text-[9px] text-red-400 uppercase tracking-wider">{ltxError}</p>}

                    {/* Nombre del archivo de salida */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase text-gray-400 tracking-wider">{t('videoEditor.html2mp4.fileNameLabel')}</label>
                      <input
                        type="text"
                        value={ltxFileName}
                        onChange={(e) => setLtxFileName(e.target.value)}
                        placeholder={`LTX_${(ltxPrompt.slice(0, 24) || 'video').replace(/[^\w\-]+/g, '_').slice(0, 24) || 'ltx'}`}
                        disabled={isGeneratingLtx}
                        className="w-full bg-gray-900/40 border border-gray-700 rounded-lg p-2 text-xs text-white outline-none focus:ring-1 focus:ring-emerald-400"
                      />
                    </div>

                    <Button
                      onClick={() => generateLtxVideo()}
                      disabled={isGeneratingLtx}
                      className="w-full h-11 bg-emerald-500 hover:bg-emerald-400 text-black font-black uppercase tracking-[0.2em]"
                    >
                      {isGeneratingLtx ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Sparkles className="w-5 h-5 mr-2" />}
                      {isGeneratingLtx
                        ? t('videoEditor.ltx.generatingPct', { percent: ltxProgress?.percent ?? 0 })
                        : t('videoEditor.ltx.generateBtn')}
                    </Button>
                    {isGeneratingLtx && (
                      <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-emerald-400 h-1.5 rounded-full transition-all duration-500" style={{ width: `${ltxProgress?.percent ?? 0}%` }} />
                      </div>
                    )}
                    <p className="text-[8px] text-gray-500 uppercase tracking-[0.3em] mt-1 text-center">{t('videoEditor.ltx.endpointInfo', { mode: ltxMode === 'i2v' ? t('videoEditor.ltx.modeI2vShort') : t('videoEditor.ltx.modeT2vShort') })}</p>
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Contenedor inferior - Timeline con redimensionamiento */}
      <div
        className="bg-gray-900 border-t border-gray-800 flex flex-col overflow-visible z-20 relative"
        style={{ height: `${timelineHeight}px` }}
      >
        {/* Manija para redimensionar: solo la línea es clickable para no bloquear campos de texto */}
        <div
          className="absolute -top-2 left-0 right-0 h-4 z-[100] group pointer-events-none"
          aria-hidden
        >
          {/* Solo esta franja recibe clics (línea de 6px en el borde del timeline) */}
          <div
            className="absolute bottom-0 left-0 right-0 h-[6px] cursor-row-resize pointer-events-auto"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsResizingTimeline(true);
            }}
          >
            <div className={`w-full h-[2px] mt-1 transition-colors duration-200 ${isResizingTimeline ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]' : 'bg-transparent group-hover:bg-emerald-500/50'}`} />
          </div>
        </div>

        <div className="flex-1 relative">
          {editState.timeline && (
            <div className="absolute inset-0">
              <Timeline
                timeline={editState.timeline}
                onTimelineChange={handleTimelineChange}
                 onAddTrack={handleAddTrack}
                 onAddEffectsTrack={handleAddEffectsTrack}
                onAddClip={handleAddClip}
                onUpdateClip={handleUpdateClip}
                onDeleteClip={handleDeleteClip}
                onDeleteTrack={handleDeleteTrack}
                onSnapToStart={handleSnapToStart}
                onSplitClip={handleSplitClip}
                onMergeClips={handleMergeClips}
                onStretchZone={handleStretchZone}
                onCopyClip={handleCopyClip}
                onPasteClip={handlePasteClip}
                onSeparateAudio={handleSeparateAudio}
                onUndo={handleUndo}
                onRedo={handleRedo}
                canUndo={history.length > 0}
                canRedo={future.length > 0}
                onSeek={(time) => {
                  seekPreviewTo(time);
                  handleTimelineTimeUpdate(time);
                }}
                onPlayPause={handleTimelinePlayPause}
                onLoopToggle={() => setIsLoopEnabled(!isLoopEnabled)}
                isLoopEnabled={isLoopEnabled}
                useSimplePlayer={useSimplePlayer}
                onUseSimplePlayerChange={setUseSimplePlayer}
                autoScrollToPlayhead={true}
              />
            </div>
          )}
        </div>
      </div>

       {/* TimelinePlayer para manejar la reproducción (audio clips + timing) */}
      {editState.timeline && (
        <TimelinePlayer
          timeline={editState.timeline}
          currentTime={editState.timeline.currentTime}
          isPlaying={isTimelinePlaying}
          audioContext={audioContext}
          masterOutput={masterOutput}
          resetToStartOnEnd
          loop={isLoopEnabled}
          onReachedEnd={() => setIsTimelinePlaying(false)}
          onTimeUpdate={handleTimelineTimeUpdate}
          fileCache={fileCache}
          previewTimeRef={previewTimeRef}
        />
      )}

      {/* Modal para añadir recurso (PocketBase: colección → registro → archivo) */}
      {isUploaderOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <h3 className="text-xl font-semibold text-white">
                  {pbLoadStep === 'collection' && t('videoEditor.timeline.selectCollection')}
                  {pbLoadStep === 'record' && t('videoEditor.timeline.selectRecord')}
                  {pbLoadStep === 'file' && t('videoEditor.timeline.selectFile')}
                  {pbLoadStep === 'local' && t('videoEditor.timeline.filesOfType', { type: uploadType === 'image' ? t('videoEditor.timeline.imagesLower') : uploadType === 'audio' ? t('videoEditor.timeline.audiosLower') : t('videoEditor.timeline.videosLower') })}
                </h3>

                {/* Selector de modo de vista (Para Local, Registros y Archivos) */}
                {pbLoadStep !== 'collection' && (
                  <div className="flex items-center space-x-1 bg-gray-800 rounded-lg p-1 border border-gray-700">
                    <button
                      onClick={() => setResourceViewMode('grid')}
                      className={`p-1.5 rounded transition-all ${resourceViewMode === 'grid' ? 'bg-emerald-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                      title="Vista cuadrícula"
                    >
                      <Grid3x3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setResourceViewMode('list')}
                      className={`p-1.5 rounded transition-all ${resourceViewMode === 'list' ? 'bg-emerald-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                      title="Vista lista"
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setIsUploaderOpen(false);
                  setPbLoadStep('collection');
                  setSelectedPbRecordFiles(null);
                  setSelectedPbCollection(null);
                  setFileNotAllowedMessage(null);
                  setLocalFolderFiles([]);
                }}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              {t('videoEditor.addType', { type: uploadType === 'video' ? t('videoEditor.mediaVideo') : uploadType === 'audio' ? t('videoEditor.mediaAudio') : t('videoEditor.mediaImage') })}
            </p>
            {fileNotAllowedMessage && (
              <div className="mb-3 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
                {fileNotAllowedMessage}
              </div>
            )}

            {pbLoadStep === 'local' && (
              <>
                {pbLoading && <p className="text-center py-8 text-gray-500 italic flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> {t('videoEditor.scanningLocation')}
                </p>}
                {!pbLoading && localFolderFiles.length === 0 && <p className="text-center py-8 text-gray-500 italic">No se encontraron archivos en la ubicación configurada.</p>}

                {resourceViewMode === 'grid' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                    {localFolderFiles.map((f, i) => (
                      <div
                        key={i}
                        className="group flex flex-col gap-2 p-3 bg-gray-800/50 border border-gray-700/50 rounded-xl hover:bg-emerald-500/10 hover:border-emerald-500/30 cursor-pointer transition-all duration-200"
                        onClick={() => addMediaFileToTimeline(f)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-gray-900 group-hover:bg-emerald-500/20 transition-colors">
                            {uploadType === 'video' && <FileVideo className="w-5 h-5 text-blue-400 group-hover:text-emerald-400" />}
                            {uploadType === 'audio' && <Music className="w-5 h-5 text-green-400 group-hover:text-emerald-400" />}
                            {uploadType === 'image' && <FileImage className="w-5 h-5 text-purple-400 group-hover:text-emerald-400" />}
                          </div>
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="truncate text-sm font-medium text-gray-200 group-hover:text-white">
                              {cleanDisplayFileName(f.name || f.fileName || 'Archivo')}
                            </span>
                            <span className="truncate uppercase tracking-wider text-[10px] text-gray-500">
                              {(f.name || f.fileName || '').split('.').pop()}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 mt-2">
                    {localFolderFiles.map((f, i) => (
                      <div
                        key={i}
                        className="group flex items-center justify-between p-3 bg-gray-800/30 border border-gray-700/30 rounded-xl hover:bg-emerald-500/10 hover:border-emerald-500/30 cursor-pointer transition-all duration-200"
                        onClick={() => addMediaFileToTimeline(f)}
                      >
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className="p-2 rounded-lg bg-gray-900 group-hover:bg-emerald-500/20 transition-colors shrink-0">
                            {uploadType === 'video' && <FileVideo className="w-4 h-4 text-blue-400 group-hover:text-emerald-400" />}
                            {uploadType === 'audio' && <Music className="w-4 h-4 text-green-400 group-hover:text-emerald-400" />}
                            {uploadType === 'image' && <FileImage className="w-4 h-4 text-purple-400 group-hover:text-emerald-400" />}
                          </div>
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="truncate text-sm font-medium text-gray-200 group-hover:text-white">
                              {cleanDisplayFileName(f.name || f.fileName || 'Archivo')}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="truncate uppercase tracking-wider text-[9px] text-gray-500 font-bold">
                                {(f.name || f.fileName || '').split('.').pop()}
                              </span>
                              <span className="w-1 h-1 rounded-full bg-gray-700" />
                              <span className="text-[9px] text-gray-600 italic truncate">
                                {f.path || ''}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Plus className="w-4 h-4 text-emerald-500" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {pbLoadStep === 'record' && (
              <button
                type="button"
                onClick={() => {
                  setPbLoadStep('collection');
                  setSelectedPbCollection(null);
                  setPbRecords([]);
                }}
                className="flex items-center gap-2 text-gray-400 hover:text-white mb-3"
              >
                <ChevronLeft className="w-4 h-4" /> Volver a colecciones
              </button>
            )}
            {pbLoadStep === 'file' && (
              <button
                type="button"
                onClick={() => {
                  setPbLoadStep('record');
                  setSelectedPbRecordFiles(null);
                }}
                className="flex items-center gap-2 text-gray-400 hover:text-white mb-3"
              >
                <ChevronLeft className="w-4 h-4" /> Volver a registros
              </button>
            )}
            {pbLoadStep === 'collection' && (
              <>
                {pbLoading && pbCollections.length === 0 && <p className="text-center py-8 text-gray-500">Cargando colecciones...</p>}
                {!pbLoading && pbCollections.length === 0 && <p className="text-center py-8 text-gray-500">No hay colecciones.</p>}
                {pbCollections.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 p-4 bg-gray-800 rounded-xl hover:bg-gray-700 cursor-pointer mb-2"
                    onClick={() => fetchPbRecordsForCollection(c.name)}
                  >
                    <Folder className="w-5 h-5 text-amber-500" />
                    <span className="font-medium text-white">{c.name}</span>
                  </div>
                ))}
              </>
            )}
            {pbLoadStep === 'record' && (
              <>
                {pbLoading && pbRecords.length === 0 && <p className="text-center py-8 text-gray-500">Cargando registros...</p>}
                {!pbLoading && pbRecords.length === 0 && <p className="text-center py-8 text-gray-500">No hay registros con este tipo de archivo.</p>}
                {pbRecords.map((r) => (
                  <div
                    key={r.recordId}
                    className="flex items-center gap-3 p-4 bg-gray-800 rounded-xl hover:bg-gray-700 cursor-pointer mb-2"
                    onClick={() => selectPbRecordForFiles(r)}
                  >
                    {uploadType === 'video' && <FileVideo className="w-5 h-5 text-blue-400" />}
                    {uploadType === 'audio' && <FileAudio className="w-5 h-5 text-green-400" />}
                    {uploadType === 'image' && <FileImage className="w-5 h-5 text-purple-400" />}
                    <div>
                      <span className="font-medium text-white">{r.recordName}</span>
                      <p className="text-[10px] text-gray-500">{r.files.length} archivo(s)</p>
                    </div>
                  </div>
                ))}
              </>
            )}
            {pbLoadStep === 'file' && selectedPbRecordFiles && (
              <>
                {selectedPbRecordFiles.length === 0 && <p className="text-center py-8 text-gray-500">No hay archivos en este registro.</p>}
                {selectedPbRecordFiles.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-4 bg-gray-800 rounded-xl hover:bg-gray-700 cursor-pointer mb-2"
                    onClick={() => addOneClipFromPb(f)}
                  >
                    {uploadType === 'video' && <FileVideo className="w-5 h-5 text-blue-400" />}
                    {uploadType === 'audio' && <Music className="w-5 h-5 text-green-400" />}
                    {uploadType === 'image' && <FileImage className="w-5 h-5 text-purple-400" />}
                    <span className="font-medium text-white truncate">{cleanDisplayFileName(f.fileName)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* Diálogo de configuración de exportación */}
      {showExportDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-xl p-6 max-w-lg w-full border border-gray-700">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                <Save className="w-5 h-5" />
                Configurar Exportación
              </h3>
              <button
                onClick={() => setShowExportDialog(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Nombre del archivo / Título en la base de datos */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('videoEditor.exportTitleLabel')}
              </label>
              <input
                type="text"
                value={exportFileName}
                onChange={(e) => setExportFileName(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="video_editado"
              />
            </div>

            {/* Formato del archivo */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Formato del archivo
              </label>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value)}
                disabled={exportTransparent}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="webm">WebM (recomendado para web)</option>
                <option value="mp4">MP4 (compatible con todos los dispositivos)</option>
              </select>
              {exportTransparent && (
                <p className="text-xs text-amber-300 mt-1">Con transparencia se usa WebM/VP9 (MP4 no admite canal alpha).</p>
              )}
            </div>

            {/* Calidad del video */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Calidad del video
              </label>
              <select
                value={exportQuality}
                onChange={(e) => setExportQuality(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="ultra">{t('videoEditor.qualityUltra')}</option>
                <option value="high">Alta (1080p, 30 FPS)</option>
                <option value="medium">Media (720p, 30 FPS)</option>
                <option value="low">Baja (480p, 25 FPS)</option>              </select>
            </div>

            {/* Exportar selección con transparencia (solo si hay selección/lazo activo) */}
            {editState.selection?.enabled && editState.selection.shape ? (
              <div className="mb-6 p-3 bg-gray-800 rounded-lg border border-gray-700">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportTransparent}
                    onChange={(e) => {
                      setExportTransparent(e.target.checked);
                      if (e.target.checked) setExportFormat('webm');
                    }}
                    className="w-4 h-4 accent-emerald-500"
                  />
                  <span className="text-sm text-gray-200 font-medium">{t('videoEditor.exportTransparency')}</span>
                </label>
                <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                  {editState.selection.scope === 'outside' ? (
                    <>Modo <span className="text-amber-300">invertido</span>: exporta el <span className="text-gray-300">fondo</span> y el <span className="text-gray-300">objeto</span> queda transparente (un agujero que sigue al objeto con SAM2). Se fuerza WebM/VP9 (MP4 no admite transparencia).</>
                  ) : (
                    <>{t('videoEditor.exportTransparencyDesc1')} <span className="text-gray-300">{t('videoEditor.exportTransparencyDesc2')}</span> (canal alpha). Se fuerza WebM/VP9 (MP4 no admite transparencia). Reproducido solo se verá negro donde no hay selección, pero al <span className="text-gray-300">sobreponerlo</span> sobre otro vídeo (pestaña Vídeo superpuesto) la zona transparente deja ver el vídeo de atrás.</>
                  )}
                </p>
                {/* Invertir selección: el objeto queda transparente, se exporta el fondo.
                    {t('videoEditor.invertSelectionDesc')}
                    también al filtro de efectos (dentro/fuera). */}
                <label className="flex items-center gap-2 cursor-pointer mt-2">
                  <input
                    type="checkbox"
                    checked={editState.selection.scope === 'outside'}
                    onChange={(e) => setSelectionScope(e.target.checked ? 'outside' : 'inside')}
                    className="w-4 h-4 accent-amber-500"
                  />
                  <span className="text-xs text-amber-300">{t('videoEditor.invertSelection')}</span>
                </label>
              </div>
            ) : null}

            {/* Información del archivo */}
            <div className="mb-6 p-3 bg-gray-800 rounded-lg">
              <div className="text-sm text-gray-400 space-y-1">
                <p>{t('videoEditor.infoBullet1')} <span className="text-white font-mono">video</span>{t('videoEditor.infoBullet1b')}</p>
                <p>{t('videoEditor.infoBullet2')}</p>
                <p>{t('videoEditor.infoBullet3')}</p>
                <p>{t('videoEditor.infoBullet4')}</p>
              </div>
            </div>

            {/* Botones de acción */}
            <div className="flex space-x-3">
              <Button
                variant="outline"
                onClick={() => setShowExportDialog(false)}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                onClick={startExportProcess}
                className="flex-1"
                disabled={!exportFileName.trim() || isExporting}
              >
                <Download className="w-4 h-4 mr-2" />
                Iniciar Exportación
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de progreso de exportación */}
      {isExporting && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-xl p-8 max-w-md w-full border border-gray-700">
            <div className="flex items-center justify-center mb-6">
              <div className="relative">
                <Loader2 className="w-16 h-16 text-blue-500 animate-spin" />
                <Film className="w-8 h-8 text-blue-300 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
              </div>
            </div>

            <h3 className="text-2xl font-bold text-white text-center mb-2">
              Exportando Video
            </h3>

            <p className="text-gray-300 text-center mb-6">
              {exportStatus}
            </p>

            {/* Barra de progreso */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400 font-medium">Progreso de renderizado</span>
                <span className="text-sm text-emerald-400 font-bold">{Math.round(exportProgress)}%</span>
              </div>
              <div className="w-full bg-gray-900 border border-white/10 rounded-full h-6 overflow-hidden shadow-inner">
                <div
                  className="bg-emerald-500 rounded-full transition-none"
                  style={{
                    width: `${Math.min(100, Math.max(0, exportProgress))}%`,
                    height: '100%',
                    minWidth: exportProgress > 0 ? '4px' : '0',
                    boxShadow: '0 0 10px rgba(16, 185, 129, 0.6)'
                  }}
                />
              </div>
            </div>

            {/* Información adicional */}
            <div className="text-center text-sm text-gray-400">
              <p>{t('videoEditor.processingFrames')}</p>
              <p>Esto puede tardar varios minutos...</p>
            </div>

            {/* Botón para cancelar (opcional) */}
            <div className="mt-6 text-center">
              <button
                onClick={() => { if (exportCancelRef.current) exportCancelRef.current(); setIsExporting(false); }}
                className="text-gray-400 hover:text-white text-sm underline"
              >
                Cancelar exportación
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para Guardar Proyecto Local Autónomo */}
      <Modal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        title="Guardar Proyecto en Carpeta Local"
        size="md"
      >
        <SaveProjectForm
          onSaveFullLocal={saveFullProjectLocal}
          onClose={() => setIsSaveModalOpen(false)}
          isSaving={isSavingProject}
        />
      </Modal>

      <Modal
        isOpen={isLoadModalOpen}
        onClose={() => setIsLoadModalOpen(false)}
        title="Cargar Proyecto Local"
        size="lg"
      >
        <div className="p-4 max-h-[80vh] overflow-hidden flex flex-col">
          <div className="flex flex-col gap-1 pb-4 mb-4 border-b border-gray-700/50">
            <p className="text-xs text-gray-400 flex items-center gap-1.5 font-medium">
              <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
              Proyectos encontrados en tu almacenamiento
            </p>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar-thin pr-1">
            {isLoadingLocalProjects ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                <p className="mt-4 text-gray-400 font-medium">Buscando proyectos locales...</p>
              </div>
            ) : localProjects.length === 0 ? (
              <div className="text-center py-16 bg-gray-800/20 rounded-3xl border border-dashed border-gray-700/50">
                <Folder className="w-16 h-16 text-gray-700 mx-auto mb-4 opacity-50" />
                <p className="text-gray-400 font-bold text-lg">No hay proyectos locales</p>
                <p className="text-xs text-gray-500 mt-2 px-12 max-w-sm mx-auto">
                  {t('videoEditor.exportHint')}
                  <span className="text-emerald-500 font-bold mx-1">Archivos</span> sea la correcta.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {localProjects.map((project, idx) => (
                  <div
                    key={project.path || idx}
                    className="flex items-center justify-between p-4 bg-gray-800/40 border border-gray-700/50 rounded-2xl hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all group cursor-pointer"
                    onClick={() => loadFullProjectLocal(project)}
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="p-3 bg-emerald-500/10 rounded-xl group-hover:bg-emerald-500/20 transition-colors shadow-inner">
                        <FolderOpen className="w-6 h-6 text-emerald-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-gray-200 group-hover:text-white transition-colors truncate text-base">
                          {project.name}
                        </h4>
                        <div className="flex items-center gap-3 mt-1.5">
                          <p className="text-[10px] text-gray-500 flex items-center gap-1.5 uppercase tracking-wider font-bold">
                            <Clock className="w-3 h-3" />
                            {new Date(project.uploadedAt || project.updated).toLocaleString()}
                          </p>
                          <span className="w-1 h-1 rounded-full bg-gray-700" />
                          <p className="text-[10px] text-emerald-500/70 font-bold uppercase tracking-widest">
                            Local Storage
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0 shadow-lg">
                        <ArrowRightLeft className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-700/50 flex justify-end">
            <Button
              variant="ghost"
              onClick={() => setIsLoadModalOpen(false)}
              className="text-gray-400 hover:text-white text-xs font-bold uppercase tracking-widest"
            >
              Cerrar
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Guardar presentación (proyecto o animación terminada) */}
      <Modal
        isOpen={presentationSaveModalOpen}
        onClose={() => !isSavingPresentation && setPresentationSaveModalOpen(false)}
        title="Guardar presentación"
        size="md"
      >
        <SavePresentationForm
          onSaveProject={(titulo) => savePresentationAsProject(titulo)}
          onSaveAnimation={(titulo) => savePresentationAsAnimation(titulo)}
          onExportVideo={(titulo) => exportPresentationAsVideo(titulo)}
          onClose={() => setPresentationSaveModalOpen(false)}
          isSaving={isSavingPresentation}
          isExporting={isExportingPresentationVideo}
          exportProgress={presentationExportProgress}
        />
      </Modal>

      {/* Modal Cargar presentación desde base de datos */}
      <Modal
        isOpen={presentationLoadModalOpen}
        onClose={() => setPresentationLoadModalOpen(false)}
        title="Cargar presentación"
        size="lg"
      >
        <div className="space-y-4 p-4 max-h-[60vh] overflow-y-auto">
          {isLoadingPresentations ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
              <p className="mt-4 text-gray-400">Buscando presentaciones y proyectos con diapositivas...</p>
            </div>
          ) : savedPresentations.length === 0 ? (
            <div className="text-center py-12">
              <Presentation className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">No hay presentaciones ni proyectos con diapositivas</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {savedPresentations.map((rec) => (
                <div
                  key={rec.id}
                  className="flex items-center justify-between p-4 bg-gray-800 border border-gray-700 rounded-xl hover:border-emerald-500 transition-all group"
                >
                  <div
                    className="flex items-center gap-4 flex-1 cursor-pointer"
                    onClick={() => loadPresentationFromRecord(rec)}
                  >
                    <div className="p-2 bg-emerald-500/20 rounded-lg">
                      <Presentation className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <h4 className="font-medium text-white group-hover:text-emerald-400 transition-colors">{rec.titulo}</h4>
                      <p className="text-xs text-gray-500 mt-1">
                        {rec._origen === 'proyecto_video' ? 'Proyecto de vídeo (diapositivas)' : rec.video ? 'Con vídeo exportado' : 'Presentación'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => deletePresentationFromPocketBase(rec.id, e, rec)}
                    className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Modal ver imagen de diapositiva (al pulsar en miniatura) */}
      {slidePreviewImageUrl && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Ver imagen"
          onClick={() => setSlidePreviewImageUrl(null)}
        >
          <button
            type="button"
            onClick={() => setSlidePreviewImageUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={slidePreviewImageUrl}
            alt="Diapositiva"
            className="max-w-full max-h-[90vh] w-auto h-auto object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Vista presentación (pantalla completa del guion IA) */}
      {presentationViewOpen && localScriptContent && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-gray-950"
          role="dialog"
          aria-modal="true"
          aria-label={t('videoEditor.viewPresentation')}
        >
          <div className="flex-none flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/90">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Presentation className="w-5 h-5 text-emerald-400" />
              {t('videoEditor.aiPresentation')}
            </h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5">
                <span className="text-[10px] uppercase font-black text-gray-500">Velocidad</span>
                <select
                  value={readingRate}
                  onChange={(e) => setReadingRate(parseFloat(e.target.value))}
                  className="bg-transparent text-white text-xs font-bold focus:outline-none cursor-pointer"
                >
                  <option value="0.5" className="bg-gray-900">0.5x</option>
                  <option value="0.8" className="bg-gray-900">0.8x</option>
                  <option value="1.0" className="bg-gray-900">1.0x</option>
                  <option value="1.2" className="bg-gray-900">1.2x</option>
                  <option value="1.5" className="bg-gray-900">1.5x</option>
                  <option value="2.0" className="bg-gray-900">2.0x</option>
                </select>
              </div>

              {isReadingScript ? (
                <div className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-2xl p-1 px-2 shadow-2xl">
                  <button
                    onClick={handlePauseResumeScript}
                    className={`p-2.5 ${isReadingPaused ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500'} text-white rounded-xl transition-all shadow-lg flex items-center justify-center`}
                    title={isReadingPaused ? "Reanudar" : "Pausar"}
                  >
                    {isReadingPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                  </button>

                  <div className="w-px h-6 bg-gray-700 mx-1" />

                  <button
                    onClick={() => handleReadScriptAloud(0)}
                    className="p-2 hover:bg-red-500/10 text-red-500 rounded-xl transition-all flex items-center gap-2 px-3"
                    title="Detener lectura"
                  >
                    <Square className="w-4 h-4 fill-red-500" />
                    <span className="text-[10px] font-black uppercase tracking-tighter text-red-500">Stop</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleReadScriptAloud(0)}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-2xl font-black uppercase text-xs tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-lg shadow-emerald-900/20"
                >
                  <Volume2 className="w-4 h-4" />
                  Escuchar propuesta
                </button>
              )}

              <button
                type="button"
                onClick={() => setPresentationViewOpen(false)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-medium transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Volver al editor
              </button>
            </div>
          </div>
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex flex-col xl:flex-row gap-6 p-6 md:p-10 w-full max-w-[1980px] mx-auto">
              <section className="flex-1 basis-0 flex flex-col rounded-[30px] border border-gray-800 bg-gray-900/80 shadow-2xl overflow-hidden min-h-0">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/80">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.4em] text-emerald-400 font-black">Propuesta</p>
                    <p className="text-xs text-gray-400">{t('videoEditor.aiFixedHint')}</p>
                  </div>
                  <Button
                    type="button"
                    onClick={handleSaveSnapshot}
                    variant="outline"
                    className="text-[11px] uppercase tracking-[0.3em] font-semibold px-3 py-2"
                  >
                    Guardar propuesta
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-5 custom-slim-scroll" style={{ maxHeight: 'calc(100vh - 220px)' }}>
                  <div className="text-gray-200 text-base md:text-lg leading-relaxed space-y-2">
                    {(() => {
                      let globalSentIdx = 0;
                      return presentationSnapshot.split('\n').map((line: string, i: number) => {
                        const trimmed = line.trim();

                        if (trimmed.startsWith('#')) {
                          const cleaned = cleanTextForTTS(trimmed);
                          const isReadable = cleaned && cleaned.length > 1;
                          const currentIdx = isReadable ? globalSentIdx++ : -1;
                          const isCurrent = isReadable && currentScriptIndex === currentIdx;

                          return (
                            <h3
                              key={i}
                              {...(isReadable ? { "data-script-index": currentIdx } : {})}
                              className={cn(
                                "text-2xl font-black mt-8 mb-4 border-l-4 pl-4 uppercase tracking-tight transition-all duration-500",
                                isCurrent
                                  ? "text-white border-white bg-white/10 py-2 scale-[1.02] shadow-[0_0_30px_rgba(255,255,255,0.2)] animate-pulse-subtle"
                                  : "text-yellow-400 border-yellow-600"
                              )}
                            >
                              {line.replace(/#/g, '').trim()}
                            </h3>
                          );
                        }

                        if (trimmed === '') return <div key={i} className="h-4" />;

                        const sentences = line.split(/([.!?]+)/).reduce((acc: string[], val, idx, array) => {
                          if (idx % 2 === 0) {
                            const punct = array[idx + 1] || '';
                            const combined = (val + punct).trim();
                            if (combined) acc.push(combined);
                          }
                          return acc;
                        }, []);

                        return (
                          <p key={i} className="mb-4">
                            {sentences.length === 0 ? (
                              <span className="text-gray-400">{line}</span>
                            ) : sentences.map((sentence, sIdx) => {
                              const cleaned = cleanTextForTTS(sentence);
                              const isReadable = cleaned && cleaned.length > 1;
                              const currentIdx = isReadable ? globalSentIdx++ : -1;
                              const isCurrent = isReadable && currentScriptIndex === currentIdx;

                              return (
                                <span
                                  key={sIdx}
                                  {...(isReadable ? { "data-script-index": currentIdx } : {})}
                                  onClick={() => isReadable && handleReadScriptAloud(currentIdx)}
                                  className={cn(
                                    "transition-all duration-300 rounded px-1.5 py-0.5 inline-block mr-1",
                                    isReadable ? "cursor-pointer" : "cursor-default",
                                    isCurrent
                                      ? "bg-emerald-600/60 ring-2 ring-emerald-400 border-b-2 border-emerald-400 z-10 relative shadow-[0_0_25px_rgba(52,211,153,0.5)] scale-[1.03] text-white animate-pulse-subtle"
                                      : isReadable ? "hover:bg-white/5" : ""
                                  )}
                                >
                                  {sentence.split(/(\*\*.*?\*\*|\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})/g).map((part, pIdx) => {
                                    if (part.startsWith('**') && part.endsWith('**')) {
                                      return <strong key={pIdx} className={cn("font-bold", isCurrent ? "text-white" : "text-green-400")}>{part.replace(/\*\*/g, '')}</strong>;
                                    }
                                    if (/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/.test(part)) {
                                      return <span key={pIdx} className={cn("px-2 py-0.5 rounded font-black text-xs border mx-1", isCurrent ? "bg-white/20 text-white border-white/30" : "bg-yellow-500/10 text-yellow-500 border-yellow-500/20")}>{part}</span>;
                                    }
                                    return part;
                                  })}
                                </span>
                              );
                            })}
                          </p>
                        );
                      });
                    })()}
                  </div>
                </div>
                <div className="px-6 py-3 border-t border-gray-800 text-xs text-gray-500 bg-gray-900/90">
                  {t('videoEditor.aiFreezeHint')}
                </div>
              </section>
              <section className="flex-1 flex flex-col rounded-[30px] border border-gray-800 bg-gray-900/80 shadow-2xl overflow-hidden min-h-0">
                <div className="px-5 py-4 border-b border-gray-800 bg-gray-900/80">
                  <p className="text-[9px] uppercase tracking-[0.4em] text-gray-400">Chat IA</p>
                  <p className="text-xs text-gray-500">{t('videoEditor.aiHistoryTitle')}</p>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 custom-slim-scroll" style={{ maxHeight: 'calc(100vh - 220px)' }}>
                  {chatMessages.length === 0 ? (
                    <p className="text-xs text-gray-500 text-center">{t('videoEditor.aiNoMessages')}</p>
                  ) : (
                    chatMessages.map((msg, idx) => {
                      const bubbleId = `${msg.role}-${idx}`;
                      const isCopied = copiedMessageId === bubbleId;
                      const isSpeaking = Boolean(currentSpeakingText && currentSpeakingText === msg.content);
                      return (
                        <div
                          key={bubbleId}
                          className={`rounded-2xl border px-4 py-3 space-y-1 leading-relaxed ${
                            msg.role === 'assistant' ? 'border-emerald-500/30 bg-emerald-500/5 text-gray-50' : 'border-gray-700 bg-gray-900/40 text-gray-200'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.3em] text-gray-400">
                            <span>{msg.role === 'assistant' ? t('videoEditor.aiRole') : t('videoEditor.aiYou')}</span>
                            <div className="flex items-center gap-2">
                              {msg.role === 'assistant' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleCopyChat(msg.content, bubbleId)}
                                    className={`relative flex items-center justify-center rounded-full text-white transition-all ${isCopied ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-white/5 hover:bg-white/15'} p-1.5`}
                                    title="Copiar respuesta"
                                  >
                                    {isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSpeakChat(msg.content)}
                                    className={`flex items-center justify-center rounded-full p-1.5 transition-all ${isSpeaking ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/15'}`}
                                    title="Escuchar respuesta"
                                  >
                                    <Volume2 className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                              <span>{msg.role === 'assistant' ? t('videoEditor.aiMsgType') : t('videoEditor.aiMsgType2')}</span>
                            </div>
                          </div>
                          {renderChatContent(msg.content)}
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="px-4 py-3 border-t border-gray-800 text-[11px] text-gray-500 bg-gray-900/90">
                  {t('videoEditor.aiReplyHint')}
                </div>
              </section>
            </div>
            <style jsx global>{`
              .custom-slim-scroll {
                scrollbar-width: thin;
                scrollbar-color: rgba(255,255,255,0.25) transparent;
              }
              .custom-slim-scroll::-webkit-scrollbar {
                width: 4px;
              }
              .custom-slim-scroll::-webkit-scrollbar-track {
                background: transparent;
              }
              .custom-slim-scroll::-webkit-scrollbar-thumb {
                background: rgba(255,255,255,0.25);
                border-radius: 999px;
              }
              .custom-slim-scroll::-webkit-scrollbar-thumb:hover {
                background: rgba(255,255,255,0.4);
              }
            `}</style>
          </div>
        </div>
      )}

      {/* Vista presentación animada (diapositivas desde Recursos) - Portal para que los clics funcionen */}
      {typeof document !== 'undefined' && presentationSlidesOpen && slides.length > 0 && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex flex-col bg-gray-950"
          role="dialog"
          aria-modal="true"
          aria-label="Presentación animada"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Fondo: imagen, vídeo, color o degradado */}
          {presentationBackgroundType !== 'none' && (
            <div className="absolute inset-0 z-0 overflow-hidden">
              {presentationBackgroundType === 'image' && presentationBackgroundUrl && (
                <img
                  src={presentationBackgroundUrl.startsWith('http') || presentationBackgroundUrl.startsWith('blob') || presentationBackgroundUrl.startsWith('data') ? presentationBackgroundUrl : resolveUrl(presentationBackgroundUrl)}
                  alt=""
                  className="w-full h-full object-cover opacity-40"
                />
              )}
              {presentationBackgroundType === 'video' && presentationBackgroundUrl && (
                <video
                  src={presentationBackgroundUrl.startsWith('http') || presentationBackgroundUrl.startsWith('blob') || presentationBackgroundUrl.startsWith('data') ? presentationBackgroundUrl : resolveUrl(presentationBackgroundUrl)}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-cover opacity-40"
                />
              )}
              {presentationBackgroundType === 'color' && (
                <div className="w-full h-full" style={{ backgroundColor: presentationBackgroundUrl || '#0a0a0a' }} />
              )}
              {presentationBackgroundType === 'gradient' && (
                <div
                  className="w-full h-full"
                  style={{
                    background: `linear-gradient(${presentationBackgroundUrl ? presentationBackgroundUrl.split('|')[3] || 180 : 180}deg, ${presentationBackgroundUrl ? presentationBackgroundUrl.split('|')[0] || '#1a1a2e' : '#1a1a2e'}, ${presentationBackgroundUrl ? presentationBackgroundUrl.split('|')[1] || '#0a0a0a' : '#0a0a0a'})`,
                  }}
                />
              )}
              {(presentationBackgroundType === 'image' || presentationBackgroundType === 'video') && (
                <div className="absolute inset-0 bg-gray-950/60" />
              )}
            </div>
          )}
          {presentationMusicClip && (
            <audio
              ref={presentationAudioRef}
              src={resolveUrl(presentationMusicClip.url)}
              loop
              className="hidden"
            />
          )}
          <div className="flex-none flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-gray-800 bg-gray-900/90 relative z-10">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Presentation className="w-5 h-5 text-emerald-400" />
                Presentación animada
              </h2>
              <span className="text-sm font-medium text-gray-300">
                Diapositiva {presentationSlideIndex + 1} de {slides.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setBgModalTab(presentationBackgroundType === 'none' ? 'none' : presentationBackgroundType);
                  setPresentationBgModalOpen(true);
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-600 hover:bg-gray-700 text-white text-sm transition-colors"
                title="Configurar fondo"
              >
                <Palette className="w-4 h-4 text-emerald-400" />
                <span className="hidden sm:inline">{presentationBackgroundType === 'none' ? 'Sin fondo' : presentationBackgroundType === 'image' ? 'Imagen' : presentationBackgroundType === 'video' ? 'Vídeo' : presentationBackgroundType === 'color' ? 'Color' : 'Degradado'}</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Zoom:</span>
              <button
                type="button"
                onClick={() => setPresentationZoom(z => Math.max(50, z - 10))}
                className="p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                title="Reducir"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-sm text-gray-300 min-w-[3rem] text-center">{presentationZoom}%</span>
              <button
                type="button"
                onClick={() => setPresentationZoom(z => Math.min(200, z + 10))}
                className="p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                title="Aumentar"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <label className="flex items-center gap-1.5 cursor-pointer select-none ml-1">
                <input
                  type="checkbox"
                  checked={showPresentationGuide}
                  onChange={(e) => setShowPresentationGuide(e.target.checked)}
                  className="w-3.5 h-3.5 accent-yellow-500 rounded"
                />
                <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Guía</span>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={presentationSlideIndex === 0}
                onClick={() => setPresentationSlideIndex(i => Math.max(0, i - 1))}
                className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                title="Anterior"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !presentationSlidesPlaying;
                  setPresentationSlidesPlaying(next);
                  if (next && presentationMusicClip && presentationAudioRef.current) {
                    presentationAudioRef.current.play().catch(() => { });
                  } else if (!next && presentationAudioRef.current) {
                    presentationAudioRef.current.pause();
                  }
                }}
                className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${presentationSlidesPlaying ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-gray-700 hover:bg-gray-600'} text-white`}
                title={presentationSlidesPlaying ? 'Pausar' : 'Reproducir'}
              >
                {presentationSlidesPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                <span className="text-sm font-medium hidden sm:inline">{presentationSlidesPlaying ? 'Pausar' : 'Reproducir'}</span>
              </button>
              <select
                value={presentationSlideIntervalSec}
                onChange={(e) => setPresentationSlideIntervalSec(Number(e.target.value))}
                className="bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-white text-sm"
                title="Segundos por diapositiva"
              >
                <option value={3}>3 s</option>
                <option value={5}>5 s</option>
                <option value={8}>8 s</option>
                <option value={10}>10 s</option>
              </select>
              <button
                type="button"
                disabled={presentationSlideIndex === slides.length - 1}
                onClick={() => setPresentationSlideIndex(i => Math.min(slides.length - 1, i + 1))}
                className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                title="Siguiente"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setPresentationConfigModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-medium transition-colors"
                title="Configurar texto de esta diapositiva"
              >
                <Settings className="w-4 h-4" />
                Configurar
              </button>
              <button
                type="button"
                disabled={isExportingPresentationVideo}
                onClick={async () => {
                  let titulo = `presentacion-${new Date().toLocaleDateString().replace(/\//g, '-')}-${new Date().getHours()}-${new Date().getMinutes()}`;
                  
                  // Intentar usar prompt de forma segura
                  try {
                    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
                      const userTitle = window.prompt('Nombre para el vídeo:', titulo);
                      if (userTitle === null) return; // Cancelado por el usuario
                      if (userTitle.trim()) titulo = userTitle.trim();
                    }
                  } catch (e) {
                    console.warn('window.prompt no está soportado en este entorno');
                  }

                  await exportPresentationAsVideo(titulo);
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg ${isExportingPresentationVideo ? 'bg-gray-600 cursor-not-allowed' : 'bg-red-600 hover:bg-red-500'} text-white font-medium transition-colors`}
                title="Exportar esta presentación como vídeo MP4"
              >
                {isExportingPresentationVideo ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Video className="w-4 h-4" />
                )}
                {isExportingPresentationVideo ? 'Exportando...' : 'Exportar vídeo'}
              </button>
              {presentationExportedVideoUrl && (
                <button
                  type="button"
                  onClick={() => {
                    presentationAudioRef.current?.pause();
                    setPresentationSlidesOpen(false);
                    addExportedVideoToTimeline(presentationExportedVideoUrl, 'presentacion_exportada.webm');
                    toast({ title: 'Vídeo cargado', description: 'El vídeo exportado se ha añadido al timeline', variant: 'default' });
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white font-medium transition-colors"
                >
                  <Video className="w-4 h-4" />
                  Ver vídeo exportado
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  presentationAudioRef.current?.pause();
                  setPresentationSlidesOpen(false);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-medium transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Volver al editor
              </button>
            </div>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-auto relative z-10">
            {/* Guía de área segura de vídeo (16:9) - Solo si está activa */}
            {showPresentationGuide && (
              <div 
                className="absolute pointer-events-none border-2 border-yellow-400/50 rounded shadow-[0_0_15px_rgba(250,204,21,0.3)] z-20 flex flex-col items-center justify-center overflow-hidden"
                style={{
                  width: 'calc(100vh * 1.777)', // Proporción 16:9 basada en la altura
                  height: '95%',
                  maxWidth: '95%',
                  maxHeight: 'calc(95vw / 1.777)'
                }}
              >
                {/* Rectángulo de Calibración M5 */}
                {(() => {
                  const i = 4;
                  const p = 1 - (i * 0.05);
                  return (
                    <div
                      className="absolute border-2 border-dashed border-yellow-400/50 rounded flex items-start justify-start p-1"
                      style={{ width: `${p * 100}%`, height: `${p * 100}%` }}
                    >
                      <span className="text-[8px] text-yellow-500/60 font-black bg-black/20 px-0.5 rounded leading-none">
                        M{i + 1}
                      </span>
                    </div>
                  );
                })()}

                <div className="w-full h-full flex flex-col items-center justify-between p-2">
                  <div className="w-full flex justify-between">
                    <span className="text-[10px] text-yellow-400 font-bold bg-black/40 px-1 rounded uppercase tracking-widest">Área de captura vídeo (16:9)</span>
                    <span className="text-[10px] text-yellow-400 font-bold bg-black/40 px-1 rounded uppercase tracking-widest">CALIBRACIÓN</span>
                  </div>
                  <div className="w-full flex justify-center">
                    <span className="text-[9px] text-yellow-400/60 font-medium bg-black/20 px-1 rounded italic">El vídeo se exporta exactamente dentro del marco M6</span>
                  </div>
                </div>
              </div>
            )}

            <style>{`
              @keyframes pres-fade { from { opacity: 0; } to { opacity: 1; } }
              @keyframes pres-dissolve { from { opacity: 0; } to { opacity: 1; } }
              @keyframes pres-slide-left { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
              @keyframes pres-slide-right { from { transform: translateX(-100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
              @keyframes pres-slide-up { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
              @keyframes pres-slide-down { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
              @keyframes pres-zoom-in { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
              @keyframes pres-zoom-out { from { transform: scale(1.15); opacity: 0; } to { transform: scale(1); opacity: 1; } }
              @keyframes pres-blur { from { filter: blur(12px); opacity: 0; } to { filter: blur(0); opacity: 1; } }
              .pres-trans-none { opacity: 1; }
              .pres-trans-fade { animation: pres-fade var(--pres-dur, 0.5s) ease-out forwards; }
              .pres-trans-dissolve { animation: pres-dissolve var(--pres-dur, 0.5s) ease-out forwards; }
              .pres-trans-slide-left { animation: pres-slide-left var(--pres-dur, 0.5s) ease-out forwards; }
              .pres-trans-slide-right { animation: pres-slide-right var(--pres-dur, 0.5s) ease-out forwards; }
              .pres-trans-slide-up { animation: pres-slide-up var(--pres-dur, 0.5s) ease-out forwards; }
              .pres-trans-slide-down { animation: pres-slide-down var(--pres-dur, 0.5s) ease-out forwards; }
              .pres-trans-zoom-in { animation: pres-zoom-in var(--pres-dur, 0.5s) ease-out forwards; }
              .pres-trans-zoom-out { animation: pres-zoom-out var(--pres-dur, 0.5s) ease-out forwards; }
              .pres-trans-blur { animation: pres-blur var(--pres-dur, 0.5s) ease-out forwards; }
            `}</style>
            {(() => {
              const slide = slides[presentationSlideIndex];
              if (!slide) return null;
              const gapIndex = presentationSlideIndex - 1;
              const trans = gapIndex >= 0 && presentationTransitionsByGap[gapIndex] ? presentationTransitionsByGap[gapIndex] : { type: 'none' as TransitionType, duration: 0.5 };
              const transClass = trans.type === 'none' ? 'pres-trans-none' : `pres-trans-${trans.type}`;
              return (
                <div
                  key={presentationSlideIndex}
                  className={`w-full max-w-4xl flex flex-col items-center relative ${transClass}`}
                  style={{ '--pres-dur': `${trans.duration}s` } as React.CSSProperties}
                >
                  <div
                    className="w-full flex flex-col items-center"
                    style={{ transform: `scale(${presentationZoom / 100})`, transformOrigin: 'center center' }}
                  >
                    <div className="flex-shrink-0 rounded-xl overflow-hidden border border-gray-700 shadow-2xl bg-black mb-6 relative">
                      <img
                        src={slide.imageDataUrl ? resolveUrl(slide.imageDataUrl) : ''}
                        alt={slide.title || 'Diapositiva'}
                        className="max-h-[50vh] w-auto object-contain"
                      />
                      {slide.overlayEffectId && getSlideEffect(slide.overlayEffectId as SlideEffectId) && (
                        <img
                          src={getSlideEffect(slide.overlayEffectId as SlideEffectId)!.getDataUrl(1280, 720)}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover pointer-events-none opacity-90"
                        />
                      )}
                    </div>
                    <div
                      className="px-4"
                      style={{
                        width: `${slide.textWidth || 60}%`,
                        textAlign: slide.textAlign || 'center',
                        marginLeft: 'auto',
                        marginRight: 'auto',
                      }}
                    >
                      {slide.title && (
                        <h3
                          className="font-bold mb-3 leading-tight"
                          style={{
                            fontSize: `${slide.titleFontSize || 32}px`,
                            color: slide.titleColor || '#ffffff',
                            fontFamily: slide.titleFontFamily || 'sans-serif',
                          }}
                        >
                          {slide.title}
                        </h3>
                      )}
                      {slide.description && (
                        <p
                          className="leading-relaxed"
                          style={{
                            fontSize: `${slide.descriptionFontSize || 18}px`,
                            color: slide.descriptionColor || '#d1d5db',
                            fontFamily: slide.descriptionFontFamily || 'sans-serif',
                          }}
                        >
                          {slide.description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
        , document.body)}

      {/* Modal configuración de fondo */}
      {typeof document !== 'undefined' && presentationBgModalOpen && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Configurar fondo">
          {(() => {
            const loadLocalFiles = async (type: 'image' | 'video') => {
              setBgModalLoading(true);
              try {
                const paths = await getLocalPaths();
                const category = type === 'image' ? 'imagen' : 'video';
                const folder = paths[category];
                if (!folder) {
                  alert(`No hay una carpeta configurada para ${category}. Configúrala primero.`);
                  setBgModalLoading(false);
                  return;
                }
                const files = await listDirectory(folder, category);
                setBgModalFiles(files || []);
              } catch (e) {
                console.error(e);
              }
              setBgModalLoading(false);
            };
            const applyBg = (type: 'none' | 'image' | 'video' | 'color' | 'gradient', url?: string) => {
              setPresentationBackgroundType(type);
              if (url !== undefined) setPresentationBackgroundUrl(url);
              setPresentationBgModalOpen(false);
            };
            const tabs = [
              { key: 'none' as const, label: 'Ninguno' },
              { key: 'image' as const, label: 'Imagen' },
              { key: 'video' as const, label: 'Vídeo' },
              { key: 'color' as const, label: 'Color' },
              { key: 'gradient' as const, label: 'Degradado' },
            ];
            return (
              <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <Palette className="w-5 h-5 text-emerald-400" />
                    Configurar fondo
                  </h3>
                  <button
                    onClick={() => setPresentationBgModalOpen(false)}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex border-b border-gray-800 shrink-0 overflow-x-auto">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => {
                        setBgModalTab(t.key);
                        if (t.key === 'image' || t.key === 'video') {
                          setBgModalFiles([]);
                        }
                      }}
                      className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${bgModalTab === t.key ? 'text-emerald-400 border-b-2 border-emerald-400 bg-gray-800/50' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  {bgModalTab === 'none' && (
                    <div className="text-center space-y-4">
                      <p className="text-sm text-gray-400">No se usará ningún fondo. El canvas tendrá un color oscuro por defecto.</p>
                      <Button onClick={() => applyBg('none', '')} variant="outline" className="text-xs uppercase tracking-widest font-bold">
                        Aplicar sin fondo
                      </Button>
                    </div>
                  )}
                  {(bgModalTab === 'image' || bgModalTab === 'video') && (
                    <div className="space-y-4">
                      {(() => {
                        const tabType = bgModalTab as 'image' | 'video';
                        return (
                          <div className="flex items-center gap-2">
                            <Button
                              onClick={() => loadLocalFiles(tabType)}
                              variant="outline"
                              className="text-xs uppercase tracking-widest font-bold"
                            >
                              <FolderOpen className="w-4 h-4 mr-2" />
                              Abrir carpeta de {tabType === 'image' ? 'imágenes' : 'vídeos'}
                            </Button>
                          </div>
                        );
                      })()}
                      {bgModalLoading && (
                        <p className="text-center py-4 text-gray-500 text-sm flex items-center justify-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" /> Cargando...
                        </p>
                      )}
                      {!bgModalLoading && bgModalFiles.length === 0 && (
                        <p className="text-center py-4 text-gray-500 text-sm italic">Pulsa el botón para cargar los archivos.</p>
                      )}
                      <div className="grid grid-cols-1 gap-2 max-h-[40vh] overflow-y-auto">
                        {bgModalFiles.map((f, i) => (
                          <div
                            key={i}
                            className={`group flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${presentationBackgroundUrl === f.path && presentationBackgroundType === bgModalTab ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-gray-800/30 border-gray-700/30 hover:bg-emerald-500/5 hover:border-emerald-500/20'}`}
                            onClick={() => applyBg(bgModalTab, f.path)}
                          >
                            <div className="p-2 rounded-lg bg-gray-900 shrink-0">
                              {bgModalTab === 'video' ? <FileVideo className="w-4 h-4 text-blue-400" /> : <FileImage className="w-4 h-4 text-purple-400" />}
                            </div>
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="truncate text-sm font-medium text-gray-200">{f.name || f.fileName || 'Archivo'}</span>
                              <span className="truncate text-[10px] text-gray-500">{f.path || ''}</span>
                            </div>
                            {presentationBackgroundUrl === f.path && presentationBackgroundType === bgModalTab && (
                              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {bgModalTab === 'color' && (
                    <div className="space-y-6">
                      <div className="flex items-center gap-4">
                        <input
                          type="color"
                          value={solidColor}
                          onChange={(e) => setSolidColor(e.target.value)}
                          className="w-16 h-16 rounded-xl border-2 border-gray-700 bg-transparent cursor-pointer"
                        />
                        <div className="flex-1">
                          <label className="text-xs text-gray-500 uppercase font-bold tracking-wider block mb-1">Color sólido</label>
                          <input
                            type="text"
                            value={solidColor}
                            onChange={(e) => setSolidColor(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                          />
                        </div>
                      </div>
                      <div className="w-full h-24 rounded-xl border border-gray-700" style={{ backgroundColor: solidColor }} />
                      <Button onClick={() => applyBg('color', solidColor)} className="w-full text-xs uppercase tracking-widest font-bold">
                        Aplicar color
                      </Button>
                    </div>
                  )}
                  {bgModalTab === 'gradient' && (
                    <div className="space-y-6">
                      <div className="flex items-center gap-4">
                        <input
                          type="color"
                          value={gradientFrom}
                          onChange={(e) => setGradientFrom(e.target.value)}
                          className="w-16 h-16 rounded-xl border-2 border-gray-700 bg-transparent cursor-pointer"
                        />
                        <div className="flex-1">
                          <label className="text-xs text-gray-500 uppercase font-bold tracking-wider block mb-1">Color inicial</label>
                          <input
                            type="text"
                            value={gradientFrom}
                            onChange={(e) => setGradientFrom(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <input
                          type="color"
                          value={gradientTo}
                          onChange={(e) => setGradientTo(e.target.value)}
                          className="w-16 h-16 rounded-xl border-2 border-gray-700 bg-transparent cursor-pointer"
                        />
                        <div className="flex-1">
                          <label className="text-xs text-gray-500 uppercase font-bold tracking-wider block mb-1">Color final</label>
                          <input
                            type="text"
                            value={gradientTo}
                            onChange={(e) => setGradientTo(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 uppercase font-bold tracking-wider block mb-2">Ángulo: {gradientAngle}°</label>
                        <Slider
                          min={0}
                          max={360}
                          step={1}
                          value={[gradientAngle]}
                          onValueChange={([v]) => setGradientAngle(v)}
                          className="w-full"
                        />
                      </div>
                      <div className="w-full h-24 rounded-xl border border-gray-700" style={{ background: `linear-gradient(${gradientAngle}deg, ${gradientFrom}, ${gradientTo})` }} />
                      <Button onClick={() => applyBg('gradient', `${gradientFrom}|${gradientTo}||${gradientAngle}`)} className="w-full text-xs uppercase tracking-widest font-bold">
                        Aplicar degradado
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
        , document.body)}

      {/* Modal configuración de texto de diapositiva */}
      {typeof document !== 'undefined' && presentationConfigModalOpen && slides[presentationSlideIndex] && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Configurar diapositiva">
          {(() => {
            const slide = slides[presentationSlideIndex];
            const updateSlide = (patch: Partial<EditorSlide>) => {
              if (applyGlobalRef.current) {
                setSlides(prev => prev.map((s) => ({ ...s, ...patch })));
              } else {
                setSlides(prev => prev.map((s, i) => i === slideIndexRef.current ? { ...s, ...patch } : s));
              }
            };
            return (
              <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <Settings className="w-5 h-5 text-emerald-400" />
                    {applyConfigGlobally ? 'Configurar todas las diapositivas' : `Configurar diapositiva ${presentationSlideIndex + 1}`}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setPresentationConfigModalOpen(false)}
                    className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="px-6 py-3 bg-gray-800/50 border-b border-gray-800">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyConfigGlobally}
                      onChange={(e) => setApplyConfigGlobally(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-600 text-emerald-500 bg-gray-800 focus:ring-emerald-500 focus:ring-offset-gray-900"
                    />
                    <span className="text-sm text-gray-300">Aplicar cambios a todas las diapositivas</span>
                  </label>
                </div>

                <div className="p-6 space-y-5">
                  {/* Ancho del bloque de texto */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300 flex items-center justify-between">
                      <span>Ancho del texto</span>
                      <span className="text-xs text-emerald-400 font-mono">{slide.textWidth || 60}%</span>
                    </label>
                    <Slider
                      min={10}
                      max={100}
                      step={5}
                      value={[slide.textWidth || 60]}
                      onValueChange={([v]) => updateSlide({ textWidth: v })}
                      className="w-full"
                    />
                  </div>

                  {/* Alineación */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">Alineación</label>
                    <div className="flex gap-2">
                      {(['left', 'center', 'right'] as const).map((align) => (
                        <button
                          key={align}
                          type="button"
                          onClick={() => updateSlide({ textAlign: align })}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                            (slide.textAlign || 'center') === align
                              ? 'bg-emerald-600 border-emerald-500 text-white'
                              : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                          }`}
                        >
                          {align === 'left' && 'Izquierda'}
                          {align === 'center' && 'Centro'}
                          {align === 'right' && 'Derecha'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-gray-800 pt-4 space-y-4">
                    <h4 className="text-sm font-bold text-emerald-400 uppercase tracking-wider">Título</h4>
                    {/* Tamaño fuente título */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300 flex items-center justify-between">
                        <span>Tamaño de fuente</span>
                        <span className="text-xs text-emerald-400 font-mono">{slide.titleFontSize || 32}px</span>
                      </label>
                      <Slider
                        min={12}
                        max={72}
                        step={1}
                        value={[slide.titleFontSize || 32]}
                        onValueChange={([v]) => updateSlide({ titleFontSize: v })}
                        className="w-full"
                      />
                    </div>
                    {/* Color título */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300">Color</label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={slide.titleColor || '#ffffff'}
                          onChange={(e) => updateSlide({ titleColor: e.target.value })}
                          className="w-10 h-10 rounded-lg border border-gray-700 bg-transparent cursor-pointer"
                        />
                        <input
                          type="text"
                          value={slide.titleColor || '#ffffff'}
                          onChange={(e) => updateSlide({ titleColor: e.target.value })}
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono"
                          placeholder="#ffffff"
                        />
                      </div>
                    </div>
                    {/* Fuente título */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300">Fuente</label>
                      <select
                        value={slide.titleFontFamily || 'sans-serif'}
                        onChange={(e) => updateSlide({ titleFontFamily: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                      >
                        {[
                          { value: 'sans-serif', label: 'Sans-serif (predeterminada)' },
                          { value: 'serif', label: 'Serif (con remates)' },
                          { value: 'monospace', label: 'Monospace (máquina de escribir)' },
                          { value: 'cursive', label: 'Cursive (manuscrita)' },
                          { value: 'fantasy', label: 'Fantasy (decorativa)' },
                          { value: 'Arial, sans-serif', label: 'Arial' },
                          { value: '"Times New Roman", serif', label: 'Times New Roman' },
                          { value: '"Courier New", monospace', label: 'Courier New' },
                          { value: 'Georgia, serif', label: 'Georgia' },
                          { value: '"Segoe UI", sans-serif', label: 'Segoe UI' },
                          { value: 'Verdana, sans-serif', label: 'Verdana' },
                          { value: 'Impact, sans-serif', label: 'Impact' },
                        ].map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="border-t border-gray-800 pt-4 space-y-4">
                    <h4 className="text-sm font-bold text-emerald-400 uppercase tracking-wider">Descripción</h4>
                    {/* Tamaño fuente descripción */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300 flex items-center justify-between">
                        <span>Tamaño de fuente</span>
                        <span className="text-xs text-emerald-400 font-mono">{slide.descriptionFontSize || 18}px</span>
                      </label>
                      <Slider
                        min={10}
                        max={48}
                        step={1}
                        value={[slide.descriptionFontSize || 18]}
                        onValueChange={([v]) => updateSlide({ descriptionFontSize: v })}
                        className="w-full"
                      />
                    </div>
                    {/* Color descripción */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300">Color</label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={slide.descriptionColor || '#d1d5db'}
                          onChange={(e) => updateSlide({ descriptionColor: e.target.value })}
                          className="w-10 h-10 rounded-lg border border-gray-700 bg-transparent cursor-pointer"
                        />
                        <input
                          type="text"
                          value={slide.descriptionColor || '#d1d5db'}
                          onChange={(e) => updateSlide({ descriptionColor: e.target.value })}
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono"
                          placeholder="#d1d5db"
                        />
                      </div>
                    </div>
                    {/* Fuente descripción */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300">Fuente</label>
                      <select
                        value={slide.descriptionFontFamily || 'sans-serif'}
                        onChange={(e) => updateSlide({ descriptionFontFamily: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                      >
                        {[
                          { value: 'sans-serif', label: 'Sans-serif (predeterminada)' },
                          { value: 'serif', label: 'Serif (con remates)' },
                          { value: 'monospace', label: 'Monospace (máquina de escribir)' },
                          { value: 'cursive', label: 'Cursive (manuscrita)' },
                          { value: 'fantasy', label: 'Fantasy (decorativa)' },
                          { value: 'Arial, sans-serif', label: 'Arial' },
                          { value: '"Times New Roman", serif', label: 'Times New Roman' },
                          { value: '"Courier New", monospace', label: 'Courier New' },
                          { value: 'Georgia, serif', label: 'Georgia' },
                          { value: '"Segoe UI", sans-serif', label: 'Segoe UI' },
                          { value: 'Verdana, sans-serif', label: 'Verdana' },
                          { value: 'Impact, sans-serif', label: 'Impact' },
                        ].map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-gray-800 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setPresentationConfigModalOpen(false)}
                    className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
                  >
                    Aceptar
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
        , document.body)}
    </div>
  );
}

