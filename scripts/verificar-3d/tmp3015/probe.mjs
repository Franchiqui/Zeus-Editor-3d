import { chromium } from 'playwright';
const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: 2000000000, id: 'v', collectionId: '_superusers', collectionName: '_superusers' })}.f`;
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await context.addInitScript((j) => {
  try { window.localStorage.setItem('pocketbase_auth', JSON.stringify({ token: j, record: { id: 'v', collectionName: '_superusers' }, model: { id: 'v' } })); } catch {}
}, jwt);
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message + '\nSTACK: ' + (e.stack || '').slice(0, 500)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE: ' + m.text().slice(0, 300)); });
page.on('requestfailed', (r) => console.log('REQFAIL: ' + r.url().slice(0, 120) + ' ' + (r.failure()?.errorText || '')));
await page.goto('http://localhost:3015/edit-3d', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="tab-scene"]', { timeout: 30000 });
await page.waitForTimeout(4000);
console.log('listo');
await browser.close();
