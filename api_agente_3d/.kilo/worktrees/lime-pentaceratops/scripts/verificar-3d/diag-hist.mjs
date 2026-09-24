/** Diagnóstico 2: histograma de colores del visor frontal (no fondo). */
import { abrirEditor, esperar, clicTab } from './comun.mjs';

const { browser, page } = await abrirEditor();

const hist = () =>
  page.evaluate(async () => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
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
    // Fondo: esquina superior-izquierda
    const f0 = [d[0], d[1], d[2]];
    const cubos = new Map();
    let noFondo = 0;
    for (let i = 0; i < d.length; i += 8) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (Math.abs(r - f0[0]) + Math.abs(g - f0[1]) + Math.abs(b - f0[2]) < 45) continue;
      noFondo++;
      const k = `${r >> 4},${g >> 4},${b >> 4}`;
      cubos.set(k, (cubos.get(k) || 0) + 1);
    }
    const top = [...cubos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([k, n]) => `${k}:${n}`);
    return { noFondo, top };
  });

console.log('escena inicial:', JSON.stringify(await hist()));

await clicTab(page, 'text');
await page.fill('[data-testid="text-input"]', 'HOLA');
await esperar(400);
console.log('texto t=0.4s:', JSON.stringify(await hist()));
await esperar(2000);
console.log('texto t=2.4s:', JSON.stringify(await hist()));

await clicTab(page, 'scene');
console.log('en escena:', JSON.stringify(await hist()));

await browser.close();
process.exit(0);