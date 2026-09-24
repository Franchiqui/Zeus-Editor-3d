import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/lib/i18n';
import { TimelineState, TimelineTrack, TimelineClip, TrackType } from '@/types';
import { Play, Pause, Plus, Volume2, VolumeX, Lock, Unlock, Eye, EyeOff, Scissors, Trash2, Copy, ClipboardPaste, ChevronLeft, ChevronRight, SkipBack, SkipForward, ArrowLeftToLine, Undo2, Redo2, Zap, Settings, Combine, Timer, Link, Unlink, Headphones, RotateCcw, ArrowUp, ArrowDown, Repeat, Flag, Trash } from 'lucide-react';
const MUSIC_ICON_SRC = '/music.png';

/** ¿El src es un vídeo (objetos vídeo de la librería)? Los <img> no pueden mostrarlo. */
function isVideoSrc(src: string): boolean {
  return src.startsWith('data:video/') || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(src);
}

// Traduce el NOMBRE VISIBLE de una pista (los datos guardan el nombre en español
// y se usan en comparaciones como track.name === 'Pista de efectos'; solo se
// traduce la presentación).
function getTrackDisplayName(track: TimelineTrack, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const key = (k: string) => t(`videoEditor.timeline.${k}`);
  switch (track.name) {
    case 'Pista de efectos': return key('effectsTrack');
    case 'Vídeo Principal': return key('mainVideo');
    case 'Audio Principal': return key('mainAudio');
    case 'Pista de Imagen': return key('imageTrack');
    case 'Pista de imagen': return key('imageTrack');
    case 'Pista de vídeo': return key('typeVideo');
    case 'Pista de audio': return key('typeAudio');
    case 'Texto superposición': return key('typeText');
    case 'Texto/Superposiciones': return key('typeText');
    default: {
      const m = /^(Video|Audio|Text|Image)( \d+)?$/.exec(track.name);
      if (m) {
        const typeKey = m[1] === 'Video' ? 'typeVideo' : m[1] === 'Audio' ? 'typeAudio' : m[1] === 'Text' ? 'typeText' : 'typeImage';
        return m[2] ? `${key(typeKey)}${m[2]}` : key(typeKey);
      }
      // Pistas de audio (editor de audio): "Pista 1", "Track 2", "Piste 3"... → audioEditor.trackN
      const mTrack = /^(Pista|Track|Piste|Spur|Piste|音轨|ट्रैक) (\d+)$/.exec(track.name);
      if (mTrack) {
        return t('audioEditor.trackN', { n: mTrack[2] });
      }
      return track.name;
    }
  }
}

interface TimelineProps {
  timeline: TimelineState;
  onTimelineChange: (timeline: TimelineState) => void;
  onAddTrack: (type: TrackType) => void;
  onAddClip: (trackId: string, clip: Omit<TimelineClip, 'id' | 'trackId'>) => void;
  onUpdateClip: (clipId: string, updates: Partial<TimelineClip>) => void;
  onDeleteClip: (clipId: string) => void;
  onDeleteTrack?: (trackId: string) => void;
  onMoveTrack?: (trackId: string, direction: 'up' | 'down') => void;
  onSnapToStart?: (trackId: string) => void;
  onSplitClip?: (clipId: string, splitTime: number) => void;
  onMergeClips?: (clipIdA: string, clipIdB: string) => void;
  /** Estirar zona del clip seleccionado: desde/hasta en segundos LOCALES al clip (0 = inicio del clip) y nueva duración de esa zona. Sin cortar ni soldar. Devuelve true si se aplicó. */
  onStretchZone?: (clipId: string, fromLocalSec: number, toLocalSec: number, newDurationSec: number) => boolean | void;
  onCopyClip?: (clipId: string) => void;
  onPasteClip?: () => void;
  onSeparateAudio?: (clipId: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onSeek?: (time: number) => void;
  onSelectClip?: (clipId: string | null) => void;
  selectedClipId?: string | null;
  onPlayPause?: (isPlaying: boolean) => void;
  /** Alternar estado de bucle. Botón "Loop" que reemplaza al de refrescar. */
  onLoopToggle?: () => void;
   /** Estado del bucle: true si está activado */
   isLoopEnabled?: boolean;
   /** Modo reproductor simple: si true, usa el <video> nativo (rápido pero sin alpha/transparencia). Si false, usa el canvas (lento pero con composición correcta). */
   useSimplePlayer?: boolean;
   /** Cambiar el estado del reproductor simple. */
   onUseSimplePlayerChange?: (value: boolean) => void;
   allowedTrackTypes?: TrackType[];
   onAddFile?: () => void;
   onAdjustDuration?: () => void;
   /** Click en el botón "+" de la pista de efectos: crea otra pista de efectos debajo */
   onAddEffectsTrack?: (afterTrackId: string) => void;
  isBypassed?: boolean;
  /** Si es true, muestra botones Anterior/Siguiente canción cuando hay más de un clip en la pista 1 */
  showClipSkipButtons?: boolean;
  /** Si es true, cuando currentTime >= duration la barra roja se dibuja en (currentTime % duration) para que siempre se vea en pantalla sin cambiar la reproducción */
  wrapPlayheadWhenPastEnd?: boolean;
  /** Si es true, el timeline hace scroll automático para mantener la barra de tiempo siempre visible en la zona visible */
  autoScrollToPlayhead?: boolean;
  /** Interruptor de micrófono (solo editor de audio): al activar conecta el micrófono al mezclador */
  microphoneToggle?: { enabled: boolean; onToggle: (enabled: boolean) => void };
  /** Ref al contenedor del video preview: si se proporciona, el modal de clip se renderiza ahí (pegado a la izquierda, fondo negro) */
  clipSettingsModalContainerRef?: React.RefObject<HTMLElement | null>;
  /** Si true, no se renderiza el modal de configuración (evita re-renders durante reproducción) */
  isPlaying?: boolean;
}

const TRACK_HEIGHT = 60;
const TRACK_COLORS = {
  video: 'bg-blue-500/20 border-blue-500',
  audio: 'bg-green-500/20 border-green-500',
  text: 'bg-green-500/20 border-green-500',
  image: 'bg-orange-500/20 border-orange-500'
};

const CLIP_COLORS = {
  video: 'bg-blue-500',
  audio: 'bg-gray-800',
  text: 'bg-gray-900',
  image: 'bg-orange-500'
};

const THUMB_WIDTH = 160; // resolución de cada miniatura muestreada
const FILM_SAMPLE_INTERVAL = 0.5; // segundos entre frames muestreados de la fuente
const FILM_FRAME_MIN = 6;
const FILM_FRAME_MAX = 40;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Resuelve la fuente de un clip a una URL playable (replica resolveUrl del editor):
 *  rutas Windows C:\.. -> media:// vía electronAPI.getMediaUrl; blob/data/http/media
 *  se devuelven tal cual. */
function resolveMediaUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('http') || url.startsWith('media:')) return url;
  if (/^[a-zA-Z]:\\/.test(url) && typeof window !== 'undefined' && (window as any).electronAPI?.getMediaUrl) {
    try { return (window as any).electronAPI.getMediaUrl(url); } catch { return url; }
  }
  return url;
}

/** Perforaciones de película (sprocket holes) arriba y abajo, estilo rollo antiguo. */
function FilmPerforations({ side }: { side: 'top' | 'bottom' }) {
  return (
    <div
      className={`absolute left-0 right-0 h-[5px] z-20 pointer-events-none ${side === 'top' ? 'top-0' : 'bottom-0'}`}
      style={{
        backgroundColor: 'rgba(8,10,14,0.92)',
        backgroundImage:
          'repeating-linear-gradient(90deg, transparent 0 7px, rgba(220,220,225,0.85) 7px 13px, transparent 13px 20px)',
        boxShadow: side === 'top' ? '0 1px 2px rgba(0,0,0,0.6)' : '0 -1px 2px rgba(0,0,0,0.6)',
      }}
    />
  );
}

/**
 * FilmStrip: tira de miniaturas estilo "rollo de película antigua". Los frames se
 * desplazan a la izquierda a medida que avanza el tiempo (la cabeza lectora queda
 * sobre el frame que corresponde al instante actual), como la película positiva
 * alimentándose por el proyector. Si la tira no llega a ser más densa que el clip
 * (zoom muy alto / clip corto), cae a una tira estática alineada al timeline.
 */
