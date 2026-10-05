/**
 * DEBUG-VISTA-CAMARA — ¿qué se ve desde la cámara activada? Histograma de
 * colores del parche central de la ventana 3D con la cámara activada y,
 * al desactivar, recuento morado (cuerpo) en TODO el lienzo.
 */
import { abrirEditor, esperar, crearResultados } from './comun.mjs';

const R = crearResultados('DEBUG-VISTA-CAMARA');
const { browser, page, errores } = await abrirEditor();

/** Histograma de colores (RGB cuantizados a 32) del parche central. */
async function histogramaCentro(idx) {
  return page.evaluate(async (i) => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const canvas = conts[i] && conts[i].querySelector('canvas');
    if (!canvas) return null;
    const url = canvas.toDataURL('image/png');
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; });
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    const hist = {};
    let total = 0;
    const x0 = Math.floor(off.width * 0.3), x1 = Math.floor(off.width * 0.7);
    const y0 = Math.floor(off.height * 0.3), y1 = Math.floor(off.height * 0.7);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * off.width + x) * 4;
        const k = `${d[o] >> 5 << 5},${d[o + 1] >> 5 << 5},${d[o + 2] >> 5 << 5}`;
        hist[k] = (hist[k] || 0) + 1;
        total++;
      }
    }
    const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([k, n]) => `${k}:${Math.round((n / total) * 100)}%`);
    return top.join(' ');
  }, idx);
}

try {
  await page.click('[data-testid="tab-text"]');
  await page.fill('[data-testid="text-input"]', 'A');
  await esperar(1500);
  await page.click('[data-testid="tab-scene"]');
  await esperar(900);
  await page.click('[data-testid="add-camera-object-btn"]');
  await esperar(800);
  await page.click('[data-testid="add-camera-keyframe-btn"]');
  await esperar(600);
  await page.fill('[data-testid="camera-kf-time-0"]', '0');
  await page.fill('[data-testid="camera-kf-pos-0-x"]', '0');
  await page.fill('[data-testid="camera-kf-pos-0-y"]', '0.5');
  await page.fill('[data-testid="camera-kf-pos-0-z"]', '3');
  await esperar(500);
  await page.click('[data-testid="add-camera-keyframe-btn"]');
  await esperar(600);
  await page.fill('[data-testid="camera-kf-time-1"]', '2');
  await page.fill('[data-testid="camera-kf-pos-1-x"]', '4');
  await page.fill('[data-testid="camera-kf-pos-1-y"]', '1.5');
  await page.fill('[data-testid="camera-kf-pos-1-z"]', '2');
  await esperar(800);
  await page.click('[data-testid="tab-scene"]');
  await esperar(900);

  console.log('LIBRE centro: ' + (await histogramaCentro(3)));
  await page.locator('[data-testid="camera-select-3d"]').selectOption({ index: 1 });
  await esperar(1200);
  console.log('CÁMARA centro: ' + (await histogramaCentro(3)));
  await page.locator('[data-testid="camera-select-3d"]').selectOption({ index: 0 });
  await esperar(1200);
  console.log('DESACTIVADA centro: ' + (await histogramaCentro(3)));
} finally {
  await R.resumen({ browser, errores });
}