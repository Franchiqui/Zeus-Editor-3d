/**
 * Deformadores en GRUPO («como si fuera 1»): verificación numérica de
 *   unirMallasComoGrupo / repartirGrupoDeformado / deformarGrupoComoUnidad
 * Chequeos:
 *   1. La matriz XYZ concuerda con THREE (makeRotationFromEuler 'XYZ').
 *   2. Irreversibilidad de la unión: repartir la unida SIN deformar
 *      devuelve las mallas locales EXACTAS de cada miembro.
 *   3. Doblar al conjunto: la caja es la COMBINADA (dos cubos apilados
 *      se curvan como una columna de altura 2, no cada cubo por su lado).
 *   4. El resultado repartido, recompuesto mundo, coincide con la unida
 *      deformada vértice a vértice.
 */
import * as THREE from 'three';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const raiz = path.resolve(import.meta.dirname, '../..');
const {
  aplicarTransformacion,
  unirMallasComoGrupo,
  deformarGrupoComoUnidad,
} = require(path.join(raiz, 'scripts/verificar-3d/deform-bundle.cjs'));

const ok = [];
const mal = [];
const chequea = (nombre, cond) => (cond ? ok : mal).push(nombre);

// Cubo unitario 0..1 en cada eje
const cubo = () => {
  const v = [];
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) v.push({ x, y, z });
  const F = (a) => [a[0], a[1], a[2], a[3]];
  const faces = [
    F([0, 1, 3, 2]), F([4, 6, 7, 5]), F([0, 2, 6, 4]),
    F([1, 5, 7, 3]), F([0, 4, 5, 1]), F([2, 3, 7, 6]),
  ];
  return { vertices: v, faces };
};

