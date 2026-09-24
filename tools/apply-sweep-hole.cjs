/*
 * apply-sweep-hole.cjs
 * --------------------
 * Hace que el CALADO (sustraer una figura dibujada dentro del contorno) funcione
 * también en el recorrido (extrusión con "recorrido"), no solo en la extrusión
 * simple. Para ello, al construir la malla del recorrido se recogen las
 * polilíneas marcadas como agujero (extrudeHoles) y se pasan como `holes` a
 * buildSweepMesh, que las barre junto a la plantilla y deja la pieza hueca.
 *
 * Idempotente: si ya está aplicado, no cambia nada.
 * Ejecutar: node tools/apply-sweep-hole.cjs
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'components', 'editor', 'Editor3D.tsx');
let src = fs.readFileSync(file, 'utf8');
const before = src;

const NEEDLE = `      if (canSweep) {
        mesh = buildSweepMesh(sweepWithProfiles, {
          closed: sweepClosed,
          subdivisions: sweepSubdivisions,
        });
      } else {`;

const REPLACEMENT = `      if (canSweep) {
        // Calado en el recorrido: las figuras marcadas como agujero se barren
        // junto a la plantilla (túnel a lo largo de todo el recorrido), de
        // forma que la pieza queda hueca de lado a lado.
        const frontPolylines = getPolylines('views:front');
        const holes: Polygon[] = [];
        for (const line of frontPolylines) {
          if (!extrudeHoles.includes(line.id)) continue;
          const poly = polylineToPolygon(line);
          if (poly) holes.push(poly);
        }
        mesh = buildSweepMesh(sweepWithProfiles, {
          closed: sweepClosed,
          subdivisions: sweepSubdivisions,
          holes,
        });
      } else {`;

if (src.includes(REPLACEMENT)) {
  console.log('Ya aplicado: no se cambia nada.');
  process.exit(0);
}
if (!src.includes(NEEDLE)) {
  console.error('No se encontró el bloque esperado en Editor3D.tsx. Abortando.');
  process.exit(1);
}

src = src.replace(NEEDLE, REPLACEMENT);
if (src === before) {
  console.log('Sin cambios.');
  process.exit(0);
}
fs.writeFileSync(file, src);
console.log('Aplicado: el recorrido ahora recibe los agujeros (calado).');
