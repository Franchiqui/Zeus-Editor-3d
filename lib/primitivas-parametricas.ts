import type { Mesh, Vertex3D } from './geometry';

/**
 * Primitivas paramétricas del modal "Objeto 3D" (public/Obj-3D).
 *
 * Los .zeus de la galería no guardan metadatos de parámetros, así que la
 * correspondencia filename → parámetros va escrita aquí (deducidos de la
 * geometría real de cada archivo y verificados en
 * `scripts/verificar-3d/verificar-primitivas-parametricas.mjs`). Al cargar
 * un objeto del modal se le pegan estos parámetros (`primitiveParams` en
 * `SceneObject`) y el panel de la escena permite editarlos y regenerar la
 * malla, conservando transform/material/smooth del objeto.
 *
 * Los builders devuelven mallas con índices COMPARTIDOS y caras quad (el
 * mismo estilo que `lib/zeia-primitives.ts`); el visor las triangula con
 * `meshToTriangles` como ya hace con el resto de mallas del editor.
 * Winding hacia fuera en todos los casos (ver comentario en
 * `sphere()` de zeia-primitives), excepto el Disco, que replica la
 * orientación de la galería (normal hacia −Y).
 */

// ─── Tipos ──────────────────────────────────────────────────────────────

export type PrimitiveKind =
  | 'cubo'
  | 'esfera'
  | 'toroide'
  | 'tubo'
  | 'cono'
  | 'cilindro'
  | 'plano'
  | 'piramide'
  | 'capsula'
  | 'disco';

export type PrimitiveParams =
  | { kind: 'cubo'; ancho: number; alto: number; profundo: number; segX: number; segY: number; segZ: number }
  | { kind: 'esfera'; radio: number; meridianos: number; anillos: number }
  | { kind: 'toroide'; radioAnillo: number; radioTubo: number; segAnillo: number; segTubo: number }
  | {
      kind: 'tubo';
      radioInterno: number;
      radioExterno: number;
      altura: number;
      segRotacion: number;
      segAltura: number;
      segTapa: number;
    }
  | { kind: 'cono'; radio: number; altura: number; segmentos: number; bandas: number }
  | { kind: 'cilindro'; radio: number; altura: number; segmentos: number; bandas: number }
  | { kind: 'plano'; ancho: number; profundo: number; segX: number; segZ: number }
  | { kind: 'piramide'; lado: number; altura: number }
  | {
      kind: 'capsula';
      radio: number;
      altura: number;
      segmentos: number;
      bandasCuerpo: number;
      bandasCasquete: number;
    }
  | { kind: 'disco'; radio: number; radioInterior: number; sectores: number };

/**
 * Parámetros de galería por archivo (base del nombre, sin `.zeus`,
 * en minúsculas). Son los valores que produce la geometría real de cada
 * `.zeus`: regenerar con ellos reproduce el objeto original.
 */
const PARAMETROS_POR_ARCHIVO: Record<string, PrimitiveParams> = {
  cubo: { kind: 'cubo', ancho: 1, alto: 1, profundo: 1, segX: 1, segY: 1, segZ: 1 },
  esfera: { kind: 'esfera', radio: 0.5, meridianos: 26, anillos: 13 },
  toroide: { kind: 'toroide', radioAnillo: 1 / 3, radioTubo: 1 / 6, segAnillo: 32, segTubo: 16 },
  tubo: {
    kind: 'tubo',
    radioInterno: 0.25,
    radioExterno: 0.5,
    altura: 0.5,
    segRotacion: 16,
    segAltura: 4,
    segTapa: 1,
  },
  cono: { kind: 'cono', radio: 0.5, altura: 1, segmentos: 16, bandas: 4 },
  cilindro: { kind: 'cilindro', radio: 0.25, altura: 1, segmentos: 16, bandas: 4 },
  plano: { kind: 'plano', ancho: 1, profundo: 1, segX: 10, segZ: 10 },
  piramide: { kind: 'piramide', lado: 1, altura: 1 },
  capsula: {
    kind: 'capsula',
    radio: 0.25,
    altura: 1,
    segmentos: 16,
    bandasCuerpo: 4,
    bandasCasquete: 4,
  },
  disco: { kind: 'disco', radio: 0.5, radioInterior: 0, sectores: 33 },
};

