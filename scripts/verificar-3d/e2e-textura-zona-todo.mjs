// e2e-textura-zona-todo.mjs: los botones de textura por caras («Asignar
// textura» desde almacenamiento/galería/limpiar) de la barra flotante del
// selector deben ACTIVARSE con caras seleccionadas cuando el objetivo está
// 'todo' (el objetivo por defecto de Seleccionar: antes quedaban siempre
// deshabilitados, reporte del usuario 15/10). En vivo, servidor :3002.
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

// Cubo seleccionable (escena real) y SELECCIONADO (el botón Seleccionar
// exige un objeto activo).
await page.evaluate(async () => {
  await window.__puente.executeAction('createObject', {
    type: 'mesh', name: 'CuboT', primitive: 'cube', ancho: 1, alto: 1, profundo: 1,
  });
});
await espera(1000);
const idCubo = await page.evaluate(async () => {
  const esc = await window.__puente.executeAction('getScene', {});
  const c = (esc?.objects ?? []).find((o) => o.name === 'CuboT');
  await window.__puente.executeAction('selectObject', { id: c.id });
  return c.id;
});
revisar(!!idCubo, 'cubo creado y seleccionado');
await espera(500);

// Entra en Seleccionar (el objetivo nace 'todo').
await page.click('[data-testid="boton-seleccionar"]', { noWaitAfter: true });
await espera(700);

// Zona de rectángulo sobre caras del cubo en Frente.
const frente = page.locator('[data-view="front"] canvas').first();
const fb = await frente.boundingBox();
revisar(!!fb, 'ventana Frente presente');
if (fb) {
  const x = fb.x + fb.width / 2;
  const y = fb.y + fb.height / 2;
  await page.mouse.move(x - 60, y - 60);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 60, { steps: 8 });
  await page.mouse.up();
  await espera(700);
}

// La barra flotante aparece y lista la selección; los TRES botones de
// textura deben estar HABILITADOS.
const barra = page.locator('[data-testid="face-select-bar"]');
revisar(await barra.count() > 0, 'barra de selección presente');
const texto = (await barra.textContent()) ?? '';
revisar(texto.length > 0, `texto de la barra: «${texto.slice(0, 70)}»`);
for (const tid of ['face-texture-assign', 'face-texture-gallery', 'face-texture-clear']) {
  const btn = page.locator(`[data-testid="${tid}"]`);
  const n = await btn.count();
  if (n === 0) { revisar(false, `botón ${tid} presente en la barra`); continue; }
  const disabled = await btn.first().isDisabled();
  revisar(!disabled, `botón ${tid} HABILITADO con caras seleccionadas (objetivo todo)`);
  if (tid === 'face-texture-gallery' && !disabled) {
    // El desplegable de la galería abre el modal: solo comprobamos que el
    // clic no rompe nada (no interactiva hasta cerrar).
    await btn.first().click({ noWaitAfter: true });
    await espera(500);
    await btn.first().click({ noWaitAfter: true }).catch(() => {});
    await espera(300);
  }
}

revisar(errores.length === 0, `sin errores de página (${errores.length})${errores[0] ? `: ${errores[0].slice(0, 160)}` : ''}`);
await page.screenshot({ path: `${OUT}/out-textura-zona-todo.png` });
await browser.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);