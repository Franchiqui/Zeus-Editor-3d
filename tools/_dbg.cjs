const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
function transpile(file) {
  const src = read(file);
  let out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: file,
  }).outputText;
  out = out.replace(/['"]@\/lib\/geometry['"]/g, "'./_geo.cjs'").replace(/['"]\.\/geometry['"]/g, "'./_geo.cjs'");
  return out;
}
fs.writeFileSync(path.join(__dirname, '_geo.cjs'), transpile('lib/geometry.ts'));
const geo = require('./_geo.cjs');
const { flattenPolygon, normalizePolygon } = geo;
function square(cx, cy, r) {
  return [{ x: cx - r, y: cy - r }, { x: cx + r, y: cy - r }, { x: cx + r, y: cy + r }, { x: cx - r, y: cy + r }];
}
const f = flattenPolygon(normalizePolygon(square(0.5, 0.5, 0.3)), 24);
console.log('flattened len', f.length);
let xs = f.map((p) => p.x), ys = f.map((p) => p.y);
console.log('x range', Math.min(...xs), Math.max(...xs), 'y range', Math.min(...ys), Math.max(...ys));
let s = 0;
for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length]; s += a.x * b.y - b.x * a.y; }
console.log('shoelace area', Math.abs(s / 2));
console.log('world area *4 =', Math.abs(s / 2) * 4);
