// Singleton module-level del motor de grabación de pantalla (modo Vídeo).
// Vive fuera del ciclo de vida de los componentes para que la grabación
// SOBREVIVA a los cambios de ruta entre editores (/edit-video → /edit-imagen → …).
// El MediaRecorder + stream + chunks se guardan aquí; el componente
// ScreenshotCapture es sólo UI que llama a start()/stop()/togglePause() y
// se suscribe al estado. Al parar, la grabación se guarda SIEMPRE al disco
// (carpeta de vídeo vía saveCapture). Si el editor de vídeo está montado,
// se añade al timeline (best-effort).
import { saveCapture, getMediaUrl, setCaptureOverlay, isElectron } from './electron-fs';
import type { TimelineClip, TrackType } from '@/types';

export type CaptureQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface CaptureSettings {
  quality: CaptureQuality;
  imageFormat: 'png' | 'jpeg' | 'webp';
  videoFormat: 'webm' | 'mp4';
  duration: number;
  recordSystemAudio: boolean;
  recordMicrophone: boolean;
  manualStop: boolean;
  selectRegion: boolean;
}

export interface RecorderState {
  isCapturing: boolean;
  isPaused: boolean;
  captureMode: 'video' | null;
  elapsedSec: number;
  stream: MediaStream | null;
}

