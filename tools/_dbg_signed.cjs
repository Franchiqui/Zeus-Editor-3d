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
function signedVolume(mesh) {
  const v = mesh.vertices; let vol = 0;
  for (const f of mesh.faces) for (let i = 1; i + 1 < f.length; i++) {
    const a = v[f[0]], b = v[f[i]], c = v[f[i + 1]];
    vol += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6;
  }
  return vol;
}
const front = sq(0.5, 0.5, 0.3);
console.log('no-hole   signed', signedVolume(buildExtrudeMeshes([front], 0.5, [])).toFixed(4));
console.log('through   signed', signedVolume(buildExtrudeMeshes([front], 0.5, [{ polygon: sq(0.5, 0.5, 0.1), depth: 0 }])).toFixed(4));
console.log('blind     signed', signedVolume(buildExtrudeMeshes([front], 0.5, [{ polygon: sq(0.5, 0.5, 0.1), depth: 0.2 }])).toFixed(4));
