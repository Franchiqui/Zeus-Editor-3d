/**
 * DIAG FX ANTORCHAS — el fuego como «antorcha»: los focos de emisión
 * colocados con clic. Comprueba qué cambios del usuario DESTRUYEN los
 * focos (el fuego pasa a emitir de toda la malla = partículadas):
 *   a) apagar y encender «Llamas» en el menú FX
 *   b) cambiar parámetros en «Configuración de FX»
 *   c) crear pista de efecto + fotograma en el editor de movimiento
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG FX ANTORCHAS · los focos sobreviven a los cambios');

const { browser, page, errores } = await abrirEditor();

/** Vuelca efectos por objeto (tipo, activo, nº de focos) vía React fiber. */
const volcarEfectos = () =>
  page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (const cont of conts) {
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      const mejor = [];
      const visit = (fib, prof) => {
        if (!fib || prof > 70) return;
        const p = fib.memoizedProps?.objects ?? fib.memoizedProps?.sceneObjects;
        if (Array.isArray(p) && p.length > mejor.length) {
          mejor.push(
            ...p
              .filter((o) => o && o.efectos)
              .map((o) => ({
                id: o.id,
                efectos: o.efectos.map((e) => ({
                  tipo: e.tipo,
                  activo: !!e.activo,
                  focos: (e.focos ?? []).length,
                })),
              }))
          );
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
      // Quedarse con la lista más larga (la escena entera).
      if (mejor.length > 0) return mejor;
    }
    return [];
  });

const focosFire = (datos) =>
  datos.filter((o) => o.efectos.some((e) => e.tipo === 'fire'))
    .map((o) => o.efectos.filter((e) => e.tipo === 'fire'))
    .flat()
    .reduce((acc, e) => acc + e.focos, 0);

try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);

  // ------------------------------------------ 1. Llamas ON + colocar foco
  // Menú FX del espectador: el botón con texto «FX» (toolbar). Al elegir
  // una opción el menú se cierra solo (menú Radix): se abre para cada
  // acción.
  const botonFx = page.locator('button', { hasText: 'FX' }).first();
  await botonFx.click();
  await esperar(500);
  await page.getByText('Llamas', { exact: true }).first().click();
  await esperar(600);

  // Colocar efecto → clic en el centro del visor (sobre el objeto).
  await botonFx.click();
  await esperar(500);
  await page.getByText('Colocar efecto (clic en el objeto)').first().click();
  await esperar(700); // el clic de selección cierra el menú y activa el modo
  const visor = page.locator('[data-testid="viewer-container"]').first();
  const vbox = await visor.boundingBox();
  await page.mouse.click(vbox.x + vbox.width / 2, vbox.y + vbox.height / 2);
  await esperar(800);

  let datos = await volcarEfectos();
  const focosBase = focosFire(datos);
  R.check(
    focosBase >= 1,
    `foco de fuego colocado (focos: ${focosBase})`,
    `no se colocó ningún foco (eff: ${JSON.stringify(datos)}) — FLUJO`
  );

  // ------------------------------- 2. Apagar «Llamas» → ¿sobreviven focos?
  await botonFx.click();
  await esperar(400);
  await page.getByText('Llamas', { exact: true }).first().click();
  await esperar(700);
  datos = await volcarEfectos();
  const trasApagar = focosFire(datos);
  R.check(
    trasApagar >= 1,
    `focos APAGANDO «Llamas» sobreviven (${trasApagar})`,
    `APAGAR «Llamas» destruye los focos (${trasApagar}) — BUG`
  );

  // -------------------------------- 3. Encender «Llamas» otra vez
  await botonFx.click();
  await esperar(400);
  await page.getByText('Llamas', { exact: true }).first().click();
  await esperar(700);
  datos = await volcarEfectos();
  const trasEncender = focosFire(datos);
  R.check(
    trasEncender >= 1,
    `focos sobreviven a apagar+encender (${trasEncender})`,
    `apagar+encender pierde los focos (${trasEncender}) → fuego esparcido — BUG`
  );

  // -------------------------- 4. Cambiar parámetros en Config de FX
  await botonFx.click();
  await esperar(400);
  await page.getByText('Configuración de FX').first().click();
  await esperar(700);
  // Partículas (NumberField): toca el slider → onValueChange.
  const filaParticulas = page
    .locator('label', { hasText: 'Partículas' })
    .locator('..')
    .locator('input[type="number"]');
  await filaParticulas.first().fill('210');
  await esperar(600);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cerrar', exact: true })
    .first()
    .click();
  await esperar(700);
  datos = await volcarEfectos();
  const trasParams = focosFire(datos);
  R.check(
    trasParams >= 1,
    `focos sobreviven a la configuración de FX (${trasParams})`,
    `la configuración de FX pierde los focos (${trasParams}) — BUG`
  );

  // --------------------------- 5. Editor de movimiento: pista de efecto
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(600);
  await page.click('[data-testid="open-motion-editor"]');
  await esperar(1500);
  const selFuego = page.locator('select', { has: page.locator('option[value="fire"]') });
  await selFuego.first().selectOption('fire');
  await esperar(500);
  await page.getByText('Añadir pista de efecto', { exact: true }).first().click();
  await esperar(1200);
  datos = await volcarEfectos();
  const trasPista = focosFire(datos);
  R.check(
    trasPista >= 1,
    `focos sobreviven a crear la pista de efecto (${trasPista})`,
    `crear la pista de efecto pierde los focos (${trasPista}) — BUG`
  );
} finally {
  await R.resumen({ browser, errores });
}