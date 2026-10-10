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