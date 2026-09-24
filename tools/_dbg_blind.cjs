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
  return out
    .replace(/['"]@\/lib\/geometry['"]/g, "'./_geo.cjs'")
    .replace(/['"]\.\/geometry['"]/g, "'./_geo.cjs'");
}
fs.writeFileSync(path.join(__dirname, '_geo.cjs'), transpile('lib/geometry.ts'));
fs.writeFileSync(path.join(__dirname, '_views.cjs'), transpile('lib/views-mesh.ts'));

const { buildExtrudeMeshes } = require('./_views.cjs');
const sq = (cx, cy, r) => [
  { x: cx - r, y: cy - r },
  { x: cx + r, y: cy - r },
  { x: cx + r, y: cy + r },
  { x: cx - r, y: cy + r },
];
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
function signedVolume(mesh) {
  const v = mesh.vertices;
  let vol = 0;
  for (const f of mesh.faces) {
    for (let i = 1; i + 1 < f.length; i++) {
      const a = v[f[0]], b = v[f[i]], c = v[f[i + 1]];
      vol += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6;
    }
  }
  return vol;
}
const front = sq(0.5, 0.5, 0.3);
const BLIND = 0.2;
const m = buildExtrudeMeshes([front], 0.5, [{ polygon: sq(0.5, 0.5, 0.1), depth: BLIND }]);
console.log('signedVolume', signedVolume(m).toFixed(4), ' (positivo = caras hacia fuera)');

function summarize(label, pred) {
  let n = 0, up = 0;
  for (const f of m.faces) {
    if (!pred(f)) continue;
    n++;
    if (faceNormal(f, m.vertices).z > 0) up++;
  }
  console.log(label, 'caras', n, 'mirando +Z', up);
}
const zAll = (f, z) => f.every((i) => Math.abs(m.vertices[i].z - z) < 1e-6);
summarize('z=0 (tapa delantera):', (f) => zAll(f, 0));
summarize('z=-0.5 (tapa trasera):', (f) => zAll(f, -0.5));
summarize('z=-0.2 (suelo ciego):', (f) => zAll(f, -BLIND));
