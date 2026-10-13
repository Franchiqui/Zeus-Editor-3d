import type { Mesh, Vertex3D } from './geometry';
import type { PrimitiveParams } from './primitivas-parametricas';
import { construirMallaPrimitiva } from './primitivas-parametricas';

/**
 * Generador de mallas primitivas para el puente ZEIA -> Editor 3D.
 *
 * ZEIA (planner) describe objetos con `primitive: 'cube' | 'sphere' | ...`.
 * El Editor 3D (`components/viewer-3d.tsx`) consume mallas en el formato
 * `Mesh` de `lib/geometry.ts` (`vertices` + `faces`). Este módulo traduce
 * ese vocabulario de primitivas a mallas reales, sin dependencias externas
 * (no usa three.js: son construcciones puras y testeables en Node).
 *
 * Dos caminos:
 * - Los builders artesanales de siempre (cube/sphere/cylinder/...) quedan
 *   intactos y se usan cuando el modelo no da medidas (geometría idéntica
 *   a la histórica, para no mover escenas ya probadas).
 * - Si el modelo SÍ da medidas (radius/height/...), `buildPrimitiveFromParams`
 *   delega en `construirMallaPrimitiva` (primitivas paramétricas del modal
 *   Objeto 3D) y además reconoce formas nuevas: cápsula, tubo, disco/argolla
 *   y muelle.
 */

export type ZeiaPrimitiveName =
  | 'cube'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'plane'
  | 'pyramid'
  | 'tetrahedron'
  | 'capsule'
  | 'tube'
  | 'disc'
  | 'ring'
  | 'spring';

const v = (x: number, y: number, z: number): Vertex3D => ({ x, y, z });

/** Normaliza el nombre de primitiva que puede venir del modelo o del heurístico. */
export function normalizePrimitiveName(name: unknown): ZeiaPrimitiveName | null {
  if (typeof name !== 'string') return null;
  const n = name.trim().toLowerCase();
  switch (n) {
    case 'cube':
    case 'box':
    case 'caja':
    case 'cubo':
      return 'cube';
    case 'sphere':
    case 'esfera':
    case 'bola':
      return 'sphere';
    case 'cylinder':
    case 'cilindro':
      return 'cylinder';
    case 'cone':
    case 'cono':
      return 'cone';
    case 'torus':
    case 'toro':
    case 'donut':
      return 'torus';
    case 'plane':
    case 'plano':
    case 'ground':
    case 'suelo':
      return 'plane';
    case 'pyramid':
    case 'piramide':
    case 'pirámide':
      return 'pyramid';
    case 'tetrahedron':
    case 'tetra':
    case 'tetraedro':
      return 'tetrahedron';
    case 'capsule':
    case 'cápsula':
    case 'capsula':
    case 'pill':
    case 'pastilla':
      return 'capsule';
    case 'tube':
    case 'tubo':
    case 'pipe':
    case 'tuberia':
    case 'tubería':
      return 'tube';
    case 'disc':
    case 'disco':
    case 'plate':
    case 'plato':
    case 'dish':
      return 'disc';
    case 'ring':
    case 'anillo':
    case 'argolla':
    case 'annulus':
    case 'aro':
      return 'ring';
    case 'spring':
    case 'muelle':
    case 'resorte':
    case 'helice':
    case 'hélice':
    case 'spiral':
    case 'coil':
      return 'spring';
    default:
      return null;
  }
}

/** ¿La primitiva debe renderizarse con sombreado suave (normales interpoladas)? */
export function primitiveIsSmooth(name: ZeiaPrimitiveName | null): boolean {
  return (
    name === 'sphere' ||
    name === 'cylinder' ||
    name === 'cone' ||
    name === 'torus' ||
    name === 'capsule' ||
    name === 'tube' ||
    name === 'spring'
  );
}

function cube(half: number): Mesh {
  const vertices: Vertex3D[] = [
    v(-half, -half, -half), // 0
    v(half, -half, -half), // 1
    v(half, half, -half), // 2
    v(-half, half, -half), // 3
    v(-half, -half, half), // 4
    v(half, -half, half), // 5
    v(half, half, half), // 6
    v(-half, half, half), // 7
  ];
  const faces: number[][] = [
    [4, 5, 6, 7], // frente (+Z)
    [1, 0, 3, 2], // atrás (-Z)
    [0, 4, 7, 3], // izquierda (-X)
    [5, 1, 2, 6], // derecha (+X)
    [3, 7, 6, 2], // arriba (+Y)
    [0, 1, 5, 4], // abajo (-Y)
  ];
  return { vertices, faces };
}

