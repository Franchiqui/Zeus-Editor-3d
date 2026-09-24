/**
 * Ajusta el comentario del temporizador del historial para que sea exacto:
 * limpiar el pendiente al confirmar es una limpieza defensiva (libera la
 * referencia a la foto y evita un volcado redundante), no la causa ra\u00edz del
 * fallo de deshacer del Recorrido (era que \u00e9ste no estaba en la foto).
 * Idempotente. Uso: node tools/rewrite-undo-comment.cjs
 */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'components', 'editor', 'Editor3D.tsx');
let src = fs.readFileSync(file, 'utf8');
const EOL = src.includes('\r\n') ? '\r\n' : '\n';
const L = (a) => a.join(EOL);

const find = L([
  '      // Esta foto ya ha entrado en el historial: se suelta el pendiente.',
  '      // Si no se limpiara, un deshacer posterior volver\u00eda a \u00abvolcarla\u00bb',
  '      // sobre un \u00edndice ya retrocedido y deshacer quedar\u00eda atascado sin',
  '      // efecto visible (y corromper\u00eda la pila de rehacer).',
]);
const repl = L([
  '      // La foto ya est\u00e1 en el historial: se suelta el pendiente. Libera la',
  '      // referencia a la foto y evita volver a \u00abvolcarla\u00bb de forma redundante',
  '      // al deshacer/rehacer.',
]);

if (src.includes(repl)) {
  console.log('Ya ajustado (idempotente).');
  process.exit(0);
}
const n = src.split(find).length - 1;
if (n !== 1) {
  console.error('Se esperaba 1 comentario, encontrados ' + n);
  process.exit(1);
}
src = src.replace(find, repl);
fs.writeFileSync(file, src, 'utf8');
console.log('Comentario ajustado.');
