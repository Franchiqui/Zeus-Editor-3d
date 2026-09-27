/*
 * apply-sweep-subtract-button.cjs
 * -------------------------------
 * Hace que el botón "Sustraer" (calado) funcione también en un objeto con
 * RECORRIDO (extrusión con plantilla por vértice), no solo en la extrusión
 * simple.
 *
 * Problema: el botón comprobaba si la figura dibujada estaba "dentro" siempre
 * contra `views.front` (el contorno Frontal global). Pero en un recorrido la
 * plantilla que se está editando en el lienzo Frontal es el PERFIL DEL VÉRTICE
 * ACTIVO (`activeSweepNode.polygon`), y `views.front` puede estar vacío (el
 * usuario crea el recorrido sin dibujar antes un contorno Frontal). Con
 * `views.front` vacío, `pointInPolygon()` devuelve siempre false, así que al
 * pulsar "Sustraer" no encontraba ninguna figura dentro y no restaba nada.
 *
 * Arreglo: comprobar el centroide contra la MISMA figura que muestra el lienzo:
 *   - con un vértice de recorrido activo  -> activeSweepNode.polygon
 *   - sin recorrido (extrusión simple)    -> views.front
 *
 * El resto de la cadena (buildSweepMesh con `holes`) ya estaba bien: los
 * agujeros se barren junto a la plantilla dejando un túnel a lo largo de todo
 * el recorrido.
 *
 * Idempotente: si ya está aplicado, no cambia nada.
 * Ejecutar: node tools/apply-sweep-subtract-button.cjs
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'components', 'editor', 'Editor3D.tsx');
let src = fs.readFileSync(file, 'utf8');
const before = src;

// --- 1) La base contra la que se comprueba "dentro" ---------------------------
const NEEDLE_DEF = [
  "                          const frontPolylines = getPolylines('views:front');",
  '                          const drawnInside = frontPolylines.filter((line) => {',
].join('\n');

const REPLACEMENT_DEF = [
  "                          const frontPolylines = getPolylines('views:front');",
  '                          // La plantilla que se muestra en el lienzo Frontal:',
  '                          // en un recorrido es el perfil del vértice activo; sin',
  '                          // recorrido, el contorno Frontal. El calado se comprueba',
  '                          // contra ESA figura (la que ve el usuario), no siempre',
  '                          // contra views.front, que puede estar vacío en un recorrido.',
  '                          const baseProfile =',
  '                            activeSweepNode && activeSweepNode.polygon.length >= 3',
  '                              ? activeSweepNode.polygon',
  '                              : views.front;',
  '                          const drawnInside = frontPolylines.filter((line) => {',
].join('\n');

// --- 2) El test de pertenencia usa esa base ----------------------------------
const NEEDLE_USE =
  '                            return pointInPolygon({ x: cx, y: cy }, views.front);';
const REPLACEMENT_USE =
  '                            return pointInPolygon({ x: cx, y: cy }, baseProfile);';

const alreadyApplied =
  src.includes(REPLACEMENT_DEF) && src.includes(REPLACEMENT_USE);

if (alreadyApplied) {
  console.log('Ya aplicado: no se cambia nada.');
  process.exit(0);
}

if (!src.includes(NEEDLE_DEF)) {
  console.error('No se encontró el inicio del botón "Sustraer" (filtro drawnInside). Abortando.');
  process.exit(1);
}
if (!src.includes(NEEDLE_USE)) {
  console.error('No se encontró el test pointInPolygon(..., views.front). Abortando.');
  process.exit(1);
}

src = src.replace(NEEDLE_DEF, REPLACEMENT_DEF);
src = src.replace(NEEDLE_USE, REPLACEMENT_USE);

if (src === before) {
  console.log('Sin cambios.');
  process.exit(0);
}
fs.writeFileSync(file, src);
console.log('Aplicado: el botón "Sustraer" ahora cala también en el recorrido.');
console.log('Recuerda: npx tsc --noEmit');
