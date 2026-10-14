import * as THREE from 'three';
import type { Mesh, Vertex3D } from '@/lib/geometry';

/**
 * Operaciones de malla del botón "Seleccionar" (zona por rectángulo o
 * polígono sobre el objeto activo): Borrar lo seleccionado, extraer la
 * submalla para Copiar/Pegar/Crear objeto nuevo y el horneado a mundo.
 *
 * El realineado de los arrays POR CARA (color, opacidad, textura, grupo)
 * sigue el mismo patrón que extrudeRegionMesh (lib/extrusion-seleccion.ts):
 * cada cara conservada arrastra sus datos, y los vértices/uvs quedan
 * intactos (se permiten huérfanos, como en la extrusión).
 */

/** Caras eliminadas de la malla según la región: queda el hueco abierto. */
export function borrarCarasRegion(
  mesh: Mesh,
  carasRegion: number[],
): Mesh | null {
  const total = mesh.faces.length;
  const region = [...new Set(carasRegion.filter((f) => f >= 0 && f < total))];
  if (region.length === 0 || region.length === total) return null;

  const regionSet = new Set(region);
  const colores = mesh.faceColors ?? null;
  const opacidades = mesh.faceOpacities ?? null;
  const texturas = mesh.faceTextures ?? null;
  const grupos = mesh.faceTextureGroups ?? null;
  const faces: number[][] = [];
  const coloresFinal: (string | null)[] | null = colores ? [] : null;
  const opacidadesFinal: number[] | null = opacidades ? [] : null;
  const texturasFinal: (string | null)[] | null = texturas ? [] : null;
  const gruposFinal: (string | null)[] | null = grupos ? [] : null;
  for (let i = 0; i < total; i++) {
    if (regionSet.has(i)) continue;
    faces.push(mesh.faces[i]);
    if (coloresFinal) coloresFinal.push(colores![i] ?? null);
    if (opacidadesFinal) opacidadesFinal.push(opacidades![i] ?? 1);
    if (texturasFinal) texturasFinal.push(texturas![i] ?? null);
    if (gruposFinal) gruposFinal.push(grupos![i] ?? null);
  }

  const resultado: Mesh = { ...mesh, faces };
  if (coloresFinal) resultado.faceColors = coloresFinal;
  if (opacidadesFinal) resultado.faceOpacities = opacidadesFinal;
  if (texturasFinal) resultado.faceTextures = texturasFinal;
  if (gruposFinal) resultado.faceTextureGroups = gruposFinal;
  return resultado;
}

export type SubmallaResultado = {
  mesh: Mesh;
  /** Índice de vértice original → índice en la submalla. */
  mapaVertices: Map<number, number>;
};

/**
 * Submalla con solo las caras `carasRegion`: los vértices usados se
 * remapean a 0..k y los arrays por cara y las UV viajan con su elemento.
 * El borde queda ABIERTO a propósito (el usuario puede desear un hueco).
 */