/** Params de galería para un archivo del modal Objeto 3D (copia editable), o null si no es reconocible. */
export function paramsDeArchivo(fileName: string): PrimitiveParams | null {
  const base = fileName.toLowerCase().replace(/\.zeus$/i, '');
  const p = PARAMETROS_POR_ARCHIVO[base];
  return p ? structuredClone(p) : null;
}

// ─── Helpers ────────────────────────────────────────────────────────────

const v = (x: number, y: number, z: number): Vertex3D => ({ x, y, z });

/** Radio/largo mínimo para evitar mallas degeneradas (igual que el piso de escala del panel). */
const MIN = 0.001;
/** Máximo de segmentos que deja tocar la UI (protege el rendimiento). */
const MAX_SEG = 128;

const num = (n: unknown, fallback: number): number => {
  const x = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(x) ? x : fallback;
};
const entero = (n: unknown, fallback: number, min: number, max: number): number => {
  const x = Math.round(num(n, fallback));
  return Math.max(min, Math.min(max, x));
};
const positivo = (n: unknown, fallback: number): number =>
  Math.max(MIN, num(n, fallback));

/** Sanitiza params de cualquier fuente (proyecto antiguo, JSON del panel). */
export function normalizarParams(p: PrimitiveParams): PrimitiveParams {
  switch (p.kind) {
    case 'cubo':
      return {
        kind: 'cubo',
        ancho: positivo(p.ancho, 1),
        alto: positivo(p.alto, 1),
        profundo: positivo(p.profundo, 1),
        segX: entero(p.segX, 1, 1, MAX_SEG),
        segY: entero(p.segY, 1, 1, MAX_SEG),
        segZ: entero(p.segZ, 1, 1, MAX_SEG),
      };
    case 'esfera':
      return {
        kind: 'esfera',
        radio: positivo(p.radio, 0.5),
        meridianos: entero(p.meridianos, 26, 3, MAX_SEG),
        anillos: entero(p.anillos, 13, 3, MAX_SEG),
      };
    case 'toroide':
      return {
        kind: 'toroide',
        radioAnillo: positivo(p.radioAnillo, 1 / 3),
        radioTubo: Math.min(positivo(p.radioTubo, 1 / 6), positivo(p.radioAnillo, 1 / 3)),
        segAnillo: entero(p.segAnillo, 32, 3, MAX_SEG),
        segTubo: entero(p.segTubo, 16, 3, MAX_SEG),
      };
    case 'tubo': {
      const ro = positivo(p.radioExterno, 0.5);
      return {
        kind: 'tubo',
        radioExterno: ro,
        radioInterno: Math.min(positivo(p.radioInterno, 0.25), ro * 0.999),
        altura: positivo(p.altura, 0.5),
        segRotacion: entero(p.segRotacion, 16, 3, MAX_SEG),
        segAltura: entero(p.segAltura, 4, 1, MAX_SEG),
        segTapa: entero(p.segTapa, 1, 1, MAX_SEG),
      };
    }
    case 'cono':
      return {
        kind: 'cono',
        radio: positivo(p.radio, 0.5),
        altura: positivo(p.altura, 1),
        segmentos: entero(p.segmentos, 16, 3, MAX_SEG),
        bandas: entero(p.bandas, 4, 1, MAX_SEG),
      };
    case 'cilindro':
      return {
        kind: 'cilindro',
        radio: positivo(p.radio, 0.25),
        altura: positivo(p.altura, 1),
        segmentos: entero(p.segmentos, 16, 3, MAX_SEG),
        bandas: entero(p.bandas, 4, 1, MAX_SEG),
      };
    case 'plano':
      return {
        kind: 'plano',
        ancho: positivo(p.ancho, 1),
        profundo: positivo(p.profundo, 1),
        segX: entero(p.segX, 10, 1, MAX_SEG),
        segZ: entero(p.segZ, 10, 1, MAX_SEG),
      };
    case 'piramide':
      return { kind: 'piramide', lado: positivo(p.lado, 1), altura: positivo(p.altura, 1) };
    case 'capsula': {
      const radio = positivo(p.radio, 0.25);
      return {
        kind: 'capsula',
        radio,
        altura: Math.max(positivo(p.altura, 1), radio * 2 + MIN),
        segmentos: entero(p.segmentos, 16, 3, MAX_SEG),
        bandasCuerpo: entero(p.bandasCuerpo, 4, 1, MAX_SEG),
        bandasCasquete: entero(p.bandasCasquete, 4, 1, MAX_SEG),
      };
    }
    case 'disco': {
      const radio = positivo(p.radio, 0.5);
      return {
        kind: 'disco',
        radio,
        radioInterior: Math.max(0, Math.min(num(p.radioInterior, 0), radio * 0.999)),
        sectores: entero(p.sectores, 33, 3, MAX_SEG),
      };
    }
  }
}

// ─── Builders ───────────────────────────────────────────────────────────

/** Grid de quads sobre un plano definido por origen + direcciones u/v cuyo producto cruzado apunta hacia fuera. */
function caraRet(
  vertices: Vertex3D[],
  faces: number[][],
  o: Vertex3D,
  u: Vertex3D,
  dirV: Vertex3D,
  nu: number,
  nv: number
): void {
  const base = vertices.length;
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      vertices.push(
        A(o.x + u.x * i + dirV.x * j, o.y + u.y * i + dirV.y * j, o.z + u.z * i + dirV.z * j)
      );
    }
  }
  const fila = nv + 1;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      faces.push([
        base + i * fila + j,
        base + (i + 1) * fila + j,
        base + (i + 1) * fila + j + 1,
        base + i * fila + j + 1,
      ]);
    }
  }
}

const A = (x: number, y: number, z: number): Vertex3D => ({ x, y, z });

function construirCubo(p: Extract<PrimitiveParams, { kind: 'cubo' }>): Mesh {
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const hx = p.ancho / 2, hy = p.alto / 2, hz = p.profundo / 2;
  // Las 6 caras: origen + vector u (por celda i) + vector v (por celda j)
  // elegidos para que u×v apunte hacia fuera (winding exterior).
  caraRet(vertices, faces, A(-hx, -hy, +hz), A(p.ancho / p.segX, 0, 0), A(0, p.alto / p.segY, 0), p.segX, p.segY); // +Z
  caraRet(vertices, faces, A(+hx, -hy, -hz), A(-p.ancho / p.segX, 0, 0), A(0, p.alto / p.segY, 0), p.segX, p.segY); // -Z
  caraRet(vertices, faces, A(-hx, +hy, -hz), A(0, 0, p.profundo / p.segZ), A(p.ancho / p.segX, 0, 0), p.segZ, p.segX); // +Y
  caraRet(vertices, faces, A(-hx, -hy, -hz), A(p.ancho / p.segX, 0, 0), A(0, 0, p.profundo / p.segZ), p.segX, p.segZ); // -Y
  caraRet(vertices, faces, A(+hx, -hy, -hz), A(0, p.alto / p.segY, 0), A(0, 0, p.profundo / p.segZ), p.segY, p.segZ); // +X
  caraRet(vertices, faces, A(-hx, +hy, -hz), A(0, -p.alto / p.segY, 0), A(0, 0, p.profundo / p.segZ), p.segY, p.segZ); // -X
  return { vertices, faces };
}

/**
 * Esfera de galería: `anillos` bandas de altura (2 abanicos de polo +
 * anillos−2 bandas quads). Con anillos=13 y meridianos=26 reproduce la
 * Esfera.zeus (624 triángulos tras triangulación).
 */
function construirEsfera(p: Extract<PrimitiveParams, { kind: 'esfera' }>): Mesh {
  const M = p.meridianos;
  const A_ = p.anillos;
  const vertices: Vertex3D[] = [v(0, p.radio, 0)]; // polo +Y
  const anillosY: number[][] = []; // índices por anillo (de arriba a abajo)
  for (let k = 1; k < A_; k++) {
    const phi = (k / A_) * Math.PI;
    const r = Math.sin(phi) * p.radio;
    const y = Math.cos(phi) * p.radio;
    anillosY.push(Array.from({ length: M }, (_, j) => {
      const th = (j / M) * Math.PI * 2;
      return vertices.push(v(Math.cos(th) * r, y, Math.sin(th) * r)) - 1;
    }));
  }
  const polo_abajo = vertices.push(v(0, -p.radio, 0)) - 1;
  const faces: number[][] = [];
  // Abanico del polo superior ([ápice, siguiente, actual], como cone() de zeia).
  const sup = anillosY[0];
  for (let j = 0; j < M; j++) faces.push([0, sup[(j + 1) % M], sup[j]]);
  // Bandas quads entre anillos consecutivos (filas de arriba hacia abajo:
  // [a, a+1, b+1, b] con el patrón de sphere() de zeia-primitives).
  for (let k = 0; k < anillosY.length - 1; k++) {
    const arriba = anillosY[k];
    const abj = anillosY[k + 1];
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M;
      faces.push([arriba[j], arriba[j2], abj[j2], abj[j]]);
    }
  }
  // Abanico del polo inferior ([polo, actual, siguiente], espejo del superior).
  const inf = anillosY[anillosY.length - 1];
  for (let j = 0; j < M; j++) faces.push([polo_abajo, inf[j], inf[(j + 1) % M]]);
  return { vertices, faces };
}

function construirToroide(p: Extract<PrimitiveParams, { kind: 'toroide' }>): Mesh {
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  for (let i = 0; i < p.segAnillo; i++) {
    // Anillo principal en el plano XZ (eje Y), como la galería.
    const u = (i / p.segAnillo) * Math.PI * 2;
    const cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j < p.segTubo; j++) {
      const t = (j / p.segTubo) * Math.PI * 2;
      const r = p.radioAnillo + p.radioTubo * Math.cos(t);
      vertices.push(v(cu * r, p.radioTubo * Math.sin(t), su * r));
    }
  }
  for (let i = 0; i < p.segAnillo; i++) {
    const i2 = (i + 1) % p.segAnillo;
    for (let j = 0; j < p.segTubo; j++) {
      const j2 = (j + 1) % p.segTubo;
      // [a, a+1(tubo), b+1(anillo), b]: winding hacia fuera.
      faces.push([
        i * p.segTubo + j,
        i * p.segTubo + j2,
        i2 * p.segTubo + j2,
        i2 * p.segTubo + j,
      ]);
    }
  }
  return { vertices, faces };
}

/** Anillos a radio fijo; devuelve los índices por anillo (θ creciente). */
function anilloRadial(
  vertices: Vertex3D[],
  y: number,
  radio: number,
  segs: number
): number[] {
  return Array.from({ length: segs }, (_, j) => {
    const th = (j / segs) * Math.PI * 2;
    return vertices.push(v(Math.cos(th) * radio, y, Math.sin(th) * radio)) - 1;
  });
}

