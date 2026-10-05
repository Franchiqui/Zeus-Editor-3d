/** PROBE 3 — objetos SEPARADOS: ¿qué fuego sobrevive al deseleccionar? */
import { abrirEditor, esperar, clicTab, escribirTexto, numObjetos } from './comun.mjs';

const { browser, page } = await abrirEditor();

/** Tinta por mitades del visor frontal (izq/der). */
async function tintaMitades(page, etiqueta) {
  const out = await page.evaluate(() => {
    const canvas = document.querySelector(
      '[data-testid="viewer-container"] canvas'
    );
    if (!canvas) return null;
    const w = canvas.width;
    const h = canvas.height;
    const ctx = document.createElement('canvas');
    ctx.width = w;
    ctx.height = h;
    const g = ctx.getContext('2d');
    g.drawImage(canvas, 0, 0);
    const fondo = g.getImageData(2, 2, 1, 1).data;
    const tinta = (x0, x1) => {
      let n = 0;
      const img = g.getImageData(x0, 0, x1 - x0, h).data;
      for (let i = 0; i < img.length; i += 4) {
        const d =
          Math.abs(img[i] - fondo[0]) +
          Math.abs(img[i + 1] - fondo[1]) +
          Math.abs(img[i + 2] - fondo[2]);
        if (d > 135) n++;
      }
      return n;
    };
    return { izq: tinta(0, Math.floor(w / 2)), der: tinta(Math.floor(w / 2), w) };
  });
  console.log('  · [' + etiqueta + '] izq=' + out?.izq + ' der=' + out?.der);
  return out;
}

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
  R_check(await numObjetos(page));
  function R_check(n) {
    console.log('objetos=' + n);
  }
  // Separar el objeto 1 al activarlo y moverlo en X.
  await page.click('[data-testid="scene-object-1"]');
  await esperar(900);
  await page.fill('[data-testid="object-pos-x"]', '2.5');
  await esperar(900);
  // Volver al objeto 0 como activo.
  await page.click('[data-testid="scene-object-0"]');
  await esperar(1200);

  await tintaMitades(page, 'base sin fx');
  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(500);
  await page.click('[data-testid="scene-object-check-1"]');
  await esperar(700);
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Llamas', { exact: true }).first().click();
  await esperar(2500);
  const ambos = await tintaMitades(page, 'fuego ambos (seleccionados)');

  await page.click('[data-testid="scene-object-check-1"]');
  await esperar(2200);
  const solo0 = await tintaMitades(page, 'desmarcado 1 (activo 0)');

  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(2200);
  const nada = await tintaMitades(page, 'desmarcado todo');
} finally {
  await browser.close();
}