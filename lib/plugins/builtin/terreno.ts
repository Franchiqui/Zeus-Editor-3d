import type { Mesh, Vertex3D } from '@/lib/geometry';
import type { ZeusPlugin, PluginParams } from '../types';

/**
 * Generador de terreno (montañas).
 *
 * Trabaja en dos modos:
 *  · Con superficie: toma la malla que recibe (por ejemplo un suelo/plano
 *    creado en el editor) y la sustituye por un terreno generado.
 *  · Generador: si no recibe ninguna superficie (malla vacía) crea la
 *    superficie él mismo a partir del ancho/largo indicados, centrada en
 *    el origen. Así se pueden crear dunas o cordilleras desde cero, sin
 *    necesidad de dibujar antes un suelo.
 *
 * La geometría se reconstruye como una rejilla sobre la huella (footprint)
 * en el plano XZ, con las alturas sobre el punto más alto de la superficie
 * base. El abanico de parámetros permite pasar de dunas suaves y
 * redondeadas a cordilleras rocosas con crestas afiladas.
 */

/* ------------------------------------------------------------------ *
 * Lectura de parámetros (el usuario puede no haberlos tocado)
 * ------------------------------------------------------------------ */

const num = (params: PluginParams, id: string, porDefecto = 0): number => {
  const v = params[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : porDefecto;
};
const str = (params: PluginParams, id: string, porDefecto = ''): string => {
  const v = params[id];
  return typeof v === 'string' ? v : porDefecto;
};
const bool = (params: PluginParams, id: string, porDefecto = false): boolean => {
  const v = params[id];
  return typeof v === 'boolean' ? v : porDefecto;
};

/* ------------------------------------------------------------------ *
 * Ruido determinista: value noise 2D con interpolación quíntica.
 * Misma entrada → misma salida (no usa Math.random).
 * ------------------------------------------------------------------ */

function hash2(ix: number, iy: number, semilla: number): number {
  let h =
    Math.imul(ix | 0, 374761393) ^
    Math.imul(iy | 0, 668265263) ^
    Math.imul(semilla | 0, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296; // [0, 1)
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

function valueNoise2(x: number, y: number, semilla: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const u = fade(x - x0);
  const v = fade(y - y0);
  const a = hash2(x0, y0, semilla);
  const b = hash2(x0 + 1, y0, semilla);
  const c = hash2(x0, y0 + 1, semilla);
  const d = hash2(x0 + 1, y0 + 1, semilla);
  const arriba = a + (b - a) * u;
  const abajo = c + (d - c) * u;
  return arriba + (abajo - arriba) * v; // [0, 1)
}

/**
 * Fractal (fBm) con mezcla opcional a "ridged": `cresta` = 0 da colinas
 * redondeadas (dunas) y `cresta` = 1 picos/aristas (roca).
 */
function fractal(
  x: number,
  y: number,
  semilla: number,
  octavas: number,
  persistencia: number,
  cresta: number
): number {
  let suma = 0;
  let amplitud = 1;
  let pesoTotal = 0;
  let frec = 1;
  for (let o = 0; o < octavas; o++) {
    let n = valueNoise2(x * frec, y * frec, semilla + o * 1013);
    if (cresta > 0) {
      // Ridged: pliega el ruido para crear crestas; se suaviza con el cuadrado.
      const r = 1 - Math.abs(n * 2 - 1);
      n = n * (1 - cresta) + r * r * cresta;
    }
    suma += n * amplitud;
    pesoTotal += amplitud;
    amplitud *= persistencia;
    frec *= 2;
  }
  return pesoTotal > 0 ? suma / pesoTotal : 0; // [0, 1)
}

/* ------------------------------------------------------------------ *
 * Color
 * ------------------------------------------------------------------ */

type RGB = [number, number, number];

function hexARgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const completo = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(completo, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbAHex(rgb: RGB): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
}

const mezcla = (a: RGB, b: RGB, w: number): RGB => [
  a[0] + (b[0] - a[0]) * w,
  a[1] + (b[1] - a[1]) * w,
  a[2] + (b[2] - a[2]) * w,
];

const suavizar = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

function gradiente(paradas: Array<{ t: number; rgb: RGB }>, t: number): RGB {
  if (paradas.length === 0) return [200, 200, 200];
  if (t <= paradas[0].t) return paradas[0].rgb;
  for (let i = 1; i < paradas.length; i++) {
    if (t <= paradas[i].t) {
      const p0 = paradas[i - 1];
      const p1 = paradas[i];
      const w = (t - p0.t) / Math.max(1e-6, p1.t - p0.t);
      return mezcla(p0.rgb, p1.rgb, w);
    }
  }
  return paradas[paradas.length - 1].rgb;
}

type Paleta = { paradas: Array<{ t: number; rgb: RGB }>; roca: RGB; nieve?: RGB };

const PALETAS: Record<string, Paleta> = {
  dunas: {
    paradas: [
      { t: 0, rgb: hexARgb('#f0e2b4') },
      { t: 0.5, rgb: hexARgb('#e6d29a') },
      { t: 1, rgb: hexARgb('#d3b878') },
    ],
    roca: hexARgb('#c2a86e'),
  },
  colinas: {
    paradas: [
      { t: 0, rgb: hexARgb('#7ea64d') },
      { t: 0.5, rgb: hexARgb('#8f9a55') },
      { t: 0.82, rgb: hexARgb('#8a7d5a') },
      { t: 1, rgb: hexARgb('#b9b3a2') },
    ],
    roca: hexARgb('#7c6f57'),
  },
  montanas: {
    paradas: [
      { t: 0, rgb: hexARgb('#5f8347') },
      { t: 0.35, rgb: hexARgb('#6f7a4a') },
      { t: 0.6, rgb: hexARgb('#7d7260') },
      { t: 0.82, rgb: hexARgb('#8f8f92') },
      { t: 1, rgb: hexARgb('#eef2f7') },
    ],
    roca: hexARgb('#6f6d70'),
    nieve: hexARgb('#ffffff'),
  },
  rocosas: {
    paradas: [
      { t: 0, rgb: hexARgb('#6d6f72') },
      { t: 0.5, rgb: hexARgb('#82848a') },
      { t: 1, rgb: hexARgb('#a9adb4') },
    ],
    roca: hexARgb('#5c5e63'),
    nieve: hexARgb('#ffffff'),
  },
};

/**
 * Color de una cara a partir de su altura normalizada (0..1) y su
 * pendiente (0 = llano, 1 = pared). Añade roca en las pendientes fuertes
 * y nieve en las cumbres altas y relativamente llanas.
 */
function colorDeCara(
  paleta: Paleta,
  t: number,
  pendiente: number,
  nivelNieve: number
): string {
  let rgb = gradiente(paleta.paradas, t);
  // Roca en las laderas pronunciadas.
  const wRoca = suavizar((pendiente - 0.35) / 0.45);
  rgb = mezcla(rgb, paleta.roca, wRoca * 0.9);
  // Nieve en las cumbres altas y no demasiado verticales.
  if (paleta.nieve && t > nivelNieve) {
    const wAltura = suavizar((t - nivelNieve) / Math.max(1e-6, 1 - nivelNieve));
    const wLlano = 1 - suavizar((pendiente - 0.3) / 0.5);
    rgb = mezcla(rgb, paleta.nieve, wAltura * (0.3 + 0.7 * wLlano));
  }
  return rgbAHex(rgb);
}

/* ------------------------------------------------------------------ *
 * Plugin
 * ------------------------------------------------------------------ */

export const generarTerreno: ZeusPlugin = {
  id: 'generador-terreno',
  nombre: 'Generador de montañas',
  categoria: 'terreno',
  // Puede crear la superficie desde cero: si no hay objeto base, el
  // editor le pasa una malla vacía y usa el resultado para un objeto nuevo.
  generador: true,
  descripcion:
    'Crea o transforma una superficie en relieve: de dunas suaves a picos rocosos.',
  params: [
    {
      tipo: 'slider',
      id: 'ancho',
      etiqueta: 'Ancho (nuevo)',
      min: 4,
      max: 400,
      paso: 1,
      valor: 40,
      unidad: 'u',
      descripcion:
        'Ancho del terreno al generar un objeto nuevo (no afecta si lo aplicas a una superficie existente).',
    },
    {
      tipo: 'slider',
      id: 'largo',
      etiqueta: 'Largo (nuevo)',
      min: 4,
      max: 400,
      paso: 1,
      valor: 40,
      unidad: 'u',
      descripcion:
        'Largo del terreno al generar un objeto nuevo (no afecta si lo aplicas a una superficie existente).',
    },
    {
      tipo: 'slider',
      id: 'grosor',
      etiqueta: 'Grosor base',
      min: 0,
      max: 100,
      paso: 1,
      valor: 0,
      unidad: 'u',
      descripcion:
        'Añade una base sólida (faldón y suelo) bajo el terreno. 0 = solo la superficie.',
    },
    {
      tipo: 'select',
      id: 'estilo',
      etiqueta: 'Estilo',
      opciones: [
        { valor: 'dunas', etiqueta: 'Dunas (arena)' },
        { valor: 'colinas', etiqueta: 'Colinas' },
        { valor: 'montanas', etiqueta: 'Montañas' },
        { valor: 'rocosas', etiqueta: 'Montañas rocosas' },
      ],
      valor: 'montanas',
    },
    {
      tipo: 'slider',
      id: 'altura',
      etiqueta: 'Altura',
      min: 0,
      max: 100,
      paso: 1,
      valor: 38,
      unidad: '%',
      descripcion: 'Altura máxima del relieve respecto al tamaño de la superficie.',
    },
    {
      tipo: 'slider',
      id: 'formaciones',
      etiqueta: 'Formaciones',
      min: 2,
      max: 40,
      paso: 1,
      valor: 9,
      descripcion: 'Cuántas montañas caben a lo ancho de la superficie.',
    },
    {
      tipo: 'slider',
      id: 'detalle',
      etiqueta: 'Nivel de detalle',
      min: 1,
      max: 8,
      paso: 1,
      valor: 6,
      descripcion: 'Capas de ruido superpuestas: más detalle, más rugosidad fina.',
    },
    {
      tipo: 'slider',
      id: 'rugosidad',
      etiqueta: 'Rugosidad',
      min: 0,
      max: 100,
      paso: 1,
      valor: 55,
      unidad: '%',
      descripcion: 'De terrenos suaves (dunas) a terrenos quebrados (roca).',
    },
    {
      tipo: 'slider',
      id: 'crestas',
      etiqueta: 'Crestas afiladas',
      min: 0,
      max: 100,
      paso: 1,
      valor: 45,
      unidad: '%',
      descripcion: '0 = colinas redondeadas; 100 = aristas y picos marcados.',
    },
    {
      tipo: 'slider',
      id: 'planicie',
      etiqueta: 'Aplanar valles',
      min: 0,
      max: 100,
      paso: 1,
      valor: 25,
      unidad: '%',
      descripcion: 'Hunde los valles para dejar llanuras y resaltar los picos.',
    },
    {
      tipo: 'slider',
      id: 'resolucion',
      etiqueta: 'Resolución',
      min: 16,
      max: 400,
      paso: 1,
      valor: 140,
      descripcion: 'Densidad de la rejilla del terreno (más = más detalle y peso).',
    },
    {
      tipo: 'slider',
      id: 'semilla',
      etiqueta: 'Semilla',
      min: 0,
      max: 999,
      paso: 1,
      valor: 137,
      descripcion: 'Cambia el patrón del terreno sin tocar el resto.',
    },
    {
      tipo: 'check',
      id: 'borde',
      etiqueta: 'Bordes planos',
      descripcion: 'Rebaja los bordes para encajar con el suelo de alrededor.',
      valor: true,
    },
    {
      tipo: 'check',
      id: 'colorear',
      etiqueta: 'Colorear por altura',
      descripcion: 'Pinta cada cara según su altura y pendiente (arena, verde, roca, nieve).',
      valor: true,
    },
    {
      tipo: 'slider',
      id: 'nieve',
      etiqueta: 'Nivel de nieve',
      min: 0,
      max: 100,
      paso: 1,
      valor: 62,
      unidad: '%',
      descripcion: 'A partir de qué altura aparece la nieve (solo estilos con nieve).',
    },
  ],
  aplicar(mesh: Mesh, params: PluginParams): Mesh {
    const verts = mesh.vertices ?? [];
    // Sin malla base el plugin actúa como generador: crea la superficie
    // desde cero usando el ancho y el largo indicados.
    const generando = verts.length === 0;

    const estilo = str(params, 'estilo', 'montanas');
    const paleta = PALETAS[estilo] ?? PALETAS.montanas;
    const res = Math.max(8, Math.min(400, Math.round(num(params, 'resolucion', 140))));
    const altura = Math.max(0, num(params, 'altura', 38)) / 100;
    const formaciones = Math.max(1, num(params, 'formaciones', 9));
    const octavas = Math.max(1, Math.min(8, Math.round(num(params, 'detalle', 6))));
    const persistencia = Math.max(0.05, Math.min(0.95, num(params, 'rugosidad', 55) / 100));
    const cresta = Math.max(0, Math.min(1, num(params, 'crestas', 45) / 100));
    const planicie = Math.max(0, Math.min(1, num(params, 'planicie', 25) / 100));
    const semilla = Math.round(num(params, 'semilla', 137)) | 0;
    const bordePlano = bool(params, 'borde', true);
    const colorear = bool(params, 'colorear', true);
    const nivelNieve = Math.max(0, Math.min(1, num(params, 'nieve', 62) / 100));
    const grosor = Math.max(0, num(params, 'grosor', 0));

    // Huella (footprint) en XZ, cota superior e inferior en Y.
    let minX: number;
    let maxX: number;
    let minZ: number;
    let maxZ: number;
    let maxY: number;
    let minY: number;
    if (generando) {
      // Superficie nueva centrada en el origen, apoyada sobre y = 0.
      const ancho = Math.max(1, num(params, 'ancho', 40));
      const largo = Math.max(1, num(params, 'largo', 40));
      minX = -ancho / 2;
      maxX = ancho / 2;
      minZ = -largo / 2;
      maxZ = largo / 2;
      maxY = 0;
      minY = 0;
    } else {
      minX = Infinity;
      maxX = -Infinity;
      minZ = Infinity;
      maxZ = -Infinity;
      maxY = -Infinity;
      minY = Infinity;
      for (const v of verts) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.z < minZ) minZ = v.z;
        if (v.z > maxZ) maxZ = v.z;
        if (v.y > maxY) maxY = v.y;
        if (v.y < minY) minY = v.y;
      }
    }

    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    const span = Math.max(spanX, spanZ);
    if (!(span > 1e-6)) return mesh; // footprint degenerado: no hay dónde poner montañas

    const amplitudMax = altura * span;
    // Sobre una malla existente, altura 0 no toca nada; al generar desde
    // cero devolvemos igualmente la rejilla (una superficie plana).
    if (!generando && amplitudMax <= 1e-9) return mesh;

    const caracteristica = span / formaciones; // tamaño en mundo de una "montaña"
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const gamma = 1 + planicie * 3;

    const lado = res + 1;
    const idx = (i: number, j: number) => j * lado + i;

    // 1) Alturas de la rejilla.
    const alturas = new Float64Array(lado * lado);
    let minH = Infinity;
    let maxH = -Infinity;
    for (let j = 0; j < lado; j++) {
      const vz = j / res;
      const z = minZ + vz * spanZ;
      for (let i = 0; i < lado; i++) {
        const vx = i / res;
        const x = minX + vx * spanX;
        const nx = (x - cx) / caracteristica;
        const nz = (z - cz) / caracteristica;
        let f = fractal(nx, nz, semilla, octavas, persistencia, cresta);
        f = Math.pow(Math.max(0, f), gamma); // aplanar valles (más contraste)
        let h = f * amplitudMax;
        if (bordePlano) {
          const m = 0.14; // margen rebajado a cada borde
          const fu = suavizar(Math.min(vx, 1 - vx) / m);
          const fv = suavizar(Math.min(vz, 1 - vz) / m);
          h *= fu * fv;
        }
        alturas[idx(i, j)] = h;
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }
    const rango = maxH - minH;

    // 2) Vértices.
    const vertices: Vertex3D[] = [];
    for (let j = 0; j < lado; j++) {
      const z = minZ + (j / res) * spanZ;
      for (let i = 0; i < lado; i++) {
        const x = minX + (i / res) * spanX;
        vertices.push({ x, y: maxY + alturas[idx(i, j)], z });
      }
    }

    // 3) UVs planares (0..1) por si el objeto conserva alguna textura.
    const uvs: [number, number][] = [];
    for (let j = 0; j < lado; j++) {
      for (let i = 0; i < lado; i++) {
        uvs.push([i / res, 1 - j / res]);
      }
    }

    // 4) Caras (cuadriláteros con normal hacia +Y) y colores.
    const faces: number[][] = [];
    const faceColors: string[] = [];
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = idx(i, j);
        const b = idx(i + 1, j);
        const c = idx(i, j + 1);
        const d = idx(i + 1, j + 1);
        faces.push([a, c, d, b]);
        if (colorear) {
          const hMedia = (alturas[a] + alturas[b] + alturas[c] + alturas[d]) / 4;
          const t = rango > 1e-9 ? (hMedia - minH) / rango : 0.5;
          const dhx = (alturas[b] + alturas[d] - alturas[a] - alturas[c]) / 2;
          const dhz = (alturas[c] + alturas[d] - alturas[a] - alturas[b]) / 2;
          const gx = dhx / Math.max(1e-6, spanX / res);
          const gz = dhz / Math.max(1e-6, spanZ / res);
          const pendiente = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
          faceColors.push(colorDeCara(paleta, t, pendiente, nivelNieve));
        }
      }
    }

    // 5) Base sólida (opcional): faldón lateral y suelo inferior.
    if (grosor > 0) {
      const yFondo = minY - grosor;
      const colorFaldon = colorear ? rgbAHex(paleta.roca) : '';
      // Vértice inferior por cada vértice del borde, reutilizado por los
      // segmentos contiguos (y por las esquinas).
      const fondo = new Map<number, number>();
      const fondoDe = (gi: number): number => {
        const existente = fondo.get(gi);
        if (existente !== undefined) return existente;
        const v = vertices[gi];
        const nuevo = vertices.length;
        vertices.push({ x: v.x, y: yFondo, z: v.z });
        uvs.push([0, 0]);
        fondo.set(gi, nuevo);
        return nuevo;
      };
      const muro = (ai: number, A: number, B: number, bi: number) => {
        // ai/bi = vértices inferiores de A/B (normal hacia fuera).
        faces.push([ai, A, B, bi]);
        if (colorear) faceColors.push(colorFaldon);
      };
      // Borde z = minZ (normal -Z).
      for (let i = 0; i < res; i++) {
        const A = idx(i, 0);
        const B = idx(i + 1, 0);
        muro(fondoDe(A), A, B, fondoDe(B));
      }
      // Borde z = maxZ (normal +Z).
      for (let i = 0; i < res; i++) {
        const A = idx(i, res);
        const B = idx(i + 1, res);
        faces.push([A, fondoDe(A), fondoDe(B), B]);
        if (colorear) faceColors.push(colorFaldon);
      }
      // Borde x = minX (normal -X).
      for (let j = 0; j < res; j++) {
        const A = idx(0, j);
        const B = idx(0, j + 1);
        faces.push([A, fondoDe(A), fondoDe(B), B]);
        if (colorear) faceColors.push(colorFaldon);
      }
      // Borde x = maxX (normal +X).
      for (let j = 0; j < res; j++) {
        const A = idx(res, j);
        const B = idx(res, j + 1);
        muro(fondoDe(A), A, B, fondoDe(B));
      }
      // Suelo inferior (normal -Y).
      const f0 = vertices.length;
      vertices.push({ x: minX, y: yFondo, z: minZ });
      vertices.push({ x: maxX, y: yFondo, z: minZ });
      vertices.push({ x: maxX, y: yFondo, z: maxZ });
      vertices.push({ x: minX, y: yFondo, z: maxZ });
      uvs.push([0, 0], [1, 0], [1, 1], [0, 1]);
      faces.push([f0, f0 + 1, f0 + 2, f0 + 3]);
      if (colorear) faceColors.push(colorFaldon);
    }

    return {
      ...mesh,
      vertices,
      faces,
      uvs,
      faceColors: colorear ? faceColors : undefined,
      // Estas listas van alineadas con las caras antiguas: quedan fuera.
      faceOpacities: undefined,
      faceTextures: undefined,
      // El relieve define su propio aspecto: sin textura de imagen.
      texture: undefined,
      texturePanela: undefined,
      textureOriginal: undefined,
    };
  },
};

export default generarTerreno;
