// e2e-gizmo-escuadra.mjs: el gizmo del objeto va SIEMPRE a ESCUADRA con el
// mundo (pedido del usuario 15/10): girar el objeto (patch de transform)
// NO tumba el manipulador — sus asas siguen mirando a los ejes del mundo,
// también en la ventana 3D (antes heredaba la rotación del objeto y se
// veaba inclinado con él). En vivo, servidor :3002. Comprobación: la
// franja vertical del asa-Y del gizmo (sobre el cubo) cambia ~nada al girar
// el cubo 45° (el asa seguía recta); el canvas EN CONJUNTO cambia mucho
// (el cubo sí giró).
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
    type: 'mesh', name: 'Escuadra', primitive: 'cube', ancho: 1, alto: 1, profundo: 1,
  });
});
await espera(1000);

/** Diferencia en una franja del canvas 3D (CSS 1273..1313 x, 690..740 y →
 *  píxeles del dispositivo a 2×) contra una referencia. */
const franjaAsaY = (ref) => page.evaluate((refArr) => {
  const cv = document.querySelector('[data-view="3d"] canvas');
  const tmp = document.createElement('canvas');
  tmp.width = cv.width;
  tmp.height = cv.height;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(cv, 0, 0);
  const now = ctx.getImageData(0, 0, cv.width, cv.height).data;
  // Franja del asa-Y: X del gizmo ≈ CSS 1293 → 2586..2626 disp; Y CSS
  // ~690..740 → 1380..1480. Solo la MITAD superior (sobre el cubo).
  const x0 = 2548, x1 = 2650, y0 = 1340, y1 = 1470;
  let n = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * cv.width + x) * 4;
      total++;
      if (
        Math.abs(now[i] - refArr[i]) > 12 ||
        Math.abs(now[i + 1] - refArr[i + 1]) > 12 ||
        Math.abs(now[i + 2] - refArr[i + 2]) > 12
      ) n++;
    }
  }
  return { cambio: n, total };
}, ref);

const snap = () => page.evaluate(() => {
  const cv = document.querySelector('[data-view="3d"] canvas');
  const tmp = document.createElement('canvas');
  tmp.width = cv.width;
  tmp.height = cv.height;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(cv, 0, 0);
  return Array.from(ctx.getImageData(0, 0, cv.width, cv.height).data);
});
const difTotal = (ref) => page.evaluate((refArr) => {
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

const refRecto = await snap();
// Girar el objeto 45° en Z (radianes) por el camino real (transform).
await page.evaluate(async () => {
  await window.__puente.executeAction('updateObject', {
    patch: { rx: 0, ry: 0, rz: Math.PI / 4 },
  });
});
await espera(900);
const refGirado = await snap();
const franja = await franjaAsaY(refRecto);
revisar(
  franja.cambio < 200,
  `el asa-Y del gizmo SIGUE a escuadra tras girar el objeto 45° (franja cambió ${franja.cambio}/${franja.total} px)`
);
const total = await difTotal(refRecto);
revisar(
  total > 20000,
  `el cubo SÍ giró (canvas completo cambió ${total} px)`
);
await page.screenshot({ path: `${OUT}/out-gizmo-escuadra.png` });

revisar(errores.length === 0, `sin errores de página (${errores.length})${errores[0] ? `: ${errores[0].slice(0, 160)}` : ''}`);
await browser.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);