function plane(half: number): Mesh {
  const vertices: Vertex3D[] = [
    v(-half, 0, -half),
    v(half, 0, -half),
    v(half, 0, half),
    v(-half, 0, half),
  ];
  const faces: number[][] = [[0, 1, 2, 3]];
  return { vertices, faces };
}

function sphere(radius: number, rings: number = 16, segments: number = 24): Mesh {
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI;
    const y = Math.cos(phi) * radius;
    const r = Math.sin(phi) * radius;
    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      vertices.push(v(Math.cos(theta) * r, y, Math.sin(theta) * r));
    }
  }
  const rowLen = segments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * rowLen + j;
      const b = a + rowLen;
      // Winding hacia FUERA (normal exterior): la regla de la mano derecha
      // con el orden [a, a+1, b+1, b] apunta la normal hacia el exterior de
      // la esfera. El orden previo [a, b, b+1, a+1] las dejaba hacia dentro
      // y el CSG (sustraer/unir) se comportaba invertido con esferas.
      faces.push([a, a + 1, b + 1, b]);
    }
  }
  return { vertices, faces };
}

function cylinder(radius: number, height: number, segments: number = 24): Mesh {
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const hh = height / 2;
  for (let j = 0; j <= segments; j++) {
    const theta = (j / segments) * Math.PI * 2;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    vertices.push(v(x, hh, z)); // tapa superior
    vertices.push(v(x, -hh, z)); // tapa inferior
  }
  for (let j = 0; j < segments; j++) {
    const top = j * 2;
    const bot = top + 1;
    const ntop = (j + 1) * 2;
    const nbot = ntop + 1;
    faces.push([top, ntop, nbot, bot]);
  }
  // Tapas (abanico desde el centro).
  const topCenter = vertices.push(v(0, hh, 0)) - 1;
  const botCenter = vertices.push(v(0, -hh, 0)) - 1;
  for (let j = 0; j < segments; j++) {
    const top = j * 2;
    const ntop = (j + 1) * 2;
    const bot = top + 1;
    const nbot = ntop + 1;
    faces.push([topCenter, ntop, top]);
    faces.push([botCenter, bot, nbot]);
  }
  return { vertices, faces };
}

function cone(radius: number, height: number, segments: number = 24): Mesh {
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const hh = height / 2;
  const apex = vertices.push(v(0, hh, 0)) - 1;
  for (let j = 0; j <= segments; j++) {
    const theta = (j / segments) * Math.PI * 2;
    vertices.push(v(Math.cos(theta) * radius, -hh, Math.sin(theta) * radius));
  }
  for (let j = 0; j < segments; j++) {
    // Winding hacia fuera (ver comentario en sphere)
    faces.push([apex, j + 2, j + 1]);
  }
  const baseCenter = vertices.push(v(0, -hh, 0)) - 1;
  for (let j = 0; j < segments; j++) {
    faces.push([baseCenter, j + 1, j + 2]);
  }
  return { vertices, faces };
}

function torus(major: number, minor: number, radialSeg: number = 24, tubularSeg: number = 12): Mesh {
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  for (let i = 0; i <= radialSeg; i++) {
    const u = (i / radialSeg) * Math.PI * 2;
    for (let j = 0; j <= tubularSeg; j++) {
      const vv = (j / tubularSeg) * Math.PI * 2;
      const x = (major + minor * Math.cos(vv)) * Math.cos(u);
      const y = minor * Math.sin(vv);
      const z = (major + minor * Math.cos(vv)) * Math.sin(u);
      vertices.push({ x, y, z });
    }
  }
  const rowLen = tubularSeg + 1;
  for (let i = 0; i < radialSeg; i++) {
    for (let j = 0; j < tubularSeg; j++) {
      const a = i * rowLen + j;
      const b = a + rowLen;
      // Winding hacia fuera (ver comentario en sphere)
      faces.push([a, a + 1, b + 1, b]);
    }
  }
  return { vertices, faces };
}

function pyramid(baseHalf: number, height: number): Mesh {
  const hh = height / 2;
  const vertices: Vertex3D[] = [
    v(-baseHalf, -hh, -baseHalf),
    v(baseHalf, -hh, -baseHalf),
    v(baseHalf, -hh, baseHalf),
    v(-baseHalf, -hh, baseHalf),
    v(0, hh, 0), // ápice
  ];
  // Caras laterales y base con winding hacia fuera (ver comentario en sphere)
  const faces: number[][] = [
    [0, 4, 1],
    [1, 4, 2],
    [2, 4, 3],
    [3, 4, 0],
    [0, 1, 2, 3],
  ];
  return { vertices, faces };
}

