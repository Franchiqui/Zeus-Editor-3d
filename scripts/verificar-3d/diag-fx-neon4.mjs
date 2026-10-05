/**
 * DIAG FX NEON 4 — ¿Se ve IGUAL el neón con el objeto seleccionado que
 * después de deseleccionarlo? El diff de píxeles entre ambos estados es
 * directamente lo que el usuario nota que cambió.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG FX NEON 4 · neón seleccionado vs deseleccionado (diff)');

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
  const columnas = new Array(cols).fill(0);
  for (let i = 0; i < fa.length; i++) {
    if (Math.abs(fa[i] - fb[i]) > 28) {
      cambio++;
      columnas[i % cols]++;
      const x = (i % cols) * a.paso;
      const y = Math.floor(i / cols) * a.paso;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // Histograma en 6 bandas de X.
  const bandas = [];
  for (let b = 0; b < 6; b++) {
    let s = 0;
    const desde = Math.floor((b / 6) * cols);
    const hasta = Math.max(desde + 1, Math.floor(((b + 1) / 6) * cols));
    for (let c = desde; c < hasta; c++) s += columnas[c];
    bandas.push(s);
  }
  return {
    cambio,
    caja: { ancho: maxX - minX + a.paso, alto: maxY - minY + a.paso },
    bandas: bandas.join(':'),
  };
}

const { browser, page, errores } = await abrirEditor();

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

  // Neón SOLO en el activo (objeto 0, seleccionado).
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Brillo neón', { exact: true }).first().click();
  await esperar(2200);
  const seleccionado = await firmaDensa(page);

  // Deseleccionar todo.
  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(2500);
  const deseleccionado = await firmaDensa(page);

  const d = huella(seleccionado, deseleccionado);
  console.log(
    '  · diff seleccionado→deseleccionado: píxeles=' + d?.cambio +
    ' caja=' + JSON.stringify(d?.caja)
  );
  console.log('  · bandas X: ' + d?.bandas);
  R.check(
    !!d && d.cambio < 60,
    `el neón se ve IGUAL al deseleccionar (${d?.cambio} px de cambio)`,
    `el neón cambia al deseleccionar: ${d?.cambio} px — cobertura distinta — BUG`
  );
} catch (e) {
  R.check(false, 'no debió fallar', 'falló: ' + e.message);
} finally {
  await R.resumen({ browser, errores });
}