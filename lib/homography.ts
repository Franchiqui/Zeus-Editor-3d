/**
 * Utilidades de homografía: mapear un rectángulo a un cuadrilátero
 * (warp por perspectiva). Usado tanto por el editor (ObjectOverlay, vía
 * matrix3d de CSS) como por el exportador (object-node, vía canvas) para
 * garantizar que la deformación es idéntica en preview y render final.
 */

export interface Homography {
  a: number; b: number; c: number;
  d: number; e: number; f: number;
  g: number; h: number;
}

/**
 * Resuelve un sistema lineal A·x = b por eliminación de Gauss con pivoteo
 * parcial. Devuelve null si el sistema es singular.
 */
export function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / pv;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r][n];
    for (let c = r + 1; c < n; c++) sum -= M[r][c] * x[c];
    x[r] = sum / M[r][r];
  }
  return x;
}

/**
 * Calcula la homografía que mapea 4 puntos origen → 4 puntos destino.
 * Modelo:
 *   x' = (a·x + b·y + c) / (g·x + h·y + 1)
 *   y' = (d·x + e·y + f) / (g·x + h·y + 1)
 * Origen y destino deben estar en el mismo sistema de coordenadas (px).
 * Orden de las 4 esquinas: sup-izq, sup-der, inf-der, inf-izq.
 */
export function computeHomography(
  src: [number, number][],
  dst: [number, number][],
): Homography | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const [dx, dy] = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }
  const sol = solveLinearSystem(A, b);
  if (!sol) return null;
  return {
    a: sol[0], b: sol[1], c: sol[2],
    d: sol[3], e: sol[4], f: sol[5],
    g: sol[6], h: sol[7],
  };
}

/** Aplica la homografía a un punto (x, y) → (x', y'). */
export function applyHomography(h: Homography, x: number, y: number): [number, number] {
  const w = h.g * x + h.h * y + 1;
  if (Math.abs(w) < 1e-12) return [x, y];
  return [(h.a * x + h.b * y + h.c) / w, (h.d * x + h.e * y + h.f) / w];
}

/**
 * Convierte la homografía en un string matrix3d() de CSS (column-major).
 * Mapea el rectángulo origen a un cuadrilátero: las 4 esquinas del elemento
 * quedan EXACTAMENTE en las posiciones de los vértices de destino.
 */
export function homographyToMatrix3d(h: Homography): string {
  return `matrix3d(${h.a},${h.d},0,${h.g},${h.b},${h.e},0,${h.h},0,0,1,0,${h.c},${h.f},0,1)`;
}

/**
 * Dibuja una imagen deformada por homografía sobre un ctx de canvas,
 * mapeando el rectángulo fuente (4 esquinas en px del canvas, orden
 * TL,TR,BR,BL) al cuadrilátero destino (4 esquinas en px del canvas).
 * Se subdivide en una malla (grid×grid) de celdas afines para aproximar la
 * perspectiva; con grid≥20 el resultado es visualmente indistinguible de un
 * warp perspectivo puro.
 *
 * sx0,sy0,sw,sh: recorte fuente en px de la imagen (por defecto toda la imagen).
 */
/**
 * Resuelve una afine (a,b,c,d,e,f) tal que x' = a·x + c·y + e,
 * y' = b·x + d·y + f, mapeando 3 puntos fuente → 3 puntos destino.
 * Devuelve null si los puntos son colineales (singular).
 */
function affineFromThreePoints(
  src: [number, number][],
  dst: [number, number][],
): [number, number, number, number, number, number] | null {
  const A = src.map(([x, y]) => [x, y, 1]);
  const xs = solveLinearSystem(A.map((r) => [...r]), dst.map((p) => p[0]));
  const ys = solveLinearSystem(A.map((r) => [...r]), dst.map((p) => p[1]));
  if (!xs || !ys) return null;
  // setTransform(a, b, c, d, e, f): x' = a·x + c·y + e ; y' = b·x + d·y + f
  return [xs[0], ys[0], xs[1], ys[1], xs[2], ys[2]];
}

