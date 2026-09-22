import type { Mesh } from '@/lib/geometry';

/**
 * Copia profunda de una malla. Se usa para congelar la malla BASE de un
 * objeto al crearle la primera pista de parámetro de plugin: las pistas
 * animan `aplicar(base, params)` y sin esta copia el efecto se doblaría
 * (obj.mesh ya llevaría el plugin aplicado estáticamente).
 */
export function cloneMesh(mesh: Mesh): Mesh {
  const clone: Mesh = {
    vertices: mesh.vertices.map((v) => ({ x: v.x, y: v.y, z: v.z })),
    faces: mesh.faces.map((f) => [...f]),
  };
  if (mesh.faceColors !== undefined) clone.faceColors = [...mesh.faceColors];
  if (mesh.faceOpacities !== undefined) clone.faceOpacities = [...mesh.faceOpacities];
  if (mesh.faceTextures !== undefined) clone.faceTextures = [...mesh.faceTextures];
  if (mesh.texture !== undefined) clone.texture = mesh.texture;
  if (mesh.texturePanela !== undefined) clone.texturePanela = mesh.texturePanela;
  if (mesh.textureOriginal !== undefined) clone.textureOriginal = mesh.textureOriginal;
  if (mesh.textureColor !== undefined) clone.textureColor = mesh.textureColor;
  if (mesh.textureRelief !== undefined) clone.textureRelief = mesh.textureRelief;
  if (mesh.textureRepeat !== undefined) clone.textureRepeat = mesh.textureRepeat;
  if (mesh.textureFinish !== undefined) clone.textureFinish = mesh.textureFinish;
  if (mesh.textureHelper !== undefined) clone.textureHelper = mesh.textureHelper;
  if (mesh.textureHelperTransform !== undefined) {
    clone.textureHelperTransform = { ...mesh.textureHelperTransform };
  }
  if (mesh.uvs !== undefined) clone.uvs = mesh.uvs.map((uv) => [...uv] as [number, number]);
  if (mesh.opacity !== undefined) clone.opacity = mesh.opacity;
  return clone;
}