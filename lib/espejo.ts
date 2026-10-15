import * as THREE from 'three';
import type { Mesh, Vertex3D } from '@/lib/geometry';

/**
 * ESPEJO (botón "Espejo" de la cabecera): refleja la malla lógica de un
 * objeto según un eje, respecto al CENTRO de su propia caja (el objeto
 * queda donde está; solo se voltea). Una reflexión invierte la
 * orientación de las caras, así que cada cara se recorre al revés para
 * que el winding siga saliente (sin compensar, la malla se ve del revés
 * y el volumen con signo se vuelve negativo).
 *
 * Los atributos POR CARA (colores, opacidades, texturas, grupo de
 * textura) quedan alineados: cada cara conserva su índice y sus datos.
 * Las UV por vértice se espejan con la forma (u ↔ x, v ↔ y; eje Z no
 * toca el mapeo de la proyección plana), respetando la repetición
 * (u' = rep - u para que el volteo no la desplaze).
 */

export type EjeEspejo = 'x' | 'y' | 'z';

export function espejarMesh(mesh: Mesh, eje: EjeEspejo): Mesh {
  if (mesh.vertices.length === 0) return { ...mesh };
  let min: number = Infinity;
  let max: number = -Infinity;
  for (const v of mesh.vertices) {
    const c = v[eje];
    if (c < min) min = c;
    if (c > max) max = c;
  }
  const centro = (min + max) / 2;
  const vertices: Vertex3D[] = mesh.vertices.map((v) => ({
    ...v,
    [eje]: 2 * centro - v[eje],
  }));
  const faces: number[][] = mesh.faces.map((f) =>
    f.length >= 3 ? [...f].reverse() : [...f]
  );
  // UV espejadas SOLO si la malla lleva mapeo propio.
  let uvs: [number, number][] | undefined;
  if (mesh.uvs) {
    const repU = mesh.textureRepeat ?? 1;
    const repV = mesh.textureRepeatY ?? mesh.textureRepeat ?? 1;
    uvs = mesh.uvs.map(([u, v]) =>
      eje === 'x' ? ([repU - u, v] as [number, number])
      : eje === 'y' ? ([u, repV - v] as [number, number])
      : ([u, v] as [number, number])
    );
  }
  return { ...mesh, vertices, faces, uvs };
}

/**
 * ESPEJO EN MUNDO para el modo «Crear objeto nuevo»: refleja la malla
 * según el eje de la VISTA (el del mundo, no el del objeto inclinado), de
 * modo que la pieza salga como un reflejo de verdad — un cubo inclinado
 * 45° sale inclinado −45°, no con la misma inclinación. (El espejo LOCAL
 * de `espejarMesh` sobre un objeto girado voltea en su eje propio: en
 * piezas simétricas produce la MISMA figura y parece una copia.)
 *
 * Receta: sube cada vértice a mundo con la transformada del objeto
 * (misma regla que el visor: T·R·S, euler XYZ en radianes), refleja el
 * componente del eje y hornea el resultado con un transform NUEVO:
 * pivote en el centro de la caja del gemelo y rotación a cero — la
 * inclinación original queda HORNEADA dentro de la malla reflejada, y
 * el gemelo se mueve/gira/escala desde su propio centro (pivote limpio,
 * rotación a 0).
 *
 * El PLANO DE ESPEJO es la CARA de la caja del objeto hacia el lado del
 * eje elegido (max del eje en mundo), NO el centro de su caja (pedido del
 * usuario 15/10): antes el reflejo caía ENCIMA del original (espejo en su
 * propio centro, superpuesto — había que arrastrar el gemelo a mano);
 * ahora el gemelo sale AL LADO, pegado a esa cara, como un espejo
 * apoyado contra la pieza: el original y su reflejo, separados.
 *
 * Las caras se recorren al revés (la reflexión invierte el winding) y
 * las UV se dejan CLAVADAS a sus vértices: con un eje de reflexión que
 * no coincide con ninguno local, la textura debe reflejarse pegada a la
 * superficie (como un espejo real), no en un eje de mapeo.
 */
export type TransformEspejo = {
  px?: number; py?: number; pz?: number;
  rx?: number; ry?: number; rz?: number;
  sx?: number; sy?: number; sz?: number;
};

export type EspejoMundoResultado = {
  mesh: Mesh;
  transform: TransformEspejo;
};

export function espejarObjetoMundo(
  mesh: Mesh,
  transform: TransformEspejo | undefined,
  eje: EjeEspejo
): EspejoMundoResultado {
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
  // 1) Vértices a mundo.
  const mundo = mesh.vertices.map(
    (v) =>
      new THREE.Vector3(v.x * s.x, v.y * s.y, v.z * s.z)
        .applyQuaternion(quat)
        .add(p)
  );
  // 2) Centro de la caja MUNDIAL (los 3 ejes: será el pivote del gemelo).
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
  // 3) Reflejo en mundo con el ESPEJO apoyado en la CARA de la caja (max
  // del eje, lado positive del eje pedido): el gemelo sale al OTRO lado de
  // esa cara, pegado al original pero FUERA de él — el reflejo de verdad.
  const plano = eje === 'x' ? maxX : eje === 'y' ? maxY : maxZ;
  const pivote = centro.clone();
  pivote[eje] = 2 * plano - pivote[eje];
  const vertices: Vertex3D[] = mundo.map((w) => {
    const m = w.clone();
    m[eje] = 2 * plano - m[eje];
    m.sub(pivote);
    return { x: m.x, y: m.y, z: m.z };
  });
  const faces: number[][] = mesh.faces.map((f) =>
    f.length >= 3 ? [...f].reverse() : [...f]
  );
  return {
    mesh: { ...mesh, vertices, faces },
    transform: {
      px: pivote.x, py: pivote.y, pz: pivote.z,
      rx: 0, ry: 0, rz: 0,
      sx: 1, sy: 1, sz: 1,
    },
  };
}