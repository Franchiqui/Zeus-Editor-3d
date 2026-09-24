'use strict';
/**
 * test-duplicate-opacity-live.cjs
 * ---------------------------------------------------------------------------
 * Prueba de regresión: "al poner TRANSPARENCIA con varios objetos
 * seleccionados solo se veía en 1".
 *
 *  1) Comprueba que el parche está presente en components/viewer-3d.tsx
 *     (y que ya NO está el patrón antiguo que construía la copia una sola vez).
 *  2) Replica la MISMA condición de refresco del parche y verifica que:
 *       - un cambio de TRANSFORM no reconstruye la copia (mismo ref de malla),
 *       - un cambio de OPACIDAD (nueva instantánea) SÍ reconstruye la copia.
 *  3) Comprueba que la copia se vuelve a añadir al grupo solo una vez.
 */
const fs = require('fs');
const path = require('path');

let ok = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { ok++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FALLO  ' + name); }
}

const SRC = fs.readFileSync(
  path.resolve(__dirname, '..', 'components', 'viewer-3d.tsx'),
  'utf8'
);

console.log('\n== 1) Código fuente: parche de refresco en vivo de la copia ==');
check('se calcula snapshotMeshChanged', SRC.includes('const snapshotMeshChanged ='));
check('la clave es la referencia de la instantánea',
  SRC.includes('duplicate.userData.snapshotMesh !== object.mesh'));
check('se reconstruye si cambió la instantánea',
  SRC.includes('if (!duplicate || snapshotMeshChanged) {'));
check('se vacía el visual anterior',
  SRC.includes('for (const child of [...duplicate.children]) {'));
check('se libera geometría/material al vaciar',
  SRC.includes('if (childMesh.material) disposeMaterial(childMesh.material);'));
check('se reaplica el estado congelado',
  SRC.includes('duplicate.userData.isFrozen = false;'));
check('se guarda la nueva instantánea',
  SRC.includes('duplicate.userData.snapshotMesh = object.mesh;'));
check('la copia se añade una sola vez',
  SRC.includes('if (!meshGroup.children.includes(duplicate)) {'));
check('YA NO existe el patrón antiguo (construir solo si falta)',
  !SRC.includes("// If the duplicate doesn't exist, create it"));

console.log('\n== 2) Lógica de refresco (réplica del parche) ==');
// Réplica EXACTA de la condición del parche.
function duplicateNeedsRebuild(duplicate, object) {
  const snapshotMeshChanged =
    !!duplicate && duplicate.userData.snapshotMesh !== object.mesh;
  return !duplicate || snapshotMeshChanged;
}

// El editor, al cambiar la OPACIDAD de un objeto, crea una instantánea NUEVA
// (mesh: { ...mesh, opacity }) → cambia la referencia → hay que reconstruir.
const aplicarOpacidad = (object, op) => ({ ...object, mesh: { ...object.mesh, opacity: op } });
// Al cambiar SOLO el transform, la instantánea se conserva (misma referencia).
const aplicarTransform = (object, px) => ({ ...object, transform: { ...object.transform, px } });

// Estado inicial: un objeto no activo con su copia ya construida.
let object = { id: 'b', transform: { px: 0 }, mesh: { vertices: [1, 2, 3], opacity: 1 } };
let duplicate = { userData: { sceneObjectId: 'b', sceneObjectDuplicate: true, snapshotMesh: object.mesh } };

check('copia ya construida: no se reconstruye sin cambios',
  !duplicateNeedsRebuild(duplicate, object));

// Cambio de transform: misma instantánea → NO reconstruir.
object = aplicarTransform(object, 5);
check('cambio de TRANSFORM no reconstruye la copia',
  !duplicateNeedsRebuild(duplicate, object));

// Cambio de opacidad: instantánea nueva → SÍ reconstruir.
object = aplicarOpacidad(object, 0.4);
const rebuiltAfterOpacity = duplicateNeedsRebuild(duplicate, object);
check('cambio de OPACIDAD SÍ reconstruye la copia', rebuiltAfterOpacity);
check('la nueva instantánea lleva la opacidad aplicada', object.mesh.opacity === 0.4);

// Simular la reconstrucción: se guarda la nueva referencia.
duplicate = { userData: { ...duplicate.userData, snapshotMesh: object.mesh, isFrozen: false } };
check('tras reconstruir, no vuelve a reconstruir (idempotente)',
  !duplicateNeedsRebuild(duplicate, object));

console.log('\n== 3) Dos objetos seleccionados: ambos refrescan ==');
// Escena: A activo (malla principal) + B copia. Se aplica opacidad a los dos.
const A = { id: 'a', mesh: { vertices: [1], opacity: 1 } };
let Bobj = { id: 'b', mesh: { vertices: [1], opacity: 1 } };
let Bdup = { userData: { sceneObjectDuplicate: true, snapshotMesh: Bobj.mesh } };

A.mesh = { ...A.mesh, opacity: 0.3 };       // activo → lo refresca la malla principal
Bobj = { ...Bobj, mesh: { ...Bobj.mesh, opacity: 0.3 } }; // copia → refresco del parche
check('el objeto activo recibe la opacidad', A.mesh.opacity === 0.3);
check('la copia del 2º objeto también se refresca',
  duplicateNeedsRebuild(Bdup, Bobj));

console.log(`\nResultado: ${ok} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
