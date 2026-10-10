/**
 * Reproduce EXACTAMENTE la pista del usuario (PRUEBA-NUEVA.zeus):
 *   afilar:  0 s escalaFin 100 → 5 s 27   (Afilar ANTES en la cadena)
 *   doblar:  0 s angulo 0, diametro 0 → 5 s angulo 180, diametro 110
 * Muestra la altura Y-mundo visible de la columna por frame.
 * Síntoma reportado: «crece como una semilla saliendo del suelo».
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const raiz = path.resolve(import.meta.dirname, '../..');
const { aplicarDeformador, DEFORMADORES_DIRECTOS } = require(
  path.join(raiz, 'scripts/verificar-3d/deform-bundle.cjs')
);

// --- La columna real del usuario ---
const doc = JSON.parse(
  readFileSync('F:/Archivos Zeus/Objeto 3D/PRUEBA-NUEVA.zeus', 'utf8')
);
const obj = doc.sceneObjects[0];
const malla = obj.mesh;
const t = obj.transform;
const sy = t.sy ?? 1;
const py = t.py ?? 0;
const neutroDe = (id) => {
  const def = DEFORMADORES_DIRECTOS.find((d) => d.id === id);
  const n = {};
  if (def) for (const p of def.params) n[p.id] = p.valor;
  return n;
};
const localMinY = Math.min(...malla.vertices.map((v) => v.y));
const baseMundo = py + localMinY * sy; // donde apoya la columna
const altoRecta = py + Math.max(...malla.vertices.map((v) => v.y)) * sy;

console.log(`Columna: ${malla.vertices.length} v, sy=${sy.toFixed(3)}, base y=${baseMundo.toFixed(3)}, alto recta y=${altoRecta.toFixed(3)}\n`);
console.log('t(s)  ang   diam   |  y-mundo [min … max]  (alto visible sobre la base)');
for (let i = 0; i <= 10; i++) {
  const tt = i * 0.5;
  // afilar PRIMERO (orden que arreglamos): escalaFin 100→27
  const m1 = aplicarDeformador('afilar', malla, {
    ...neutroDe('afilar'),
    escalaInicio: 100,
    escalaFin: 100 + (27 - 100) * (tt / 5),
    eje: 'y',
  });
  // doblar: angulo 0→180, diametro 0→110 (la interpolación del kf)
  const m2 = aplicarDeformador('doblar', m1, {
    ...neutroDe('doblar'),
    angulo: 180 * (tt / 5),
    diametro: 110 * (tt / 5),
    eje: 'y',
  });
  const ys = m2.vertices.map((v) => py + v.y * sy);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  console.log(
    `${tt.toFixed(1).padStart(4)}  ${Math.round(180 * (tt / 5)).toString().padStart(3)}  ${Math.round(110 * (tt / 5)).toString().padStart(4)}  |  [${minY.toFixed(3)} … ${maxY.toFixed(3)}]  alto=${(maxY - baseMundo).toFixed(3)}`
  );
}