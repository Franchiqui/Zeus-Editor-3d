/**
 * DIAG FX NEON 2 — COBERTURA del halo: seleccionado vs deseleccionado.
 * Compara la firma de píxeles de dos capturas (con/sin neón): los píxeles
 * que cambian son la huella del halo. Se mide su área y su caja englobante
 * para ver si el neón del duplicado cubre lo mismo que el del activo.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG FX NEON 2 · cobertura del halo');

/** Firma densa (por píxel, paso 2) + dimensión, comparable entre llamadas. */
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
    const imgCargada = new Promise((res) => {
      img.onload = res;
      img.onerror = res;
    });
    img.src = url;
    return imgCargada.then(() => {
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, off.width, off.height).data;
      const firma = [];
      for (let i = 0; i < d.length; i += 4 * 2) {
        firma.push(d[i] | (d[i + 1] << 5) | (d[i + 2] << 12));
      }
      return { w: off.width, h: off.height, paso: 2, firma: firma.join(',') };
    });
  });
}

/** Píxeles que cambian entre dos firmas + caja englobante (en px reales). */
function huella(a, b) {
  if (!a || !b || a.w !== b.w || a.h !== b.h) return null;
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
  return {
    cambio,
    caja: { ancho: maxX - minX + a.paso, alto: maxY - minY + a.paso },
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

  const estrella = await firmaDensa(page);
  console.log('  · base capturada');

  // Neón SOLO en el activo (objeto 0).
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Brillo neón', { exact: true }).first().click();
  await esperar(2200);
  const conActivo = await firmaDensa(page);
  const huellaActivo = huella(estrella, conActivo);
  console.log(
    '  · halo activo: píxeles cambiantes=' + huellaActivo?.cambio +
    ' caja=' + JSON.stringify(huellaActivo?.caja)
  );

  // Deseleccionar todo: el 0 pasa a duplicado.
  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(2500);
  const sinSel = await firmaDensa(page);
  const huellaDup = huella(estrella, sinSel);
  console.log(
    '  · halo duplicado: píxeles cambiantes=' + huellaDup?.cambio +
    ' caja=' + JSON.stringify(huellaDup?.caja)
  );

  R.check(
    !!huellaActivo && huellaActivo.cambio > 40,
    'el halo del activo tiene huella (' + huellaActivo?.cambio + ' px)',
    'el halo del activo no cubre nada — BUG'
  );
  R.check(
    !!huellaDup && huellaActivo && huellaDup.cambio > huellaActivo.cambio * 0.75,
    'el halo del duplicado cubre casi lo mismo (' + huellaDup?.cambio + ' vs ' + huellaActivo?.cambio + ' px)',
    'el halo del duplicado cubre MENOS (' + huellaDup?.cambio + ' vs ' + huellaActivo?.cambio + ' px) — BUG'
  );
} catch (e) {
  R.check(false, 'no debió fallar', 'falló: ' + e.message);
} finally {
  await R.resumen({ browser, errores });
}