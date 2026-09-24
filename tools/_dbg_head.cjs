const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const root = path.resolve(__dirname, '..');
fs.writeFileSync(path.join(__dirname, '_geo.cjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'lib/geometry.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: 'lib/geometry.ts',
}).outputText);
function transpileText(text, file) {
  return ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file,
  }).outputText.replace(/['"]@\/lib\/geometry['"]/g, "'./_geo.cjs'").replace(/['"]\.\/geometry['"]/g, "'./_geo.cjs'");
}
const headSrc = execSync('git show HEAD:lib/views-mesh.ts', { encoding: 'utf8' });
fs.writeFileSync(path.join(__dirname, '_views_head.cjs'), transpileText(headSrc, 'lib/views-mesh.ts'));
const { buildExtrudeMesh } = require('./_views_head.cjs');
function signedVolume(mesh) {
  const v = mesh.vertices; let vol = 0;
  for (const f of mesh.faces || []) for (let i = 1; i + 1 < f.length; i++) {
    const a = v[f[0]], b = v[f[i]], c = v[f[i + 1]];
    vol += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6;
  }
  return vol;
}
const sq = (cx, cy, r) => [
  { x: cx - r, y: cy - r }, { x: cx + r, y: cy - r }, { x: cx + r, y: cy + r }, { x: cx - r, y: cy + r },
];
const m = buildExtrudeMesh({ front: sq(0.5, 0.5, 0.3), side: [], top: [] }, 0.5);
console.log('HEAD extrude no-hole signed', signedVolume(m).toFixed(4));
