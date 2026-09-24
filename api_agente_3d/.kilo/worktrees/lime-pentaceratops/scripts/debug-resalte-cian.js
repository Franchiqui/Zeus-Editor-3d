// Verifica con píxeles del canvas:
// 1) Seleccionar caras las pinta de cian (textura automática).
// 2) Clic simple: el raycast no traspasa (solo cara frontal).
// 3) Ctrl+clic: añade caras una a una.
const { chromium } = require('playwright');

(async () => {
  const navegador = await chromium.launch();
  const page = await navegador.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Importar objeto del catálogo.
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

  const contarCian = async () => page.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].find(
      (x) => x.getBoundingClientRect().width > x.getBoundingClientRect().height * 1.4
    );
    if (!c) return -1;
    const aux = document.createElement('canvas');
    aux.width = c.width;
    aux.height = c.height;
    const ctx2d = aux.getContext('2d');
    if (!ctx2d) return -2;
    ctx2d.drawImage(c, 0, 0);
    const datos = ctx2d.getImageData(0, 0, aux.width, aux.height).data;
    let n = 0;
    for (let i = 0; i < datos.length; i += 4) {
      // Cian #22d3ee: G y B altos, R bajo.
      if (datos[i] < 160 && datos[i + 1] > 150 && datos[i + 2] > 170) n++;
    }
    return n;
  });

  // Activar selector de caras.
  const toggleSel = await page.$('button[title*="Seleccionar caras"]');
  await toggleSel.evaluate((el) => el.click());
  await page.waitForTimeout(2000);
  const cianBase = await contarCian();
  console.log('Píxeles cian sin seleccionar:', cianBase);

  // Rectángulo sobre el centro del primer panel 3D.
  const paneles = await page.evaluate(() =>
    [...document.querySelectorAll('canvas')]
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > r.height * 1.4)
  );
  const p = paneles[0];
  const cx = p.x + p.width / 2;
  const cy = p.y + p.height / 2;
  await page.mouse.move(cx - 25, cy - 18);
  await page.mouse.down();
  await page.mouse.move(cx + 25, cy + 18, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(3000);
  const barra = await page.textContent('[data-testid="face-select-bar"]');
  console.log('Barra tras rectángulo:', (barra || '').slice(0, 40));
  const cianRect = await contarCian();
  console.log('Píxeles cian tras rectángulo:', cianRect, cianRect > cianBase ? '→ RESALTE VISIBLE ✓' : '→ SIN RESALTE ✗');

  // Ctrl+clic en un punto del objeto fuera del rectángulo: debe AUMENTAR.
  await page.keyboard.down('Control');
  await page.mouse.click(cx + 45, cy + 20);
  await page.keyboard.up('Control');
  await page.waitForTimeout(3000);
  const barra2 = await page.textContent('[data-testid="face-select-bar"]');
  console.log('Barra tras Ctrl+clic:', (barra2 || '').slice(0, 40));
  const n1 = parseInt((barra || '0').match(/^(\d+)/)?.[1] || '0');
  const n2 = parseInt((barra2 || '0').match(/^(\d+)/)?.[1] || '0');
  console.log(n2 > n1 ? 'Ctrl+clic AÑADIÓ caras ✓' : `Ctrl+clic no añadió (${n1} → ${n2}) ✗`);

  // Ctrl+clic sobre una cara ya seleccionada (dentro del rectángulo): reducir.
  await page.keyboard.down('Control');
  await page.mouse.click(cx, cy);
  await page.keyboard.up('Control');
  await page.waitForTimeout(3000);
  const barra3 = await page.textContent('[data-testid="face-select-bar"]');
  const n3 = parseInt((barra3 || '0').match(/^(\d+)/)?.[1] || '0');
  console.log(`Ctrl+clic sobre seleccionada: ${n2} → ${n3}`, n3 < n2 ? '→ REDUJO ✓' : '→ no redujo ✗');

  await navegador.close();
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });