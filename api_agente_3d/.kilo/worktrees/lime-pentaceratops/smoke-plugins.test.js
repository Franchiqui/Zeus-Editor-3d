/**
 * Prueba de humo de los deformadores integrados (se puede borrar).
 * Transpila lib/plugins/builtin/deformadores.ts al vuelo y verifica que
 * cada plugin produce una malla válida sin NaN.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = 'F:/Zeus Editor 3D';
const src = fs.readFileSync(
  path.join(root, 'lib/plugins/builtin/deformadores.ts'),
  'utf8'
);
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const modulo = { exports: {} };
new Function('exports', 'require', 'module', js)(modulo.exports, () => ({}), modulo);

const { DEFORMADORES } = modulo.exports;

// Malla de prueba: rejilla 5x5x5 de vértices en un cubo 0..100
const vertices = [];
for (let x = 0; x <= 100; x += 25)
  for (let y = 0; y <= 100; y += 25)
    for (let z = 0; z <= 100; z += 25) vertices.push({ x, y, z });
const malla = { vertices, faces: [[0, 1, 2, 3]] };

let fallos = 0;
const assert = (cond, msg) => {
  console.log((cond ? '  OK  ' : 'FALLO ') + msg);
  if (!cond) fallos++;
};

for (const plugin of DEFORMADORES) {
  const params = {};
  for (const p of plugin.params) params[p.id] = p.valor;

  const res = plugin.aplicar(malla, params);
  const mismos = res.vertices.length === malla.vertices.length;
  const sinNaN = res.vertices.every(
    (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
  );
  const cambia = res.vertices.some(
    (v, i) =>
      v.x !== malla.vertices[i].x ||
      v.y !== malla.vertices[i].y ||
      v.z !== malla.vertices[i].z
  );
  const originalIntacta = malla.vertices.every(
    (v, i) =>
      v.x === vertices[i].x && v.y === vertices[i].y && v.z === vertices[i].z
  );

  console.log(`\n[${plugin.id}]`);
  assert(mismos, 'conserva el número de vértices');
  assert(sinNaN, 'sin coordenadas NaN/Infinity');
  assert(cambia, 'deforma la malla (no es identidad)');
  assert(originalIntacta, 'no muta la malla de entrada');
}

// Caso especial: ángulo 0 en doblar/torcer = identidad
console.log('\n[casos especiales]');
const identidad = DEFORMADORES[0].aplicar(malla, { angulo: 0, eje: 'y' });
assert(
  identidad.vertices.every(
    (v, i) =>
      v.x === vertices[i].x && v.y === vertices[i].y && v.z === vertices[i].z
  ),
  'doblar con ángulo 0 devuelve la malla intacta'
);

// Doblar 180°: la cima debe acabar cerca de la base en Y (el arco la dobla)
const doblado = DEFORMADORES[0].aplicar(malla, { angulo: 180, eje: 'y' });
const cimaY = doblado.vertices.filter((_, i) => vertices[i].y === 100).map((v) => v.y);
assert(
  cimaY.every((y) => y < 5),
  'doblar 180° lleva la cima a la altura de la base (y=' + cimaY[0].toFixed(2) + ')'
);

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);