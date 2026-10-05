/**
 * DEBUG-AMARILLO — dump de colores exactos en la zona amarilla de la
 * ventana frontal: histograma de RGB para identificar si es la figura,
 * el gizmo o el asa del foco del recorrido.
 */
import { abrirEditor, esperar } from './comun.mjs';

const { browser, page } = await abrirEditor();

async function histograma(idx, x0, y0, x1, y1) {
  return page.evaluate(async ({ i, x0, y0, x1, y1 }) => {
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
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * off.width + x) * 4;
        const llave = `${d[o]},${d[o + 1]},${d[o + 2]}`;
        hist[llave] = (hist[llave] ?? 0) + 1;
      }
    }
    const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 14);
    return top;
  }, { i: idx, x0, y0, x1, y1 });
}

try {
  await page.click('[data-testid="tab-text"]');
  await page.fill('[data-testid="text-input"]', 'A');
  await esperar(1500);
  await page.click('[data-testid="tab-scene"]');
  await esperar(900);
  await page.click('[data-testid="add-camera-object-btn"]');
  await esperar(800);
  await page.fill('[data-testid="camera-focus-x"]', '0');
  await page.fill('[data-testid="camera-focus-y"]', '0');
  await page.fill('[data-testid="camera-focus-z"]', '0');
  await esperar(500);
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

  // Sin nada seleccionado no hay gizmo: histograma de la zona central.
  const sinSel = await histograma(0, 250, 90, 345, 185);
  console.log('SIN SELECCIÓN (zona central frontal):');
  for (const [rgb, n] of sinSel) console.log(`  ${rgb}: ${n}`);

  await page.locator('[data-testid="scene-object-0"]').click();
  await esperar(1000);
  const conFig = await histograma(0, 250, 90, 345, 185);
  console.log('FIGURA SELECCIONADA (misma zona):');
  for (const [rgb, n] of conFig) console.log(`  ${rgb}: ${n}`);

  await page.locator('[data-testid="scene-object-1"]').click();
  await esperar(1000);
  const conCam = await histograma(0, 250, 90, 345, 185);
  console.log('CÁMARA SELECCIONADA (misma zona):');
  for (const [rgb, n] of conCam) console.log(`  ${rgb}: ${n}`);
} finally {
  await browser.close();
}