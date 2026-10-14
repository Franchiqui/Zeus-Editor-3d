// PRUEBA TEMPORAL — reproducir la pérdida de faceTextures en la extrusión
// con Ctrl+asa de mover sobre el archivo real del usuario (out-perfecta.zeus):
// extrudeRegionMesh + commit emit (clon de handleVerticesChange) + auto-paint
// (clon de pintarSeleccionAuto). Ver scripts/verificar-3d/rugosa-probe.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const { extrudeRegionMesh } = await import(
  pathToFileURL(path.join(dir, 'rugosa-probe-bundle.cjs')).href
);

const proyecto = JSON.parse(
  fs.readFileSync('F:/Archivos Zeus/Objeto 3D/out-perfecta.zeus', 'utf-8')
);
const mesh = proyecto.sceneObjects[0].mesh;

const suma = (arr) => {
  if (!arr) return 'AUSENTE';
  const nn = arr.filter((v) => v !== null && v !== undefined).length;
  return `len=${arr.length} nonnull=${nn}`;
};
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex').slice(0, 8);

console.log('INICIO  faces:', mesh.faces.length, 'verts:', mesh.vertices.length,
  'texturas:', suma(mesh.faceTextures), 'grupos:', suma(mesh.faceTextureGroups));

// 1. Horno: extrusar la región de caras de textura (418-448), delta según
// su normal media (como hace handleCtrlExtrudirSubSel).
const region = (mesh.faceTextures ?? []).map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
let nx = 0, ny = 0, nz = 0;
for (const idx of region) {
  const cara = mesh.faces[idx];
  const a = mesh.vertices[cara[0]], b = mesh.vertices[cara[1]], c = mesh.vertices[cara[2]];
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  const l = Math.hypot(cx, cy, cz);
  if (l > 1e-12) { nx += cx / l; ny += cy / l; nz += cz / l; }
}
const largo = Math.hypot(nx, ny, nz) || 1;
const delta = { x: (nx / largo) * 0.002, y: (ny / largo) * 0.002, z: (nz / largo) * 0.002 };
const res = extrudeRegionMesh(mesh, region, delta);
console.log(' HORNO  faces:', res.mesh.faces.length, 'verts:', res.mesh.vertices.length,
  'texturas:', suma(res.mesh.faceTextures), 'grupos:', suma(res.mesh.faceTextureGroups),
  'alin:', res.mesh.faceTextures?.length === res.mesh.faces.length ? 'SI' : 'NO',
  'carasNuevas:', res.carasNuevas.length);
console.log('   texturas no-nulas en resultado (índices):',
  res.mesh.faceTextures.map((t, i) => (t ? i : -1)).filter((i) => i >= 0).slice(0, 10), '...');

// 2. Commit del SOLTE (emisión): clon + verts del horno (posición sin mover)
const clon = structuredClone(res.mesh);
const vertsMovidos = clon.vertices.map((v) => ({ ...v })); // el drag real cambia x/y/z
console.log(' SOLTE (clon)  faces:', clon.faces.length,
  'texturas:', suma(clon.faceTextures),
  'texturas idénticas al horno:', JSON.stringify(clon.faceTextures) === JSON.stringify(res.mesh.faceTextures));

// 3. Auto-paint (pintarSeleccionAuto) sobre carasNuevas: quita el cian de
// las que dejaron de estar seleccionadas (region) y pinta las copias.
const colorAuto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAACZgbYnAAAAFElEQVR4nGP8z8Dwn4GBgQEACyoCAgOwH7oAAAAASUVORK5CYII=';
const actuales = res.mesh.faceTextures ?? [];
const selSet = new Set(res.carasNuevas);
const cambios = new Map();
for (let f = 0; f < actuales.length; f++) {
  if (!selSet.has(f) && actuales[f] === undefined) continue; // el resalte real: solo colorAuto
  if (!selSet.has(f) && actuales[f] && actuales[f].startsWith('data:image/png;base64,')) cambios.set(f, null);
}
const newMesh = structuredClone(res.mesh);
const texturas = [...(newMesh.faceTextures ?? [])];
while (texturas.length < newMesh.faces.length) texturas.push(null);
const grupos = [...(newMesh.faceTextureGroups ?? [])];
while (grupos.length < newMesh.faces.length) grupos.push(null);
for (const [f, color] of cambios) { texturas[f] = color; grupos[f] = null; }
if (texturas.every((t) => t === null)) {
  delete newMesh.faceTextures;
  if (grupos.every((g) => g === null)) delete newMesh.faceTextureGroups;
} else {
  newMesh.faceTextures = texturas;
  newMesh.faceTextureGroups = grupos;
}
console.log(' AUTOPAINT faces:', newMesh.faces.length,
  'texturas:', suma(newMesh.faceTextures), 'grupos:', suma(newMesh.faceTextureGroups));

// 4. ¿Alguien en el horno MISMA las misalinea? Chequeo de alineación total.
const alin = newMesh.faceTextures?.length === newMesh.faces.length &&
  newMesh.faceTextureGroups?.length === newMesh.faces.length;
console.log('ALINEACIÓN final:', alin ? 'TODA OK' : 'DESALINEADA');