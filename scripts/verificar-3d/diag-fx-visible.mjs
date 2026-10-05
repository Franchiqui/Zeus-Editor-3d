/**
 * DIAG FX VISIBLE — ¿Se VEN los efectos de los objetos que NO son el activo?
 * 1. Dos objetos; medir tinta base del visor frontal.
 * 2. Multiselección + fuego en ambos → la tinta debe crecer (partículas
 *    del duplicado también).
 * 3. Cambiar el activo → el fuego del otro objeto debe seguir viéndose.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  medirFrontal,
  numObjetos,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG FX VISIBLE · efectos visibles en objetos no activos');

const { browser, page, errores } = await abrirEditor();

try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await page.click('[data-testid="copy-object-btn"]');
  await esperar(600);
  await clicTab(page, 'scene');
  await esperar(900);
  await page.click('[data-testid="paste-object-btn"]');
  await esperar(1400);
  R.check((await numObjetos(page)) === 2, 'dos objetos', 'no hay 2 objetos — BUG');

  // Dónde está cada objeto (para saber si se solapan en la vista frontal).
  const pos = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (const cont of conts) {
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      const out = [];
      const visit = (fib, prof) => {
        if (!fib || prof > 60) return;
        const p = fib.memoizedProps;
        if (p && Array.isArray(p.sceneObjects) && p.sceneObjects.length) {
          for (const o of p.sceneObjects) {
            out.push({ name: o.name, px: o.transform.px, py: o.transform.py, pz: o.transform.pz });
          }
          return out;
        }
        const a = visit(fib.child, prof + 1);
        if (a) return a;
        return visit(fib.sibling, prof + 1);
      };
      const r = visit(cont[llave], 0);
      if (r) return r;
    }
    return [];
  });
  console.log('  · objetos: ' + JSON.stringify(pos));

  const base = await medirFrontal(page);
  console.log('  · tinta base=' + (base ? base.tinta : null));

  // Multiselección + fuego en ambos.
  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(600);
  await page.click('[data-testid="scene-object-check-1"]');
  await esperar(800);
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Llamas', { exact: true }).first().click();
  await esperar(2500); // que las partículas vivan un rato

  const conFuego = await medirFrontal(page);
  console.log('  · tinta con fuego=' + (conFuego ? conFuego.tinta : null));
  R.check(
    !!conFuego && !!base && conFuego.tinta > base.tinta * 1.05,
    `con fuego en ambos la tinta crece (${base?.tinta} → ${conFuego?.tinta})`,
    `con fuego la tinta NO creció (${base?.tinta} → ${conFuego?.tinta}): el fuego del duplicado no se ve — BUG`
  );

  // Cambiar el activo: el fuego del otro debe seguir viéndose.
  await page.click('[data-testid="scene-object-0"]');
  await esperar(2200);
  const trasCambio = await medirFrontal(page);
  console.log('  · tinta tras cambiar activo=' + (trasCambio ? trasCambio.tinta : null));
  R.check(
    !!trasCambio && !!base && trasCambio.tinta > base.tinta * 1.05,
    `tras cambiar el activo, el fuego del otro sigue visible (${base?.tinta} → ${trasCambio?.tinta})`,
    `tras cambiar el activo la tinta volvió a la base (${base?.tinta} → ${trasCambio?.tinta}): se pierde el fuego — BUG`
  );
} finally {
  await R.resumen({ browser, errores });
}