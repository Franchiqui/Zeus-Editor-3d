/* Verifica el confirm de «Nuevo proyecto» con escena no vacía,
   usando teclado (Enter) para abrir el menú: evita bloqueos del clic
   cuando algo intercepta el puntero tras añadir la cámara. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let confirmMessage = null;
  page.on('dialog', async (d) => {
    confirmMessage = d.message();
    await d.accept();
  });
  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="add-camera-object-btn"]', { timeout: 90000 });
  await page.click('[data-testid="add-camera-object-btn"]');
  await page.waitForTimeout(1000);
  // ¿Qué hay en el punto del trigger? (diagnóstico del bloqueo)
  const atPoint = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="actions-menu-trigger"]');
    if (!t) return 'trigger no existe';
    const r = t.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return el ? `${el.tagName}.${(el.className || '').slice(0, 60)}` : 'nada';
  });
  console.log('En el punto del trigger:', atPoint);
  // Abrir el menú con teclado: focus + Enter (Radix DropdownMenu).
  await page.focus('[data-testid="actions-menu-trigger"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="new-project-btn"]', { timeout: 10000 });
  await page.keyboard.press('Enter'); // activa el ítem enfocado (el primero)
  await page.waitForTimeout(1500);
  console.log('Confirm mostrado:', confirmMessage ? 'SÍ' : 'NO');
  if (confirmMessage) console.log('Texto:', confirmMessage);
  // Tras aceptar el confirm el editor remonta limpio: el trigger vuelve.
  await page.waitForSelector('[data-testid="actions-menu-trigger"]', { timeout: 90000 });
  console.log('Editor remontado tras aceptar');
  await browser.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });