import type { Mesh, Vertex3D } from './geometry';
import { voxelsToGreedyMesh3D } from './greedy-mesh';

export type FontOption = {
  label: string;
  css: string;
  google?: boolean;
};

export const FONT_OPTIONS: FontOption[] = [
  { label: 'Textura', css: "'Textura', sans-serif" },
  { label: 'Impact', css: 'Impact, sans-serif' },
  { label: 'Arial', css: 'Arial, sans-serif' },
  { label: 'Verdana', css: 'Verdana, sans-serif' },
  { label: 'Trebuchet MS', css: "'Trebuchet MS', sans-serif" },
  { label: 'Times New Roman', css: "'Times New Roman', serif" },
  { label: 'Georgia', css: 'Georgia, serif' },
  { label: 'Courier New', css: "'Courier New', monospace" },
  { label: 'Comic Sans MS', css: "'Comic Sans MS', cursive" },
  { label: 'Anton', css: "'Anton', sans-serif", google: true },
  { label: 'Bebas Neue', css: "'Bebas Neue', sans-serif", google: true },
  { label: 'Roboto', css: "'Roboto', sans-serif", google: true },
  { label: 'Lobster', css: "'Lobster', cursive", google: true },
  { label: 'Pacifico', css: "'Pacifico', cursive", google: true },
  { label: 'Playfair Display', css: "'Playfair Display', serif", google: true },
];

export type TextGridOptions = {
  text: string;
  fontFamily: string;
  resolution: number;
  fontWeight?: string;
  italic?: boolean;
};

export type TextGrid = {
  grid: boolean[][];
  /**
   * Color medio ('#rrggbb') de cada celda encendida de la rejilla.
   * Las fuentes de color (emojis, color fonts) producen colores reales;
   * las monocromas producen el color del fillStyle (blanco).
   */
  colors: (string | null)[][];
  W: number;
  H: number;
};

/** Convierte componentes RGB 0-255 a hexadecimal '#rrggbb'. */
export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Indica si un color hex es (casi) blanco puro. Sirve para detectar
 * fuentes monocromas: el canvas las dibuja con fillStyle blanco, así
 * que todos sus vóxeles salen de ese color.
 */
export function isNearWhite(hex: string): boolean {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return false;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return r > 235 && g > 235 && b > 235;
}

type RenderedText = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cw: number;
  ch: number;
};

/**
 * Dibuja el texto en un canvas ajustado a su tamaño real y lo devuelve
 * junto a su contexto. Es la base tanto del muestreo a vóxeles como de
 * la textura exacta de la "vista plana".
 */
export function renderTextCanvas(
  text: string,
  fontFamily: string,
  fontWeight: string,
  italic: boolean,
  fontPx: number,
  fillStyle: string
): RenderedText | null {
  if (typeof document === 'undefined' || !text.trim()) return null;

  const fontSpec = `${italic ? 'italic ' : ''}${fontWeight} ${fontPx}px ${fontFamily}`;

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) return null;

  measureCtx.font = fontSpec;
  const metrics = measureCtx.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent || fontPx * 0.78;
  const descent = metrics.actualBoundingBoxDescent || fontPx * 0.22;
  const textWidth = metrics.width;
  const textHeight = ascent + descent;
  if (textWidth <= 0 || textHeight <= 0) return null;

  const pad = fontPx * 0.12;
  const cw = Math.ceil(textWidth + pad * 2);
  const ch = Math.ceil(textHeight + pad * 2);

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.font = fontSpec;
  // El fillStyle solo afecta a las fuentes monocromas; las fuentes de
  // color (emojis) dibujan sus glifos con sus colores nativos.
  ctx.fillStyle = fillStyle;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, pad, pad + ascent);

  return { canvas, ctx, cw, ch };
}

/**
 * Rasteriza un texto con la fuente elegida y lo muestrea en una
 * rejilla de vóxeles 2D (grid[x][y], con Y hacia arriba), capturando
 * también el color real de cada celda (por si la fuente trae color).
 */
