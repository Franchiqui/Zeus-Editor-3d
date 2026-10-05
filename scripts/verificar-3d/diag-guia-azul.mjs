/**
 * DIAG GUÍA AZUL — reglas de los puntos de GUÍA del modo selección:
 *  - vértices y segmentos: AZUL OSCURO puro (0x1d4ed8, toneMapped:false).
 *  - caras: se DEJA el celeste claro (el usuario lo llamó «los blancos»).
 *
 * Señales:
 *  1. En modo vértices hay puntos azul-oscuro.
 *  2. En modo segmentos hay líneas azul-oscuro.
 *  3. En modo caras se conserva el celeste clarito.
 *  4. Ya no queda turquesa viejo (6,183,163) en ningún modo.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG GUÍA AZUL · vértices/segmentos azul oscuro, caras sin tocar');

// Cuenta por clases fijas (sin Function/eval: el CSP las bloquea).
const contar = (clase) =>
  page.evaluate((clase) => {
    let suma = 0;
    document.querySelectorAll('[data-testid="viewer-container"]')[0]
      ?.querySelectorAll('canvas').forEach((canvas) => {
        const off = document.createElement('canvas');
        off.width = canvas.width;
        off.height = canvas.height;
        const ctx = off.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(canvas, 0, 0);
        const d = ctx.getImageData(0, 0, off.width, off.height).data;
        for (let p = 0; p < d.length; p += 4) {
          const r = d[p], g = d[p + 1], b = d[p + 2];
          let ok = false;
          if (clase === 'azulOscuro') ok = b > 140 && b - r > 80 && g > 30 && g < 150;
          else if (clase === 'clarito') ok = r >= 110 && g >= 200 && b >= 180 && g - r > 40;
          else if (clase === 'turquesa') ok = Math.abs(r - 6) <= 25 && Math.abs(g - 183) <= 25 && Math.abs(b - 163) <= 25;
          else if (clase === 'azulCualquiera') ok = b > 140 && b - r > 70 && b - g > 30;
          if (ok) suma++;
        }
      });
    return suma;
  }, clase);

const { browser, page, errores } = await abrirEditor({ consola: false });
try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);
  await page.locator('button[title*="Seleccionar caras"]').first().click();
  await esperar(700);

  await page.selectOption('select[title*="Qué seleccionar"]', 'vertice');
  await esperar(700);
  const azulVert = await contar('azulOscuro');
  console.log('vértices · px azul oscuro:', azulVert);
  R.check(azulVert > 30, `guía de VÉRTICES en azul oscuro (${azulVert} px)`, `solo ${azulVert} px azul oscuro — la guía de vértices sigue floja — BUG`);

  await page.selectOption('select[title*="Qué seleccionar"]', 'segmento');
  await esperar(700);
  const azulSeg = await contar('azulOscuro');
  console.log('segmentos · px azul oscuro:', azulSeg);
  R.check(azulSeg > 30, `guía de SEGMENTOS en azul oscuro (${azulSeg} px)`, `solo ${azulSeg} px azul oscuro — BUG`);

  await page.selectOption('select[title*="Qué seleccionar"]', 'cara');
  await esperar(700);
  const claritoCara = await contar('clarito');
  console.log('caras · px celeste clarito:', claritoCara);
  R.check(claritoCara > 30, `guía de CARAS se conserva celeste clarito (${claritoCara} px)`, `solo ${claritoCara} px — la guía de caras se torcó — BUG`);

  const turquesa = await contar('turquesa');
  console.log('turquesa viejo restante:', turquesa);
  R.check(turquesa < 20, `ya casi no queda turquesa viejo (${turquesa} px)`, `quedan ${turquesa} px turquesa — BUG`);

  await page.screenshot({ path: 'guia-azul.png' });
} finally {
  await R.resumen({ browser, errores });
}
