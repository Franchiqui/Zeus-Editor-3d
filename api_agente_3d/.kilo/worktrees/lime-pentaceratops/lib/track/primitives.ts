// Primitivas de tracking por correlación (ZSAD) compartidas por los trackers.
// Extraídas de lib/pattern-track.ts para reutilizarlas en lib/point-track.ts.
// Todo trabaja en escala de grises (Float32Array) sobre una resolución de trabajo
// reducida (workMaxWidth) por velocidad; el bbox/puntos devueltos se reescalan a
// la resolución real del frame.

export const LUM = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

export function mean(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

/** ZSAD = media de | (P-meanP) - (T-meanT) |. 0 = match perfecto. */
export function zsad(patch: Float32Array, meanP: number, tmpl: Float32Array, meanT: number): number {
  let s = 0;
  for (let i = 0; i < patch.length; i++) {
    s += Math.abs((patch[i] - meanP) - (tmpl[i] - meanT));
  }
  return s / patch.length;
}

/** Samplea un parche centrado en (cx,cy) de tamaño pw×ph (px frame) y lo downsamplea
 *  a outTW×outTH (nearest-neighbour). Devuelve Float32Array en escala de grises. */
export function samplePatch(
  gray: Float32Array, W: number, H: number,
  cx: number, cy: number, pw: number, ph: number,
  outTW: number, outTH: number,
): Float32Array {
  const patch = new Float32Array(outTW * outTH);
  const x0 = cx - pw / 2;
  const y0 = cy - ph / 2;
  const sx = pw / outTW;
  const sy = ph / outTH;
  for (let ty = 0; ty < outTH; ty++) {
    const fy = Math.round(y0 + (ty + 0.5) * sy);
    const cyy = fy < 0 ? 0 : fy >= H ? H - 1 : fy;
    const rowOff = cyy * W;
    for (let tx = 0; tx < outTW; tx++) {
      const fx = Math.round(x0 + (tx + 0.5) * sx);
      const cxx = fx < 0 ? 0 : fx >= W ? W - 1 : fx;
      patch[ty * outTW + tx] = gray[rowOff + cxx];
    }
  }
  return patch;
}

/** Dibuja el frame del vídeo (vw×vh) al canvas de trabajo (workW×workH) y lo
 *  vuelca a escala de grises. El tmpCtx debe ser 2d con willReadFrequently. */
export function videoFrameToGray(
  video: HTMLVideoElement, vw: number, vh: number, workW: number, workH: number, tmpCtx: CanvasRenderingContext2D,
): Float32Array {
  tmpCtx.drawImage(video, 0, 0, vw, vh, 0, 0, workW, workH);
  const img = tmpCtx.getImageData(0, 0, workW, workH).data;
  const gray = new Float32Array(workW * workH);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    gray[i] = LUM(img[j], img[j + 1], img[j + 2]);
  }
  return gray;
}

/** Seek del vídeo a `t` (segundos) esperando 'seeked' (con fallback de 400ms). */
export function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      resolve();
    };
    video.addEventListener('seeked', finish);
    setTimeout(finish, 400);
    try {
      const d = video.duration;
      const tt = isFinite(d) && d > 0 ? Math.min(Math.max(0, t), d - 0.001) : t;
      video.currentTime = tt;
    } catch {
      finish();
    }
  });
}

/** Crea un <video> offscreen en el DOM (necesario para decodificar frames al seek)
 *  con crossOrigin='anonymous' (para media://). Devuelve {video, remove}. */
export function createOffscreenVideo(videoUrl: string): { video: HTMLVideoElement; remove: () => void } {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  (video as any).playsInline = true;
  video.preload = 'auto';
  video.style.position = 'fixed';
  video.style.left = '-99999px';
  video.style.top = '0';
  video.style.width = '2px';
  video.style.height = '2px';
  video.src = videoUrl;
  document.body.appendChild(video);
  const remove = () => {
    try { video.pause(); } catch {}
    video.removeAttribute('src');
    try { video.load(); } catch {}
    if (video.parentNode) video.parentNode.removeChild(video);
  };
  return { video, remove };
}

/** Espera a que el vídeo cargue (loadeddata) con timeout de 8s. */
export function waitVideoLoaded(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onLoaded = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error('No se pudo cargar el vídeo para tracking.')); };
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onErr);
    };
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('error', onErr);
    setTimeout(() => { cleanup(); if (video.readyState >= 2) resolve(); else reject(new Error('Timeout cargando el vídeo.')); }, 30000);
  });
}

/** Resolución de trabajo (downscale por workMaxWidth) y factor de escala. */
export function workResFor(videoWidth: number, videoHeight: number, workMaxWidth: number): { ws: number; workW: number; workH: number } {
  const ws = Math.min(1, workMaxWidth / videoWidth);
  const workW = Math.max(2, Math.round(videoWidth * ws));
  const workH = Math.max(2, Math.round(videoHeight * ws));
  return { ws, workW, workH };
}