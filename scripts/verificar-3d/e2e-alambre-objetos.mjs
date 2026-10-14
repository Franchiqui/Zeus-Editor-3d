// e2e-alambre-objetos.mjs: modo ALAMBRE con objetos del CHAT (no dibujados):
// al poner una ventana en alambre, TODOS los objetos de la escena deben
// verse en alambre (antes solo el seleccionado — los duplicados ignoraban
// el modo). Carga Trineo, NO selecciona nada, pone la 3D en alambre.
import { sembrarAuth } from './comun.mjs';
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3002/edit-3d';
const OUT = 'scripts/verificar-3d';

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await sembrarAuth(context);
const page = await context.newPage();
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="viewer-container"] canvas', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));

await page.evaluate(() => {
  const cont = document.querySelector('[data-testid="viewer-container"]');
  const fk = Object.keys(cont).find((k) => k.startsWith('__reactFiber$'));
  let raiz = cont[fk];
  for (let i = 0; i < 80 && raiz.return; i++) raiz = raiz.return;
  const vistos = new Set(); const cola = [raiz];
  while (cola.length > 0) {
    const f = cola.pop();
    if (!f || vistos.has(f)) continue; vistos.add(f);
    for (let h = f.memoizedState; h; h = h.next) {
      const hv = h.memoizedState;
      if (hv && typeof hv === 'object' && 'executeAction' in hv && 'applyZeiaPlans' in hv) window.__puente = hv;
    }
    for (let d = f.dependencies?.firstContext; d; d = d.next) {
      const ms = d.memoizedValue ?? d.value;
      if (ms && typeof ms === 'object' && 'executeAction' in ms && 'applyZeiaPlans' in ms) window.__puente = ms;
    }
    if (f.child) cola.push(f.child);
    if (f.sibling) cola.push(f.sibling);
  }
});

const res = await page.evaluate(async () => {
  const r = await window.__puente.executeAction('loadSavedObject', { name: 'Coche' });
  const esc = await window.__puente.executeAction('getScene', {});
  return { created: r?.result?.created ?? null, n: (esc?.objects ?? []).length };
});
console.log('coche cargado:', JSON.stringify(res));

// TODAS las ventanas (3D + planas) a alambre — el modo es por ventana.
// selectOption dispara los eventos natives que React sí coge.
const modos = await page.locator('select[data-testid^="vista-modo-"]').all();
for (const sel of modos) await sel.selectOption('alambre');
console.log('modos a alambre:', await page.locator('select[data-testid^="vista-modo-"]').allTextContents());
await new Promise((r) => setTimeout(r, 3000));

const conts = await page.$$('[data-testid="viewer-container"]');
for (const w of [0, Math.max(0, conts.length - 1)]) {
  const box = await conts[w].boundingBox();
  const etiqueta = w === 0 ? 'frente' : '3d';
  await page.screenshot({ path: `${OUT}/out-alambre-coche-${etiqueta}.png`, clip: box });
}
console.log('capturas alambre guardadas');

// ── Vuelta a Textura: los duplicados deben restaurarse (materiales y
// sin aristas extra). Se remontan solos porque la firma vuelve a la original.
for (const sel of modos) await sel.selectOption('textura');
await new Promise((r) => setTimeout(r, 3000));
const conts2 = await page.$$('[data-testid="viewer-container"]');
for (const w of [0, Math.max(0, conts2.length - 1)]) {
  const box = await conts2[w].boundingBox();
  const etiqueta = w === 0 ? 'frente' : '3d';
  await page.screenshot({ path: `${OUT}/out-vuelta-coche-${etiqueta}.png`, clip: box });
}
console.log('capturas de vuelta a textura guardadas');
await browser.close();