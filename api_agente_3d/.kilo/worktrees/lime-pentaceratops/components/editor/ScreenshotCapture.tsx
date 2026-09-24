'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Camera, Video, Monitor, Chrome, Settings2, Mic, Volume2, Clock, Crop, Keyboard } from 'lucide-react';
import { TimelineClip, TrackType } from '@/types';
import { getDesktopSources, isElectron } from '@/lib/electron-fs';
import { screenRecorder, getQualitySettings, type CaptureSettings, type RecorderState } from '@/lib/screen-capture-recorder';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/lib/i18n';

interface ScreenshotCaptureProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef?: React.RefObject<HTMLCanvasElement>;
  onAddClipToTimeline: (clip: Omit<TimelineClip, 'id' | 'trackId'>) => void;
  currentTime: number;
  onStreamChange?: (stream: MediaStream | null) => void;
  isPreviewAudioMuted: boolean;
  onPreviewAudioMutedChange: (muted: boolean) => void;
}

type CaptureMode = 'image' | 'video';
type CaptureSource = 'none' | 'screen' | 'window' | 'browser';

interface DesktopSource {
  id: string;
  name: string;
  display_id?: string;
  thumbnail?: string | null;
  appIcon?: string | null;
  type: 'screen' | 'window';
}

export default function ScreenshotCapture({
  videoRef,
  canvasRef,
  onAddClipToTimeline,
  currentTime,
  onStreamChange,
  isPreviewAudioMuted,
  onPreviewAudioMutedChange
}: ScreenshotCaptureProps): JSX.Element {
  const { toast } = useToast();
  const { t } = useI18n();
  // Estado local del modo imagen (instantáneo, no sobrevive a la navegación).
  const [isCapturing, setIsCapturing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('image');
  const [captureSource, setCaptureSource] = useState<CaptureSource>('none');
  const [settings, setSettings] = useState<CaptureSettings>({
    quality: 'high',
    imageFormat: 'png',
    videoFormat: 'mp4',
    duration: 5,
    recordSystemAudio: true,
    recordMicrophone: true,
    manualStop: true,
    selectRegion: false
  });

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionRect, setSelectionRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  // Stream efímero del modo imagen/zona (no se comparte con el singleton).
  const [currentStream, setCurrentStream] = useState<MediaStream | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const livePreviewRef = useRef<HTMLVideoElement>(null);
  const dragStart = useRef<{ x: number, y: number } | null>(null);

  const electron = isElectron();
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [sourceFilter, setSourceFilter] = useState<'screen' | 'window'>('screen');
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [loadingSources, setLoadingSources] = useState(false);

  // Suscripción al singleton: el estado de la grabación de vídeo sobrevive a la
  // navegación entre editores (el MediaRecorder vive en el módulo, no aquí).
  const [snapshot, setSnapshot] = useState<RecorderState>(screenRecorder.getState());
  useEffect(() => {
    screenRecorder.setAddClip(onAddClipToTimeline);
    screenRecorder.setToast((t) => toast(t));
    const unsub = screenRecorder.subscribe(setSnapshot);
    return () => {
      screenRecorder.setAddClip(null);
      screenRecorder.setToast(null);
      unsub();
      // NO paramos el recorder al desmontar: es el punto, que siga grabando
      // aunque el usuario cambie de editor.
    };
  }, [onAddClipToTimeline, toast]);

  // Atajos de teclado configurables (Iniciar / Pausar-Reanudar / Detener).
  const [shortcuts, setShortcuts] = useState<{ start: string; pause: string; stop: string }>(() => {
    try {
      const s = localStorage.getItem('zeus_capture_shortcuts');
      if (s) return JSON.parse(s);
    } catch {}
    return { start: 'Ctrl+Alt+R', pause: 'Ctrl+Alt+P', stop: 'Ctrl+Alt+T' };
  });
  const [listeningFor, setListeningFor] = useState<'start' | 'pause' | 'stop' | null>(null);
  const shortcutsRef = useRef(shortcuts); shortcutsRef.current = shortcuts;
  const listeningForRef = useRef(listeningFor); listeningForRef.current = listeningFor;

  // El modo Vídeo se controla desde el singleton; el modo imagen desde aquí.
  const videoRecording = snapshot.isCapturing && snapshot.captureMode === 'video';
  const anyCapturing = videoRecording || isCapturing;
  const activeCaptureMode: CaptureMode = videoRecording ? 'video' : captureMode;

  const actionsRef = useRef<{
    isCapturing: boolean; captureMode: CaptureMode; handleCapture: () => void;
    stop: () => void; togglePause: () => void;
  }>({ isCapturing: false, captureMode: 'image', handleCapture: () => {}, stop: () => {}, togglePause: () => {} });

  // En Electron, enumerar pantallas y ventanas con desktopCapturer.
  const refreshSources = useCallback(async (filter: 'screen' | 'window') => {
    if (!electron) return;
    setLoadingSources(true);
    try {
      const list = await getDesktopSources([filter]);
      const tagged: DesktopSource[] = (list || []).map((s) => ({ ...s, type: filter }));
      setSources(tagged);
      setSelectedSourceId(tagged[0]?.id || '');
    } catch {
      setSources([]);
      setSelectedSourceId('');
    } finally {
      setLoadingSources(false);
    }
  }, [electron]);

  useEffect(() => {
    if (electron) refreshSources(sourceFilter);
  }, [electron, sourceFilter, refreshSources]);

  useEffect(() => {
    if (!isSelecting || !previewVideoRef.current || !selectionCanvasRef.current) return;
    const updateCanvasSize = () => {
      const video = previewVideoRef.current;
      const canvas = selectionCanvasRef.current;
      if (video && canvas) {
        const rect = video.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };
    const resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(previewVideoRef.current);
    updateCanvasSize();
    return () => resizeObserver.disconnect();
  }, [isSelecting]);

  const updateSetting = <K extends keyof CaptureSettings>(key: K, value: CaptureSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  // Limpiar el stream efímero del modo imagen/zona (no toca la grabación de vídeo).
  const cleanupAll = useCallback(() => {
    if (screenRecorder.isRecording()) { screenRecorder.stop(); return; }
    setIsSelecting(false);
    setIsCapturing(false);
    if (currentStream) {
      currentStream.getTracks().forEach(t => { t.stop(); t.enabled = false; });
    }
    setCurrentStream(null);
    if (onStreamChange) onStreamChange(null);
  }, [currentStream, onStreamChange]);

  // Convierte un KeyboardEvent en un combo normalizado "Ctrl+Alt+R" (o null si sólo modificadores).
  const comboFromEvent = (e: KeyboardEvent): string | null => {
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    let k = e.key === ' ' ? 'Space' : e.key;
    if (k.length === 1) k = k.toUpperCase();
    parts.push(k);
    return parts.join('+');
  };

  const captureImage = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const src = video.currentSrc || video.src;
    const isLocal = !src || src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('file:');
    let target = video;

    if (!isLocal && !video.crossOrigin && (src.startsWith('http:') || src.startsWith('https:'))) {
      const cloned = document.createElement('video');
      cloned.crossOrigin = 'anonymous';
      cloned.src = src;
      cloned.muted = true;
      cloned.playsInline = true;
      cloned.currentTime = video.currentTime;
      await new Promise<void>((resolve) => {
        cloned.onloadeddata = () => resolve();
        cloned.oncanplay = () => resolve();
        cloned.onerror = () => resolve();
        setTimeout(() => resolve(), 600);
      });
      target = cloned;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || target.videoWidth || 1920;
    canvas.height = video.videoHeight || target.videoHeight || 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      ctx.drawImage(target, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL(`image/${settings.imageFormat}`, 1.0);
      onAddClipToTimeline({
        type: 'video' as TrackType,
        startTime: currentTime, duration: 3,
        mediaFileId: url, thumbnailUrl: url,
        label: t('videoEditor.capture.clipLabel'), opacity: 1, volume: 1, overlayTint: null,
        // @ts-ignore
        scale: 1, fit: 'none', isFullRes: true
      });
      saveToDisk(url, 'captura_local');
      toast({ title: t('videoEditor.capture.done') });
    } catch (e) {
      toast({
        title: t('videoEditor.capture.error'),
        description: t('videoEditor.capture.errorCors'),
        variant: "destructive"
      });
    }
  }, [videoRef, currentTime, onAddClipToTimeline, toast, settings.imageFormat]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!selectionCanvasRef.current) return;
    const rect = selectionCanvasRef.current.getBoundingClientRect();
    dragStart.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setSelectionRect({ x: dragStart.current.x, y: dragStart.current.y, w: 0, h: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStart.current || !selectionCanvasRef.current) return;
    const rect = selectionCanvasRef.current.getBoundingClientRect();
    const curX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const curY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    setSelectionRect({
      x: Math.min(dragStart.current.x, curX),
      y: Math.min(dragStart.current.y, curY),
      w: Math.abs(curX - dragStart.current.x),
      h: Math.abs(curY - dragStart.current.y)
    });
  };

  const saveToDisk = (dataUrl: string, label: string, formatOverride?: string) => {
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.href = dataUrl;
    const extension = formatOverride || settings.imageFormat;
    link.download = `zeus_${label.toLowerCase().replace(/\s+/g, '_')}_${timestamp}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: t('videoEditor.capture.savedDisk'), description: t('videoEditor.capture.savedDiskDesc') });
  };

  const confirmRegionCapture = async () => {
    if (!previewVideoRef.current || selectionRect.w < 2 || selectionRect.h < 2) return;
    const video = previewVideoRef.current;
    const videoRect = video.getBoundingClientRect();
    const scaleX = video.videoWidth / videoRect.width;
    const scaleY = video.videoHeight / videoRect.height;

    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = Math.round(selectionRect.w * scaleX);
    resultCanvas.height = Math.round(selectionRect.h * scaleY);
    const ctx = resultCanvas.getContext('2d', { alpha: false });
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(video, selectionRect.x * scaleX, selectionRect.y * scaleY, selectionRect.w * scaleX, selectionRect.h * scaleY, 0, 0, resultCanvas.width, resultCanvas.height);
      const url = resultCanvas.toDataURL(`image/${settings.imageFormat}`, 1.0);

      onAddClipToTimeline({
        type: 'video' as TrackType,
        startTime: currentTime, duration: 3,
        mediaFileId: url, thumbnailUrl: url,
        label: t('videoEditor.capture.zoneLabel', { w: resultCanvas.width, h: resultCanvas.height }),
        opacity: 1, volume: 1, overlayTint: null,
        // @ts-ignore
        scale: 1, fit: 'none', isFullRes: true
      });

      saveToDisk(url, 'recorte_zona');
      toast({ title: t('videoEditor.capture.cropDone') });
    }
    cleanupAll();
  };

  // Captura de imagen desde un stream (modo imagen, sin selección de zona).
  const processImageCapture = useCallback((stream: MediaStream) => {
    const v = document.createElement('video');
    v.srcObject = stream;
    v.onloadeddata = async () => {
      await new Promise(r => setTimeout(r, 700));
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext('2d', { alpha: false });
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const url = c.toDataURL(`image/${settings.imageFormat}`, 1.0);

        onAddClipToTimeline({
          type: 'video' as TrackType,
          startTime: currentTime, duration: 3,
          mediaFileId: url, thumbnailUrl: url,
          label: t('videoEditor.capture.fullLabel', { w: v.videoWidth, h: v.videoHeight }),
          opacity: 1, volume: 1, overlayTint: null,
          // @ts-ignore
          scale: 1, fit: 'none', isFullRes: true
          });

        saveToDisk(url, 'captura_pantalla');
      }
      cleanupAll();
    };
    v.play();
  }, [settings.imageFormat, currentTime, onAddClipToTimeline, cleanupAll]);

  const handleCapture = useCallback(async () => {
    if (captureSource === 'none') { captureImage(); return; }

    // Modo Vídeo: delega al singleton (sobrevive a la navegación entre editores).
    if (captureMode === 'video') {
      if (electron && !selectedSourceId) {
        toast({
          title: t('videoEditor.capture.selectSource'),
          description: t('videoEditor.capture.selectSourceDesc'),
          variant: "destructive",
          duration: 5000,
        });
        return;
      }
      const res = await screenRecorder.start({
        settings, electron, selectedSourceId, startTime: Date.now(),
      });
      if (!res.ok && res.error && res.error !== 'Ya hay una grabación en curso') {
        toast({ title: t('videoEditor.capture.startFail'), description: res.error, variant: "destructive" });
      }
      return;
    }

    // Modo imagen: stream efímero en el componente (instantáneo).
    setIsCapturing(true);
    try {
      let stream: MediaStream;

      if (electron) {
        if (!selectedSourceId) {
          toast({
            title: t('videoEditor.capture.selectSource'),
            description: t('videoEditor.capture.selectSourceDesc'),
            variant: "destructive",
            duration: 5000,
          });
          cleanupAll();
          return;
        }
        const q = getQualitySettings(settings.quality);
        stream = await (navigator as any).mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: selectedSourceId,
              maxFrameRate: 30,
              maxWidth: q.width,
              maxHeight: q.height,
            },
          },
        });
      } else {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          toast({
            title: t('videoEditor.capture.unavailable'),
            description: t('videoEditor.capture.unavailableDesc'),
            variant: "destructive",
            duration: 6000,
          });
          cleanupAll();
          return;
        }
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 3840, max: 3840 }, height: { ideal: 2160, max: 2160 }, frameRate: { ideal: 30 } },
          audio: false
        });
      }

      setCurrentStream(stream);
      if (onStreamChange) onStreamChange(stream);
      if (settings.selectRegion) {
        setIsSelecting(true);
      } else {
        processImageCapture(stream);
      }
    } catch (e) {
      console.error(e);
      cleanupAll();
    }
  }, [captureSource, captureMode, settings, electron, selectedSourceId, captureImage, processImageCapture, onStreamChange, cleanupAll, toast]);

  useEffect(() => {
    if (isSelecting && previewVideoRef.current && currentStream) {
      previewVideoRef.current.srcObject = currentStream;
      previewVideoRef.current.play().catch(console.error);
    }
  }, [isSelecting, currentStream]);

  // Live preview del modo Vídeo: lee el stream del singleton (sigue aunque el
  // componente se desmonte y se remonte al volver al editor de vídeo).
  useEffect(() => {
    if (livePreviewRef.current && videoRecording && snapshot.stream) {
      livePreviewRef.current.srcObject = snapshot.stream;
      livePreviewRef.current.play().catch(() => {});
    }
  }, [videoRecording, snapshot.stream]);

  // Atajos de teclado globales (ventana). Funciona mientras este editor está montado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (listeningForRef.current) {
        if (e.key === 'Escape') { setListeningFor(null); e.preventDefault(); return; }
        const combo = comboFromEvent(e);
        if (!combo) return;
        const which = listeningForRef.current;
        setShortcuts((prev) => {
          const next = { ...prev, [which]: combo };
          try { localStorage.setItem('zeus_capture_shortcuts', JSON.stringify(next)); } catch {}
          return next;
        });
        setListeningFor(null);
        e.preventDefault();
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      const tgt = e.target as HTMLElement | null;
      const inText = !!(tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable));
      if (inText && !(e.ctrlKey || e.altKey || e.metaKey)) return;
      const sc = shortcutsRef.current;
      const a = actionsRef.current;
      if (combo === sc.start && !a.isCapturing) { e.preventDefault(); a.handleCapture(); }
      else if (combo === sc.stop && a.isCapturing) { e.preventDefault(); a.stop(); }
      else if (combo === sc.pause && a.isCapturing && a.captureMode === 'video') { e.preventDefault(); a.togglePause(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Mantener actionsRef al día para que el listener (mount-once) vea siempre el estado actual.
  actionsRef.current = {
    isCapturing: anyCapturing,
    captureMode: activeCaptureMode,
    handleCapture,
    stop: cleanupAll,
    togglePause: () => screenRecorder.togglePause(),
  };

  return (
    <div className="flex flex-col space-y-4 p-4 bg-background border rounded-lg">
      {isSelecting && (
        <div className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center p-4">
          <div className="text-white mb-4 bg-emerald-600 px-4 py-1 rounded-full text-sm font-bold animate-pulse">
            {t('videoEditor.capture.selectExact')}
          </div>
          <div className="relative border-2 border-emerald-500 bg-black max-w-full max-h-[80vh] overflow-hidden shadow-2xl">
            <video ref={previewVideoRef} className="block max-w-full max-h-[80vh] object-contain" muted={isPreviewAudioMuted} />
            <canvas
              ref={selectionCanvasRef}
              className="absolute inset-0 cursor-crosshair z-10"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={() => dragStart.current = null}
            />
            <div className="absolute border-2 border-emerald-400 bg-emerald-500/10 pointer-events-none z-20 shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]"
                 style={{ left: selectionRect.x, top: selectionRect.y, width: selectionRect.w, height: selectionRect.h }} />
          </div>
          <div className="mt-6 flex gap-4">
            <Button variant="outline" className="bg-white/10 text-white border-white/20 hover:bg-red-600" onClick={cleanupAll}>{t('videoEditor.capture.cancel')}</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 font-bold" onClick={confirmRegionCapture}>{t('videoEditor.capture.captureSelection')}</Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Camera className="w-4 h-4 text-emerald-500" /> {t('videoEditor.capture.tab')}</h3>
        <Button variant="ghost" size="sm" onClick={() => setShowSettings(!showSettings)}><Settings2 className="w-4 h-4" /></Button>
      </div>

      {showSettings && (
        <div className="grid grid-cols-1 gap-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-md border text-xs mb-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t('videoEditor.capture.quality')}</Label>
              <Select value={settings.quality} onValueChange={(v: any) => updateSetting('quality', v)}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">720p</SelectItem>
                  <SelectItem value="medium">1080p</SelectItem>
                  <SelectItem value="high">1440p</SelectItem>
                  <SelectItem value="ultra">4K</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('videoEditor.capture.format')}</Label>
              <Select value={captureMode === 'image' ? settings.imageFormat : settings.videoFormat} onValueChange={(v: any) => updateSetting(captureMode === 'image' ? 'imageFormat' : 'videoFormat', v)}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{captureMode === 'image' ? (<><SelectItem value="png">PNG</SelectItem><SelectItem value="jpeg">JPEG</SelectItem></>) : (<><SelectItem value="mp4">MP4</SelectItem><SelectItem value="webm">WebM</SelectItem></>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><Crop className="w-3 h-3" /> {t('videoEditor.capture.cropZone')}</Label>
              <Switch checked={settings.selectRegion} onCheckedChange={(v) => updateSetting('selectRegion', v)} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><Mic className="w-3 h-3" /> {t('videoEditor.capture.mic')}</Label>
              <Switch checked={settings.recordMicrophone} onCheckedChange={(v) => updateSetting('recordMicrophone', v)} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><Volume2 className="w-3 h-3" /> {t('videoEditor.capture.systemAudio')}</Label>
              <Switch checked={settings.recordSystemAudio} onCheckedChange={(v) => updateSetting('recordSystemAudio', v)} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><Monitor className="w-3 h-3" /> {t('videoEditor.capture.mutePreview')}</Label>
              <Switch checked={isPreviewAudioMuted} onCheckedChange={onPreviewAudioMutedChange} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> {t('videoEditor.capture.manualStop')}</Label>
              <Switch checked={settings.manualStop} onCheckedChange={(v) => updateSetting('manualStop', v)} />
            </div>
            {!settings.manualStop && (
              <div className="space-y-1">
                <Label>{t('videoEditor.capture.durationSec')}</Label>
                <input type="number" value={settings.duration} onChange={(e) => updateSetting('duration', parseInt(e.target.value))} className="w-full h-7 px-2 bg-background border rounded text-xs" />
              </div>
            )}
          </div>

          {/* Atajos de teclado configurables */}
          <div className="space-y-2 pt-3 border-t">
            <Label className="flex items-center gap-1.5 text-xs font-semibold"><Keyboard className="w-3.5 h-3.5" /> {t('videoEditor.capture.shortcuts')}</Label>
            <p className="text-[10px] text-gray-500 leading-snug">{t('videoEditor.capture.shortcutsHelp')}</p>
            {([
              { key: 'start' as const, label: t('videoEditor.capture.start') },
              { key: 'pause' as const, label: t('videoEditor.capture.pauseResume') },
              { key: 'stop' as const, label: t('videoEditor.capture.stop') },
            ]).map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-2">
                <Label className="text-[11px] text-gray-300">{row.label}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setListeningFor(row.key)}
                  className={`h-7 px-2 text-[11px] font-mono ${listeningFor === row.key ? 'border-emerald-500 text-emerald-400 animate-pulse' : 'border-gray-600 text-gray-200'}`}
                >
                  {listeningFor === row.key ? t('videoEditor.capture.pressKey') : shortcuts[row.key]}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant={captureMode === 'image' ? 'default' : 'outline'} size="sm" onClick={() => setCaptureMode('image')} className="text-xs h-8">{t('videoEditor.capture.photo')}</Button>
        <Button variant={captureMode === 'video' ? 'default' : 'outline'} size="sm" onClick={() => setCaptureMode('video')} className="text-xs h-8">{t('videoEditor.capture.video')}</Button>
        {electron ? (
          <>
            <Button variant={captureSource === 'screen' ? 'default' : 'outline'} size="sm" onClick={() => { setCaptureSource('screen'); setSourceFilter('screen'); }} className="text-xs h-8"><Monitor className="w-3.5 h-3.5 inline mr-1" />{t('videoEditor.capture.screen')}</Button>
            <Button variant={captureSource === 'window' ? 'default' : 'outline'} size="sm" onClick={() => { setCaptureSource('window'); setSourceFilter('window'); }} className="text-xs h-8"><Chrome className="w-3.5 h-3.5 inline mr-1" />{t('videoEditor.capture.window')}</Button>
          </>
        ) : (
          <>
            <Button variant={captureSource === 'screen' ? 'default' : 'outline'} size="sm" onClick={() => setCaptureSource('screen')} className="text-xs h-8">{t('videoEditor.capture.desktop')}</Button>
            <Button variant={captureSource === 'browser' ? 'default' : 'outline'} size="sm" onClick={() => setCaptureSource('browser')} className="text-xs h-8">{t('videoEditor.capture.browserTab')}</Button>
          </>
        )}
        <Button variant={captureSource === 'none' ? 'default' : 'outline'} size="sm" onClick={() => setCaptureSource('none')} className="text-xs h-8 col-span-2">{t('videoEditor.capture.playerFrame')}</Button>
      </div>

      {electron && captureSource !== 'none' && (
        <div className="space-y-1.5">
          <Label className="text-xs">{t('videoEditor.capture.captureFrom', { source: sourceFilter === 'screen' ? t('videoEditor.capture.screen') : t('videoEditor.capture.window') })}</Label>
          <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={loadingSources ? t('videoEditor.capture.loading') : t('videoEditor.capture.chooseSource')} /></SelectTrigger>
            <SelectContent>
              {sources.length === 0 && !loadingSources && (
                <SelectItem value="__none__" disabled>{t('videoEditor.capture.noSources')}</SelectItem>
              )}
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sources.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-1 max-h-32 overflow-y-auto">
              {sources.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedSourceId(s.id)}
                  className={`relative w-24 h-14 rounded overflow-hidden border-2 ${selectedSourceId === s.id ? 'border-emerald-500' : 'border-gray-600 hover:border-emerald-500/50'}`}
                  title={s.name}
                >
                  {s.thumbnail ? <img src={s.thumbnail} alt={s.name} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gray-800" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {videoRecording && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className={`text-[10px] uppercase tracking-wider font-bold flex items-center gap-1.5 ${snapshot.isPaused ? 'text-amber-400' : 'text-emerald-400 animate-pulse'}`}>
              <span className={`w-2 h-2 rounded-full ${snapshot.isPaused ? 'bg-amber-500' : 'bg-red-500 animate-pulse'}`} />
              {snapshot.isPaused ? t('videoEditor.capture.paused') : t('videoEditor.capture.recLive')}
            </span>
            <span className="text-[10px] text-gray-400 tabular-nums">
              {snapshot.elapsedSec}s
            </span>
          </div>
          <div className="relative rounded-lg overflow-hidden border border-emerald-500/40 bg-black">
            <video ref={livePreviewRef} muted={isPreviewAudioMuted} autoPlay playsInline className="w-full max-h-[260px] object-contain block" />
          </div>
        </div>
      )}

      {anyCapturing ? (
        activeCaptureMode === 'video' ? (
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => screenRecorder.togglePause()} variant="outline" className="h-11 border-amber-500/60 text-amber-300 hover:bg-amber-500/10 font-semibold">
              {snapshot.isPaused ? t('videoEditor.capture.resume') : t('videoEditor.capture.pause')}
            </Button>
            <Button onClick={() => screenRecorder.stop()} className="h-11 bg-red-600 hover:bg-red-700 text-white font-semibold shadow-lg">
              {t('videoEditor.capture.stopBtn')}
            </Button>
          </div>
        ) : (
          <Button onClick={cleanupAll} className="w-full h-11 bg-red-600 hover:bg-red-700 text-white font-semibold shadow-lg">
            {t('videoEditor.capture.stopAndAdd')}
          </Button>
        )
      ) : (
        <Button onClick={handleCapture} className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-lg">
          {t('videoEditor.capture.startProcess')}
        </Button>
      )}

      <div className="text-[10px] text-gray-500 leading-snug text-center">
        {t('videoEditor.capture.shortcutsFooter', { start: shortcuts.start, pause: shortcuts.pause, stop: shortcuts.stop })}
      </div>
    </div>
  );
}