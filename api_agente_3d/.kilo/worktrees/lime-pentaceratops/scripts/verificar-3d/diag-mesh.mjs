/** Diagnóstico 4: comparar la malla guardada como dueño (Texto) vs congelada (Escena). */
import { abrirEditor, esperar, clicTab, escribirTexto } from './comun.mjs';
import { readFileSync } from 'node:fs';

const { browser, page } = await abrirEditor();

async function guardar(tag) {
  await page.evaluate(() => {
    const triggers = [...document.querySelectorAll('button')];
    const b = triggers.find((x) => (x.getAttribute('title') || '').includes('Más acciones'));
    if (b) b.click();
  });
  await esperar(300);
  // El item "Guardar" del menú desplegable
  await page.click('text=Guardar objeto 3D', { timeout: 3000 }).catch(async () => {
    await page.click('text=Guardar', { timeout: 3000 });
  });
  await esperar(300);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find((x) => /guardar|save/i.test(x.textContent || ''));
      if (b) b.click();
    }),
  ]);
  const ruta = await download.path();
  const datos = JSON.parse(readFileSync(ruta, 'utf-8'));
  const o = datos.sceneObjects?.[0];
  console.log(`${tag}: verts=${o?.mesh?.vertices?.length} caras=${o?.mesh?.faces?.length} faceColors=${o?.mesh?.faceColors?.length} smooth=${o?.smooth} mode=${o?.mode} text=${JSON.stringify(datos.text)}`);
  return datos;
}

await clicTab(page, 'text');
await escribirTexto(page, 'HOLA');
await esperar(2200);

await guardar('A (dueño en Texto)');

await clicTab(page, 'scene');
await esperar(500);
await guardar('B (congelado en Escena)');

await browser.close();
process.exit(0);