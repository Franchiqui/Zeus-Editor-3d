/**
 * PROBE flujo real: cargar Cubo.zeus → Puntos → clics en las ventanas
 * plana FRENTE (0) y 3D libre (3). Cuenta la selección después de cada
 * clic y volcara la malla al final si hay edición.
 */
import { abrirEditor, esperar } from './comun.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CUBO = path.join(AQUI, '..', '..', 'public', 'Obj-3D', 'Cubo.zeus');

const { browser, page, errores } = await abrirEditor();

// Capturar consola (instrumentación temporal [ZPICK] del visor).
page.on('console', (msg) => {
  const t = msg.text();
  if (t.includes('[ZPICK]')) console.log('  🖥', t);
});

const textoBarra = () => page.evaluate(() => {
  const bar = document.querySelector('[data-testid="face-select-bar"]');
  return bar ? bar.textContent?.replace(/\s+/g, ' ').slice(0, 60) : '(sin barra)';
});

async function recuadro(idx) {
  return page.evaluate((i) => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const canvas = conts[i]?.querySelector('canvas');
    if (!canvas) return null;
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    const oF = ((off.height - 3) * off.width + 3) * 4;
    const bg = [d[oF], d[oF + 1], d[oF + 2]];
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, tinta = 0;
    for (let y = 0; y < off.height; y += 2) {
      for (let x = 0; x < off.width; x += 2) {
        const o = (y * off.width + x) * 4;
        if (Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]) >= 45) {
          tinta++;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (tinta < 12) return null;
    const r = conts[i].getBoundingClientRect();
    return {
      css: { w: canvas.clientWidth, h: canvas.clientHeight, x: r.x, y: r.y },
      buf: { w: canvas.width, h: canvas.height },
      q: { x0, x1, y0, y1 },
    };
  }, idx);
}

async function clicCima(idx, lado, insetPx) {
  const c = await recuadro(idx);
  const sx = c.css.w / c.buf.w;
  const sy = c.css.h / c.buf.h;
  const cx = lado === 'TL' ? c.q.x0 + insetPx : c.q.x1 - insetPx;
  const cy = c.q.y0 + insetPx;
  await page.mouse.click(c.css.x + cx * sx, c.css.y + cy * sy);
  await esperar(600);
  return await textoBarra();
}

try {
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-obj3d-modal"]');
  await esperar(800);
  await page.setInputFiles('[data-testid="zeus-file-input"]', CUBO);
  await esperar(4000);
  await page.keyboard.press('Escape');
  await esperar(600);

  await page.click('[data-testid="scene-object-0"]');
  await esperar(1000);
  await page.click('[data-testid="subselect-vertice"]');
  await esperar(900);

  // Ventana plana FRENTE: reintentar insets sobre la esquina TL hasta marcar.
  let bar = await textoBarra();
  console.log('barra inicial:', bar);
  let okFrente = false;
  for (const inset of [8, 16, 30, 50, 80]) {
    bar = await clicCima(0, 'TL', inset);
    const n = parseInt((bar.match(/(\d+)\s*v[eé]rtice/) || [])[1] ?? '0', 10);
    console.log(`  FRENTE inset ${inset}: → ${bar}`);
    if (n > 0) { okFrente = true; break; }
  }
  if (okFrente) {
    let antes = '';
    for (const inset of [8, 16, 30, 50, 80]) {
      await page.keyboard.down('Shift');
      antes = await clicCima(0, 'TR', inset);
      await page.keyboard.up('Shift');
      const n = parseInt((antes.match(/(\d+)\s*v[eé]rtice/) || [])[1] ?? '0', 10);
      if (n >= 2) break;
      console.log(`  FRENTE TR inset ${inset}: (aún ${n})`);
    }
    console.log('selección FINAL FRENTE:', antes);
  } else {
    console.log('✘ FRENTE: ningún clic eligió vértice');
  }
} finally {
  if (errores.length) console.log('⚠ consola:', errores.slice(0, 10));
  await browser.close();
}