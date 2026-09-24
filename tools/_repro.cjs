const v = require('./_views.cjs');
const sq = (cx, cy, r) => [
  { x: cx - r, y: cy - r },
  { x: cx + r, y: cy - r },
  { x: cx + r, y: cy + r },
  { x: cx - r, y: cy + r },
];
const front = sq(0.5, 0.5, 0.3);
const hole = sq(0.5, 0.5, 0.1);
const m = v.buildExtrudeMeshes([front], 0.5, [{ polygon: hole, depth: 0 }]);
console.log('verts', m.vertices.length, 'faces', m.faces.length);
let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
for (const p of m.vertices) {
  mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x);
  mny = Math.min(mny, p.y); mxy = Math.max(mxy, p.y);
}
console.log('bbox x', mnx.toFixed(3), mxx.toFixed(3), 'y', mny.toFixed(3), mxy.toFixed(3));
// distribution of unique x values
const xs = [...new Set(m.vertices.map((p) => p.x.toFixed(4)))].sort();
console.log('unique x', xs.join(', '));
