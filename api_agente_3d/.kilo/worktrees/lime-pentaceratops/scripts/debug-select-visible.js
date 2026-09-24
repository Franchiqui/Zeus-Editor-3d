// Reproduce el flujo completo de verificación (importar objeto + activar
// selector) y diagnostica el estado del desplegable en el paso que falla.
const { chromium } = require('playwright');

(async () => {
  const navegador = await chromium.launch();
  const page = await navegador.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Importar objeto del catálogo (igual que la verificación).
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
    destino.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    destino.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    destino.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    destino.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    destino.click();
  });
  await page.waitForTimeout(2000);
  for (let i = 0; i < 3; i++) {
    if (!(await page.$('[role="dialog"]'))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const cancelar = await page.$('[role="dialog"] button:has-text("Cancelar")');
    if (cancelar) {
      await cancelar.evaluate((el) => { el.click(); });
      await page.waitForTimeout(800);
    }
  }
  const nObjetos = await page.evaluate(
    () => document.querySelectorAll('[data-testid^="scene-object-"]:not([data-testid="scene-object-list"])').length
  );
  console.log('Objetos en la escena:', nObjetos);

  // Activar selector de caras.
  const toggleSel = await page.$('button[title*="Seleccionar caras"]');
  await toggleSel.evaluate((el) => el.click());
  await page.waitForTimeout(600);

  // Diagnóstico del desplegable.
  const info = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select[title*="Qué seleccionar"]')];
    return sels.map((sel) => {
      const r = sel.getBoundingClientRect();
      return {
        x: Math.round(r.x), y: Math.round(r.y), w: r.width, h: r.height,
        disabled: sel.disabled,
        visible: r.width > 0 && r.height > 0,
        panel: sel.closest('[class*="rounded-lg border"]')?.getBoundingClientRect().width,
      };
    });
  });
  console.log('Desplegables:', JSON.stringify(info, null, 2));

  // ¿Responde la página? Medir el bloqueo del hilo principal.
  const bloqueo = await page.evaluate(() => {
    const t0 = performance.now();
    let t = 0;
    while (performance.now() - t0 < 10) t++;
    return performance.now() - t0;
  });
  console.log(`Loop 10ms midió ${bloqueo.toFixed(1)}ms (≈1 = hilo libre)`);

  // Intentar selectOption con el primer desplegable y cronometrar.
  const t0 = Date.now();
  try {
    const sel = await page.$('select[title*="Qué seleccionar"]');
    await sel.selectOption('vertice', { timeout: 10000 });
    console.log(`selectOption OK en ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`selectOption FALLÓ tras ${Date.now() - t0}ms:`, e.message.split('\n')[0]);
  }

  await navegador.close();
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });