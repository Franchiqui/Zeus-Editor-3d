/**
 * Diagnóstico del BISEL: ¿qué pasa en las ESQUINAS (vértices)?
 * Revisa, por cada vértice canon del Cubo/Cilindro:
 *  - nº de caras incidentes (¿los caps se emiten o se saltan?)
 *  - nº de insets alrededor
 *  - geometría: ¿la cap cierra el espacio (triángulos consistentes) o
 *    quedan huecos/puntas?
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const raiz = path.resolve(import.meta.dirname, '../..');
const { aplicarDeformador } = require(
  path.join(raiz, 'scripts/verificar-3d/deform-bundle.cjs')
);

function cargaMalla(nombre) {
  const doc = JSON.parse(
    readFileSync(path.join(raiz, 'public/Obj-3D', nombre), 'utf8')
  );
  return doc.sceneObjects?.[0]?.mesh ?? null;
}

for (const archivo of ['Cubo.zeus', 'Cilindro.zeus']) {
  const m = cargaMalla(archivo);
  const salida = aplicarDeformador('bisel', m, { radio: 10 });
  console.log(`\n== ${archivo}`);
  console.log(`lado por cara (índices de vértice repetidos = caras sin compartir):`);
  const longitudes = {};
  for (const f of m.faces) longitudes[f.length] = (longitudes[f.length] || 0) + 1;
  console.log('  tamaños de cara:', longitudes);
  // Posiciones canon: dedupe por posición.
  const clave = (v) => `${Math.round(v.x * 1e5)}|${Math.round(v.y * 1e5)}|${Math.round(v.z * 1e5)}`;
  const canon = new Map();
  const canonDe = m.vertices.map((v) => {
    const k = clave(v);
    if (!canon.has(k)) canon.set(k, canon.size);
    return canon.get(k);
  });
  // Caras incidentes por canon:
  const inc = new Map();
  for (let fi = 0; fi < m.faces.length; fi++) {
    for (const vi of m.faces[fi]) {
      const c = canonDe[vi];
      if (!inc.has(c)) inc.set(c, new Set());
      inc.get(c).add(fi);
    }
  }
  const cuenta = [...inc.values()].map((s) => s.size);
  console.log('  caras incidentes por vértice canon: min', Math.min(...cuenta), 'max', Math.max(...cuenta));
  console.log('  distrib:', cuenta.sort((a, b) => a - b).join(','));
  // En la salida, ¿algún vértice ORIGINAL (posición canon) queda usado
  // por caras? (es el hub de los caps). Los caps son triángulos con el
  // hub como uno de sus vértices: contar caras de la salida que usan
  // cada índice original.
  const usoOriginal = new Array(m.vertices.length).fill(0);
  const esOriginal = (i) => i < m.vertices.length;
  for (const f of salida.faces) {
    for (const vi of f) if (esOriginal(vi)) usoOriginal[vi]++;
  }
  console.log('  caras de salida que usan vértices ORIGINALES (caps):', usoOriginal.filter((n) => n > 0).length);
  // ¿Cuántos vértices canon tienen su hub cubierto por ≥1 cap?
  const hubs = new Map();
  for (let i = 0; i < canonDe.length; i++) {
    if (!hubs.has(canonDe[i])) hubs.set(canonDe[i], i);
  }
  let conCap = 0;
  for (const [c, vi] of hubs) if (usoOriginal[vi] > 0) conCap++;
  console.log(`  vértices canon con cap: ${conCap}/${hubs.size}  (los demás = HUECO/punta)`);
}