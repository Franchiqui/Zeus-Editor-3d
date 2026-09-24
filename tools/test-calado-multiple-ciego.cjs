/*
 * test-calado-multiple-ciego.cjs
 * ------------------------------
 * Verifica las dos mejoras pedidas:
 *
 *   1) VARIOS agujeros (calados) a la vez, cada uno independiente.
 *   2) CALADO CIEGO (con fondo) además del pasante.
 *   ...y todo ello en LOS DOS tipos de extrusión: la extrusión simple
 *   (buildExtrudeMeshes) y el recorrido (buildSweepMesh).
 *
 * Carga el TS REAL (transpilado) y valida la geometría resultante:
 *   - malla 2-manifold CERRADA (cada arista en exactamente 2 caras): las
 *     tapas, paredes y suelos cierran bien.
 *   - el calado QUITA material y la merma equivale al volumen del agujero
 *     (área × profundidad), respetando el fondo del calado ciego.
 *   - el suelo de un calado ciego mira hacia +Z (abertura del bolsillo).
 */
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function transpile(file) {
  const src = read(file);
  let out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;
  out = out
    .replace(/['"]@\/lib\/geometry['"]/g, "'./_geo.cjs'")
    .replace(/['"]\.\/geometry['"]/g, "'./_geo.cjs'");
  return out;
}

fs.writeFileSync(path.join(__dirname, '_geo.cjs'), transpile('lib/geometry.ts'));
fs.writeFileSync(path.join(__dirname, '_views.cjs'), transpile('lib/views-mesh.ts'));
fs.writeFileSync(path.join(__dirname, '_sweep.cjs'), transpile('lib/sweep-mesh.ts'));

const { buildExtrudeMeshes } = require('./_views.cjs');
const { buildSweepMesh } = require('./_sweep.cjs');

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) {
    pass++;
    console.log('  ok  ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name);
  }
}
function section(t) {
  console.log('\n== ' + t + ' ==');
}

// ---------------------------------------------------------------------------
// Utilidades de malla
// ---------------------------------------------------------------------------
function square(cx, cy, r) {
  return [
    { x: cx - r, y: cy - r },
    { x: cx + r, y: cy - r },
    { x: cx + r, y: cy + r },
    { x: cx - r, y: cy + r },
  ];
}
function shoelace(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
}
// Bounding box de un polígono en coordenadas lienzo.
function worldBox(poly) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of poly) {
    minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
  }
  return { minX, minY, w: maxX - minX || 1, h: maxY - minY || 1 };
}
// Área en MUNDO de un polígono normalizado con el MISMO marco (bbox) que el
// contorno exterior. Esto reproduce fielmente lo que hace extrudeSinglePolygon:
// contorno y agujeros comparten el bbox del contorno, por lo que el contorno
// pasa a ocupar [-1,1]^2 y los agujeros se escalan en consonancia.
function worldArea(poly, box) {
  const mapped = poly.map((q) => ({
    x: 2 * ((q.x - box.minX) / box.w) - 1,
    y: 1 - 2 * ((q.y - box.minY) / box.h),
  }));
  return Math.abs(shoelace(mapped));
}
function isClosedManifold(mesh) {
  const counts = new Map();
  const add = (a, b) => {
    const key = a < b ? a + ',' + b : b + ',' + a;
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  for (const f of mesh.faces) {
    for (let i = 0; i < f.length; i++) add(f[i], f[(i + 1) % f.length]);
  }
  let bad = 0;
  for (const c of counts.values()) if (c !== 2) bad++;
  return { ok: bad === 0, bad, edges: counts.size };
}
function meshVolume(mesh) {
  const v = mesh.vertices;
  let vol = 0;
  for (const f of mesh.faces) {
    for (let i = 1; i + 1 < f.length; i++) {
      const a = v[f[0]];
      const b = v[f[i]];
      const c = v[f[i + 1]];
      vol +=
        (a.x * (b.y * c.z - b.z * c.y) -
          a.y * (b.x * c.z - b.z * c.x) +
          a.z * (b.x * c.y - b.y * c.x)) /
        6;
    }
  }
  return Math.abs(vol);
}
function finiteMesh(mesh) {
  return (
    mesh.vertices.every((q) => [q.x, q.y, q.z].every(Number.isFinite)) &&
    mesh.faces.every((f) => f.every((i) => i >= 0 && i < mesh.vertices.length))
  );
}
// Normal (Newell) de una cara como polígono de vértices.
function faceNormal(ids, v) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < ids.length; i++) {
    const a = v[ids[i]];
    const b = v[ids[(i + 1) % ids.length]];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  const n = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / n, y: ny / n, z: nz / n };
}

