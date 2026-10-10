// lib/espejo.ts
function espejarMesh(mesh, eje) {
  if (mesh.vertices.length === 0) return { ...mesh };
  let min = Infinity;
  let max = -Infinity;
  for (const v of mesh.vertices) {
    const c = v[eje];
    if (c < min) min = c;
    if (c > max) max = c;
  }
  const centro = (min + max) / 2;
  const vertices = mesh.vertices.map((v) => ({
    ...v,
    [eje]: 2 * centro - v[eje]
  }));
  const faces = mesh.faces.map(
    (f) => f.length >= 3 ? [...f].reverse() : [...f]
  );
  let uvs;
  if (mesh.uvs) {
    const repU = mesh.textureRepeat ?? 1;
    const repV = mesh.textureRepeatY ?? mesh.textureRepeat ?? 1;
    uvs = mesh.uvs.map(
      ([u, v]) => eje === "x" ? [repU - u, v] : eje === "y" ? [u, repV - v] : [u, v]
    );
  }
  return { ...mesh, vertices, faces, uvs };
}
export {
  espejarMesh
};