export function rasterizeTextGrid(opts: TextGridOptions): TextGrid {
  const empty: TextGrid = { grid: [], colors: [], W: 0, H: 0 };
  if (typeof document === 'undefined') return empty;

  const { text, fontFamily, resolution, fontWeight = '700', italic = false } = opts;
  if (!text.trim()) return empty;

  const H = Math.max(8, Math.round(resolution));
  const fontPx = Math.max(96, H * 6);
  const rendered = renderTextCanvas(
    text,
    fontFamily,
    fontWeight,
    italic,
    fontPx,
    '#ffffff'
  );
  if (!rendered) return empty;

  const { cw, ch } = rendered;
  const ctx = rendered.ctx;

  const W = Math.max(8, Math.round((cw / ch) * H));
  const data = ctx.getImageData(0, 0, cw, ch).data;

  const grid: boolean[][] = Array.from({ length: W }, () => Array(H).fill(false));
  const colors: (string | null)[][] = Array.from(
    { length: W },
    () => Array(H).fill(null)
  );
  const samples = 3;

  for (let gx = 0; gx < W; gx++) {
    for (let gy = 0; gy < H; gy++) {
      let on = false;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let hits = 0;

      for (let sx = 0; sx < samples; sx++) {
        for (let sy = 0; sy < samples; sy++) {
          const px = Math.min(
            cw - 1,
            Math.floor(((gx + (sx + 0.5) / samples) / W) * cw)
          );
          const py = Math.min(
            ch - 1,
            Math.floor(((gy + (sy + 0.5) / samples) / H) * ch)
          );
          const o = (py * cw + px) * 4;
          if (data[o + 3] > 100) {
            on = true;
            rSum += data[o];
            gSum += data[o + 1];
            bSum += data[o + 2];
            hits++;
          }
        }
      }

      if (on) {
        grid[gx][H - 1 - gy] = true;
        colors[gx][H - 1 - gy] =
          hits > 0 ? rgbToHex(rSum / hits, gSum / hits, bSum / hits) : null;
      }
    }
  }

  return { grid, colors, W, H };
}

export type TextVoxelOptions = TextGridOptions & {
  depth: number;
  /**
   * true = "letras huecas": conserva solo las celdas del contorno del
   * trazo (las que tocan una celda vacía). Reduce drásticamente los
   * vóxeles, vértices y caras de la malla resultante.
   */
  hollow?: boolean;
  /**
   * true (por defecto) = greedy meshing: la letra sigue sólida, pero
   * las caras coplanares vecinas se fusionan en rectángulos grandes.
   * Las caras planas quedan sin divisiones internas: no se generan
   * vértices ni aristas en el interior. Reduce vértices y caras en
   * un orden de magnitud con exactamente el mismo aspecto.
   */
  greedy?: boolean;
};

/**
 * Convierte un texto en una malla 3D de vóxeles, usando el mismo
 * sistema de caras compartidas que la reconstrucción por vistas.
 * Cada cara hereda el color del vóxel que la genera.
 */
/**
 * Extrae el contorno de una rejilla booleana: conserva solo las celdas
 * encendidas que tienen al menos un vecino apagado (4-vecindad) o que
 * tocan el borde de la rejilla. Las celdas interiores se apagan, lo que
 * deja la letra "hueca" (solo el borde del trazo) y genera muchísimos
 * menos vóxeles, vértices y caras.
 */
export function extractContourGrid(
  grid: boolean[][],
  W: number,
  H: number
): boolean[][] {
  const out: boolean[][] = Array.from({ length: W }, () =>
    Array(H).fill(false)
  );
  const on = (x: number, y: number): boolean =>
    x >= 0 && x < W && y >= 0 && y < H && grid[x][y];
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (!grid[x][y]) continue;
      if (!on(x + 1, y) || !on(x - 1, y) || !on(x, y + 1) || !on(x, y - 1)) {
        out[x][y] = true;
      }
    }
  }
  return out;
}

