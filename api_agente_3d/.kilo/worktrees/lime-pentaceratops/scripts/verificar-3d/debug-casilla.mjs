import { abrirEditor, esperar } from './comun.mjs';
const { browser, page } = await abrirEditor();

async function flechas() {
  return page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const canvas = conts[0] && conts[0].querySelector('canvas');
    if (!canvas) return null;
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    let rojo = 0, verde = 0, azul = 0;
    for (let y = 0; y < off.height; y++) for (let x = 0; x < off.width; x++) {
      const o = (y * off.width + x) * 4;
      const r = d[o] / 255, g = d[o + 1] / 255, b = d[o + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx === 0 || mx - mn < 0.08) continue;
      const sat = (mx - mn) / mx;
      if (sat < 0.45 || mx < 0.5) continue;
      let hue;
      if (mx === r) hue = ((g - b) / (mx - mn)) * 60;
      else if (mx === g) hue = 120 + ((b - r) / (mx - mn)) * 60;
      else hue = 240 + ((r - g) / (mx - mn)) * 60;
      if (hue < 0) hue += 360;
      if (hue >= 348 || hue <= 12) rojo++;
      else if (hue >= 100 && hue <= 160) verde++;
      else if (hue >= 210 && hue <= 250) azul++;
    }
    return { rojo, verde, azul };
  });
}

try {
  await page.click('[data-testid="tab-text"]');
  await page.fill('[data-testid="text-input"]', 'A');
  await esperar(1500);
  await page.click('[data-testid="tab-scene"]');
  await esperar(900);
  await page.click('[data-testid="add-camera-object-btn"]');
  await esperar(800);
  await page.locator('label[title*="Flechas de los ejes"]').first().locator('input').check();
  await esperar(700);
  await page.locator('[data-testid="scene-object-1"]').click();
  await esperar(900);
  console.log('inicial:', JSON.stringify(await flechas()));
  const zoom = page.locator('button[title="Acercar"]').first();
  console.log('botones Acercar:', await page.locator('button[title="Acercar"]').count());
  for (let i = 0; i < 10; i++) {
    await zoom.click();
    await esperar(450);
    console.log(`zoom ${i + 1}:`, JSON.stringify(await flechas()));
  }
} finally { await browser.close(); }
