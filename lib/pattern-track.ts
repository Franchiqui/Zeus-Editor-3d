'use client';

import type { TrackingData } from './video-tracking';
import {
  mean, zsad, samplePatch, videoFrameToGray, seekTo,
  createOffscreenVideo, waitVideoLoaded, workResFor,
} from './track/primitives';

/**
 * Tracker de patrón en JS puro (correlación ZSAD multiescala). SIN red, SIN modelo,
 * SIN API Python. Determinista. Trackea un parche (template) extraído del primer frame
 * buscándolo en cada frame siguiente dentro de una ventana alrededor de la última
 * posición, a varias escalas. Devuelve un objeto con la misma forma que el tracking de
 * la API Python (TrackingData) para reutilizar smoothTrackingData + los conversores.
 *
 * Por qué: el tracker de OpenCV (CSRT/KCF vía API Python) es frágil (deriva, tiembla,
 * requiere arrancar un servidor y subir el vídeo). Este es offline, en el navegador,
 * y bastante robusto para un solo objeto con movimiento moderado y cambios de tamaño.
 *
 * Algoritmo:
 *  - Se extrae el template del frame 0 en el bbox inicial, se normaliza a un cuadrado
 *    de templateSize×templateSize en escala de grises, y se guarda zero-mean.
 *  - En cada frame se busca el desplazamiento (dx,dy) y escala que minimizan ZSAD
 *    (zero-mean SAD) entre el parche candidato y el template. Búsqueda coarse-to-fine.
 *  - Se actualiza la posición/escala. Opcionalmente se actualiza el template (blend
 *    con alpha pequeño) para seguir cambios de apariencia sin derivar demasiado.
 *  - Se trabaja a una resolución reducida (workMaxWidth) por velocidad; el bbox
 *    devuelto se reescala a la resolución real del frame.
 */

export interface PatternTrackOpts {
  videoUrl: string;
  videoWidth: number;   // dimensión real del frame (full res)
  videoHeight: number;
  initialBbox: { x: number; y: number; width: number; height: number }; // px full-res
  fps?: number;                 // fps a muestrear (default 30)
  sampleStepFrames?: number;    // extraer cada N frames (default: auto para ~240 frames)
  scales?: number[];            // escalas a probar (default [0.82,0.9,1,1.1,1.2])
  searchRadius?: number;        // radio de búsqueda en px de trabajo (default ~12% ancho)
  templateSize?: number;        // lado del template normalizado (default 48)
  workMaxWidth?: number;        // resolución de trabajo máx (default 640)
  templateUpdateAlpha?: number; // 0 = no actualizar; 0.04 = lento (default 0.04)
  minConfidence?: number;       // ZSAD normalizado por debajo del cual se actualiza template (default 0.12)
  /** Tiempo del ARCHIVO (segundos) donde empezar a trackear = donde está dibujado el
   *  lazo. CRÍTICO: si el clip está recortado (sourceStartTime/trimStart) o el usuario
   *  dibuja el lazo a mitad del clip, el template debe extraerse en ESTE momento del
   *  archivo, no en el frame 0. Default 0 (sólo correcto sin recorte y dibujando al inicio). */
  startTime?: number;
  /** Segundos de ARCHIVO a trackear desde startTime (default = duration - startTime).
   *  Para un clip con playbackRate r, el tiempo de archivo avanza r× por segundo de
   *  timeline, así que para cubrir el resto del clip hay que trackear (clipLocalRest * r) segundos de archivo. */
  duration?: number;
  /** Conservar silueta: trackear SOLO traslación (sin buscar escala). El template
   *  queda a tamaño fijo = el lazo del usuario, que solo se desplaza siguiendo al
   *  objeto. Mucho más estable y preciso para recortes exactos (capas): la silueta
   *  nunca se deforma ni deja partes fuera. Usar cuando el objeto se mueve pero no
   *  cambia de tamaño aparente. Default false (también se trackea la escala). */
  keepSilhouette?: boolean;
  onProgress?: (p: number, frameIdx: number, total: number) => void;
  signal?: AbortSignal;
}

