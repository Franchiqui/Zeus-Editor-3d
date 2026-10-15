// e2e-espejo-preview.mjs: vista previa del ESPEJO con el ratón sobre los
// ejes del desplegable (pedido del usuario 15/10). Cubo seleccionado →
// desplegable del Espejo → hover en «Eje X» (modo transformar): aparece el
// FANTASMA cian del espejado (pixeles nuevos en el canvas 3D); hover en el
// modo «Crear objeto nuevo» + «Eje X»: fantasma VERDE del gemelo AL LADO;
// el ratón fuera del desplegable: el fantasma desaparece.
import { sembrarAuth } from './comun.mjs';
import { chromium } from 'playwright';

const BASE_URL = process.env.E2E_BASE ?? 'http://localhost:3002/edit-3d';
const OUT = 'scripts/verificar-3d';

let fallos = 0;
const revisar = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${msg}`);
  if (!cond) fallos++;
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const difContra = (page, ref) => page.evaluate((refArr) => {
  const cv = document.querySelector('[data-view="3d"] canvas');
  const tmp = document.createElement('canvas');
  tmp.width = cv.width;
  tmp.height = cv.height;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(cv, 0, 0);
  const now = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 0; i < now.length; i += 4) {
    if (
      Math.abs(now[i] - refArr[i]) > 12 ||
      Math.abs(now[i + 1] - refArr[i + 1]) > 12 ||
      Math.abs(now[i + 2] - refArr[i + 2]) > 12
    ) n++;
  }
  return n;
}, ref);

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await sembrarAuth(context);
const page = await context.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(String(e)));
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="viewer-container"] canvas', { timeout: 30000 });
await espera(1500);

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
await page.evaluate(async () => {
  await window.__puente.executeAction('createObject', {
    type: 'mesh', name: 'EspejoP', primitive: 'cube', ancho: 1, alto: 1, profundo: 1,
  });
});
await espera(1000);

// Selección REAL (fila de la lista): el hover-preview opera sobre el objeto
// seleccionado; el createObject por el puente no selecciona (solo el
// usuario lo hace al crear/pulsar la fila).
await page.click('[data-testid="scene-object-0"]', { noWaitAfter: true });
await espera(500);

// Referencia SIN desplegable.
const snap = () => page.evaluate(() => {
  const cv = document.querySelector('[data-view="3d"] canvas');
  const tmp = document.createElement('canvas');
  tmp.width = cv.width;
  tmp.height = cv.height;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(cv, 0, 0);
  return Array.from(ctx.getImageData(0, 0, cv.width, cv.height).data);
});
const refSolo = await snap();

// Abrir el desplegable del Espejo y pasar el ratón por el eje X
// (modo por defecto: TRANSFORMAR).
await page.click('[data-testid="boton-espejo"]', { noWaitAfter: true });
await espera(500);
await page.hover('[data-testid="espejo-x"]');
await espera(700);
const pescaFlecha = await page.evaluate(() => {
  const cont = document.querySelector('[data-testid="viewer-container"]');
  const fk = Object.keys(cont).find((k) => k.startsWith('__reactFiber$'));
  let raiz = cont[fk];
  for (let i = 0; i < 80 && raiz.return; i++) raiz = raiz.return;
  const vistos = new Set();
  const cola = [raiz];
  const ejes = new Set();
  const gemelos = [];
  while (cola.length > 0) {
    const f = cola.pop();
    if (!f || vistos.has(f)) continue;
    vistos.add(f);
    for (let h = f.memoizedState; h; h = h.next) {
      const v = h.memoizedState;
      if (v === 'x' || v === 'y' || v === 'z') ejes.add(v);
      if (v && typeof v === 'object' && 'gemelo' in v) {
        gemelos.push({
          gemelo: v.gemelo,
          verts: v.mesh?.vertices?.length ?? null,
          transform: v.transform ? { ...v.transform } : null,
        });
      }
    }
    if (f.child) cola.push(f.child);
    if (f.sibling) cola.push(f.sibling);
  }
  return { ejes: [...ejes], gemelos };
});
console.log('pesca tras hover:', JSON.stringify(pescaFlecha));
await page.screenshot({ path: `${OUT}/out-espejo-debug-hover.png` });
const refHover = await snap();
const difHover = await difContra(page, refSolo);
revisar(difHover > 3000, `hover Eje X (transformar): fantasma CIAN visible (cambiaron ${difHover} px)`);
await page.screenshot({ path: `${OUT}/out-espejo-hover-transformar.png` });

// Mover el ratón FUERA del desplegable (neutral): el fantasma desaparece.
await page.mouse.move(700, 700);
await espera(700);
const difFuera = await difContra(page, refSolo);
revisar(difFuera < 2000, `ratón fuera: fantasma DESAPARECE (dif ${difFuera} px)`);

// Modo «Crear objeto nuevo» + hover eje X: GEMELO verde al lado. El menú
// sigue ABIERTO del paso anterior (mover el ratón fuera no lo cierra);
// no reabrir el trigger: su propio menú lo tapa y el clic muere.
await page.click('[data-testid="espejo-modo-nuevo"]', { noWaitAfter: true });
await espera(400);
await page.hover('[data-testid="espejo-x"]');
await espera(700);
const difGemelo = await difContra(page, refSolo);
revisar(difGemelo > 3000, `hover Eje X (gemelo nuevo): fantasma VERDE al lado (cambiaron ${difGemelo} px)`);
await page.screenshot({ path: `${OUT}/out-espejo-hover-gemelo.png` });

revisar(errores.length === 0, `sin errores de página (${errores.length})${errores[0] ? `: ${errores[0].slice(0, 160)}` : ''}`);
await browser.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);