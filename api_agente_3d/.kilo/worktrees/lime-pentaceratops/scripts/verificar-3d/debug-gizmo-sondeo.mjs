// Sondeo: ¿qué hay alrededor del cuerpo morado con el gizmo encendido?
// Busca clústeres de bolas amarillas (0xffd93d, matiz ~45-52) y flechas
// con cajas de al menos 3 px de ancho, para calibrar la sección 6.
import { abrirEditor, crearCamaraYAsignar, esperar, volcarEscenaPorFiber } from './comun.mjs';

const page = await abrirEditor();
await crearCamaraYAsignar(page);
await esperar(600);

// Encender gizmo y seleccionar la cámara
await page.locator('label[title*="Flechas de los ejes"]').first().locator('input').check();
await esperar(700);
await page.locator('[data-testid="scene-object-1"]').click();
await esperar(900);

const res = await page.evaluate(async () => {
  const conts = document.querySelectorAll('[data-testid="viewer-container"]');
  const canvas = conts[0] && conts[0].querySelector('canvas');
  if (!canvas) return null;
  const url = canvas.toDataURL('image/png');
  const img = new Image();
  await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; });
  const off = document.createElement('canvas');
  off.width = canvas.width; off.height = canvas.height;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, off.width, off.height).data;
  const W = off.width, H = off.height;
  const clases = {
    bolaAmarilla: [40, 55, 0.5, 0.8],
    flechaX: [348, 12, 0.5, 0.72],
    flechaY: [100, 160, 0.45, 0.5],
    flechaZ: [210, 250, 0.45, 0.5],
    morado: [250, 300, 0.15, 0.2],
    naranjaAsa: [25, 39, 0.5, 0.85],
  };
  const salida = {};
  for (const [nombre, h0, h1, satMin, valMin] of Object.entries(clases)) {
    let n = 0, sx = 0, sy = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    const envuelve = h0 > h1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const r = d[o] / 255, g = d[o + 1] / 255, b = d[o + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx === 0 || mx - mn < 0.08) continue;
      const sat = (mx - mn) / mx;
      if (sat < satMin || mx < valMin) continue;
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
    salida[nombre] = {
      n, cx: n ? Math.round(sx / n) : -1, cy: n ? Math.round(sy / n) : -1,
      x0: n ? x0 : -1, x1: n ? x1 : -1, y0: n ? y0 : -1, y1: n ? y1 : -1,
      ancho: n ? x1 - x0 + 1 : 0, alto: n ? y1 - y0 + 1 : 0,
    };
  }
  return salida;
});
console.log(JSON.stringify(res, null, 2));

// Zoom 6 veces y repetir, para ver cómo crecen las flechas
const botonZoom = page.locator('button[title="Acercar"]').first();
for (let i = 0; i < 6; i++) { if (await botonZoom.count()) { await botonZoom.click(); await esperar(350); } }
const res2 = await page.evaluate(async () => {
  const conts = document.querySelectorAll('[data-testid="viewer-container"]');
  const canvas = conts[0].querySelector('canvas');
  const url = canvas.toDataURL('image/png');
  const img = new Image();
  await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; });
  const off = document.createElement('canvas');
  off.width = canvas.width; off.height = canvas.height;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, off.width, off.height).data;
  const W = off.width, H = off.height;
  const clases = {
    bolaAmarilla: [40, 55, 0.5, 0.8],
    flechaX: [348, 12, 0.5, 0.72],
    flechaY: [100, 160, 0.45, 0.5],
    flechaZ: [210, 250, 0.45, 0.5],
    morado: [250, 300, 0.15, 0.2],
  };
  const salida = {};
  for (const [nombre, h0, h1, satMin, valMin] of Object.entries(clases)) {
    let n = 0, sx = 0, sy = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    const envuelve = h0 > h1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const r = d[o] / 255, g = d[o + 1] / 255, b = d[o + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx === 0 || mx - mn < 0.08) continue;
      const sat = (mx - mn) / mx;
      if (sat < satMin || mx < valMin) continue;
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
    salida[nombre] = {
      n, cx: n ? Math.round(sx / n) : -1, cy: n ? Math.round(sy / n) : -1,
      x0: n ? x0 : -1, x1: n ? x1 : -1, y0: n ? y0 : -1, y1: n ? y1 : -1,
      ancho: n ? x1 - x0 + 1 : 0, alto: n ? y1 - y0 + 1 : 0,
    };
  }
  return salida;
});
console.log('--- tras 6 zooms ---');
console.log(JSON.stringify(res2, null, 2));

await page.screenshot({ path: 'scripts/verificar-3d/sondeo-gizmo.png' });
console.log('captura guardada en sondeo-gizmo.png (no la leemos, solo queda en disco)');
await page.context().browser().close();
process.exit(0);