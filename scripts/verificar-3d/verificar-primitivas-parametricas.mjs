// Verificación numérica de las primitivas paramétricas del modal
// "Objeto 3D": para cada filename conocido, se genera la malla con los
// parámetros de galería y se compara contra el .zeus real
// (radios por nivel Y, bbox, número de triángulos, winding, idempotencia).
//
// Uso:
//   npx esbuild lib/primitivas-parametricas.ts --bundle --format=esm \
//     --platform=node --outfile=scripts/verificar-3d/.primitivas-bundle.mjs
//   node scripts/verificar-3d/verificar-primitivas-parametricas.mjs

import { readFileSync } from 'fs';
import { construirMallaPrimitiva, paramsDeArchivo } from './.primitivas-bundle.mjs';
import { meshToTriangles } from './.geometry-bundle.mjs';

const CASOS = [
  'Cubo', 'Esfera', 'Toroide', 'Tubo', 'Cono', 'Cilindro', 'Plano', 'Piramide', 'Capsula', 'Disco',
];

let fallos = 0;
const fallo = (msg) => { console.log(`  ✗ ${msg}`); fallos++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);

/** bbox {min:[x,y,z], max:[x,y,z]} de una malla {vertices}. */
function bbox(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.vertices) {
    for (const [k, c] of [[0, p.x], [1, p.y], [2, p.z]]) {
      if (c < min[k]) min[k] = c;
      if (c > max[k]) max[k] = c;
    }
  }
  return { min, max };
}

function bboxDif(a, b) {
  let m = 0;
  for (let k = 0; k < 3; k++) {
    m = Math.max(m, Math.abs(a.min[k] - b.min[k]), Math.abs(a.max[k] - b.max[k]));
  }
  return m;
}

/** Radios por nivel Y (redondeado a 1e-3): set de radios min/max por nivel. */
function nivelesY(mesh) {
  const map = new Map();
  for (const p of mesh.vertices) {
    const y = Math.round(p.y * 1000) / 1000;
    const r = Math.hypot(p.x, p.z);
    let e = map.get(y);
    if (!e) { e = { rmin: r, rmax: r, n: 0 }; map.set(y, e); }
    if (r < e.rmin) e.rmin = r;
    if (r > e.rmax) e.rmax = r;
    e.n++;
  }
  return map;
}

function compararNiveles(gen, orig, tol, label) {
  const g = nivelesY(gen), o = nivelesY(orig);
  if (g.size !== o.size) {
    fallo(`${label}: niveles Y distintos (${g.size} vs ${o.size})`);
    return;
  }
  let peor = 0;
  for (const [y, e] of o) {
    const e2 = g.get(y);
    if (!e2) { fallo(`${label}: falta nivel y=${y}`); return; }
    peor = Math.max(peor, Math.abs(e2.rmin - e.rmin), Math.abs(e2.rmax - e.rmax));
  }
  if (peor > tol) fallo(`${label}: radios por nivel difieren (peor=${peor.toFixed(5)} > ${tol})`);
  else ok(`${label}: ${g.size} niveles Y, radios por nivel ≈ (peor=${peor.toFixed(5)})`);
}

/** Normal (sin normalizar) de un triángulo [a,b,c]. */
function normalTri(a, b, c) {
  const u = [b.x - a.x, b.y - a.y, b.z - a.z];
  const w = [c.x - a.x, c.y - a.y, c.z - a.z];
  return [
    u[1] * w[2] - u[2] * w[1],
    u[2] * w[0] - u[0] * w[2],
    u[0] * w[1] - u[1] * w[0],
  ];
}

/** Centroides + normales de cada triángulo de una malla ya triangulada. */
function infoTris(mesh) {
  return mesh.faces
    .map((f) => {
      const a = mesh.vertices[f[0]], b = mesh.vertices[f[1]], c = mesh.vertices[f[2]];
      const cen = [(a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3];
      const n = normalTri(a, b, c);
      const len = Math.hypot(...n);
      return { cen, n, area2: len };
    })
    .filter((t) => t.area2 > 1e-12); // sin tris de área cero (bandas degeneradas de galería)
}

/**
 * Chequeo de winding contra la galería: cada tri generado debe tener la
 * misma orientación que el tri original más cercano por posición (dot de
 * normales > 0.5). Válido incluso en paredes internas de tubo o la mitad
 * interna del toro, donde las normales apuntan hacia el eje legítimamente.
 */
function comprobarWinding(genTris, origInfo, label) {
  let malas = 0;
  for (const t of infoTris(genTris)) {
    let mejor = null, mejord2 = Infinity;
    for (const o of origInfo) {
      const d2 = (t.cen[0] - o.cen[0]) ** 2 + (t.cen[1] - o.cen[1]) ** 2 + (t.cen[2] - o.cen[2]) ** 2;
      if (d2 < mejord2) { mejord2 = d2; mejor = o; }
    }
    if (!mejor) { malas++; continue; }
    const dot = (t.n[0] * mejor.n[0] + t.n[1] * mejor.n[1] + t.n[2] * mejor.n[2])
      / (t.area2 * mejor.area2);
    if (dot < 0.5) malas++;
  }
  if (malas > 0) fallo(`${label}: ${malas} triángulos con distinta orientación que la galería`);
  else ok(`${label}: orientación idéntica a la galería en ${genTris.faces.length} caras`);
}

// --- 1. Defaults de galería vs .zeus reales ------------------------------
console.log('═══ Defaults de galería vs .zeus reales ═══');
for (const nombre of CASOS) {
  const archivo = `public/Obj-3D/${nombre}.zeus`;
  const doc = JSON.parse(readFileSync(archivo, 'utf8'));
  const orig = doc.sceneObjects[0].mesh;
  const params = paramsDeArchivo(`${nombre}.zeus`);
  if (!params) { fallo(`${nombre}: paramsDeArchivo = null`); continue; }
  const paramsNorm = structuredClone(params);
  const gen = construirMallaPrimitiva(paramsNorm);
  // Sin NaN
  const conNaN = gen.vertices.some((p) => !Number.isFinite(p.x + p.y + p.z));
  if (conNaN) fallo(`${nombre}: hay vértices con NaN`);
  // Triángulos (la galería puede llevar tris degenerados de bandas colapsadas:
  // el cono de galería cierra el ápice con quads a radio 0 → 16 tris de área 0)
  const trisGen = meshToTriangles(gen);
  const origInfo = infoTris(meshToTriangles(orig));
  const diffTris = trisGen.faces.length - origInfo.length;
  if (diffTris !== 0) {
    fallo(`${nombre}: ${trisGen.faces.length} tris generados vs ${origInfo.length} no degenerados del .zeus (dif=${diffTris})`);
  } else ok(`${nombre}: ${trisGen.faces.length} tris = .zeus`);
  // bbox
  const d = bboxDif(bbox(gen), bbox(orig));
  const tolBbox = nombre === 'Disco' ? 3e-3 : 1e-2;
  if (d > tolBbox) fallo(`${nombre}: bbox difiere ${d.toFixed(4)}`);
  else ok(`${nombre}: bbox ≈ (dif=${d.toFixed(5)})`);
  // Radios por nivel
  compararNiveles(gen, orig, nombre === 'Disco' ? 3e-3 : 1.5e-3, `${nombre} niveles`);
  // Winding: orientación idéntica a la galería (válido también para paredes
  // internas del tubo y la mitad interna del toro)
  comprobarWinding(trisGen, origInfo, `${nombre} winding`);
}

// --- 2. Idempotencia y sanidad de degenerados ----------------------------
console.log('═══ Idempotencia / degenerados ═══');
const DEGEN = [
  ['cubo con seg extremos', { kind: 'cubo', ancho: 1, alto: 1, profundo: 1, segX: 128, segY: 1, segZ: 3 }],
  ['cubito radio mínimo', { kind: 'cubo', ancho: 0.0001, alto: 1, profundo: 1, segX: 1, segY: 1, segZ: 1 }],
  ['esfera mínima', { kind: 'esfera', radio: 0.001, meridianos: 3, anillos: 3 }],
  ['esfera alta resolución', { kind: 'esfera', radio: 1, meridianos: 48, anillos: 40 }],
  ['toroide con tubo enorme', { kind: 'toroide', radioAnillo: 0.2, radioTubo: 0.9, segAnillo: 8, segTubo: 8 }],
  ['tubo interno ≥ externo', { kind: 'tubo', radioInterno: 0.9, radioExterno: 0.5, altura: 0.5, segRotacion: 8, segAltura: 2, segTapa: 1 }],
  ['tubo tapa subdividida', { kind: 'tubo', radioInterno: 0.25, radioExterno: 0.5, altura: 0.5, segRotacion: 16, segAltura: 4, segTapa: 4 }],
  ['cono de 3 bandas', { kind: 'cono', radio: 0.5, altura: 2, segmentos: 8, bandas: 3 }],
  ['cilindro 1 banda', { kind: 'cilindro', radio: 0.25, altura: 1, segmentos: 6, bandas: 1 }],
  ['plano pequeño', { kind: 'plano', ancho: 0.1, profundo: 0.3, segX: 2, segZ: 4 }],
  ['pirámide ancha', { kind: 'piramide', lado: 3, altura: 0.4 }],
  ['cápsula sin cuerpo', { kind: 'capsula', radio: 0.25, altura: 0.5, segmentos: 12, bandasCuerpo: 1, bandasCasquete: 6 }],
  ['ARGOLLA (disco radioInterior 0.25)', { kind: 'disco', radio: 0.5, radioInterior: 0.25, sectores: 33 }],
  ['disco 4 sectores', { kind: 'disco', radio: 0.7, radioInterior: 0.2, sectores: 4 }],
];
for (const [etq, params] of DEGEN) {
  let m1, m2;
  try {
    m1 = construirMallaPrimitiva(params);
    m2 = construirMallaPrimitiva(params);
  } catch (e) {
    fallo(`${etq}: excepción ${e.message}`);
    continue;
  }
  const conNaN = m1.vertices.some((p) => !Number.isFinite(p.x + p.y + p.z)
    || m1.faces.some((f) => f.some((i) => i >= m1.vertices.length || i < 0)));
  if (conNaN) { fallo(`${etq}: NaN o índices fuera de rango`); continue; }
  if (JSON.stringify(m1) !== JSON.stringify(m2)) fallo(`${etq}: no idempotente`);
  else ok(`${etq}: ok (${m1.vertices.length} verts, ${m1.faces.length} caras)`);
}

// --- 3. Argolla: topología anular correcta -------------------------------
console.log('═══ Argolla (disco con radioInterior) ═══');
{
  const m = construirMallaPrimitiva({ kind: 'disco', radio: 0.5, radioInterior: 0.25, sectores: 33 });
  // Todas las caras son quads a y=0
  const quads = m.faces.every((f) => f.length === 4);
  const plano = m.vertices.every((p) => Math.abs(p.y) < 1e-9);
  const radios = m.vertices.map((p) => Math.hypot(p.x, p.z));
  const bien = quads && plano
    && Math.abs(Math.min(...radios) - 0.25) < 1e-6
    && Math.abs(Math.max(...radios) - 0.5) < 1e-6;
  if (bien) ok(`argolla: ${m.faces.length} quads entre r=0.25 y r=0.5, y=0 ✓`);
  else fallo(`argolla: quads=${quads} plano=${plano} rmin=${Math.min(...radios).toFixed(3)} rmax=${Math.max(...radios).toFixed(3)}`);
}

// --- 4. paramsDeArchivo --------------------------------------------------
console.log('═══ paramsDeArchivo ═══');
for (const intento of ['Cubo.zeus', 'cubo.ZEUS', 'bezier', 'estrella.png', 'Toroide.zeus']) {
  const p = paramsDeArchivo(intento);
  console.log(`  ${intento} → ${p ? p.kind : 'null'}`);
  if (intento === 'bezier' || intento === 'estrella.png') {
    if (p) fallo(`${intento} NO debe reconocerse`);
  }
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);