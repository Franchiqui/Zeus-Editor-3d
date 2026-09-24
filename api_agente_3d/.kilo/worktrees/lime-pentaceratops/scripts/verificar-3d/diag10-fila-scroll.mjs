/**
 * DIAG10 — Columna Escena con scroll + tarjeta en UNA fila:
 * 1. La tarjeta del objeto tiene UN solo hijo-fila (sin datos apilados)
 *    y UNA sola insignia de pestaña; casilla+botones dentro de esa fila.
 * 2. La columna (envoltorio con custom-scrollbar) desborda y puede
 *    desplazarse (scrollHeight > clientHeight).
 * 3. La lista de objetos tiene su propio scroll con tope.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG10 · scroll de columna + tarjeta en fila');

const { browser, page, errores } = await abrirEditor();

try {
  // 1. Cuatro objetos para desbordar la columna.
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2200);
  // Copiar ANTES de saltar a Escena: sin copia, el pegado está deshabilitado.
  await page.click('[data-testid="copy-object-btn"]');
  await esperar(600);
  await clicTab(page, 'scene');
  await esperar(900);
  for (let i = 0; i < 3; i++) {
    await page.click('[data-testid="paste-object-btn"]');
    await esperar(1100);
  }

  // 2. Geometría de la columna y de la lista.
  const geo = await page.evaluate(() => {
    const lista = document.querySelector(
      '[data-testid="scene-object-list"]'
    );
    if (!lista) return null;
    let env = lista.parentElement;
    while (env) {
      const cs = getComputedStyle(env);
      if (
        cs.overflowY === 'auto' &&
        env.className.includes('custom-scrollbar')
      ) {
        break;
      }
      env = env.parentElement;
    }
    const csL = getComputedStyle(lista);
    return {
      columna: env
        ? {
            scrollHeight: env.scrollHeight,
            clientHeight: env.clientHeight,
            overflowY: getComputedStyle(env).overflowY,
            alto: env.getBoundingClientRect().height,
          }
        : null,
      lista: {
        scrollHeight: lista.scrollHeight,
        clientHeight: lista.clientHeight,
        maxHeight: csL.maxHeight,
        overflowY: csL.overflowY,
      },
      numTarjetas: lista.querySelectorAll(
        '[data-testid^="scene-object-"]:not([data-testid^="scene-object-check"])'
      ).length,
    };
  });
  console.log('  · geometría: ' + JSON.stringify(geo));
  R.check(
    !!geo && geo.numTarjetas === 4,
    'hay 4 objetos en la lista',
    'objetos: ' + JSON.stringify(geo) + ' — BUG'
  );
  R.check(
    !!geo?.columna && geo.columna.scrollHeight > geo.columna.clientHeight,
    'la columna Escena DESBORDA (scrollHeight ' +
      geo?.columna?.scrollHeight + ' > clientHeight ' +
      geo?.columna?.clientHeight + ')',
    'la columna NO desborda: ' + JSON.stringify(geo?.columna) + ' — BUG'
  );
  R.check(
    !!geo?.columna && geo.columna.overflowY === 'auto',
    'la columna tiene overflow-y: auto',
    'overflowY=' + geo?.columna?.overflowY + ' — BUG'
  );

  // 3. La tarjeta: una sola fila hija, una sola insignia.
  const tarjeta = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="scene-object-0"]');
    if (!c) return null;
    const insignias = [
      ...c.querySelectorAll('span'),
    ].filter((s) => s.className.includes('text-[9px] px-1.5')).length;
    return {
      hijos: c.children.length,
      insignias,
      tieneCasilla: !!c.querySelector('[data-testid="scene-object-check-0"]'),
      botones: [...c.querySelectorAll('button')].filter((b) =>
        ['🔴', '🟢', '🔒', '🔓'].some((e) => b.textContent?.includes(e))
      ).length,
      basura: !![...c.querySelectorAll('button')].find((b) =>
        b.querySelector('svg')
      ),
      alto: c.getBoundingClientRect().height,
    };
  });
  console.log('  · tarjeta: ' + JSON.stringify(tarjeta));
  R.check(
    tarjeta && tarjeta.hijos === 1,
    'la tarjeta tiene UN solo hijo (la fila única)',
    'la tarjeta tiene ' + tarjeta?.hijos + ' hijos apilados — BUG'
  );
  R.check(
    tarjeta && tarjeta.insignias === 1,
    'la tarjeta tiene UNA sola insignia de pestaña',
    'insignias: ' + tarjeta?.insignias + ' (duplicada) — BUG'
  );
  R.check(
    tarjeta && tarjeta.tieneCasilla && tarjeta.botones === 2 && tarjeta.basura,
    'casilla + ocultar/congelar + borrar dentro de la fila',
    'controles: ' + JSON.stringify(tarjeta) + ' — BUG'
  );
  R.check(
    tarjeta && tarjeta.alto < 34,
    'la tarjeta mide menos de 34px de alto (baja)',
    'alto de la tarjeta: ' + tarjeta?.alto + 'px — BUG'
  );
} finally {
  await R.resumen({ browser, errores });
}