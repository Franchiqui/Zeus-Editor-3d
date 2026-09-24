const fs = require('fs');
const p = 'lib/views-mesh.ts';
let s = fs.readFileSync(p, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
const before = s;

// 1) Insertar helpers de bounding box + normalización en marco compartido.
const anchor = 'function extrudeSinglePolygon(';
const helpers = [
  '/** Bounding box de un polígono (en sus propias coordenadas). */',
  'interface Box {',
  '  minX: number;',
  '  minY: number;',
  '  w: number;',
  '  h: number;',
  '}',
  'function polygonBox(poly: Polygon): Box {',
  '  let minX = Infinity,',
  '    maxX = -Infinity,',
  '    minY = Infinity,',
  '    maxY = -Infinity;',
  '  for (const q of poly) {',
  '    minX = Math.min(minX, q.x);',
  '    maxX = Math.max(maxX, q.x);',
  '    minY = Math.min(minY, q.y);',
  '    maxY = Math.max(maxY, q.y);',
  '  }',
  '  return { minX, minY, w: maxX - minX || 1, h: maxY - minY || 1 };',
  '}',
  '',
  '/**',
  ' * Normaliza un polígono a [0,1] usando un bounding box EXPLÍCITO.',
  ' * Imprescindible para los agujeros: deben compartir el marco (bounding box)',
  ' * del contorno exterior para conservar su posición dentro de él. Si cada',
  ' * agujero se normalizara con su propio bbox se estiraría hasta cubrir toda',
  ' * la cara y el calado no se vería (parecía que "no hacía nada").',
  ' */',
  'function normalizeInBox(poly: Polygon, bb: Box): Polygon {',
  '  return poly.map((q) => {',
  '    const out: Point2D = {',
  '      x: (q.x - bb.minX) / bb.w,',
  '      y: (q.y - bb.minY) / bb.h,',
  '    };',
  '    if (q.hIn) out.hIn = { x: (q.hIn.x - bb.minX) / bb.w, y: (q.hIn.y - bb.minY) / bb.h };',
  '    if (q.hOut) out.hOut = { x: (q.hOut.x - bb.minX) / bb.w, y: (q.hOut.y - bb.minY) / bb.h };',
  '    return out;',
  '  });',
  '}',
  '',
  'function extrudeSinglePolygon(',
].join(nl);
if (!s.includes(anchor)) {
  console.error('ANCHOR extrudeSinglePolygon no encontrado');
  process.exit(1);
}
if (!s.includes('function normalizeInBox(')) {
  s = s.replace(anchor, helpers);
}

// 2) Contorno principal: usar el bbox del contorno como marco compartido.
const oldFront = '  const front = flattenPolygon(normalizePolygon(polygon), curveSteps);';
const newFront = [
  '  // Marco compartido: el bbox del contorno exterior. Tanto el contorno',
  '  // como TODOS los agujeros se normalizan con él para que cada agujero',
  '  // conserve su posición relativa dentro de la figura.',
  '  const mainBox = polygonBox(polygon);',
  '  const front = flattenPolygon(normalizeInBox(polygon, mainBox), curveSteps);',
].join(nl);
if (!s.includes(oldFront)) {
  console.error('ANCHOR front no encontrado');
  process.exit(1);
}
s = s.replace(oldFront, newFront);

// 3) Agujeros: normalizar con el mismo marco (mainBox), no con su propio bbox.
const oldHole = '    const flat = flattenPolygon(normalizePolygon(poly), curveSteps);';
const newHole = '    const flat = flattenPolygon(normalizeInBox(poly, mainBox), curveSteps);';
if (!s.includes(oldHole)) {
  console.error('ANCHOR hole no encontrado');
  process.exit(1);
}
s = s.replace(oldHole, newHole);

if (s === before) {
  console.log('Sin cambios (ya aplicado).');
} else {
  fs.writeFileSync(p, s);
  console.log('Parche aplicado a ' + p);
}
