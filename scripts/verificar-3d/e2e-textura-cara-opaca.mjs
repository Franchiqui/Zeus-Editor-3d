// e2e-textura-cara-opaca.mjs: reporte del usuario 15/10 — caras de un
// objeto de CRISTAL (transparencia global ≈ 95%): al asignarles una
// textura SIN transparencia propia, la cara queda OPACA (no arrastra el
// vidrio del objeto). En vivo, :3002:
//   cubo → transparencia 5% (Home en el slider de la escena) → Seleccionar
//   zona (1 cara central) → «Asignar textura» PNG ROJO opaco (por el input
//   de caras, el 3º input file) → SALIR del modo selección (2 pulsaciones:
//   la 1ª solo reabre su menú; el resaltado amarillo tapa la cara) → la
//   cara central del visor Frente sale ROJO OPACO (brillante) mientras el
//   resto del cubo sigue cristal. Control: textura CON alfa propio la
//   sustituye (vidrio conservado en texturas con alfa).
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
    type: 'mesh', name: 'Cristal', primitive: 'cube', ancho: 1, alto: 1, profundo: 1,
  });
});
await espera(800);
await page.click('[data-testid="scene-object-0"]', { noWaitAfter: true });
await espera(500);

// CRISTAL: transparencia al mínimo del slider de la escena (Home = 5%).
const slider = page.locator('[data-testid="scene-figure-opacity"]');
revisar(await slider.count() > 0, 'slider de transparencia del objeto presente');
await slider.click({ noWaitAfter: true });
await espera(200);
await slider.press('Home');
await espera(600);

// Selección por zona en Frente (la cara central).
await page.click('[data-testid="boton-seleccionar"]', { noWaitAfter: true });
await espera(600);
const frente = page.locator('[data-view="front"] canvas').first();
const fb = await frente.boundingBox();
revisar(!!fb, 'ventana Frente presente');
if (fb) {
  const x = fb.x + fb.width / 2;
  const y = fb.y + fb.height / 2;
  await page.mouse.move(x - 70, y - 70);
  await page.mouse.down();
  await page.mouse.move(x + 70, y + 70, { steps: 8 });
  await page.mouse.up();
  await espera(700);
}

// El input de CARA es el TERcero de input[type=file] (los dos primeros
// son la textura y el relieve GLOBALES del objeto).
const entrada = page.locator('input[type="file"][accept="image/*"]').nth(2);
await entrada.setInputFiles(`${OUT}/fixture-textura-roja.png`);
await espera(1200);

// SALIR del modo selección (dos pulsaciones con espera: la primera solo
// reabre el menú del botón); el resaltado amarillo tapa la cara.
await page.click('[data-testid="boton-seleccionar"]', { noWaitAfter: true });
await espera(900);
await page.click('[data-testid="boton-seleccionar"]', { noWaitAfter: true });
await espera(1000);

// Medición en Frente: ROJO CÁLIDO BRILLANTE (la cara texturizada opaca)
// y el resto (cristal) sin rojo.
const mide = (pageParam, cond) => pageParam.evaluate((condStr) => {
  const cv = document.querySelector('[data-view="front"] canvas');
  const tmp = document.createElement('canvas');
  tmp.width = cv.width;
  tmp.height = cv.height;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(cv, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let rojo = 0, verde = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    // condStr: 'rojo' | 'verde' — el calentamiento por iluminación tolerado.
    const esRojo = r > 140 && (r - g) > 35 && (r - b) > 25;
    const esVerde = g > 130 && (g - r) > 30;
    if (condStr === 'rojo') { if (esRojo) rojo++; }
    else if (esVerde) verde++;
  }
  return { rojo, verde };
}, cond);

const m1 = await mide(page, 'rojo');
console.log(`textura opaca: rojo=${m1.rojo}`);
revisar(m1.rojo > 250, `la cara texturizada queda OPACA (${m1.rojo} px de rojo iluminado; a 5% sería tenue y no brillaría)`);
await page.screenshot({ path: `${OUT}/out-textura-opaca.png` });

// CONTROL: textura CON alfa propio (verde translúcido): sustituye a la
// roja — la roja desaparece y la cara queda con el alfa de su textura.
const entrada2 = page.locator('input[type="file"][accept="image/*"]').nth(2);
await entrada2.setInputFiles(`${OUT}/fixture-textura-alfa.png`);
await espera(1200);
const m2 = await mide(page, 'verde');
console.log(`textura con alfa: verde=${m2.verde}`);
revisar(m2.verde > 800, `la textura CON alfa se ve (su propia transparencia: ${m2.verde} px verdes)`);
const m3 = await mide(page, 'rojo');
revisar(m3.rojo < 800, `la textura roja anterior DESAPARECió (${m3.rojo} px)`);
await page.screenshot({ path: `${OUT}/out-textura-alfa.png` });

revisar(errores.length === 0, `sin errores de página (${errores.length})${errores[0] ? `: ${errores[0].slice(0, 160)}` : ''}`);
await browser.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);