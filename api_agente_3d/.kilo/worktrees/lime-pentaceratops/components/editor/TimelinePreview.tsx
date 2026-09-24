import { useEffect, useRef, type RefObject } from 'react';
import { TimelineState, TimelineClip } from '@/types';

interface TimelinePreviewProps {
  timeline: TimelineState;
  isPlaying: boolean;
  /** Ref compartida con el TimelinePlayer: currentTime a 60fps. Si no se pasa,
   *  se usa timeline.currentTime (15fps, preview a saltos). */
  previewTimeRef?: RefObject<number>;
}

export default function TimelinePreview({ timeline, isPlaying, previewTimeRef }: TimelinePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRefs = useRef<{ [key: string]: HTMLVideoElement }>({});
  const imageRefs = useRef<{ [key: string]: HTMLImageElement }>({});
  // Refs vivas durante el rAF (evitan re-suscribir el loop cuando cambia el timeline).
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const lastTimeRef = useRef<number>(-1);

  // Obtener todos los clips que deberían estar visibles en el tiempo actual
  const getActiveClips = (tl: TimelineState, time: number): TimelineClip[] => {
    return tl.tracks
      .filter(track => track.type === 'video' || track.type === 'text' || track.type === 'image') // Incluir imagen para preview
      .flatMap(track =>
        track.clips.filter(clip =>
          !clip.overlayKind &&
          time >= clip.startTime && time < clip.startTime + clip.duration
        )
      )
      .sort((a, b) => {
        // Ordenar por tipo: video primero, luego imagen, luego texto
        if (a.type === 'video' && b.type !== 'video') return -1;
        if (b.type === 'video' && a.type !== 'video') return 1;
        if (a.type === 'image' && b.type === 'text') return -1;
        if (a.type === 'text' && b.type === 'image') return 1;
        return 0;
      });
  };

  // Dibujar frame actual. Usa `time` (previewTimeRef 60fps) en vez de
  // timeline.currentTime (15fps) para ir fluido.
  const drawFrame = (tl: TimelineState, time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Limpiar canvas
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const activeClips = getActiveClips(tl, time);

    activeClips.forEach(clip => {
      const clipLocalTime = time - clip.startTime;

      if (clip.type === 'video' && clip.mediaFileId) {
        const video = videoRefs.current[clip.id];
        if (video && video.readyState >= 2) { // HAVE_CURRENT_DATA
          // Sólo seek si hay deriva real: evitar un seek por frame (caro y produce
          // frames stale → micro-cortes). El <video> avanza solo en play.
          if (Math.abs(video.currentTime - clipLocalTime) > 0.1) {
            try { video.currentTime = clipLocalTime; } catch { /* seek asíncrono */ }
          }

          // Dibujar video centrado
          const videoAspect = video.videoWidth / video.videoHeight;
          const canvasAspect = canvas.width / canvas.height;

          let drawWidth, drawHeight, drawX, drawY;

          if (videoAspect > canvasAspect) {
            drawWidth = canvas.width;
            drawHeight = canvas.width / videoAspect;
            drawX = 0;
            drawY = (canvas.height - drawHeight) / 2;
          } else {
            drawHeight = canvas.height;
            drawWidth = canvas.height * videoAspect;
            drawX = (canvas.width - drawWidth) / 2;
            drawY = 0;
          }

          ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
        }
      } else if (clip.type === 'text' && clip.text) {
        // Dibujar texto
        ctx.fillStyle = clip.color || '#ffffff';
        ctx.font = `${clip.fontSize || 24}px ${clip.fontFamily || 'Arial'}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Agregar fondo si está especificado
        if (clip.backgroundColor) {
          const textMetrics = ctx.measureText(clip.text);
          const padding = 10;
          ctx.fillStyle = clip.backgroundColor;
          ctx.fillRect(
            (canvas.width - textMetrics.width) / 2 - padding,
            (canvas.height - (clip.fontSize || 24)) / 2 - padding,
            textMetrics.width + padding * 2,
            (clip.fontSize || 24) + padding * 2
          );
          ctx.fillStyle = clip.color || '#ffffff';
        }

        ctx.fillText(clip.text, canvas.width / 2, canvas.height / 2);
      } else if (clip.type === 'image' && clip.mediaFileId) {
        // Dibujar imagen
        const img = imageRefs.current[clip.id];
        if (img && img.complete) {
          const imgAspect = img.naturalWidth / img.naturalHeight;
          const canvasAspect = canvas.width / canvas.height;

          let drawWidth, drawHeight, drawX, drawY;

          if (imgAspect > canvasAspect) {
            drawWidth = canvas.width;
            drawHeight = canvas.width / imgAspect;
            drawX = 0;
            drawY = (canvas.height - drawHeight) / 2;
          } else {
            drawHeight = canvas.height;
            drawWidth = canvas.height * imgAspect;
            drawX = (canvas.width - drawWidth) / 2;
            drawY = 0;
          }

          ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
        }
      } else if (clip.type === 'video' && clip.thumbnailUrl) {
        // Mostrar thumbnail si el video no está cargado
        const img = imageRefs.current[clip.id];
        if (img && img.complete) {
          const imgAspect = img.naturalWidth / img.naturalHeight;
          const canvasAspect = canvas.width / canvas.height;

          let drawWidth, drawHeight, drawX, drawY;

          if (imgAspect > canvasAspect) {
            drawWidth = canvas.width;
            drawHeight = canvas.width / imgAspect;
            drawX = 0;
            drawY = (canvas.height - drawHeight) / 2;
          } else {
            drawHeight = canvas.height;
            drawWidth = canvas.height * imgAspect;
            drawX = (canvas.width - drawWidth) / 2;
            drawY = 0;
          }

          ctx.globalAlpha = 0.7; // Semi-transparente para indicar que es thumbnail
          ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
          ctx.globalAlpha = 1.0;
        }
      }
    });
  };

  // Preparar elementos multimedia. También limpia los <video>/<img> de clips que
  // ya no están en el timeline (antes se retenían y seguían decodificando).
  useEffect(() => {
    const allClips = timeline.tracks.flatMap(track => track.clips);
    const clipIds = new Set(allClips.map(c => c.id));

    allClips.forEach(clip => {
      if (clip.mediaFileId && clip.type === 'video' && !videoRefs.current[clip.id]) {
        const video = document.createElement('video');
        video.src = clip.mediaFileId;
        video.muted = true;
        video.preload = 'auto';
        videoRefs.current[clip.id] = video;
      }

      if (clip.thumbnailUrl && (clip.type === 'video' || clip.type === 'image') && !imageRefs.current[clip.id]) {
        const img = document.createElement('img');
        img.src = clip.thumbnailUrl;
        imageRefs.current[clip.id] = img;
      }

      if (clip.mediaFileId && clip.type === 'image' && !imageRefs.current[clip.id]) {
        const img = document.createElement('img');
        img.src = clip.mediaFileId;
        imageRefs.current[clip.id] = img;
      }
    });

    // Limpiar videos de clips borrados: pausar + soltar src para liberar el decoder.
    for (const id of Object.keys(videoRefs.current)) {
      if (!clipIds.has(id)) {
        const v = videoRefs.current[id];
        if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch {} }
        delete videoRefs.current[id];
      }
    }
    for (const id of Object.keys(imageRefs.current)) {
      if (!clipIds.has(id)) {
        delete imageRefs.current[id];
      }
    }

    // Forzar redibujo tras cambio de clips.
    lastTimeRef.current = -1;
  }, [timeline.tracks]);

  // Animation loop. Deps sólo [isPlaying] → no se re-suscribe 15×/s cuando cambia
  // timeline.currentTime. Lee previewTimeRef (60fps) y timelineRef dentro del rAF.
  useEffect(() => {
    let animationId = 0;

    const animate = () => {
      const time = previewTimeRef?.current ?? timelineRef.current.currentTime;
      // Short-circuit: si el tiempo no avanzó (pausado o sin cambio), no redibujar.
      if (time !== lastTimeRef.current) {
        lastTimeRef.current = time;
        drawFrame(timelineRef.current, time);
      }
      if (isPlayingRef.current) {
        animationId = requestAnimationFrame(animate);
      }
    };

    if (isPlaying) {
      animate();
    } else {
      // Frame estático al pausar.
      const time = previewTimeRef?.current ?? timelineRef.current.currentTime;
      lastTimeRef.current = time;
      drawFrame(timelineRef.current, time);
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={180}
      className="w-full h-full object-contain"
    />
  );
}