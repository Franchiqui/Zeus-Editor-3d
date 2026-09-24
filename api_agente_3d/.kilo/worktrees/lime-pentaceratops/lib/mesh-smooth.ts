import type { Mesh, Vertex3D } from './geometry';

type P3 = [number, number, number];

const posKey = (p: P3) =>
  `${p[0].toFixed(4)}|${p[1].toFixed(4)}|${p[2].toFixed(4)}`;

/**
 * Suavizado tipo Taubin sobre una malla de vóxeles: cada vértice se
 * desplaza hacia la media de sus vecinos (paso λ) y luego un paso μ
 * negativo re-expande la figura. El resultado redondea las aristas y
 * elimina el aspecto de "cuadraditos"/escalones en las curvas sin
 * encoger la silueta.
 *
 * Solo cambia las POSICIONES de los vértices: caras y colores se
 * conservan intactos, así que la malla original queda intacta tal cual y
 * esta copia se puede usar solo para renderizar (p.ej. la captura PNG).
 */
export function smoothVoxelMesh(mesh: Mesh, iterations = 2): Mesh {
  const n = mesh.vertices.length;
  if (n === 0 || mesh.faces.length === 0) return { vertices: [], faces: [] };

  // 1. Suelda vértices por posición: el greedy meshing comparte índices
  //    para esquinas coincidentes, pero sus "vértices-T" (esquinas de
  //    rectángulos fusionados que caen en mitad de la arista de otro
  //    rectángulo) solo coinciden en posición, no en índice.
  const weldId = new Int32Array(n);
  const positions: P3[] = [];
  const weldMap = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const v = mesh.vertices[i];
    const p: P3 = [v.x, v.y, v.z];
    const k = posKey(p);
    let id = weldMap.get(k);
    if (id === undefined) {
      id = positions.length;
      positions.push(p);
      weldMap.set(k, id);
    }
    weldId[i] = id;
  }
  const m = positions.length;

  // 2. Adyacencia a partir de las aristas de cada cara
  const neighbors: number[][] = Array.from({ length: m }, () => []);
  const addLink = (a: number, b: number) => {
    if (a === b) return;
    if (!neighbors[a].includes(b)) {
      neighbors[a].push(b);
      neighbors[b].push(a);
    }
  };
  for (const face of mesh.faces) {
    const len = face.length;
    for (let i = 0; i < len; i++) {
      addLink(weldId[face[i]], weldId[face[(i + 1) % len]]);
    }
  }

  // 3. Iteraciones Taubin (λ positivo suaviza, μ negativo re-expande)
  const step = (pos: P3[], factor: number): P3[] => {
    const out: P3[] = new Array(m);
    for (let i = 0; i < m; i++) {
      const nb = neighbors[i];
      if (nb.length === 0) {
        out[i] = pos[i];
        continue;
      }
      let ax = 0;
      let ay = 0;
      let az = 0;
      for (const j of nb) {
        ax += pos[j][0];
        ay += pos[j][1];
        az += pos[j][2];
      }
      ax /= nb.length;
      ay /= nb.length;
      az /= nb.length;
      const p = pos[i];
      out[i] = [
        p[0] + factor * (ax - p[0]),
        p[1] + factor * (ay - p[1]),
        p[2] + factor * (az - p[2]),
      ];
    }
    return out;
  };

  const LAMBDA = 0.5;
  const MU = -0.53;
  let pos = positions;
  for (let it = 0; it < iterations; it++) {
    pos = step(step(pos, LAMBDA), MU);
  }

  // 4. Corrección de vértices-T: un vértice que originalmente caía en
  //    mitad de la arista de una cara fusionada debe seguir PEGADO a
  //    esa arista tras el suavizado, o aparecerían grietas. Se proyecta
  //    sobre la arista suavizada en su posición paramétrica original.
  //
  //    Índice por línea alineada con los ejes para localizarlos rápido:
  //    en una malla de vóxeles toda arista es paralela a un eje.
  const lineMaps: Map<string, number[]>[] = [
    new Map(),
    new Map(),
    new Map(),
  ];
  for (let i = 0; i < m; i++) {
    const p = positions[i];
    for (let axis = 0; axis < 3; axis++) {
      const a = (axis + 1) % 3;
      const b = (axis + 2) % 3;
      const lk = `${p[a].toFixed(4)}|${p[b].toFixed(4)}`;
      let arr = lineMaps[axis].get(lk);
      if (!arr) {
        arr = [];
        lineMaps[axis].set(lk, arr);
      }
      arr.push(i);
    }
  }

  const constraints: { a: number; b: number; t: number }[][] =
    Array.from({ length: m }, () => []);
  for (const face of mesh.faces) {
    const len = face.length;
    for (let e = 0; e < len; e++) {
      const a0 = weldId[face[e]];
      const b0 = weldId[face[(e + 1) % len]];
      if (a0 === b0) continue;
      const pa = positions[a0];
      const pb = positions[b0];
      // Eje de la arista (-1 = degenerada, -2 = diagonal: se ignora)
      let axis = -1;
      for (let d = 0; d < 3; d++) {
        if (Math.abs(pa[d] - pb[d]) > 1e-6) {
          if (axis !== -1) {
            axis = -2;
            break;
          }
          axis = d;
        }
      }
      if (axis < 0) continue;
      const a1 = (axis + 1) % 3;
      const a2 = (axis + 2) % 3;
      const lk = `${pa[a1].toFixed(4)}|${pa[a2].toFixed(4)}`;
      const line = lineMaps[axis].get(lk);
      if (!line) continue;
      for (const c of line) {
        if (c === a0 || c === b0) continue;
        const t =
          (positions[c][axis] - pa[axis]) / (pb[axis] - pa[axis]);
        if (t > 1e-6 && t < 1 - 1e-6) {
          constraints[c].push({ a: a0, b: b0, t });
        }
      }
    }
  }

  const finalPos: P3[] = pos.map((p, i) => {
    const cs = constraints[i];
    if (cs.length === 0) return p;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const c of cs) {
      const pa = pos[c.a];
      const pb = pos[c.b];
      x += pa[0] + c.t * (pb[0] - pa[0]);
      y += pa[1] + c.t * (pb[1] - pa[1]);
      z += pa[2] + c.t * (pb[2] - pa[2]);
    }
    return [x / cs.length, y / cs.length, z / cs.length];
  });

  // 5. Malla de salida: mismos índices y caras, posiciones suavizadas
  const vertices: Vertex3D[] = mesh.vertices.map((_, i) => {
    const p = finalPos[weldId[i]];
    return { x: p[0], y: p[1], z: p[2] };
  });
  return { vertices, faces: mesh.faces, faceColors: mesh.faceColors };
}