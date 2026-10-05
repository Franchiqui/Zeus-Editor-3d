/**
 * DIAG FX NEON — ¿El halo de neón (glow) sale de objetos NO seleccionados?
 * 1. Dos objetos; base sin FX.
 * 2. Brillo neón SOLO en el activo (objeto 0) → tinta sube.
 * 3. Cambiar el activo al objeto 0→1: el neón de 0 (ahora duplicado) debe
 *    seguir viéndose (antes desaparecía: el shell no se construía).
 * 4. Deseleccionar TODO: el neón del 0 debe seguir viéndose.
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

const R = crearResultados('DIAG FX NEON · halo de neón en duplicados');

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

  const base = await medirFrontal(page);
  console.log('  · tinta base=' + (base ? base.tinta : null));

  // Brillo neón SOLO en el objeto activo (0).
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Brillo neón', { exact: true }).first().click();
  await esperar(2200);
  const activo = await medirFrontal(page);
  console.log('  · tinta neón en activo=' + (activo ? activo.tinta : null));
  R.check(
    !!activo && !!base && activo.tinta > base.tinta * 1.05,
    `neón en el activo levanta la tinta (${base?.tinta} → ${activo?.tinta})`,
    `el neón ni siquiera salió en el activo (${base?.tinta} → ${activo?.tinta}) — BUG`
  );

  // Cambiar el activo al objeto 1: el 0 pasa a duplicado; su neón debe seguir.
  await page.click('[data-testid="scene-object-1"]');
  await esperar(2500);
  const cambio = await medirFrontal(page);
  console.log('  · tinta con activo=1 (neón en duplicado)=' + (cambio ? cambio.tinta : null));
  R.check(
    !!cambio && !!base && cambio.tinta > base.tinta * 1.05,
    `el neón del duplicado sigue viéndose (${base?.tinta} → ${cambio?.tinta})`,
    `al cambiar el activo se perdió el neón del 0 (${base?.tinta} → ${cambio?.tinta}): BUG`
  );

  // Deseleccionar todo: el neón de 0 debe seguir viéndose igual.
  await page.click('[data-testid="scene-object-check-1"]');
  await esperar(2500);
  const nada = await medirFrontal(page);
  console.log('  · tinta sin selección=' + (nada ? nada.tinta : null));
  R.check(
    !!nada && !!base && nada.tinta > base.tinta * 1.05,
    `sin selección, el neón sigue viéndose (${base?.tinta} → ${nada?.tinta})`,
    `sin selección se perdió el neón (${base?.tinta} → ${nada?.tinta}): BUG`
  );
} finally {
  await R.resumen({ browser, errores });
}