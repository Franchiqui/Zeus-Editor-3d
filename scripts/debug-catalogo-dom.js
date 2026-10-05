/* Vuelca el DOM de las tarjetas del catálogo. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3002/edit-3d', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="scene-object-list"]', { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.focus('[data-testid="actions-menu-trigger"]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  for (let i = 0; i < 12; i++) {
    const t = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    if (t.startsWith('Objeto 3D') || t.startsWith('3D object')) break;
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return 'NO DIALOG';
    const sec = [...d.querySelectorAll('*')].filter((el) =>
      /(figura|HOLA|Zeus)/i.test((el.textContent || '').trim())
    );
    return sec.slice(0, 10).map((el) => {
      const path = [];
      let cur = el;
      for (let i = 0; i < 8 && cur && cur !== d; i++) {
        path.push(`${cur.tagName}[${cur.getAttribute('role') ?? ''}]`);
        cur = cur.parentElement;
      }
      return `${(el.textContent || '').trim().slice(0, 30)} :: ${path.join(' < ')}`;
    });
  });
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });