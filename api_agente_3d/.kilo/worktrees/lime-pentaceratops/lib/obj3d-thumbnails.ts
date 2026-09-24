import type { LatheTextureProjection, Mesh } from './geometry';

/**
 * Figura guardada en un proyecto .zeus: la del dueño de la configuración o,
 * si no viene, la del primer objeto con malla que traiga el archivo. La usan
 * el modal "Objeto 3D" del editor (crear y vista previa), sus miniaturas y
 * la ruta /api/objetos-3d (miniaturas del servidor).
 */
export function extractObj3dMesh(data: unknown): {
  name?: string;
  mesh: Mesh;
  smooth?: boolean;
  textureProjection?: LatheTextureProjection;
} | null {
  if (!data || typeof data !== 'object') return null;
  const project = data as {
    sceneObjects?: Array<{
      id?: string;
      name?: string;
      mesh?: Mesh;
      smooth?: boolean;
      textureProjection?: LatheTextureProjection;
    }>;
    configObjectId?: unknown;
  };
  const objs = Array.isArray(project.sceneObjects) ? project.sceneObjects : [];
  const owner =
    typeof project.configObjectId === 'string'
      ? objs.find((o) => o?.id === project.configObjectId)
      : undefined;
  const source =
    owner?.mesh ??
    objs.find((o) => o?.mesh && o.mesh.vertices.length > 0)?.mesh;
  if (!source || source.vertices.length === 0) return null;
  return {
    name: owner?.name,
    mesh: source,
    smooth: owner?.smooth,
    textureProjection: owner?.textureProjection,
  };
}

/**
 * Malla diezmada para miniaturas y vistas previas del modal "Objeto 3D":
 * se queda con caras repartidas uniformemente (máx. maxFaces) y solo los
 * vértices que usan, renumerados. Las miniaturas son tarjetas diminutas —
 * una figura de 100.000 caras se ve igual con 1.500, y así el listado del
 * modal no mueve megas: la malla completa solo se baja al pinchar el
 * archivo. Siempre se descarta la textura (pesa más que la propia malla).
 */
export function decimateMesh(mesh: Mesh, maxFaces = 1500): Mesh {
  const total = mesh.faces.length;
  if (total === 0) return { vertices: [], faces: [] };
  const step = total / Math.min(maxFaces, total);
  const count = Math.min(maxFaces, total);
  const remap = new Map<number, number>();
  const vertices: Mesh['vertices'] = [];
  const faces: number[][] = [];
  const colors: (string | null)[] = mesh.faceColors ? [] : [];
  for (let i = 0; i < count; i++) {
    const faceIdx = Math.min(total - 1, Math.floor(i * step));
    const face = mesh.faces[faceIdx];
    faces.push(
      face.map((idx) => {
        let mapped = remap.get(idx);
        if (mapped === undefined) {
          mapped = vertices.length;
          remap.set(idx, mapped);
          vertices.push(mesh.vertices[idx]);
        }
        return mapped;
      })
    );
    if (mesh.faceColors) colors.push(mesh.faceColors[faceIdx] ?? null);
  }
  const out: Mesh = { vertices, faces };
  if (mesh.faceColors) out.faceColors = colors;
  return out;
}