/**
 * Corrige el bug de Deshacer: el antirrebote del historial dejaba
 * `pendingSnapshotRef` apuntando a la última foto incluso después de haberla
 * confirmado. Al deshacer, flushPendingHistory volvía a "volcar" esa foto
 * obsoleta sobre un índice ya retrocedido, de modo que deshacer no surtía
 * efecto (y corrompía la pila de rehacer).
 *
 * Arreglo: al dispararse el temporizador y confirmar la foto, se suelta el
 * pendiente. Uso: node tools/fix-undo.cjs
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'components', 'editor', 'Editor3D.tsx');
let src = fs.readFileSync(file, 'utf8');

const eol = src.includes('\r\n') ? '\r\n' : '\n';

const needle =
  '    historyTimerRef.current = setTimeout(() => {' + eol +
  '      historyTimerRef.current = null;' + eol +
  '      commitHistorySnapshot(currentState);' + eol +
  '    }, 400);';

const replacement =
  '    historyTimerRef.current = setTimeout(() => {' + eol +
  '      historyTimerRef.current = null;' + eol +
  '      // Esta foto ya ha entrado en el historial: se suelta el pendiente.' + eol +
  '      // Si no se limpiara, un deshacer posterior volver\u00eda a \u00abvolcarla\u00bb' + eol +
  '      // sobre un \u00edndice ya retrocedido y deshacer quedar\u00eda atascado sin' + eol +
  '      // efecto visible (y corromper\u00eda la pila de rehacer).' + eol +
  '      pendingSnapshotRef.current = null;' + eol +
  '      commitHistorySnapshot(currentState);' + eol +
  '    }, 400);';

if (src.includes(replacement)) {
  console.log('Ya aplicado (idempotente). Nada que hacer.');
  process.exit(0);
}

const count = src.split(needle).length - 1;
if (count !== 1) {
  console.error('Se esperaba 1 coincidencia exacta del bloque del temporizador, encontradas: ' + count);
  process.exit(1);
}

src = src.replace(needle, replacement);
fs.writeFileSync(file, src, 'utf8');
console.log('Correcci\u00f3n aplicada correctamente (EOL=' + (eol === '\r\n' ? 'CRLF' : 'LF') + ').');
