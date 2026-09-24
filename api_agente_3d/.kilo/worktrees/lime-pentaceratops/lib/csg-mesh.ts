import * as THREE from 'three';
import { CSG } from 'three-csg-ts';
import type { Mesh, Vertex3D } from './geometry';
import type { ObjectTransform } from '@/components/viewer-3d';

/**
 * Convierte un objeto Mesh de Zeus Editor a un THREE.Mesh con su transformación de mundo aplicada.
 */
export function meshToThreeMesh(mesh: Mesh, transform: ObjectTransform): THREE.Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Triangulamos las caras de la malla de Zeus
  for (const face of mesh.faces) {
    if (face.length < 3) continue;
    const v0 = mesh.vertices[face[0]];
    const v1 = mesh.vertices[face[1]];
    const v2 = mesh.vertices[face[2]];
    if (!v0 || !v1 || !v2) continue;

    // Calcular normal de la cara
    const e1 = new THREE.Vector3(v1.x - v0.x, v1.y - v0.y, v1.z - v0.z);
    const e2 = new THREE.Vector3(v2.x - v0.x, v2.y - v0.y, v2.z - v0.z);
    const n = e1.cross(e2).normalize();

    const baseIndex = positions.length / 3;
    for (const idx of face) {
      const v = mesh.vertices[idx];
      if (!v) continue;
      positions.push(v.x, v.y, v.z);
      normals.push(n.x, n.y, n.z);
      if (mesh.uvs && mesh.uvs[idx]) {
        uvs.push(mesh.uvs[idx][0], mesh.uvs[idx][1]);
      } else {
        uvs.push(0, 0);
      }
    }

    // Triangular abanico si la cara tiene más de 3 vértices
    for (let i = 1; i < face.length - 1; i++) {
      indices.push(baseIndex, baseIndex + i, baseIndex + i + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (uvs.length === (positions.length / 3) * 2) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const threeMesh = new THREE.Mesh(geometry, material);

  // Aplicar posición, rotación y escala en espacio mundial
  threeMesh.position.set(transform.px, transform.py, transform.pz);
  threeMesh.rotation.set(transform.rx, transform.ry, transform.rz);
  threeMesh.scale.set(
    transform.sx || 1,
    transform.sy || 1,
    transform.sz || 1
  );
  threeMesh.updateMatrix();
  threeMesh.updateMatrixWorld(true);

  return threeMesh;
}

/**
 * Convierte un THREE.BufferGeometry resultante de CSG de vuelta a la estructura Mesh de Zeus Editor.
 * Opcionalmente transforma los vértices por la matriz inversa del objeto base para mantener su transform local.
 */
export function threeGeometryToMesh(
  geometry: THREE.BufferGeometry,
  inverseMatrix?: THREE.Matrix4
): Mesh {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr || posAttr.count === 0) {
    return { vertices: [], faces: [] };
  }

  const indexAttr = geometry.getIndex();
  const rawPositions: THREE.Vector3[] = [];

  for (let i = 0; i < posAttr.count; i++) {
    const v = new THREE.Vector3(
      posAttr.getX(i),
      posAttr.getY(i),
      posAttr.getZ(i)
    );
    if (inverseMatrix) {
      v.applyMatrix4(inverseMatrix);
    }
    rawPositions.push(v);
  }

  // Soldar vértices duplicados para mantener la malla limpia, ligera y continua
  const precision = 1e-4;
  const vertexMap = new Map<string, number>();
  const vertices: Vertex3D[] = [];
  const remap: number[] = [];

  for (let i = 0; i < rawPositions.length; i++) {
    const p = rawPositions[i];
    const key = `${Math.round(p.x / precision)},${Math.round(p.y / precision)},${Math.round(p.z / precision)}`;
    let mapped = vertexMap.get(key);
    if (mapped === undefined) {
      mapped = vertices.length;
      vertexMap.set(key, mapped);
      vertices.push({ x: p.x, y: p.y, z: p.z });
    }
    remap.push(mapped);
  }

  const faces: number[][] = [];
  if (indexAttr) {
    for (let i = 0; i < indexAttr.count; i += 3) {
      const i0 = remap[indexAttr.getX(i)];
      const i1 = remap[indexAttr.getX(i + 1)];
      const i2 = remap[indexAttr.getX(i + 2)];
      // Descartar triángulos degenerados (dos o tres vértices iguales)
      if (i0 !== i1 && i1 !== i2 && i0 !== i2) {
        faces.push([i0, i1, i2]);
      }
    }
  } else {
    for (let i = 0; i < remap.length; i += 3) {
      const i0 = remap[i];
      const i1 = remap[i + 1];
      const i2 = remap[i + 2];
      if (i0 !== undefined && i1 !== undefined && i2 !== undefined) {
        if (i0 !== i1 && i1 !== i2 && i0 !== i2) {
          faces.push([i0, i1, i2]);
        }
      }
    }
  }

  return {
    vertices,
    faces,
  };
}

export type BooleanOperationType = 'subtract' | 'union' | 'intersect';

export interface CSGResult {
  success: boolean;
  resultMesh?: Mesh;
  error?: string;
}

/**
 * Ejecuta una operación booleana (sustracción, unión o intersección) entre dos mallas
 * teniendo en cuenta sus posiciones, rotaciones y escalas en la escena 3D.
 */
export function performCSGOperation(
  baseMesh: Mesh,
  baseTransform: ObjectTransform,
  toolMesh: Mesh,
  toolTransform: ObjectTransform,
  operation: BooleanOperationType = 'subtract'
): CSGResult {
  try {
    if (!baseMesh.vertices.length || !baseMesh.faces.length) {
      return { success: false, error: 'El objeto base no tiene geometría válida' };
    }
    if (!toolMesh.vertices.length || !toolMesh.faces.length) {
      return { success: false, error: 'El objeto cortador no tiene geometría válida' };
    }

    const threeMeshA = meshToThreeMesh(baseMesh, baseTransform);
    const threeMeshB = meshToThreeMesh(toolMesh, toolTransform);

    let resultThreeMesh: THREE.Mesh;

    if (operation === 'subtract') {
      resultThreeMesh = CSG.subtract(threeMeshA, threeMeshB);
    } else if (operation === 'union') {
      resultThreeMesh = CSG.union(threeMeshA, threeMeshB);
    } else if (operation === 'intersect') {
      resultThreeMesh = CSG.intersect(threeMeshA, threeMeshB);
    } else {
      return { success: false, error: 'Operación no soportada' };
    }

    if (!resultThreeMesh || !resultThreeMesh.geometry) {
      return { success: false, error: 'No se pudo generar la geometría resultante' };
    }

    // Matriz inversa del objeto base para mantener sus coordenadas locales y gizmo
    const baseMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(baseTransform.px, baseTransform.py, baseTransform.pz),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(baseTransform.rx, baseTransform.ry, baseTransform.rz)
      ),
      new THREE.Vector3(baseTransform.sx || 1, baseTransform.sy || 1, baseTransform.sz || 1)
    );
    const inverseBaseMatrix = baseMatrix.clone().invert();

    const resultMesh = threeGeometryToMesh(resultThreeMesh.geometry, inverseBaseMatrix);

    // Conservar propiedades de textura/material del objeto base si existen
    if (baseMesh.texture) {
      resultMesh.texture = baseMesh.texture;
      resultMesh.textureColor = baseMesh.textureColor;
      resultMesh.textureRelief = baseMesh.textureRelief;
      resultMesh.textureFinish = baseMesh.textureFinish;
      resultMesh.opacity = baseMesh.opacity;
    }

    // Liberar geometrías intermedias
    threeMeshA.geometry.dispose();
    threeMeshB.geometry.dispose();
    resultThreeMesh.geometry.dispose();

    return {
      success: true,
      resultMesh,
    };
  } catch (err: any) {
    console.error('Error al realizar operación booleana CSG:', err);
    return {
      success: false,
      error: err?.message || 'Error desconocido al calcular el corte booleano',
    };
  }
}