/** Pared vertical entre dos anillos (misma θ): normal radial hacia fuera (o hacia dentro si invertir). */
function paredVertical(
  faces: number[][],
  superior: number[],
  inferior: number[],
  invertir = false
): void {
  const n = superior.length;
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n;
    const cara = invertir
      ? [superior[j2], superior[j], inferior[j], inferior[j2]]
      : [superior[j], superior[j2], inferior[j2], inferior[j]];
    faces.push(cara);
  }
}

function construirTubo(p: Extract<PrimitiveParams, { kind: 'tubo' }>): Mesh {
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const hh = p.altura / 2;
  // Pared externa: filas de arriba hacia abajo.
  const ext: number[][] = [];
  for (let i = 0; i <= p.segAltura; i++) {
    ext.push(anilloRadial(vertices, hh - (i / p.segAltura) * p.altura, p.radioExterno, p.segRotacion));
  }
  for (let i = 0; i < p.segAltura; i++) paredVertical(faces, ext[i], ext[i + 1]);
  // Pared interna: winding invertido (la normal mira hacia el eje).
  const int: number[][] = [];
  for (let i = 0; i <= p.segAltura; i++) {
    int.push(anilloRadial(vertices, hh - (i / p.segAltura) * p.altura, p.radioInterno, p.segRotacion));
  }
  for (let i = 0; i < p.segAltura; i++) paredVertical(faces, int[i], int[i + 1], true);
  // Tapas anulares (segTapa anillos concéntricos de quads).
  for (const [y, haciaArriba] of [
    [hh, true],
    [-hh, false],
  ] as [number, boolean][]) {
    for (let t = 0; t < p.segTapa; t++) {
      const r0 = p.radioInterno + ((p.radioExterno - p.radioInterno) * t) / p.segTapa;
      const r1 = p.radioInterno + ((p.radioExterno - p.radioInterno) * (t + 1)) / p.segTapa;
      const extT = anilloRadial(vertices, y, r1, p.segRotacion);
      const intT = anilloRadial(vertices, y, r0, p.segRotacion);
      for (let j = 0; j < p.segRotacion; j++) {
        const j2 = (j + 1) % p.segRotacion;
        // [O_j, O_j+1, I_j+1, I_j] mira a −Y; invertido mira a +Y.
        faces.push(
          haciaArriba
            ? [extT[j], intT[j], intT[j2], extT[j2]]
            : [extT[j], extT[j2], intT[j2], intT[j]]
        );
      }
    }
  }
  return { vertices, faces };
}

/**
 * Lateral de cono/cilindro con `bandas` bandas: filas de radio
 * `radios[i]` (de la fila superior a la inferior), en altura `alturas[i]`.
 */
function lateralBandas(
  vertices: Vertex3D[],
  faces: number[][],
  radios: number[],
  alturas: number[],
  segs: number,
  haciaFuera = true
): number[][] {
  const filas: number[][] = [];
  for (let i = 0; i < radios.length; i++) {
    filas.push(anilloRadial(vertices, alturas[i], radios[i], segs));
  }
  for (let i = 0; i < filas.length - 1; i++) {
    paredVertical(faces, filas[i], filas[i + 1], !haciaFuera);
  }
  return filas;
}

/** Abanico desde un centro/ápice: normal +Y si arriba, -Y si abajo. */
function abanicoHorizontal(
  faces: number[][],
  centro: number,
  anillo: number[],
  arriba: boolean
): void {
  const n = anillo.length;
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n;
    faces.push(arriba ? [centro, anillo[j2], anillo[j]] : [centro, anillo[j], anillo[j2]]);
  }
}

