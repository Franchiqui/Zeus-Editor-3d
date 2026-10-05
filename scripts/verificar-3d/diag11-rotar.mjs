/**
 * DIAG11 — reproduce el error "Maximum update depth exceeded" al pulsar
 * ROTAR en la ventana 3D: captura pageerror + consola con la traza.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG11 · error al pulsar Rotar');

const { browser, page, errores } = await abrirEditor();
const fallos = [];
page.on('pageerror', (err) => {
  const t = String(err?.message || err);
  if (t.includes('Maximum update depth')) {
    fallos.push(t.slice(0, 300));
    console.log('  ⚠ PAGEERROR: ' + t.slice(0, 300));
    if (err?.stack) {
      console.log(
        '    traza: ' +
          err.stack
            .split('\n')
            .slice(0, 12)
            .join('\n             ')
      );
    }
  }
});
page.on('console', (msg) => {
  const t = msg.text();
  if (t.includes('Maximum update depth') || t.includes('update depth')) {
    console.log('  ⚠ CONSOLA: ' + t.slice(0, 600));
  }
});

try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2200);
  await clicTab(page, 'scene');
  await esperar(900);

  // Pulsa ROTAR y observa 3 s.
  const rotar = page.locator('button[title="Rotar"]').last();
  await rotar.click({ force: true });
  await esperar(3000);

  R.check(
    fallos.length === 0,
    'pulsar Rotar NO dispara "Maximum update depth exceeded"',
    'Rotar disparó el bucle ' + fallos.length + ' veces — BUG'
  );

  // Pulsa otra vez (apagar) y reafirma.
  await rotar.click({ force: true });
  await esperar(800);
  R.check(
    fallos.length === 0,
    'apagar Rotar tampoco dispara el bucle',
    'el bucle apareció al apagar — BUG'
  );
} finally {
  await R.resumen({ browser, errores });
}