// ===========================================================================
section('1) Código fuente');
{
  const geo = read('lib/geometry.ts');
  ok('geometry define Hole/HoleSpec', /export type Hole = \{ polygon: Polygon; depth\?: number \};/.test(geo) && /export type HoleSpec = Polygon \| Hole;/.test(geo));
  ok('geometry define holePolygon/holeDepth', geo.includes('export function holePolygon') && geo.includes('export function holeDepth'));

  const vm = read('lib/views-mesh.ts');
  ok('extrudeSinglePolygon admite HoleSpec[]', /holes: HoleSpec\[\] = \[\]/.test(vm));
  ok('extrusión simple soporta calado ciego (fondo)', vm.includes('// CALADO-CIEGO-EXTRUDE') && vm.includes('blindFloor'));
  ok('buildExtrudeMeshes usa HoleSpec[]', vm.includes('subtractHoles: HoleSpec[] = []'));

  const sm = read('lib/sweep-mesh.ts');
  ok('SweepOptions.holes es HoleSpec[]', /holes\?:\s*HoleSpec\[\]/.test(sm));
  ok('recorrido calcula el fondo de cada calado ciego', sm.includes('const holeEndIdx: number[] = [];'));
  ok('tapa final del recorrido filtra los pasantes', sm.includes('const throughEndHoles: number[][] = [];'));

  const ed = read('components/editor/Editor3D.tsx');
  ok('Editor3D guarda extrudeHoleDepths', ed.includes('const [extrudeHoleDepths, setExtrudeHoleDepths] = useState<Record<string, number>>({});'));
  ok('Editor3D pasa la profundidad de cada calado', (ed.match(/depth: extrudeHoleDepths\[line\.id\] \?\? 0/g) || []).length === 2);
  ok('Editor3D tiene UI de calados', ed.includes('CALADO-MULTI-CIEGO'));

  const tr = read('lib/i18n/translations.ts');
  ok('i18n tiene holeDepthLabel/holeThrough/holeBlind', tr.includes('holeDepthLabel') && tr.includes('holeThrough') && tr.includes('holeBlind'));
}

// ===========================================================================
section('2) Extrusión simple: referencia sin agujero');
const front = square(0.5, 0.5, 0.3);
const DEPTH = 0.5;
// El contorno se normaliza a su bbox -> ocupa [-1,1]^2 (área 4). Los agujeros
// deben usar el MISMO bbox; de ahí worldArea(poly, BOX).
const BOX = worldBox(front);
const AREA_FRONT = worldArea(front, BOX); // 4
const V0 = AREA_FRONT * DEPTH;            // 2
const noHole = buildExtrudeMeshes([front], DEPTH, []);
{
  ok('malla válida', finiteMesh(noHole));
  ok('2-manifold cerrado', isClosedManifold(noHole).ok);
  ok('volumen = área × profundidad (' + AREA_FRONT + '×' + DEPTH + '=' + V0 + ')', Math.abs(meshVolume(noHole) - V0) < 1e-6);
}

// ===========================================================================
section('3) Extrusión simple: calado PASANTE (regresión)');
const holeThru = square(0.5, 0.5, 0.1);
{
  const m = buildExtrudeMeshes([front], DEPTH, [{ polygon: holeThru, depth: 0 }]);
  ok('malla válida', finiteMesh(m));
  ok('2-manifold cerrado', isClosedManifold(m).ok);
  const v = meshVolume(m);
  const removed = worldArea(holeThru, BOX) * DEPTH;
  ok('quita material', v < V0 - 1e-6);
  ok('merma = vol. agujero (~' + removed.toFixed(3) + ')', Math.abs(V0 - v - removed) < 1e-3);
}

// ===========================================================================
section('4) Extrusión simple: calado CIEGO');
const BLIND = 0.2;
const holeBlind = square(0.5, 0.5, 0.1);
{
  const m = buildExtrudeMeshes([front], DEPTH, [{ polygon: holeBlind, depth: BLIND }]);
  ok('malla válida', finiteMesh(m));
  ok('2-manifold cerrado (con fondo)', isClosedManifold(m).ok);
  const v = meshVolume(m);
  const removedBlind = worldArea(holeBlind, BOX) * BLIND;
  const removedThru = worldArea(holeBlind, BOX) * DEPTH;
  ok('merma = área × profundidad_ciega (~' + removedBlind.toFixed(3) + ')', Math.abs(v - (V0 - removedBlind)) < 1e-3);
  ok('quita MENOS que el pasante', v > V0 - removedThru + 1e-6);

  // El suelo (z = -BLIND) debe mirar hacia +Z (abertura del bolsillo).
  let floorFaces = 0;
  let floorUp = 0;
  for (const f of m.faces) {
    const zs = f.map((i) => m.vertices[i].z);
    if (!zs.every((z) => Math.abs(z + BLIND) < 1e-6)) continue;
    const nz = faceNormal(f, m.vertices).z;
    if (Math.abs(nz) < 0.5) continue; // ignora degeneradas (puntos colineales)
    floorFaces++;
    if (nz > 0) floorUp++;
  }
  ok('existe el suelo del bolsillo', floorFaces > 0);
  ok('el suelo mira hacia +Z', floorFaces > 0 && floorUp === floorFaces);
}

