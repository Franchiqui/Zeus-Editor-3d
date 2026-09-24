#!/usr/bin/env node
/**
 * apply-duplicate-opacity-live.cjs
 * ---------------------------------------------------------------------------
 * Arregla: al aplicar TRANSPARENCIA (u otro cambio de material hecho con
 * VARIOS objetos seleccionados, p. ej. un grupo) solo se veía en 1 objeto.
 *
 * Causa: en viewer-3d.tsx cada objeto NO activo se dibuja como una copia
 * ("duplicate") que se construía UNA SOLA VEZ. Si después cambiaba su
 * instantánea de material (opacidad/transparencia), el bucle solo creaba
 * copias que no existían y las existentes quedaban con el material viejo.
 * Así, al poner transparencia a un grupo, el objeto activo (malla principal)
 * sí la cogía, pero la copia del otro objeto no cambiaba hasta reseleccionar
 * (lo que la reconstruía) → "solo se lo pone a 1" y "hay que pulsar".
 *
 * Solución: recordar en la copia la referencia de la instantánea con la que
 * se construyó (`userData.snapshotMesh`) y, si cambia, VACIAR y reconstruir
 * su visual en el sitio (se reaplica el estado congelado/boolean después).
 *
 * Idempotente: al reejecutar imprime "ya aplicado".
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'components', 'viewer-3d.tsx');
const MARKER = 'snapshotMeshChanged';

let src = fs.readFileSync(FILE, 'utf8');

if (src.includes(MARKER)) {
  console.log('apply-duplicate-opacity-live: ya aplicado (nada que hacer).');
  process.exit(0);
}

const NL = src.includes('\r\n') ? '\r\n' : '\n';
const lines = (...arr) => arr.join(NL);

// --- Bloque ORIGINAL (exacto) ---------------------------------------------
const oldBlock = lines(
  "       // If the duplicate doesn't exist, create it",
  "       if (!duplicate) {",
  "        duplicate = new THREE.Group();",
  "        duplicate.userData.sceneObjectId = object.id;",
  "        duplicate.userData.sceneObjectDuplicate = true;",
  "        // Cada objeto muestra SU propia instantánea congelada, sea o no",
  "        // el dueño de la configuración: la figura de un objeto no puede",
  "        // mutar porque cambie la pestaña activa del editor (el dueño se",
  "        // congela al salir de su pestaña, así que su instantánea ya está",
  "        // fresca). Solo un dueño recién creado que aún no se ha congelado",
  "        // usa la figura viva de su pestaña como último recurso. Sin",
  "        // instantánea ni figura viva el duplicado queda vacío: ya no se",
  "        // clona la figura principal como \"fantasma\".",
  "        if (object.mesh && object.mesh.vertices.length > 0) {",
  "          duplicate.add(",
  "            buildSnapshotObjectVisual(",
  "              object.mesh,",
  "              object.smooth ?? false,",
  "              object.textureProjection ?? 'planar',",
  "              undefined,",
  "              object.mesh.textureRepeat ?? 1",
  "            )",
  "          );",
  "        } else if (",
  "          object.id === configObjectId &&",
  "          (configMesh ?? mesh) &&",
  "          (configMesh ?? mesh).vertices.length > 0",
  "        ) {",
  "          duplicate.add(",
  "            buildSnapshotObjectVisual(",
  "              configMesh ?? mesh,",
  "              configSmooth ?? smoothShading,",
  "              configProjection ?? textureProjection,",
  "              (configMesh ?? mesh).textureFinish ?? 'semi-matte'",
  "            )",
  "          );",
  "        } else if (object.kind === 'camera') {",
  "          // Cámara-objeto: cuerpo + cono de visión, sin malla.",
  "          duplicate.add(buildCameraObjectVisual(object.camera));",
  "          duplicate.name = `cameraBodyRoot:${object.id}`;",
  "          // Mira a su foco (posición del fotograma o camera.target).",
  "          const focoDuplicada = object.camera?.keyframes[0]?.target ?? object.camera?.target;",
  "          orientCameraBodyVisual(duplicate, focoDuplicada ?? null);",
  "        }",
  "        meshGroup.add(duplicate);",
  "      }"
);

// --- Bloque NUEVO ----------------------------------------------------------
// Se conserva EXACTAMENTE la construcción del visual (mismo sangrado); solo
// se envuelve en un chequeo de "instantánea cambiada" y se vacía antes.
const newBlock = lines(
  "       // Si el duplicado no existe se crea; si ya existía pero su",
  "       // instantánea cambió (p. ej. le han puesto transparencia encima) se",
  "       // reconstruye su visual EN EL SITIO. Antes se construía una sola vez,",
  "       // así que con varios objetos seleccionados la transparencia —u otro",
  "       // cambio de material hecho en multi-selección— solo se veía en el",
  "       // objeto activo (la malla principal) hasta reseleccionar y forzar la",
  "       // reconstrucción de la copia.",
  "       const snapshotMeshChanged =",
  "         !!duplicate && duplicate.userData.snapshotMesh !== object.mesh;",
  "       if (!duplicate || snapshotMeshChanged) {",
  "        if (!duplicate) {",
  "          duplicate = new THREE.Group();",
  "          duplicate.userData.sceneObjectId = object.id;",
  "          duplicate.userData.sceneObjectDuplicate = true;",
  "        } else {",
  "          // Vaciar el visual anterior (liberando geometrías y materiales)",
  "          // antes de rehacerlo; el estado congelado se reaplica al final.",
  "          for (const child of [...duplicate.children]) {",
  "            duplicate.remove(child);",
  "            child.traverse((item) => {",
  "              const childMesh = item as THREE.Mesh;",
  "              childMesh.geometry?.dispose();",
  "              if (childMesh.material) disposeMaterial(childMesh.material);",
  "            });",
  "          }",
  "          duplicate.userData.isFrozen = false;",
  "        }",
  "        duplicate.userData.snapshotMesh = object.mesh;",
  "        // Cada objeto muestra SU propia instantánea congelada, sea o no",
  "        // el dueño de la configuración: la figura de un objeto no puede",
  "        // mutar porque cambie la pestaña activa del editor (el dueño se",
  "        // congela al salir de su pestaña, así que su instantánea ya está",
  "        // fresca). Solo un dueño recién creado que aún no se ha congelado",
  "        // usa la figura viva de su pestaña como último recurso. Sin",
  "        // instantánea ni figura viva el duplicado queda vacío: ya no se",
  "        // clona la figura principal como \"fantasma\".",
  "        if (object.mesh && object.mesh.vertices.length > 0) {",
  "          duplicate.add(",
  "            buildSnapshotObjectVisual(",
  "              object.mesh,",
  "              object.smooth ?? false,",
  "              object.textureProjection ?? 'planar',",
  "              undefined,",
  "              object.mesh.textureRepeat ?? 1",
  "            )",
  "          );",
  "        } else if (",
  "          object.id === configObjectId &&",
  "          (configMesh ?? mesh) &&",
  "          (configMesh ?? mesh).vertices.length > 0",
  "        ) {",
  "          duplicate.add(",
  "            buildSnapshotObjectVisual(",
  "              configMesh ?? mesh,",
  "              configSmooth ?? smoothShading,",
  "              configProjection ?? textureProjection,",
  "              (configMesh ?? mesh).textureFinish ?? 'semi-matte'",
  "            )",
  "          );",
  "        } else if (object.kind === 'camera') {",
  "          // Cámara-objeto: cuerpo + cono de visión, sin malla.",
  "          duplicate.add(buildCameraObjectVisual(object.camera));",
  "          duplicate.name = `cameraBodyRoot:${object.id}`;",
  "          // Mira a su foco (posición del fotograma o camera.target).",
  "          const focoDuplicada = object.camera?.keyframes[0]?.target ?? object.camera?.target;",
  "          orientCameraBodyVisual(duplicate, focoDuplicada ?? null);",
  "        }",
  "        if (!meshGroup.children.includes(duplicate)) {",
  "          meshGroup.add(duplicate);",
  "        }",
  "      }"
);

const occurrences = src.split(oldBlock).length - 1;
if (occurrences !== 1) {
  console.error(
    `apply-duplicate-opacity-live: se esperaba 1 bloque original, encontrados ${occurrences}.`
  );
  process.exit(1);
}

src = src.replace(oldBlock, newBlock);
fs.writeFileSync(FILE, src, 'utf8');
console.log('apply-duplicate-opacity-live: parche aplicado correctamente.');