function construirCono(p: Extract<PrimitiveParams, { kind: 'cono' }>): Mesh {
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const hh = p.altura / 2;
  const B = p.bandas;
  // B−1 bandas quads; la última banda es el abanico al ápice. La galería
  // (B=4) da 3 bandas quads + abanico. El radio crece del ápice a la base.
  const filas: number[][] = []; // filas[k] = anillo a r = radio·k/B (k=1..B), de arriba a abajo
  for (let k = 1; k <= B; k++) {
    filas.push(anilloRadial(vertices, hh - (k / B) * p.altura, (p.radio * k) / B, p.segmentos));
  }
  for (let k = 0; k < filas.length - 1; k++) {
    // paredVertical espera (superior, inferior): filas[k] está más arriba.
    paredVertical(faces, filas[k], filas[k + 1]);
  }
  // Abanico al ápice (patrón del cone() de zeia-primitives: hacia fuera).
  const apex = vertices.push(v(0, hh, 0)) - 1;
  const primera = filas[0];
  for (let j = 0; j < p.segmentos; j++) {
    const j2 = (j + 1) % p.segmentos;
    faces.push([apex, primera[j2], primera[j]]);
  }
  // Tapa de la base (abanico, normal −Y).
  const centroBase = vertices.push(v(0, -hh, 0)) - 1;
  abanicoHorizontal(faces, centroBase, filas[filas.length - 1], false);
  return { vertices, faces };
}

function construirCilindro(p: Extract<PrimitiveParams, { kind: 'cilindro' }>): Mesh {
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const hh = p.altura / 2;
  const radios: number[] = [];
  const alturas: number[] = [];
  for (let i = 0; i <= p.bandas; i++) {
    radios.push(p.radio);
    alturas.push(hh - (i / p.bandas) * p.altura);
  }
  const filas = lateralBandas(vertices, faces, radios, alturas, p.segmentos);
  const centroSup = vertices.push(v(0, hh, 0)) - 1;
  abanicoHorizontal(faces, centroSup, filas[0], true);
  const centroInf = vertices.push(v(0, -hh, 0)) - 1;
  abanicoHorizontal(faces, centroInf, filas[filas.length - 1], false);
  return { vertices, faces };
}

function construirPlano(p: Extract<PrimitiveParams, { kind: 'plano' }>): Mesh {
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  // Plano HORIZONTAL en y=0 (como la galería): u=+Z, v=+X → normal +Y
  // (la orientación que trae el .zeus real).
  caraRet(
    vertices,
    faces,
    A(-p.ancho / 2, 0, -p.profundo / 2),
    A(0, 0, p.profundo / p.segZ),
    A(p.ancho / p.segX, 0, 0),
    p.segZ,
    p.segX
  );
  return { vertices, faces };
}

/** Pirámide de galería: base cuadrada + ápice (4 caras laterales, base quad). */
function construirPiramide(p: Extract<PrimitiveParams, { kind: 'piramide' }>): Mesh {
  const b = p.lado / 2;
  const hh = p.altura / 2;
  const vertices: Vertex3D[] = [
    v(-b, -hh, -b),
    v(b, -hh, -b),
    v(b, -hh, b),
    v(-b, -hh, b),
    v(0, hh, 0),
  ];
  // Winding hacia fuera (patrón pyramid() de zeia-primitives).
  const faces: number[][] = [
    [0, 4, 1],
    [1, 4, 2],
    [2, 4, 3],
    [3, 4, 0],
    [0, 1, 2, 3],
  ];
  return { vertices, faces };
}