// --- 1) Matriz XYZ igual a THREE --------------------------------------
const transform = { px: 3, py: -2, pz: 1, rx: 0.7, ry: -1.1, rz: 2.3, sx: 1.4, sy: 0.8, sz: 1.1 };
const m3 = new THREE.Matrix4().compose(
  new THREE.Vector3(transform.px, transform.py, transform.pz),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(transform.rx, transform.ry, transform.rz)),
  new THREE.Vector3(transform.sx, transform.sy, transform.sz)
);
let diffMax = 0;
for (const p of [{ x: 0.3, y: -1.2, z: 2.5 }, { x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]) {
  const w = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(m3);
  const m = aplicarTransformacion(transform, p);
  diffMax = Math.max(diffMax,
    Math.abs(w.x - m.x), Math.abs(w.y - m.y), Math.abs(w.z - m.z));
}
chequea(`matriz XYZ == THREE compose (diff ${diffMax.toExponential(2)})`, diffMax < 1e-12);

// --- 2) Unión y reparto identidad --------------------------------------
const marco = { px: 10, py: 5, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
const transB = { px: 0, py: 1.5, pz: 0, rx: 0.4, ry: 0.2, rz: 0.1, sx: 1.3, sy: 0.9, sz: 0.7 };
const A = { id: 'A', mesh: cubo(), transform: { px: 0, py: 0, pz: 0, rx: 0.25, ry: -0.4, rz: 0.9, sx: 1.2, sy: 1.1, sz: 1.4 } };
const B = { id: 'B', mesh: cubo(), transform: transB };
const union = unirMallasComoGrupo([A, B], marco);
// reparto sin deformar: el neutro (angulo 0) devuelve las mallas base intactas
const sinDeformar = deformarGrupoComoUnidad('doblar', marco, [A, B], { angulo: 0 });
let errRT = 0;
for (const parte of sinDeformar.porMiembro) {
  const original = parte.id === 'A' ? A.mesh : B.mesh;
  for (let i = 0; i < original.vertices.length; i++) {
    errRT = Math.max(errRT,
      Math.abs(original.vertices[i].x - parte.mesh.vertices[i].x),
      Math.abs(original.vertices[i].y - parte.mesh.vertices[i].y),
      Math.abs(original.vertices[i].z - parte.mesh.vertices[i].z));
  }
}
chequea(`reparto sin deformar = mallas originales (err ${errRT.toExponential(2)})`, errRT < 1e-12);

// --- 3) Doblar a la columna de DOS cubos apilados, caja COMBINADA ------
// Miembros apilados: A en y 0..1, B en y 1..2 (escala 1), marco identidad.
// Doblar caja L=2, θ=90°: R_auto = L/θ = 2/(π/2) ≈ 1.273. Si se deformara
// CADA cubo POR SU LADO, la base de B quedaría clavada recta (y=1); como
// UNO, la junta se CURVA: el vértice de B con d=+0.5 queda a y ≈ 0.5467…
const pA = { id: 'A', mesh: cubo(), transform: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 } };
const pB = { id: 'B', mesh: cubo(), transform: { px: 0, py: 1, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 } };
const marcoI = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
const doblada = deformarGrupoComoUnidad('doblar', marcoI, [pA, pB], { angulo: 90 });
const RAuto = 2 / (Math.PI / 2);
const esperadoJunta = (RAuto - 0.5) * Math.sin(Math.PI / 4); // d=+0.5 (hacia el centro del arco)
const Blocal = doblada.porMiembro[1].mesh;
const Btrans = pB.transform; // py=1: B vive en su marco local → convertir a marco
const juntas = Blocal.vertices
  .map((v) => aplicarTransformacion(Btrans, v).y);
const minYB = Math.min(...juntas);
chequea(`doblar grupo: la junta B SE CURVA (y ≈ ${esperadoJunta.toFixed(3)}, got ${minYB.toFixed(3)})`,
  Math.abs(minYB - esperadoJunta) < 1e-6);
// Y A sigue con su base clavada en y=0:
const ysA = doblada.porMiembro[0].mesh.vertices.map((v) => v.y);
chequea('doblar grupo: base de A clavada en y=0', Math.abs(Math.min(...ysA)) < 1e-6);

// --- 4) El reparto recompuesto mundo == unida deformada -----------------
const partesLocal = doblada.porMiembro;
let errRec = 0;
const unidaDeformada = (() => {
  const { aplicarDeformador, unirMallasComoGrupo: unir } = require(
    path.join(raiz, 'scripts/verificar-3d/deform-bundle.cjs')
  );
  const u = unir([pA, pB], marcoI);
  return aplicarDeformador('doblar', u.unida, { angulo: 90 });
})();
const rangos = [
  { id: 'A', v0: 0, v1: pA.mesh.vertices.length },
  { id: 'B', v0: pA.mesh.vertices.length, v1: pA.mesh.vertices.length + pB.mesh.vertices.length },
];
for (const r of rangos) {
  const parcial = partesLocal.find((m) => m.id === r.id);
  const trans = r.id === 'A' ? pA.transform : pB.transform;
  // mundo de cada vértice local: L_i·v_local  (composición inversa del reparto)
  for (let i = 0; i < parcial.mesh.vertices.length; i++) {
    const pUnida = unidaDeformada.vertices[r.v0 + i];
    const pMundo = aplicarTransformacion(trans, parcial.mesh.vertices[i]);
    errRec = Math.max(errRec,
      Math.abs(pUnida.x - pMundo.x), Math.abs(pUnida.y - pMundo.y), Math.abs(pUnida.z - pMundo.z));
  }
}
chequea(`reparto recompuesto == unida deformada (err ${errRec.toExponential(2)})`, errRec < 1e-6);

// --- Colores y UVs alineados por cara -----------------------------------
const conColor = { ...cubo(), faceColors: cubo().faces.map((_, i) => (i % 2 ? '#ff0000' : '#00ff00')), uvs: cubo().vertices.map((_, i) => [i / 8, i / 8]) };
const C = { id: 'C', mesh: conColor, transform: pA.transform };
const unionC = unirMallasComoGrupo([C, { id: 'D', mesh: cubo(), transform: pB.transform }], marcoI);
chequea('unión: faceColors por cara correctas',
  unionC.unida.faceColors?.[0] === '#00ff00' && unionC.unida.faceColors?.[1] === '#ff0000'
  && unionC.unida.faceColors?.[8] === null);
chequea('unión: caras de D con colors null', unionC.unida.faceColors?.slice(-6).every((c) => c === null));
const dobladaC = deformarGrupoComoUnidad('doblar', marcoI, [
  { id: 'C', mesh: conColor, transform: pA.transform },
  { id: 'D', mesh: cubo(), transform: pB.transform },
], { angulo: 60 });
const partC = dobladaC.porMiembro.find((m) => m.id === 'C');
chequea('reparto: colores por cara conservados', partC.mesh.faceColors?.length === 6 && partC.mesh.faceColors[2] === '#00ff00');
chequea('reparto: UVs conservadas', partC.mesh.uvs?.length === 8 && !!partC.mesh.uvs[3]);

// --- 5) Cadena sobre grupo (playback de pistas de deformador de grupo) --
const {
  aplicarTransformacionInversa,
  aplicarDeformador,
  unirMallasComoGrupo: unirBundle,
  deformarGrupoCadena,
} = require(path.join(raiz, 'scripts/verificar-3d/deform-bundle.cjs'));

// Cadena vacía / neutra: mallas base intactas.
const neutra = deformarGrupoCadena(marcoI, [pA, pB], [{ tipo: 'doblar', params: { angulo: 0 } }]);
chequea('cadena: neutra devuelve las mallas base intactas',
  neutra.porMiembro[0].mesh === pA.mesh && neutra.porMiembro[1].mesh === pB.mesh);

// Cadena Afilar+Doblar: recomponer cada miembro == aplicar la MISMA cadena
// a la unida manualmente (lo que hace el playback paso a paso).
const cadena = [
  { tipo: 'afilar', params: { escalaFin: 150 } },
  { tipo: 'doblar', params: { angulo: 90 } },
];
const salida = deformarGrupoCadena(marcoI, [pA, pB], cadena);
// Unida esperada: unir → afilar → doblar a mano.
const unidaManual = unirBundle([pA, pB], marcoI).unida;
const afilada = aplicarDeformador('afilar', unidaManual, { escalaFin: 150 });
const dobladaManual = aplicarDeformador('doblar', afilada, { angulo: 90 });
let errCadena = 0;
const offset = { A: 0, B: pA.mesh.vertices.length };
for (const parte of salida.porMiembro) {
  const trans = parte.id === 'A' ? pA.transform : pB.transform;
  const v0 = offset[parte.id];
  for (let i = 0; i < parte.mesh.vertices.length; i++) {
    const pMundo = aplicarTransformacion(trans, parte.mesh.vertices[i]);
    const pEsperado = dobladaManual.vertices[v0 + i];
    errCadena = Math.max(errCadena,
      Math.abs(pMundo.x - pEsperado.x), Math.abs(pMundo.y - pEsperado.y), Math.abs(pMundo.z - pEsperado.z));
  }
}
chequea(`cadena afilar+doblar: reparto recompuesto == unida manual (err ${errCadena.toExponential(2)})`, errCadena < 1e-6);
// Y la unida devuelta ES la de la cadena manual (exacta).
let errUnida2 = 0;
for (let i = 0; i < dobladaManual.vertices.length; i++) {
  errUnida2 = Math.max(errUnida2,
    Math.abs(salida.unida.vertices[i].x - dobladaManual.vertices[i].x),
    Math.abs(salida.unida.vertices[i].y - dobladaManual.vertices[i].y),
    Math.abs(salida.unida.vertices[i].z - dobladaManual.vertices[i].z));
}
chequea(`cadena afilar+doblar: unida == manual (err ${errUnida2.toExponential(2)})`, errUnida2 < 1e-9);

console.log('');
console.log('=== RESULTADOS ===');
for (const o of ok) console.log('OK —', o);
for (const m of mal) console.log('FALLO —', m);
process.exitCode = mal.length ? 1 : 0;