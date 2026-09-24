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
function newell(ids, v) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < ids.length; i++) {
    const a = v[ids[i]], b = v[ids[(i + 1) % ids.length]];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  const n = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / n, y: ny / n, z: nz / n };
}
const front = sq(0.5, 0.5, 0.3);
const m = buildExtrudeMeshes([front], 0.5, [{ polygon: sq(0.5, 0.5, 0.1), depth: 0 }]);
let outerOut = 0, outerIn = 0, holeOut = 0, holeIn = 0, capUp = 0, capDown = 0;
const R = 0.5; // radio aprox del contorno exterior (lado 2 -> esquina 1.41): distinguir muros por radio medio
for (const f of m.faces) {
  const zs = f.map((i) => m.vertices[i].z);
  const zmin = Math.min(...zs), zmax = Math.max(...zs);
  const n = newell(f, m.vertices);
  if (Math.abs(zmin - zmax) < 1e-6) {
    if (n.z > 0) capUp++; else capDown++;
    continue;
  }
  // muro: radio medio del poligono
  let r = 0;
  for (const i of f) r = Math.max(r, Math.hypot(m.vertices[i].x, m.vertices[i].y));
  const inner = r < 0.6;
  // normal radial: hacia fuera si x*nx+y*ny>0 (aprox, centro en origen)
  let dot = 0;
  for (const i of f) { const q = m.vertices[i]; dot += q.x * n.x + q.y * n.y; }
  const outward = dot > 0;
  if (inner) { if (outward) holeOut++; else holeIn++; }
  else { if (outward) outerOut++; else outerIn++; }
}
console.log('tapas mirando +Z', capUp, ' -Z', capDown);
console.log('muros EXTERIORES hacia fuera', outerOut, ' hacia dentro', outerIn);
console.log('muros del AGUJERO hacia fuera', holeOut, ' hacia dentro (correcto)', holeIn);
