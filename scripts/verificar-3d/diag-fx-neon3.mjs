/**
 * DIAG FX NEON 3 — cobertura del halo con UN solo objeto:
 * activo (malla principal viva) vs deseleccionado (instantánea).
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG FX NEON 3 · halo: activo vs duplicado, 1 objeto');

async function firmaDensa(page) {
  return page.evaluate(() => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
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
      for (let i = 0; i < d.length; i += 8) {
        firma.push(d[i] | (d[i + 1] << 5) | (d[i + 2] << 12));
      }
      return { w: off.width, h: off.height, paso: 2, firma: firma.join(',') };
    });
  });
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
  return { cambio, caja: { ancho: maxX - minX + a.paso, alto: maxY - minY + a.paso }, cols, cambios: (i) => true, _cols: cols, fa: fa.join('|') };
}

/** Histograma por bandas de X (6 bandas) de los píxeles cambiantes. */
function bandasX(a, b) {
  if (!a || !b) return null;
  const fa = a.firma.split(',').map(Number);
  const fb = b.firma.split(',').map(Number);
  const cols = Math.ceil(a.w / a.paso);
  const filas = Math.ceil(a.h / a.paso);
  const bandas = new Array(6).fill(0);
  const porCol = new Array(cols).fill(0);
  for (let i = 0; i < fa.length; i++) {
    if (Math.abs(fa[i] - fb[i]) > 28) {
      porCol[i % cols]++;
    }
  }
  for (let c = 0; c < cols; c++) {
    const banda = Math.min(5, Math.floor((c / cols) * 6));
    bandas[banda] += porCol[c];
  }
  return bandas.join(':');
}

const { browser, page, errores } = await abrirEditor();

const captura = [];
page.on('pageerror', (e) => captura.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') captura.push('console: ' + m.text().slice(0, 200));
});

const debugFirma = (etq, f) => {
  if (!f) { console.log('  · [' + etq + '] firma NULL'); return; }
  console.log('  · [' + etq + '] w=' + f.w + ' h=' + f.h + ' muestras=' + f.firma.split(',').length);
};

try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);

  const estrella = await firmaDensa(page);
  debugFirma('base', estrella);

  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Brillo neón', { exact: true }).first().click();
  await esperar(2200);
  const conActivo = await firmaDensa(page);
  debugFirma('conActivo', conActivo);
  const hActivo = huella(estrella, conActivo);
  console.log(
    '  · halo ACTIVO: píxeles=' + hActivo?.cambio +
    ' caja=' + JSON.stringify(hActivo?.caja)
  );
  console.log('  · bandas X activo: ' + bandasX(estrella, conActivo));

  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(2500);
  const sinSel = await firmaDensa(page);
  const hDup = huella(estrella, sinSel);
  console.log(
    '  · halo DESELECCIONADO: píxeles=' + hDup?.cambio +
    ' caja=' + JSON.stringify(hDup?.caja)
  );
  console.log('  · bandas X deseleccionado: ' + bandasX(estrella, sinSel));

  if (hActivo && hDup) console.log('  · ratio cobertura: ' + (hDup.cambio / hActivo.cambio).toFixed(2));
} catch (e) {
  R.check(false, 'no debió fallar', 'falló: ' + e.message);
} finally {
  if (captura.length) console.log('  · errores página:\n' + captura.map((c) => '    - ' + c).join('\n'));
  await R.resumen({ browser, errores });
}