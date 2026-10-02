import type { Mesh, Vertex3D } from './geometry';

/**
 * Generador de mallas primitivas para el puente ZEIA -> Editor 3D.
 *
 * ZEIA (planner) describe objetos con `primitive: 'cube' | 'sphere' | ...`.
 * El Editor 3D (`components/viewer-3d.tsx`) consume mallas en el formato
 * `Mesh` de `lib/geometry.ts` (`vertices` + `faces`). Este módulo traduce
 * ese vocabulario de primitivas a mallas reales, sin dependencias externas
 * (no usa three.js: son construcciones puras y testeables en Node).
 */

export type ZeiaPrimitiveName =
  | 'cube'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'plane'
  | 'pyramid'
  | 'tetrahedron';

const v = (x: number, y: number, z: number): Vertex3D => ({ x, y, z });

/** Normaliza el nombre de primitiva que puede venir del modelo o del heurístico. */
export function normalizePrimitiveName(name: unknown): ZeiaPrimitiveName | null {
  if (typeof name !== 'string') return null;
  const n = name.trim().toLowerCase();
  switch (n) {
    case 'cube':
    case 'box':
    case 'caja':
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
    default:
      return null;
  }
}

/** ¿La primitiva debe renderizarse con sombreado suave (normales interpoladas)? */
export function primitiveIsSmooth(name: ZeiaPrimitiveName | null): boolean {
  return name === 'sphere' || name === 'cylinder' || name === 'cone' || name === 'torus';
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
    default:
      return null;
  }
}

/** Malla de reserva (cubo) cuando la primitiva es desconocida. */
export function fallbackMesh(): Mesh {
  return cube(1);
}
