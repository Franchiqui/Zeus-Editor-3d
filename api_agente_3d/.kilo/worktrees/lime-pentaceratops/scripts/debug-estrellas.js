// Reproduce el fallo del usuario: colocar estrellas ya no funciona.
// Activa "Colocar estrellas" desde el menú FX, hace clic sobre la figura
// y compara el brillo (chispas blancas/cian aditivas) antes y después.
const { chromium } = require('playwright');

(async () => {
  const navegador = await chromium.launch();
  const page = await navegador.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { const t = m.text(); if (t.includes('[STAR]') || t.includes('[FX]')) console.log('CONSOLA:', t); });
  page.on('crash', () => console.log('PAGE CRASH'));

  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Importar objeto del catálogo (la escena puede estar vacía).
  await page.focus('[data-testid="actions-menu-trigger"]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  for (let i = 0; i < 12; i++) {
    const texto = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    if (texto.startsWith('Objeto 3D') || texto.startsWith('3D object')) break;
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const nombres = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/objetos-3d', { cache: 'no-store' });
      const d = await r.json();
      return (d.files || []).map((f) => f.name.replace(/\.zeus$/i, ''));
    } catch { return []; }
  });
  let tarjeta = null;
  for (const nombre of nombres) {
    try {
      tarjeta = await page.waitForSelector(`[role="dialog"] :text("${nombre}")`, { timeout: 8000 });
      break;
    } catch { /* siguiente */ }
  }
  if (!tarjeta) { console.log('SIN TARJETA'); await navegador.close(); return; }
  await tarjeta.evaluate((el) => {
    let destino = el;
    for (let i = 0; i < 6; i++) {
      if (!destino.parentElement) break;
      destino = destino.parentElement;
      if (destino.tagName === 'BUTTON' || destino.getAttribute('role') === 'button' || String(destino.className || '').includes('cursor-pointer')) break;
    }
    destino.click();
  });
  await page.waitForTimeout(2000);
  for (let i = 0; i < 3; i++) {
    if (!(await page.$('[role="dialog"]'))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  const paneles = await page.evaluate(() =>
    [...document.querySelectorAll('canvas')]
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > r.height * 1.4)
  );
  const p = paneles[0];
  const cx = Math.round(p.x + p.width / 2);
  const cy = Math.round(p.y + p.height / 2);

  const brillo = async () => {
    return await page.evaluate(({ x, y }) => {
      const c = [...document.querySelectorAll('canvas')]
        .map((cv) => ({ cv, r: cv.getBoundingClientRect() }))
        .find(({ r }) => r.width > r.height * 1.4);
      if (!c) return -1;
      const aux = document.createElement('canvas');
      aux.width = c.cv.width;
      aux.height = c.cv.height;
      const ctx = aux.getContext('2d');
      ctx.drawImage(c.cv, 0, 0);
      const sx = Math.round((x - c.r.left) / c.r.width * c.cv.width);
      const sy = Math.round((y - c.r.top) / c.r.height * c.cv.height);
      const mitad = 120;
      const img = ctx.getImageData(sx - mitad, sy - mitad, mitad * 2, mitad * 2);
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        if (r > 200 && g > 200 && b > 140) n++;
      }
      return n;
    }, { x: cx, y: cy });
  };

  const antes = await brillo();
  console.log('Brillo antes:', antes);

  // Abrir menú FX y activar "Colocar estrellas".
  // Hay 4 botones FX (uno por pestaña): usar el visible, con clic REAL
  // (Radix abre el menú en pointerdown, no con click() programático).
  const fxRect = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[title="Efectos visuales"]')]
      .find((b) => b.offsetParent !== null);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!fxRect) { console.log('SIN BOTÓN FX VISIBLE'); await navegador.close(); return; }
  await page.mouse.click(fxRect.x, fxRect.y);
  await page.waitForTimeout(1000);
  const menuAbierto = await page.evaluate(() => document.querySelectorAll('[role="menu"]').length);
  if (!menuAbierto) {
    await page.mouse.click(fxRect.x, fxRect.y); // segundo intento
    await page.waitForTimeout(1000);
  }
  // Diagnóstico: ¿qué hay en el menú?
  const items = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')]
      .map((el) => `${el.getAttribute('role')}: ${el.textContent?.trim().slice(0, 40)}`)
  );
  console.log('Items del menú FX:', JSON.stringify(items));
  const itemRect = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="menuitemcheckbox"]')]
      .find((e) => e.textContent?.includes('Colocar estrellas'));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!itemRect) { console.log('SIN ITEM Colocar estrellas'); await navegador.close(); return; }
  await page.mouse.click(itemRect.x, itemRect.y);
  await page.waitForTimeout(1000);
  // Cerrar el menú con Escape para que el lienzo quede libre.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // Clic sobre la figura (centro del panel).
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(2500);
  const despues = await brillo();
  console.log('Brillo tras clic:', despues);
  console.log(despues > antes + 40 ? 'ESTRELLA COLOCADA ✓' : 'NO SE COLOCÓ ✗');

  // Segundo clic: ¿se acumulan?
  await page.mouse.click(cx + 30, cy - 20);
  await page.waitForTimeout(2500);
  const tercero = await brillo();
  console.log('Brillo tras 2º clic:', tercero);

  await navegador.close();
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });