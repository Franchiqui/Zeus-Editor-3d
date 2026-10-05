/**
 * DIAG FX NEON 6 — el cambio de activo en los CUATRO visores.
 * Los visores 1-3 pueden tener su propio estado FX: si en alguno la
 * cobertura del neón cambia al pasar la selección, ahí está el bug.
 * Secuencia: ambos objetos con neón → activo 0 → activo 1, y el diff
 * por visor se compara con la misma transición SIN neón.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG FX NEON 6 · cambio de activo en los 4 visores');

async function firmaDensa(page, idx) {
  return page.evaluate((i) => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[i];
    const canvas = cont && cont.querySelector('canvas');
    if (!canvas) return null;
    const url = canvas.toDataURL('image/png');
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    const img = new Image();
    const lista = new Promise((res) => {
      img.onload = res;
      img.onerror = res;
    });
    img.src = url;
    return lista.then(() => {
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, off.width, off.height).data;
      const firma = [];
      for (let k = 0; k < d.length; k += 8) {
        firma.push(d[k] | (d[k + 1] << 5) | (d[k + 2] << 12));
      }
      return { w: off.width, h: off.height, paso: 2, firma: firma.join(',') };
    });
  }, idx);
}

function huella(a, b) {
  if (!a || !b) return null;
  const fa = a.firma.split(',').map(Number);
  const fb = b.firma.split(',').map(Number);
  const cols = Math.ceil(a.w / a.paso);
  let cambio = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < fa.length; i++) {
    if (Math.abs(fa[i] - fb[i]) > 28) {
      cambio++;
      const x = (i % cols) * a.paso;
      const y = Math.floor(i / cols) * a.paso;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { cambio, caja: { ancho: maxX - minX + a.paso, alto: maxY - minY + a.paso } };
}

const { browser, page, errores } = await abrirEditor();
const VISORES = [0, 1, 2, 3];

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

  const gizmoBtn = page.locator('[data-testid="toggle-gizmo-btn"]').first();
  if (await gizmoBtn.count()) await gizmoBtn.click();
  await esperar(700);

  // Fase A: cambio de activo SIN neón, en todos los visores.
  const sin0 = await Promise.all(VISORES.map((i) => firmaDensa(page, i)));
  await page.click('[data-testid="scene-object-1"]');
  await esperar(2500);
  const sin1 = await Promise.all(VISORES.map((i) => firmaDensa(page, i)));
  await page.click('[data-testid="scene-object-0"]');
  await esperar(2500);

  // Neón en AMBOS: el objeto 0 (activo) primero, luego el 1.
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Brillo neón', { exact: true }).first().click();
  await page.keyboard.press('Escape');
  await esperar(2200);
  await page.click('[data-testid="scene-object-1"]');
  await esperar(1200);
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Brillo neón', { exact: true }).first().click();
  await page.keyboard.press('Escape');
  await esperar(2200);

  // En este punto el activo = 1 y ambos tienen neón.
  const con1 = await Promise.all(VISORES.map((i) => firmaDensa(page, i)));
  await page.click('[data-testid="scene-object-0"]');
  await esperar(2500);
  const con0 = await Promise.all(VISORES.map((i) => firmaDensa(page, i)));

  for (const i of VISORES) {
    const base = huella(sin0[i], sin1[i]);
    const con = huella(con0[i], con1[i]);
    console.log(
      '  · visor ' + i + ': sin neón=' + (base?.cambio ?? 'null') +
      ' | con neón=' + (con?.cambio ?? 'null') +
      ' caja=' + JSON.stringify(con?.caja)
    );
    R.check(
      !!con && !!base && con.cambio <= base.cambio * 3 + 120,
      `visor ${i}: el neón se mantiene al cambiar de activo (${con?.cambio} px vs ${base?.cambio})`,
      `visor ${i}: el neón CAMBIA al cambiar de activo (${con?.cambio} px vs ${base?.cambio}) — BUG`
    );
  }
} catch (e) {
  R.check(false, 'no debió fallar', 'falló: ' + e.message);
} finally {
  await R.resumen({ browser, errores });
}