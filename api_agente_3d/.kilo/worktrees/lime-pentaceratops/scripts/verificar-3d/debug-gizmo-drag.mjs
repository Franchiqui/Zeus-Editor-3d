/**
 * DEBUG-GIZMO-DRAG v3 — qué píxeles deja el gizmo de la cámara seleccionada
 * en la ventana frontal y en la de Costado (paleta amplia).
 */
import { abrirEditor, esperar } from './comun.mjs';

const { browser, page } = await abrirEditor();

async function pixeles(idx, rangos) {
  return page.evaluate(async ({ i, rangos }) => {
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
    const salida = { width: off.width };
    for (const [nombre, h0, h1, satMin, valMin] of rangos) {
      let n = 0, sx = 0, sy = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      const envuelve = h0 > h1;
      for (let y = 0; y < off.height; y++) {
        for (let x = 0; x < off.width; x++) {
          const o = (y * off.width + x) * 4;
          const r = d[o] / 255, g = d[o + 1] / 255, b = d[o + 2] / 255;
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (mx === 0 || mx - mn < 0.08) continue;
          const sat = (mx - mn) / mx;
          if (sat < (satMin ?? 0.45) || mx < (valMin ?? 0.5)) continue;
          let hue;
          if (mx === r) hue = ((g - b) / (mx - mn)) * 60;
          else if (mx === g) hue = 120 + ((b - r) / (mx - mn)) * 60;
          else hue = 240 + ((r - g) / (mx - mn)) * 60;
          if (hue < 0) hue += 360;
          const dentro = envuelve ? hue >= h0 || hue <= h1 : hue >= h0 && hue <= h1;
          if (dentro) {
            n++; sx += x; sy += y;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      salida[nombre] = { n, cx: n ? Math.round(sx / n) : -1, cy: n ? Math.round(sy / n) : -1, x0: n ? x0 : -1, x1: n ? x1 : -1, y0: n ? y0 : -1, y1: n ? y1 : -1 };
    }
    return salida;
  }, { i: idx, rangos });
}

const PALETA = [
  ['amarillo', 28, 58, 0.45, 0.5],
  ['rojoVivo', 348, 12, 0.5, 0.72],
  ['verde', 100, 160, 0.45, 0.5],
  ['azul', 210, 250, 0.45, 0.5],
  ['cian', 160, 210, 0.45, 0.5],
  ['morado', 250, 300, 0.15, 0.2],
  ['blanco', 0, 360, 0.0, 0.92], // cubo central blanco (sat~0)
];

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

  // REC en la 3D y 2 arrastres (kf en 3 s y 4 s).
  await page.locator('[data-testid="camera-select-3d"]').selectOption({ index: 1 });
  await esperar(900);
  await page.click('[data-testid="rec-btn-3d"]');
  await esperar(900);
  const caja3 = await page.locator('[data-testid="viewer-container"]').nth(3).boundingBox();
  for (const [dx, dy] of [[90, 40], [-110, 30]]) {
    const cx = caja3.x + caja3.width / 2, cy = caja3.y + caja3.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
    await page.mouse.up();
    await esperar(900);
  }

  // Seleccionar la cámara (fila 1) y paleta en la ventana frontal.
  await page.locator('[data-testid="scene-object-1"]').click();
  await esperar(1000);
  const conCamara = await pixeles(0, PALETA);
  console.log('VENTANA 0, cámara seleccionada:', JSON.stringify(conCamara, null, 1));

  // Seleccionar la figura (fila 0) y paleta en la ventana frontal.
  await page.locator('[data-testid="scene-object-0"]').click();
  await esperar(1000);
  const conFigura = await pixeles(0, PALETA);
  console.log('ventana 0, figura seleccionada:', JSON.stringify(conFigura, null, 1));
} finally {
  await browser.close();
}