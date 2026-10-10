// Verificación numérica del motor spline 3D (botón "Spline") y del muelle
// ("Spline Rosca"): 2-manifold cerrado, volumen con signo (winding saliente),
// esquinas exactas, bbox / nº de muestras del helicoide, idempotencia y
// sanitizado de `spline` (carga .zeus).
//
// Uso:
//   npx esbuild lib/spline-3d.ts --bundle --format=esm \
//     --platform=node --outfile=scripts/verificar-3d/.spline-bundle.mjs
//   npx esbuild lib/primitivas-parametricas.ts --bundle --format=esm \
//     --platform=node --outfile=scripts/verificar-3d/.primitivas-bundle.mjs
//   node scripts/verificar-3d/verificar-spline-3d.mjs

import {
  buildSpline3DMesh,
  buildRoscaMesh,
  construirMuestraHelix,
  muestrearSpline,
  validarSplineDatos,
} from './.spline-bundle.mjs';
import { normalizarParams } from './.primitivas-bundle.mjs';

let fallos = 0;
const fallo = (msg) => { console.log(`  ✗ ${msg}`); fallos++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const cerca = (a, b, tol) => Math.abs(a - b) <= tol;

/** bbox {min:[..], max:[..]} de una malla. */
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

/** Triángulos (winding conservado) de una malla de tris/quads. */
function triangulos(mesh) {
  const tris = [];
  for (const f of mesh.faces) {
    if (f.length < 3) continue;
    for (let i = 1; i + 1 < f.length; i++) tris.push([f[0], f[i], f[i + 1]]);
  }
  return tris;
}

/** Volumen con signo de una malla cerrada (outward => positivo). */
function volumen(mesh) {
  let v = 0;
  for (const [a, b, c] of triangulos(mesh)) {
    const A = mesh.vertices[a], B = mesh.vertices[b], C = mesh.vertices[c];
    v += (A.x * (B.y * C.z - C.y * B.z)
      - B.x * (A.y * C.z - C.y * A.z)
      + C.x * (A.y * B.z - B.y * A.z)) / 6;
  }
  return v;
}

/** 2-manifold cerrado: cada arista sin dirigir la comparten exactamente 2 caras. */
function manifoldCerrada(mesh) {
  const usos = new Map();
  for (const f of mesh.faces) {
    const n = f.length;
    for (let i = 0; i < n; i++) {
      const a = f[i], b = f[(i + 1) % n];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      usos.set(k, (usos.get(k) || 0) + 1);
    }
  }
  let mal = 0;
  for (const n of usos.values()) if (n !== 2) mal++;
  return mal;
}

const circle = (r = 0.4) => {
  const pts = [];
  for (let i = 0; i < 32; i++) {
    const th = (i / 32) * Math.PI * 2;
    pts.push({ x: 0.5 + Math.cos(th) * r, y: 0.5 + Math.sin(th) * r });
  }
  return pts;
};

const TPL = circle();
const P = (x, y, z) => ({ p: { x, y, z } });

// --- 1. Trazado abierto con 3 vértices -----------------------------------
console.log('═══ Trazado abierto: manifold, volumen, tapas ═══');
{
  const nodes = [
    { id: 1, p: { x: -1, y: 0, z: 0 }, polygon: TPL },
    { id: 2, p: { x: 0, y: 1, z: 0 }, polygon: TPL },
    { id: 3, p: { x: 1, y: 0, z: 0 }, polygon: TPL },
  ];
  const mesh = buildSpline3DMesh(nodes, { escala: 0.5 });
  if (mesh.vertices.length === 0) fallo('malla vacía con 3 vértices + plantilla');
  const mal = manifoldCerrada(mesh);
  if (mal > 0) fallo(`open path: ${mal} aristas con compartición ≠ 2`);
  else ok(`open path: malla cerrada (manifold, ${mesh.faces.length} caras)`);
  const vol = volumen(mesh);
  if (vol <= 0) fallo(`open path: volumen con signo <= 0 (${vol.toFixed(6)}) — winding invertido`);
  else ok(`open path: volumen con signo positivo (${vol.toFixed(5)})`);
}

// --- 2. Trazado CERRADO: sin tapas, misma costura ------------------------
console.log('═══ Trazado cerrado ═══');
{
  const nodes = [
    { id: 1, p: { x: 1, y: 0, z: 0 }, polygon: TPL },
    { id: 2, p: { x: 0, y: 0, z: -1 }, polygon: TPL },
    { id: 3, p: { x: -1, y: 0, z: 0 }, polygon: TPL },
    { id: 4, p: { x: 0, y: 0, z: 1 }, polygon: TPL },
  ];
  const abierto = buildSpline3DMesh(nodes, { escala: 0.5, closed: false });
  const mesh = buildSpline3DMesh(nodes, { escala: 0.5, closed: true });
  const mal = manifoldCerrada(mesh);
  if (mal > 0) fallo(`closed path: ${mal} aristas con compartición ≠ 2`);
  else ok(`closed path: malla cerrada (manifold, ${mesh.faces.length} caras)`);
  const vol = volumen(mesh);
  if (vol <= 0) fallo(`closed path: volumen <= 0 (${vol.toFixed(6)})`);
  else ok(`closed path: volumen con signo positivo (${vol.toFixed(5)})`);
  // El cerrado no añade tapas (sin triángulos); el abierto sí (2 tapas).
  const trisCerr = mesh.faces.filter((f) => f.length === 3).length;
  const trisAbierto = abierto.faces.filter((f) => f.length === 3).length;
  if (trisCerr !== 0) fallo(`closed path: ${trisCerr} triángulos (¿tapas que no deben estar?)`);
  else if (trisAbierto === 0) fallo('open path: sin tapas (0 triángulos)');
  else ok(`closed path: 0 triángulos; abierto con tapas (${trisAbierto} tris = 2 tapas)`);
}

// --- 3. Esquinas: tangente por la dirección del segmento ------------------
console.log('═══ Esquinas (Catmull-Rom colapsado) ═══');
{
  const nodes = [
    { id: 1, p: { x: -1, y: 0, z: 0 }, polygon: TPL },
    { id: 2, p: { x: 0, y: 0, z: 0 }, esquina: true, polygon: TPL },
    { id: 3, p: { x: 0, y: 1, z: 0 }, polygon: TPL },
  ];
  const muestras = muestrearSpline(nodes, false, 8);
  // La muestra final de la esquina: la última del tramo 0 es ~el vértice;
  // el tramo 1 arranca desde allí con la dirección exacta del segmento.
  const idx0 = muestras.findIndex((m) => m.seg === 1);
  const a = muestras[idx0].pos;
  const b = muestras[idx0 + 1].pos;
  const seg = { x: nodes[2].p.x - nodes[1].p.x, y: nodes[2].p.y - nodes[1].p.y, z: nodes[2].p.z - nodes[1].p.z };
  const lseg = Math.hypot(seg.x, seg.y, seg.z);
  const lmos = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const dot = ((b.x - a.x) * seg.x + (b.y - a.y) * seg.y + (b.z - a.z) * seg.z) / (lseg * lmos);
  if (dot < 1 - 1e-6) fallo(`esquina: la tangente de salida no sigue el segmento (dot=${dot.toFixed(7)})`);
  else ok('esquina: tangente de salida = dirección del segmento');

  // Sin esquina la tangente sí dista (la curva se redondea).
  const nodes2 = nodes.map((n) => ({ ...n, esquina: undefined }));
  const muestras2 = muestrearSpline(nodes2, false, 8);
  const j0 = muestras2.findIndex((m) => m.seg === 1);
  const a2 = muestras2[j0].pos;
  const b2 = muestras2[j0 + 1].pos;
  const lmos2 = Math.hypot(b2.x - a2.x, b2.y - a2.y, b2.z - a2.z);
  const dot2 = ((b2.x - a2.x) * seg.x + (b2.y - a2.y) * seg.y + (b2.z - a2.z) * seg.z) / (lseg * lmos2);
  if (dot2 > 0.999) fallo(`esquina: sin bandera curva igual que recta (dot=${dot2.toFixed(7)})`);
  else ok('esquina: sin bandera la curva se redondea (tangente distinta)');
}

// --- 4. Muelle (helicoide): bbox, muestras, manifold, idempotencia --------
console.log('═══ Muelle (Spline Rosca) ═══');
{
  const params = { vueltas: 4, verticesPorVuelta: 12, separacion: 0.3, radioMuelle: 0.6, radioTubo: 0.1 };
  const nodes = construirMuestraHelix(params);
  if (nodes.length !== 4 * 12 + 1) fallo(`helicoide: muestras=${nodes.length} ≠ 49`);
  else ok('helicoide: nº de muestras = vueltas·verticesPorVuelta + 1');

  // Altura: primer punto abajo, sube vueltas·separacion (el paso no se resetea).
  const dy = nodes[nodes.length - 1].p.y - nodes[0].p.y;
  if (!cerca(dy, 4 * 0.3, 1e-6)) fallo(`helicoide: recorrido en Y = ${dy.toFixed(6)} ≠ 1.2`);
  else ok(`helicoide: recorrido total en Y = vueltas·separación (${dy.toFixed(4)})`);

  const mesh = buildRoscaMesh(params);
  const bb = bbox(mesh);
  // ±(radioMuelle+radioTubo) en X/Z; ±(vueltas·separacion/2 + radioTubo) en
  // Y. Tolerancia 1e-3: la tapa final queda levemente inclinada (RMF) y la
  // caja se queda un pelo dentro de los extremos exactos.
  const bbEsperado = { min: [-0.7, -0.7, -0.7], max: [0.7, 0.7, 0.7] };
  const dif = bboxDif(bb, bbEsperado);
  if (dif > 1e-3) fallo(`helicoide: bbox difiere (peor=${dif.toFixed(7)})`);
  else ok(`helicoide: bbox = ±(radioMuelle+radioTubo) X/Z, ±(vueltas·separacion/2+radioTubo) Y`);

  const mal2 = manifoldCerrada(mesh);
  if (mal2 > 0) fallo(`helicoide: ${mal2} aristas con compartición ≠ 2`);
  else ok('helicoide: malla cerrada (manifold)');
  if (volumen(mesh) <= 0) fallo('helicoide: volumen <= 0');
  else ok('helicoide: volumen con signo positivo');

  // Idempotencia.
  const mesh2 = buildRoscaMesh(normalizarParams({ kind: 'muelle', ...params }));
  if (mesh2.vertices.length !== mesh.vertices.length
    || Math.abs(volumen(mesh2) - volumen(mesh)) > 1e-9)
    fallo('idempotencia: segunda llamada difiere');
  else ok('idempotencia: dos llamadas → misma malla');
}

// --- 4b. Escala de plantilla POR VÉRTICE ----------------------------------
console.log('═══ Escala de plantilla por vértice ═══');
{
  // Trazado recto a lo largo de Y: la sección en cada vértice la da su
  // propia escala (o la global si no la trae).
  const nodes = [
    { id: 1, p: { x: 0, y: 0, z: 0 }, polygon: TPL, escala: 1 },
    { id: 2, p: { x: 0, y: 1, z: 0 }, polygon: TPL },               // usa la global
    { id: 3, p: { x: 0, y: 2, z: 0 }, polygon: TPL, escala: 0.25 },
  ];
  const mesh = buildSpline3DMesh(nodes, { escala: 0.5, subdivisions: 1 });
  const bb = bbox(mesh);
  const radiosX = mesh.vertices.map((v) => Math.hypot(v.x, v.z));
  const rMin = Math.min(...radiosX);
  const rMax = Math.max(...radiosX);
  // Radio mundo de una plantilla r=0.4: 2·r·escala → 0.8·escala.
  const esperados = [0.8, 0.4, 0.2];  // escala 1, 0.5 (global), 0.25
  if (!cerca(rMax, Math.max(...esperados), 1e-3) || !cerca(rMin, Math.min(...esperados), 1e-3))
    fallo(`escala por vértice: radios [${rMin.toFixed(4)}, ${rMax.toFixed(4)}] ≠ [${esperados.join(', ')}]`);
  else ok(`escala por vértice: radios 0.8 / 0.4 (global) / 0.2 según el nodo`);
  const mal = manifoldCerrada(mesh);
  if (mal > 0) fallo(`escala por vértice: ${mal} aristas ≠ 2 caras`);
  else ok('escala por vértice: mala igual de costurada (manifold)');

  // Interpolación dentro de un segmento (vértice 1→2 funde 1→0.5):
  // con subdivisions=2 salen 3 anillas de radios 0.8 / 0.6 / 0.4.
  const m12 = buildSpline3DMesh([nodes[0], nodes[1]], { escala: 0.5, subdivisions: 2 });
  const radios12 = m12.vertices.map((v) => Math.hypot(v.x, v.z));
  // Cluster de radios con tolerancia: cada anilla tiene una variación
  // mínima (0.7966 junto a 0.8) — se agrupan y queda 1 valor por anilla.
  const grupos = [];
  for (const r of radios12.sort((a, b) => b - a)) {
    const base = grupos[grupos.length - 1];
    if (base === undefined || Math.abs(r - base) > 0.01) grupos.push(r);
  }
  const ordenados = grupos;
  const esperados12 = [0.8, 0.6, 0.4];
  if (ordenados.length !== 3 || !ordenados.every((r, i) => cerca(r, esperados12[i], 1e-3)))
    fallo(`escala interpolada: radios [${ordenados.join(', ')}] ≠ ${esperados12.join(', ')}`);
  else ok('escala por vértice: se interpola entre A y B (fundido 0.8→0.4 al medio=0.6)');

  // Sin escala en NINGÚN nodo = la global (compatibilidad .zeus viejo).
  const nodesOld = nodes.map(({ escala, ...n }) => n);
  const meshOld = buildSpline3DMesh(nodesOld, { escala: 0.5, subdivisions: 1 });
  const rMaxOld = Math.max(...meshOld.vertices.map((v) => Math.hypot(v.x, v.z)));
  if (!cerca(rMaxOld, 0.4, 1e-3)) fallo(`compatibilidad: r=${rMaxOld.toFixed(4)} ≠ 0.4 (la global manda)`);
  else ok('compatibilidad: nodos sin escala propia usan la global (0.4)');
}

// --- 5. Orientación RADIAL (tornillo) -------------------------------------
console.log('═══ Orientación radial (tornillo) ═══');
{
  // Triángulo con la punta a la DERECHA (x=1): con el marco radial esa
  // punta debe quedar mirando HACIA FUERA en todas las vueltas (radio
  // máximo constante), mientras que el transporte paralelo deriva.
  const triangulo = [
    { x: 1, y: 0.5 },
    { x: 0.5, y: 0.95 },
    { x: 0.5, y: 0.05 },
  ];
  const params = { vueltas: 3, verticesPorVuelta: 12, separacion: 0.4, radioMuelle: 0.8, radioTubo: 0.1 };
  const nodes = construirMuestraHelix(params).map((n) => ({
    ...n,
    polygon: triangulo.map((p) => ({ ...p })),
  }));
  const altura = params.vueltas * params.separacion;
  const grupos = (mesh) => {
    // Radio máximo por vuelta (agroupando por la altura del vértice).
    const g = {};
    for (const v of mesh.vertices) {
      const gi = Math.round((v.y + altura / 2) / params.separacion);
      const r = Math.hypot(v.x, v.z);
      g[gi] = Math.max(g[gi] ?? 0, r);
    }
    return Object.values(g);
  };
  const maximo = (arr) => Math.max(...arr) - Math.min(...arr);

  const radial = buildSpline3DMesh(nodes, {
    closed: false, subdivisions: 1, escala: 0.12, orientacion: 'radial',
  });
  const transporte = buildSpline3DMesh(nodes, {
    closed: false, subdivisions: 1, escala: 0.12,
  });

  const maxRadial = grupos(radial);
  const maxTrans = grupos(transporte);
  const spreadR = maximo(maxRadial);
  const spreadT = maximo(maxTrans);
  if (spreadR > 1e-4) fallo(`radial: el radio máximo VARÍA entre vueltas (spread=${spreadR.toFixed(6)})`);
  else ok(`radial: radio máximo constante en las 3 vueltas (spread=${spreadR.toExponential(2)}; transporte ${spreadT.toFixed(4)})`);

  const punta = params.radioMuelle + 2 * 0.5 * 0.12; // 2·r·escala (UNIT=2)
  // 0.02·? la punta puede caer ENTRE dos muestras de la anilla (resampleo
  // a 16 pts de un triángulo de 3 vértices): tolera ~40% del tubo.
  const rMax = Math.max(...maxRadial);
  if (!cerca(rMax, punta, 0.05)) fallo(`radial: radio máximo ${rMax.toFixed(4)} ≁ punta esperada ${punta.toFixed(3)}`);
  else ok(`radial: la punta de la plantilla sobresale a r=${rMax.toFixed(4)} (≈ radioMuelle+tubo)`);

  const mal3 = manifoldCerrada(radial);
  if (mal3 > 0) fallo(`radial: ${mal3} aristas con compartición ≠ 2`);
  else ok('radial: malla cerrada (manifold)');
  if (volumen(radial) <= 0) fallo('radial: volumen <= 0');
  else ok('radial: volumen con signo positivo');

  const datos = validarSplineDatos({
    nodes: [{ id: 1, p: { x: 0, y: 0, z: 0 }, polygon: triangulo }, { id: 2, p: { x: 0, y: 1, z: 0 } }],
    closed: false, subdivisions: 1, escala: 0.12, orientacion: 'radial',
  });
  if (datos?.orientacion !== 'radial') fallo('validarSplineDatos: pierde orientacion "radial"');
  else ok('validarSplineDatos: conserva orientacion "radial"');
  const datos2 = validarSplineDatos({
    nodes: [{ id: 1, p: { x: 0, y: 0, z: 0 } }, { id: 2, p: { x: 0, y: 1, z: 0 } }],
    closed: false, subdivisions: 1, escala: 0.12, orientacion: 'basura',
  });
  if (datos2?.orientacion) fallo('validarSplineDatos: acepta orientación desconocida');
  else ok('validarSplineDatos: orientación desconocida → transporte (undefined)');
}

// --- 5. degenerados / clamps ---------------------------------------------
console.log('═══ Params degenerados ═══');
{
  const fuera = normalizarParams({ kind: 'muelle', vueltas: 99, verticesPorVuelta: 999, separacion: -2, radioMuelle: 0.5, radioTubo: 9 });
  if (fuera.vueltas === 99 || fuera.verticesPorVuelta === 999 || fuera.radioTubo > 0.5) {
    fallo(`muelle: clamps no aplicados (${JSON.stringify(fuera)})`);
  } else ok(`muelle: clamps OK (vueltas=${fuera.vueltas}, vpv=${fuera.verticesPorVuelta}, radioTubo=${fuera.radioTubo.toFixed(3)})`);
  const m0 = buildRoscaMesh({ vueltas: 0, verticesPorVuelta: 16, separacion: 0.4, radioMuelle: 0.5, radioTubo: 0.12 });
  if (m0.vertices.length !== 0) fallo('vueltas 0 no da malla vacía');
  else ok('muelle: vueltas 0 → malla vacía (sin romper)');
  // trazado/params mínimos aceptables en el builder.
  const m2 = buildSpline3DMesh([], {});
  if (m2.vertices.length !== 0) fallo('spline sin nodos no es malla vacía');
  else ok('spline: sin nodos → malla vacía');
}

// --- 6. validarSplineDatos (carga .zeus) ----------------------------------
console.log('═══ validarSplineDatos ═══');
{
  const datos = {
    nodes: [
      { id: 1, p: { x: NaN, y: 0, z: 0 }, polygon: TPL },           // se descarta
      { id: 2, p: { x: 0, y: 1, z: 0.5 }, polygon: TPL },
      { id: 3, p: { x: 1, y: 0, z: 0 }, polygon: [] },              // plantilla vacía → sin polygon
      { id: 4, p: { x: 1, y: 0, z: 1 }, polygon: TPL },
    ],
    closed: 'true',
    subdivisions: 999,
    escala: -5,
  };
  const v = validarSplineDatos(datos);
  if (!v) fallo('validar: descartó un trazado con datos útiles');
  else {
    const nConPlantilla = v.nodes.filter((n) => (n.polygon ?? []).length >= 3).length;
    if (v.nodes.length !== 3 || nConPlantilla !== 2) fallo(`validar: nodos=${v.nodes.length} conPlantilla=${nConPlantilla} (esperado 3/2)`);
    else ok('validar: NaN fuera, polygon vacío fuera, nodos válidos=3');
    if (v.closed !== true) fallo('validar: closed="true" no se aceptó');
    else if (v.subdivisions !== 64) fallo(`validar: subdivisions=${v.subdivisions} (esperado clamp 64)`);
    else if (v.escala <= 0) fallo(`validar: escala=${v.escala} no sanada`);
    else ok(`validar: closed/subdivisions/escala OK (${v.subdivisions}, ${v.escala})`);
    // Un nodo sin polygon debe llevar la plantilla del llamador; el builder
    // lo maneja con plantillaPorDefecto.
    const m = buildSpline3DMesh(v.nodes, { plantillaPorDefecto: TPL });
    if (m.vertices.length === 0) fallo('validar: builder vacío con plantillaPorDefecto');
    else ok('validar: builder acepta el trazado validado');
  }
  if (validarSplineDatos(null) !== undefined) fallo('validar(null) debe ser undefined');
  else if (validarSplineDatos({ nodes: [] }) !== undefined) fallo('validar(sin nodos) debe ser undefined');
  else if (validarSplineDatos('basura') !== undefined) fallo('validar("basura") debe ser undefined');
  else ok('validar: basura / vacío → undefined');

  // Parámetros del muelle precargado: persisten con clamps (panel que
  // reaparece al reeditar), basura → sin rosca.
  const conRosca = validarSplineDatos({
    nodes: [{ id: 1, p: { x: 0, y: 0, z: 0 } }, { id: 2, p: { x: 0, y: 1, z: 0 } }],
    closed: false, subdivisions: 1, escala: 0.12,
    rosca: { vueltas: 99, verticesPorVuelta: 999, separacion: 0.4, radioMuelle: 0.5, radioTubo: 0.12 },
  });
  if (conRosca?.rosca?.vueltas !== 40 || conRosca.rosca.verticesPorVuelta !== 128 || conRosca.rosca.separacion !== 0.4)
    fallo(`validar: rosca mal clamped (${JSON.stringify(conRosca?.rosca)})`);
  else ok('validar: rosca persiste con clamps (40, 128)');
  const roscaBasura = validarSplineDatos({
    nodes: [{ id: 1, p: { x: 0, y: 0, z: 0 } }, { id: 2, p: { x: 0, y: 1, z: 0 } }],
    closed: false, subdivisions: 1, escala: 0.12, rosca: 'basura',
  });
  if (roscaBasura?.rosca) fallo('validar: aceptó una rosca basura');
  else ok('validar: rosca basura → sin rosca (undefined)');
}

console.log(fallos === 0 ? '\n✔ Todos los checks en verde' : `\n✗ ${fallos} checks en rojo`);
process.exit(fallos === 0 ? 0 : 1);