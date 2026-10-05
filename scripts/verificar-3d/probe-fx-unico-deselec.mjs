/**
 * PROBE: fuego en UN objeto → deseleccionar todo → ¿sigue viéndose?
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  medirFrontal,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('PROBE FX UNICO + DESELECCION');

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

  // Fuego SOLO en el objeto activo (selección simple).
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Llamas', { exact: true }).first().click();
  await esperar(2500);
  const base = await medirFrontal(page);
  console.log('  · tinta con fuego (seleccionado)=' + (base ? base.tinta : null));

  // Deseleccionar todo.
  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(2500);
  const nada = await medirFrontal(page);
  console.log('  · tinta sin selección=' + (nada ? nada.tinta : null));
  R.check(
    !!nada && !!base && nada.tinta > base.tinta * 0.9,
    `el fuego sigue visible sin selección (${base?.tinta} → ${nada?.tinta})`,
    `se apagó al deseleccionar (${base?.tinta} → ${nada?.tinta}) — BUG`
  );
} finally {
  await R.resumen({ browser, errores });
}