/*
 * test-sweep-hole.cjs
 * -------------------
 * Verifica que el CALADO funcione también en el recorrido (extrusión con
 * "recorrido"), no solo en la extrusión simple:
 *
 *   - lib/sweep-mesh.ts acepta `options.holes` y barre los agujeros junto a la
 *     plantilla (paredes interiores + tapas con hueco).
 *   - Editor3D.tsx pasa los agujeros a buildSweepMesh cuando hay recorrido.
 *
 * Se comprueba a nivel de comportamiento con la malla real (transpilada):
 *   1) La malla barrida con agujero es un 2-manifold CERRADO (cada arista se
 *      comparte exactamente entre dos caras): esto solo se cumple si las tapas
 *      quedan bien trianguladas con el hueco y las paredes interiores cosen.
 *   2) El volumen con agujero es menor que sin agujero, y la diferencia
 *      equivale al volumen barrido del agujero (área × longitud).
 */
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function transpile(file, stripImport) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  let out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;
  if (stripImport) out = out.replace(/@\/lib\/geometry/g, './_geo.cjs');
  return out;
}

fs.writeFileSync(path.join(__dirname, '_geo.cjs'), transpile('lib/geometry.ts'));
fs.writeFileSync(
  path.join(__dirname, '_sweep.cjs'),
  transpile('lib/sweep-mesh.ts', true)
);

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

// ¿Es la malla un 2-manifold cerrado? (cada arista, exactamente 2 caras)
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

// Volumen con signo (teorema de la divergencia), caras ya orientadas al exterior.
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

// ---------------------------------------------------------------------------
section('1) Código fuente');
{
  const sweep = read('lib/sweep-mesh.ts');
  ok('SweepOptions incluye holes (HoleSpec)', /holes\?:\s*HoleSpec\[\]/.test(sweep));
  ok('buildSweepMesh usa ShapeUtils para las tapas con agujero', sweep.includes('ShapeUtils.triangulateShape'));
  ok('buildSweepMesh cose las paredes interiores (sign = -1)', sweep.includes('stitch(aIds, bIds, axis, -1)'));

  const ed = read('components/editor/Editor3D.tsx');
  ok('Editor3D pasa holes a buildSweepMesh', /buildSweepMesh\(sweepWithProfiles,\s*\{[\s\S]*?holes,/.test(ed));
  ok('recoge los ids de extrudeHoles en el recorrido', ed.includes('if (!extrudeHoles.includes(line.id)) continue;'));
}

// ---------------------------------------------------------------------------
section('2) Barrido recto SIN agujero: referencia');
const profile = square(0.5, 0.5, 0.25);
const noHole = buildSweepMesh(
  [
    { id: 1, x: 0.2, y: 0.5, tilt: 0, polygon: profile },
    { id: 2, x: 0.8, y: 0.5, tilt: 0, polygon: profile },
  ],
  { subdivisions: 8 }
);
{
  const m = isClosedManifold(noHole);
  ok('malla válida (finita, índices OK)', finiteMesh(noHole));
  ok('es un 2-manifold cerrado', m.ok);
  ok('tiene volumen > 0', meshVolume(noHole) > 0);
}

// ---------------------------------------------------------------------------
section('3) Barrido recto CON agujero: calado de lado a lado');
const hole = square(0.5, 0.5, 0.1);
const withHole = buildSweepMesh(
  [
    { id: 1, x: 0.2, y: 0.5, tilt: 0, polygon: profile },
    { id: 2, x: 0.8, y: 0.5, tilt: 0, polygon: profile },
  ],
  { subdivisions: 8, holes: [hole] }
);
{
  const m = isClosedManifold(withHole);
  ok('malla válida (finita, índices OK)', finiteMesh(withHole));
  ok('sigue siendo un 2-manifold cerrado (tapas con hueco)', m.ok);
  ok('tiene más vértices que sin agujero (anilla interior)', withHole.vertices.length > noHole.vertices.length);

  const v0 = meshVolume(noHole);
  const v1 = meshVolume(withHole);
  ok('el agujero quita material (V_conHueco < V_sinHueco)', v1 < v0 - 1e-6);

  // Volumen esperado del agujero = área(mundo) × longitud del recorrido.
  const UNIT = 2; // igual que sweep-mesh.ts
  const length = Math.hypot((0.8 - 0.2) * UNIT, 0); // nudos en y=0.5
  const expectedHole = shoelace(hole) * UNIT * UNIT * length; // 0.04*4*1.2 = 0.192
  const diff = v0 - v1;
  ok(
    'la merma equivale al volumen del agujero (~' + expectedHole.toFixed(3) + ')',
    Math.abs(diff - expectedHole) < expectedHole * 0.05
  );
}

// ---------------------------------------------------------------------------
section('4) Barrido en curva e inclinado con agujero');
{
  const curved = buildSweepMesh(
    [
      { id: 1, x: 0.5, y: 0.2, tilt: 0, polygon: square(0.5, 0.5, 0.28) },
      { id: 2, x: 0.5, y: 0.5, tilt: 20, polygon: square(0.5, 0.5, 0.28) },
      { id: 3, x: 0.75, y: 0.8, tilt: 0, polygon: square(0.5, 0.5, 0.28) },
    ],
    { subdivisions: 12, holes: [square(0.5, 0.5, 0.12)] }
  );
  ok('curva+tilt: malla válida', finiteMesh(curved));
  ok('curva+tilt: 2-manifold cerrado', isClosedManifold(curved).ok);
}

// ---------------------------------------------------------------------------
section('5) Recorrido cerrado con agujero');
{
  const loop = buildSweepMesh(
    [
      { id: 1, x: 0.5, y: 0.25, tilt: 0, polygon: square(0.5, 0.5, 0.2) },
      { id: 2, x: 0.75, y: 0.5, tilt: 0, polygon: square(0.5, 0.5, 0.2) },
      { id: 3, x: 0.5, y: 0.75, tilt: 0, polygon: square(0.5, 0.5, 0.2) },
      { id: 4, x: 0.25, y: 0.5, tilt: 0, polygon: square(0.5, 0.5, 0.2) },
    ],
    { closed: true, subdivisions: 8, holes: [square(0.5, 0.5, 0.08)] }
  );
  ok('recorrido cerrado con agujero: malla válida', finiteMesh(loop));
  ok('recorrido cerrado con agujero: 2-manifold cerrado', isClosedManifold(loop).ok);
}

// ---------------------------------------------------------------------------
section('6) Vuelta exterior para robustez (agujero grande)');
{
  const big = buildSweepMesh(
    [
      { id: 1, x: 0.2, y: 0.5, tilt: 0, polygon: square(0.5, 0.5, 0.3) },
      { id: 2, x: 0.8, y: 0.5, tilt: 0, polygon: square(0.5, 0.5, 0.3) },
    ],
    { subdivisions: 6, holes: [square(0.5, 0.5, 0.2)] }
  );
  ok('agujero grande: malla válida', finiteMesh(big));
  ok('agujero grande: 2-manifold cerrado', isClosedManifold(big).ok);
  ok('agujero grande: volumen menor que sin agujero', meshVolume(big) < meshVolume(noHole));
}

console.log('\n----------------------------------------');
console.log('RESULTADO: ' + pass + ' ok, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
