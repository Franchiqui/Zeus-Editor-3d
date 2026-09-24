// Tracker multi-punto por correlación ZSAD (sin escala, solo traslación por punto).
// Reutiliza las primitivas de lib/track/primitives.ts. Para cada punto se extrae un
// template en el frame inicial y se busca en cada frame siguiente el desplazamiento
// (dx,dy) que minimiza ZSAD dentro de un radio. Devuelve la trayectoria de cada punto
// con una confianza (1 - ZSAD normalizada) para filtrar puntos perdidos.
//
// Pensado para el "lazo por puntos": se trackea una grilla de puntos del objeto y se
// usa MLS para deformar el lazo siguiéndolos (ver lib/mls-warp.ts).

import {
  mean, zsad, samplePatch, videoFrameToGray, seekTo,
  createOffscreenVideo, waitVideoLoaded, workResFor,
} from './track/primitives';

export interface PointTrackOpts {
  videoUrl: string;
  videoWidth: number;    // dimensión real del frame (full res)
  videoHeight: number;
  points: { x: number; y: number }[];   // px full-res, posiciones iniciales
  fps?: number;                 // fps a muestrear (default 30)
  startTime?: number;           // segundos del ARCHIVO donde empezar (offset de recorte)
  duration?: number;           // segundos de archivo a trackear desde startTime
  sampleStepFrames?: number;   // extraer cada N frames (auto para ~120)
  searchRadius?: number;       // radio de búsqueda px trabajo (default ~10% ancho)
  templateSize?: number;       // lado del template (default 20)
  workMaxWidth?: number;       // resolución de trabajo (default 960)
  onProgress?: (p: number, frame: number, total: number) => void;
  signal?: AbortSignal;
}

export interface PointTrack {
  x: number;   // px full-res
  y: number;
  conf: number; // 0..1 (1 = match perfecto)
}

export interface PointTrackResult {
  frames: number[];            // número de frame REAL (relativo al inicio) por muestra
  tracks: PointTrack[][];      // tracks[punto][muestra]
}

export async function trackPoints(opts: PointTrackOpts): Promise<PointTrackResult> {
  const {
    videoUrl, videoWidth, videoHeight, points,
    fps = 30, startTime = 0,
    templateSize = 20, workMaxWidth = 960,
    onProgress, signal,
  } = opts;
  if (!videoWidth || !videoHeight) throw new Error('Falta el tamaño del vídeo.');
  if (!points || points.length === 0) throw new Error('No hay puntos a trackear.');

  const { ws, workW, workH } = workResFor(videoWidth, videoHeight, workMaxWidth);
  const R = opts.searchRadius ?? Math.max(32, Math.round(workW * 0.10));

  const { video, remove: removeVideo } = createOffscreenVideo(videoUrl);
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = workW;
  tmpCanvas.height = workH;
  const tmpCtx = tmpCanvas.getContext('2d', { willReadFrequently: true })!;

  try {
    await waitVideoLoaded(video);
    const videoDur = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (videoDur <= 0) throw new Error('No se pudo leer la duración del vídeo.');
    const startT = Math.max(0, Math.min(videoDur - 0.001, startTime));
    const trackDuration = opts.duration && opts.duration > 0
      ? Math.min(opts.duration, videoDur - startT)
      : (videoDur - startT);
    if (trackDuration <= 0) throw new Error('No hay vídeo que trackear en esa ventana.');

    const totalFrames = Math.max(1, Math.floor(trackDuration * fps));
    const sampleStep = opts.sampleStepFrames ?? Math.max(1, Math.ceil(totalFrames / 120));
    const sampleCount = Math.ceil(totalFrames / sampleStep);

    // Frame 0 → templates por punto (coordenadas de trabajo).
    await seekTo(video, startT);
    let gray = videoFrameToGray(video, videoWidth, videoHeight, workW, workH, tmpCtx);

    const nP = points.length;
    const templates: Float32Array[] = new Array(nP);
    const templateMeans: number[] = new Array(nP);
    // Última posición (trabajo) por punto, arranca en la inicial.
    const lastX = new Float32Array(nP);
    const lastY = new Float32Array(nP);
    for (let i = 0; i < nP; i++) {
      const cx = points[i].x * ws;
      const cy = points[i].y * ws;
      const t = samplePatch(gray, workW, workH, cx, cy, templateSize * 2, templateSize * 2, templateSize, templateSize);
      templates[i] = t;
      templateMeans[i] = mean(t);
      lastX[i] = cx;
      lastY[i] = cy;
    }

    const frames: number[] = [];
    const tracks: PointTrack[][] = Array.from({ length: nP }, () => []);

    const record = (frameIdx: number) => {
      frames.push(frameIdx);
      for (let i = 0; i < nP; i++) {
        tracks[i].push({ x: lastX[i] / ws, y: lastY[i] / ws, conf: 1 });
      }
    };
    record(0);

    let processed = 1;
    for (let f = sampleStep; f < totalFrames; f += sampleStep) {
      if (signal?.aborted) throw new Error('Cancelado.');
      await seekTo(video, startT + f / fps);
      gray = videoFrameToGray(video, videoWidth, videoHeight, workW, workH, tmpCtx);

      for (let i = 0; i < nP; i++) {
        const tmpl = templates[i];
        const mT = templateMeans[i];
        let bestDx = 0, bestDy = 0, bestScore = Infinity;

        // Coarse step 3.
        for (let dy = -R; dy <= R; dy += 3) {
          for (let dx = -R; dx <= R; dx += 3) {
            const cx = lastX[i] + dx;
            const cy = lastY[i] + dy;
            const patch = samplePatch(gray, workW, workH, cx, cy, templateSize * 2, templateSize * 2, templateSize, templateSize);
            const score = zsad(patch, mean(patch), tmpl, mT);
            if (score < bestScore) { bestScore = score; bestDx = dx; bestDy = dy; }
          }
        }
        // Fine step 1, ±3.
        for (let dy = bestDy - 3; dy <= bestDy + 3; dy += 1) {
          for (let dx = bestDx - 3; dx <= bestDx + 3; dx += 1) {
            const cx = lastX[i] + dx;
            const cy = lastY[i] + dy;
            const patch = samplePatch(gray, workW, workH, cx, cy, templateSize * 2, templateSize * 2, templateSize, templateSize);
            const score = zsad(patch, mean(patch), tmpl, mT);
            if (score < bestScore) { bestScore = score; bestDx = dx; bestDy = dy; }
          }
        }

        lastX[i] += bestDx;
        lastY[i] += bestDy;
        // Confianza: 1 - ZSAD normalizada (ZSAD en gris 0..255). ~48 = umbral razonable.
        const conf = Math.max(0, 1 - bestScore / 48);
        tracks[i].push({ x: lastX[i] / ws, y: lastY[i] / ws, conf });
      }

      frames.push(f);
      processed++;
      if (onProgress) onProgress(processed / sampleCount, f, totalFrames);
    }

    return { frames, tracks };
  } finally {
    removeVideo();
  }
}