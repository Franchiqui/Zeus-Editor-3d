// e2e-deform-guia.mjs: la GUÍA de los deformadores en vivo (servidor :3002,
// NO se reinicia). 1) cubo por el puente → activar Doblar → el slider
// «Guía» aparece en el panel; 2) escribir 50 → deformParams.guia = 50;
// 3) arrastrar el asa naranja en la ventana Frente (el cruce con el asa
// queda al centro del lienzo para un cubo de 1) → deformParams.guia
// cambia; 4) Aplicar → hornea y el panel sale.
import { sembrarAuth } from './comun.mjs';
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3002/edit-3d';
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

// Puente (hooks + firstContext del árbol de React) — igual que e2e-espejo-nuevo.
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

// 1. Cubo base.
await page.evaluate(async () => {
  await window.__puente.executeAction('createObject', {
    type: 'mesh', name: 'CuboG', primitive: 'cube', ancho: 1, alto: 1, profundo: 1,
  });
});
await espera(1000);
const objs = await page.evaluate(async () => {
  const esc = await window.__puente.executeAction('getScene', {});
  return (esc?.objects ?? []);
});
const cubo = objs.find((o) => o.name === 'CuboG');
revisar(!!cubo, 'cubo base en la escena');
await page.evaluate(async (id) => {
  await window.__puente.executeAction('selectObject', { id });
}, cubo.id);
await espera(400);

// Pescar deformParams (estado con claves angulo+guia) desde los hooks.
const pescarParams = () => page.evaluate(() => {
  const cont = document.querySelector('[data-testid="viewer-container"]');
  const fk = Object.keys(cont).find((k) => k.startsWith('__reactFiber$'));
  let raiz = cont[fk];
  for (let i = 0; i < 80 && raiz.return; i++) raiz = raiz.return;
  const vistos = new Set();
  const cola = [raiz];
  const salida = [];
  while (cola.length > 0) {
    const f = cola.pop();
    if (!f || vistos.has(f)) continue;
    vistos.add(f);
    if (f.child) cola.push(f.child);
    if (f.sibling) cola.push(f.sibling);
    for (let h = f.memoizedState; h; h = h.next) {
      const s = h && h.memoizedState;
      if (s && typeof s === 'object' && !Array.isArray(s) &&
          'angulo' in s && 'guia' in s && 'eje' in s) {
        salida.push({ angulo: s.angulo, guia: s.guia, eje: s.eje });
      }
    }
  }
  return salida;
});

// 2. Activar DOBLAR: el panel sale con el slider «Guía».
await page.click('[data-testid="deformador-doblar"]', { noWaitAfter: true });
await espera(800);
revisar(await page.locator('[data-testid="deform-panel"]').count() > 0, 'panel de deformador visible');
const entradaGuia = page.locator('[data-testid="deform-param-guia"]');
revisar(await entradaGuia.count() > 0, 'slider/input «Guía» presente');

// 3. Ángulo 90 y Guía 50 → deformParams actualiza por el camino del preview.
const entradaAngulo = page.locator('[data-testid="deform-param-angulo"]');
await entradaAngulo.fill('90');
await espera(400);
await entradaGuia.fill('50');
await espera(500);
let params = await pescarParams();
const p50 = params.find((p) => p.guia === 50);
revisar(!!p50, `guia=50 pescado de deformParams (${JSON.stringify(params)})`);

// 4. Arrastrar el asa naranja en FRENTE: el cruce queda al centro del
// lienzo (cubo de 1 unidad, guía en el centro). Ratón al centro → down →
// mover arriba 45 px → up.
const frenteBox = await page
  .locator('[data-view="front"] canvas')
  .first()
  .boundingBox();
revisar(!!frenteBox, 'lienzo Frente presente');
if (frenteBox) {
  await page.screenshot({ path: `${OUT}/out-deform-guia-antes.png` });
  const cx = frenteBox.x + frenteBox.width / 2;
  const cy = frenteBox.y + frenteBox.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 45, { steps: 6 });
  await page.mouse.up();
  await espera(500);
  params = await pescarParams();
  const cambio = params.find((p) => p.guia !== 50 && Number.isFinite(p.guia));
  revisar(!!cambio, `arrastre del asa cambia deformParams.guia (${JSON.stringify(params.slice(-2))})`);
  await page.screenshot({ path: `${OUT}/out-deform-guia-despues.png` });
}

// 5. Aplicar: hornea y el panel sale.
await page.click('[data-testid="deform-apply"]', { noWaitAfter: true });
await espera(900);
revisar(
  (await page.locator('[data-testid="deform-panel"]').count()) === 0,
  'Aplicar cierra el modo (panel fuera)'
);
revisar(errores.length === 0, `sin errores de página (${errores.length})${errores[0] ? `: ${errores[0].slice(0, 160)}` : ''}`);
await page.screenshot({ path: `${OUT}/out-deform-guia.png` });

await browser.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);