// Varita mágica: selección por similitud de color (flood fill) sobre el frame del
// vídeo, mismo algoritmo que el del ImageEditor (applyMagicWand). Toma el canvas
// del frame (res nativa), el punto pulsado y la tolerancia; devuelve la máscara
// PNG con alpha (blanco = seleccionado) y el bbox del contenido seleccionado en
// % (0-100) del vídeo. El bbox alimenta la caja de la shape (UI + tracking) y la
// máscara se consume por el pipeline raster (effectiveSelectionMaskUrl / nodos).

export interface WandMaskResult {
  maskUrl: string; // dataURL PNG con alpha (res del canvas fuente)
  bbox: { x: number; y: number; width: number; height: number }; // % (0-100)
  selectedPixels: number;
}

export function floodFillMask(
  canvas: HTMLCanvasElement,
  startX: number,
  startY: number,
  tolerance: number,
): WandMaskResult | null {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const sx = Math.max(0, Math.min(w - 1, Math.round(startX)));
  const sy = Math.max(0, Math.min(h - 1, Math.round(startY)));

  const src = ctx.getImageData(0, 0, w, h).data;
  const startIdx = (sy * w + sx) * 4;
  const targetR = src[startIdx];
  const targetG = src[startIdx + 1];
  const targetB = src[startIdx + 2];
  const tol = Math.max(0, tolerance);
  const tolSq = tol * tol;

  const sel = new Uint8Array(w * h);
  const stack: number[] = [sy * w + sx];
  let minX = w, minY = h, maxX = -1, maxY = -1;
  let count = 0;

  while (stack.length > 0) {
    const i = stack.pop()!;
    if (sel[i]) continue;
    const idx = i * 4;
    const dr = src[idx] - targetR;
    const dg = src[idx + 1] - targetG;
    const db = src[idx + 2] - targetB;
    if (dr * dr + dg * dg + db * db > tolSq) continue;
    sel[i] = 1;
    count++;
    const px = i % w;
    const py = (i / w) | 0;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    if (px > 0) stack.push(i - 1);
    if (px < w - 1) stack.push(i + 1);
    if (py > 0) stack.push(i - w);
    if (py < h - 1) stack.push(i + w);
  }

  if (count === 0) return null;

  // Máscara PNG con alpha (blanco = seleccionado).
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const mctx = maskCanvas.getContext('2d');
  if (!mctx) return null;
  const maskData = mctx.createImageData(w, h);
  const mdata = maskData.data;
  for (let i = 0; i < w * h; i++) {
    if (sel[i]) {
      const mi = i * 4;
      mdata[mi] = 255;
      mdata[mi + 1] = 255;
      mdata[mi + 2] = 255;
      mdata[mi + 3] = 255;
    }
  }
  mctx.putImageData(maskData, 0, 0);

  return {
    maskUrl: maskCanvas.toDataURL('image/png'),
    bbox: {
      x: (minX / w) * 100,
      y: (minY / h) * 100,
      width: ((maxX - minX + 1) / w) * 100,
      height: ((maxY - minY + 1) / h) * 100,
    },
    selectedPixels: count,
  };
}