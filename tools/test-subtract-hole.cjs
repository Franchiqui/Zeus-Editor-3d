/*
 * test-subtract-hole.cjs
 * ----------------------
 * Verifica el arreglo de "extrusión simple": dibujar una figura dentro del
 * contorno Frontal y pulsar "Sustraer" debe restarla como AGUJERO (pieza
 * hueca de lado a lado), aunque la figura NO repita el punto inicial (como
 * las que produce la herramienta Línea, que termina con doble clic).
 *
 * Se comprueba a dos niveles:
 *   1) Código fuente (que el arreglo sigue aplicado).
 *   2) Comportamiento replicado (polylineToPolygon + filtro del botón), y
 *      triangulación real con three.ShapeUtils para confirmar que el hueco
 *      se respeta (ningún triángulo cae dentro del agujero).
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) {
    pass++;
    console.log('  ok  ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name);
  }
}
function section(t) {
  console.log('\n== ' + t + ' ==');
}

// ---------------------------------------------------------------------------
// Comportamiento replicado (idéntico al código del proyecto)
// ---------------------------------------------------------------------------
function polylineToPolygon(line) {
  if (line.points.length < 3) return null;
  const first = line.points[0];
  const last = line.points[line.points.length - 1];
  const dist = Math.hypot(first.x - last.x, first.y - last.y);
  if (dist < 0.001) {
    const open = line.points.slice(0, -1);
    return open.length >= 3 ? open : null;
  }
  return line.points;
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const hit =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

// Filtro del botón "Sustraer" (tras el arreglo).
function drawnInsideForSubtract(frontPolylines, extrudeHoles, front) {
  return frontPolylines.filter((line) => {
    if (line.points.length < 3) return false;
    if (extrudeHoles.includes(line.id)) return false;
    const cx = line.points.reduce((s, p) => s + p.x, 0) / line.points.length;
    const cy = line.points.reduce((s, p) => s + p.y, 0) / line.points.length;
    return pointInPolygon({ x: cx, y: cy }, front);
  });
}

function shoelace(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// ---------------------------------------------------------------------------
section('1) Código fuente: lib/views-mesh.ts (polylineToPolygon auto-cierra)');
{
  const src = read('lib/views-mesh.ts');
  ok('contiene el auto-cierre (slice(0,-1) -> open)', src.includes('const open = polyline.points.slice(0, -1);'));
  ok('devuelve polyline.points cuando primero != último', /return polyline\.points;/.test(src));
  ok('exige >= 3 puntos en el caso cerrado', src.includes('return open.length >= 3 ? open : null;'));
  const block = src.slice(src.indexOf('export function polylineToPolygon'), src.indexOf('export function polylineToPolygon') + 700);
  ok('no queda un "return null;" final inalcanzable tras dist', !/\n  return null;\n\}/.test(block));
}

section('2) Código fuente: Editor3D.tsx (botón "Sustraer" sin cierre estricto)');
{
  const src = read('components/editor/Editor3D.tsx');
  ok('usa la variable drawnInside', src.includes('drawnInside'));
  ok('ya NO contiene el chequeo estricto primer==último (<1e-6)',
     !src.includes('line.points[0].x - line.points[line.points.length - 1].x'));
  ok('ya NO existe la variable closedInside', !src.includes('closedInside'));
  ok('sigue marcando los ids como agujeros', src.includes('extrudeHoles.includes(line.id)'));
  ok('sigue comprobando el centroide dentro del Frontal',
     src.includes('pointInPolygon({ x: cx, y: cy }, views.front)'));
  ok('el botón sigue usando el título "subtractDrawn"',
     src.includes("t('editor3D.subtractDrawn')"));
  ok('el mesh añade los ids en extrudeHoles a holes',
     /if \(extrudeHoles\.includes\(line\.id\)\) \{\s*\n\s*holes\.push\(\{ polygon: poly, depth: extrudeHoleDepths\[line\.id\] \?\? 0 \}\);/.test(src));
}

section('3) polylineToPolygon: figuras dibujadas a mano');
{
  const openSquare = {
    id: 'a',
    points: [{ x: 0.35, y: 0.35 }, { x: 0.45, y: 0.35 }, { x: 0.45, y: 0.45 }, { x: 0.35, y: 0.45 }],
  };
  const polyA = polylineToPolygon(openSquare);
  ok('cuadrado dibujado (4 pts, primero!=último) -> polígono', Array.isArray(polyA) && polyA.length === 4);

  const closedSquare = {
    id: 'b',
    points: [{ x: 0.35, y: 0.35 }, { x: 0.45, y: 0.35 }, { x: 0.45, y: 0.45 }, { x: 0.35, y: 0.45 }, { x: 0.35, y: 0.35 }],
  };
  const polyB = polylineToPolygon(closedSquare);
  ok('figura con primer==último (5 pts) -> 4 vértices (quita duplicado)', Array.isArray(polyB) && polyB.length === 4);

  const line2 = { id: 'c', points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }] };
  ok('línea de 2 puntos -> null (no es figura)', polylineToPolygon(line2) === null);

  const line3colineal = {
    id: 'd',
    points: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
  };
  ok('3 puntos idénticos (repetido) -> null', polylineToPolygon(line3colineal) === null);
}

section('4) Filtro del botón "Sustraer"');
{
  const front = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ];
  const inside = { id: 'in', points: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 }] };
  const outside = { id: 'out', points: [{ x: 0.9, y: 0.9 }, { x: 1.0, y: 0.9 }, { x: 1.0, y: 1.0 }, { x: 0.9, y: 1.0 }] };
  const openLine = { id: 'ln', points: [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 }] };

  const res = drawnInsideForSubtract([inside, outside, openLine], [], front);
  ok('detecta la figura de dentro (sin repetir el punto inicial)', res.length === 1 && res[0].id === 'in');
  ok('ignora la figura de fuera', !res.some((l) => l.id === 'out'));
  ok('ignora la línea de 2 puntos', !res.some((l) => l.id === 'ln'));

  const res2 = drawnInsideForSubtract([inside], ['in'], front);
  ok('no re-marca lo que ya es agujero', res2.length === 0);

  // Tras pulsar Sustraer: extrudeHoles incluye el id, y el build lo manda a holes.
  const extrudeHoles = res.map((l) => l.id);
  const shapes = [front];
  const holes = [];
  for (const line of [inside, outside, openLine]) {
    const poly = polylineToPolygon(line);
    if (!poly) continue;
    if (extrudeHoles.includes(line.id)) holes.push(poly);
    else shapes.push(poly);
  }
  ok('build: el agujero va a holes', holes.length === 1);
  ok('build: la figura de fuera se extruye como sólido', shapes.length === 2);
}

section('5) Triangulación real (three.ShapeUtils) respeta el agujero');
{
  let THREE = null;
  try {
    THREE = require('three');
  } catch (e) {
    console.log('  (aviso: three no disponible, se omite la triangulación)');
  }
  if (THREE) {
    const { ShapeUtils, Vector2 } = THREE;
    let front = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ];
    // Replica del winding del proyecto: exterior con shoelace>0; agujeros CW.
    if (shoelace(front) < 0) front = front.slice().reverse();
    let hole = [
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.4 },
      { x: 0.6, y: 0.6 },
      { x: 0.4, y: 0.6 },
    ];
    if (shoelace(hole) > 0) hole = hole.slice().reverse();

    const contour2d = front.map((q) => new Vector2(q.x, q.y));
    const holes2d = [hole.map((q) => new Vector2(q.x, q.y))];
    const tris = ShapeUtils.triangulateShape(contour2d, holes2d) || [];

    ok('triangulateShape devuelve triángulos', tris.length > 0);

    const all = [...front, ...hole];
    const inHole = (p) => p.x > 0.4001 && p.x < 0.5999 && p.y > 0.4001 && p.y < 0.5999;
    let trisInsideHole = 0;
    let usesHoleVertex = false;
    for (const t of tris) {
      const pts = t.map((i) => all[i]);
      if (t.some((i) => i >= front.length)) usesHoleVertex = true;
      const cx = (pts[0].x + pts[1].x + pts[2].x) / 3;
      const cy = (pts[0].y + pts[1].y + pts[2].y) / 3;
      if (inHole({ x: cx, y: cy })) trisInsideHole++;
    }
    ok('ningún triángulo cae dentro del agujero (hueco real)', trisInsideHole === 0);
    ok('se usan vértices del agujero (contorno interior)', usesHoleVertex);

    // Comparativa de ÁREA: el agujero quita material (0.6^2 - 0.2^2 = 0.32).
    const triArea = (t) => {
      const [a, b, c] = t.map((i) => all[i]);
      return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    };
    const areaWithHole = tris.reduce((s2, t) => s2 + triArea(t), 0);
    const noHole = ShapeUtils.triangulateShape(contour2d, []) || [];
    const areaNoHole = noHole.reduce((s2, t) => s2 + triArea(t), 0);
    ok('el área con agujero es menor que sin agujero', areaWithHole < areaNoHole - 1e-6);
    ok('el área con agujero equivale al material restante (~0.32)', Math.abs(areaWithHole - 0.32) < 1e-3);
  }
}

console.log('\n----------------------------------------');
console.log('RESULTADO: ' + pass + ' ok, ' + fail + ' fallos');
process.exit(fail === 0 ? 0 : 1);
