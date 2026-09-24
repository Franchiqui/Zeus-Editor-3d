/** Diagnóstico: tinta de las 4 vistas en cada estado clave. */
import { abrirEditor, esperar, clicTab, escribirTexto, numObjetos, tabActiva } from './comun.mjs';

const { browser, page } = await abrirEditor();

const medir = () =>
  page.evaluate(async () => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const fuera = [];
    for (let i = 0; i < conts.length; i++) {
      const canvas = conts[i].querySelector('canvas');
      fuera.push(canvas ? `${canvas.width}x${canvas.height}` : 'sin canvas');
    }
    const tinta = await Promise.all(
      [...conts].map(async (cont) => {
        const canvas = cont.querySelector('canvas');
        if (!canvas) return -1;
        const url = canvas.toDataURL('image/png');
        const img = new Image();
        await new Promise((r) => { img.onload = r; img.onerror = r; img.src = url; });
        const off = document.createElement('canvas');
        off.width = canvas.width; off.height = canvas.height;
        const ctx = off.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, off.width, off.height).data;
        let t = 0;
        for (let j = 0; j < d.length; j += 4) if (Math.min(d[j], d[j+1], d[j+2]) > 90) t++;
        return t;
      })
    );
    return { paneles: fuera, tinta };
  });

console.log('escena inicial:', JSON.stringify(await medir()));

await clicTab(page, 'text');
console.log('en texto (vacío):', JSON.stringify(await medir()));

await escribirTexto(page, 'HOLA');
console.log('texto HOLA escrito:', JSON.stringify(await medir()));
await esperar(1500);
console.log('  tras +1.5s:', JSON.stringify(await medir()));

await clicTab(page, 'scene');
console.log('de vuelta en escena:', JSON.stringify(await medir()));
console.log('objetos:', await numObjetos(page));

await clicTab(page, 'text');
console.log('re-entrado en texto:', JSON.stringify(await medir()));
const valor = await page.inputValue('[data-testid="text-input"]').catch(() => 'SIN INPUT');
console.log('valor del input:', valor);

await browser.close();
process.exit(0);