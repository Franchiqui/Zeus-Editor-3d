/*
 * fix-viewer3d-types.js  —  ZEUS / corrección de tipos de iluminación
 * ------------------------------------------------------------------
 * QUÉ HACE:
 *   Añade los dos campos que faltan en la versión antigua de
 *   `components/viewer-3d.tsx`:
 *      · SpotlightConfig.targetObjectId?: string;
 *      · LightConfig.affectSky?: boolean;
 *   Son justo los que pide el nuevo `components/LightingModal.tsx`, y su
 *   ausencia provoca los errores TS2339 / TS2353 que ves al compilar.
 *
 * CÓMO USARLO (en Windows, dentro de tu proyecto):
 *   1) Copia este archivo a la raíz:  F:\Zeus Media Studio-3D\fix-viewer3d-types.js
 *   2) Abre una terminal en esa carpeta y ejecuta:
 *         node fix-viewer3d-types.js
 *   3) Vuelve a compilar:  npm run build   (o  npx tsc --noEmit)
 *
 * NOTA: Esto repara el TIPADO para que compile. Para que además funcionen
 * (el foco que sigue a un objeto y el cielo que responde a las luces) debes
 * copiar el archivo COMPLETO `components/viewer-3d.tsx` actualizado.
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(process.cwd(), 'components', 'viewer-3d.tsx');

if (!fs.existsSync(TARGET)) {
  console.error('✗ No encuentro "components/viewer-3d.tsx" en', process.cwd());
  process.exit(1);
}

let src = fs.readFileSync(TARGET, 'utf8');
const eol = src.includes('\r\n') ? '\r\n' : '\n';
let lines = src.split(/\r?\n/);
let toca = 0;

/** Devuelve el índice de la línea donde TERMINA (con '}') la interfaz que abre en startIdx. */
function finInterfaz(startIdx) {
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^\}/.test(lines[i])) return i;
  }
  return -1;
}

// --- 1) targetObjectId en SpotlightConfig ---------------------------------
const iSpot = lines.findIndex((l) => /export interface SpotlightConfig\b/.test(l));
if (iSpot === -1) {
  console.error('✗ No encuentro "export interface SpotlightConfig".');
} else {
  const fin = finInterfaz(iSpot);
  const yaEsta = lines
    .slice(iSpot, fin === -1 ? lines.length : fin)
    .some((l) => /targetObjectId\s*\??\s*:/.test(l));
  if (yaEsta) {
    console.log('• SpotlightConfig.targetObjectId ya existe, no toco nada.');
  } else {
    let ancla = -1;
    for (let i = iSpot + 1; i < (fin === -1 ? lines.length : fin); i++) {
      if (/^\s*target\s*:/.test(lines[i])) { ancla = i; break; }
    }
    if (ancla === -1) ancla = iSpot; // tras la línea de apertura si no hay 'target:'
    lines.splice(ancla + 1, 0, '  targetObjectId?: string;');
    toca++;
    console.log('✓ targetObjectId?: string; añadido a SpotlightConfig.');
  }
}

// --- 2) affectSky en LightConfig ------------------------------------------
const iLight = lines.findIndex((l) => /export interface LightConfig\b/.test(l));
if (iLight === -1) {
  console.error('✗ No encuentro "export interface LightConfig".');
} else {
  const fin = finInterfaz(iLight);
  const yaEsta = lines
    .slice(iLight, fin === -1 ? lines.length : fin)
    .some((l) => /affectSky\s*\??\s*:/.test(l));
  if (yaEsta) {
    console.log('• LightConfig.affectSky ya existe, no toco nada.');
  } else if (fin === -1) {
    console.error('✗ No encuentro el cierre de LightConfig.');
  } else {
    lines.splice(fin, 0, '  affectSky?: boolean;');
    toca++;
    console.log('✓ affectSky?: boolean; añadido a LightConfig.');
  }
}

if (toca > 0) {
  fs.writeFileSync(TARGET, lines.join(eol), 'utf8');
  console.log('\n✔ Hecho. Archivo actualizado:', TARGET);
  console.log('  Ahora ejecuta:  npx tsc --noEmit   y luego  npm run build');
} else {
  console.log('\nNada que cambiar (los dos campos ya estaban).');
}
