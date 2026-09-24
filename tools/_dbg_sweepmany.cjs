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
fs.writeFileSync(path.join(__dirname, '_sweep.cjs'), transpile('lib/sweep-mesh.ts'));
const { buildSweepMesh } = require('./_sweep.cjs');
const sq = (cx, cy, r) => [
  { x: cx - r, y: cy - r }, { x: cx + r, y: cy - r },
  { x: cx + r, y: cy + r }, { x: cx - r, y: cy + r },
];
function vol(mesh) {
  const v = mesh.vertices; let s = 0;
  for (const f of mesh.faces) for (let i = 1; i + 1 < f.length; i++) {
    const a = v[f[0]], b = v[f[i]], c = v[f[i + 1]];
    s += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6;
  }
  return Math.abs(s);
}
function manifold(mesh) {
  const map = new Map();
  for (const f of mesh.faces) for (let i = 0; i < f.length; i++) {
    const a = f[i], b = f[(i + 1) % f.length];
    const k = a < b ? a + '|' + b : b + '|' + a;
    map.set(k, (map.get(k) || 0) + 1);
  }
  let bad = 0;
  for (const c of map.values()) if (c !== 2) bad++;
  return bad === 0;
}
const profile = sq(0.5, 0.5, 0.25);
const nodes = [
  { id: 1, x: 0.2, y: 0.5, tilt: 0, polygon: profile },
  { id: 2, x: 0.8, y: 0.5, tilt: 0, polygon: profile },
];
const sHole = sq(0.5, 0.5, 0.1);
const base = vol(buildSweepMesh(nodes, { subdivisions: 5 }));
let fails = 0;
console.log('subdiv=5, area agujero=0.16');
for (let d = 0.05; d <= 1.15; d += 0.1) {
  const m = buildSweepMesh(nodes, { subdivisions: 5, holes: [{ polygon: sHole, depth: +d.toFixed(2) }] });
  const removed = base - vol(m);
  const exp = 0.16 * d;
  const okM = manifold(m);
  const okV = Math.abs(removed - exp) < 1e-3;
  if (!okM || !okV) fails++;
  console.log(' d=' + d.toFixed(2), 'manifold=' + okM, 'merma=' + removed.toFixed(4), 'esperado=' + exp.toFixed(4), okV ? 'OK' : 'FAIL');
}
console.log(fails === 0 ? 'TODOS OK' : ('FALLOS: ' + fails));
