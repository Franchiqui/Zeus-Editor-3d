const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
function transpile(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  let out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: rel,
  }).outputText;
  return out.replace(/['"]@\/lib\/geometry['"]/g, "'./_geo.cjs'").replace(/['"]\.\/geometry['"]/g, "'./_geo.cjs'");
}
fs.writeFileSync(path.join(__dirname, '_geo.cjs'), transpile('lib/geometry.ts'));
fs.writeFileSync(path.join(__dirname, '_views.cjs'), transpile('lib/views-mesh.ts'));
const { buildExtrudeMeshes } = require('./_views.cjs');
const sq = (cx, cy, r) => [
  { x: cx - r, y: cy - r }, { x: cx + r, y: cy - r },
  { x: cx + r, y: cy + r }, { x: cx - r, y: cy + r },
];
function faceArea3d(ids, v) {
  let a = 0;
  for (let i = 1; i + 1 < ids.length; i++) {
    const p = v[ids[0]], q = v[ids[i]], r = v[ids[i + 1]];
    const ux = q.x - p.x, uy = q.y - p.y, uz = q.z - p.z;
    const vx = r.x - p.x, vy = r.y - p.y, vz = r.z - p.z;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    a += 0.5 * Math.hypot(cx, cy, cz);
  }
  return a;
}
function zAll(m, f, z) { return f.every((i) => Math.abs(m.vertices[i].z - z) < 1e-6); }
const front = sq(0.5, 0.5, 0.3);
for (const [label, holes] of [
  ['no-hole', []],
  ['through', [{ polygon: sq(0.5, 0.5, 0.1), depth: 0 }]],
  ['blind', [{ polygon: sq(0.5, 0.5, 0.1), depth: 0.2 }]],
]) {
  const m = buildExtrudeMeshes([front], 0.5, holes);
  let z0Area = 0, zBackArea = 0, floorArea = 0;
  for (const f of m.faces) {
    const a = faceArea3d(f, m.vertices);
    if (zAll(m, f, 0)) z0Area += a;
    else if (zAll(m, f, -0.5)) zBackArea += a;
    else if (zAll(m, f, -0.2)) floorArea += a;
  }
  console.log(label.padEnd(8), 'frontCapArea(z=0)=', z0Area.toFixed(4), ' backCapArea=', zBackArea.toFixed(4), ' floorArea=', floorArea.toFixed(4));
}
// Tamaño del anillo interior a z=0
{
  const m = buildExtrudeMeshes([front], 0.5, [{ polygon: sq(0.5, 0.5, 0.1), depth: 0 }]);
  const s = new Set();
  for (const f of m.faces) if (zAll(m, f, 0)) for (const i of f) s.add(i);
  let mnx = 1e9, mxx = -1e9;
  for (const i of s) { mnx = Math.min(mnx, m.vertices[i].x); mxx = Math.max(mxx, m.vertices[i].x); }
  console.log('z=0 verts x range', mnx.toFixed(3), mxx.toFixed(3), ' unique verts', s.size);
}
