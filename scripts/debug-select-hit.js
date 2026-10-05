// Con objeto importado: medir mutaciones DOM, FPS y estabilidad del select.
const { chromium } = require('playwright');

(async () => {
  const navegador = await chromium.launch();
  const page = await navegador.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Importar objeto (flujo del catálogo).
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

  const toggleSel = await page.$('button[title*="Seleccionar caras"]');
  await toggleSel.evaluate((el) => el.click());
  await page.waitForTimeout(600);

  const diag = await page.evaluate(() => new Promise((res) => {
    const sel = document.querySelector('select[title*="Qué seleccionar"]');
    const r0 = sel.getBoundingClientRect();
    let mutaciones = 0, movido = 0, reemplazado = 0;
    const obs = new MutationObserver((ms) => { mutaciones += ms.length; });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });
    let frames = 0;
    const t0 = performance.now();
    const paso = () => {
      frames++;
      const r = sel.getBoundingClientRect();
      if (Math.abs(r.x - r0.x) > 0.5 || Math.abs(r.y - r0.y) > 0.5) movido++;
      if (!sel.isConnected) reemplazado++;
      if (performance.now() - t0 < 2000) requestAnimationFrame(paso);
      else {
        obs.disconnect();
        res({ frames, movido, reemplazado, mutaciones, rect0: { x: r0.x, y: r0.y } });
      }
    };
    requestAnimationFrame(paso);
  }));
  console.log('Con objeto:', JSON.stringify(diag));

  // Método nativo: setter + change.
  const t0 = Date.now();
  try {
    await page.$$eval('select[title*="Qué seleccionar"]', (sels) => {
      for (const s of sels) {
        const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        proto.set.call(s, 'vertice');
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    const valor = await page.$eval('select[title*="Qué seleccionar"]', (s) => s.value);
    console.log(`Método nativo: OK (${valor}) en ${Date.now() - t0}ms`);
  } catch (e) {
    console.log('Método nativo FALLÓ:', e.message.split('\n')[0]);
  }

  await navegador.close();
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });