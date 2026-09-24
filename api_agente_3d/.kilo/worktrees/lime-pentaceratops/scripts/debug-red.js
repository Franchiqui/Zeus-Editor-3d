/* Comprueba qué código sirve el dev server: ¿llegó el parche del selector? */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const fallos = [];
  page.on('requestfailed', (req) => fallos.push(req.url().slice(-80) + ' :: ' + (req.failure()?.errorText ?? '')));
  page.on('response', (res) => { if (res.status() >= 400) fallos.push(res.status() + ' ' + res.url().slice(-80)); });
  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'networkidle', timeout: 90000 }).catch((e) => console.log('goto:', e.message.slice(0, 100)));
  await page.waitForTimeout(1500);
  const hayParche = await page.evaluate(() =>
    document.documentElement.outerHTML.length > 0 &&
    performance.getEntriesByType('resource').some((r) => r.name.includes('viewer-3d'))
  );
  console.log('Recursos con viewer-3d:', hayParche);
  console.log('Peticiones fallidas:', JSON.stringify(fallos.slice(0, 8), null, 1));
  await browser.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });