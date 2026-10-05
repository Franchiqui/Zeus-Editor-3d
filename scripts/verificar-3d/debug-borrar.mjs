/**
 * Debug puntual: crear cámara y borrarla desde la tarjeta.
 */
import { abrirEditor, esperar, numObjetos, crearResultados } from './comun.mjs';

const R = crearResultados('DEBUG borrar camara');
const { browser, page, errores } = await abrirEditor();

try {
  await page.click('[data-testid="add-camera-object-btn"]');
  await esperar(900);
  console.log('antes: ' + (await numObjetos(page)));
  await page.locator('button[title="Eliminar objeto"]').first().click();
  await esperar(600);
  const modal = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[data-testid="confirm-delete-btn"]'));
    return JSON.stringify({ confirm: btns.length, texto: document.body.textContent?.match(/¿Eliminar[^?]*\??/)?.[0]?.slice(0, 60) ?? '?' });
  });
  console.log('modal: ' + modal);
  await page.click('[data-testid="confirm-delete-btn"]');
  await esperar(1200);
  console.log('después: ' + (await numObjetos(page)));
  console.log('lista: ' + await page.evaluate(() => document.querySelector('[data-testid="scene-object-list"]')?.textContent?.slice(0, 120) ?? '(sin lista)'));
} finally {
  await R.resumen({ browser, errores });
}