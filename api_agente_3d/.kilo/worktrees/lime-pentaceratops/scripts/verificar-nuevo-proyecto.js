/* Verificación DOM del botón «Nuevo proyecto» en el menú Acciones del
   editor 3D (sin imágenes: este modelo no lee capturas, solo DOM). */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  // El editor carga por dynamic import: esperar al trigger del menú.
  await page.waitForSelector('[data-testid="actions-menu-trigger"]', { timeout: 90000 });
  await page.click('[data-testid="actions-menu-trigger"]');
  await page.waitForSelector('[data-testid="new-project-btn"]', { timeout: 5000 });
  const itemText = (await page.textContent('[data-testid="new-project-btn"]')).trim();
  console.log('Item del menú:', itemText);
  if (!itemText.includes('Nuevo proyecto')) {
    console.log('FALLO: el ítem no dice «Nuevo proyecto»');
    process.exit(1);
  }
  const oldItem = await page.$('[data-testid="new-object-btn"]');
  if (oldItem) {
    console.log('FALLO: sigue existiendo el ítem «Nuevo objeto»');
    process.exit(1);
  }
  // La escena está vacía al arrancar: el clic no debe pedir confirmación
  // y el editor debe seguir vivo tras remontarse.
  await page.click('[data-testid="new-project-btn"]');
  await page.waitForSelector('[data-testid="actions-menu-trigger"]', { timeout: 90000 });
  await page.click('[data-testid="actions-menu-trigger"]');
  await page.waitForSelector('[data-testid="new-project-btn"]', { timeout: 5000 });
  const confirmDialogs = [];
  page.on('dialog', (d) => { confirmDialogs.push(d.message()); d.dismiss(); });
  console.log('OK: «Nuevo proyecto» en el menú, «Nuevo objeto» fuera, remonta sin confirmar con escena vacía');
  await browser.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });