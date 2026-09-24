import { useEffect, useRef, useCallback } from 'react';
import { TimelineState, TimelineClip } from '@/types';

interface TimelinePlayerProps {
  timeline: TimelineState | undefined;
  currentTime: number;
  isPlaying: boolean;
  onTimeUpdate: (time: number) => void;
  audioContext?: AudioContext;
  masterOutput?: AudioNode;
  /** Si es true, al llegar al final se detiene y queda en duration (no reinicia a 0). */
  stopAtEnd?: boolean;
   /** Si es true, al llegar al final se pone tiempo a 0, se para y se llama onReachedEnd. */
   resetToStartOnEnd?: boolean;
   /** Si es true, al llegar al final se reinicia a 0 y continúa reproduciendo (bucle). */
   loop?: boolean;
  /** Se llama cuando la reproducción llega al final. */
  onReachedEnd?: () => void;
  fileCache?: React.RefObject<Map<string, File>>;
  /**
   * Ref compartida donde el player escribe el currentTime a 60fps (en cada frame
   * del bucle de animación) SIN disparar un setEditState. La usa el canvas de preview
   * del VideoEditor para renderizar fotograma a fotograma a tiempo real; el estado
   * de React (onTimeUpdate) sigue limitado a ~15fps para no re-renderizar el editor.
   * Si no se pasa, el player funciona igual (sólo afecta al preview del editor).
   */
  previewTimeRef?: React.MutableRefObject<number>;
}

export default function TimelinePlayer({
  timeline,
  currentTime,
  isPlaying,
  onTimeUpdate,
  audioContext,
  masterOutput,
  stopAtEnd = false,
   resetToStartOnEnd = false,
   loop = false,
  onReachedEnd,
  fileCache,
  previewTimeRef
}: TimelinePlayerProps) {
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});
  const sourceNodes = useRef<{ [key: string]: MediaElementAudioSourceNode }>({});
  // Blob URLs creados desde fileCache, indexados por clipId. Se REUTILIZAN mientras
  // el clip exista y se revocan al eliminarlo; crear uno nuevo en cada pasada del
  // efecto (sin revocar el anterior) satura la memoria de blobs y acaba frenando
  // la reproducción tras un rato ("se queda pillado en un punto").
  const objectUrlsRef = useRef<Map<string, string>>(new Map());
  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const currentTimeRef = useRef<number>(currentTime);
  const isSyncing = useRef(false);
  // Throttle de la actualización del estado de React (onTimeUpdate -> setEditState):
  // el vídeo y el audio se reproducen de forma natural y se sincronizan por refs a
  // 60fps; el estado sólo mueve la interfaz (scrubber, overlays). Llamar a setEditState
  // 60 veces/seg re-renderiza todo el editor y bloquea el hilo -> el vídeo va a saltos.
  // Limitamos a ~15fps la actualización de UI.
  const lastUiUpdateRef = useRef<number>(0);

  // Refs para valores que cambian frecuentemente y no deberían reiniciar el efecto de animación
  const timelineRef = useRef(timeline);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onReachedEndRef = useRef(onReachedEnd);
  const stopAtEndRef = useRef(stopAtEnd);
   const resetToStartOnEndRef = useRef(resetToStartOnEnd);
   const loopRef = useRef(loop);

   // Actualizar refs en cada render
   timelineRef.current = timeline;
   onTimeUpdateRef.current = onTimeUpdate;
   onReachedEndRef.current = onReachedEnd;
   stopAtEndRef.current = stopAtEnd;
   resetToStartOnEndRef.current = resetToStartOnEnd;
   loopRef.current = loop;

  // Obtener clips activos (lee desde ref para evitar recreación de función)
  const getActiveClips = useCallback((time: number): TimelineClip[] => {
    return timelineRef.current?.tracks?.flatMap(track =>
      track.clips.filter(clip =>
        time >= clip.startTime && time < clip.startTime + clip.duration
      )
    ) || [];
  }, []);

  // Sincronizar elementos (volumen, tiempo, reproducción)
  const syncMedia = useCallback((time: number) => {
    if (isSyncing.current) return;
    isSyncing.current = true;

    const activeClips = getActiveClips(time);
    const activeClipIds = new Set(activeClips.map(c => c.id));

    // Pausar elementos que ya no están activos en este tiempo
    Object.keys(audioRefs.current).forEach(id => {
      if (!activeClipIds.has(id)) {
        const audio = audioRefs.current[id];
        if (audio && !audio.paused) audio.pause();
      }
    });

    // Sincronizar y reproducir clips activos
    activeClips.forEach(clip => {
      const audio = audioRefs.current[clip.id];
      if (!audio) return;

      const track = timelineRef.current?.tracks?.find(t => t.id === clip.trackId);

      // 1. GESTIÓN DE VOLUMEN
      const isMuted = (track?.isMuted) || (clip.volume === 0);
      const trackVolume = track?.volume ?? 1.0;
      const clipVolume = clip.volume ?? 1.0;
      let targetVolume = isMuted ? 0 : (trackVolume * clipVolume);

      // 2. FUNDIDOS (FADES)
      const clipLocalTime = time - clip.startTime;
      if (!isMuted) {
        if (clip.fadeInDuration && clipLocalTime < clip.fadeInDuration) {
          targetVolume *= (clipLocalTime / clip.fadeInDuration);
        }
        if (clip.fadeOutDuration) {
          const remaining = clip.duration - clipLocalTime;
          if (remaining < clip.fadeOutDuration) {
            targetVolume *= Math.max(0, remaining / clip.fadeOutDuration);
          }
        }
      }
      audio.volume = Math.min(1, Math.max(0, targetVolume));

      // 3. TIEMPO Y VELOCIDAD
      const playbackRate = clip.playbackRate || 1.0;
      const adjustedSourceTime = (clip.sourceStartTime || 0) + (clipLocalTime * playbackRate);

      if (audio.playbackRate !== playbackRate) audio.playbackRate = playbackRate;

      const drift = Math.abs(audio.currentTime - adjustedSourceTime);
      if (drift > 0.15) audio.currentTime = adjustedSourceTime;

      // 4. REPRODUCCIÓN
      if (isPlaying && !isMuted) {
        if (audio.paused && audio.readyState >= 1) {
          audio.play().catch(err => console.warn("Error playing audio clip:", clip.label, err));
        }
      } else {
        if (!audio.paused) audio.pause();
      }
    });

    isSyncing.current = false;
  }, [getActiveClips, isPlaying]);

  // Guardar syncMedia en ref para que el efecto de animación pueda usarla sin depender de ella
  const syncMediaRef = useRef(syncMedia);
  syncMediaRef.current = syncMedia;

  // Gestionar el ciclo de vida de los elementos de audio
  useEffect(() => {
    if (!timeline?.tracks) return;
    const allClips = timeline.tracks.flatMap(track => track.clips);
    const currentClipIds = new Set(allClips.map(c => c.id));

    // A. Limpiar clips que ya no existen en el timeline
    Object.keys(audioRefs.current).forEach(id => {
      if (!currentClipIds.has(id)) {
        const audio = audioRefs.current[id];
        const source = sourceNodes.current[id];
        if (audio) {
          audio.pause();
          audio.src = "";
          audio.load();
          if (audio.parentNode) audio.parentNode.removeChild(audio);
        }
        if (source) {
          try { source.disconnect(); } catch(e) {}
        }
        delete audioRefs.current[id];
        delete sourceNodes.current[id];
        const objUrl = objectUrlsRef.current.get(id);
        if (objUrl) {
          URL.revokeObjectURL(objUrl);
          objectUrlsRef.current.delete(id);
        }
      }
    });

    // B. Crear o actualizar clips actuales
    allClips.forEach(clip => {
      if (!clip.mediaFileId) return;

      // Determinar la URL real (preferir caché si existe). Se REUTILIZA el blob URL
      // ya creado para este clip en vez de generar uno nuevo cada vez: crear blob
      // URLs sin revocarlos era una fuga de memoria que frenaba la reproducción.
      let finalUrl = clip.mediaFileId;
      if (fileCache?.current) {
        const cachedFile = fileCache.current.get(clip.mediaFileId);
        if (cachedFile) {
          const existing = objectUrlsRef.current.get(clip.id);
          if (existing) {
            finalUrl = existing;
          } else {
            const blobUrl = URL.createObjectURL(cachedFile);
            objectUrlsRef.current.set(clip.id, blobUrl);
            finalUrl = blobUrl;
            console.log("🔊 [TimelinePlayer] Cargando desde caché:", clip.label);
          }
        }
      }

      let audio = audioRefs.current[clip.id];

      if (!audio) {
        // CREAR NUEVO
        audio = document.createElement('audio');
        // http y media:// necesitan crossOrigin='anonymous' para que el nodo fuente
        // del Web Audio API no esté 'tainted' y emita silencio.
        if (finalUrl.startsWith('http') || finalUrl.startsWith('media:')) audio.crossOrigin = 'anonymous';
        audio.preload = "auto";
        audio.src = finalUrl;
        audio.load(); // Forzar carga inmediata
        audio.style.display = 'none';
        document.body.appendChild(audio);

        audio.onerror = () => {
          console.warn('[TimelinePlayer] Error cargando audio:', clip.label, finalUrl);
        };
        audio.oncanplay = () => {
          console.log('[TimelinePlayer] Audio listo para reproducir:', clip.label, 'readyState:', audio.readyState);
        };

        if (clip.type === 'video') {
          audio.muted = true;
          audio.volume = 0;
        }

        audioRefs.current[clip.id] = audio;

        // Conectar al sistema de audio global
        if (audioContext && masterOutput) {
          try {
            const source = audioContext.createMediaElementSource(audio);
            source.connect(masterOutput);
            sourceNodes.current[clip.id] = source;
          } catch (e) {
            console.warn('Audio element already connected:', clip.id);
          }
        }
      } else {
        // ACTUALIZAR SI LA URL CAMBIÓ (ej: al cargar proyecto local o cambiar de archivo)
        // Comparamos la URL base para evitar recargas infinitas, pero permitimos el cambio si es necesario
        const currentSrc = audio.src;
        if (currentSrc !== finalUrl) {
           console.log("🔄 [TimelinePlayer] Actualizando fuente de clip:", clip.label);
           audio.src = finalUrl;
           audio.load(); // Forzar carga de la nueva fuente
        }
      }
    });

    return () => {
      // Al desmontar o cambiar tracks, pausamos todo por seguridad
      if (!isPlaying) {
        Object.values(audioRefs.current).forEach(a => a.pause());
      }
    };
  }, [timeline?.tracks, audioContext, masterOutput, fileCache, isPlaying]);

  // Bucle de animación y sincronización en tiempo real
  // Solo depende de isPlaying para evitar reinicios constantes
  useEffect(() => {
    if (isPlaying) {
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
      }
      lastUiUpdateRef.current = 0; // forzar actualización de UI en el primer frame

      const animate = (timestamp: number) => {
        if (!lastTimeRef.current) lastTimeRef.current = timestamp;
        const delta = (timestamp - lastTimeRef.current) / 1000;
        lastTimeRef.current = timestamp;

        const duration = timelineRef.current?.duration || 0;
        const baseTime = currentTimeRef.current;
        const newTime = Math.min(baseTime + delta, duration);
        currentTimeRef.current = newTime;
        // Exportar el tiempo a 60fps al preview del editor (por ref, sin re-render).
        if (previewTimeRef) previewTimeRef.current = newTime;

        // syncMedia (audio, por ref) va a 60fps; la actualización de UI (setEditState)
        // se limita a ~15fps para no re-renderizar el editor entero en cada frame.
        syncMediaRef.current(newTime);
        if (timestamp - lastUiUpdateRef.current > 66) {
          lastUiUpdateRef.current = timestamp;
          onTimeUpdateRef.current(newTime);
        }

        if (newTime < duration) {
          animationRef.current = requestAnimationFrame(animate);
         } else {
           // Al llegar al final, forzamos la última actualización de UI
           lastUiUpdateRef.current = timestamp;
           onTimeUpdateRef.current(newTime);
           if (loopRef.current) {
             // Bucle: reiniciar a 0 y continuar reproduciendo
             currentTimeRef.current = 0;
             if (previewTimeRef) previewTimeRef.current = 0;
             onTimeUpdateRef.current(0);
             syncMediaRef.current(0);
             animationRef.current = requestAnimationFrame(animate);
           } else if (resetToStartOnEndRef.current) {
             currentTimeRef.current = 0;
             if (previewTimeRef) previewTimeRef.current = 0;
             onTimeUpdateRef.current(0);
             if (onReachedEndRef.current) onReachedEndRef.current();
           } else if (stopAtEndRef.current) {
            currentTimeRef.current = duration;
            if (previewTimeRef) previewTimeRef.current = duration;
            onTimeUpdateRef.current(duration);
            if (onReachedEndRef.current) onReachedEndRef.current();
          }
        }
      };

      animationRef.current = requestAnimationFrame(animate);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
      lastTimeRef.current = 0;
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
    };
  }, [isPlaying, audioContext]);

  // Sincronizar currentTime cuando cambia desde fuera (seek manual)
  useEffect(() => {
    currentTimeRef.current = currentTime;
    // En seek manual (o pausa), el preview debe mostrar este tiempo. DURANTE la
    // reproducción no lo sobreescribimos aquí: el bucle de animación escribe el
    // tiempo a 60fps y el estado va retrasado (~15fps); si lo sobreescribiéramos
    // cada 66ms el preview daría un salto hacia atrás periódico.
    if (previewTimeRef && !isPlaying) previewTimeRef.current = currentTime;
    syncMedia(currentTime);
  }, [currentTime, syncMedia, previewTimeRef, isPlaying]);

  // Limpieza final al desmontar el componente
  useEffect(() => {
    return () => {
      Object.values(audioRefs.current).forEach(audio => {
        audio.pause();
        audio.src = "";
        audio.load();
        if (audio.parentNode) audio.parentNode.removeChild(audio);
      });
      Object.values(sourceNodes.current).forEach(source => {
        try { source.disconnect(); } catch(e) {}
      });
      objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return null;
}
