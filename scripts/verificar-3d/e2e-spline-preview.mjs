// e2e-spline-preview.mjs: la CASILLA «Vista previa (volúmenes azules)» del
// panel del spline (en vivo, servidor :3002, NO se reinicia). Cubo → botón
// Spline → 2 clics en Frente (vértices) → la malla translúcida cian (el
// «globo») se cuenta por píxeles en el canvas de la ventana Frente →
// desmarcar la casilla: la malla DESAPARECE y quedan SOLO la línea cian y
// los marcadores de vértice; el conteo azul se derrumba.
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

// Cubo (contexto de escena real, como la prueba manual del usuario).
await page.evaluate(async () => {
  await window.__puente.executeAction('createObject', {
    type: 'mesh', name: 'CuboP', primitive: 'cube', ancho: 1, alto: 1, profundo: 1,
  });
});
await espera(1000);

// Conteo por DIFERENCIA: la malla translúcida cian (0x38bdf8 op .32) rinde
// (~25,~70,~95) sobre el fondo oscuro — filtrar por color absoluto es
// frágil; se comparan canvas ANTES y DESPUÉS y se cuentan los píxeles
// cambiados (el balón desaparecer/aparecer es un área enorme).
const snapshot = () => page.evaluate(() => {
  const cv = document.querySelector('[data-view="front"] canvas');
  const tmp = document.createElement('canvas');
  tmp.width = cv.width;
  tmp.height = cv.height;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(cv, 0, 0);
  return Array.from(ctx.getImageData(0, 0, cv.width, cv.height).data);
});
const difContra = (ref) => page.evaluate((refArr) => {
  const cv = document.querySelector('[data-view="front"] canvas');
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

// Modo spline + 2 vértices en Frente.
await page.click('[data-testid="boton-spline"]', { noWaitAfter: true });
await espera(700);
const frente = page.locator('[data-view="front"] canvas').first();
const fb = await frente.boundingBox();
revisar(!!fb, 'ventana Frente presente');
if (fb) {
  await page.mouse.click(fb.x + fb.width * 0.38, fb.y + fb.height * 0.45);
  await espera(400);
  await page.mouse.click(fb.x + fb.width * 0.6, fb.y + fb.height * 0.6);
  await espera(600);
}
revisar(await page.locator('[data-testid="spline-vertex-1"]').count() > 0, '2 vértices en la lista');

// La casilla nace DESMARCADA (default al revés, pedido 13/10): primero se
// marca para tener la referencia CON balón, luego se desmarca y comprobamos
// que desmarcada solo queda la línea.
const casilla = page.locator('[data-testid="spline-preview-toggle"]');
revisar(await casilla.count() > 0, 'casilla «Vista previa» presente');
revisar(!(await casilla.isChecked()), 'casilla DESmarcada por defecto (solo la línea)');
await casilla.check({ noWaitAfter: true });
await espera(600);
revisar(await casilla.isChecked(), 'casilla marcada: balón activado');
await espera(400);
const refBalon = await snapshot();
await page.screenshot({ path: `${OUT}/out-spline-prev-antes.png` });

// Desmarcar: el balón desaparece; la línea y los marcadores quedan.
await casilla.uncheck({ noWaitAfter: true });
await espera(600);
revisar(!(await casilla.isChecked()), 'casilla desmarcada');
const cambioOcultar = await difContra(refBalon);
revisar(cambioOcultar > 5000, `vista previa OCULTA al desmarcar (cambiaron ${cambioOcultar} px)`);
await page.screenshot({ path: `${OUT}/out-spline-prev-despues.png` });

// Volver a marcar: reaparece (el canvas vuelve a ser IDÉNTICO al del
// estado con balón: contra esa referencia la diferencia queda ~0).
await casilla.check({ noWaitAfter: true });
await espera(600);
const cambioVolver = await difContra(refBalon);
const estaMarcada = await casilla.isChecked();
revisar(
  estaMarcada && cambioVolver < 2000,
  `vista previa REAPARECE al marcar (dif ${cambioVolver} px, casilla=${estaMarcada})`,
);

revisar(errores.length === 0, `sin errores de página (${errores.length})${errores[0] ? `: ${errores[0].slice(0, 160)}` : ''}`);
await browser.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);