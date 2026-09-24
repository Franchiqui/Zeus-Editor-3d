const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => console.log('goto:', e.message));
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'shot-edit3d-initial.png' });
  console.log('initial screenshot done');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });