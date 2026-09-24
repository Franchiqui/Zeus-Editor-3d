/**
 * Hace que Deshacer/Rehacer cubran el RECORRIDO de la pestaña Extruir
 * (sweepNodes + sweepClosed + sweepSubdivisions + sweepActiveId), que hasta
 * ahora no formaba parte de la foto del historial y por eso deshacer no
 * revertía los cambios hechos en el Recorrido/Plantilla.
 *
 * Toca 5 sitios coherentes entre sí:
 *   1) el tipo HistoryState,
 *   2) isSameHistoryState,
 *   3) capture(),
 *   4) applyHistoryState(),
 *   5) la lista de dependencias del efecto del historial.
 *
 * Idempotente. Uso: node tools/apply-undo-sweep.cjs
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'components', 'editor', 'Editor3D.tsx');
let src = fs.readFileSync(file, 'utf8');
const EOL = src.includes('\r\n') ? '\r\n' : '\n';
const L = (arr) => arr.join(EOL);
const MARK = 'sweepNodes: SweepNode[];';

if (src.includes(MARK)) {
  console.log('Ya aplicado (idempotente). Nada que hacer.');
  process.exit(0);
}

const edits = [];

// 1) Tipo HistoryState: a\u00f1adir campos tras pluginBaseMeshes.
edits.push({
  name: 'HistoryState',
  find: L(['   pluginBaseMeshes: Record<string, Mesh>;', ' };']),
  repl: L([
    '   pluginBaseMeshes: Record<string, Mesh>;',
    '   /** Recorrido (Extruir): v\u00e9rtices con su posici\u00f3n, plantilla e inclinaci\u00f3n. */',
    '   sweepNodes: SweepNode[];',
    '   /** Recorrido (Extruir): \u00bftramo cerrado? */',
    '   sweepClosed: boolean;',
    '   /** Recorrido (Extruir): n\u00famero de subdivisiones del barrido. */',
    '   sweepSubdivisions: number;',
    '   /** Recorrido (Extruir): v\u00e9rtice activo (selecci\u00f3n). */',
    '   sweepActiveId: number | null;',
    ' };',
  ]),
});

// 2) isSameHistoryState: comparar los campos nuevos.
edits.push({
  name: 'isSameHistoryState',
  find: L(['  sameHistoryValue(a.polylines, b.polylines);']),
  repl: L([
    '  sameHistoryValue(a.polylines, b.polylines) &&',
    '  sameHistoryValue(a.sweepNodes ?? [], b.sweepNodes ?? []) &&',
    '  (a.sweepClosed ?? false) === (b.sweepClosed ?? false) &&',
    '  (a.sweepSubdivisions ?? 10) === (b.sweepSubdivisions ?? 10) &&',
    '  (a.sweepActiveId ?? null) === (b.sweepActiveId ?? null);',
  ]),
});

// 3) capture(): incluir el recorrido.
edits.push({
  name: 'capture',
  find: L([
    '      transformTracks,',
    '      pluginTracks,',
    '      effectTracks,',
    '      pluginBaseMeshes,',
    '    });',
  ]),
  repl: L([
    '      transformTracks,',
    '      pluginTracks,',
    '      effectTracks,',
    '      pluginBaseMeshes,',
    '      sweepNodes,',
    '      sweepClosed,',
    '      sweepSubdivisions,',
    '      sweepActiveId,',
    '    });',
  ]),
});

// 4) applyHistoryState(): restaurar el recorrido.
edits.push({
  name: 'applyHistoryState',
  find: L([
    '    setPluginBaseMeshes(state.pluginBaseMeshes ?? {});',
    '  }, []);',
  ]),
  repl: L([
    '    setPluginBaseMeshes(state.pluginBaseMeshes ?? {});',
    '    // Recorrido (Extruir): fotos antiguas sin recorrido -> vac\u00edo.',
    '    setSweepNodes(state.sweepNodes ?? []);',
    '    setSweepClosed(state.sweepClosed ?? false);',
    '    setSweepSubdivisions(state.sweepSubdivisions ?? 10);',
    '    setSweepActiveId(state.sweepActiveId ?? null);',
    '  }, []);',
  ]),
});

// 5) Dependencias del efecto del historial.
edits.push({
  name: 'deps',
  find: L([
    '    pluginBaseMeshes,',
    '    isUndoRedo,',
    '    commitHistorySnapshot,',
  ]),
  repl: L([
    '    pluginBaseMeshes,',
    '    sweepNodes,',
    '    sweepClosed,',
    '    sweepSubdivisions,',
    '    sweepActiveId,',
    '    isUndoRedo,',
    '    commitHistorySnapshot,',
  ]),
});

let ok = true;
for (const e of edits) {
  const n = src.split(e.find).length - 1;
  if (n !== 1) {
    console.error('[FALLO] ' + e.name + ': se esperaba 1 coincidencia, encontradas ' + n);
    ok = false;
  }
}
if (!ok) {
  console.error('Abortado: ning\u00fan cambio escrito.');
  process.exit(1);
}

for (const e of edits) src = src.replace(e.find, e.repl);
fs.writeFileSync(file, src, 'utf8');
console.log('Recorrido a\u00f1adido al historial (EOL=' + (EOL === '\r\n' ? 'CRLF' : 'LF') + ') en 5 sitios.');
