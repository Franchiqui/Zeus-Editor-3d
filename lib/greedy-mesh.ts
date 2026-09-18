import type { Mesh, Vertex3D } from './geometry';

/**
 * Rectángulo fusionado sobre una máscara 2D de caras: cubre ru×rv
 * celdas a partir de la celda (u, v).
 */
type GreedyRect = { u: number; v: number; ru: number; rv: number };

/**
 * Greedy meshing 2D: fusiona en rectángulos maximales todas las celdas
 * contiguas de la máscara que comparten el mismo color. Las celdas con
 * valor null no contienen cara y actúan de separador (no se fusionan).
 */
function mergeGreedyMask(
  mask: (string | null)[][],
  nu: number,
  nv: number
): GreedyRect[] {
  const used: boolean[][] = Array.from({ length: nu }, () =>
    Array(nv).fill(false)
  );
  const rects: GreedyRect[] = [];

  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      if (used[u][v] || mask[u][v] === null) continue;
      const key = mask[u][v];

      // Crece a lo largo de u mientras la fila actual coincida
      let ru = 1;
      while (u + ru < nu && !used[u + ru][v] && mask[u + ru][v] === key) {
        ru++;
      }

      // Crece a lo largo de v mientras TODA la franja coincida
      let rv = 1;
      let grow = true;
      while (grow && v + rv < nv) {
        for (let i = 0; i < ru; i++) {
          if (used[u + i][v + rv] || mask[u + i][v + rv] !== key) {
            grow = false;
            break;
          }
        }
        if (grow) rv++;
      }

      // Marca las celdas del rectángulo como consumidas
      for (let i = 0; i < ru; i++) {
        for (let j = 0; j < rv; j++) used[u + i][v + j] = true;
      }
      rects.push({ u, v, ru, rv });
    }
  }

  return rects;
}

/**
 * Igual que voxelsToBoxMesh3D, pero con GREEDY MESHING: las caras
 * coplanares contiguas (y del mismo color) se fusionan en rectángulos
 * grandes. La figura sigue siendo sólida, pero las caras planas no
 * tienen divisiones internas: no se generan vértices ni aristas en el
 * interior de cada cara. Reduce vértices y caras en un orden de
 * magnitud respecto a la malla por vóxel, con idéntico aspecto.
 *
 * Solo se fusionan caras del mismo color, así que las fuentes de color
 * (emojis, color fonts) conservan su apariencia exacta.
 */
export function voxelsToGreedyMesh3D(
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

  const colorAt = (x: number, y: number, z: number): string =>
    voxelColors ? voxelColors[x][y][z] ?? '' : '';

  const addQuad = (
    a: number,
    b: number,
    c: number,
    d: number,
    color: string
  ) => {
    faces.push([a, b, c, d]);
    faceColors.push(color === '' ? null : color);
  };

  const newMask = (nu: number, nv: number): (string | null)[][] =>
    Array.from({ length: nu }, () => Array(nv).fill(null));

  // ---- Caras +X y -X (máscara sobre el plano Y·Z: u=y, v=z) ----
  for (let x = 0; x < W; x++) {
    // +X: la cara del vóxel (x,y,z) es visible si (x+1,y,z) está vacío
    let mask = newMask(H, D);
    let any = false;
    for (let y = 0; y < H; y++) {
      for (let z = 0; z < D; z++) {
        if (voxels[x][y][z] && !has(x + 1, y, z)) {
          mask[y][z] = colorAt(x, y, z);
          any = true;
        }
      }
    }
    if (any) {
      const px = x + 1;
      for (const r of mergeGreedyMask(mask, H, D)) {
        addQuad(
          getVertex(px, r.u, r.v),
          getVertex(px, r.u + r.ru, r.v),
          getVertex(px, r.u + r.ru, r.v + r.rv),
          getVertex(px, r.u, r.v + r.rv),
          mask[r.u][r.v] ?? ''
        );
      }
    }

    // -X: visible si (x-1,y,z) está vacío
    mask = newMask(H, D);
    any = false;
    for (let y = 0; y < H; y++) {
      for (let z = 0; z < D; z++) {
        if (voxels[x][y][z] && !has(x - 1, y, z)) {
          mask[y][z] = colorAt(x, y, z);
          any = true;
        }
      }
    }
    if (any) {
      for (const r of mergeGreedyMask(mask, H, D)) {
        addQuad(
          getVertex(x, r.u, r.v),
          getVertex(x, r.u, r.v + r.rv),
          getVertex(x, r.u + r.ru, r.v + r.rv),
          getVertex(x, r.u + r.ru, r.v),
          mask[r.u][r.v] ?? ''
        );
      }
    }
  }

  // ---- Caras +Y y -Y (máscara sobre el plano X·Z: u=x, v=z) ----
  for (let y = 0; y < H; y++) {
    // +Y: visible si (x,y+1,z) está vacío
    let mask = newMask(W, D);
    let any = false;
    for (let x = 0; x < W; x++) {
      for (let z = 0; z < D; z++) {
        if (voxels[x][y][z] && !has(x, y + 1, z)) {
          mask[x][z] = colorAt(x, y, z);
          any = true;
        }
      }
    }
    if (any) {
      const py = y + 1;
      for (const r of mergeGreedyMask(mask, W, D)) {
        addQuad(
          getVertex(r.u, py, r.v),
          getVertex(r.u, py, r.v + r.rv),
          getVertex(r.u + r.ru, py, r.v + r.rv),
          getVertex(r.u + r.ru, py, r.v),
          mask[r.u][r.v] ?? ''
        );
      }
    }

    // -Y: visible si (x,y-1,z) está vacío
    mask = newMask(W, D);
    any = false;
    for (let x = 0; x < W; x++) {
      for (let z = 0; z < D; z++) {
        if (voxels[x][y][z] && !has(x, y - 1, z)) {
          mask[x][z] = colorAt(x, y, z);
          any = true;
        }
      }
    }
    if (any) {
      for (const r of mergeGreedyMask(mask, W, D)) {
        addQuad(
          getVertex(r.u, y, r.v),
          getVertex(r.u + r.ru, y, r.v),
          getVertex(r.u + r.ru, y, r.v + r.rv),
          getVertex(r.u, y, r.v + r.rv),
          mask[r.u][r.v] ?? ''
        );
      }
    }
  }

  // ---- Caras +Z y -Z (máscara sobre el plano X·Y: u=x, v=y) ----
  for (let z = 0; z < D; z++) {
    // +Z: visible si (x,y,z+1) está vacío
    let mask = newMask(W, H);
    let any = false;
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (voxels[x][y][z] && !has(x, y, z + 1)) {
          mask[x][y] = colorAt(x, y, z);
          any = true;
        }
      }
    }
    if (any) {
      const pz = z + 1;
      for (const r of mergeGreedyMask(mask, W, H)) {
        addQuad(
          getVertex(r.u, r.v, pz),
          getVertex(r.u + r.ru, r.v, pz),
          getVertex(r.u + r.ru, r.v + r.rv, pz),
          getVertex(r.u, r.v + r.rv, pz),
          mask[r.u][r.v] ?? ''
        );
      }
    }

    // -Z: visible si (x,y,z-1) está vacío
    mask = newMask(W, H);
    any = false;
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (voxels[x][y][z] && !has(x, y, z - 1)) {
          mask[x][y] = colorAt(x, y, z);
          any = true;
        }
      }
    }
    if (any) {
      for (const r of mergeGreedyMask(mask, W, H)) {
        addQuad(
          getVertex(r.u, r.v, z),
          getVertex(r.u, r.v + r.rv, z),
          getVertex(r.u + r.ru, r.v + r.rv, z),
          getVertex(r.u + r.ru, r.v, z),
          mask[r.u][r.v] ?? ''
        );
      }
    }
  }

  const anyColor = faceColors.some((c) => c !== null);
  return anyColor ? { vertices, faces, faceColors } : { vertices, faces };
}