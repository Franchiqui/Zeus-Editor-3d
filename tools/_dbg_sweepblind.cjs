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
function meshVolume(mesh) {
  const v = mesh.vertices; let vol = 0;
  for (const f of mesh.faces) for (let i = 1; i + 1 < f.length; i++) {
    const a = v[f[0]], b = v[f[i]], c = v[f[i + 1]];
    vol += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6;
  }
  return Math.abs(vol);
}
const profile = sq(0.5, 0.5, 0.25);
const nodes = [
  { id: 1, x: 0.2, y: 0.5, tilt: 0, polygon: profile },
  { id: 2, x: 0.8, y: 0.5, tilt: 0, polygon: profile },
];
const sHole = sq(0.5, 0.5, 0.1);
const no = buildSweepMesh(nodes, { subdivisions: 8 });
const thru = buildSweepMesh(nodes, { subdivisions: 8, holes: [{ polygon: sHole, depth: 0 }] });
for (const d of [0.15, 0.3, 0.45, 0.6]) {
  const b = buildSweepMesh(nodes, { subdivisions: 8, holes: [{ polygon: sHole, depth: d }] });
  console.log('depth', d, 'merma', (meshVolume(no) - meshVolume(b)).toFixed(4), ' teoricos', (0.16 * d).toFixed(4));
}
console.log('through merma', (meshVolume(no) - meshVolume(thru)).toFixed(4));
