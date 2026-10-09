// Prueba numérica del CTRL + ESCALA = EXTRUIR la sub-selección:
// extrudeRegionMesh(malla, region, delta mínimo) + escala de los duplicados
// no debe mover NI UN VÉRTICE del resto de la malla (los anillos vecinos
// quedan intactos) ni de las caras originales de la región (la base).
// Uso:
//   npx esbuild lib/extrusion-seleccion.ts --bundle --format=esm \
//     --platform=node --outfile=scripts/verificar-3d/.escala-bundle.mjs
//   node scripts/verificar-3d/probar-anillos-escala.mjs

import { readFileSync } from 'fs';
import { extrudeRegionMesh } from './.escala-bundle.mjs';

const OBJ = ['Cubo', 'Esfera', 'Toroide', 'Tubo', 'Cono', 'Cilindro'];

function v(x, y, z) { return { x, y, z }; }

/** Esfera VIVA de zeia (quads compartidos): [a, a+1, b+1, b]. */
function esferaViva(rings, segs) {
  const vertices = [];
  const faces = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI;
    const y = Math.cos(phi);
    const r = Math.sin(phi);
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * Math.PI * 2;
      vertices.push(v(Math.cos(th) * r, y, Math.sin(th) * r));
    }
  }
  const rowLen = segs + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * rowLen + j;
      const b = a + rowLen;
      faces.push([a, a + 1, b + 1, b]);
    }
  }
  return { vertices, faces };
}

/** Anillo horizontal de la esfera viva: todas las caras de la banda i. */
function anilloHorizontal(faces, segs, i) {
  const r = [];
  for (let j = 0; j < segs; j++) r.push(i * segs + j);
  return r;
}

let fallos = 0;
const fallo = (msg) => { console.log(`  ✗ ${msg}`); fallos++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);

/** Escala los vértices `idx` alrededor del centroide, como el visor. */
function escalar(mesh, idx, factor) {
  let cx = 0, cy = 0, cz = 0;
  for (const i of idx) {
    const p = mesh.vertices[i];
    cx += p.x; cy += p.y; cz += p.z;
  }
  cx /= idx.length; cy /= idx.length; cz /= idx.length;
  const verts = mesh.vertices.map((p) => ({ ...p }));
  for (const i of idx) {
    verts[i].x = cx + (verts[i].x - cx) * factor;
    verts[i].y = cy + (verts[i].y - cy) * factor;
    verts[i].z = cz + (verts[i].z - cz) * factor;
  }
  return verts;
}

function comprobarIntacto(mallaOrig, vertsTras, label) {
  let tocados = 0;
  for (let i = 0; i < mallaOrig.vertices.length; i++) {
    const a = mallaOrig.vertices[i];
    const b = vertsTras[i];
    if (Math.abs(a.x - b.x) > 1e-9 || Math.abs(a.y - b.y) > 1e-9 || Math.abs(a.z - b.z) > 1e-9) tocados++;
  }
  if (tocados !== 0) fallo(`${label}: ${tocados} vértices ORIGINALES se movieron (deben quedar 0)`);
  else ok(`${label}: los ${mallaOrig.vertices.length} vértices originales intactos`);
}

// --- 1. Esfera viva: banda horizontal de 5 filas... no, UNA banda (i=4) ---
{
  console.log('Esfera viva 16x24 — anillo horizontal (banda fila 4), Ctrl+escala ×1.3');
  const reg = 1;
  const m0 = esferaViva(16, 24);
  const facesAnillo = anilloHorizontal(m0.faces, 24, 4); // 24 quads
  const res = extrudeRegionMesh(m0, facesAnillo, { x: 0, y: 0.002, z: 0 });
  if (!res) { fallo('extrudeRegionMesh = null'); }
  else {
    ok(`paredes=${res.paredes.length} duplicados=${res.verticesNuevos.length} carasNuevas=${res.carasNuevas.length}`);
    const dups = res.verticesNuevos;
    if (dups.length === 0) fallo('sin duplicados');
    else {
      const tras = escalar(res.mesh, dups, 1.3);
      comprobarIntacto(m0, tras, 'malla original');
      // La BASE del anillo (caras originales) tampoco se mueve:
      comprobarIntacto(m0, tras, 'base del anillo');
    }
  }
}

// --- 2. Esfera viva: anillo vertical (una columna) ---
{
  console.log('Esfera viva 16x24 — anillo vertical (columna 5), Ctrl+escala ×1.25');
  const m0 = esferaViva(16, 24);
  const segs = 24;
  const facesCol = [];
  for (let i = 0; i < 16; i++) facesCol.push(i * segs + 5);
  const res = extrudeRegionMesh(m0, facesCol, { x: 0.002, y: 0, z: 0 });
  if (!res) fallo('extrudeRegionMesh = null');
  else {
    const tras = escalar(res.mesh, res.verticesNuevos, 1.25);
    comprobarIntacto(m0, tras, 'malla original');
  }
}

// --- 3. Cubo vivo: anillo (cinturón de 4 caras) ---
{
  console.log('Cubo vivo — cinturón de 4 caras laterales, Ctrl+escala ×1.4');
  const vertices = [
    v(-1, -1, -1), v(1, -1, -1), v(1, 1, -1), v(-1, 1, -1),
    v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1),
  ];
  const faces = [
    [4, 5, 6, 7], [1, 0, 3, 2], [0, 4, 7, 3],
    [5, 1, 2, 6], [3, 7, 6, 2], [0, 1, 5, 4],
  ];
  const m0 = { vertices, faces };
  const res = extrudeRegionMesh(m0, [0, 2, 3, 5], { x: 0, y: 0.002, z: 0 }); // laterales
  if (!res) fallo('extrudeRegionMesh = null');
  else {
    const tras = escalar(res.mesh, res.verticesNuevos, 1.4);
    comprobarIntacto(m0, tras, 'malla original');
  }
}

// --- 4. Objetos .zeus reales (triangulados sin índices compartidos) ---
for (const nombre of OBJ) {
  const doc = JSON.parse(readFileSync(`public/Obj-3D/${nombre}.zeus`, 'utf8'));
  const obj = (doc.sceneObjects || [])[0];
  if (!obj?.mesh) continue;
  const mesh = obj.mesh;

  // Región de prueba: las primeras caras de la malla (una franja) — lo que
  // importa es que la extrusión exista y que la malla original no se mueva.
  const n = mesh.faces.length;
  const region10 = mesh.faces.map((_, i) => i).filter((i) => i < Math.ceil(n * 0.08));
  const res = extrudeRegionMesh(mesh, region10, { x: 0, y: 0.002, z: 0 });
  if (!res) { console.log(`${nombre}: extrusión = null (sin anillo)`); continue; }
  const tras = escalar(res.mesh, res.verticesNuevos, 1.2);
  let tocados = 0;
  for (let i = 0; i < mesh.vertices.length; i++) {
    const a = mesh.vertices[i];
    const b = tras[i];
    if (Math.abs(a.x - b.x) > 1e-9 || Math.abs(a.y - b.y) > 1e-9 || Math.abs(a.z - b.z) > 1e-9) tocados++;
  }
  if (tocados !== 0) fallo(`${nombre}: ${tocados} vértices originales se movieron`);
  else ok(`${nombre} (.zeus): extrusión + escala de copia — ${mesh.vertices.length} originales intactos`);
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);