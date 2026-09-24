import type { Mesh, ObjectTransform, Vertex3D } from '@/lib/geometry';
import * as THREE from 'three';

/**
 * Exportadores del objeto 3D a formatos de archivo comunes. Todos reciben
 * la malla YA triangulada (meshToTriangles): caras de 3 índices.
 */

/** Descarga un Blob como archivo con un ancla invisible. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Triángulo válido: caras de 3 índices con los vértices dentro de rango. */
type Tri = { tri: [number, number, number]; faceIdx: number };

function validTriangles(mesh: Mesh): Tri[] {
  const out: Tri[] = [];
  mesh.faces.forEach((face, faceIdx) => {
    if (face.length < 3) return;
    if (
      !mesh.vertices[face[0]] ||
      !mesh.vertices[face[1]] ||
      !mesh.vertices[face[2]]
    )
      return;
    out.push({ tri: [face[0], face[1], face[2]], faceIdx });
  });
  return out;
}

/** Color hex '#rrggbb' → [r, g, b] en 0..1 */
function hexToRgb01(hex: string | null | undefined): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return [0.61, 0.64, 0.69];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const f = (n: number) => n.toFixed(6);

/** ¿La malla trae colores de verdad asociados a sus caras? */
function hasFaceColors(mesh: Mesh): mesh is Mesh & {
  faceColors: (string | null)[];
} {
  return !!mesh.faceColors && mesh.faceColors.length > 0;
}

/** STL ASCII: igual que siempre exportaba el botón STL del editor. */
export function exportSTL(mesh: Mesh, baseName: string) {  let stl = '';
  for (const { tri } of validTriangles(mesh)) {
    const v0 = mesh.vertices[tri[0]]!;
    const v1 = mesh.vertices[tri[1]]!;
    const v2 = mesh.vertices[tri[2]]!;
    const e1x = v1.x - v0.x;
    const e1y = v1.y - v0.y;
    const e1z = v1.z - v0.z;
    const e2x = v2.x - v0.x;
    const e2y = v2.y - v0.y;
    const e2z = v2.z - v0.z;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    stl += `facet normal ${f(nx / len)} ${f(ny / len)} ${f(nz / len)}\n  outer loop\n`;
    stl += `    vertex ${f(v0.x)} ${f(v0.y)} ${f(v0.z)}\n`;
    stl += `    vertex ${f(v1.x)} ${f(v1.y)} ${f(v1.z)}\n`;
    stl += `    vertex ${f(v2.x)} ${f(v2.y)} ${f(v2.z)}\n`;
    stl += `  endloop\nendfacet\n`;
  }
  downloadBlob(
    new Blob([`solid ${baseName}\n${stl}endsolid ${baseName}\n`], {
      type: 'model/stl',
    }),
    `${baseName}.stl`
  );
}

/**
 * OBJ de Wavefront. Si la figura tiene colores, se descarga también un
 * .mtl compañero con un material por color (el OBJ lo referencia).
 */
export function exportOBJ(mesh: Mesh, baseName: string) {
  const tris = validTriangles(mesh);
  const lines: string[] = ['# Zeus Media Studio 3D', `o ${baseName}`];
  for (const v of mesh.vertices) {
    lines.push(`v ${f(v.x)} ${f(v.y)} ${f(v.z)}`);
  }
  if (hasFaceColors(mesh)) {
    // Un material por color distinto; las caras sin color van a gris neutro
    const colorKeys: string[] = [];
    const mtlOf = new Map<number, number>();
    for (const { faceIdx } of tris) {
      const hex = mesh.faceColors![faceIdx] ?? '#9ca3af';
      let idx = colorKeys.indexOf(hex);
      if (idx === -1) {
        colorKeys.push(hex);
        idx = colorKeys.length - 1;
      }
      mtlOf.set(faceIdx, idx);
    }
    lines.push(`mtllib ${baseName}.mtl`);
    let current = -1;
    for (const { tri, faceIdx } of tris) {
      const mtl = mtlOf.get(faceIdx)!;
      if (mtl !== current) {
        current = mtl;
        lines.push(`usemtl c${mtl}`);
      }
      lines.push(`f ${tri[0] + 1} ${tri[1] + 1} ${tri[2] + 1}`);
    }
    const mtl =
      '# Zeus Media Studio 3D\n' +
      colorKeys
        .map((hex, i) => {
          const [r, g, b] = hexToRgb01(hex);
          return `newmtl c${i}\nKd ${f(r)} ${f(g)} ${f(b)}`;
        })
        .join('\n') +
      '\n';
    downloadBlob(
      new Blob([mtl], { type: 'text/plain' }),
      `${baseName}.mtl`
    );
  } else {
    for (const { tri } of tris) {
      lines.push(`f ${tri[0] + 1} ${tri[1] + 1} ${tri[2] + 1}`);
    }
  }
  downloadBlob(
    new Blob([lines.join('\n') + '\n'], { type: 'model/obj' }),
    `${baseName}.obj`
  );
}

/** PLY ASCII, con el color de cada cara cuando la figura lo tiene. */
export function exportPLY(mesh: Mesh, baseName: string) {
  const tris = validTriangles(mesh);
  const colored = hasFaceColors(mesh);
  const header = [
    'ply',
    'format ascii 1.0',
    'comment Zeus Media Studio 3D',
    `element vertex ${mesh.vertices.length}`,
    'property float x',
    'property float y',
    'property float z',
    `element face ${tris.length}`,
    'property list uchar int vertex_indices',
    ...(colored
      ? ['property uchar red', 'property uchar green', 'property uchar blue']
      : []),
    'end_header',
  ].join('\n');
  const body: string[] = [];
  for (const v of mesh.vertices) {
    body.push(`${f(v.x)} ${f(v.y)} ${f(v.z)}`);
  }
  for (const { tri, faceIdx } of tris) {
    let line = `3 ${tri[0]} ${tri[1]} ${tri[2]}`;
    if (colored) {
      const [r, g, b] = hexToRgb01(mesh.faceColors![faceIdx] ?? '#9ca3af');
      line += ` ${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}`;
    }
    body.push(line);
  }
  downloadBlob(
    new Blob([header + '\n' + body.join('\n') + '\n'], { type: 'text/plain' }),
    `${baseName}.ply`
  );
}

/**
 * GLB (glTF 2.0 binario). Sin índices: cada triángulo aporta sus 3
 * vértices, así cada uno puede llevar el color de SU cara (COLOR_0).
 */
export function exportGLB(mesh: Mesh, baseName: string) {
  const tris = validTriangles(mesh);
  const colored = hasFaceColors(mesh);
  const vertCount = tris.length * 3;
  const positions = new Float32Array(vertCount * 3);
  const colors = colored ? new Float32Array(vertCount * 3) : null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let p = 0;
  for (const { tri, faceIdx } of tris) {
    for (const vi of tri) {
      const v = mesh.vertices[vi]!;
      positions[p] = v.x;
      positions[p + 1] = v.y;
      positions[p + 2] = v.z;
      for (let a = 0; a < 3; a++) {
        const c = a === 0 ? v.x : a === 1 ? v.y : v.z;
        if (c < min[a]) min[a] = c;
        if (c > max[a]) max[a] = c;
      }
      if (colored) {
        const [r, g, b] = hexToRgb01(mesh.faceColors![faceIdx] ?? '#9ca3af');
        colors![p] = r;
        colors![p + 1] = g;
        colors![p + 2] = b;
      }
      p += 3;
    }
  }

  // bufferViews + accessors: primero posiciones, luego colores (Float32,
  // así que todo queda alineado a 4 bytes como exige glTF)
  const chunks: ArrayBuffer[] = [positions.buffer];
  const bufferViews: Array<Record<string, unknown>> = [
    { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
  ];
  const accessors: Array<Record<string, unknown>> = [
    { bufferView: 0, componentType: 5126, count: vertCount, type: 'VEC3', min, max },
  ];
  if (colors) {
    chunks.push(colors.buffer);
    bufferViews.push({ buffer: 0, byteOffset: positions.byteLength, byteLength: colors.byteLength, target: 34962 });
    accessors.push({ bufferView: 1, componentType: 5126, count: vertCount, type: 'VEC3' });
  }
  const binLength = chunks.reduce((s, c) => s + c.byteLength, 0);

  const gltf = {
    asset: { version: '2.0', generator: 'Zeus Media Studio 3D' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: colored ? { POSITION: 0, COLOR_0: 1 } : { POSITION: 0 },
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.9 },
        doubleSided: true,
      },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };

  // Contenedor GLB: cabecera + trozo JSON (relleno con espacios) + trozo
  // BIN (relleno con ceros), ambos alineados a 4 bytes
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  const binPad = (4 - (binLength % 4)) % 4;
  const total = 12 + 8 + jsonBytes.byteLength + jsonPad + 8 + binLength + binPad;
  const glb = new ArrayBuffer(total);
  const dv = new DataView(glb);
  const u8 = new Uint8Array(glb);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.byteLength + jsonPad, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  u8.set(jsonBytes, 20);
  for (let i = 0; i < jsonPad; i++) u8[20 + jsonBytes.byteLength + i] = 0x20;
  let at = 20 + jsonBytes.byteLength + jsonPad;
  dv.setUint32(at, binLength + binPad, true);
  dv.setUint32(at + 4, 0x004e4942, true); // 'BIN'
  at += 8;
  for (const c of chunks) {
    u8.set(new Uint8Array(c), at);
    at += c.byteLength;
  }
  downloadBlob(
    new Blob([glb], { type: 'model/gltf-binary' }),
    `${baseName}.glb`
  );
}

