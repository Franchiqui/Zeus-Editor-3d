/**
 * DIAG7 — Listas de objetos:
 * 1. Las dos listas de la columna de arriba (select de «objeto activo»
 *    y desplegable de multiselección) ya NO existen.
 * 2. Las tarjetas de la lista de Escena traen un cuadradito de
 *    multiselección que llena/vacía selectedObjectIds (vía fiber).
 * 3. El rectángulo discontinuo del visor (arrastrar con el ratón)
 *    sigue cableado al mismo estado de selección.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG7 · listas arriba retiradas + casillas en Escena');

/** Lee p.selectedObjectIds del fiber del visor (subiendo y bajando). */
async function leerSeleccion(page, etiqueta) {
  const sel = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (let c = 0; c < conts.length; c++) {
      const cont = conts[c];
      if (!cont) continue;
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      let hallado = null;
      const visit = (fib, prof) => {
        if (!fib || prof > 60 || hallado) return;
        const p = fib.memoizedProps;
        if (p && Array.isArray(p.selectedObjectIds)) {
          hallado = p.selectedObjectIds;
          return;
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      // Subir hacia la raíz y, en cada nivel, también descender: el
      // prop vive en un antecesor del visor (Viewer3D).
      for (let f = cont[llave]; f && !hallado; f = f.return) visit(f, 0);
      if (hallado) return hallado;
    }
    return null;
  }, []);
  // Estado de las casillas en el DOM (qué tarjeta dice estar marcada).
  const casillas = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="scene-object-check-"]')].map(
      (el) => !!el.checked
    )
  );
  console.log(
    '  · [' + etiqueta + '] casillas: ' + JSON.stringify(casillas) +
      ' · seleccionados: ' + JSON.stringify(sel)
  );
  return sel || [];
}

const { browser, page, errores } = await abrirEditor();

try {
  // 1. Un objeto (texto con fuente de color).
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);

  // 2. Copiar y pegar para tener DOS objetos.
  await page.click('[data-testid="copy-object-btn"]');
  await esperar(600);
  await clicTab(page, 'scene');
  await esperar(900);
  await page.click('[data-testid="paste-object-btn"]');
  await esperar(1400);

  // 3. Las dos listas de arriba ya no existen.
  const nSelect = await page.locator(
    '[data-testid="active-object-select"]'
  ).count();
  R.check(nSelect === 0,
    'sin la lista «objeto activo» de arriba (0)',
    'la lista «objeto activo» SIGUE arriba (' + nSelect + ') — BUG');
  const nBoxSelect = await page.locator('svg.lucide-box-select').count();
  R.check(nBoxSelect === 0,
    'sin el desplegable de multiselección en lo alto (0)',
    'el desplegable de multiselección SIGUE en lo alto (' + nBoxSelect + ') — BUG');

  // 4. Las tarjetas de Escena traen su cuadradito de multiselección
  //    (clic forzado: el indicador de desarrollo de Next intercepta).
  const nChk = await page.locator('[data-testid="scene-object-check-0"]').count();
  R.check(nChk === 1,
    'Escena: la tarjeta trae su cuadradito de selección (' + nChk + ')',
    'Escena: la tarjeta no trae el cuadradito (' + nChk + ') — BUG');

  // 5. Marcar ambos cuadraditos → multiselección de 2.
  //    (Clic por evaluate: el indicador de desarrollo de Next tapa
  //    la parte baja de la columna y los clics con `force` caen en él.)
  const marcar = (n) =>
    page.evaluate((idx) => {
      const el = document.querySelector(
        `[data-testid="scene-object-check-${idx}"]`
      );
      if (!el) throw new Error('sin casilla ' + idx);
      el.click();
    }, n);
  await marcar(0);
  await esperar(500);
  await leerSeleccion(page, 'tras 1er clic (check-0)');
  await marcar(1);
  await esperar(500);
  const sel2 = await leerSeleccion(page, 'ambos marcados');
  R.check(sel2 && sel2.length === 2,
    'marcando las 2 tarjetas: 2 objetos multiseleccionados',
    'marcando las 2 tarjetas: ' + JSON.stringify(sel2) + ' — BUG');

  // 6. Desmarcar la primera → queda 1.
  await marcar(0);
  await esperar(500);
  const sel1 = await leerSeleccion(page, 'tras desmarcar la 1ª');
  R.check(sel1 && sel1.length === 1,
    'desmarcando la 1ª: queda 1 seleccionado',
    'tras desmarcar la 1ª: ' + JSON.stringify(sel1) + ' — BUG');

  // 7. El rectángulo discontinuo del visor escribe en el MISMO estado:
  //    activar el modo en el ÚLTIMO visor (el 3D grande) y arrastrar
  //    un rectángulo que cubra todo.
  const toggle = page
    .locator(
      'button[title="Seleccionar múltiples objetos (arrastra en la ventana)"]'
    )
    .last();
  await toggle.click({ force: true });
  await esperar(600);
  const lienzo = page
    .locator('[data-testid="viewer-container"] canvas')
    .last();
  const caja = await lienzo.boundingBox();
  if (caja) {
    await page.mouse.move(caja.x + 8, caja.y + 8);
    await page.mouse.down();
    await page.mouse.move(caja.x + caja.width - 8, caja.y + caja.height - 8, {
      steps: 12,
    });
    await page.mouse.up();
    await esperar(900);
  }
  const selRect = await leerSeleccion(page, 'tras arrastrar el rectángulo');
  R.check(selRect && selRect.length >= 1,
    'el rectángulo del visor escribe en la misma selección (' +
      JSON.stringify(selRect) + ')',
    'el rectángulo del visor no seleccionó — revisar acoplado');
  await toggle.click({ force: true }); // dejar el modo apagado
} finally {
  await R.resumen({ browser, errores });
}