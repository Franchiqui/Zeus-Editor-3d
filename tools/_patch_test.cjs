const fs = require('fs');
const p = 'tools/test-calado-multiple-ciego.cjs';
let s = fs.readFileSync(p, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
const before = s;

// 1) Helpers de marco compartido (insertar tras shoelace).
const anchorShoelaceEnd = [
  '  return Math.abs(s / 2);',
  '}',
].join(nl);
const helpers = [
  '  return Math.abs(s / 2);',
  '}',
  '// Bounding box de un polígono en coordenadas lienzo.',
  'function worldBox(poly) {',
  '  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;',
  '  for (const q of poly) {',
  '    minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);',
  '    minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);',
  '  }',
  '  return { minX, minY, w: maxX - minX || 1, h: maxY - minY || 1 };',
  '}',
  '// Área en MUNDO de un polígono normalizado con el MISMO marco (bbox) que el',
  '// contorno exterior. Esto reproduce fielmente lo que hace extrudeSinglePolygon:',
  '// contorno y agujeros comparten el bbox del contorno, por lo que el contorno',
  '// pasa a ocupar [-1,1]^2 y los agujeros se escalan en consonancia.',
  'function worldArea(poly, box) {',
  '  const mapped = poly.map((q) => ({',
  '    x: 2 * ((q.x - box.minX) / box.w) - 1,',
  '    y: 1 - 2 * ((q.y - box.minY) / box.h),',
  '  }));',
  '  return Math.abs(shoelace(mapped));',
  '}',
].join(nl);
if (!s.includes('function worldArea(')) {
  s = s.replace(anchorShoelaceEnd, helpers);
}

// 2) Sección 2: referencia sin agujero (escala correcta).
const sec2Old = [
  "section('2) Extrusión simple: referencia sin agujero');",
  'const front = square(0.5, 0.5, 0.3);   // lado 0.6 lienzo -> 1.2 mundo, área 1.44',
  'const DEPTH = 0.5;',
  'const noHole = buildExtrudeMeshes([front], DEPTH, []);',
  '{',
  "  ok('malla válida', finiteMesh(noHole));",
  "  ok('2-manifold cerrado', isClosedManifold(noHole).ok);",
  "  ok('volumen = área × profundidad (1.44×0.5=0.72)', Math.abs(meshVolume(noHole) - 0.72) < 1e-6);",
  '}',
].join(nl);
const sec2New = [
  "section('2) Extrusión simple: referencia sin agujero');",
  'const front = square(0.5, 0.5, 0.3);',
  'const DEPTH = 0.5;',
  '// El contorno se normaliza a su bbox -> ocupa [-1,1]^2 (área 4). Los agujeros',
  '// deben usar el MISMO bbox; de ahí worldArea(poly, BOX).',
  'const BOX = worldBox(front);',
  'const AREA_FRONT = worldArea(front, BOX); // 4',
  'const V0 = AREA_FRONT * DEPTH;            // 2',
  'const noHole = buildExtrudeMeshes([front], DEPTH, []);',
  '{',
  "  ok('malla válida', finiteMesh(noHole));",
  "  ok('2-manifold cerrado', isClosedManifold(noHole).ok);",
  "  ok('volumen = área × profundidad (' + AREA_FRONT + '×' + DEPTH + '=' + V0 + ')', Math.abs(meshVolume(noHole) - V0) < 1e-6);",
  '}',
].join(nl);
if (!s.includes(sec2Old)) { console.error('sec2 no encontrada'); process.exit(1); }
s = s.replace(sec2Old, sec2New);

// 3) Sección 3: pasante.
const sec3Old = [
  "section('3) Extrusión simple: calado PASANTE (regresión)');",
  'const holeThru = square(0.5, 0.5, 0.1); // lado 0.2 lienzo -> 0.4 mundo, área 0.16',
  '{',
  '  const m = buildExtrudeMeshes([front], DEPTH, [{ polygon: holeThru, depth: 0 }]);',
  "  ok('malla válida', finiteMesh(m));",
  "  ok('2-manifold cerrado', isClosedManifold(m).ok);",
  '  const v = meshVolume(m);',
  "  ok('quita material', v < 0.72 - 1e-6);",
  "  ok('merma = vol. agujero (0.16×0.5=0.08)', Math.abs(0.72 - v - 0.08) < 1e-3);",
  '}',
].join(nl);
const sec3New = [
  "section('3) Extrusión simple: calado PASANTE (regresión)');",
  'const holeThru = square(0.5, 0.5, 0.1);',
  '{',
  '  const m = buildExtrudeMeshes([front], DEPTH, [{ polygon: holeThru, depth: 0 }]);',
  "  ok('malla válida', finiteMesh(m));",
  "  ok('2-manifold cerrado', isClosedManifold(m).ok);",
  '  const v = meshVolume(m);',
  '  const removed = worldArea(holeThru, BOX) * DEPTH;',
  "  ok('quita material', v < V0 - 1e-6);",
  "  ok('merma = vol. agujero (~' + removed.toFixed(3) + ')', Math.abs(V0 - v - removed) < 1e-3);",
  '}',
].join(nl);
if (!s.includes(sec3Old)) { console.error('sec3 no encontrada'); process.exit(1); }
s = s.replace(sec3Old, sec3New);

// 4) Sección 4: ciego.
const sec4Old = [
  "section('4) Extrusión simple: calado CIEGO');",
  'const BLIND = 0.2;',
  '{',
  '  const m = buildExtrudeMeshes([front], DEPTH, [{ polygon: square(0.5, 0.5, 0.1), depth: BLIND }]);',
  "  ok('malla válida', finiteMesh(m));",
  "  ok('2-manifold cerrado (con fondo)', isClosedManifold(m).ok);",
  '  const v = meshVolume(m);',
  '  const expected = 0.72 - 0.16 * BLIND; // 0.688',
  "  ok('merma = área × profundidad_ciega (0.16×0.2=0.032)', Math.abs(v - expected) < 1e-3);",
  "  ok('quita MENOS que el pasante', v > 0.72 - 0.08 + 1e-6);",
  '',
  '  // El suelo (z = -BLIND) debe mirar hacia +Z (abertura del bolsillo).',
  '  let floorFaces = 0;',
  '  let floorUp = 0;',
  '  for (const f of m.faces) {',
  '    const zs = f.map((i) => m.vertices[i].z);',
  '    const allFloor = zs.every((z) => Math.abs(z + BLIND) < 1e-6);',
  '    if (!allFloor) continue;',
  '    const cx = f.reduce((s, i) => s + m.vertices[i].x, 0) / f.length;',
  '    const cy = f.reduce((s, i) => s + m.vertices[i].y, 0) / f.length;',
  '    if (Math.abs(cx) < 0.19 && Math.abs(cy) < 0.19) {',
  '      floorFaces++;',
  '      if (faceNormal(f, m.vertices).z > 0) floorUp++;',
  '    }',
  '  }',
  "  ok('existe el suelo del bolsillo', floorFaces > 0);",
  "  ok('el suelo mira hacia +Z', floorFaces > 0 && floorUp === floorFaces);",
  '}',
].join(nl);
const sec4New = [
  "section('4) Extrusión simple: calado CIEGO');",
  'const BLIND = 0.2;',
  'const holeBlind = square(0.5, 0.5, 0.1);',
  '{',
  '  const m = buildExtrudeMeshes([front], DEPTH, [{ polygon: holeBlind, depth: BLIND }]);',
  "  ok('malla válida', finiteMesh(m));",
  "  ok('2-manifold cerrado (con fondo)', isClosedManifold(m).ok);",
  '  const v = meshVolume(m);',
  '  const removedBlind = worldArea(holeBlind, BOX) * BLIND;',
  '  const removedThru = worldArea(holeBlind, BOX) * DEPTH;',
  "  ok('merma = área × profundidad_ciega (~' + removedBlind.toFixed(3) + ')', Math.abs(v - (V0 - removedBlind)) < 1e-3);",
  "  ok('quita MENOS que el pasante', v > V0 - removedThru + 1e-6);",
  '',
  '  // El suelo (z = -BLIND) debe mirar hacia +Z (abertura del bolsillo).',
  '  let floorFaces = 0;',
  '  let floorUp = 0;',
  '  for (const f of m.faces) {',
  '    const zs = f.map((i) => m.vertices[i].z);',
  '    if (!zs.every((z) => Math.abs(z + BLIND) < 1e-6)) continue;',
  '    const nz = faceNormal(f, m.vertices).z;',
  '    if (Math.abs(nz) < 0.5) continue; // ignora degeneradas (puntos colineales)',
  '    floorFaces++;',
  '    if (nz > 0) floorUp++;',
  '  }',
  "  ok('existe el suelo del bolsillo', floorFaces > 0);",
  "  ok('el suelo mira hacia +Z', floorFaces > 0 && floorUp === floorFaces);",
  '}',
].join(nl);
if (!s.includes(sec4Old)) { console.error('sec4 no encontrada'); process.exit(1); }
s = s.replace(sec4Old, sec4New);

// 5) Sección 5: varios.
const sec5Old = [
  "section('5) Extrusión simple: VARIOS calados (uno pasante + uno ciego)');",
  '{',
  '  const h1 = { polygon: square(0.35, 0.5, 0.06), depth: 0 };      // pasante, área 0.12^2*4=0.0576',
  '  const h2 = { polygon: square(0.65, 0.5, 0.06), depth: 0.25 };   // ciego',
  '  const m = buildExtrudeMeshes([front], DEPTH, [h1, h2]);',
  "  ok('malla válida', finiteMesh(m));",
  "  ok('2-manifold cerrado', isClosedManifold(m).ok);",
  '  const areaH = shoelace(h1.polygon) * 4; // área en mundo',
  '  const expected = 0.72 - areaH * DEPTH - areaH * 0.25;',
  "  ok('merma = pasante(área×depth) + ciego(área×0.25)', Math.abs(meshVolume(m) - expected) < 2e-3);",
  '}',
].join(nl);
const sec5New = [
  "section('5) Extrusión simple: VARIOS calados (uno pasante + uno ciego)');",
  '{',
  '  const h1 = { polygon: square(0.35, 0.5, 0.06), depth: 0 };',
  '  const h2 = { polygon: square(0.65, 0.5, 0.06), depth: 0.25 };',
  '  const m = buildExtrudeMeshes([front], DEPTH, [h1, h2]);',
  "  ok('malla válida', finiteMesh(m));",
  "  ok('2-manifold cerrado', isClosedManifold(m).ok);",
  '  const ra = worldArea(h1.polygon, BOX);',
  '  const rb = worldArea(h2.polygon, BOX);',
  '  const expected = V0 - ra * DEPTH - rb * 0.25;',
  "  ok('merma = pasante(área×depth) + ciego(área×0.25)', Math.abs(meshVolume(m) - expected) < 2e-3);",
  '}',
].join(nl);
if (!s.includes(sec5Old)) { console.error('sec5 no encontrada'); process.exit(1); }
s = s.replace(sec5Old, sec5New);

if (s !== before) {
  fs.writeFileSync(p, s);
  console.log('Test actualizado.');
} else {
  console.log('Sin cambios.');
}