export async function trackPattern(opts: PatternTrackOpts): Promise<TrackingData> {
  const {
    videoUrl, videoWidth, videoHeight, initialBbox,
    fps = 30,
    startTime = 0,
    keepSilhouette = false,
    templateSize = 64,
    workMaxWidth = 960,
    templateUpdateAlpha = 0.04,
    minConfidence = 0.12,
    onProgress, signal,
  } = opts;

  // En modo conservar silueta no se busca escala: sólo traslación. Es más estable
  // y preciso para recortes exactos (la silueta del lazo se conserva y solo se
  // desplaza). Se desactiva la actualización del template para no derivar la forma.
  const scales = keepSilhouette
    ? [1.0]
    : (opts.scales ?? [0.86, 0.93, 1.0, 1.08, 1.16]);
  const tmplAlpha = keepSilhouette ? 0 : templateUpdateAlpha;
  if (!videoWidth || !videoHeight) throw new Error('Falta el tamaño del vídeo.');
  if (initialBbox.width < 4 || initialBbox.height < 4) throw new Error('El bbox inicial es demasiado pequeño.');

  // Resolución de trabajo (downscale para velocidad). workMaxWidth más alto =
  // mejor localización del centro (menos px de error al reescalar a full-res).
  const { ws, workW, workH } = workResFor(videoWidth, videoHeight, workMaxWidth);
  const R = opts.searchRadius ?? Math.max(48, Math.round(workW * 0.14));

  // Video element offscreen (debe estar en el DOM para decodificar frames al seek).
  const { video, remove: removeVideo } = createOffscreenVideo(videoUrl);

  // Canvas de trabajo (workW×workH): aquí se dibuja el frame downscalado y se lee.
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = workW;
  tmpCanvas.height = workH;
  const tmpCtx = tmpCanvas.getContext('2d', { willReadFrequently: true })!;

  try {
    // Cargar el vídeo.
    await waitVideoLoaded(video);

    const videoDur = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (videoDur <= 0) throw new Error('No se pudo leer la duración del vídeo.');

    // Ventana de tiempo del ARCHIVO a trackear. Por defecto desde startTime
    // hasta el final del archivo. startTime se recibe del editor = tiempo del
    // archivo donde está dibujado el lazo (compensa recorte sourceStartTime/trim
    // y el caso de dibujar a mitad del clip).
    const startT = Math.max(0, Math.min(videoDur - 0.001, startTime));
    const trackDuration = opts.duration && opts.duration > 0
      ? Math.min(opts.duration, videoDur - startT)
      : (videoDur - startT);
    if (trackDuration <= 0) throw new Error('No hay vídeo que trackear en esa ventana.');

    const totalFrames = Math.max(1, Math.floor(trackDuration * fps));
    // Auto-sample para no pasar de ~240 frames extraídos (cada seek cuesta).
    const sampleStep = opts.sampleStepFrames ?? Math.max(1, Math.ceil(totalFrames / 240));
    const trackedCount = Math.ceil(totalFrames / sampleStep);

    // Frame 0 → template (extraído en startTime del archivo, donde está el lazo).
    await seekTo(video, startT);
    let gray = videoFrameToGray(video, videoWidth, videoHeight, workW, workH, tmpCtx);

    const bx0 = initialBbox.x * ws;
    const by0 = initialBbox.y * ws;
    const bw0 = initialBbox.width * ws;
    const bh0 = initialBbox.height * ws;
    const baseCx = bx0 + bw0 / 2;
    const baseCy = by0 + bh0 / 2;

    // Template (cuadrado TS×TS, grises, zero-mean guardamos media aparte).
    let tmpl = samplePatch(gray, workW, workH, baseCx, baseCy, bw0, bh0, templateSize, templateSize);
    let meanTmpl = mean(tmpl);

    let lastCx = baseCx;
    let lastCy = baseCy;
    let lastScale = 1;

    const frames: number[] = [];
    const bboxes: number[][] = [];
    const centers: number[][] = [];
    const scalesOut: number[] = [];

    const record = (frameIdx: number, cxWork: number, cyWork: number, scale: number) => {
      const pw = bw0 * scale;
      const ph = bh0 * scale;
      const xWork = cxWork - pw / 2;
      const yWork = cyWork - ph / 2;
      const xFull = xWork / ws;
      const yFull = yWork / ws;
      const wFull = pw / ws;
      const hFull = ph / ws;
      frames.push(frameIdx);
      bboxes.push([xFull, yFull, wFull, hFull]);
      centers.push([xFull + wFull / 2, yFull + hFull / 2]);
      scalesOut.push(scale);
    };

    record(0, baseCx, baseCy, 1);

    const fineScalesAround = (sc: number) => [sc * 0.94, sc, sc * 1.06];

    let processed = 1;
    for (let f = sampleStep; f < totalFrames; f += sampleStep) {
      if (signal?.aborted) throw new Error('Cancelado.');
      // Tiempo del ARCHIVO = startTime + (frame relativo)/fps.
      const t = startT + f / fps;
      await seekTo(video, t);
      gray = videoFrameToGray(video, videoWidth, videoHeight, workW, workH, tmpCtx);

      // Búsqueda coarse (step 3) + fine (step 1) alrededor del mejor. En modo
      // conservar silueta sólo hay una escala (1.0) → busca sólo traslación, más
      // estable y rápido; el centro es lo único que importa (la silueta no cambia).
      let bestDx = 0, bestDy = 0, bestSc = lastScale, bestScore = Infinity;

      const coarseStep = 3;
      for (let dy = -R; dy <= R; dy += coarseStep) {
        for (let dx = -R; dx <= R; dx += coarseStep) {
          const cx = lastCx + dx;
          const cy = lastCy + dy;
          for (const sc of scales) {
            const patch = samplePatch(gray, workW, workH, cx, cy, bw0 * sc, bh0 * sc, templateSize, templateSize);
            const mp = mean(patch);
            const score = zsad(patch, mp, tmpl, meanTmpl);
            if (score < bestScore) { bestScore = score; bestDx = dx; bestDy = dy; bestSc = sc; }
          }
        }
      }

      // Fine: ±4px step 1 alrededor del mejor coarse, escalas finas.
      const fineScales = keepSilhouette ? [bestSc] : fineScalesAround(bestSc);
      const fineR = 4;
      for (let dy = bestDy - fineR; dy <= bestDy + fineR; dy += 1) {
        for (let dx = bestDx - fineR; dx <= bestDx + fineR; dx += 1) {
          const cx = lastCx + dx;
          const cy = lastCy + dy;
          for (const sc of fineScales) {
            const patch = samplePatch(gray, workW, workH, cx, cy, bw0 * sc, bh0 * sc, templateSize, templateSize);
            const mp = mean(patch);
            const score = zsad(patch, mp, tmpl, meanTmpl);
            if (score < bestScore) { bestScore = score; bestDx = dx; bestDy = dy; bestSc = sc; }
          }
        }
      }

      lastCx += bestDx;
      lastCy += bestDy;
      lastScale = bestSc;

      record(f, lastCx, lastCy, lastScale);

      // Actualización del template (sólo si buena confianza y NO modo silueta)
      // para seguir cambios de apariencia sin derivar. En modo silueta el template
      // queda FIJO para no sesgar la forma/tamaño del lazo del usuario.
      if (tmplAlpha > 0 && bestScore < minConfidence) {
        const patch = samplePatch(gray, workW, workH, lastCx, lastCy, bw0 * lastScale, bh0 * lastScale, templateSize, templateSize);
        const mp = mean(patch);
        const a = templateUpdateAlpha;
        for (let i = 0; i < tmpl.length; i++) {
          const pzm = patch[i] - mp;
          const tzm = tmpl[i] - meanTmpl;
          tmpl[i] = (1 - a) * tzm + a * pzm;
        }
        meanTmpl = 0; // el template queda zero-mean
      }

      processed++;
      if (onProgress) onProgress(processed / trackedCount, f, totalFrames);
    }

    return {
      frames,
      bboxes,
      centers,
      scales: scalesOut,
      rotations: new Array(frames.length).fill(0),
      fps,
      total_frames: frames.length,
      initial_bbox: [initialBbox.x, initialBbox.y, initialBbox.width, initialBbox.height],
      video_path: undefined,
    };
  } finally {
    // Limpieza: pausar y quitar el video del DOM. Revocar src para liberar.
    removeVideo();
  }
}