export function submallaDeRegion(
  mesh: Mesh,
  carasRegion: number[],
): SubmallaResultado | null {
  const total = mesh.faces.length;
  const region = [...new Set(carasRegion.filter((f) => f >= 0 && f < total))];
  if (region.length === 0) return null;
  if (mesh.vertices.length === 0) return null;

  const mapaVertices = new Map<number, number>();
  const vertices: Vertex3D[] = [];
  for (const idx of region) {
    for (const v of mesh.faces[idx]) {
      if (mapaVertices.has(v)) continue;
      mapaVertices.set(v, vertices.length);
      vertices.push(mesh.vertices[v] ?? { x: 0, y: 0, z: 0 });
    }
  }
  if (vertices.length === 0) return null;

  const colores = mesh.faceColors ?? null;
  const opacidades = mesh.faceOpacities ?? null;
  const texturas = mesh.faceTextures ?? null;
  const grupos = mesh.faceTextureGroups ?? null;
  const faces: number[][] = [];
  const coloresFinal: (string | null)[] | null = colores ? [] : null;
  const opacidadesFinal: number[] | null = opacidades ? [] : null;
  const texturasFinal: (string | null)[] | null = texturas ? [] : null;
  const gruposFinal: (string | null)[] | null = grupos ? [] : null;
  for (const idx of region) {
    const cara = mesh.faces[idx];
    const remap = cara.map((v) => mapaVertices.get(v));
    if (remap.some((v) => v === undefined)) continue;
    faces.push(remap as number[]);
    if (coloresFinal) coloresFinal.push(colores![idx] ?? null);
    if (opacidadesFinal) opacidadesFinal.push(opacidades![idx] ?? 1);
    if (texturasFinal) texturasFinal.push(texturas![idx] ?? null);
    if (gruposFinal) gruposFinal.push(grupos![idx] ?? null);
  }
  if (faces.length === 0) return null;

  let uvs: [number, number][] | undefined;
  if (mesh.uvs && mesh.uvs.length === mesh.vertices.length) {
    const origDeNuevo = new Map<number, number>();
    for (const [orig, nuevo] of mapaVertices) origDeNuevo.set(nuevo, orig);
    uvs = vertices.map((_, nuevo) => mesh.uvs![origDeNuevo.get(nuevo) ?? 0] ?? [0, 0]);
  }

  const resultado: Mesh = { ...mesh, vertices, faces };
  if (coloresFinal) resultado.faceColors = coloresFinal;
  if (opacidadesFinal) resultado.faceOpacities = opacidadesFinal;
  if (texturasFinal) resultado.faceTextures = texturasFinal;
  if (gruposFinal) resultado.faceTextureGroups = gruposFinal;
  if (uvs) resultado.uvs = uvs;
  return { mesh: resultado, mapaVertices };
}

export type TransformHorneado = {
  px?: number; py?: number; pz?: number;
  rx?: number; ry?: number; rz?: number;
  sx?: number; sy?: number; sz?: number;
};

export type HorneadoResultado = {
  mesh: Mesh;
  transform: TransformHorneado;
};

/**
 * HORNEADO A MUNDO (misma regla que espejarObjetoMundo en lib/espejo.ts,
 * sin la reflexión): sube los vértices con T·R·S euler XYZ, pivota en el
 * CENTRO de la caja mundial y devuelve un transform limpio (rot 0, esc 1)
 * — el objeto nuevo nace donde estaba la pieza y se mueve desde su centro.
 */
export function hornearEnMundo(
  mesh: Mesh,
  transform?: TransformHorneado,
): HorneadoResultado {
  if (mesh.vertices.length === 0) {
    return { mesh: { ...mesh }, transform: { ...(transform ?? {}) } };
  }
  const p = new THREE.Vector3(
    transform?.px ?? 0, transform?.py ?? 0, transform?.pz ?? 0
  );
  const quat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(transform?.rx ?? 0, transform?.ry ?? 0, transform?.rz ?? 0)
  );
  const s = new THREE.Vector3(
    transform?.sx ?? 1, transform?.sy ?? 1, transform?.sz ?? 1
  );
  const mundo = mesh.vertices.map(
    (v) =>
      new THREE.Vector3(v.x * s.x, v.y * s.y, v.z * s.z)
        .applyQuaternion(quat)
        .add(p)
  );
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (const w of mundo) {
    if (w.x < minX) minX = w.x;
    if (w.y < minY) minY = w.y;
    if (w.z < minZ) minZ = w.z;
    if (w.x > maxX) maxX = w.x;
    if (w.y > maxY) maxY = w.y;
    if (w.z > maxZ) maxZ = w.z;
  }
  const centro = new THREE.Vector3(
    (minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2
  );
  const vertices: Vertex3D[] = mundo.map((w) => ({
    x: w.x - centro.x, y: w.y - centro.y, z: w.z - centro.z,
  }));
  const resultado: Mesh = { ...mesh, vertices };
  if (mesh.uvs && mesh.uvs.length === mesh.vertices.length) {
    resultado.uvs = [...mesh.uvs];
  }
  // Winding intacto: sin reflexión los triángulos siguen salientes.
  return {
    mesh: resultado,
    transform: {
      px: centro.x, py: centro.y, pz: centro.z,
      rx: 0, ry: 0, rz: 0,
      sx: 1, sy: 1, sz: 1,
    },
  };
}