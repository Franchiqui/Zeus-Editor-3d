const ts = require('typescript');
const fs = require('fs');

function transpile(file, stripImport) {
  const src = fs.readFileSync(file, 'utf8');
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

fs.writeFileSync('tools/_geo.cjs', transpile('lib/geometry.ts'));
fs.writeFileSync('tools/_sweep.cjs', transpile('lib/sweep-mesh.ts', true));

const { buildSweepMesh } = require('./_sweep.cjs');

function square(cx, cy, r) {
  return [
    { x: cx - r, y: cy - r },
    { x: cx + r, y: cy - r },
    { x: cx + r, y: cy + r },
    { x: cx - r, y: cy + r },
  ];
}
function hexagon(cx, cy, r) {
  const p = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 * i) / 6;
    p.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return p;
}
function circle(cx, cy, r, n) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n;
    p.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return p;
}

function stats(mesh, label) {
  const v = mesh.vertices;
  const f = mesh.faces;
  let finite = true;
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const q of v) {
    if (![q.x, q.y, q.z].every(Number.isFinite)) finite = false;
    min = [Math.min(min[0], q.x), Math.min(min[1], q.y), Math.min(min[2], q.z)];
    max = [Math.max(max[0], q.x), Math.max(max[1], q.y), Math.max(max[2], q.z)];
  }
  const badIdx = f.some((face) => face.some((i) => i < 0 || i >= v.length));
  const tris = f.filter((x) => x.length === 3).length;
  const quads = f.filter((x) => x.length === 4).length;
  console.log(
    `${label}: verts=${v.length} faces=${f.length} (quads=${quads}, tris=${tris}) ` +
      `finite=${finite} idxOK=${!badIdx} bbox=[${min.map((n) => n.toFixed(2))}]..[${max
        .map((n) => n.toFixed(2))}]`
  );
  if (!finite || badIdx) throw new Error(label + ' inválido');
}

// 1) Segmento recto con perfil constante (equivale a una extrusión)
stats(
  buildSweepMesh(
    [
      { id: 1, x: 0.2, y: 0.5, tilt: 0, polygon: square(0.5, 0.5, 0.25) },
      { id: 2, x: 0.8, y: 0.5, tilt: 0, polygon: square(0.5, 0.5, 0.25) },
    ],
    { subdivisions: 8 }
  ),
  '1 recto/cuadrado'
);

// 2) Deformación: cuadrado -> hexágono (recuento de vértices distinto)
stats(
  buildSweepMesh(
    [
      { id: 1, x: 0.5, y: 0.2, tilt: 0, polygon: square(0.5, 0.5, 0.28) },
      { id: 2, x: 0.5, y: 0.5, tilt: 0, polygon: hexagon(0.5, 0.5, 0.28) },
      { id: 3, x: 0.75, y: 0.8, tilt: 0, polygon: circle(0.5, 0.5, 0.28, 12) },
    ],
    { subdivisions: 12 }
  ),
  '2 morf cuadrado-hex-círculo (curva)'
);

// 3) Inclinación
stats(
  buildSweepMesh(
    [
      { id: 1, x: 0.3, y: 0.5, tilt: 0, polygon: square(0.5, 0.5, 0.24) },
      { id: 2, x: 0.7, y: 0.5, tilt: 40, polygon: square(0.5, 0.5, 0.24) },
    ],
    { subdivisions: 8 }
  ),
  '3 inclinación 0->40°'
);

// 4) Recorrido cerrado (sin tapas)
stats(
  buildSweepMesh(
    [
      { id: 1, x: 0.5, y: 0.25, tilt: 0, polygon: circle(0.5, 0.5, 0.2, 10) },
      { id: 2, x: 0.75, y: 0.5, tilt: 0, polygon: circle(0.5, 0.5, 0.2, 10) },
      { id: 3, x: 0.5, y: 0.75, tilt: 0, polygon: circle(0.5, 0.5, 0.2, 10) },
      { id: 4, x: 0.25, y: 0.5, tilt: 0, polygon: circle(0.5, 0.5, 0.2, 10) },
    ],
    { closed: true, subdivisions: 8 }
  ),
  '4 recorrido cerrado'
);

// 5) Casos límite
const e0 = buildSweepMesh([], {});
const e1 = buildSweepMesh([{ id: 1, x: 0.5, y: 0.5, tilt: 0, polygon: square(0.5, 0.5, 0.2) }], {});
console.log('5 límites: vacío verts=' + e0.vertices.length + ', uno solo verts=' + e1.vertices.length);

console.log('TODO OK');
