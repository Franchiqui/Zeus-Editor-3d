/*
 * apply-group-gizmo.cjs
 * ---------------------------------------------------------------------------
 * Gizmo GRUPAL en el visor 3D.
 *
 * Qué hace:
 *   1) Cuando hay VARIOS objetos seleccionados (p. ej. al seleccionar un
 *      grupo), el manipulador único se coloca en el CENTRO del grupo y con
 *      los ejes alineados al mundo, en vez de sobre una sola pieza. Al
 *      arrastrarlo se mueven/giran/escalan todas las piezas juntas (eso ya
 *      lo hacía la lógica de multiselección existente).
 *   2) El resaltado de multiselección pasa de dibujar UNA caja por pieza a
 *      dibujar UNA sola caja que engloba a todo el grupo.
 *   3) El gizmo se recoloca al cambiar la multiselección.
 *   4) El tamaño del gizmo se ajusta al conjunto (no solo a la pieza activa).
 *
 * Es idempotente: si ya está aplicado, no hace nada.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'components', 'viewer-3d.tsx');

const A_START = '     full(gizmoGroupRef.current, false);';
const A_STOP = '    if (lightGizmoGroupRef.current) {';

const B_START =
  '    // --- Highlight for multi-selected objects: draw a wireframe box ---';
const B_STOP =
  '    // --- (toolId) tanto si es un duplicate como si es el mesh principal';

const C_MARK =
  '   applyObjectTransformRef.current = applyObjectTransform;';

// Punto de anclaje y bloque para el tamaño del gizmo (parche 4).
const SCALE_ANCHOR = '     if (mesh.vertices.length === 0) {';
const SCALE_DEPS =
  '   }, [showGizmo, mesh.vertices, transform, gizmoModes, gizmoColorOverride, gizmoOffset]);';
const SCALE_DEPS_NEW =
  '   }, [showGizmo, mesh.vertices, transform, gizmoModes, gizmoColorOverride, gizmoOffset, selectedObjectIds]);';

const MARK = '// Gizmo GRUPAL:';

const A_NEW = [
  '     full(gizmoGroupRef.current, false);',
  '     ' + MARK + ' con varios objetos seleccionados el manipulador se',
  '     // coloca en el CENTRO del grupo y con los ejes alineados al mundo,',
  '     // de modo que se mueve/gira/escala el conjunto como una sola',
  '     // unidad (un único manipulador), en vez de uno por pieza. Con una',
  '     // sola pieza seleccionada se conserva el comportamiento de siempre',
  '     // (gizmo sobre el objeto y su posible offset de configuración).',
  '     const giz = gizmoGroupRef.current;',
  '     if (giz) {',
  '       const selIds = selectedObjectIdsRef.current ?? [];',
  '       const groupObjs =',
  '         selIds.length > 1',
  '           ? (objectsRef.current ?? []).filter((o) => selIds.includes(o.id))',
  '           : [];',
  '       if (groupObjs.length > 1) {',
  '         const min = new THREE.Vector3(Infinity, Infinity, Infinity);',
  '         const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);',
  '         for (const o of groupObjs) {',
  '           const p = o.transform;',
  '           // La pieza activa puede estar arrastrándose: su transform vive',
  '           // en `t` (aún no ha vuelto al estado), así el centro del grupo',
  '           // sigue al dedo sin retraso.',
  '           const isActive = o.id === selectedObjectIdRef.current;',
  '           const px = isActive ? t.px : p.px;',
  '           const py = isActive ? t.py : p.py;',
  '           const pz = isActive ? t.pz : p.pz;',
  '           min.x = Math.min(min.x, px);',
  '           min.y = Math.min(min.y, py);',
  '           min.z = Math.min(min.z, pz);',
  '           max.x = Math.max(max.x, px);',
  '           max.y = Math.max(max.y, py);',
  '           max.z = Math.max(max.z, pz);',
  '         }',
  '         giz.position.set(',
  '           (min.x + max.x) / 2,',
  '           (min.y + max.y) / 2,',
  '           (min.z + max.z) / 2',
  '         );',
  '         // Los ejes del grupo van alineados al mundo.',
  '         giz.rotation.set(0, 0, 0);',
  '         giz.quaternion.identity();',
  '         const baseScaleG = gizmoBaseScaleRef.current || 1;',
  '         giz.scale.set(baseScaleG, baseScaleG, baseScaleG);',
  '       } else {',
  '         const off = gizmoOffsetRef.current;',
  '         const objQuat = new THREE.Quaternion().setFromEuler(',
  '           new THREE.Euler(t.rx, t.ry, t.rz)',
  '         );',
  '         const offPos = new THREE.Vector3(off.px, off.py, off.pz).applyQuaternion(objQuat);',
  '         giz.position.add(offPos);',
  '         const offQuat = new THREE.Quaternion().setFromEuler(',
  '           new THREE.Euler(off.rx, off.ry, off.rz)',
  '         );',
  '         giz.quaternion.multiply(offQuat);',
  '        // La escala del offset tambien se aplica al gizmo (por eje), de',
  '        // modo que en modo configuracion se puede escalar el manipulador.',
  '        const baseScale = gizmoBaseScaleRef.current || 1;',
  '        giz.scale.set(baseScale * off.sx, baseScale * off.sy, baseScale * off.sz);',
  '       }',
  '     }',
  '',
].join('\r\n');

const B_NEW = [
  '    // --- Resaltado de la selección: con VARIOS objetos se dibuja UNA',
  '    // --- sola caja que engloba a todo el grupo (nada de una caja por',
  '    // --- pieza); con uno solo, su propia caja. El gizmo de',
  '    // --- transformación es asimismo único y grupal.',
  '    useEffect(() => {',
  '     const meshGroup = meshGroupRef.current;',
  '     if (!meshGroup) return;',
  '     meshGroup.updateMatrixWorld();',
  '     let highlightGroup = meshGroup.userData.multiSelectHighlight as THREE.Group | undefined;',
  '     if (!highlightGroup) {',
  '       highlightGroup = new THREE.Group();',
  '       meshGroup.add(highlightGroup);',
  '       meshGroup.userData.multiSelectHighlight = highlightGroup;',
  '     }',
  '      highlightGroup.clear();',
  '      const selectedIds = selectedObjectIdsRef.current ?? [];',
  '       if (selectedIds.length === 0) return;',
  '       const box = new THREE.Box3();',
  '       let any = false;',
  '       for (const child of meshGroup.children) {',
  '        if (!child.userData.sceneObjectDuplicate) continue;',
  '        if (!selectedIds.includes(child.userData.sceneObjectId)) continue;',
  '        const childBox = new THREE.Box3().setFromObject(child);',
  '        if (childBox.isEmpty()) continue;',
  '        box.union(childBox);',
  '        any = true;',
  '      }',
  '      if (!any || box.isEmpty()) return;',
  '      const helper = new THREE.Box3Helper(box, 0x38bdf8);',
  '      highlightGroup.add(helper);',
  '     }, [selectedObjectIds, objects?.length, forceObjectsUpdate]);',
  '',
].join('\r\n');

const C_NEW = [
  '',
  '  // Recolocar el gizmo (individual o grupal) al cambiar la selección',
  '  // múltiple, sin esperar a que cambie el transform: con varios objetos',
  '  // seleccionados el manipulador salta al centro del grupo.',
  '  useEffect(() => {',
  '    applyObjectTransformRef.current(transformRef.current);',
  '  }, [selectedObjectIds]);',
].join('\r\n');

const SCALE_BLOCK = [
  '     // Gizmo GRUPAL: con varios objetos seleccionados, el tamaño del',
  '     // manipulador se ajusta al conjunto (no solo a la pieza activa).',
  '     const selIdsForScale = selectedObjectIdsRef.current ?? [];',
  '     if (selIdsForScale.length > 1) {',
  '       const mg = meshGroupRef.current;',
  '       let anyGroup = false;',
  '       const groupBox = new THREE.Box3();',
  '       if (mg) {',
  '         mg.updateMatrixWorld();',
  '         for (const child of mg.children) {',
  '           if (!child.userData.sceneObjectDuplicate) continue;',
  '           if (!selIdsForScale.includes(child.userData.sceneObjectId)) continue;',
  '           const cb = new THREE.Box3().setFromObject(child);',
  '           if (cb.isEmpty()) continue;',
  '           groupBox.union(cb);',
  '           anyGroup = true;',
  '         }',
  '       }',
  '       if (anyGroup) {',
  '         const gr = groupBox.getSize(new THREE.Vector3()).length() / 2 || 1;',
  '         applyScale(Math.min(Math.max(gr * 0.7, 0.5), 12));',
  '         return;',
  '       }',
  '     }',
  '',
].join('\r\n');

function replaceRange(src, startMarker, stopMarker, newText) {
  const i = src.indexOf(startMarker);
  if (i === -1) throw new Error('No se encontró el marcador inicial: ' + startMarker);
  if (src.indexOf(startMarker, i + 1) !== -1)
    throw new Error('Marcador inicial no único: ' + startMarker);
  const j = src.indexOf(stopMarker, i + startMarker.length);
  if (j === -1) throw new Error('No se encontró el marcador final: ' + stopMarker);
  return src.slice(0, i) + newText + src.slice(j);
}

function insertBefore(src, anchor, newText) {
  const i = src.indexOf(anchor);
  if (i === -1) throw new Error('No se encontró el ancla: ' + anchor);
  if (src.indexOf(anchor, i + 1) !== -1) throw new Error('Ancla no única: ' + anchor);
  return src.slice(0, i) + newText + src.slice(i);
}

function main() {
  let src = fs.readFileSync(FILE, 'utf8');

  if (src.includes(MARK) && src.includes('const isActive = o.id === selectedObjectIdRef.current;')) {
    console.log('[apply-group-gizmo] Ya aplicado. Nada que hacer.');
    return;
  }

  // 1) Gizmo grupal en applyObjectTransform.
  src = replaceRange(src, A_START, A_STOP, A_NEW);

  // 2) Caja única de resaltado.
  src = replaceRange(src, B_START, B_STOP, B_NEW);

  // 3) Efecto de recolocación al cambiar la multiselección.
  const k = src.indexOf(C_MARK);
  if (k === -1) throw new Error('No se encontró el punto de inserción del efecto.');
  const kEnd = k + C_MARK.length;
  src = src.slice(0, kEnd) + C_NEW + src.slice(kEnd);

  // 4) Tamaño del gizmo ajustado al grupo.
  src = insertBefore(src, SCALE_ANCHOR, SCALE_BLOCK);
  if (src.indexOf(SCALE_DEPS) === -1) throw new Error('No se encontró la línea de deps.');
  src = src.replace(SCALE_DEPS, SCALE_DEPS_NEW);

  fs.writeFileSync(FILE, src, 'utf8');
  console.log('[apply-group-gizmo] Aplicado correctamente.');
}

main();