/**
 * Combina varias mallas en una única malla, aplicando la transformada
 * (posición, rotación, escala) de cada objeto a sus vértices. Útil para
 * exportar todos los objetos de la escena como un único archivo.
 */
export function mergeMeshes(
  items: Array<{ mesh: Mesh; transform: ObjectTransform; name?: string }>
): Mesh {
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const faceColors: (string | null)[] = [];
  const faceOpacities: number[] = [];
  const uvs: [number, number][] = [];

  let hasAnyColors = false;
  let hasAnyOpacities = false;
  let hasAnyUVs = false;
  let texture: string | undefined;

  const pos = new THREE.Vector3();

  for (const item of items) {
    const { mesh, transform } = item;
    if (!mesh.vertices.length) continue;

    // Matriz de transformación: escala → rotación → traslación
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(transform.px, transform.py, transform.pz),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(transform.rx, transform.ry, transform.rz)
      ),
      new THREE.Vector3(transform.sx, transform.sy, transform.sz)
    );

    const startVertex = vertices.length;

     // Transformar y añadir vértices
    const meshHasUVs = !!mesh.uvs && mesh.uvs.length > 0;
    for (const v of mesh.vertices) {
      pos.set(v.x, v.y, v.z);
      pos.applyMatrix4(matrix);
      vertices.push({ x: pos.x, y: pos.y, z: pos.z });
      if (meshHasUVs) {
        uvs.push(mesh.uvs![vertices.length - 1 - startVertex] ?? [0, 0]);
      }
    }

    // Añadir caras con índices ajustados
    const meshHasColors = !!mesh.faceColors && mesh.faceColors.length > 0;
    const meshHasOpacities = !!mesh.faceOpacities && mesh.faceOpacities.length > 0;

    for (let i = 0; i < mesh.faces.length; i++) {
      const face = mesh.faces[i];
      if (face.length < 3) continue;
      faces.push(face.map((idx) => idx + startVertex));
      faceColors.push(meshHasColors ? (mesh.faceColors![i] ?? null) : null);
      faceOpacities.push(meshHasOpacities ? (mesh.faceOpacities![i] ?? 1) : 1);
    }

    if (meshHasColors) hasAnyColors = true;
    if (meshHasOpacities) hasAnyOpacities = true;
    if (meshHasUVs) hasAnyUVs = true;
    if (!texture && mesh.texture) texture = mesh.texture;
  }

  const result: Mesh = { vertices, faces };
  if (hasAnyColors) result.faceColors = faceColors;
  if (hasAnyOpacities) result.faceOpacities = faceOpacities;
  if (hasAnyUVs) result.uvs = uvs;
  if (texture) result.texture = texture;

  return result;
}