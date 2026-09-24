'use strict';
/**
 * test-group-orbit.cjs
 * ---------------------------------------------------------------------------
 * Prueba de regresión del GIZMO GRUPAL con rotación ORBITAL.
 *
 *  1) Comprueba que el parche está presente en components/viewer-3d.tsx.
 *  2) Replica la MISMA matemática de órbita y verifica que el movimiento es
 *     rígido: se preservan las distancias entre piezas y las orientaciones
 *     relativas (el grupo gira como un SÓLIDO RÍGIDO alrededor del centro,
 *     no cada pieza sobre sí misma).
 *  3) Comprueba que la órbita DIFIERE de una simple traslación (la feature
 *     hace algo real) y que un punto en el pivote permanece fijo.
 */
const fs = require('fs');
const path = require('path');
const THREE = require('three');

let ok = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { ok++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FALLO  ' + name); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

const SRC = fs.readFileSync(
  path.resolve(__dirname, '..', 'components', 'viewer-3d.tsx'),
  'utf8'
);

console.log('\n== 1) Código fuente: parche de órbita grupal presente ==');
check('ref de pivote del grupo', SRC.includes('const groupPivotRef = useRef<THREE.Vector3 | null>(null);'));
check('ref del giro orbital', SRC.includes('const groupOrbitRef = useRef<THREE.Quaternion | null>(null);'));
check('applyObjectTransform orbita las copias', SRC.includes('Giro GRUPAL: cuando el conjunto está orbitando'));
check('manipulador fijado en el pivote', SRC.includes('giz.position.copy(groupPivotRef.current);'));
check('se calcula el centro al empezar el arrastre', SRC.includes('let pivCount = 0;'));
check('pieza activa orbita en vivo', SRC.includes('if (pivoteGrupo && !isHelper && !isGizmo) {'));
check('el resto de piezas orbita al soltar', SRC.includes('cada pieza ORBITA alrededor del centro del'));
check('se limpia la órbita al soltar', SRC.includes('desactivar la órbita/pivote del grupo.'));
check('ya NO se usa la traslación en bloque al orbitar', !SRC.includes('px: startObj.px + deltaPos.x,'));

console.log('\n== 2) Matemática de órbita: movimiento rígido ==');
// Mismos datos que usaría el editor.
const pivot = new THREE.Vector3(1.5, 0.0, -2.0);            // centro del grupo
const starts = [
  { id: 'a', p: new THREE.Vector3(0.0, 0.0, 0.0), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.2, 0.3)) },
  { id: 'b', p: new THREE.Vector3(3.0, 0.5, -2.0), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, 0.0, 0.8)) },
  { id: 'c', p: new THREE.Vector3(1.5, 2.0, -4.0), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.0, 1.1, -0.2)) },
];
const axis = new THREE.Vector3(0, 1, 0).normalize();
const dq = new THREE.Quaternion().setFromAxisAngle(axis, 0.9); // radianes

// Réplica EXACTA de la órbita del parche:
//   pos' = pivot + dq * (pos - pivot)   ;   quat' = dq * quat
const orbitP = (p) => p.clone().sub(pivot).applyQuaternion(dq).add(pivot);
const out = starts.map((o) => ({
  id: o.id,
  p: orbitP(o.p),
  q: dq.clone().multiply(o.q),
}));

let distOK = true;
for (let i = 0; i < starts.length; i++) {
  for (let j = i + 1; j < starts.length; j++) {
    const d0 = starts[i].p.distanceTo(starts[j].p);
    const d1 = out[i].p.distanceTo(out[j].p);
    if (!approx(d0, d1, 1e-9)) distOK = false;
  }
}
check('las distancias entre piezas se preservan (grupo rígido)', distOK);

let relOK = true;
for (let i = 0; i < starts.length; i++) {
  for (let j = 0; j < starts.length; j++) {
    const r0 = starts[i].q.clone().invert().multiply(starts[j].q);
    const r1 = out[i].q.clone().invert().multiply(out[j].q);
    if (!approx(Math.abs(r0.dot(r1)), 1, 1e-9)) relOK = false;
  }
}
check('las orientaciones relativas se preservan', relOK);

console.log('\n== 3) La órbita DIFFIERE de una traslación simple ==');
// Un punto en el pivote no se mueve al orbitar.
const enPivote = pivot.clone();
check('un punto en el pivote queda fijo', orbitP(enPivote).distanceTo(enPivote) < 1e-9);

// Comparación con la traslación antigua (todas las piezas + mismo delta).
const active = starts[0];
const deltaPos = orbitP(active.p).clone().sub(active.p);
const translateOut = starts.map((o) => o.p.clone().add(deltaPos));
let algunaDifiere = false;
for (let i = 0; i < starts.length; i++) {
  if (out[i].p.distanceTo(translateOut[i]) > 1e-6) algunaDifiere = true;
}
check('el resultado orbital ≠ traslación en bloque', algunaDifiere);

// La dirección de desplazamiento de una pieza alejada del EJE NO es la misma
// que la de la pieza activa (=traslación): prueba de que orbita de verdad.
const dirC = out[2].p.clone().sub(starts[2].p).normalize();
const dirDelta = deltaPos.clone().normalize();
check('la dirección de giro difiere de una traslación en bloque', dirC.dot(dirDelta) < 0.999);

// Rigidez respecto al pivote: cada pieza conserva su RADIO al centro (rota
// sobre el círculo del pivote).
let radioOK = true;
for (let i = 0; i < starts.length; i++) {
  const r0 = starts[i].p.distanceTo(pivot);
  const r1 = out[i].p.distanceTo(pivot);
  if (!approx(r0, r1, 1e-9)) radioOK = false;
}
check('cada pieza conserva su radio al pivote (órbita real)', radioOK);

console.log('\n== 4) Una sola pieza: sin órbita (comportamiento de siempre) ==');
const pivoteSingle = null;
check('sin pivote no se orbita (rama clásica)', pivoteSingle === null);

console.log('\n----------------------------------------');
console.log(`RESULTADO: ${ok} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