function tetrahedron(): Mesh {
  const vertices: Vertex3D[] = [v(1, 1, 1), v(-1, -1, 1), v(-1, 1, -1), v(1, -1, -1)];
  const faces: number[][] = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ];
  return { vertices, faces };
}

/** Resultado de construir una primitiva con medidas: malla + params usados. */
export type PrimitiveBuild = { mesh: Mesh; params: PrimitiveParams };

/**
 * Construye la malla de una primitiva honrando las MEDIDAS que trae el
 * modelo (`dims`, claves canónicas: radio, altura, ancho, alto, profundo,
 * size, grosor, radioInterno, radioExterno, segmentos, sectores, vueltas,
 * separacion) y devuelve TAMBIÉN los `PrimitiveParams` usados, para que el
 * objeto creado lleve el panel de propiedades de primitiva del editor.
 * Sin medidas devuelve `null` para que el llamador use los
 * builders artesanales (geometría bit-idéntica a la histórica).
 *
 * Las medidas delegan en `construirMallaPrimitiva` (las primitivas
 * paramétricas del modal "Objeto 3D"), de modo que un "cilindro de radio
 * 0.5 y altura 3" sale con esas medidas reales y no con las fijas de acá.
 */
export function buildPrimitiveFromParams(name: unknown, dims?: Record<string, number> | null): PrimitiveBuild | null {
  const p = normalizePrimitiveName(name);
  if (!p) return null;
  const d = dims && Object.keys(dims).length > 0 ? dims : null;
  if (!d) return null;
  const radio = d.radio;
  const altura = d.altura;
  const size = d.size;
  const porRadio = radio !== undefined ? radio * 2 : undefined;
  const segmentos = d.segmentos;

  switch (p) {
    case 'cube': {
      const w = d.ancho ?? porRadio ?? size;
      const h = d.alto ?? altura ?? w ?? porRadio ?? size;
      const dep = d.profundo ?? porRadio ?? size ?? w;
      if (w === undefined && h === undefined && dep === undefined) return null;
      const params: PrimitiveParams = { kind: 'cubo', ancho: w ?? 2, alto: h ?? 2, profundo: dep ?? 2, segX: 1, segY: 1, segZ: 1 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case 'sphere': {
      const r = radio ?? size;
      if (r === undefined) return null;
      const params: PrimitiveParams = {
        kind: 'esfera',
        radio: r,
        meridianos: segmentos ?? 24,
        anillos: Math.max(3, Math.round((segmentos ?? 24) * (2 / 3))),
      };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case 'cylinder': {
      if (radio === undefined && size === undefined && altura === undefined) return null;
      const params: PrimitiveParams = { kind: 'cilindro', radio: radio ?? size ?? 1, altura: altura ?? 2, segmentos: segmentos ?? 24, bandas: 4 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case 'cone': {
      if (radio === undefined && size === undefined && altura === undefined) return null;
      const params: PrimitiveParams = { kind: 'cono', radio: radio ?? size ?? 1, altura: altura ?? 2, segmentos: segmentos ?? 24, bandas: 4 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case 'torus': {
      const anillo = radio ?? size;
      if (anillo === undefined && d.grosor === undefined) return null;
      const params: PrimitiveParams = { kind: 'toroide', radioAnillo: anillo ?? 1, radioTubo: d.grosor ?? 0.35, segAnillo: segmentos ?? 24, segTubo: 12 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case 'plane': {
      const w = d.ancho ?? porRadio ?? size;
      const dep = d.profundo ?? size ?? w;
      if (w === undefined && dep === undefined) return null;
      const params: PrimitiveParams = { kind: 'plano', ancho: w ?? 2, profundo: dep ?? w ?? 2, segX: 1, segZ: 1 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case 'pyramid': {
      const lado = d.ancho ?? porRadio ?? size;
      const alt = altura ?? size;
      if (lado === undefined && alt === undefined) return null;
      const params: PrimitiveParams = { kind: 'piramide', lado: lado ?? 2, altura: alt ?? 2 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case 'capsule': {
      if (radio === undefined && size === undefined && altura === undefined) return null;
      const params: PrimitiveParams = {
        kind: 'capsula',
        radio: radio ?? size ?? 1,
        altura: altura ?? 2,
        segmentos: segmentos ?? 24,
        bandasCuerpo: 4,
        bandasCasquete: 4,
      };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case 'tube': {
      const ro = d.radioExterno ?? radio ?? size ?? 1;
      if (d.radioExterno === undefined && radio === undefined && size === undefined && d.radioInterno === undefined && d.grosor === undefined) return null;
      const params: PrimitiveParams = {
        kind: 'tubo',
        radioExterno: ro,
        radioInterno: d.radioInterno ?? (d.grosor !== undefined ? ro - d.grosor : undefined) ?? ro * 0.5,
        altura: altura ?? 2,
        segRotacion: segmentos ?? 24,
        segAltura: 4,
        segTapa: 1,
      };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case 'disc': {
      if (radio === undefined && size === undefined && d.radioInterno === undefined) return null;
      const params: PrimitiveParams = { kind: 'disco', radio: radio ?? size ?? 1, radioInterior: d.radioInterno ?? 0, sectores: d.sectores ?? segmentos ?? 33 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case 'ring': {
      if (radio === undefined && size === undefined && d.radioInterno === undefined) return null;
      const r = radio ?? size ?? 1;
      const params: PrimitiveParams = { kind: 'disco', radio: r, radioInterior: d.radioInterno ?? r * 0.8, sectores: d.sectores ?? segmentos ?? 33 };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    case 'spring': {
      if (radio === undefined && size === undefined && d.grosor === undefined && d.vueltas === undefined) return null;
      const params: PrimitiveParams = {
        kind: 'muelle',
        vueltas: d.vueltas ?? 6,
        verticesPorVuelta: segmentos ?? 16,
        separacion: d.separacion ?? 0.4,
        radioMuelle: radio ?? size ?? 0.5,
        radioTubo: d.grosor ?? 0.12,
      };
      return { mesh: construirMallaPrimitiva(params), params };
    }
    default:
      // tetrahedron (y cualquier otro) no usa medidas: builder artesanal.
      return null;
  }
}

/**
 * `PrimitiveParams` estimados para las primitivas sin medidas (builders
 * artesanales de arriba): permite que el panel de propiedades del editor
 * aparezca también para objetos creados sin medidas. La malla ya en la
 * escena queda intacta; solo si el usuario edita un valor se regenera con
 * la versión paramétrica (mismas dimensiones, teselación ligera distinta).
 * Devuelve `null` para las formas sin equivalente (tetrahedron).
 */
export function legacyPrimitiveParams(name: unknown): PrimitiveParams | null {
  switch (normalizePrimitiveName(name)) {
    case 'cube':
      return { kind: 'cubo', ancho: 2, alto: 2, profundo: 2, segX: 1, segY: 1, segZ: 1 };
    case 'sphere':
      return { kind: 'esfera', radio: 1, meridianos: 24, anillos: 16 };
    case 'cylinder':
      return { kind: 'cilindro', radio: 1, altura: 2, segmentos: 24, bandas: 1 };
    case 'cone':
      return { kind: 'cono', radio: 1, altura: 2, segmentos: 24, bandas: 1 };
    case 'torus':
      return { kind: 'toroide', radioAnillo: 1, radioTubo: 0.35, segAnillo: 24, segTubo: 12 };
    case 'plane':
      return { kind: 'plano', ancho: 2, profundo: 2, segX: 1, segZ: 1 };
    case 'pyramid':
      return { kind: 'piramide', lado: 2, altura: 2 };
    case 'ring':
      return { kind: 'disco', radio: 1, radioInterior: 0.8, sectores: 33 };
    default:
      return null;
  }
}

/**
 * Construye la malla de una primitiva ZEIA. Tamaño base ~2 unidades
 * (de -1 a 1) para que sea visible con la transformada por defecto
 * (`scale = [1,1,1]`). Devuelve `null` si la primitiva no es reconocida.
 */
export function buildPrimitiveMesh(name: unknown): Mesh | null {
  const p = normalizePrimitiveName(name);
  switch (p) {
    case 'cube':
      return cube(1);
    case 'plane':
      return plane(1);
    case 'sphere':
      return sphere(1);
    case 'cylinder':
      return cylinder(1, 2);
    case 'cone':
      return cone(1, 2);
    case 'torus':
      return torus(1, 0.35);
    case 'pyramid':
      return pyramid(1, 2);
    case 'tetrahedron':
      return tetrahedron();
    case 'ring':
      // Argolla: disco plano con hueco (radio interior 0.8 del radio).
      return construirMallaPrimitiva({ kind: 'disco', radio: 1, radioInterior: 0.8, sectores: 33 });
    default:
      // disc/capsule/tube/spring sin medidas: el llamador pasa por
      // buildPrimitiveFromParams; aquí null (caerán al cubo de reserva,
      // igual que cualquier primitiva sin malla).
      return null;
  }
}

/** Malla de reserva (cubo) cuando la primitiva es desconocida. */
export function fallbackMesh(): Mesh {
  return cube(1);
}
