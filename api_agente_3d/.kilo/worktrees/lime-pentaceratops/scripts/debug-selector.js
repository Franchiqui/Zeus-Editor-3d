/* Depuración: qué ocurre durante el arrastre de selección de vértices. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errores = [];
  page.on('console', (msg) => {
    const txt = msg.text();
    if (msg.type() === 'error') errores.push(txt.slice(0, 200));
    if (txt.includes('[selector-')) console.log('CONSOLA:', txt);
  });
  page.on('pageerror', (err) => errores.push('PAGEERROR: ' + String(err).slice(0, 300)));
  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="scene-object-list"]', { timeout: 90000 });
  await page.waitForTimeout(2000);

  // Crear objeto 3D
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
  await page.waitForTimeout(800);
  // Objeto real desde el catálogo (tarjeta Zeus IA-LOGO)
  const tarjeta = await page.waitForSelector(
    '[role="dialog"] button:has-text("Zeus IA-LOGO")',
    { timeout: 8000 }
  );
  await tarjeta.evaluate((el) => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  });
  await page.waitForTimeout(2000);
  const objetoCreado = await page.evaluate(
    () => document.querySelectorAll('[data-testid^="scene-object-"]').length
  );
  console.log('Objetos tras tarjeta:', objetoCreado);
  // Si el catálogo sigue abierto (el objeto ya está creado), cerrarlo.
  for (let intento = 0; intento < 3; intento++) {
    const abierto = await page.$('[role="dialog"]');
    if (!abierto) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const aunAbierto = await page.$('[role="dialog"] button:has-text("Cancelar")');
    if (aunAbierto) {
      await aunAbierto.evaluate((el) => {
        el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        el.click();
      });
      await page.waitForTimeout(800);
    }
  }
  console.log('Diálogo tras cierre:', await page.evaluate(() => String(document.querySelectorAll('[role="dialog"]').length)));

  // Activar selector de caras
  const toggleSel = await page.$('button[title*="Seleccionar caras"]');
  await toggleSel.evaluate((el) => el.click());
  await page.waitForTimeout(400);
  const objetivo = await page.$('select[title*="Qué seleccionar"]');
  await objetivo.selectOption('vertice');
  await page.waitForTimeout(300);

  // Inspeccionar todos los canvas y su contenido
  const info = await page.evaluate(() => {
    return [...document.querySelectorAll('canvas')].map((c, i) => {
      const r = c.getBoundingClientRect();
      // píxeles no negros en el centro
      const t = document.createElement('canvas');
      t.width = c.width; t.height = c.height;
      const ctx = t.getContext('2d');
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(Math.floor(c.width / 2) - 5, Math.floor(c.height / 2) - 5, 10, 10).data;
      let brillo = 0;
      for (let p = 0; p < d.length; p += 4) brillo += d[p] + d[p + 1] + d[p + 2];
      return { i, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top), brilloCentro: brillo, visor: !!c.closest('[data-testid]')?.dataset?.testid };
    });
  });
  console.log('Canvases:', JSON.stringify(info, null, 1));

  // Panel 3D libre: el último canvas apaisado (los lienzos 2D son cuadrados)
  const panel3d = await page.evaluate(() => {
    const visores = [...document.querySelectorAll('canvas')].filter(
      (c) => { const r = c.getBoundingClientRect(); return r.width > r.height * 1.4; }
    );
    const c = visores[visores.length - 1];
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  console.log('Panel visor 3D:', JSON.stringify(panel3d));
  const cx = panel3d.x + panel3d.w / 2;
  const cy = panel3d.y + panel3d.h / 2;
  const topEl = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.tagName + '.' + (el.className || '').toString().slice(0, 60) : 'null';
  }, { x: cx, y: cy });
  console.log('Elemento superior en el centro del último canvas:', topEl);

  console.log('Elemento en el punto de arrastre:', await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.tagName + '.' + String(el.className).slice(0, 70) : 'null';
  }, { x: panel3d.x + 100, y: panel3d.y + 100 }));
  const dialogos = await page.evaluate(() => {
    return [...document.querySelectorAll('[role="dialog"]')].map((d) => ({
      titulo: d.querySelector('h2, h3')?.textContent?.slice(0, 60) ?? null,
      texto: (d.textContent || '').trim().slice(0, 120),
    }));
  });
  console.log('Diálogos abiertos:', JSON.stringify(dialogos, null, 1));

  // Arrastre y observación del overlay del rectángulo
  await page.mouse.move(cx - 100, cy - 80);
  await page.mouse.down();
  await page.mouse.move(cx + 100, cy + 80, { steps: 4 });
  const overlays = await page.evaluate(() => {
    // Buscar divs con borde dashed cian (marquesina)
    return [...document.querySelectorAll('div')].filter(
      (d) => (d.style.border || '').includes('dashed')
    ).map((d) => ({ display: d.style.display, w: d.style.width, h: d.style.height }));
  });
  console.log('Overlays marquesina durante el arrastre:', JSON.stringify(overlays));
  await page.mouse.up();
  await page.waitForTimeout(600);
  const barra = await page.textContent('[data-testid="face-select-bar"]');
  console.log('Barra tras soltar:', barra.trim().replace(/\s+/g, ' ').slice(0, 80));
  console.log('Errores de consola:', errores.slice(0, 5));
  await browser.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });