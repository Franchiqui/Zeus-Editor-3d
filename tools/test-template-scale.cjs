/**
 * test-template-scale.cjs
 * ---------------------------------------------------------------------------
 * Comprueba el CONTROL DE ESCALA REAL de las plantillas (DrawingCanvas):
 *
 *   1. Existe el helper scalePolygon y se usa en scaleBy/resetScale/UI.
 *   2. La escala se aplica al POLIGONO (tamano real), distinta del zoom (vista).
 *   3. scalePolygon: mantiene el centroide, multiplica el radio por el factor,
 *      escala tambien las asas (hIn/hOut) y no muta el original.
 *   4. El "tamano real" que se ve en el recorrido (profileRadius * 100) crece
 *      proporcionalmente al factor de escala.
 *   5. Rango: se puede REDUCIR mucho (MIN_SCALE = 1%).
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) {
    pass++;
    console.log('  \u2713 ' + name);
  } else {
    fail++;
    console.log('  \u2717 ' + name);
  }
}
function near(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'components', 'drawing-canvas.tsx'), 'utf8');
const pathSrc = fs.readFileSync(path.join(root, 'components', 'editor', 'path-canvas.tsx'), 'utf8');

console.log('\n== Fuente (drawing-canvas.tsx) ==');
ok('existe scalePolygon', /function scalePolygon\(poly: Polygon, factor: number\): Polygon \{/.test(src));
ok('usa scalePolygon en scaleBy', /const scaled = scalePolygon\(polygon, f\);/.test(src));
ok('scaleBy aplica al historial (applyShape)', /applyShape\(scaled\)/.test(src));
ok('resetScale vuelve al poligono base', /applyShape\(base\)/.test(src));
ok('hay estado scalePct', /const \[scalePct, setScalePct\] = useState\(100\)/.test(src));
ok('MIN_SCALE permite reducir (1%)', /const MIN_SCALE = 1;/.test(src));
ok('hay botones Escala (icono Scaling)', /<Scaling className="w-3 h-3 text-green-400\/80" \/>/.test(src));
ok('boton encoger', /onClick=\{\(\) => scaleBy\(1 \/ 1\.15\)\}/.test(src));
ok('boton agrandar', /onClick=\{\(\) => scaleBy\(1\.15\)\}/.test(src));
ok('el zoom sigue siendo vista (viewBox), no escala el poligono', /viewBox=\{`\$\{viewMinX\} \$\{viewMinY\} \$\{viewSpan\} \$\{viewSpan\}`\}/.test(src));
ok('escala es independiente del zoom (scalePolygon no usa zoom)', !/scalePolygon\([^)]*zoom/.test(src));

console.log('\n== Logica de scalePolygon (replica) ==');
function scalePolygon(poly, factor) {
  if (poly.length === 0 || factor === 1) return poly;
  let cx = 0,
    cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= poly.length;
  cy /= poly.length;
  const f = (x, y) => ({ x: cx + (x - cx) * factor, y: cy + (y - cy) * factor });
  return poly.map((p) => {
    const np = { ...f(p.x, p.y) };
    if (p.hIn) np.hIn = f(p.hIn.x, p.hIn.y);
    if (p.hOut) np.hOut = f(p.hOut.x, p.hOut.y);
    return np;
  });
}
function centroid(poly) {
  let cx = 0,
    cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / poly.length, y: cy / poly.length };
}
function profileRadius(poly) {
  if (!poly || poly.length < 3) return 0.06;
  const c = centroid(poly);
  let r = 0;
  for (const p of poly) r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y));
  return r || 0.06;
}

// Cuadrado 0.2..0.8 -> centroide (0.5,0.5), radio 0.3
const square = [
  { x: 0.2, y: 0.2 },
  { x: 0.8, y: 0.2 },
  { x: 0.8, y: 0.8 },
  { x: 0.2, y: 0.8 },
];
const c0 = centroid(square);
ok('centroide base (0.5, 0.5)', near(c0.x, 0.5) && near(c0.y, 0.5));

const x15 = scalePolygon(square, 1.5);
const c1 = centroid(x15);
ok('escalar 1.5 mantiene el centroide', near(c1.x, 0.5, 1e-12) && near(c1.y, 0.5, 1e-12));
ok('radio x1.5 (0.3 -> 0.45)', near(profileRadius(x15), profileRadius(square) * 1.5, 1e-12));

// Reducir mucho
const shrink = scalePolygon(square, 0.01);
ok('se puede reducir a 1% (radio ~0.003)', near(profileRadius(shrink), profileRadius(square) * 0.01, 1e-12));

// Asas
const withHandles = [
  { x: 0.2, y: 0.2, hOut: { x: 0.5, y: 0.2 } },
  { x: 0.8, y: 0.2, hIn: { x: 0.5, y: 0.2 } },
  { x: 0.8, y: 0.8 },
  { x: 0.2, y: 0.8 },
];
const wh2 = scalePolygon(withHandles, 2);
ok('escala las asas hOut', near(wh2[0].hOut.x, 0.5) && near(wh2[0].hOut.y, -0.1, 1e-12));
ok('escala las asas hIn', near(wh2[1].hIn.x, 0.5) && near(wh2[1].hIn.y, -0.1, 1e-12));

// No muta el original
const orig = JSON.parse(JSON.stringify(square));
scalePolygon(square, 3);
ok('scalePolygon no muta el original', JSON.stringify(square) === JSON.stringify(orig));

console.log('\n== El recorrido muestra el tamano REAL ==');
ok('path-canvas dibuja de canto con profileRadius * 100', pathSrc.includes('const r = profileRadius(p.polygon) * 100;'));
// El radio dibujado en el recorrido = profileRadius(poly)*100 == tamano real.
const R = profileRadius(square) * 100;
const R15 = profileRadius(x15) * 100;
ok('radio en recorrido crece con la escala (42,43 -> 63,64)', near(R, 42.42640687119286, 1e-9) && near(R15, 63.63961030678929, 1e-9));
ok('coincide con la proporcion de la malla barrida (UNIT*scale fijo)',
  /const lx = \(prof\[k\]\.x - c\.x\) \* UNIT \* scale;/.test(
    fs.readFileSync(path.join(root, 'lib', 'sweep-mesh.ts'), 'utf8')
  ));

console.log('\n----------------------------------------');
console.log(`  ${pass} OK, ${fail} fallos`);
console.log('----------------------------------------\n');
process.exit(fail === 0 ? 0 : 1);
