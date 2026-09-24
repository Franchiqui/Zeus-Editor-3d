import { useRef, useCallback, useState } from 'react';

export interface ScreenRecorderState {
  isRecording: boolean;
  recordedBlob: Blob | null;
  error: string | null;
}

export function useScreenRecorder() {
  const [state, setState] = useState<ScreenRecorderState>({
    isRecording: false,
    recordedBlob: null,
    error: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      chunksRef.current = [];

      // En Electron podemos usar desktopCapturer; en navegador getDisplayMedia
      let stream: MediaStream;

      if (typeof window !== 'undefined' && (window as any).electronAPI?.getDesktopSourceId) {
        // Electron: obtener ID de la propia ventana para no mostrar diálogo
        const sourceId = await (window as any).electronAPI.getDesktopSourceId();
        stream = await (navigator as any).mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
            },
          },
        });
      } else {
        // Navegador: pedir al usuario que seleccione la pestaña/ventana del preview
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'browser' },
          audio: false,
        });
      }

      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setState((s) => ({ ...s, isRecording: false, recordedBlob: blob }));
        chunksRef.current = [];
        // Detener tracks del stream
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.onerror = (e) => {
        setState((s) => ({ ...s, isRecording: false, error: 'Error de grabación: ' + e }));
      };

      recorder.start(100); // recoger datos cada 100ms
      setState({ isRecording: true, recordedBlob: null, error: null });
      return true;
    } catch (err: any) {
      setState({ isRecording: false, recordedBlob: null, error: err?.message || 'Error iniciando grabación' });
      return false;
    }
  }, []);

  const stopRecording = useCallback(() => {
    return new Promise<Blob | null>((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(state.recordedBlob);
        return;
      }

      const check = () => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
          resolve(state.recordedBlob);
        } else {
          setTimeout(check, 200);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        setState((s) => ({ ...s, isRecording: false, recordedBlob: blob }));
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
        resolve(blob);
      };

      recorder.stop();
      setTimeout(check, 2000); // fallback
    });
  }, []);

  return { ...state, startRecording, stopRecording };
}
