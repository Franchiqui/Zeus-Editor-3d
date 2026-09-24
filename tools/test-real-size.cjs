#!/usr/bin/env node
/**
 * Tests de humo para "reducir las plantillas todo lo que se quiera" y
 * "ver el tamano REAL de la plantilla en el recorrido".
 *
 *  - drawing-canvas: el tope inferior de zoom ya no es 0.5 (ZOOM_MIN = 0.01).
 *  - drawing-canvas: la rejilla limita el numero de lineas al alejarse.
 *  - path-canvas: el radio "de canto" es el tamano real (profileRadius * 100),
 *    la misma proporcion que la malla barrida (UNIT*scale en ambos lados).
 *  - path-canvas: se puede reducir (alejar) el recorrido (ZOOM_MIN = 0.05).
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

const drawSrc = fs.readFileSync(path.join(root, 'components/drawing-canvas.tsx'), 'utf8');
const pathSrc = fs.readFileSync(path.join(root, 'components/editor/path-canvas.tsx'), 'utf8');

/* ---------------- Plantillas: reducir sin limite practico ---------------- */
console.log('Plantillas \u2014 reducir todo lo que se quiera:');
{
  ok('clampZoom usa ZOOM_MIN = 0.01', drawSrc.includes('const ZOOM_MIN = 0.01;'));
  ok('clampZoom ya no tiene el tope 0.5', !drawSrc.includes('Math.max(0.5, Math.min(8, z))'));
  ok('clampZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))',
    drawSrc.includes('Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))'));

  // Replica de la nueva matematica de clamp.
  const ZOOM_MIN = 0.01, ZOOM_MAX = 8;
  const clampZoom = (z) => clamp(z, ZOOM_MIN, ZOOM_MAX);
  ok('0.25 ya NO se recorta a 0.5 (antes si)', near(clampZoom(0.25), 0.25));
  ok('alejar todavia mas -> sigue en 0.01', near(clampZoom(0.001), 0.01));
  ok('acercar se limita a 8', near(clampZoom(100), 8));
  ok('dentro de rango pasa igual (2)', near(clampZoom(2), 2));

  // La rueda (factor 1/1.15) no cambia el clamp inferior.
  let z = 1;
  for (let i = 0; i < 40; i++) z = clampZoom(z * (1 / 1.15));
  ok('tras 40 muescas de rueda se alcanza el minimo', near(z, 0.01));
}

/* ---------------- Plantillas: rejilla acotada al alejarse ---------------- */
console.log('Plantillas \u2014 rejilla acotada:');
{
  ok('usa maxGrid', drawSrc.includes('const maxGrid = 90;'));
  ok('paso X', drawSrc.includes('const gStepX = Math.max(1, Math.ceil((gxEnd - gxStart) / maxGrid));'));
  ok('paso Y', drawSrc.includes('const gStepY = Math.max(1, Math.ceil((gyEnd - gyStart) / maxGrid));'));

  const resolution = 16, maxGrid = 90;
  function linesFor(zoom, pan = 0) {
    const span = 1 / zoom;
    const cMin = 0.5 - span / 2 + pan;
    const start = Math.floor(cMin * resolution);
    const end = Math.ceil((cMin + span) * resolution);
    const step = Math.max(1, Math.ceil((end - start) / maxGrid));
    let n = 0;
    for (let i = start; i <= end; i += step) n++;
    return n;
  }
  ok('zoom 100%: ~17 lineas', linesFor(1) <= 20);
  ok('zoom 1%: sigue acotada (<= 91)', linesFor(0.01) <= maxGrid + 1);
  ok('zoom 0.1% (forzado): acotada (<= 91)', linesFor(0.001) <= maxGrid + 1);
  ok('mucho pan + mucho zoom out: acotada', linesFor(0.01, 5) <= maxGrid + 1);
}

/* ---------------- Recorrido: tamano REAL de la plantilla ---------------- */
console.log('Recorrido \u2014 tamano real de la plantilla:');
{
  ok('radio real = profileRadius * 100', pathSrc.includes('const r = profileRadius(p.polygon) * 100;'));
  ok('ya no hay clamp 4..16', !pathSrc.includes('Math.min(16, profileRadius(p.polygon) * 60)'));

  // profileRadius replica.
  function profileRadius(polygon) {
    if (!polygon || polygon.length < 3) return 0.06;
    let cx = 0, cy = 0;
    for (const p of polygon) { cx += p.x; cy += p.y; }
    cx /= polygon.length; cy /= polygon.length;
    let r = 0;
    for (const p of polygon) r = Math.max(r, Math.hypot(p.x - cx, p.y - cy));
    return r || 0.06;
  }
  const UNIT = 2, scale = 1; // sweep-mesh.ts

  // La clave: en la malla barrida, el centro del nodo y los puntos de la
  // plantilla usan la MISMA escala (UNIT*scale). Por tanto, en el lienzo del
  // recorrido (0..1 -> 0..100), el radio real es profileRadius * 100.
  const square = [ { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.7, y: 0.7 }, { x: 0.3, y: 0.7 } ];
  const profiles = [
    square,
    [ { x: 0.45, y: 0.45 }, { x: 0.55, y: 0.45 }, { x: 0.55, y: 0.55 }, { x: 0.45, y: 0.55 } ],
    [ { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { x: 0.9, y: 0.6 }, { x: 0.1, y: 0.6 } ],
  ];
  for (const poly of profiles) {
    const R = profileRadius(poly);            // 0..1 (unidades del lienzo)
    const canvasR = R * 100;                  // radio "de canto" que se dibuja
    const worldR = R * UNIT * scale;          // radio real en el mundo (malla)
    // Fraccion respecto al tamano total: lienzo (0..100) vs mundo (0..UNIT*scale).
    const fracCanvas = canvasR / 100;
    const fracWorld = worldR / (UNIT * scale);
    ok(`R=${R.toFixed(3)}: la fraccion coincide (${fracCanvas.toFixed(3)})`, near(fracCanvas, fracWorld, 1e-9));
  }

  // El cuadrado por defecto (0.4 de lado) ya no se queda en 16: es ~28.3.
  const Rsq = profileRadius(square);
  ok('cuadrado por defecto: r = 28.28 (antes tope 16)', near(Rsq * 100, 28.284271, 1e-4));

  // Plantilla vacia/degenerada: marcador pequeno, no una losa enorme.
  ok('plantilla <3 puntos -> r = 6', near(profileRadius([{ x: 0.5, y: 0.5 }]) * 100, 6));
  ok('plantilla degenerada (r=0) -> r = 6',
    near(profileRadius([{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }]) * 100, 6));
}

/* ---------------- Recorrido: poder reducir (alejar) ---------------- */
console.log('Recorrido \u2014 poder reducir (alejar):');
{
  ok('define ZOOM_MIN = 0.05', pathSrc.includes('const ZOOM_MIN = 0.05;'));
  ok('clamp usa ZOOM_MIN/ZOOM_MAX', pathSrc.includes('Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * factor))'));
  ok('boton alejar: disabled={zoom <= ZOOM_MIN}', pathSrc.includes('disabled={zoom <= ZOOM_MIN}'));
  ok('boton acercar: disabled={zoom >= ZOOM_MAX}', pathSrc.includes('disabled={zoom >= ZOOM_MAX}'));

  const ZMIN = 0.05, ZMAX = 8;
  let z = 1;
  for (let i = 0; i < 60; i++) z = clamp(z * (1 / 1.15), ZMIN, ZMAX);
  ok('se puede alejar hasta 0.05', near(z, 0.05));

  // A zoom minimo el contenido 0..100 (centrado) sigue dentro de la vista.
  const leftEdge = (0 - 50) * ZMIN + 50;
  const rightEdge = (100 - 50) * ZMIN + 50;
  ok('el contenido 0..100 entra en la vista a zoom minimo', leftEdge >= 0 && rightEdge <= 100);
}

console.log(`\n${pass} OK, ${fail} fall\u00f3.`);
process.exit(fail === 0 ? 0 : 1);
