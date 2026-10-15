// e2e-spline-prev-objeto.mjs: la casilla «Vista de objeto (gris, como
// aplicar)» del panel del spline (en vivo, servidor :3002, NO se reinicia).
// Cubo → botón Spline → 2 clics en Frente → marca «Vista previa» (balón
// azul activo) → marca «Vista de objeto»: la malla de la vista previa
// cambia de velo azul translúcido a gris sólido con sombreado (aspecto de
// tras «Aplicar») SIN dejar de editar: la línea cian del trazado y los
// contornos naranjas sigue dibujados encima.
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

// Cubo (contexto de escena real).
await page.evaluate(async () => {
  await window.__puente.executeAction('createObject', {
    type: 'mesh', name: 'CuboO', primitive: 'cube', ancho: 1, alto: 1, profundo: 1,
  });
});
await espera(1000);

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
const snapshot = () => page.evaluate(() => {
  const cv = document.querySelector('[data-view="front"] canvas');
  const tmp = document.createElement('canvas');
  tmp.width = cv.width;
  tmp.height = cv.height;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(cv, 0, 0);
  return Array.from(ctx.getImageData(0, 0, cv.width, cv.height).data);
});

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

// Vista previa (velo azul) activada: referencia.
const casilla = page.locator('[data-testid="spline-preview-toggle"]');
await casilla.check({ noWaitAfter: true });
await espera(600);
const refVelo = await snapshot();

// Casilla nueva: existe, nace desmarcada (con la vista previa activa está
// habilitada), y al marcarla la vista previa cambia de aspecto (velo azul
// → gris sólido con sombreado).
const casillaObj = page.locator('[data-testid="spline-preview-objeto"]');
revisar(await casillaObj.count() > 0, 'casilla «Vista de objeto» presente');
revisar(!(await casillaObj.isChecked()), 'casilla «Vista de objeto» DESmarcada por defecto');
await casillaObj.check({ noWaitAfter: true });
await espera(800);
const cambioObjeto = await difContra(refVelo);
revisar(cambioObjeto > 5000, `al marcar la vista cambia a gris de objeto (cambiaron ${cambioObjeto} px)`);
await page.screenshot({ path: `${OUT}/out-spline-prev-objeto.png` });
const refObjeto = await snapshot();
revisar(await casillaObj.isChecked(), 'casilla «Vista de objeto» marcada');

// Desmarcar: vuelve al velo azul (y el trazado sigue editable: los
// marcadores del spline están en la escena).
await casillaObj.uncheck({ noWaitAfter: true });
await espera(800);
const cambioVuelta = await difContra(refObjeto);
revisar(cambioVuelta > 5000, `al desmarcar vuelve al velo azul (cambiaron ${cambioVuelta} px)`);
// Y el canvas vuelve a ser igual a la referencia del velo (~0 cambio).
const difVelo = await difContra(refVelo);
revisar(difVelo < 2000, `el velo azul reaparece (dif ${difVelo} px)`);

// La casilla queda deshabilitada cuando la vista previa está apagada.
await casilla.uncheck({ noWaitAfter: true });
await espera(500);
revisar(await casillaObj.isDisabled(), 'sin vista previa, «Vista de objeto» deshabilitada');

revisar(errores.length === 0, `sin errores de página (${errores.length})${errores[0] ? `: ${errores[0].slice(0, 160)}` : ''}`);
await browser.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);