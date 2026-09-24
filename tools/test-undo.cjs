/**
 * Pruebas del historial de Editor3D.
 *
 *  Parte A — máquina del historial: antirrebote (pendingSnapshotRef + timer),
 *  flushPendingHistory, commitHistorySnapshot, undo/redo. Se compara CON y SIN
 *  la limpieza del pendiente al confirmar (limpieza defensiva).
 *
 *  Parte B — rastreo de campos: demuestra el fallo real de "deshacer no
 *  funciona" en el Recorrido de Extruir. Antes, sweepNodes no formaba parte de
 *  la foto del historial ⇒ un cambio solo en el recorrido se consideraba
 *  "igual" y NO creaba paso de historial ⇒ deshacer no revertía nada. Con el
 *  arreglo (sweepNodes en la foto y en la comparación) sí crea paso.
 *
 * Uso: node tools/test-undo.cjs
 */

/* ------------------------------------------------------------------ */
/* Parte A: máquina del historial                                       */
/* ------------------------------------------------------------------ */
function makeHistoryModel({ clearPendingOnTimer }) {
  let history = [];
  let index = -1;
  let pending = null; // pendingSnapshotRef
  let timerScheduled = false; // historyTimerRef != null
  let current = null;

  function commit(snapshot) {
    const last = history[index];
    if (last !== undefined && last === snapshot) return;
    history = history.slice(0, index + 1);
    history.push(snapshot);
    while (history.length > 50) history.shift();
    index = history.length - 1;
  }
  function flushPending() {
    if (timerScheduled) timerScheduled = false;
    if (pending !== null) {
      const p = pending;
      pending = null;
      commit(p);
    }
  }
  function undo() {
    flushPending();
    if (index <= 0) return;
    index -= 1;
    current = history[index];
  }
  function redo() {
    flushPending();
    if (index >= history.length - 1) return;
    index += 1;
    current = history[index];
  }
  function render(newState) {
    current = newState;
    if (history.length === 0 && index === -1) {
      history = [current];
      index = 0;
      return;
    }
    pending = current;
    timerScheduled = true;
  }
  function fireTimer() {
    if (!timerScheduled) return;
    timerScheduled = false;
    const snap = pending;
    if (clearPendingOnTimer) pending = null;
    commit(snap);
  }
  return {
    render, fireTimer, undo, redo,
    state: () => ({ history: history.slice(), index, current, pending }),
  };
}

function runSequence(clearPendingOnTimer, seq) {
  const m = makeHistoryModel({ clearPendingOnTimer });
  const trace = [];
  for (const step of seq) {
    if (step === 'timer') m.fireTimer();
    else if (step === 'undo') m.undo();
    else if (step === 'redo') m.redo();
    else m.render(step);
    trace.push(m.state().current + '@' + m.state().index);
  }
  return { trace, end: m.state() };
}

/* ------------------------------------------------------------------ */
/* Parte B: rastreo de campos (Recorrido de Extruir)                   */
/* ------------------------------------------------------------------ */
function sameHistoryValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
// Réplica de isSameHistoryState en lo relativo al recorrido y a la pestaña.
function makeIsSame({ trackSweep }) {
  return (a, b) =>
    a.mode === b.mode &&
    (!trackSweep || sameHistoryValue(a.sweepNodes ?? [], b.sweepNodes ?? []));
}
function fieldCommit(before, after, trackSweep) {
  // Devuelve true si el cambio crea un paso de historial.
  return !makeIsSame({ trackSweep })(before, after);
}

let ok = true;
function check(name, cond) {
  console.log((cond ? '  OK  ' : ' FAIL ') + name);
  if (!cond) ok = false;
}

console.log('=== Parte A: máquina del historial ===');
{
  const seq = ['s0', 's1', 'timer', 's2', 'timer', 'undo', 'undo', 'undo', 'redo', 'redo', 'redo'];
  const { trace, end } = runSequence(true, seq);
  trace.forEach((t, i) => console.log('  paso ' + i + ': ' + t));
  check('undo repetido llega a s0@0', trace[6] === 's0@0');
  check('undo extra no cambia (s0@0)', trace[7] === 's0@0');
  check('redo repetido vuelve a s2@2', trace[9] === 's2@2');
  check('redo extra no cambia (s2@2)', trace[10] === 's2@2');
  check('historial=[s0,s1,s2], index=2', JSON.stringify(end.history) === '["s0","s1","s2"]' && end.index === 2);
}
{
  const seq = ['s0', 's1', 'timer', 's2', 'undo']; // s2 pendiente, sin timer
  const { trace, end } = runSequence(true, seq);
  check('undo con cambio pendiente -> s1@1', trace[4] === 's1@1');
  check('historial=[s0,s1,s2], index=1', JSON.stringify(end.history) === '["s0","s1","s2"]' && end.index === 1);
}
{
  const seq = ['s0', 's1', 'timer', 'undo', 'redo'];
  const { trace } = runSequence(true, seq);
  check('un cambio: undo -> s0@0', trace[3] === 's0@0');
  check('un cambio: redo -> s1@1', trace[4] === 's1@1');
}
{
  // Con limpieza del pendiente en el timer NO se pierde ningún paso.
  const a = runSequence(false, ['s0', 's1', 'timer', 's2', 'timer', 'undo', 'undo']);
  const b = runSequence(true, ['s0', 's1', 'timer', 's2', 'timer', 'undo', 'undo']);
  check('limpiar el pendiente no altera el resultado',
    JSON.stringify(a.trace) === JSON.stringify(b.trace) &&
    JSON.stringify(a.end.history) === JSON.stringify(b.end.history));
}

console.log('\n=== Parte B: rastreo del Recorrido (bug real) ===');
{
  const before = { mode: 'extrude', sweepNodes: [{ id: 1, x: 0.1, y: 0.1, tilt: 0 }] };
  const after = { mode: 'extrude', sweepNodes: [
    { id: 1, x: 0.1, y: 0.1, tilt: 0 },
    { id: 2, x: 0.5, y: 0.5, tilt: 30 },
  ] };
  check('SIN rastrear sweep: a\u00f1adir v\u00e9rtice NO crea paso (bug)',
    fieldCommit(before, after, false) === false);
  check('CON rastrear sweep: a\u00f1adir v\u00e9rtice S\u00cd crea paso',
    fieldCommit(before, after, true) === true);

  const tiltBefore = { mode: 'extrude', sweepNodes: [{ id: 1, x: 0.1, y: 0.1, tilt: 0 }] };
  const tiltAfter = { mode: 'extrude', sweepNodes: [{ id: 1, x: 0.1, y: 0.1, tilt: 45 }] };
  check('CON rastrear sweep: cambiar inclinaci\u00f3n crea paso',
    fieldCommit(tiltBefore, tiltAfter, true) === true);

  const noop = { mode: 'extrude', sweepNodes: [{ id: 1, x: 0.1, y: 0.1, tilt: 0 }] };
  check('CON rastrear sweep: sin cambios NO crea paso',
    fieldCommit(before, noop, true) === false);
}

console.log('\n' + (ok ? 'RESULTADO: TODAS LAS COMPROBACIONES OK' : 'RESULTADO: HAY FALLOS'));
process.exit(ok ? 0 : 1);