// ===========================================================================
section('5) Extrusión simple: VARIOS calados (uno pasante + uno ciego)');
{
  const h1 = { polygon: square(0.35, 0.5, 0.06), depth: 0 };
  const h2 = { polygon: square(0.65, 0.5, 0.06), depth: 0.25 };
  const m = buildExtrudeMeshes([front], DEPTH, [h1, h2]);
  ok('malla válida', finiteMesh(m));
  ok('2-manifold cerrado', isClosedManifold(m).ok);
  const ra = worldArea(h1.polygon, BOX);
  const rb = worldArea(h2.polygon, BOX);
  const expected = V0 - ra * DEPTH - rb * 0.25;
  ok('merma = pasante(área×depth) + ciego(área×0.25)', Math.abs(meshVolume(m) - expected) < 2e-3);
}

// ===========================================================================
section('6) Recorrido: referencia sin agujero');
const profile = square(0.5, 0.5, 0.25);
const sweepNodes = [
  { id: 1, x: 0.2, y: 0.5, tilt: 0, polygon: profile },
  { id: 2, x: 0.8, y: 0.5, tilt: 0, polygon: profile },
];
const sNoHole = buildSweepMesh(sweepNodes, { subdivisions: 8 });
{
  ok('malla válida', finiteMesh(sNoHole));
  ok('2-manifold cerrado', isClosedManifold(sNoHole).ok);
  ok('volumen > 0', meshVolume(sNoHole) > 0);
}

// ===========================================================================
section('7) Recorrido: calado PASANTE (regresión)');
const sHole = square(0.5, 0.5, 0.1);
const sThru = buildSweepMesh(sweepNodes, { subdivisions: 8, holes: [{ polygon: sHole, depth: 0 }] });
{
  ok('malla válida', finiteMesh(sThru));
  ok('2-manifold cerrado', isClosedManifold(sThru).ok);
  const UNIT = 2;
  const length = Math.hypot((0.8 - 0.2) * UNIT, 0); // 1.2
  const expectedHole = shoelace(sHole) * UNIT * UNIT * length; // 0.04*4*1.2
  const diff = meshVolume(sNoHole) - meshVolume(sThru);
  ok('merma = vol. agujero pasante (~' + expectedHole.toFixed(3) + ')', Math.abs(diff - expectedHole) < expectedHole * 0.05);
}

// ===========================================================================
section('8) Recorrido: calado CIEGO');
{
  // profundidad 0.3 < longitud 1.2 -> bolsillo desde el inicio.
  const sBlind = buildSweepMesh(sweepNodes, { subdivisions: 8, holes: [{ polygon: sHole, depth: 0.3 }] });
  ok('malla válida', finiteMesh(sBlind));
  ok('2-manifold cerrado (con fondo)', isClosedManifold(sBlind).ok);

  const vNo = meshVolume(sNoHole);
  const vBlind = meshVolume(sBlind);
  const vThru = meshVolume(sThru);
  ok('quita material', vBlind < vNo - 1e-6);
  ok('ciego quita MENOS que pasante', vBlind > vThru + 1e-6);

  // Longitud socavada: muestras cada 1.2/8 = 0.15; 0.3 = 2 tramos.
  const expected = shoelace(sHole) * 4 * 0.3;
  ok('merma = área × 0.3 (~' + expected.toFixed(3) + ')', Math.abs(vNo - vBlind - expected) < expected * 0.1);
}

// ===========================================================================
section('9) Recorrido: VARIOS calados y recorrido cerrado');
{
  const many = buildSweepMesh(sweepNodes, {
    subdivisions: 8,
    holes: [
      { polygon: square(0.5, 0.35, 0.07), depth: 0 },
      { polygon: square(0.5, 0.65, 0.07), depth: 0.4 },
    ],
  });
  ok('varios calados: malla válida', finiteMesh(many));
  ok('varios calados: 2-manifold cerrado', isClosedManifold(many).ok);
  ok('varios calados: quita material', meshVolume(many) < meshVolume(sNoHole));

  const loop = buildSweepMesh(
    [
      { id: 1, x: 0.5, y: 0.25, tilt: 0, polygon: square(0.5, 0.5, 0.2) },
      { id: 2, x: 0.75, y: 0.5, tilt: 0, polygon: square(0.5, 0.5, 0.2) },
      { id: 3, x: 0.5, y: 0.75, tilt: 0, polygon: square(0.5, 0.5, 0.2) },
      { id: 4, x: 0.25, y: 0.5, tilt: 0, polygon: square(0.5, 0.5, 0.2) },
    ],
    { closed: true, subdivisions: 8, holes: [{ polygon: square(0.5, 0.5, 0.08), depth: 0.5 }] }
  );
  ok('recorrido cerrado + ciego (tratado como pasante): malla válida', finiteMesh(loop));
  ok('recorrido cerrado + ciego: 2-manifold cerrado', isClosedManifold(loop).ok);
}

console.log('\n----------------------------------------');
console.log('RESULTADO: ' + pass + ' ok, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