function construirCapsula(p: Extract<PrimitiveParams, { kind: 'capsula' }>): Mesh {
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const hh = p.altura / 2;
  const M = p.segmentos;
  const B = p.bandasCasquete;
  // Filas de ABAJO hacia ARRIBA: polo inferior abanico → hemisferio → cuerpo → hemisferio → polo superior.
  const filas: { indices: number[] }[] = []; // {indices, radio}
  const poloInf = vertices.push(v(0, -hh, 0)) - 1;
  // Hemisferio inferior: anillos a φ = k·(π/2)/B, medidos desde el polo
  // (y ascendente: el primero pegado al polo inferior).
  for (let k = 1; k < B; k++) {
    const phi = (k / (2 * B)) * Math.PI;
    const r = Math.sin(phi) * p.radio;
    filas.push({
      indices: anilloRadial(vertices, -hh + p.radio * (1 - Math.cos(phi)), r, M),
    });
  }
  // Cuerpo: bandasCuerpo+1 filas entre ±(hh − radio).
  const yCuerpo = hh - p.radio;
  for (let k = 0; k <= p.bandasCuerpo; k++) {
    filas.push({
      indices: anilloRadial(vertices, -yCuerpo + ((2 * yCuerpo) / p.bandasCuerpo) * k, p.radio, M),
    });
  }
  // Hemisferio superior en espejo (y ascendente → k descendente).
  for (let k = B - 1; k >= 1; k--) {
    const phi = (k / (2 * B)) * Math.PI;
    const r = Math.sin(phi) * p.radio;
    filas.push({
      indices: anilloRadial(vertices, hh - p.radio * (1 - Math.cos(phi)), r, M),
    });
  }
  const poloSup = vertices.push(v(0, hh, 0)) - 1;
  // Bandas quads entre filas consecutivas: filas de abajo a arriba →
  // [a(abajo,θ), b(arriba,θ), b+1, a+1] normal hacia fuera.
  for (let i = 0; i < filas.length - 1; i++) {
    const a = filas[i].indices;
    const b = filas[i + 1].indices;
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M;
      faces.push([a[j], b[j], b[j2], a[j2]]);
    }
  }
  // Abanicos de polo.
  const primera = filas[0].indices;
  for (let j = 0; j < M; j++) faces.push([poloInf, primera[j], primera[(j + 1) % M]]);
  const ultima = filas[filas.length - 1].indices;
  for (let j = 0; j < M; j++) faces.push([poloSup, ultima[(j + 1) % M], ultima[j]]);
  return { vertices, faces };
}

/**
 * Disco de galería (plano y=0): abanico de `sectores` triángulos con la
 * orientación original (normal −Y). Con radioInterior > 0 se genera la
 * argolla: anillo de quads entre radioInterior y radio.
 */
function construirDisco(p: Extract<PrimitiveParams, { kind: 'disco' }>): Mesh {
  const N = p.sectores;
  if (p.radioInterior <= 0) {
    const vertices: Vertex3D[] = [v(0, 0, 0)];
    const faces: number[][] = [];
    const exteriores = anilloRadial(vertices, 0, p.radio, N);
    // Reproduce el orden de la galería: cara i = [extA(θ−(i+1)Δ), centro, extB(θ−iΔ)],
    // que deja la normal hacia −Y.
    for (let i = 0; i < N; i++) {
      faces.push([exteriores[(N - i - 1 + N) % N], 0, exteriores[(N - i + N) % N]]);
    }
    return { vertices, faces };
  }
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const fuera = anilloRadial(vertices, 0, p.radio, N);
  const dentro = anilloRadial(vertices, 0, p.radioInterior, N);
  for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    // [O_j, O_j+1, I_j+1, I_j] mira a −Y (igual que el abanico).
    faces.push([fuera[j], fuera[j2], dentro[j2], dentro[j]]);
  }
  return { vertices, faces };
}

// ─── Dispatch ───────────────────────────────────────────────────────────

/** Construye la malla de la primitiva (params sanitizados, geometría exacta). */
export function construirMallaPrimitiva(params: PrimitiveParams): Mesh {
  const p = normalizarParams(params);
  switch (p.kind) {
    case 'cubo':
      return construirCubo(p);
    case 'esfera':
      return construirEsfera(p);
    case 'toroide':
      return construirToroide(p);
    case 'tubo':
      return construirTubo(p);
    case 'cono':
      return construirCono(p);
    case 'cilindro':
      return construirCilindro(p);
    case 'plano':
      return construirPlano(p);
    case 'piramide':
      return construirPiramide(p);
    case 'capsula':
      return construirCapsula(p);
    case 'disco':
      return construirDisco(p);
  }
}