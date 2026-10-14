// e2e-espejo-nuevo.mjs: el desplegable del Espejo ahora ofrece DOS modos —
// TRANSFORMAR (original) y CREAR objeto nuevo gemelo espejado. En vivo:
// 1) cubo por el puente, 2) espejo X en modo transformar (sin objeto nuevo),
// 3) cambia a «Crear objeto nuevo», espejo Y → aparece «Cubo espejo» con la
// MISMA transformación (el gemelo cae encima: espejo sobre la caja propia)
// y queda seleccionado. El servidor dev ya corre en :3002 (NO se reinicia).
import { sembrarAuth } from './comun.mjs';
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3002/edit-3d';
const OUT = 'scripts/verificar-3d';

let fallos = 0;
const revisar = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${msg}`);
  if (!cond) fallos++;
};
const tIgual = (a, b) =>
  ['px', 'py', 'pz', 'rx', 'ry', 'rz'].every((k) => Math.abs((a?.[k] ?? 0) - (b?.[k] ?? 0)) < 1e-9)
  && ['sx', 'sy', 'sz'].every((k) => Math.abs((a?.[k] ?? 1) - (b?.[k] ?? 1)) < 1e-9);

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await sembrarAuth(context);
const page = await context.newPage();
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="viewer-container"] canvas', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));

// Puente (hooks + firstContext del árbol de React).
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

const escena = () => page.evaluate(async () => {
  const esc = await window.__puente.executeAction('getScene', {});
  return (esc?.objects ?? []).map((o) => ({ id: o.id, name: o.name, transform: o.transform }));
});
const sel = (id) => page.evaluate(async (idSel) => {
  await window.__puente.executeAction('selectObject', { id: idSel });
}, id);
const redT = (t) => t ? `{px:${t.px} py:${t.py} sx:${t.sx} sy:${t.sy}}` : '—';

// 1. Cubo base con selección explícita.
await page.evaluate(async () => {
  await window.__puente.executeAction('createObject', {
    type: 'mesh', name: 'Cubo', primitive: 'cube', ancho: 1, alto: 1, profundo: 1,
  });
});
await new Promise((r) => setTimeout(r, 1000));
const objs0 = await escena();
const cubo = objs0.find((o) => o.name === 'Cubo');
revisar(!!cubo, 'cubo base en la escena');
await sel(cubo.id);
await new Promise((r) => setTimeout(r, 400));

// 2. Modo TRANSFORMAR (por defecto): espejo X NO crea objeto.
await page.click('[data-testid="boton-espejo"]');
await new Promise((r) => setTimeout(r, 300));
const radioT = page.locator('[data-testid="espejo-modo-transformar"]');
revisar(await radioT.count() > 0, 'radio «Transformar el objeto» visible');
const radioN = page.locator('[data-testid="espejo-modo-nuevo"]');
revisar(await radioN.count() > 0, 'radio «Crear objeto nuevo» visible');
await page.click('[data-testid="espejo-x"]');
await new Promise((r) => setTimeout(r, 800));
const objs1 = await escena();
revisar(objs1.length === objs0.length, `modo transformar NO crea objeto (${objs1.length})`);

// 3. Cambiar a CREAR NUEVO y espejo Y → gemelo «Cubo espejo».
await page.click('[data-testid="boton-espejo"]');
await new Promise((r) => setTimeout(r, 300));
await page.click('[data-testid="espejo-modo-nuevo"]');
await new Promise((r) => setTimeout(r, 200));
await page.click('[data-testid="espejo-y"]');
await new Promise((r) => setTimeout(r, 800));
const objs2 = await escena();
const gemelo = objs2.find((o) => o.name !== 'Cubo');
revisar(objs2.length === objs0.length + 1, `modo nuevo CREÓ su objeto (${objs2.length} = ${objs0.length + 1})`);
revisar(!!gemelo, `gemelo en la escena${gemelo ? ` → «${gemelo.name}»` : ''}`);
revisar(!!gemelo && /espejo|mirror/i.test(gemelo.name), `gemelo con sufijo de espejo («${gemelo?.name}»)`);
revisar(!!gemelo && tIgual(gemelo.transform, cubo.transform), `gemelo con la MISMA transformación ${gemelo ? redT(gemelo.transform) : ''} vs ${redT(cubo.transform)}`);

// 4. El gemelo quedó seleccionado (el estado de React pesca el hook string).
const selDespues = await page.evaluate((ids) => {
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
    if (f.child) cola.push(f.child);
    if (f.sibling) cola.push(f.sibling);
    for (let h = f.memoizedState; h; h = h.next) {
      const s = h && h.memoizedState;
      if (typeof s === 'string' && ids.includes(s)) return s;
    }
  }
  return null;
}, [gemelo?.id, cubo.id]);
revisar(selDespues === gemelo?.id, `gemelo quedó seleccionado (${selDespues ? 'sí' : 'no pescado'})`);

await page.screenshot({ path: `${OUT}/out-espejo-nuevo.png` });
await browser.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);