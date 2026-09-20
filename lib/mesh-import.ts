import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import type { Mesh, Vertex3D } from '@/lib/geometry';

export type ImportFormat = 'obj' | 'glb' | 'gltf' | 'stl' | 'ply';

export const IMPORT_FORMATS: { ext: string; label: string; format: ImportFormat; descKey: string }[] = [
  { ext: '.obj', label: 'OBJ', format: 'obj', descKey: 'editor3D.importFormats.obj' },
  { ext: '.glb', label: 'GLB', format: 'glb', descKey: 'editor3D.importFormats.glb' },
  { ext: '.gltf', label: 'GLTF', format: 'gltf', descKey: 'editor3D.importFormats.gltf' },
  { ext: '.stl', label: 'STL', format: 'stl', descKey: 'editor3D.importFormats.stl' },
  { ext: '.ply', label: 'PLY', format: 'ply', descKey: 'editor3D.importFormats.ply' },
];

export function getFormatFromExtension(filename: string): ImportFormat | null {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  for (const f of IMPORT_FORMATS) {
    if (f.ext === ext) return f.format;
  }
  return null;
}

/**
 * Convierte un THREE.BufferGeometry al formato Mesh del editor.
 * Aplica la matriz de transformación del objeto (posición, rotación,
 * escala) a los vértices. Devuelve null si la geometría no tiene vértices.
 */
function geometryToMesh(
  geometry: THREE.BufferGeometry,
  matrix?: THREE.Matrix4
): Mesh | null {
  if (matrix) {
    geometry = geometry.clone();
    geometry.applyMatrix4(matrix);
  }
  geometry = geometry.toNonIndexed();
  geometry.computeVertexNormals();
  const pos = geometry.attributes.position;
  const vertexCount = pos.count;
  if (vertexCount === 0) return null;
  const vertices: Vertex3D[] = [];
  for (let i = 0; i < vertexCount; i++) {
    vertices.push({
      x: pos.getX(i),
      y: pos.getY(i),
      z: pos.getZ(i),
    });
  }
  const faces: number[][] = [];
  for (let i = 0; i < vertexCount; i += 3) {
    faces.push([i, i + 1, i + 2]);
  }
  const mesh: Mesh = {
    vertices,
    faces,
  };
  // Si la geometría trae colores por vértice, distribuimos a las caras
  const colorAttr = geometry.attributes.color;
  if (colorAttr) {
    const faceColors: (string | null)[] = [];
    for (let i = 0; i < faces.length; i++) {
      const fi = i * 3;
      const r = Math.round(colorAttr.getX(fi) * 255);
      const g = Math.round(colorAttr.getY(fi) * 255);
      const b = Math.round(colorAttr.getZ(fi) * 255);
      faceColors.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
    }
    mesh.faceColors = faceColors;
  }
  return mesh;
}

/**
 * Recolecta todas las geometrías de mallas (con su transformación mundial)
 * de un grupo de objetos THREE. Usa un recorrido iterativo (BFS) para evitar
 * desbordamiento de pila con jerarquías profundas o con el método recursivo
 * updateWorldMatrix de THREE.js.
 */
function collectGeometries(obj: THREE.Object3D): { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; name: string }[] {
  const result: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; name: string }[] = [];
  // Inicializamos matrixWorld del root de forma iterativa
  obj.matrixWorld.copy(obj.matrix);
  const queue: THREE.Object3D[] = [obj];
  while (queue.length > 0) {
    const child = queue.shift()!;
    if (child instanceof THREE.Mesh && child.geometry) {
      result.push({
        geometry: child.geometry,
        matrix: child.matrixWorld.clone(),
        name: child.name || 'piece',
      });
    }
    for (let i = 0; i < child.children.length; i++) {
      const grandchild = child.children[i];
      grandchild.matrixWorld.multiplyMatrices(child.matrixWorld, grandchild.matrix);
      queue.push(grandchild);
    }
  }
  return result;
}

/**
 * Carga un archivo 3D desde un arrayBuffer y devuelve todas las mesas
 * encontradas como objetos separados, cada una convertida al formato del editor.
 */
export async function importModelFile(
  format: ImportFormat,
  arrayBuffer: ArrayBuffer
): Promise<{ meshes: Mesh[]; name: string } | null> {
  const blob = new Blob([arrayBuffer]);
  const meshes: Mesh[] = [];

  if (format === 'obj') {
    const loader = new OBJLoader();
    const text = await blob.text();
    const group = loader.parse(text);
    const parts = collectGeometries(group);
    for (const { geometry, matrix } of parts) {
      const m = geometryToMesh(geometry, matrix);
      if (m && m.vertices.length > 0) meshes.push(m);
    }
    if (meshes.length === 0) return null;
    return { meshes, name: group.name || 'imported-obj' };
  }

  if (format === 'glb' || format === 'gltf') {
    const loader = new GLTFLoader();
    const gltf: GLTF = await new Promise((resolve, reject) => {
      loader.parse(
        arrayBuffer,
        '',
        (result: GLTF) => resolve(result),
        (event: ErrorEvent) => reject(new Error(event.error?.message || event.message || 'Error loading GLB'))
      );
    });
    const parts = collectGeometries(gltf.scene);
    for (const { geometry, matrix } of parts) {
      const m = geometryToMesh(geometry, matrix);
      if (m && m.vertices.length > 0) meshes.push(m);
    }
    if (meshes.length === 0) return null;
    return { meshes, name: gltf.scene.name || 'imported-gltf' };
  }

  if (format === 'stl') {
    const loader = new STLLoader();
    const geometry = loader.parse(await blob.arrayBuffer());
    if (!geometry) return null;
    const m = geometryToMesh(geometry);
    if (!m || m.vertices.length === 0) return null;
    return { meshes: [m], name: 'imported-stl' };
  }

  if (format === 'ply') {
    const loader = new PLYLoader();
    const text = await blob.text();
    const geometry = loader.parse(text);
    if (!geometry) return null;
    const m = geometryToMesh(geometry);
    if (!m || m.vertices.length === 0) return null;
    return { meshes: [m], name: 'imported-ply' };
  }

  return null;
}

/**
 * Normaliza y centra un conjunto de mallas. Escala todas las mallas
 * uniformemente para que el mayor eje mida ~1, y traslada el centro
 * al origen.
 */
export function normalizeAndCenterMeshes(meshes: Mesh[]): void {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const mesh of meshes) {
    for (const v of mesh.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const scale = maxDim > 0 ? 1 / maxDim : 1;
  for (const mesh of meshes) {
    for (const v of mesh.vertices) {
      v.x = (v.x - cx) * scale;
      v.y = (v.y - cy) * scale;
      v.z = (v.z - cz) * scale;
    }
  }
}