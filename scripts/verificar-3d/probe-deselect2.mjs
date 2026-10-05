/** PROBE 2 — ¿Cambia la FIGURA (sin efectos) al deseleccionar? */
import { abrirEditor, esperar, clicTab, escribirTexto, medirFrontal } from './comun.mjs';

const { browser, page } = await abrirEditor();
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
  const m0 = await medirFrontal(page);
  console.log('1 objeto activo (sin fx): tinta=' + m0?.tinta);

  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(1500);
  const m1 = await medirFrontal(page);
  console.log('2 seleccionados (sin fx): tinta=' + m1?.tinta);

  // Deseleccionar el activo → nada seleccionado.
  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(2000);
  const m2 = await medirFrontal(page);
  console.log('nada seleccionado (sin fx): tinta=' + m2?.tinta);
} finally {
  await browser.close();
}