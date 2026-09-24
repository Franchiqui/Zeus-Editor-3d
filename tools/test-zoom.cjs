#!/usr/bin/env node
/**
 * Tests de humo para los cambios de zoom + subdivisiones.
 *  - La matemática del zoom mantiene el punto bajo el cursor fijo.
 *  - El zoom por botones mantiene el centro fijo.
 *  - clampPan permite alcanzar todo el contenido.
 *  - drawing-canvas: el viewBox cubre exactamente el área visible.
 *  - Editor3D: subdivisiones por defecto = 5.
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name); }
}
function near(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------------- PathCanvas: zoom con la rueda ---------------- */
console.log('PathCanvas \u2014 zoom con la rueda (cursor fijo):');
{
  const ZMIN = 0.05, ZMAX = 8;
  const clampPan = (v, z) => clamp(v, -(50 * z + 50), 50 * z + 50);
  function wheel(zoom, pan, pv, dir) {
    const factor = dir < 0 ? 1.15 : 1 / 1.15;
    const nz = clamp(zoom * factor, ZMIN, ZMAX);
    const cx = (pv - 50 - pan) / zoom + 50;
    return { nz, npan: clampPan(pv - 50 - (cx - 50) * nz, nz), cx };
  }
  for (const pv of [10, 25, 50, 73, 90]) {
    for (const zoom of [1, 1.5, 3, 6]) {
      const { nz, npan, cx } = wheel(zoom, 0, pv, -1);
      const d = (cx - 50) * nz + 50 + npan; // posición del contenido tras el zoom
      ok(`pv=${pv} zoom=${zoom}\u2192${nz.toFixed(2)}: punto bajo el cursor fijo`, near(d, pv, 1e-6));
    }
  }
  // El contenido nunca se pierde: cada punto 0..100 es alcanzable con algún pan.
  const z = 4;
  const panMin = -(50 * z + 50), panMax = 50 * z + 50;
  const reach0 = (0 - 50) * z + 50 + panMax;   // borde izq. con pan máx
  const reach100 = (100 - 50) * z + 50 + panMin; // borde der. con pan mín
  ok('clampPan: el borde 0 es alcanzable', reach0 >= 0);
  ok('clampPan: el borde 100 es alcanzable', reach100 <= 100);
}

/* ---------------- PathCanvas: zoom por botones (centro fijo) -------- */
console.log('PathCanvas \u2014 zoom por botones (centro fijo):');
{
  const clampPan = (v, z) => clamp(v, -(50 * z + 50), 50 * z + 50);
  function step(zoom, pan, factor) {
    const nz = clamp(zoom * factor, 0.05, 8);
    const k = nz / zoom;
    return { nz, npan: clampPan(pan * k, nz) };
  }
  for (const pan of [0, 20, -15]) {
    for (const zoom of [1, 2, 4]) {
      const { nz, npan } = step(zoom, pan, 1.25);
      const cBefore = -pan / zoom + 50;
      const cAfter = -npan / nz + 50;
      ok(`pan=${pan} zoom=${zoom}: el centro no se mueve`, near(cBefore, cAfter, 1e-6));
    }
  }
}

/* ---------------- DrawingCanvas: viewBox = área visible --------- */
console.log('DrawingCanvas \u2014 viewBox cubre el área visible:');
{
  function view(zoom, pan, off = 0) {
    const span = 1 / zoom;
    const cMin = 0.5 - span / 2 + off + pan;
    return { min: cMin, max: cMin + span, span };
  }
  const v = view(2, 0.1, 0.05);
  ok('min < max', v.min < v.max);
  ok('span = 1/zoom', near(v.span, 0.5));
  // La rueda mantiene el punto bajo el cursor (fracción) fijo.
  function wheelD(zoom, pan, fx, off = 0) {
    const span = 1 / zoom;
    const cMin = 0.5 - span / 2 + off + pan;
    const c = fx * span + cMin;
    const nz = clamp(zoom * 1.15, 0.01, 8);
    const nspan = 1 / nz;
    const nbase = 0.5 - nspan / 2;
    const npan = c - fx * nspan - nbase - off;
    const ncMin = nbase + off + npan;
    return (c - ncMin) / nspan; // fracción del punto tras el zoom
  }
  for (const fx of [0.1, 0.5, 0.85]) {
    ok(`fx=${fx}: la fracción bajo el cursor no cambia`, near(wheelD(2, 0.05, fx, 0.03), fx, 1e-9));
  }
}

/* ---------------- Editor3D: subdivisiones por defecto = 5 -------- */
console.log('Editor3D \u2014 subdivisiones por defecto = 5:');
{
  const src = fs.readFileSync(path.join(root, 'components/editor/Editor3D.tsx'), 'utf8');
  ok('estado inicial useState(5)', src.includes('const [sweepSubdivisions, setSweepSubdivisions] = useState(5);'));
  ok('history: (a.sweepSubdivisions ?? 5)', src.includes('(a.sweepSubdivisions ?? 5) === (b.sweepSubdivisions ?? 5)'));
  ok('apply: setSweepSubdivisions(state.sweepSubdivisions ?? 5)', src.includes('setSweepSubdivisions(state.sweepSubdivisions ?? 5);'));
  ok('ya no queda el 10 por defecto', !src.includes('sweepSubdivisions ?? 10'));
}

console.log(`\n${pass} OK, ${fail} falló.`);
process.exit(fail === 0 ? 0 : 1);