export type AddClipFn = (clip: Omit<TimelineClip, 'id' | 'trackId'>) => void;
export type ToastFn = (t: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;

export function getQualitySettings(quality: CaptureQuality) {
  switch (quality) {
    case 'low': return { width: 1280, height: 720, jpegQuality: 0.8 };
    case 'medium': return { width: 1920, height: 1080, jpegQuality: 0.95 };
    case 'high': return { width: 2560, height: 1440, jpegQuality: 1.0 };
    case 'ultra': return { width: 3840, height: 2160, jpegQuality: 1.0 };
    default: return { width: 1920, height: 1080, jpegQuality: 0.95 };
  }
}

const initialState: RecorderState = {
  isCapturing: false,
  isPaused: false,
  captureMode: null,
  elapsedSec: 0,
  stream: null,
};

class ScreenCaptureRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private micRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private micChunks: Blob[] = [];
  private startTime = 0;
  private pauseStart = 0;
  private pausedMs = 0;
  private isPaused = false;
  private captureMode: 'video' | null = null;
  private settings: CaptureSettings | null = null;

  private timerId: number | null = null;
  private autoStopId: number | null = null;
  private state: RecorderState = { ...initialState };
  private listeners = new Set<(s: RecorderState) => void>();

  private addClip: AddClipFn | null = null;
  private toast: ToastFn | null = null;

  /** Registra el handler del VideoEditor para añadir clips al timeline. */
  setAddClip(fn: AddClipFn | null) { this.addClip = fn; }
  /** Registra un toast handler (del componente) para avisar al terminar. */
  setToast(fn: ToastFn | null) { this.toast = fn; }

  getState(): RecorderState { return { ...this.state }; }

  subscribe(fn: (s: RecorderState) => void): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => { this.listeners.delete(fn); };
  }

  private emit() {
    this.state = {
      isCapturing: !!this.recorder && this.recorder.state !== 'inactive',
      isPaused: this.isPaused,
      captureMode: this.captureMode,
      elapsedSec: this.state.elapsedSec,
      stream: this.stream,
    };
    const snap = this.getState();
    this.listeners.forEach((l) => l(snap));
  }

  isRecording(): boolean {
    return !!this.recorder && this.recorder.state !== 'inactive';
  }

  /** Pausar / reanudar la grabación. */
  togglePause() {
    const r = this.recorder;
    if (!r) return;
    if (r.state === 'recording') {
      r.pause();
      this.pauseStart = Date.now();
      this.isPaused = true;
      this.updateOverlay();
      this.emit();
    } else if (r.state === 'paused') {
      if (this.pauseStart) this.pausedMs += Date.now() - this.pauseStart;
      this.pauseStart = 0;
      r.resume();
      this.isPaused = false;
      this.updateOverlay();
      this.emit();
    }
  }

  /** Detener la grabación (dispara onstop → guarda al disco + añade al timeline). */
  stop() {
    const r = this.recorder;
    if (r && r.state !== 'inactive') {
      try { r.stop(); } catch {}
    }
  }

  /** Iniciar una grabación de pantalla en modo Vídeo. */
  async start(config: { settings: CaptureSettings; electron: boolean; selectedSourceId: string; startTime: number }): Promise<{ ok: boolean; error?: string }> {
    // No arrancar otra si ya hay una en curso.
    if (this.isRecording()) return { ok: false, error: 'Ya hay una grabación en curso' };

    const { settings, electron, selectedSourceId, startTime } = config;
    this.settings = settings;
    this.captureMode = 'video';
    this.chunks = [];
    this.micChunks = [];
    this.pausedMs = 0;
    this.pauseStart = 0;
    this.isPaused = false;
    this.startTime = startTime;

    let stream: MediaStream;
    try {
      if (electron) {
        if (!selectedSourceId) return { ok: false, error: 'Selecciona una fuente' };
        const q = getQualitySettings(settings.quality);
        stream = await (navigator as any).mediaDevices.getUserMedia({
          audio: settings.recordSystemAudio
            ? { mandatory: { chromeMediaSource: 'desktop' } }
            : false,
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
        if (!navigator.mediaDevices?.getDisplayMedia) return { ok: false, error: 'getDisplayMedia no soportado' };
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 3840, max: 3840 }, height: { ideal: 2160, max: 2160 }, frameRate: { ideal: 30 } },
          audio: settings.recordSystemAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
        });
      }
    } catch (e: any) {
      this.captureMode = null;
      return { ok: false, error: e?.message || 'No se pudo acceder a la fuente' };
    }

    this.stream = stream;

    if (settings.recordMicrophone) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch { this.micStream = null; }
    }

    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : (MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm');
    const q = getQualitySettings(settings.quality);
    const bitsPerSecond = q.width >= 3840 ? 32_000_000 : q.width >= 2560 ? 16_000_000 : 8_000_000;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitsPerSecond, audioBitsPerSecond: 192_000 });
    } catch (e: any) {
      this.cleanupStream();
      this.captureMode = null;
      return { ok: false, error: e?.message || 'No se pudo crear el MediaRecorder' };
    }
    this.recorder = recorder;

    if (this.micStream) {
      try {
        this.micRecorder = new MediaRecorder(this.micStream, { mimeType: 'audio/webm;codecs=opus' });
        this.micRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.micChunks.push(e.data); };
        this.micRecorder.start(100);
      } catch { this.micRecorder = null; }
    }

    recorder.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
    recorder.onstop = () => this.handleStop(mime);

    recorder.start();
    this.startTimer();
    // Parada automática por duración si no es parada manual.
    if (!settings.manualStop) {
      this.autoStopId = window.setTimeout(() => {
        if (this.recorder && this.recorder.state === 'recording') this.stop();
      }, settings.duration * 1000);
    }
    this.updateOverlay();
    this.emit();
    return { ok: true };
  }

  private async handleStop(mime: string) {
    if (this.micRecorder && this.micRecorder.state === 'recording') {
      try { this.micRecorder.stop(); } catch {}
    }
    const blob = new Blob(this.chunks, { type: mime });
    const paused = this.isPaused ? (Date.now() - this.pauseStart) : 0;
    const dur = Math.max(1, Math.round((Date.now() - this.startTime - this.pausedMs - paused) / 1000));
    const settings = this.settings;
    const ext = settings ? (settings.videoFormat === 'mp4' ? 'webm' : (settings.videoFormat || 'webm')) : 'webm';

    const videoUrl = await this.persistCaptureBlob(blob, ext);
    if (this.addClip) {
      try {
        this.addClip({
          type: 'video' as TrackType,
          startTime: 0, duration: dur,
          mediaFileId: videoUrl, thumbnailUrl: videoUrl,
          label: `Grabación Pantalla`, opacity: 1, volume: 1, overlayTint: null,
        });
      } catch {}
    }
    if (this.micChunks.length > 0) {
      const mBlob = new Blob(this.micChunks, { type: 'audio/webm;codecs=opus' });
      const mUrl = await this.persistCaptureBlob(mBlob, 'webm');
      if (this.addClip) {
        try {
          this.addClip({
            type: 'audio' as TrackType,
            startTime: 0, duration: dur,
            mediaFileId: mUrl, thumbnailUrl: videoUrl,
            label: `Micro`, opacity: 1, volume: 1, overlayTint: null,
          });
        } catch {}
      }
    }
    this.toast?.({ title: 'Grabación añadida', description: `${dur}s · guardada en tu carpeta de vídeo.` });

    this.cleanupStream();
    this.stopTimer();
    this.isPaused = false;
    this.captureMode = null;
    this.settings = null;
    this.updateOverlay();
    this.emit();
  }

  private cleanupStream() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
      this.stream = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
      this.micStream = null;
    }
    this.recorder = null;
    this.micRecorder = null;
  }

  private startTimer() {
    this.stopTimer();
    this.timerId = window.setInterval(() => {
      const paused = this.isPaused ? (Date.now() - this.pauseStart) : 0;
      this.state.elapsedSec = Math.max(0, Math.floor((Date.now() - this.startTime - this.pausedMs - paused) / 1000));
      const snap = this.getState();
      this.listeners.forEach((l) => l(snap));
    }, 1000);
  }

  private stopTimer() {
    if (this.timerId != null) { clearInterval(this.timerId); this.timerId = null; }
    if (this.autoStopId != null) { clearTimeout(this.autoStopId); this.autoStopId = null; }
    this.state.elapsedSec = 0;
  }

  // --- Overlay icon de la barra de tareas (Windows) ---
  private buildOverlayIcon(state: 'recording' | 'paused' | null): string | null {
    if (!state) return null;
    try {
      const c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.clearRect(0, 0, 32, 32);
      if (state === 'recording') {
        ctx.fillStyle = '#e23b3b';
        ctx.beginPath(); ctx.arc(16, 16, 12, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
      } else {
        ctx.fillStyle = '#f0a020';
        ctx.fillRect(8, 8, 5, 16);
        ctx.fillRect(19, 8, 5, 16);
      }
      return c.toDataURL('image/png');
    } catch { return null; }
  }

  private updateOverlay() {
    const state: 'recording' | 'paused' | null = this.isRecording() ? (this.isPaused ? 'paused' : 'recording') : null;
    const description = state === 'recording' ? 'Grabando pantalla' : state === 'paused' ? 'Grabación pausada' : '';
    setCaptureOverlay({ dataUrl: this.buildOverlayIcon(state), description });
  }

  /** Persiste un Blob de captura al disco (carpeta de vídeo) y devuelve una URL
   *  media:// que sobrevive al guardar .zeus. Si falla o no es Electron, devuelve blob:. */
  private async persistCaptureBlob(blob: Blob, ext: string): Promise<string> {
    const blobUrl = URL.createObjectURL(blob);
    if (!isElectron()) return blobUrl;
    try {
      const base64 = await this.blobToBase64(blob);
      const res = await saveCapture({ base64, ext });
      if (res && res.success && res.filePath) {
        URL.revokeObjectURL(blobUrl);
        return getMediaUrl(res.filePath);
      }
    } catch {}
    return blobUrl;
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const s = String(reader.result || '');
        const comma = s.indexOf(',');
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
}

export const screenRecorder = new ScreenCaptureRecorder();