export function buildTextMesh(opts: TextVoxelOptions): Mesh {
  const { depth, hollow = false, greedy = true } = opts;
  const { grid, colors, W, H } = rasterizeTextGrid(opts);
  if (W === 0 || H === 0) return { vertices: [], faces: [] };

  // Letras huecas: conserva solo el contorno del trazo
  const shape = hollow ? extractContourGrid(grid, W, H) : grid;

  const D = Math.max(1, Math.round(depth));
  const voxels: boolean[][][] = Array.from({ length: W }, () =>
    Array.from({ length: H }, () => Array(D).fill(false))
  );
  const voxelColors: (string | null)[][][] = Array.from({ length: W }, () =>
    Array.from({ length: H }, () => Array(D).fill(null))
  );

  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (!shape[x][y]) continue;
      const c = colors[x][y] ?? null;
      for (let z = 0; z < D; z++) {
        voxels[x][y][z] = true;
        voxelColors[x][y][z] = c;
      }
    }
  }

  // Greedy meshing: caras fusionadas, sin divisiones internas
  return greedy
    ? voxelsToGreedyMesh3D(voxels, W, H, D, voxelColors)
    : voxelsToBoxMesh3D(voxels, W, H, D, voxelColors);
}

/**
 * Igual que voxelsToBoxMesh pero con dimensiones independientes
 * (W×H×D) y escala uniforme para no deformar el texto.
 * Si se pasa voxelColors, cada cara exportada lleva su color.
 */
export function voxelsToBoxMesh3D(
  voxels: boolean[][][],
  W: number,
  H: number,
  D: number,
  voxelColors?: (string | null)[][][]
): Mesh {
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const faceColors: (string | null)[] = [];
  const vertMap = new Map<string, number>();
  const maxDim = Math.max(W, H, D);
  const scale = maxDim / 2;

  const getVertex = (x: number, y: number, z: number): number => {
    const key = `${x},${y},${z}`;
    const existing = vertMap.get(key);
    if (existing !== undefined) return existing;
    const id = vertices.length;
    vertices.push({
      x: (x - W / 2) / scale,
      y: (y - H / 2) / scale,
      z: (z - D / 2) / scale,
    });
    vertMap.set(key, id);
    return id;
  };

  const has = (x: number, y: number, z: number): boolean =>
    x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D && voxels[x][y][z];

  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      for (let z = 0; z < D; z++) {
        if (!voxels[x][y][z]) continue;

        const color = voxelColors ? voxelColors[x][y][z] ?? null : null;
        const addFace = (a: number, b: number, c: number, d: number) => {
          faces.push([a, b, c, d]);
          faceColors.push(color);
        };

        const px = x + 1;
        const py = y + 1;
        const pz = z + 1;

        if (!has(x + 1, y, z))
          addFace(
            getVertex(px, y, z),
            getVertex(px, py, z),
            getVertex(px, py, pz),
            getVertex(px, y, pz)
          );
        if (!has(x - 1, y, z))
          addFace(
            getVertex(x, y, z),
            getVertex(x, y, pz),
            getVertex(x, py, pz),
            getVertex(x, py, z)
          );
        if (!has(x, y + 1, z))
          addFace(
            getVertex(x, py, z),
            getVertex(x, py, pz),
            getVertex(px, py, pz),
            getVertex(px, py, z)
          );
        if (!has(x, y - 1, z))
          addFace(
            getVertex(x, y, z),
            getVertex(px, y, z),
            getVertex(px, y, pz),
            getVertex(x, y, pz)
          );
        if (!has(x, y, z + 1))
          addFace(
            getVertex(x, y, pz),
            getVertex(px, y, pz),
            getVertex(px, py, pz),
            getVertex(x, py, pz)
          );
        if (!has(x, y, z - 1))
          addFace(
            getVertex(x, y, z),
            getVertex(x, py, z),
            getVertex(px, py, z),
            getVertex(px, y, z)
          );
      }
    }
  }

  const anyColor = faceColors.some((c) => c !== null);
  return anyColor ? { vertices, faces, faceColors } : { vertices, faces };
}

export type TextPlaneOptions = TextGridOptions & {
  /** Color base ('#rrggbb') para fuentes monocromas o al ignorar el color propio. */
  baseColor: string;
  /** false = fuerza el color base incluso si la fuente trae color propio. */
  useFontColor?: boolean;
};

/**
 * Repinta todos los píxeles opacos del canvas con un color hex,
 * conservando la alpha (bordes suaves incluidos).
 */
function recolorCanvas(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  hex: string
): void {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  const img = ctx.getImageData(0, 0, cw, ch);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 0) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Construye la TEXTURA EXACTA del texto renderizado (PNG data URL):
 * respeta el color propio de la fuente (emojis, color fonts) y, si es
 * monocroma (o useFontColor=false), la rellena con el color base.
 * La usan la "vista plana" y la malla suave del texto.
 */
export function buildTextTexture(
  opts: TextPlaneOptions & { fontPx: number }
): { texture: string; cw: number; ch: number } | null {
  const {
    text,
    fontFamily,
    fontWeight = '700',
    italic = false,
    baseColor,
    useFontColor = true,
    fontPx,
  } = opts;
  if (typeof document === 'undefined' || !text.trim()) return null;

  let rendered = renderTextCanvas(
    text,
    fontFamily,
    fontWeight,
    italic,
    fontPx,
    '#ffffff'
  );
  if (!rendered) return null;

  // ¿La fuente aporta color propio? (fuentes de color / emojis)
  const { ctx, cw, ch } = rendered;
  const probe = ctx.getImageData(0, 0, cw, ch).data;
  let hasRealColor = false;
  for (let i = 0; i < probe.length; i += 4) {
    if (
      probe[i + 3] > 100 &&
      !isNearWhite(rgbToHex(probe[i], probe[i + 1], probe[i + 2]))
    ) {
      hasRealColor = true;
      break;
    }
  }

  if (!useFontColor) {
    // Ignora el color de la fuente: repinta todo con el color base
    recolorCanvas(ctx, cw, ch, baseColor);
  } else if (!hasRealColor) {
    // Fuente monocroma: rellena con el color base elegido
    const colored = renderTextCanvas(
      text,
      fontFamily,
      fontWeight,
      italic,
      fontPx,
      baseColor
    );
    if (colored) rendered = colored;
  }

  return { texture: rendered.canvas.toDataURL('image/png'), cw, ch };
}

/**
 * "Vista plana": en lugar de extruir vóxeles, genera un panel fino
 * con la APARIENCIA EXACTA del texto tal como se renderiza en
 * pantalla (color píxel a píxel, incluidos emojis y fuentes de color).
 * Devuelve una malla de 4 vértices + 1 cara con su textura PNG.
 */
export function buildTextPlaneMesh(opts: TextPlaneOptions): Mesh {
  const empty: Mesh = { vertices: [], faces: [] };
  const { text, resolution } = opts;
  if (typeof document === 'undefined' || !text.trim()) return empty;

  // Textura a alta resolución, proporcional al control de nitidez
  const tex = buildTextTexture({
    ...opts,
    fontPx: Math.max(96, Math.round(resolution) * 8),
  });
  if (!tex) return empty;

  const texture = tex.texture;

  // Panel centrado que conserva las proporciones del texto
  // y cabe en el cubo unitario del visor
  const aspect = tex.cw / tex.ch;
  const scale = Math.max(aspect, 1);
  const hw = aspect / scale;
  const hh = 1 / scale;

  const vertices: Vertex3D[] = [
    { x: -hw, y: -hh, z: 0 },
    { x: hw, y: -hh, z: 0 },
    { x: hw, y: hh, z: 0 },
    { x: -hw, y: hh, z: 0 },
  ];
  const uvs: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  return { vertices, faces: [[0, 1, 2, 3]], texture, uvs };
}