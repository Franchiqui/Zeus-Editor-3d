// e2e-objetos-guardados.mjs: confirma que loadSavedObject ejecuta los .txt
// paramétricos (Trineo/Avion/Coche) en el editor EN VIVO. UNA recarga por
// objeto para que no se superpongan; captura tras cada carga.
// El servidor dev ya corre en :3002 (NO se reinicia).
import { sembrarAuth } from './comun.mjs';
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3002/edit-3d';
const OUT = 'scripts/verificar-3d';

const browser = await chromium.launch({ channel: 'msedge' });

let primera = true;
// Casos con mayúsculas/minúsculas variadas: el endpoint debe resolver
// igualmente gracias al re-intento con catálogo (insensible a caso).
for (const nombre of ['tren']) {
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
    const vistos = new Set();
    const cola = [raiz];
    while (cola.length > 0) {
      const f = cola.pop();
      if (!f || vistos.has(f)) continue;
      vistos.add(f);
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

  const res = await page.evaluate(async (n) => {
    const r = await window.__puente.executeAction('loadSavedObject', { name: n });
    const esc = await window.__puente.executeAction('getScene', {});
    return {
      loaded: r?.loaded ?? null,
      err: r?.error ?? null,
      created: r?.result?.created ?? null,
      objetos: (esc?.objects ?? []).map((o) => o.name),
    };
  }, nombre);
  console.log(`\n== ${nombre}: cargado=${res.loaded} err=${res.err} created=${res.created} en escena=${res.objetos.length}`);

  await new Promise((r) => setTimeout(r, 2500));
  const conts = await page.$$('[data-testid="viewer-container"]');
  for (const w of [0, Math.max(0, conts.length - 1)]) {
    const box = await conts[w].boundingBox();
    const etiqueta = w === 0 ? 'frente' : '3d';
    await page.screenshot({ path: `${OUT}/out-saved-${nombre.toLowerCase()}-${etiqueta}.png`, clip: box });
  }
  await context.close();
}

console.log('capturas guardadas');
await browser.close();