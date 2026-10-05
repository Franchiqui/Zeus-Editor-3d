// Enfocado: tras un rectángulo pequeño, Ctrl+clic en varios puntos DENTRO
// del área seleccionada debe reducir la cuenta. Registra punto a punto.
const { chromium } = require('playwright');

(async () => {
  const navegador = await chromium.launch();
  const page = await navegador.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
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

  const toggleSel = await page.$('button[title*="Seleccionar caras"]');
  await toggleSel.evaluate((el) => el.click());
  await page.waitForTimeout(2000);

  const paneles = await page.evaluate(() =>
    [...document.querySelectorAll('canvas')]
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > r.height * 1.4)
  );
  const p = paneles[0];
  const cx = p.x + p.width / 2;
  const cy = p.y + p.height / 2;

  const cuenta = async () => {
    const t = await page.textContent('[data-testid="face-select-bar"]');
    return parseInt((t || '0').match(/^(\d+)/)?.[1] || '0');
  };

  // Rectángulo pequeño alrededor del centro.
  await page.mouse.move(cx - 25, cy - 18);
  await page.mouse.down();
  await page.mouse.move(cx + 25, cy + 18, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(3000);
  console.log('Tras rectángulo:', await cuenta());

  // Ctrl+clic en una rejilla de puntos DENTRO del área seleccionada.
  for (const [dx, dy] of [[-15, -10], [0, 0], [15, 10], [-10, 8], [12, -6]]) {
    await page.keyboard.down('Control');
    await page.mouse.click(cx + dx, cy + dy);
    await page.keyboard.up('Control');
    await page.waitForTimeout(2500);
    console.log(`Ctrl+clic (${dx},${dy}):`, await cuenta());
  }

  // Sin Ctrl, clic dentro: debe dejar SOLO esa cara.
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(2500);
  console.log('Clic simple dentro:', await cuenta());

  // Clic en el vacío (esquina del panel): debe deseleccionar todo.
  await page.mouse.click(p.x + 10, p.y + p.height - 10);
  await page.waitForTimeout(2500);
  console.log('Clic en vacío:', await cuenta());

  await navegador.close();
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });