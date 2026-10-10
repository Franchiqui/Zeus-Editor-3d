/**
 * Verificación headless del PASO 3.5 del visor (deformadores animados):
 * 1. Cadena de deformadores (defaults neutro + kf evaluado, como el override)
 *    → aplicarDeformador → buildSnapshotObjectVisual (EXACTO al del visor)
 *    → ¿la malla transplantada conserva TODAS las caras? (nada a la mitad)
 * 2. ¿La malla sin suavizado y con suavizado dan la misma geometría completa?
 * 3. CONSISTENCIA CAGE vs OBJETO: la cage ({vertices, faces: []}) y la malla
 *    completa se deforman con el MISMO deformador — ¿un punto en P se mueve
 *    igual en los dos casos? (el síntoma «la cage amarilla se deforma distinta»)
 *
 * Uso: node scripts/verificar-3d/paso35-transplante-check.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const raiz = path.resolve(import.meta.dirname, '../..');
const { buildSnapshotObjectVisual } = require(
  path.join(raiz, 'scripts/verificar-3d/viewer-bundle.cjs')
);
const { DEFORMADORES_DIRECTOS, aplicarDeformador } = require(
  path.join(raiz, 'scripts/verificar-3d/deform-bundle.cjs')
);

let fallos = 0;
const revisar = (cond, desc) => {
  console.log((cond ? '  OK  ' : '  ✗ FALLO  ') + desc);
  if (!cond) fallos++;
};

const cargaMalla = (nombre) => {
  const doc = JSON.parse(readFileSync(path.join(raiz, 'public/Obj-3D', nombre), 'utf8'));
  return doc.sceneObjects?.[0]?.mesh ?? null;
};

const neutroDe = (id) => {
  const def = DEFORMADORES_DIRECTOS.find((d) => d.id === id);
  const n = {};
  if (def) for (const p of def.params) n[p.id] = p.valor;
  return n;
};

/** Réplica del paso 3.5 del visor: cadena completa sobre la entrada. */
const cadenaVisor = (entrada, cadena) => {
  let m = entrada;
  for (const { id, sampled } of cadena) {
    const def = DEFORMADORES_DIRECTOS.find((d) => d.id === id);
    const params = {};
    for (const p of def.params) params[p.id] = p.valor;
    for (const k of Object.keys(sampled)) params[k] = sampled[k];
    const salida = aplicarDeformador(id, m, params);
    if (salida && salida.vertices.length && salida.faces.length) m = salida;
  }
  return m;
};

/** Conteo de triángulos de la malla principal del visual (lo que queda
 *  tras el transplante de geometría del visor). */
const visualResumen = (visual) => {
  let mejor = null, mejorTri = 0, total = 0;
  visual.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const index = g.getIndex();
    const tri = index ? index.count / 3 : g.getAttribute('position').count / 3;
    total += tri;
    if (tri > mejorTri) { mejor = o; mejorTri = tri; }
  });
  return { triPrincipal: mejorTri, triTotal: total, totalMallas: mejor ? 1 : 0 };
};

const triEsperado = (malla) => malla.faces.reduce((s, f) => s + Math.max(0, f.length - 2), 0);

const mallaEnCaja = (malla) => {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of malla.vertices) {
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
};

/** Box samples de 12 aristas × 24 por arista — réplica de la cage. */
const muestrasBox = (malla) => {
  const { minX, minY, minZ, maxX, maxY, maxZ } = mallaEnCaja(malla);
  const esquinas = [
    [minX, minY, minZ], [maxX, minY, minZ], [maxX, maxY, minZ], [minX, maxY, minZ],
    [minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ],
  ];
  const aristas = [
    [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const muestras = [];
  for (const [a, b] of aristas) {
    for (let i = 0; i < 24; i++) {
      const t = i / (24 - 1);
      muestras.push({
        x: esquinas[a][0] + (esquinas[b][0] - esquinas[a][0]) * t,
        y: esquinas[a][1] + (esquinas[b][1] - esquinas[a][1]) * t,
        z: esquinas[a][2] + (esquinas[b][2] - esquinas[a][2]) * t,
      });
    }
  }
  return { muestras, caja: { minX, minY, minZ, maxX, maxY, maxZ } };
};

const CADENA = [
  { id: 'doblar', sampled: { angulo: 90, eje: 'y' } },
];

for (const archivo of ['Cubo.zeus', 'Cilindro.zeus', 'Esfera.zeus']) {
  const entrada = cargaMalla(archivo);
  if (!entrada) continue;
  console.log(`\n== ${archivo} (${entrada.vertices.length} v / ${entrada.faces.length} f / tri esperado ${triEsperado(entrada)}) ==`);

  for (const smooth of [false, true]) {
    const resultado = cadenaVisor(entrada, CADENA);
    const visual = buildSnapshotObjectVisual(
      resultado, smooth, 'planar', undefined, resultado.textureRepeat ?? 1, resultado.textureRepeatY, null
    );
    const resumen = visualResumen(visual);
    const esperado = triEsperado(resultado);
    revisar(
      resumen.triPrincipal === esperado,
      `malla principal del visual conserva ${resumen.triPrincipal} tri (esperado ${esperado}, smooth=${smooth})`
    );
    revisar(
      resumen.triTotal === esperado,
      `visual completo ${resumen.triTotal} tri (esperado ${esperado}, smooth=${smooth})`
    );
  }

  // — Consistencia cage vs objeto para TODOS los deformadores —
  const { muestras, caja } = muestrasBox(entrada);
  for (const def of DEFORMADORES_DIRECTOS) {
    if (def.id === 'romper') continue; // la cage de romper es representativa por diseño
    const paramsMalla = { ...neutroDe(def.id) };
    const paramsCage = { ...neutroDe(def.id) };
    if (def.params.some((p) => p.id === 'eje')) { paramsMalla.eje = 'y'; paramsCage.eje = 'y'; }
    if (def.id === 'doblar') { paramsMalla.angulo = 90; paramsCage.angulo = 90; }
    if (def.id === 'enroscar') { paramsMalla.angulo = 90; paramsCage.angulo = 90; }
    const mDeformada = aplicarDeformador(def.id, entrada, paramsMalla);
    const cageDeformada = aplicarDeformador(def.id, { vertices: muestras, faces: [] }, paramsCage);
    // Para cada muestra de la cage: el vértice del OBJETO más próximo ANTES
    // y el delta de la cage vs el delta del objeto en esa misma posición.
    let peorErrRel = 0, peorId = def.id, n0 = 0;
    for (const p of muestras) {
      // vecino más cercano del objeto ORIGINAL
      let vi = -1, vd = Infinity;
      for (const v of entrada.vertices) {
        const d = (v.x - p.x) ** 2 + (v.y - p.y) ** 2 + (v.z - p.z) ** 2;
        if (d < vd) { vd = d; vi = v; }
      }
      if (vd > 1e-4) { continue; } // sample lejos del objeto (aristas laterales)
      n0++;
      const vo = entrada.vertices[entrada.vertices.indexOf?.(vi) ?? -1] ?? vi;
      const dObjeto = Math.hypot(
        mDeformada.vertices[entrada.vertices.indexOf(vo)]?.x - vo.x,
        mDeformada.vertices[entrada.vertices.indexOf(vo)]?.y - vo.y,
        mDeformada.vertices[entrada.vertices.indexOf(vo)]?.z - vo.z
      );
      // delta de la cage en esa muestra: busca la muestra de entrada IGUAL (t)
      const k0 = `${Math.round(p.x * 1e3)}|${Math.round(p.y * 1e3)}|${Math.round(p.z * 1e3)}`;
      let idx0 = -1;
      {
        for (let i = 0; i < muestras.length; i++) {
          const q = muestras[i];
          if (`${Math.round(q.x * 1e3)}|${Math.round(q.y * 1e3)}|${Math.round(q.z * 1e3)}` === k0) { idx0 = i; break; }
        }
      }
      const dc = cageDeformada.vertices[idx0];
      const dCage = Math.hypot(dc.x - p.x, dc.y - p.y, dc.z - p.z);
      const errRel = Math.abs(dCage - dObjeto) / Math.max(1e-9, Math.max(dObjeto, dCage));
      if (errRel > peorErrRel) peorErrRel = errRel;
    }
    const margen = 0.05;
    revisar(
      n0 === 0 || peorErrRel < margen,
      `${def.id}: cage vs objeto deltas coinciden (peor err rel ${peorErrRel.toFixed(4)}, ${n0} muestras cercanas)`
    );
  }
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);