/**
 * Dibuja un triángulo de la imagen mapeado por afine. Toma el triángulo
 * fuente en coords locales (lu,lv) y lo dibuja en el triángulo destino
 * (px del canvas), rellenando con el sub-rect (srcX,srcY,cellW,cellH)
 * de la imagen.
 *
 * Para evitar la "malla" del anti-aliasing del clip:
 *  - `extrude` expande el triángulo de clip hacia afuera desde su centroide.
 *  - `padSrc` expande el rectángulo fuente y el local en px de fuente, de
 *    modo que la imagen se extiende más allá de las aristas del triángulo y
 *    rellena la banda extruida con contenido real de la imagen (no con
 *    fondo transparente). La afine se calcula con los puntos originales.
 */
function drawAffineTriangle(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  srcX: number,
  srcY: number,
  cellW: number,
  cellH: number,
  localPts: [number, number][],
  destPts: [number, number][],
  extrude: number,
  padSrc: number,
  imgW: number,
  imgH: number,
): void {
  const m = affineFromThreePoints(localPts, destPts);
  if (!m) return;

  // Expandir el triángulo de clip desde su centroide.
  const cx = (destPts[0][0] + destPts[1][0] + destPts[2][0]) / 3;
  const cy = (destPts[0][1] + destPts[1][1] + destPts[2][1]) / 3;
  const expanded = destPts.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return [x, y] as [number, number];
    return [x + (dx / len) * extrude, y + (dy / len) * extrude] as [number, number];
  });

  // Overscan: rectángulo fuente y local expandidos (1:1, local = src - srcX).
  let sx = srcX - padSrc;
  let sy = srcY - padSrc;
  let sw = cellW + 2 * padSrc;
  let sh = cellH + 2 * padSrc;
  let dx = -padSrc;
  let dy = -padSrc;
  let dw = sw;
  let dh = sh;

  // Clamp al área de la imagen: recorta fuente y local a la par para no
  // muestrear fuera de la imagen (silueta del objeto = transparente).
  const cl = Math.max(0, -sx);
  if (cl > 0) { sx += cl; sw -= cl; dx += cl; dw -= cl; }
  const cr = Math.max(0, sx + sw - imgW);
  if (cr > 0) { sw -= cr; dw -= cr; }
  const ctop = Math.max(0, -sy);
  if (ctop > 0) { sy += ctop; sh -= ctop; dy += ctop; dh -= ctop; }
  const cb = Math.max(0, sy + sh - imgH);
  if (cb > 0) { sh -= cb; dh -= cb; }

  if (sw <= 0 || sh <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(expanded[0][0], expanded[0][1]);
  ctx.lineTo(expanded[1][0], expanded[1][1]);
  ctx.lineTo(expanded[2][0], expanded[2][1]);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

// Buffer offscreen reutilizado para renderizar el warp sin costuras y
// luego componerlo sobre el canvas principal con la opacidad del objeto.
let warpBuffer: OffscreenCanvas | HTMLCanvasElement | null = null;
let warpCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
let warpW = 0;
let warpH = 0;

function getWarpCtx(w: number, h: number): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (warpBuffer && warpCtx && warpW === w && warpH === h) return warpCtx;
  if (typeof OffscreenCanvas !== 'undefined') {
    warpBuffer = new OffscreenCanvas(w, h);
  } else {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    warpBuffer = c;
  }
  // alpha: true → buffer transparente, para que las posibles costuras de AA
  // dejen ver el vídeo por detrás y no un color sólido (blanco/negro).
  warpCtx = warpBuffer.getContext('2d', { alpha: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;
  warpW = w;
  warpH = h;
  return warpCtx;
}

/**
 * Dibuja una imagen deformada por homografía sobre un ctx de canvas,
 * mapeando el rectángulo fuente (4 esquinas en px del canvas, orden
 * TL,TR,BR,BL) al cuadrilátero destino (4 esquinas en px del canvas).
 *
 * Renderiza el warp en un buffer offscreen transparente subdividiendo en
 * una malla (grid×grid) de celdas y cada celda en 2 triángulos, con afine
 * exacta (3 puntos) por triángulo y clip ligeramente extruido para que los
 * triángulos vecinos se solapen y cubran las costuras de anti-aliasing
 * (sin la "malla" visible). Luego compone el buffer sobre el canvas con
 * la opacidad ya fijada en ctx.globalAlpha.
 *
 * sx0,sy0,sw,sh: recorte fuente en px de la imagen (por defecto toda la imagen).
 */
export function drawHomographyImage(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  srcRect: [number, number][],
  dst: [number, number][],
  sx0 = 0,
  sy0 = 0,
  sw?: number,
  sh?: number,
  grid = 24,
): void {
  const h = computeHomography(srcRect, dst);
  if (!h) return; // degenerado: no dibuja

  const imgW = sw ?? (img as HTMLImageElement).naturalWidth ?? (img as HTMLCanvasElement).width;
  const imgH = sh ?? (img as HTMLImageElement).naturalHeight ?? (img as HTMLCanvasElement).height;
  if (!imgW || !imgH) return;

  const mainCanvas = (ctx as any).canvas as { width: number; height: number } | undefined;
  const W = mainCanvas?.width ?? 0;
  const H = mainCanvas?.height ?? 0;
  if (!W || !H) return;

  const octx = getWarpCtx(W, H);
  if (!octx || !warpBuffer) return;
  octx.clearRect(0, 0, W, H);
  octx.imageSmoothingEnabled = true;
  octx.globalAlpha = 1;

  const [tl, tr, br, bl] = srcRect;
  const rows = grid;
  const cols = grid;
  const cellW = imgW / cols;
  const cellH = imgH / rows;

  // Punto del rectángulo fuente (en px canvas) → aplicar homografía → destino.
  const spt = (u: number, v: number): [number, number] => {
    const px = tl[0] + u * (tr[0] - tl[0]) + v * (bl[0] - tl[0]);
    const py = tl[1] + u * (tr[1] - tl[1]) + v * (bl[1] - tl[1]);
    return applyHomography(h, px, py);
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u0 = c / cols;
      const u1 = (c + 1) / cols;
      const v0 = r / rows;
      const v1 = (r + 1) / rows;

      // Esquinas destino de la celda (homografía).
      const p0 = spt(u0, v0); // sup-izq
      const p1 = spt(u1, v0); // sup-der
      const p2 = spt(u1, v1); // inf-der
      const p3 = spt(u0, v1); // inf-izq

      const srcX = sx0 + c * cellW;
      const srcY = sy0 + r * cellH;

      // Solape proporcional al tamaño de la celda para cubrir el AA del clip.
      const avgEdge =
        (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) +
          Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) +
          Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) +
          Math.hypot(p0[0] - p3[0], p0[1] - p3[1])) /
        4;
      const extrude = Math.max(1, Math.min(3, avgEdge * 0.15));
      // px de fuente necesarios para cubrir `extrude` px de destino:
      // escala local→dest ≈ avgEdge / cellW.
      const scale = cellW > 0 ? avgEdge / cellW : 1;
      const padSrc = Math.max(0.5, Math.min(6, extrude / scale));

      // Celda local (0,0)-(cellW,0)-(cellW,cellH)-(0,cellH) → 2 triángulos.
      // Triángulo A: (0,0)-(cellW,0)-(0,cellH) → p0,p1,p3
      drawAffineTriangle(octx, img, srcX, srcY, cellW, cellH,
        [[0, 0], [cellW, 0], [0, cellH]],
        [p0, p1, p3], extrude, padSrc, imgW, imgH);
      // Triángulo B: (cellW,0)-(cellW,cellH)-(0,cellH) → p1,p2,p3
      drawAffineTriangle(octx, img, srcX, srcY, cellW, cellH,
        [[cellW, 0], [cellW, cellH], [0, cellH]],
        [p1, p2, p3], extrude, padSrc, imgW, imgH);
    }
  }

  // Componer el warp sobre el canvas principal (ctx.globalAlpha ya tiene la
  // opacidad del objeto fijada por el llamador).
  ctx.drawImage(warpBuffer, 0, 0);
}