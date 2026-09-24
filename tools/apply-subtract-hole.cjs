/*
 * apply-subtract-hole.cjs
 * -----------------------
 * Hace que la "extrusión simple" (pestaña Extruir, sin recorrido) pueda
 * restar como AGUJERO cualquier figura dibujada dentro del contorno Frontal.
 *
 * Problema: la herramienta Línea (hooks/use-polygon-editor.ts) confirma la
 * polilínea con los puntos pulsados tal cual, SIN repetir el punto inicial
 * (se termina con doble clic o Enter). Pero:
 *   - polylineToPolygon() (lib/views-mesh.ts) solo devolvía polígono si
 *     |primero - último| < 0.001 -> una figura dibujada a mano nunca se
 *     extruía.
 *   - El botón "Sustraer" exigía esa misma coincidencia (< 1e-6) -> al
 *     pulsarlo no encontraba ninguna forma "cerrada dentro" y no restaba
 *     nada.
 *
 * Arreglo: una figura con >= 3 puntos se considera cerrada (auto-cierre).
 * Si el usuario sí repitió el primer punto, se descarta el duplicado.
 *
 * Idempotente: reejecutarlo no cambia el archivo.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function backup(rel) {
  const abs = path.join(root, rel);
  const bak = abs + '.subtract.bak';
  if (!fs.existsSync(bak)) {
    fs.copyFileSync(abs, bak);
    console.log('backup creado:', path.relative(root, bak));
  }
}

function edit(rel, fn) {
  const abs = path.join(root, rel);
  const before = fs.readFileSync(abs, 'utf8');
  const after = fn(before);
  if (after === before) {
    console.log('sin cambios (ya aplicado):', rel);
    return false;
  }
  fs.writeFileSync(abs, after);
  console.log('aplicado:', rel);
  return true;
}

// ---------------------------------------------------------------------------
// 1) lib/views-mesh.ts — polylineToPolygon cierra siempre (>= 3 puntos)
// ---------------------------------------------------------------------------
backup('lib/views-mesh.ts');
edit('lib/views-mesh.ts', (src) => {
  const oldStr = [
    '  if (dist < 0.001) {',
    '    return polyline.points.slice(0, -1);',
    '  }',
    '  return null;',
  ].join('\n');
  const newStr = [
    '  // Se cierra SIEMPRE: la herramienta Línea termina con doble clic sin',
    '  // repetir el punto inicial, así que una figura dibujada a mano (primer',
    '  // punto distinto del último) también debe extruirse como sólido o',
    '  // restarse como agujero. Si el usuario sí repitió el primer punto, se',
    '  // descarta el duplicado para no dejar un vértice degenerado.',
    '  if (dist < 0.001) {',
    '    const open = polyline.points.slice(0, -1);',
    '    return open.length >= 3 ? open : null;',
    '  }',
    '  return polyline.points;',
  ].join('\n');
  if (src.includes('const open = polyline.points.slice(0, -1);')) return src;
  if (!src.includes(oldStr)) throw new Error('views-mesh: bloque polylineToPolygon no encontrado');
  return src.replace(oldStr, newStr);
});

// ---------------------------------------------------------------------------
// 2) components/editor/Editor3D.tsx — el botón "Sustraer" acepta figuras
//    dibujadas (>= 3 puntos) sin exigir primer==último.
// ---------------------------------------------------------------------------
backup('components/editor/Editor3D.tsx');
edit('components/editor/Editor3D.tsx', (src) => {
  let out = src;

  // (a) Quita el requisito estricto de cierre (primer == último, < 1e-6)
  //     y deja un comentario en su lugar, conservando la indentación.
  out = out.replace(
    /\n([ \t]*)const closed =[\s\S]*?if \(!closed\) return false;\n/,
    '\n$1// Un contorno dibujado con >= 3 puntos se considera cerrado:\n' +
      '$1// la herramienta Línea no repite el punto inicial al terminar.\n'
  );

  // (b) Renombra la variable a "drawnInside" (más descriptivo).
  out = out.replace(/closedInside/g, 'drawnInside');

  return out;
});

console.log('\nListo. Recuerda: npx tsc --noEmit -p tsconfig.json');