function FilmStrip({
  thumbs,
  clip,
  clipWidth,
  currentTime,
}: {
  thumbs: string[];
  clip: TimelineClip;
  clipWidth: number;
  currentTime: number;
}) {
  const N = thumbs.length;
  if (N === 0) return null;

  // Ancho objetivo de cada frame mostrado: ~1.6x más denso que el clip => desplazamiento.
  const niceFrameW = clamp((clipWidth * 1.6) / Math.max(1, N - 1), 80, 260);
  const dense = (N - 1) * niceFrameW > clipWidth * 1.05;
  const frameW = dense ? niceFrameW : clipWidth / N;

  // Fracción del timeline dentro del clip (0..1). Fuera del clip => clamp al borde.
  const f = clamp((currentTime - clip.startTime) / Math.max(0.001, clip.duration), 0, 1);
  // Mapeo al frame de fuente. Un clip normal cubre toda su fuente a lo largo de su
  // duración en timeline => sourceFrac = f. Si va al revés, se invierte.
  const sourceFrac = clip.reversed ? 1 - f : f;
  const idxF = sourceFrac * (N - 1); // índice fraccional => desplazamiento suave

  // Centrar el frame actual bajo la cabeza lectora (playhead). Usamos f clampeado
  // también para playheadX => cuando la cabeza está fuera del clip, la tira se
  // queda en el primer/último frame en vez de pasarse de largo.
  const playheadX = f * clipWidth;
  const translateX = dense ? playheadX - idxF * frameW - frameW / 2 : 0;

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      <FilmPerforations side="top" />
      <FilmPerforations side="bottom" />
      <div
        className="absolute left-0 flex"
        style={{
          top: '5px',
          bottom: '5px',
          transform: `translate3d(${translateX}px,0,0)`,
          willChange: 'transform',
        }}
      >
        {thumbs.map((src, i) => (
          <div
            key={i}
            className="shrink-0 h-full relative bg-black"
            style={{ width: `${frameW}px`, borderRight: '1px solid rgba(0,0,0,0.55)' }}
          >
            <img
              src={src}
              alt=""
              draggable={false}
              className="w-full h-full object-cover"
              style={{ imageRendering: 'auto' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Timeline({
  timeline,
  onTimelineChange,
  onAddTrack,
  onAddClip,
  onUpdateClip,
  onDeleteClip,
  onDeleteTrack,
  onMoveTrack,
  onSnapToStart,
  onSplitClip,
  onMergeClips,
  onStretchZone,
  onCopyClip,
  onPasteClip,
  onSeparateAudio,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onSeek,
  onSelectClip,
  selectedClipId: externalSelectedClipId,
    onPlayPause,
    onLoopToggle,
    isLoopEnabled,
    useSimplePlayer = false,
    onUseSimplePlayerChange,
  allowedTrackTypes = ['video', 'audio', 'text', 'image'],
   onAddFile,
   onAdjustDuration,
   onAddEffectsTrack,
   isBypassed = false,
  showClipSkipButtons = false,
  wrapPlayheadWhenPastEnd = false,
  autoScrollToPlayhead = false,
  microphoneToggle,
  clipSettingsModalContainerRef,
  isPlaying: isPlayingProp = false
}: TimelineProps) {
  const { toast } = useToast();
  const { t } = useI18n();
  const [isPlaying, setIsPlaying] = useState(false);
  const [internalSelectedClip, setInternalSelectedClip] = useState<string | null>(null);
  const [clipSettingsClipId, setClipSettingsClipId] = useState<string | null>(null);
  const [stretchZoneOpen, setStretchZoneOpen] = useState(false);
  const [stretchFrom, setStretchFrom] = useState('');
  const [stretchTo, setStretchTo] = useState('');
  const [stretchNewDuration, setStretchNewDuration] = useState('');
  const [mergeModeBaseClipId, setMergeModeBaseClipId] = useState<string | null>(null);
  const [mergeHighlight, setMergeHighlight] = useState<{ trackId: string; time: number } | null>(null);
  const selectedClip = externalSelectedClipId !== undefined ? externalSelectedClipId : internalSelectedClip;
  const mergeHighlightTimerRef = useRef<number | null>(null);
  const [dragGroupInfo, setDragGroupInfo] = useState<{ groupId: string; startTimes: Record<string, number>; originalTrackId: string } | null>(null);
  const [clipThumbnails, setClipThumbnails] = useState<Record<string, string[]>>({});
  const [clipThumbnailLoading, setClipThumbnailLoading] = useState<Record<string, boolean>>({});

  // Hash de clips de vídeo (id + fuente + duración + reversed) para regenerar
  // miniaturas solo cuando cambia algo relevante (no en cada cambio de zoom).
  const videoClipsHash = (timeline?.tracks || [])
    .flatMap(t => t.clips)
    .filter(c => c.type === 'video')
    .map(c => `${c.id}|${(c as any).src || (c as any).url || c.thumbnailUrl || ''}|${c.duration}|${c.reversed ? 'r' : 'f'}`)
    .join('§');

  // Efecto para generar miniaturas automáticas para TODOS los clips de video.
  // Muestrea la fuente a intervalo fijo (FILM_SAMPLE_INTERVAL) => nº de frames
  // independiente del zoom, suficiente para llenar el "rollo de película".
  //
  // Notas de robustez (replica el método probado de captureFrameAtTime del editor):
  //  - crossOrigin SOLO para http(s). Para media:// (caso común en Electron) NO se
  //    pone: si se pone, la carga falla por CORS y no se genera ningún frame.
  //  - El <video> se adjunta al DOM (off-screen): un vídeo detached no decodifica
  //    frames en Chromium y drawImage pintaría negro.
  //  - Seeks SECUENCIALES (uno a uno, esperando 'seeked' + rVFC): en paralelo sobre
  //    un mismo <video> solo se dispara el último seeked.
  useEffect(() => {
    const tracks = timeline?.tracks || [];
    const videoClips = tracks.flatMap(t => t.clips).filter(c => c.type === 'video');
    const newLoading: Record<string, boolean> = {};
    videoClips.forEach(clip => {
      if (!clipThumbnails[clip.id] || clipThumbnails[clip.id].length === 0) newLoading[clip.id] = true;
    });
    setClipThumbnailLoading(prev => ({ ...prev, ...newLoading }));

    let cancelled = false;

    async function generateFor(clip: TimelineClip): Promise<string[]> {
      const rawSrc = clip.mediaFileId || (clip as any).src || (clip as any).url || clip.thumbnailUrl || '';
      const src = resolveMediaUrl(rawSrc);
      if (!src) return [];
      // Si la fuente es claramente una imagen (no un vídeo), replicarla como tira.
      const isImage = src.startsWith('data:image') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(src);
      if (isImage) {
        return Array(FILM_FRAME_MIN).fill(src);
      }
      // Imagen de respaldo si el vídeo no se puede decodificar (ej. clip de imagen
      // guardado como type 'video').
      const fallbackImg = clip.thumbnailUrl && clip.thumbnailUrl !== src ? clip.thumbnailUrl : null;
      const imgFallback = (): string[] => fallbackImg ? Array(FILM_FRAME_MIN).fill(fallbackImg) : [];

      return await new Promise<string[]>((resolve) => {
        const video = document.createElement('video');
        // crossOrigin='anonymous' para todo lo que no sea blob:/data: (incluido
        // media://). Sin esto el canvas queda "tainted" y toDataURL lanza
        // SecurityError => no se genera ningún frame. Así es como funciona
        // generateVideoThumbnail del editor.
        if (!src.startsWith('blob:') && !src.startsWith('data:')) video.crossOrigin = 'anonymous';
        video.muted = true;
        video.preload = 'auto';
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.style.position = 'fixed';
        video.style.left = '-9999px';
        video.style.top = '0';
        video.style.width = '2px';
        video.style.height = '2px';
        video.style.pointerEvents = 'none';
        video.style.opacity = '0';
        document.body.appendChild(video);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) { video.remove(); resolve([]); return; }

        let settled = false;
        const finish = (out: string[]) => {
          if (settled) return;
          settled = true;
          clearTimeout(totalTimer);
          try { video.remove(); } catch { /* ignore */ }
          resolve(out);
        };
        // Si no conseguimos frames, usar la imagen de respaldo (clip de imagen, etc.).
        const finishOrFallback = (out: string[]) => finish(out.length > 0 ? out : imgFallback());
        const totalTimer = setTimeout(() => finishOrFallback([]), 45000);
        let started = false;

        const onLoaded = () => {
          if (started || cancelled) { if (cancelled) finishOrFallback([]); return; }
          started = true;
          const sourceDuration = (video.duration && isFinite(video.duration) && video.duration > 0)
            ? video.duration
            : (clip.duration || 1);
          const numFrames = clamp(
            Math.round(sourceDuration / FILM_SAMPLE_INTERVAL),
            FILM_FRAME_MIN,
            FILM_FRAME_MAX,
          );
          const interval = sourceDuration / numFrames;
          const aspect = (video.videoWidth || 16) / (video.videoHeight || 9);
          canvas.width = THUMB_WIDTH;
          canvas.height = Math.max(1, Math.round(THUMB_WIDTH / aspect));

          const captureAt = (t: number) => new Promise<boolean>((res) => {
            let done = false;
            let drawn = false;
            const settle = (ok: boolean) => {
              if (done) return;
              done = true;
              clearTimeout(perTimer);
              video.removeEventListener('seeked', onSeeked);
              res(ok);
            };
            const draw = () => {
              if (drawn) return;
              drawn = true;
              if (cancelled) return settle(false);
              try {
                ctx!.drawImage(video, 0, 0, canvas.width, canvas.height);
                thumbs.push(canvas.toDataURL('image/jpeg', 0.6));
                settle(true);
              } catch {
                settle(false);
              }
            };
            const onSeeked = () => {
              if (typeof video.requestVideoFrameCallback === 'function') {
                video.requestVideoFrameCallback(() => draw());
                setTimeout(() => draw(), 250); // salvaguarda si rVFC no dispara
              } else {
                requestAnimationFrame(() => draw());
              }
            };
            video.addEventListener('seeked', onSeeked);
            const perTimer = setTimeout(() => draw(), 3000); // si no hay seeked, dibuja lo que haya
            try {
              video.currentTime = t;
            } catch {
              settle(false);
            }
          });

          const thumbs: string[] = [];
          (async () => {
            for (let i = 0; i < numFrames; i++) {
              if (cancelled) { finish(thumbs); return; }
              // Forzar un seek real en el primer frame (currentTime ya puede ser 0).
              const t = i === 0
                ? Math.min(0.04, Math.max(0, sourceDuration - 0.05))
                : Math.min(i * interval, Math.max(0, sourceDuration - 0.05));
              await captureAt(t);
            }
            finishOrFallback(thumbs);
          })();
        };

        video.addEventListener('loadeddata', onLoaded);
        video.addEventListener('canplay', onLoaded);
        video.addEventListener('error', () => finishOrFallback([]));
        video.src = src;
        video.load();
      });
    }

    (async () => {
      for (const clip of videoClips) {
        if (cancelled) break;
        if (clipThumbnails[clip.id] && clipThumbnails[clip.id].length > 0) continue;
        const thumbs = await generateFor(clip);
        if (cancelled) break;
        if (thumbs.length > 0) {
          setClipThumbnails(prev => ({ ...prev, [clip.id]: thumbs }));
        }
        setClipThumbnailLoading(prev => ({ ...prev, [clip.id]: false }));
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoClipsHash]);

  const setSelectedClip = (id: string | null) => {
    if (externalSelectedClipId !== undefined) {
      onSelectClip?.(id);
    } else {
      setInternalSelectedClip(id);
      onSelectClip?.(id);
    }
  };

  const [draggedClip, setDraggedClip] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartTime, setDragStartTime] = useState(0);
  
  const timelineRef = useRef<HTMLDivElement>(null);
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const headersContainerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();

  // Protecciones contra timeline undefined o valores faltantes
  const pixelsPerSecond = timeline?.zoom || 100;
  const totalWidth = Math.max((timeline?.duration || 0) * pixelsPerSecond, 0);

  const isUiDisabled = isBypassed;
  const displayCurrentTime = isUiDisabled ? 0 : (timeline?.currentTime || 0);
  const displayDuration = isUiDisabled ? 0 : (timeline?.duration || 0);

  const playheadDisplayTime = wrapPlayheadWhenPastEnd && (timeline?.duration || 0) > 0 && (timeline?.currentTime || 0) >= (timeline?.duration || 0) - 0.001
    ? 0
    : (timeline?.currentTime || 0);

  // Auto-scroll: cuando la barra llega al final de lo visible, scroll para ponerla otra vez al principio (izquierda) y el timeline muestra desde ese tiempo
  useEffect(() => {
    if (!autoScrollToPlayhead || !tracksContainerRef.current) return;
    const el = tracksContainerRef.current;
    const playheadX = timeline?.currentTime * pixelsPerSecond;
    const containerWidth = el.clientWidth;
    const scrollWidth = el.scrollWidth;
    const scrollLeft = el.scrollLeft;
    const visibleRight = scrollLeft + containerWidth;
    const margin = 20;
    let targetScroll = scrollLeft;
    if (playheadX >= visibleRight - margin) {
      targetScroll = playheadX;
    } else if (playheadX < scrollLeft + margin) {
      targetScroll = Math.max(0, playheadX - margin);
    }
    targetScroll = Math.max(0, Math.min(scrollWidth - containerWidth, targetScroll));
    if (Math.abs(el.scrollLeft - targetScroll) > 2) {
      el.scrollLeft = targetScroll;
      const ruler = document.getElementById('timeline-ruler');
      if (ruler) ruler.scrollLeft = targetScroll;
    }
  }, [autoScrollToPlayhead, timeline?.currentTime, pixelsPerSecond]);

  // Función para mover el tiempo (seek)
  const handleJump = (seconds: number) => {
    if (!timeline) return;
    const maxTime = timeline?.duration ? Math.min(timeline.duration, (timeline?.currentTime || 0) + seconds) : (timeline?.currentTime || 0) + seconds;
    const newTime = Math.max(0, maxTime);
    onTimelineChange({ ...timeline, currentTime: newTime });
    if (onSeek) onSeek(newTime);
  };

  // Clips de la primera pista ordenados por startTime (para saltar por canción)
  const firstTrackClips = timeline?.tracks?.[0]?.clips?.slice().sort((a, b) => a.startTime - b.startTime) ?? [];
  const canSkipByClip = showClipSkipButtons && firstTrackClips.length >= 2;

  const goToPrevClip = () => {
    if (!canSkipByClip || !timeline) return;
    const t = timeline?.currentTime || 0;
    const idx = firstTrackClips.findIndex((c) => t >= c.startTime && t < c.startTime + c.duration);
    const inFirstSeconds = idx >= 0 && t - firstTrackClips[idx].startTime < 2;
    const targetIdx = idx < 0 ? 0 : inFirstSeconds ? idx - 1 : idx;
    const targetTime = targetIdx < 0 ? 0 : firstTrackClips[targetIdx].startTime;
    onTimelineChange({ ...timeline, currentTime: targetTime });
    if (onSeek) onSeek(targetTime);
  };

  const goToNextClip = () => {
    if (!canSkipByClip || !timeline) return;
    const t = timeline?.currentTime || 0;
    const idx = firstTrackClips.findIndex((c) => t >= c.startTime && t < c.startTime + c.duration);
    const nextIdx = idx < 0 ? 0 : idx + 1;
    const targetTime = nextIdx >= firstTrackClips.length ? (timeline?.duration || 0) : firstTrackClips[nextIdx].startTime;
    onTimelineChange({ ...timeline, currentTime: targetTime });
    if (onSeek) onSeek(targetTime);
  };

  // Función para dividir el clip seleccionado
  const handleSplit = () => {
    if (!selectedClip || !onSplitClip) return;
    onSplitClip(selectedClip, timeline?.currentTime);
  };

  const handleMerge = () => {
    if (!selectedClip || isUiDisabled || !onMergeClips) return;
    if (mergeModeBaseClipId) {
      setMergeModeBaseClipId(null);
      toast({ title: t('videoEditor.timeline.mergeCancel'), description: t('videoEditor.timeline.mergeCancelDesc'), variant: 'default' });
      return;
    }
    setMergeModeBaseClipId(selectedClip);
    toast({ title: t('videoEditor.timeline.mergeActive'), description: t('videoEditor.timeline.mergeActiveDesc'), variant: 'default' });
  };

  const handleUnmerge = () => {
    if (!selectedClip || isUiDisabled) return;
    const clip = timeline?.tracks?.flatMap(t => t.clips).find(c => c.id === selectedClip);
    if (!clip || !clip.linkedGroupId) return;

    const groupId = clip.linkedGroupId;
    const groupClips = timeline?.tracks?.flatMap(t => t.clips).filter(c => c.linkedGroupId === groupId);
    
    groupClips.forEach(c => {
      onUpdateClip(c.id, { linkedGroupId: undefined });
    });

    toast({ title: t('videoEditor.timeline.unmerged'), description: t('videoEditor.timeline.unmergedDesc'), variant: 'default' });
  };

  useEffect(() => {
    if (!mergeModeBaseClipId || !selectedClip || selectedClip === mergeModeBaseClipId || !onMergeClips) return;
    const baseClip = timeline?.tracks?.flatMap(t => t.clips).find(c => c.id === mergeModeBaseClipId);
    const targetClip = timeline?.tracks?.flatMap(t => t.clips).find(c => c.id === selectedClip);
    if (!baseClip || !targetClip) {
      setMergeModeBaseClipId(null);
      return;
    }
    if (baseClip.trackId !== targetClip.trackId) {
      toast({ title: t('videoEditor.timeline.mergeSameTrack'), description: t('videoEditor.timeline.mergeSameTrackDesc'), variant: 'destructive' });
      setMergeModeBaseClipId(null);
      return;
    }
    const track = timeline?.tracks?.find(t => t.id === baseClip.trackId);
    if (!track) {
      setMergeModeBaseClipId(null);
      return;
    }
    const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    const baseIndex = sorted.findIndex(c => c.id === baseClip.id);
    const targetIndex = sorted.findIndex(c => c.id === targetClip.id);
    if (baseIndex < 0 || targetIndex < 0) {
      setMergeModeBaseClipId(null);
      return;
    }
    onMergeClips(baseClip.id, targetClip.id);
    toast({ title: t('videoEditor.timeline.merged'), description: t('videoEditor.timeline.mergedDesc'), variant: 'default' });
    const boundaryTime = Math.max(baseClip.startTime, targetClip.startTime);
    if (mergeHighlightTimerRef.current) {
      window.clearTimeout(mergeHighlightTimerRef.current);
    }
    setMergeHighlight({ trackId: baseClip.trackId, time: boundaryTime });
    mergeHighlightTimerRef.current = window.setTimeout(() => setMergeHighlight(null), 2800);
    setMergeModeBaseClipId(null);
    setSelectedClip(null);
  }, [mergeModeBaseClipId, selectedClip, isUiDisabled, onMergeClips, timeline?.tracks, toast]);

  useEffect(() => {
    return () => {
      if (mergeHighlightTimerRef.current) {
        window.clearTimeout(mergeHighlightTimerRef.current);
      }
    };
  }, []);

  const openStretchZone = () => {
    // Coordenadas LOCALES al clip seleccionado (0 = inicio del clip). Así el rango
    // siempre cae dentro del clip elegido y no depende de dónde esté el playhead en
    // el timeline global ni de que el rango absoluto quepa en un solo clip.
    const clip = timeline?.tracks?.flatMap(t => t.clips).find(c => c.id === selectedClip);
    const clipDur = clip?.duration ?? 0;
    const t = timeline?.currentTime ?? 0;
    // Si el playhead está al final del clip (o no hay duración), empezamos la zona
    // desde 0 para que Desde < Hasta y el botón Aplicar funcione a la primera.
    let localNow = clip ? Math.max(0, Math.min(t - clip.startTime, clipDur)) : 0;
    if (localNow >= clipDur - 0.05) localNow = 0;
    const from = localNow;
    const to = Math.min(clipDur, from + 60);
    // Nueva duración por defecto = 2× la longitud de la zona (cámara lenta 2x),
    // así el campo "Nueva duración" queda obviamente ligado a la zona elegida y
    // siempre es > que la zona (estirar) sin depender de un 60 fijo arbitrario.
    const zoneLen = Math.max(0.1, to - from);
    const newDur = Math.max(1, Math.round(zoneLen * 2 * 10) / 10);
    setStretchFrom(formatTimeToInput(from));
    setStretchTo(formatTimeToInput(to));
    setStretchNewDuration(formatTimeToInput(newDur));
    setStretchZoneOpen(true);
  };

  const formatTimeToInput = (sec: number): string => {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${hrs}:${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const parseTimeInput = (v: string): number => {
    const s = String(v).trim();
    const parts = s.split(':');
    if (parts.length === 3) {
      const h = parseFloat(parts[0]) || 0;
      const m = parseFloat(parts[1]) || 0;
      const sec = parseFloat(parts[2]) || 0;
      return h * 3600 + m * 60 + sec;
    }
    if (parts.length === 2) {
      const m = parseFloat(parts[0]) || 0;
      const sec = parseFloat(parts[1]) || 0;
      return m * 60 + sec;
    }
    return parseFloat(s) || 0;
  };

  const handleApplyStretchZone = () => {
    if (!onStretchZone) return;
    const clip = timeline?.tracks?.flatMap(t => t.clips).find(c => c.id === selectedClip);
    if (!clip) {
      toast({ title: t('videoEditor.timeline.stretchFail'), description: t('videoEditor.timeline.stretchNoClipDesc'), variant: 'destructive' });
      return;
    }
    const rawFrom = parseTimeInput(stretchFrom);
    const rawTo = parseTimeInput(stretchTo);
    const newDur = parseTimeInput(stretchNewDuration);
    if (newDur <= 0) {
      toast({ title: t('videoEditor.timeline.invalidData'), description: t('videoEditor.timeline.invalidDurationDesc'), variant: 'destructive' });
      return;
    }
    // En vez de bloquear con "Fuera del clip", AJUSTAMOS el rango al clip. Así el
    // usuario nunca se queda atascado aunque meta tiempos del vídeo original o del
    // final estirado (confusión habitual: "Hasta" es el fin de la zona DENTRO del
    // clip, no el final ya estirado). Avisamos de que se ha recortado al clip.
    const from = Math.max(0, rawFrom);
    const to = Math.min(clip.duration, rawTo);
    const clamped = (rawFrom < -0.01 || rawTo > clip.duration + 0.01);
    if (from >= to) {
      toast({ title: t('videoEditor.timeline.invalidData'), description: t('videoEditor.timeline.invalidRangeDesc', { dur: clip.duration.toFixed(1) }), variant: 'destructive' });
      return;
    }
    const ok = onStretchZone(clip.id, from, to, newDur);
    setStretchZoneOpen(false);
    if (ok) {
      toast({ title: t('videoEditor.timeline.stretchApplied'), description: `${t('videoEditor.timeline.stretchAppliedDesc', { from: from.toFixed(1), to: to.toFixed(1), dur: newDur.toFixed(1) })}${clamped ? t('videoEditor.timeline.stretchClamped') : ''}` });
    } else if (ok === false) {
      toast({ title: t('videoEditor.timeline.stretchFail'), description: t('videoEditor.timeline.stretchNoClip2Desc'), variant: 'destructive' });
    }
  };

  // Función para copiar
  const handleCopy = () => {
    if (selectedClip && onCopyClip) {
      onCopyClip(selectedClip);
    }
  };

  // Función para pegar
  const handlePaste = () => {
    if (onPasteClip) {
      onPasteClip();
    }
  };

  // Función para silenciar el clip seleccionado
  const handleToggleMuteSelected = () => {
    if (!selectedClip || !onUpdateClip) return;
    
    // Verificar si la pista del clip está bloqueada
    const track = timeline?.tracks?.find(t => t.clips.some(c => c.id === selectedClip));
    if (track?.isLocked) {
      return; // No permitir modificar clips en pistas bloqueadas
    }

    const clip = timeline?.tracks?.flatMap(track => track.clips).find(c => c.id === selectedClip);
    if (clip?.locked) {
      return; // Clip bloqueado individualmente
    }
    if (clip) {
      onUpdateClip(selectedClip, { volume: clip.volume === 0 ? 1 : 0 });
    }
  };

  // Función para borrar el clip seleccionado
  const handleDeleteSelected = () => {
    if (!selectedClip) return;

    // Verificar si la pista del clip está bloqueada
    const track = timeline?.tracks?.find(t => t.clips.some(c => c.id === selectedClip));
    if (track?.isLocked) {
      return; // No permitir eliminar clips en pistas bloqueadas
    }

    const clip = timeline?.tracks?.flatMap(t => t.clips).find(c => c.id === selectedClip);
    if (clip?.locked) {
      return; // Clip bloqueado individualmente
    }

    onDeleteClip(selectedClip);
    setSelectedClip(null);
  };

  // Sincronizar scroll horizontal (ruler) y vertical (headers)
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollLeft, scrollTop } = e.currentTarget;
    
    const ruler = document.getElementById('timeline-ruler');
    if (ruler) ruler.scrollLeft = scrollLeft;
    
    if (headersContainerRef.current) {
      headersContainerRef.current.scrollTop = scrollTop;
    }
  };

  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePlayPause = () => {
    const newPlayingState = !isPlaying;
    setIsPlaying(newPlayingState);
    onPlayPause?.(newPlayingState);
  };

  useEffect(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
  }, [isPlaying]);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = x / pixelsPerSecond;
    
    onTimelineChange({
      ...timeline,
      currentTime: Math.max(0, Math.min(time, timeline?.duration))
    });
  };

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [visualDragPos, setVisualDragPos] = useState<{ x: number, y: number } | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  // Marcas (flechitas) en la regla de tiempo: viven en timeline.bookmarks (se guardan con el proyecto)
  const bookmarks = timeline?.bookmarks ?? [];
  const [bookmarkColor, setBookmarkColor] = useState<'red' | 'yellow'>('red');

  const updateBookmarks = (next: { time: number; color: 'red' | 'yellow' }[]) => {
    if (!timeline) return;
    onTimelineChange({ ...timeline, bookmarks: next });
  };

  const handleRulerMouseDown = (e: React.MouseEvent) => {
    setIsScrubbing(true);
    updateCurrentTime(e.clientX);
  };

  const handleRulerContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = Math.max(0, Math.min(x / pixelsPerSecond, timeline?.duration ?? 0));
    const rounded = Math.round(time * 10) / 10;
    const existing = bookmarks.find(b => Math.abs(b.time - rounded) < 0.3);
    if (existing) {
      updateBookmarks(bookmarks.filter(b => b !== existing));
    } else {
      updateBookmarks([...bookmarks, { time: rounded, color: bookmarkColor }].sort((a, b) => a.time - b.time));
    }
  };

  const removeBookmark = (time: number) => {
    updateBookmarks(bookmarks.filter(b => Math.abs(b.time - time) > 0.01));
  };

  const updateCurrentTime = useCallback((clientX: number) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const time = Math.max(0, Math.min(x / pixelsPerSecond, timeline?.duration));
    onTimelineChange({ ...timeline, currentTime: time });
    if (onSeek) onSeek(time);
  }, [pixelsPerSecond, timeline, onTimelineChange, onSeek]);

  const handleClipMouseDown = (e: React.MouseEvent, clipId: string) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    e.preventDefault();

    // Verificar si la pista del clip está bloqueada
    const track = timeline?.tracks?.find(t => t.clips.some(c => c.id === clipId));

    if (track?.isLocked) {
      return; // No permitir manipular clips en pistas bloqueadas
    }

    const clipObj = track?.clips.find(c => c.id === clipId);

    setSelectedClip(clipId);

    // Clip bloqueado individualmente: se selecciona (para poder
    // desbloquearlo con el candado), pero no se puede arrastrar.
    if (clipObj?.locked) {
      return;
    }

    setDraggedClip(clipId);
    setIsDragging(true);
    setDragStartX(e.clientX);
    
    const clip = timeline?.tracks?.flatMap(track => track.clips).find(c => c.id === clipId);
    if (clip) {
      setDragStartTime(clip.startTime);
      // Guardamos la posición inicial visual
      setVisualDragPos({ x: clip.startTime * pixelsPerSecond, y: 0 });
      if (clip.linkedGroupId) {
        const groupClips = timeline?.tracks?.flatMap(track => track.clips).filter(c => c.linkedGroupId === clip.linkedGroupId);
        const startTimes: Record<string, number> = {};
        groupClips.forEach(c => { startTimes[c.id] = c.startTime; });
        setDragGroupInfo({ groupId: clip.linkedGroupId, startTimes, originalTrackId: clip.trackId });
      } else {
        setDragGroupInfo(null);
      }
    }
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isScrubbing) {
      updateCurrentTime(e.clientX);
      return;
    }

    if (!isDragging || !draggedClip || !timelineRef.current) return;

    const deltaX = e.clientX - dragStartX;
    let newStartTime = dragStartTime + (deltaX / pixelsPerSecond);
    
    // --- LÓGICA DE IMÁN (SNAPPING) ---
    const SNAP_THRESHOLD = 0.2; // Distancia en segundos para activar el imán
    const clip = timeline?.tracks?.flatMap(track => track.clips).find(c => c.id === draggedClip);
    
    if (clip) {
      const currentTrack = timeline?.tracks?.find(t => t.id === clip.trackId);
      if (currentTrack) {
        // Buscar puntos de ajuste (finales de otros clips en la misma pista)
        // EXCLUIMOS clips del mismo grupo para que no se imanten consigo mismos
        const otherClips = currentTrack.clips.filter(c => 
          c.id !== draggedClip && 
          (!clip.linkedGroupId || c.linkedGroupId !== clip.linkedGroupId)
        );
        
        for (const other of otherClips) {
          const otherEnd = other.startTime + other.duration;
          
          // Pegar el inicio de este clip al final del otro
          if (Math.abs(newStartTime - otherEnd) < SNAP_THRESHOLD) {
            newStartTime = otherEnd;
            break;
          }
          
          // Pegar el final de este clip al inicio del otro
          const thisEnd = newStartTime + clip.duration;
          if (Math.abs(thisEnd - other.startTime) < SNAP_THRESHOLD) {
            newStartTime = other.startTime - clip.duration;
            break;
          }
        }
      }
    }

    // Actualizar posición visual (en píxeles)
    setVisualDragPos({ 
      x: Math.max(0, newStartTime * pixelsPerSecond), 
      y: 0 
    });
  }, [isDragging, draggedClip, dragStartX, pixelsPerSecond, dragStartTime, isScrubbing, updateCurrentTime, timeline?.tracks, dragGroupInfo]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (isDragging && draggedClip && visualDragPos) {
      // Al soltar, calculamos la posición final real y actualizamos el padre una sola vez
      const finalTime = visualDragPos.x / pixelsPerSecond;
      const snapInterval = 0.1;
      const snappedTime = Math.round(finalTime / snapInterval) * snapInterval;
      
      // Calcular nueva pista si se ha movido verticalmente
      const rect = timelineRef.current?.getBoundingClientRect();
      if (rect) {
        const relativeY = e.clientY - rect.top;
        const trackIndex = Math.floor((relativeY - 40) / 60);
        const targetTrackIndex = Math.max(0, Math.min(timeline?.tracks?.length - 1, trackIndex));
        const targetTrack = timeline?.tracks[targetTrackIndex];
        
        // Verificar si la pista de destino está bloqueada
        if (targetTrack.isLocked) {
          setIsDragging(false);
          setIsScrubbing(false);
          setDraggedClip(null);
          setVisualDragPos(null);
          setDragGroupInfo(null);
          return;
        }
        
        const clip = timeline?.tracks?.flatMap(t => t.clips).find(c => c.id === draggedClip);
        if (!clip) {
          setIsDragging(false);
          setIsScrubbing(false);
          setDraggedClip(null);
          setVisualDragPos(null);
          setDragGroupInfo(null);
          return;
        }

        const groupId = clip.linkedGroupId;
        if (groupId && dragGroupInfo && dragGroupInfo.groupId === groupId) {
          const baseOldStart = dragGroupInfo.startTimes[draggedClip] ?? clip.startTime;
          const delta = snappedTime - baseOldStart;
          const groupClips = timeline?.tracks?.flatMap(t => t.clips).filter(c => c.linkedGroupId === groupId);
          
          groupClips.forEach(groupClip => {
            // Un clip bloqueado individualmente no se mueve aunque el grupo sí.
            if (groupClip.locked) return;
            const originalStart = dragGroupInfo.startTimes[groupClip.id] ?? groupClip.startTime;
            onUpdateClip(groupClip.id, {
              startTime: originalStart + delta,
              trackId: groupClip.trackId // Mantener la pista actual (grupo no cambia de pista)
            });
          });
        } else {
          onUpdateClip(draggedClip, {
            startTime: snappedTime,
            trackId: targetTrack.id
          });
        }
      }
    }

    setIsDragging(false);
    setIsScrubbing(false);
    setDraggedClip(null);
    setVisualDragPos(null);
    setDragGroupInfo(null);
  }, [isDragging, draggedClip, visualDragPos, pixelsPerSecond, timeline?.tracks, onUpdateClip, toast, dragGroupInfo]);

  useEffect(() => {
    if (isDragging || isScrubbing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isScrubbing, handleMouseMove, handleMouseUp]);

  const toggleTrackMute = (trackId: string) => {
    const updatedTracks = timeline?.tracks?.map(track =>
      track.id === trackId ? { ...track, isMuted: !track.isMuted } : track
    );
    
    onTimelineChange({
      ...timeline,
      tracks: updatedTracks
    });
  };

  const isFirstTrack = (trackId: string) => timeline?.tracks?.[0]?.id === trackId;
  const isLastTrack = (trackId: string) => timeline?.tracks?.[timeline.tracks.length - 1]?.id === trackId;

  const handleMoveTrackClick = (trackId: string, direction: 'up' | 'down') => {
    if (!onMoveTrack) return;
    if (direction === 'up' && isFirstTrack(trackId)) return;
    if (direction === 'down' && isLastTrack(trackId)) return;
    onMoveTrack(trackId, direction);
  };

  const toggleTrackLock = (trackId: string) => {
    console.log(`🔒 toggleTrackLock called for track: ${trackId}`);
    const track = timeline?.tracks?.find(t => t.id === trackId);
    console.log(`🔒 Current isLocked state: ${track?.isLocked}`);
    
    const updatedTracks = timeline?.tracks?.map(track =>
      track.id === trackId ? { ...track, isLocked: !track.isLocked } : track
    );
    
    console.log(`🔒 New isLocked state: ${!track?.isLocked}`);
    
    onTimelineChange({
      ...timeline,
      tracks: updatedTracks
    });
  };

  const renderTimeRuler = () => {
    const markers = [];
    const interval = pixelsPerSecond >= 100 ? 1 : pixelsPerSecond >= 50 ? 2 : 5;
    
    for (let i = 0; i <= timeline?.duration; i += interval) {
      const x = i * pixelsPerSecond;
      markers.push(
        <div
          key={i}
          className="absolute top-0 h-4 border-l border-gray-600"
          style={{ left: `${x}px` }}
        >
          <span className="absolute top-4 text-xs text-gray-400 -translate-x-1/2">
            {formatTime(i)}
          </span>
        </div>
      );
    }
    
    return markers;
  };

  const renderClip = (clip: TimelineClip, track?: TimelineTrack, clipIndex?: number) => {
    if (!clip) return null;
    
    // Obtener la pista del clip si no se pasó
    const clipTrack = track ?? timeline?.tracks?.find(t => t.clips.some(c => c.id === clip.id));
    const isEffectsTrack = clipTrack?.name === 'Pista de efectos';
    
    // Clave única: evita warning cuando dos clips tienen el mismo id (ej. creados en el mismo ms)
    const trackId = clipTrack?.id ?? '';
    const idx = clipIndex ?? timeline?.tracks?.flatMap(t => t.clips).indexOf(clip);
    const uniqueKey = `${trackId}-${idx}-${clip.id}`;
    
    // Si este clip es el que se está arrastrando, usar la posición visual en tiempo real
    const isThisClipDragged = draggedClip === clip.id;
    const isThisClipInDraggedGroup = dragGroupInfo && clip.linkedGroupId === dragGroupInfo.groupId;
    
    let x = Math.max(0, clip.startTime * pixelsPerSecond);
    
    if (isThisClipDragged && visualDragPos) {
      x = visualDragPos.x;
    } else if (isThisClipInDraggedGroup && visualDragPos && draggedClip && dragGroupInfo.startTimes[clip.id] !== undefined) {
      // Calcular posición basada en el desplazamiento del clip arrastrado
      const draggedOriginalStart = dragGroupInfo.startTimes[draggedClip] ?? 0;
      const currentDeltaSeconds = (visualDragPos.x / pixelsPerSecond) - draggedOriginalStart;
      const thisOriginalStart = dragGroupInfo.startTimes[clip.id];
      x = Math.max(0, (thisOriginalStart + currentDeltaSeconds) * pixelsPerSecond);
    }

    const width = Math.max(10, clip.duration * pixelsPerSecond);
    const color = CLIP_COLORS[clip.type] || 'bg-gray-500';
    const clipHeight = isEffectsTrack ? 40 : 68;
    const clipTop = isEffectsTrack ? 4 : 6;
    const clipLocked = !!clip.locked;

    // Un clip se considera arrastrado si es él mismo o parte del grupo que se arrastra
    const isMovingVisually = isThisClipDragged || (isThisClipInDraggedGroup && visualDragPos !== null);

    return (
      <div
        key={uniqueKey}
        className={`absolute ${color} rounded-md cursor-move border-2 shadow-[0_4px_10px_rgba(0,0,0,0.4)] overflow-hidden group/clip ${
          clip.type === 'text'
            ? (selectedClip === clip.id ? 'border-emerald-400 z-20 ring-4 ring-emerald-300/30' : 'border-emerald-400 z-10')
            : selectedClip === clip.id ? 'border-white z-20 ring-4 ring-white/20' :
            clip.linkedGroupId ? 'border-emerald-400/80 z-15' : 'border-white/10 z-10'
        } ${clip.type === 'text' ? 'flex items-center justify-center text-white font-black text-sm px-3' : ''} ${
          (clipTrack?.isLocked || clipLocked) ? 'cursor-not-allowed' : ''
        } ${isEffectsTrack ? 'min-w-[24px]' : ''} ${clip.hidden ? 'ring-2 ring-red-500/40' : ''}`}
        style={{
          left: `${x}px`,
          width: `${width}px`,
          height: `${clipHeight}px`,
          top: `${clipTop}px`,
          transition: isMovingVisually ? 'none' : 'all 0.2s',
          zIndex: isMovingVisually ? 100 : undefined,
          opacity: isMovingVisually ? 0.8 : clip.hidden ? 0.35 : (clipTrack?.isLocked ? 0.5 : clipLocked ? 0.6 : 1)
        }}
        onMouseDown={(e) => handleClipMouseDown(e, clip.id)}
      >

        {/* Indicador de Agrupación (Modo Soldar) */}
        {clip.linkedGroupId && (
          <div className="absolute bottom-1 left-1 z-20 text-emerald-300 bg-black/60 p-1 rounded-full shadow-lg border border-emerald-500/30" title={t('videoEditor.timeline.solderedBadge')}>
            <Link className="w-3 h-3" />
          </div>
        )}
        {/* Indicador de pista bloqueada */}
        {clipTrack?.isLocked && !clipLocked && (
          <div className="absolute top-1 left-1 z-20 text-amber-500 bg-black/60 p-1 rounded shadow-lg" title={t('videoEditor.timeline.trackLockedBadge')}>
            <Lock className="w-3 h-3" />
          </div>
        )}
        {/* Indicador de clip bloqueado */}
        {clipLocked && (
          <div className="absolute top-1 left-1 z-20 text-sky-400 bg-black/60 p-1 rounded shadow-lg" title={t('videoEditor.timeline.clipLockedBadge')}>
            <Lock className="w-3 h-3" />
          </div>
        )}
        {/* Botón de eliminar individual */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            const t = timeline?.tracks?.find(t => t.clips.some(c => c.id === clip.id));
            if (t?.isLocked) return;
            if (clip.locked) return;
            onDeleteClip(clip.id);
            if (selectedClip === clip.id) setSelectedClip(null);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute top-1 right-1 z-30 p-1.5 bg-black/60 hover:bg-red-500 text-white rounded-lg shadow-xl"
          title={t('videoEditor.timeline.deleteClip')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        {/* Botón engranaje para configurar clip */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            const t = timeline?.tracks?.find(t => t.clips.some(c => c.id === clip.id));
            if (t?.isLocked) return;
            if (clip.locked) return;
            setClipSettingsClipId(clip.id);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute top-1 right-9 z-30 p-1.5 bg-black/60 hover:bg-green-500/80 text-white rounded-lg shadow-xl"
          title={t('videoEditor.timeline.configClipTitle')}
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
        {/* Botón candado para bloquear/desbloquear el clip (siempre disponible) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            e.nativeEvent.stopImmediatePropagation();
            const t = timeline?.tracks?.find(t => t.clips.some(c => c.id === clip.id));
            if (t?.isLocked) return; // La pista está bloqueada; usar el candado de pista
            onUpdateClip?.(clip.id, { locked: !clip.locked });
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className={`absolute top-1 right-[68px] z-30 p-1.5 bg-black/60 rounded-lg shadow-xl ${clipLocked ? 'text-sky-400 hover:bg-sky-500/30' : 'text-gray-300 hover:bg-gray-700'}`}
          title={clipLocked ? t('videoEditor.timeline.unlockClip') : t('videoEditor.timeline.lockClipTitle')}
        >
          {clipLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
        </button>
        {/* Botón ojo: ocultar/mostrar el clip en el preview (solo clips de vídeo) */}
        {clip.type === 'video' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              e.nativeEvent.stopImmediatePropagation();
              const t = timeline?.tracks?.find(t => t.clips.some(c => c.id === clip.id));
              if (t?.isLocked) return; // La pista está bloqueada; usar el candado de pista
              onUpdateClip?.(clip.id, { hidden: !clip.hidden });
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`absolute top-1 right-[100px] z-30 p-1.5 bg-black/60 rounded-lg shadow-xl ${clip.hidden ? 'text-red-400 hover:bg-red-500/30' : 'text-gray-300 hover:bg-gray-700'}`}
            title={clip.hidden ? t('videoEditor.timeline.showClip') : t('videoEditor.timeline.hideClip')}
          >
            {clip.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        )}

        {/* Indicador de silenciado (Si el volumen es 0) */}
        {clip.volume === 0 && !isEffectsTrack && (
          <div className="absolute top-1 left-1 z-20 text-red-500 bg-black/40 p-0.5 rounded shadow-lg" title={t('videoEditor.timeline.clipMutedBadge')}>
            <VolumeX className="w-3.5 h-3.5" />
          </div>
        )}
        {clip.type === 'text' ? (() => {
          // Renderiza el texto tal como aparece en el vídeo: fuente, color,
          // perfilado (WebkitTextStroke), sombra y fondo si lo tiene.
          const hasBg = !!clip.backgroundColor && (clip.backgroundOpacity ?? 0) > 0;
          const hexToRgb = (hex: string) => {
            const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
            return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : '0, 0, 0';
          };
          const textStyle = {
            fontFamily: clip.fontFamily ? `"${clip.fontFamily}", sans-serif` : undefined,
            color: clip.color || '#ffffff',
            fontWeight: clip.isBold ? 700 : 400,
            fontStyle: clip.isItalic ? 'italic' : 'normal',
            textDecoration: clip.isUnderline ? 'underline' : 'none',
            // Perfilado (igual que TextOverlay.tsx)
            WebkitTextStroke: (clip.borderWidth ?? 0) > 0 ? `${clip.borderWidth}px ${clip.borderColor}` : undefined,
            // Sombra (amarilla u otra) — igual que TextOverlay.tsx
            textShadow: (clip.shadowBlur ?? 0) > 0 || (clip.shadowOffset ?? 0) > 0
              ? `${clip.shadowOffset ?? 0}px ${clip.shadowOffset ?? 0}px ${clip.shadowBlur ?? 0}px ${clip.shadowColor}`
              : '1px 1px 2px rgba(0,0,0,0.6)',
            backgroundColor: hasBg
              ? `rgba(${hexToRgb(clip.backgroundColor!)}, ${(clip.backgroundOpacity ?? 100) / 100})`
              : undefined,
            padding: hasBg ? '1px 5px' : undefined,
            borderRadius: hasBg ? `${clip.borderRadius ?? 0}px` : undefined,
            // Tamaño proporcional al del vídeo, acotado para que quepa en el clip.
            fontSize: isEffectsTrack
              ? 11
              : Math.max(12, Math.min(28, clip.fontSize ?? 18)),
            lineHeight: 1.1,
          };
          return (
            <span
              className="truncate px-1"
              style={textStyle}
              title={clip.text || t('videoEditor.timeline.textLabel')}
            >
              {clip.text || t('videoEditor.timeline.textLabel')}
            </span>
          );
        })() : (
          <div className="relative w-full h-full group">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/40 z-10" />
            {/* Miniaturas de frames - tira tipo rollo de película que se desplaza */}
            {clip.type === 'audio' ? (
              <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                <span className="text-[10px] text-white/30 font-bold tracking-widest uppercase">{clip.type}</span>
              </div>
            ) : clipThumbnails[clip.id] && clipThumbnails[clip.id].length > 0 ? (
              <FilmStrip
                thumbs={clipThumbnails[clip.id]}
                clip={clip}
                clipWidth={width}
                currentTime={displayCurrentTime}
              />
            ) : clipThumbnailLoading[clip.id] ? (
              <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                <div className="animate-pulse w-4 h-4 bg-blue-500/50 rounded-full" />
              </div>
            ) : clip.thumbnailUrl ? (
              isVideoSrc(clip.thumbnailUrl) ? (
                <video
                  src={clip.thumbnailUrl}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  className="w-full h-full object-contain"
                />
              ) : (
                <img
                  src={clip.thumbnailUrl}
                  alt="Clip"
                  className="w-full h-full object-contain"
                />
              )
            ) : (
              <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                <span className="text-[10px] text-white/30 font-bold tracking-widest uppercase">{clip.type}</span>
              </div>
            )}
            {clip.type === 'audio' && (
              <div className="absolute inset-0 flex items-center overflow-hidden z-[40] pointer-events-none" style={{ paddingBottom: '25px' }}>
                {Array.from({ length: Math.ceil(width / 40) }).map((_, i) => (
                  <img
                    key={i}
                    src="/music.png"
                    alt="Audio"
                    className="w-56 h-56 object-contain opacity-90 pointer-events-none"
                    style={{ marginRight: '4px' }}
                  />
                ))}
              </div>
            )}
            {!isEffectsTrack && (
            <div className="absolute inset-x-0 bottom-[5px] z-30 bg-black/50 text-[9px] leading-[1.1] text-white px-1.5 py-[1px] font-black flex justify-between items-center border-t border-white/10 overflow-hidden">
              <div className="flex items-center gap-1 truncate max-w-[40%]">
                {(clip.transitionIn?.type && clip.transitionIn.type !== 'none') && <Zap className="w-2.5 h-2.5 text-emerald-400 shrink-0" />}
                {(clip.speedZones?.length ?? 0) > 0 && (
                  <span title={t('videoEditor.timeline.speedZones', { n: clip.speedZones!.length })}>
                    <Timer className="w-2.5 h-2.5 text-violet-400 shrink-0" />
                  </span>
                )}
                {clip.type !== 'audio' && <span className="truncate" title={clip.label || clip.id}>{clip.label || clip.id.slice(-6).toUpperCase()}</span>}
              </div>
              {clip.type === 'audio' && (
                <div className="flex items-center justify-around overflow-hidden w-full">
                  {Array.from({ length: Math.ceil(width / 200) }).map((_, i) => (
                    <span key={i} className="truncate whitespace-nowrap text-emerald-400" title={clip.label || clip.id}>{clip.label || clip.id.slice(-6).toUpperCase()}</span>
                  ))}
                </div>
              )}
              <span className="bg-white/10 px-1 rounded shrink-0">{clip.duration.toFixed(1)}s</span>
            </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsScrubbing(true);
    updateCurrentTime(e.clientX);
  };

  return (
    <>
    <div className="flex flex-col h-full bg-gray-950 border-t border-gray-800 shadow-2xl overflow-hidden">
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 12px;
          height: 12px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #020617;
          border-radius: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 6px;
          border: 2px solid #020617;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .playhead-hit-area {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 20px;
          margin-left: -10px;
          cursor: col-resize;
          z-index: 50;
          background: transparent;
        }
        .playhead-hit-area:hover .playhead-visual-line {
          background: #f87171;
          width: 3px;
          box-shadow: 0 0 15px rgba(239, 68, 68, 0.8);
        }
      `}</style>

      {/* 1. Toolbar Superior */}
      <div className="flex items-center justify-between px-8 py-3 bg-gray-900 border-b border-gray-800 h-16 flex-shrink-0 z-50 shadow-lg">
        <div className="flex items-center space-x-4">
          {/* Controles de Navegación */}
          <div className="flex items-center bg-gray-950/50 p-1 rounded-full border border-white/10 shadow-inner mr-2">
            {/* Ir al Inicio (Tiempo Cero) */}
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => onTimelineChange({ ...timeline, currentTime: 0 })}
              className="h-9 w-9 p-0 rounded-full text-gray-400 hover:text-white" 
              title={t('videoEditor.timeline.goStart')}
            >
              <ArrowLeftToLine className="w-4 h-4 fill-current rotate-90" style={{ transform: 'rotate(0deg)' }} />
            </Button>

            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => handleJump(-5)} 
              className="h-9 w-9 p-0 rounded-full text-gray-400 hover:text-white" 
              title={t('videoEditor.timeline.minus5')}
            >
              <SkipBack className="w-4 h-4 fill-current" />
            </Button>
            
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => handleJump(-0.1)} 
              className="h-9 w-9 p-0 rounded-full text-gray-400 hover:text-white" 
              title={t('videoEditor.timeline.minusFrame')}
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            
            {canSkipByClip && (
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={goToPrevClip} 
                className="h-9 w-9 p-0 rounded-full text-amber-400 hover:text-amber-300" 
                title={t('videoEditor.timeline.prevSong')}
              >
                <SkipBack className="w-4 h-4 fill-current" />
             </Button>
             )}

             <Button
              size="sm"
              variant="ghost"
              onClick={handlePlayPause}
              disabled={isBypassed}
              className={`rounded-full h-11 w-11 p-0 transition-all active:scale-90 border border-white/10 shadow-xl mx-1 ${
                isBypassed 
                  ? 'bg-gray-800/50 text-gray-600 border-gray-700 cursor-not-allowed opacity-50' 
                  : (isPlaying ? 'bg-red-500/10 text-red-500 border-red-500/20' : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20')
              }`}
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 fill-current" />}
            </Button>

            {canSkipByClip && (
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={goToNextClip} 
                className="h-9 w-9 p-0 rounded-full text-amber-400 hover:text-amber-300" 
                title={t('videoEditor.timeline.nextSong')}
              >
                <SkipForward className="w-4 h-4 fill-current" />
              </Button>
            )}
            
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => handleJump(0.1)} 
              className="h-9 w-9 p-0 rounded-full text-gray-400 hover:text-white" 
              title={t('videoEditor.timeline.plusFrame')}
            >
              <ChevronRight className="w-5 h-5" />
            </Button>
            
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => handleJump(5)} 
              className="h-9 w-9 p-0 rounded-full text-gray-400 hover:text-white" 
              title={t('videoEditor.timeline.plus5')}
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </Button>

               {onLoopToggle && (
                <div className="flex items-center gap-2 mr-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onLoopToggle}
                    className={`h-9 w-9 p-0 rounded-full transition-colors ${
                      isLoopEnabled
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : 'text-sky-400 hover:text-sky-300'
                    }`}
                    title={t('videoEditor.timeline.loopTitle')}
                  >
                    <Repeat className="w-4 h-4" />
                  </Button>

                  {onUseSimplePlayerChange !== undefined && (
                    <label className="flex items-center justify-center w-5 h-5 text-xs text-gray-400 hover:text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useSimplePlayer}
                        onChange={(e) => onUseSimplePlayerChange(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-gray-600 text-emerald-500 focus:ring-emerald-500"
                        title={t('videoEditor.timeline.simplePlayerTitle')}
                      />
                    </label>
                  )}
                </div>
               )}
            </div>
          
          <div className="h-10 w-px bg-gray-800" />
          
          <div className="flex flex-col">
            <span className={`text-[10px] uppercase font-black tracking-[0.2em] mb-1 ${isUiDisabled ? 'text-gray-600' : 'text-yellow-400'}`}>{t('videoEditor.timeline.posDur')}</span>
            <div className={`text-3xl font-mono font-black leading-none flex items-baseline gap-2 ${isUiDisabled ? 'text-gray-600' : 'text-white'}`}>
              <span>{formatTime(displayCurrentTime)}</span>
              <span className={`text-3xl font-bold ${isUiDisabled ? 'text-gray-700' : 'text-gray-500'}`}>/ {formatTime(displayDuration)}</span>
            </div>
          </div>
          
          <div className="flex bg-gray-800/50 p-1 rounded-xl border border-white/5 ml-4">
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={onUndo}
              disabled={isUiDisabled || !canUndo}
              className={`h-9 w-9 p-0 transition-all ${!isUiDisabled && canUndo ? 'hover:bg-blue-500/20 text-blue-400' : 'opacity-30 text-gray-600 cursor-not-allowed'}`}
              title={t('videoEditor.timeline.undoTitle')}
            >
              <Undo2 className="w-5 h-5" />
            </Button>
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={onRedo}
              disabled={isUiDisabled || !canRedo}
              className={`h-9 w-9 p-0 transition-all ${!isUiDisabled && canRedo ? 'hover:bg-blue-500/20 text-blue-400' : 'opacity-30 text-gray-600 cursor-not-allowed'}`}
              title={t('videoEditor.timeline.redoTitle')}
            >
              <Redo2 className="w-5 h-5" />
            </Button>
            <div className="w-px h-6 bg-gray-700 mx-1 self-center" />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => selectedClip && setClipSettingsClipId(selectedClip)}
              disabled={isUiDisabled || !selectedClip}
              className={`h-9 w-9 p-0 transition-all ${!isUiDisabled && selectedClip ? 'hover:bg-green-500/20 text-green-400' : 'opacity-30 text-gray-600 cursor-not-allowed'}`}
              title={t('videoEditor.timeline.configSelTitle')}
            >
              <Settings className="w-5 h-5" />
            </Button>
            <div className="w-px h-6 bg-gray-700 mx-1 self-center" />
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={handleSplit}
              disabled={isUiDisabled || !selectedClip}
              className={`h-9 w-9 p-0 transition-all ${!isUiDisabled && selectedClip ? 'hover:bg-blue-500/20 text-blue-400' : 'opacity-30 text-gray-600 cursor-not-allowed'}`}
              title={t('videoEditor.timeline.splitTitle')}
            >
              <Scissors className="w-5 h-5" />
            </Button>
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={handleMerge}
              disabled={isUiDisabled || !selectedClip}
              className={`h-9 w-9 p-0 transition-all ${mergeModeBaseClipId ? 'bg-amber-500/20 text-amber-300' : (!isUiDisabled && selectedClip ? 'hover:bg-amber-500/20 text-amber-400' : 'opacity-30 text-gray-600 cursor-not-allowed')}`}
              title={t('videoEditor.timeline.mergeTitle')}
            >
              <Combine className="w-5 h-5" />
            </Button>
            {selectedClip && timeline?.tracks?.flatMap(t => t.clips).find(c => c.id === selectedClip)?.linkedGroupId && (
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={handleUnmerge}
                disabled={isUiDisabled}
                className="h-9 w-9 p-0 transition-all hover:bg-red-500/20 text-red-400"
                title={t('videoEditor.timeline.unmergeTitle')}
              >
                <Unlink className="w-5 h-5" />
              </Button>
            )}
            {onStretchZone && (
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={openStretchZone}
                disabled={isUiDisabled}
                className={`h-9 w-9 p-0 transition-all ${!isUiDisabled ? 'hover:bg-violet-500/20 text-violet-400' : 'opacity-30 text-gray-600 cursor-not-allowed'}`}
                title={t('videoEditor.timeline.stretchTitle')}
              >
                <Timer className="w-5 h-5" />
              </Button>
            )}
            <div className="w-px h-6 bg-gray-700 mx-1 self-center" />
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={handleCopy}
              disabled={isUiDisabled || !selectedClip}
              className={`h-9 w-9 p-0 transition-all ${!isUiDisabled && selectedClip ? 'hover:bg-blue-500/20 text-blue-400' : 'opacity-30 text-gray-600 cursor-not-allowed'}`}
              title={t('videoEditor.timeline.copyTitle')}
            >
              <Copy className="w-5 h-5" />
            </Button>
            {selectedClip && timeline?.tracks?.flatMap(t => t.clips).find(c => c.id === selectedClip)?.type === 'video' && onSeparateAudio && (
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={() => onSeparateAudio(selectedClip)}
                disabled={isUiDisabled}
                className={`h-9 w-9 p-0 transition-all ${!isUiDisabled ? 'text-orange-400 hover:bg-orange-500/20' : 'opacity-30 text-gray-600 cursor-not-allowed'}`}
                title={t('videoEditor.timeline.separateTitle')}
              >
                <Headphones className="w-5 h-5" />
              </Button>
            )}
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={handlePaste}
              disabled={isUiDisabled}
              className={`h-9 w-9 p-0 transition-all ${!isUiDisabled ? 'text-blue-400 hover:bg-emerald-500/20' : 'opacity-30 text-gray-600 cursor-not-allowed'}`}
              title={t('videoEditor.timeline.pasteTitle')}
            >
              <ClipboardPaste className="w-5 h-5" />
            </Button>
            <div className="w-px h-6 bg-gray-700 mx-1 self-center" />
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={handleToggleMuteSelected}
              disabled={isUiDisabled || !selectedClip}
              className={`h-9 w-9 p-0 transition-all ${
                !isUiDisabled && selectedClip 
                  ? (timeline?.tracks?.flatMap(t => t.clips).find(c => c.id === selectedClip)?.volume === 0
                    ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
                    : 'text-blue-400 hover:bg-blue-500/20')
                  : 'opacity-30 text-gray-600 cursor-not-allowed'
              }`}
              title={t('videoEditor.timeline.muteSelTitle')}
            >
              {selectedClip && timeline?.tracks?.flatMap(t => t.clips).find(c => c.id === selectedClip)?.volume === 0 
                ? <VolumeX className="w-5 h-5" /> 
                : <Volume2 className="w-5 h-5" />}
            </Button>
            <div className="w-px h-6 bg-gray-700 mx-1 self-center" />
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={handleDeleteSelected}
              disabled={isUiDisabled || !selectedClip}
              className={`h-9 w-9 p-0 transition-all ${!isUiDisabled && selectedClip ? 'hover:bg-red-500/20 text-blue-400' : 'opacity-30 text-gray-600 cursor-not-allowed'}`}
              title={t('videoEditor.timeline.deleteSelTitle')}
            >
              <Trash2 className="w-5 h-5" />
            </Button>
          </div>
        </div>
        
        <div className="flex items-center space-x-6">
          <div className="flex bg-gray-950 p-1.5 rounded-xl border border-white/5 shadow-inner">
            {allowedTrackTypes.includes('video') && (
              <Button size="sm" variant="ghost" onClick={() => onAddTrack('video')} className="h-8 text-[11px] text-blue-400 hover:bg-blue-500/10 font-black px-4 tracking-widest">
                + {t('videoEditor.timeline.addVideo').slice(1)}
              </Button>
            )}
            {allowedTrackTypes.includes('audio') && (
              <Button size="sm" variant="ghost" onClick={() => onAddTrack('audio')} className={`h-8 text-[11px] font-black px-4 tracking-widest transition-colors ${isBypassed ? 'text-gray-600' : 'text-emerald-400 hover:bg-emerald-500/10'}`}>
                + {t('videoEditor.timeline.addAudio').slice(1)}
              </Button>
            )}
            {allowedTrackTypes.includes('text') && (
              <Button size="sm" variant="ghost" onClick={() => onAddTrack('text')} className="h-8 text-[11px] text-violet-400 hover:bg-violet-500/10 font-black px-4 tracking-widest">
                + {t('videoEditor.timeline.addText').slice(1)}
              </Button>
            )}
          </div>

          {onAddFile && (
            <div className="flex items-center gap-4 ml-2">
              <button
                type="button"
                onClick={onAddFile}
                className={`inline-flex items-center justify-center h-9 rounded-md px-4 text-[10px] font-black tracking-widest text-white border bg-gray-900 bg-gradient-to-b from-white/15 to-gray-800 transition-all ${isBypassed ? 'border-gray-600 grayscale opacity-70' : 'border-green-500 hover:from-white/25 hover:to-gray-700 shadow-[0_0_12px_rgba(34,197,94,0.25)]'}`}
              >
                <Plus className="w-4 h-4 mr-2" />
                {t('videoEditor.timeline.addFile')}
              </button>
            </div>
          )}
          
          {onAdjustDuration && (
            <div className="flex items-center gap-4 ml-2">
              <button
                type="button"
                onClick={onAdjustDuration}
                className="inline-flex items-center justify-center h-9 rounded-md px-4 text-[10px] font-black tracking-widest text-white border bg-gray-900 bg-gradient-to-b from-white/15 to-gray-800 transition-all border-blue-500 hover:from-white/25 hover:to-gray-700 shadow-[0_0_12px_rgba(59,130,246,0.25)]"
              >
                <Timer className="w-4 h-4 mr-2" />
                {t('videoEditor.timeline.adjustDur')}
              </button>
            </div>
          )}
          
          <div className="flex items-center space-x-4 bg-gray-950 px-5 py-2.5 rounded-xl border border-white/5 shadow-inner">
            <span className="text-[10px] text-gray-500 font-black uppercase tracking-[0.2em]">{t('videoEditor.timeline.zoom')}</span>
            <Slider
              min={50}
              max={600}
              step={1}
              value={[pixelsPerSecond]}
              onValueChange={([v]) => onTimelineChange({ ...timeline, zoom: v })}
              className="w-32"
              rangeClassName="bg-blue-500"
              thumbClassName="slider-thumb-blue"
            />
          </div>
          {timeline?.tracks?.some(t => t.type === 'video' || t.type === 'audio') && (() => {
            const volumeTracks = timeline.tracks.filter(t => t.type === 'video' || t.type === 'audio');
            const masterVolume = volumeTracks.length > 0
              ? volumeTracks.reduce((sum, track) => sum + (track.volume ?? 1), 0) / volumeTracks.length
              : 1;
            return (
              <div className="flex items-center space-x-4 bg-gray-950 px-5 py-2.5 rounded-xl border border-white/5 shadow-inner">
                <span className="text-[10px] text-gray-500 font-black uppercase tracking-[0.2em]">{t('videoEditor.timeline.volume')}</span>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[Math.round(masterVolume * 100)]}
                  onValueChange={([v]) => {
                    const vol = v / 100;
                    onTimelineChange({
                      ...timeline,
                      tracks: timeline.tracks.map(t =>
                        (t.type === 'video' || t.type === 'audio') ? { ...t, volume: vol } : t
                      )
                    });
                  }}
                  className="w-32"
                  rangeClassName="bg-blue-500"
                  thumbClassName="slider-thumb-blue"
                />
              </div>
            );
          })()}
        </div>
      </div>

      {/* 2. Área de Timeline Principal */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Cabeceras de Pistas (Fijas a la izquierda) */}
        <div className="w-64 bg-gray-900 border-r border-gray-800 flex-shrink-0 z-40 flex flex-col shadow-[10px_0_15px_rgba(0,0,0,0.3)]">
          {/* Espacio para alinear con el Ruler */}
          <div className="h-10 bg-gray-800 border-b border-gray-700 w-full flex items-center justify-between px-4">
            <span className="text-[10px] text-gray-500 uppercase font-black tracking-widest">{t('videoEditor.timeline.tracksLayers')}</span>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-gray-500 uppercase font-bold mr-0.5">{t('videoEditor.timeline.markerColor')}</span>
              <button
                onClick={() => setBookmarkColor('red')}
                title={t('videoEditor.timeline.markerRed')}
                className={`w-4 h-4 rounded-full border transition-transform ${bookmarkColor === 'red' ? 'bg-red-500 border-red-300 scale-110' : 'bg-gray-700 border-gray-600 hover:bg-red-900'}`}
              />
              <button
                onClick={() => setBookmarkColor('yellow')}
                title={t('videoEditor.timeline.markerYellow')}
                className={`w-4 h-4 rounded-full border transition-transform ${bookmarkColor === 'yellow' ? 'bg-yellow-400 border-yellow-200 scale-110' : 'bg-gray-700 border-gray-600 hover:bg-yellow-800'}`}
              />
              <button
                onClick={() => updateBookmarks([])}
                title={t('videoEditor.timeline.clearBookmarks')}
                className={`ml-1 ${bookmarks.length ? 'text-gray-300 hover:text-red-400 cursor-pointer' : 'text-gray-600 cursor-default'}`}
              >
                <Flag className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          
          <div 
            ref={headersContainerRef}
            className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar pb-20"
            onWheel={(e) => {
              if (tracksContainerRef.current) {
                tracksContainerRef.current.scrollTop += e.deltaY;
              }
            }}
          >
            {(timeline?.tracks && timeline?.tracks?.length > 0 ? timeline?.tracks : []).map((track) => {
              const isEffectsTrack = track.name === 'Pista de efectos';
              return (
              <div key={track.id} className={`${isEffectsTrack ? 'h-12' : 'h-20'} border-b border-gray-800 flex flex-col justify-center px-4 group bg-gray-900 shadow-inner shrink-0 ${isEffectsTrack ? 'bg-emerald-950/40 border-emerald-800/50' : ''}`}>
                {isEffectsTrack ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] shrink-0" />
                      <span className="font-black truncate uppercase tracking-tight text-[10px] text-emerald-400/90" title={getTrackDisplayName(track, t)}>{getTrackDisplayName(track, t)}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Mover pista arriba / abajo */}
                      {onMoveTrack && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMoveTrackClick(track.id, 'up'); }}
                            disabled={isFirstTrack(track.id)}
                            className={`p-1 bg-black/20 rounded border border-white/5 transition-colors ${isFirstTrack(track.id) ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-yellow-400'}`}
                            title={t('videoEditor.timeline.moveUp')}
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMoveTrackClick(track.id, 'down'); }}
                            disabled={isLastTrack(track.id)}
                            className={`p-1 bg-black/20 rounded border border-white/5 transition-colors ${isLastTrack(track.id) ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-yellow-400'}`}
                            title={t('videoEditor.timeline.moveDown')}
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      {onSnapToStart && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onSnapToStart(track.id); }}
                          className="p-1.5 bg-black/40 rounded border border-white/5 text-gray-400 hover:text-blue-400 transition-colors"
                          title={t('videoEditor.timeline.snapStart')}
                        >
                          <ArrowLeftToLine className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); toggleTrackLock(track.id); }} className={`p-1.5 bg-black/40 rounded border border-white/5 ${track.isLocked ? 'text-amber-500' : (isBypassed ? 'text-gray-600' : 'text-gray-400 hover:text-blue-400')}`} title={t('videoEditor.timeline.lockTrack')}>
                        {!track.isLocked ? <Unlock className={`w-3.5 h-3.5 ${isBypassed ? 'text-gray-600' : 'text-emerald-500'}`} /> : <Lock className="w-3.5 h-3.5" />}
                      </button>
                      {onDeleteTrack && (
                        <button onClick={(e) => { e.stopPropagation(); onDeleteTrack(track.id); }} className="text-gray-400 hover:text-red-500 p-1.5 bg-black/20 rounded" title={t('videoEditor.timeline.deleteTrack')}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onAddEffectsTrack && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onAddEffectsTrack(track.id); }}
                          disabled={isBypassed}
                          className={`p-1.5 bg-black/30 rounded border border-white/5 transition-colors ${isBypassed ? 'text-gray-600 cursor-not-allowed' : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/20'}`}
                          title={t('videoEditor.timeline.addEffects')}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`font-black truncate uppercase tracking-tight ${isEffectsTrack ? 'text-[10px] text-emerald-400/90' : 'text-[11px] text-yellow-400'}`} title={getTrackDisplayName(track, t)}>{getTrackDisplayName(track, t)}</span>
                  <div className="flex space-x-1 transition-opacity">
                    {/* Mover pista arriba / abajo */}
                    {onMoveTrack && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMoveTrackClick(track.id, 'up'); }}
                          disabled={isFirstTrack(track.id)}
                          className={`p-1 bg-black/20 rounded border border-white/5 transition-colors ${isFirstTrack(track.id) ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-yellow-400'}`}
                          title={t('videoEditor.timeline.moveUp')}
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMoveTrackClick(track.id, 'down'); }}
                          disabled={isLastTrack(track.id)}
                          className={`p-1 bg-black/20 rounded border border-white/5 transition-colors ${isLastTrack(track.id) ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-yellow-400'}`}
                          title={t('videoEditor.timeline.moveDown')}
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    {(track.type === 'audio' || track.type === 'video') && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); toggleTrackMute(track.id); }} 
                        className={`p-1.5 bg-black/40 rounded border border-white/5 transition-colors ${
                          track.isMuted ? 'text-red-500' : 'text-gray-400 hover:text-emerald-400'
                        }`}
                        title={track.isMuted ? t('videoEditor.timeline.unmute') : t('videoEditor.timeline.mute')}
                      >
                        {track.isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); toggleTrackLock(track.id); }}
                      className={`p-1.5 bg-black/40 rounded border border-white/5 transition-colors ${
                        track.isLocked ? 'text-amber-500' : (isBypassed ? 'text-gray-600' : 'text-gray-400 hover:text-blue-400')
                      }`}
                      title={t('videoEditor.timeline.lockTrack')}
                    >
                      {!track.isLocked ? <Unlock className={`w-3.5 h-3.5 ${isBypassed ? 'text-gray-600' : 'text-emerald-500'}`} /> : <Lock className="w-3.5 h-3.5" />}
                    </button>
                    {/* Botón Snap al inicio */}
                    {onSnapToStart && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); onSnapToStart(track.id); }} 
                        className="p-1.5 bg-black/40 rounded border border-white/5 text-gray-400 hover:text-blue-400 transition-colors"
                        title={t('videoEditor.timeline.snapStart')}
                      >
                        <ArrowLeftToLine className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {/* Botón para borrar pista */}
                    {onDeleteTrack && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteTrack(track.id); }}
                        className="text-gray-400 hover:text-red-500 p-1 bg-black/20 rounded"
                        title={t('videoEditor.timeline.deleteTrack')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full transition-all duration-500 ${isBypassed ? 'bg-gray-700' : isEffectsTrack ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : (track.type === 'video' ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : track.type === 'audio' ? 'bg-green-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]')}`} />
                    <span className={`text-[10px] font-bold uppercase tracking-tighter ${isEffectsTrack ? 'text-emerald-500/80' : 'text-gray-500'}`}>{isEffectsTrack ? t('videoEditor.timeline.effectsBadge') : t(`videoEditor.timeline.type${track.type.charAt(0).toUpperCase() + track.type.slice(1)}`)}</span>
                  </div>
                  <span className="text-[9px] text-blue-400 font-bold font-mono opacity-90 tracking-wider">ID: {track.id.slice(-4)}</span>
                </div>
                  </>
                )}
              </div>
              );
            })}
            {/* Relleno inferior para permitir scroll */}
            <div className="h-40" />
          </div>
        </div>

        {/* Contenido de Pistas y Ruler (Con Scroll) */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-950">
          
          {/* Ruler */}
          <div 
            id="timeline-ruler" 
            className="h-10 bg-gray-800 border-b border-gray-700 overflow-hidden no-scrollbar relative flex-shrink-0 z-20 cursor-crosshair"
            onMouseDown={handleRulerMouseDown}
            onContextMenu={handleRulerContextMenu}
          >
            <div className="relative h-full" style={{ width: `${totalWidth}px` }}>
              {renderTimeRuler()}
              {/* Marcas del usuario (clic derecho en la regla) */}
              {bookmarks.map((bm, i) => (
                <div
                  key={`bm-${i}-${bm.time}`}
                  className="absolute top-0 flex flex-col items-center cursor-pointer group"
                  style={{ left: `${bm.time * pixelsPerSecond}px`, transform: 'translateX(-50%)' }}
                  onClick={(e) => { e.stopPropagation(); removeBookmark(bm.time); }}
                  title={`${bm.time.toFixed(1)}s — ${t('videoEditor.timeline.removeBookmark')}`}
                >
                  <span className={`text-sm leading-none ${bm.color === 'red' ? 'text-red-500' : 'text-yellow-400'}`}>▼</span>
                  <span className={`w-px h-5 ${bm.color === 'red' ? 'bg-red-500' : 'bg-yellow-400'} opacity-70 group-hover:opacity-100`} />
                </div>
              ))}
            </div>
          </div>

          {/* Área de Clips (Scrollable) */}
          <div 
            ref={tracksContainerRef}
            className="flex-1 overflow-auto custom-scrollbar relative" 
            onScroll={handleScroll}
          >
            <div 
              ref={timelineRef}
              className="relative min-h-full" 
              style={{ 
                width: `${totalWidth}px`,
                backgroundImage: `
                  linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), 
                  linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
                `,
                backgroundSize: `100% 80px, ${pixelsPerSecond}px 100%`
              }}
              onClick={handleTimelineClick}
            >
              {/* Playhead Line (Barra roja movible) */}
              <div
                className="playhead-hit-area"
                style={{ left: `${playheadDisplayTime * pixelsPerSecond}px` }}
                onMouseDown={handlePlayheadMouseDown}
              >
                <div className="playhead-visual-line absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[2px] bg-red-500 transition-all pointer-events-none" />
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -mt-1 w-3 h-3 bg-red-500 rotate-45 shadow-[0_0_15px_rgba(239,68,68,0.8)] border border-white/20 pointer-events-none" />
              </div>

              {/* Grid Horizontal / Tracks Content */}
              <div className="flex flex-col">
                {(timeline?.tracks || []).map((track) => {
                  const isEffectsTrack = track.name === 'Pista de efectos';
                  return (
                  <div
                    key={track.id}
                    className={`${isEffectsTrack ? 'h-12 overflow-hidden' : 'h-20'} border-b border-gray-800/80 relative group transition-colors ${
                      track.isLocked ? 'bg-gray-900/60' : 'bg-gray-900/10 hover:bg-white/[0.02]'
                    } ${isEffectsTrack ? 'bg-emerald-950/20' : ''}`}
                  >
                    {/* Visual de fondo de pista */}
                    <div className="absolute inset-0 opacity-10 pointer-events-none bg-gradient-to-r from-gray-800 to-transparent" />
                    
                    {/* Clips de la pista */}
                    {(track.clips || []).map((clip, idx) => renderClip(clip, track, idx))}
                    {mergeHighlight && mergeHighlight.trackId === track.id && (
                      <div
                        className="pointer-events-none absolute top-0 bottom-0 w-[3px] -translate-x-1/2 bg-emerald-400/80 shadow-[0_0_12px_rgba(16,185,129,0.6)]"
                        style={{ left: `${mergeHighlight.time * pixelsPerSecond}px` }}
                      />
                    )}
                  </div>
                  );
                })}
              </div>
              
              {/* Espacio para nuevas pistas */}
              <div className="h-40 w-full bg-transparent" />
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Modal de configuración del clip - no se muestra durante reproducción para evitar interferencias */}
    {clipSettingsClipId && !isPlayingProp && (() => {
      const clip = timeline?.tracks?.flatMap(t => t.clips).find(c => c.id === clipSettingsClipId);
      const track = clip ? timeline?.tracks?.find(t => t.clips.some(c => c.id === clip.id)) : null;
      if (!clip || !onUpdateClip || track?.isLocked || clip.locked) return null;
      const vol = clip.volume ?? 1;
      const rate = clip.playbackRate ?? 1;
      const isObjectOverlay = clip.overlayKind === 'object';
      const insidePlayer = !!clipSettingsModalContainerRef?.current;
      const modalContent = (
        <div
          className={insidePlayer
            ? 'fixed left-4 top-1/2 -translate-y-1/2 z-[99999] pointer-events-none'
            : 'fixed inset-0 z-[99999] flex items-center justify-start pl-4 bg-transparent pointer-events-none'}
          aria-hidden
        >
          <div
            className="bg-gray-950 border border-green-500 rounded-xl shadow-2xl p-5 w-[min(320px,90vw)] pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-green-500" />
              {t('videoEditor.timeline.configTitle')}
            </h3>
            <div className="space-y-4">
              {(track?.name === 'Pista de efectos' || track?.type === 'video' || track?.type === 'text') && (
                <div>
                  <label className="text-sm text-gray-400 block mb-1">{t('videoEditor.timeline.opacity')}</label>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[Math.round((clip.opacity ?? 1) * 100)]}
                      onValueChange={([v]) => onUpdateClip(clip.id, { opacity: v / 100 })}
                      min={0}
                      max={100}
                      step={1}
                      className="flex-1"
                    />
                    <span className="text-xs text-gray-500 w-10">{Math.round((clip.opacity ?? 1) * 100)}%</span>
                  </div>
                </div>
              )}
              {track?.name === 'Pista de efectos' && !isObjectOverlay ? (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">{t('videoEditor.timeline.tint')}</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={clip.overlayTint || 'none'}
                        onChange={(e) => onUpdateClip(clip.id, { overlayTint: e.target.value === 'none' ? null : e.target.value })}
                        className="flex-1 min-w-[120px] px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm"
                      >
                        <option value="none">{t('videoEditor.timeline.none')}</option>
                        <option value="#fff8e7">{t('videoEditor.timeline.warm')}</option>
                        <option value="#e8f4ff">{t('videoEditor.timeline.cold')}</option>
                        <option value="#f0e6ff">{t('videoEditor.timeline.violet')}</option>
                        <option value="#e8fff0">{t('videoEditor.timeline.green')}</option>
                        <option value="#ffe8e8">{t('videoEditor.timeline.pink')}</option>
                        <option value="#f5f0e6">{t('videoEditor.timeline.sepia')}</option>
                      </select>
                      {clip.overlayTint && (
                        <input
                          type="color"
                          value={clip.overlayTint}
                          onChange={(e) => onUpdateClip(clip.id, { overlayTint: e.target.value })}
                          className="w-10 h-9 rounded border border-gray-600 cursor-pointer bg-gray-800"
                          title={t('videoEditor.timeline.pickColor')}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ) : track?.name === 'Pista de efectos' && isObjectOverlay ? (
                <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-[11px] text-blue-200">
                  {t('videoEditor.timeline.objectHint')}
                </div>
              ) : track?.type !== 'text' ? (
              <div>
                <label className="text-sm text-gray-400 block mb-1">{t('videoEditor.timeline.volumeLabel')}</label>
                <div className="flex items-center gap-3">
                  <Volume2 className="w-4 h-4 text-gray-500 shrink-0" />
                  <Slider
                    value={[Math.round(vol * 100)]}
                    onValueChange={([v]) => onUpdateClip(clip.id, { volume: v / 100 })}
                    min={0}
                    max={100}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-500 w-10">{Math.round(vol * 100)}%</span>
                </div>
              </div>
              ) : null}
              {isObjectOverlay || track?.type === 'text' ? (
              <div>
                <label className="text-sm text-gray-400 block mb-1">{t('videoEditor.timeline.durationLabel')}</label>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={clip.duration ?? 0}
                  onChange={(e) => {
                    const v = Math.max(0.1, parseFloat(e.target.value) || 0.1);
                    onUpdateClip(clip.id, { duration: v });
                  }}
                  className="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm"
                />
                <p className="text-[10px] text-gray-500 mt-0.5">{t('videoEditor.timeline.durationHint')}</p>
              </div>
              ) : (
              <div>
                <label className="text-sm text-gray-400 block mb-1">{t('videoEditor.timeline.speedLabel')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0.25}
                    max={4}
                    step={0.01}
                    value={rate}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      // La duración se recalcula sola en handleUpdateClip desde esta
                      // velocidad, para que el clip cubra todo su contenido de origen.
                      if (!isNaN(v) && v >= 0.25 && v <= 4) onUpdateClip(clip.id, { playbackRate: v });
                    }}
                    className="w-20 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm"
                  />
                  <span className="text-xs text-gray-500">x (0.25 – 4)</span>
                </div>
                <p className="text-[10px] text-gray-500 mt-0.5">{t('videoEditor.timeline.speedHint')}</p>
              </div>
              )}
              {track?.type === 'video' && (
                <div className="flex items-center justify-between gap-3 py-1">
                  <div className="flex-1">
                    <label className="text-sm text-gray-300 block">{t('videoEditor.timeline.reversed')}</label>
                    <p className="text-[10px] text-gray-500 mt-0.5">{t('videoEditor.timeline.reversedHint')}</p>
                  </div>
                  <Switch
                    checked={!!clip.reversed}
                    onCheckedChange={(v) => onUpdateClip(clip.id, { reversed: v })}
                  />
                </div>
              )}
              {(track?.type === 'video' || track?.type === 'image') && (
                <div className="flex items-center justify-between gap-3 py-1">
                  <div className="flex-1">
                    <label className="text-sm text-gray-300 block">{t('videoEditor.timeline.mirrored')}</label>
                    <p className="text-[10px] text-gray-500 mt-0.5">{t('videoEditor.timeline.mirroredHint')}</p>
                  </div>
                  <Switch
                    checked={!!clip.mirrored}
                    onCheckedChange={(v) => onUpdateClip(clip.id, { mirrored: v })}
                  />
                </div>
              )}
              {track?.type === 'video' && (clip.speedZones?.length ?? 0) > 0 && (
                <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-500/30">
                  <div className="flex items-center gap-2 text-violet-300 text-sm font-medium mb-1">
                    <Timer className="w-4 h-4 shrink-0" />
                    {t('videoEditor.timeline.speedZonesTitle', { n: clip.speedZones!.length })}
                  </div>
                  <p className="text-[11px] text-gray-400">{t('videoEditor.timeline.speedZonesHint')}</p>
                </div>
              )}
              {(track?.type === 'video' || track?.type === 'audio' || track?.name === 'Pista de efectos' || track?.type === 'text') && (
                <>
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">{t('videoEditor.timeline.fadeIn')}</label>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, (clip.duration ?? 10) / 2)}
                      step={0.1}
                      value={clip.fadeInDuration ?? 0}
                      onChange={(e) => {
                        const v = Math.max(0, parseFloat(e.target.value) || 0);
                        onUpdateClip(clip.id, { fadeInDuration: v });
                      }}
                      className="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm"
                    />
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {isObjectOverlay || track?.type === 'text'
                        ? t('videoEditor.timeline.fadeInObjHint')
                        : track?.name === 'Pista de efectos'
                        ? t('videoEditor.timeline.fadeInFxHint')
                        : t('videoEditor.timeline.fadeInHint')}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">{t('videoEditor.timeline.fadeOut')}</label>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, (clip.duration ?? 10) / 2)}
                      step={0.1}
                      value={clip.fadeOutDuration ?? 0}
                      onChange={(e) => {
                        const v = Math.max(0, parseFloat(e.target.value) || 0);
                        onUpdateClip(clip.id, { fadeOutDuration: v });
                      }}
                      className="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm"
                    />
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {isObjectOverlay || track?.type === 'text'
                        ? t('videoEditor.timeline.fadeOutObjHint')
                        : track?.name === 'Pista de efectos'
                        ? t('videoEditor.timeline.fadeOutFxHint')
                        : t('videoEditor.timeline.fadeOutHint')}
                    </p>
                  </div>
                </>
              )}
            </div>
            <div className="mt-5 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setClipSettingsClipId(null)}
                className="border-2 border-green-500 bg-black text-green-400 hover:bg-green-500/20"
              >
                {t('videoEditor.timeline.close')}
              </Button>
            </div>
          </div>
        </div>
      );
      if (typeof document !== 'undefined' && document.body) {
        return createPortal(modalContent, document.body);
      }
      return modalContent;
    })()}


    {/* Modal Estirar zona */}
    {stretchZoneOpen && onStretchZone && (() => {
      const selClip = timeline?.tracks?.flatMap(t => t.clips).find(c => c.id === selectedClip);
      const selDur = selClip?.duration ?? 0;
      return (
      <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70" onClick={() => setStretchZoneOpen(false)}>
        <div className="bg-gray-950 border-2 border-violet-500 rounded-xl shadow-2xl p-6 w-[min(360px,90vw)]" onClick={e => e.stopPropagation()}>
          <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
            <Timer className="w-5 h-5 text-violet-400" />
            {t('videoEditor.timeline.stretchTitle2')}
          </h3>
          {selClip ? (
            <p className="text-[11px] text-violet-300 mb-3">{t('videoEditor.timeline.stretchSelInfoA', { dur: selDur.toFixed(1) })} <b>{t('videoEditor.timeline.stretchSelInfoB')}</b>{t('videoEditor.timeline.stretchSelInfoC', { max: selDur.toFixed(1) })}</p>
          ) : (
            <p className="text-[11px] text-amber-400 mb-3">{t('videoEditor.timeline.noClipSel')}</p>
          )}
          <p className="text-[11px] text-gray-500 mb-4">{t('videoEditor.timeline.stretchHelp')}</p>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1">{t('videoEditor.timeline.fromLabel')}</label>
              <input
                type="text"
                value={stretchFrom}
                onChange={e => setStretchFrom(e.target.value)}
                placeholder={`0 a ${selDur.toFixed(1)}`}
                className="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">{t('videoEditor.timeline.toLabel')}</label>
              <input
                type="text"
                value={stretchTo}
                onChange={e => setStretchTo(e.target.value)}
                placeholder={`hasta ${selDur.toFixed(1)}`}
                className="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">{t('videoEditor.timeline.newDurLabel')}</label>
              <input
                type="text"
                value={stretchNewDuration}
                onChange={e => setStretchNewDuration(e.target.value)}
                placeholder={t('videoEditor.timeline.newDurPlaceholder')}
                className="w-full px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm"
              />
              <p className="text-[10px] text-gray-500 mt-0.5">{t('videoEditor.timeline.newDurHint')}</p>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setStretchZoneOpen(false)} className="border-gray-600 text-gray-400">
              {t('videoEditor.timeline.cancel')}
            </Button>
            <Button size="sm" onClick={handleApplyStretchZone} className="bg-violet-600 hover:bg-violet-500 text-white">
              {t('videoEditor.timeline.apply')}
            </Button>
          </div>
        </div>
      </div>
      );
    })()}
    </>
  );
}
