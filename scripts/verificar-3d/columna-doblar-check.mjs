/**
 * ¿Qué hace Doblar (animado 0→180°) sobre una COLUMNA apoyada en el suelo?
 * Síntoma del usuario: «al darle a play la columna empieza a aparecer del
 * suelo hacia arriba» (debería curvarse en el sitio).
 *
 * Reproducimos la cadena del visor animado: malla base local + Doblar por
 * frame + transformada del objeto (posición/rotación/escala del .zeus) →
 * Y-mundo de cada vértice. Por frame: minY/maxY mundo contra la base.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const raiz = path.resolve(import.meta.dirname, '../..');
const { aplicarDeformador, DEFORMADORES_DIRECTOS } = require(
  path.join(raiz, 'scripts/verificar-3d/deform-bundle.cjs')
);

const doc = JSON.parse(readFileSync(path.join(raiz, 'public/Obj-3D', 'Cilindro.zeus'), 'utf8'));
const objData = doc.sceneObjects?.[0];
const malla = objData?.mesh;
if (!malla) { console.log('Cilindro.zeus sin malla'); process.exit(1); }

const neutroDe = (id) => {
  const def = DEFORMADORES_DIRECTOS.find((d) => d.id === id);
  const n = {};
  if (def) for (const p of def.params) n[p.id] = p.valor;
  return n;
};

// --- Transformada del objeto tal como está en el archivo ---
const t = objData.transform ?? {};
const px = t.px ?? 0, py = t.py ?? 0, pz = t.pz ?? 0;
const rx = ((t.rx ?? 0) * Math.PI) / 180;
const ry = ((t.ry ?? 0) * Math.PI) / 180;
const rz = ((t.rz ?? 0) * Math.PI) / 180;
const sx = t.sx ?? 1, sy = t.sy ?? 1, sz = t.sz ?? 1;
console.log(`Cilindro: ${malla.vertices.length} v / ${malla.faces.length} f, transform: p=(${px},${py},${pz}) r=(${t.rx ?? 0},${t.ry ?? 0},${t.rz ?? 0}) s=(${sx},${sy},${sz})`);

const localMinY = Math.min(...malla.vertices.map((v) => v.y));
const localMaxY = Math.max(...malla.vertices.map((v) => v.y));
console.log(`malla local: y ∈ [${localMinY.toFixed(3)}, ${localMaxY.toFixed(3)}]`);

const rotar = (v) => {
  // Euler XYZ: Rz·Ry·Rx sobre el vector escalado (ver orden del visor abajo).
  const p = { ...v };
  let { y, z } = p;
  p.y = y * Math.cos(rx) - z * Math.sin(rx);
  p.z = y * Math.sin(rx) + z * Math.cos(rx);
  const x2 = p.x, z2 = p.z;
  p.x = x2 * Math.cos(ry) + z2 * Math.sin(ry);
  p.z = -x2 * Math.sin(ry) + z2 * Math.cos(ry);
  const x3 = p.x, y3 = p.y;
  p.x = x3 * Math.cos(rz) - y3 * Math.sin(rz);
  p.y = x3 * Math.sin(rz) + y3 * Math.cos(rz);
  return p;
};

const mundo = (mallaLocal) =>
  mallaLocal.vertices.map((v) => {
    const e = rotar({ x: v.x * sx, y: v.y * sy, z: v.z * sz });
    return { x: e.x + px, y: e.y + py, z: e.z + pz };
  });

// Y-mundo de la base del objeto (donde toca el suelo si está apoyado)
const baseMundo = py + localMinY * sy;
console.log(`base del objeto (y-mundo de localMaxY→min): ${baseMundo.toFixed(3)}\n`);

let abajo = 0;
for (const segundo of [0, 1, 2, 3, 4, 6, 9]) {
  const params = { ...neutroDe('doblar'), angulo: segundo * 36, eje: 'y' };
  const doblada = aplicarDeformador('doblar', malla, params);
  const wm = mundo(doblada);
  const minY = Math.min(...wm.map((p) => p.y));
  const maxY = Math.max(...wm.map((p) => p.y));
  const bajados = wm.filter((p) => p.y < baseMundo - 1e-4).length;
  abajo += bajados;
  console.log(
    `t=${segundo}s (ángulo ${segundo * 36}°): y-mundo ∈ [${minY.toFixed(3)}, ${maxY.toFixed(3)}]` +
    ` — vértices bajo la base: ${bajados}/${wm.length}`
  );
}

console.log(
  abajo === 0
    ? '\nTODO OK: la base del cilindro queda FIJA en el suelo en todo el arco — el doblez no levanta ni hunde la base.'
    : `\nAVISO: ${abajo} vértices quedan por debajo de la base en algún frame — el doblez mueve la base.`
);