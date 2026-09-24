'use strict';
// Réplica de la geometría "de canto" de path-canvas.tsx para verificarla.
function nodeFrames(points, closed) {
  const n = points.length;
  if (n === 0) return [];
  const at = (i) => (closed ? points[((i % n) + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
  return points.map((_, i) => {
    const a = at(i - 1);
    const b = at(i + 1);
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) { dx = 1; dy = 0; }
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    return { perp: { x: dy, y: -dx } };
  });
}
function profileRadius(poly) {
  if (!poly || poly.length < 3) return 0.06;
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  cx /= poly.length; cy /= poly.length;
  let r = 0;
  for (const p of poly) r = Math.max(r, Math.hypot(p.x - cx, p.y - cy));
  return r || 0.06;
}

function slab(p, frame) {
  const tiltDeg = p.tilt ?? 0;
  const tilt = (tiltDeg * Math.PI) / 180;
  const cos = Math.cos(tilt), sin = Math.sin(tilt);
  const bx = frame.perp.x * cos - frame.perp.y * sin;
  const by = frame.perp.x * sin + frame.perp.y * cos;
  // Tamano REAL de la plantilla (misma escala que la malla barrida).
  const r = profileRadius(p.polygon) * 100;
  const cx = p.x * 100, cy = p.y * 100;
  const ex = bx * r, ey = by * r;
  return { cx, cy, ex, ey, r, bx, by };
}

let fails = 0;
function check(name, cond) {
  console.log(`${cond ? 'OK  ' : 'FAIL'}  ${name}`);
  if (!cond) fails++;
}

// Caso 1: dos puntos horizontales -> perp vertical (0,-1). Tilt 0 => slab vertical.
{
  const pts = [{ id: 1, x: 0.2, y: 0.5, tilt: 0 }, { id: 2, x: 0.8, y: 0.5, tilt: 0 }];
  const fr = nodeFrames(pts, false);
  const s0 = slab(pts[0], fr[0]);
  check('recto: perp horizontal=0', Math.abs(fr[0].perp.x) < 1e-6);
  check('recto: perp vertical (signo)', Math.abs(Math.abs(fr[0].perp.y) - 1) < 1e-6);
  check('recto: extremos finitos', Number.isFinite(s0.cx + s0.cy + s0.ex + s0.ey));
  check('recto: tilt 0 => slab a lo largo de perp (ex~0)', Math.abs(s0.ex) < 1e-6);
  check('recto: tilt 0 => slab con longitud vertical', Math.abs(s0.ey) > 1);
}

// Caso 2: tilt 90° gira el slab a lo largo del segmento (horizontal).
{
  const pts = [{ id: 1, x: 0.2, y: 0.5, tilt: 90 }, { id: 2, x: 0.8, y: 0.5, tilt: 90 }];
  const fr = nodeFrames(pts, false);
  const s0 = slab(pts[0], fr[0]);
  check('tilt 90: slab horizontal (ey~0)', Math.abs(s0.ey) < 1e-6);
  check('tilt 90: slab con longitud horizontal (ex>1)', Math.abs(s0.ex) > 1);
}

// Caso 3: recorrido cerrado con varios vértices -> sin NaN.
{
  const pts = [
    { id: 1, x: 0.2, y: 0.2, tilt: 15 },
    { id: 2, x: 0.8, y: 0.3, tilt: -20 },
    { id: 3, x: 0.5, y: 0.8, tilt: 40, polygon: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.2 }, { x: 0.5, y: 0.9 }] },
  ];
  const fr = nodeFrames(pts, true);
  let ok = true;
  for (let i = 0; i < pts.length; i++) {
    const s = slab(pts[i], fr[i]);
    if (![s.cx, s.cy, s.ex, s.ey, s.r].every(Number.isFinite)) ok = false;
  }
  check('cerrado: todos los valores finitos', ok);
}

// Caso 4: un solo punto -> perp por defecto.
{
  const pts = [{ id: 1, x: 0.5, y: 0.5, tilt: 0 }];
  const fr = nodeFrames(pts, false);
  check('un punto: perp definida', Number.isFinite(fr[0].perp.x) && Number.isFinite(fr[0].perp.y));
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
