/** Diagnóstico 3: caja envolvente de la figura en las vistas, Texto vs Escena. */
import { abrirEditor, esperar, clicTab, escribirTexto } from './comun.mjs';

const { browser, page } = await abrirEditor();

const caja = (idx) =>
  page.evaluate(async (i) => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[i];
    const canvas = cont && cont.querySelector('canvas');
    if (!canvas) return null;
    const url = canvas.toDataURL('image/png');
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.onerror = r; img.src = url; });
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    const f0 = [d[0], d[1], d[2]];
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, n = 0;
    let muestra = null;
    for (let y = 0; y < off.height; y++) {
      for (let x = 0; x < off.width; x++) {
        const o = (y * off.width + x) * 4;
        if (Math.abs(d[o] - f0[0]) + Math.abs(d[o+1] - f0[1]) + Math.abs(d[o+2] - f0[2]) < 45) continue;
        n++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (!muestra && x > (minX + maxX) / 2) muestra = [d[o], d[o+1], d[o+2]];
      }
    }
    return { w: off.width, h: off.height, n, caja: [minX, minY, maxX, maxY], muestra };
  }, idx);

await clicTab(page, 'text');
await escribirTexto(page, 'HOLA');
await esperar(2200);
console.log('TEXTO frontal:', JSON.stringify(await caja(0)));
console.log('TEXTO 3d     :', JSON.stringify(await caja(3)));

await clicTab(page, 'scene');
console.log('ESCENA frontal:', JSON.stringify(await caja(0)));
console.log('ESCENA 3d     :', JSON.stringify(await caja(3)));

await browser.close();
process.exit(0);