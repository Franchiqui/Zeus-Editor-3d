// e2e-gizmo-persistencia.mjs:persistencia por OBJETO de las asas del
// gizmo («Configurar asas del gizmo» — reporte del usuario 15/10). Flujo
// completo en vivo (servidor :3002, NO se reinicia):
//   cubo A + esfera B → seleccionar A → ⚙ Configurar asas → arrastrar el
//   asa Y → ⚙ Aplicar → seleccionar B (su gizmo centrado) → volver a A →
//   el gizmo de A vuelve a la configuración que se le guardó.
// Lectura de estado real: el display «Gizmo offset» del modal Objeto 3D.
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

// Cubo A + esfera B (el createObject de B lo deja seleccionado).
await page.evaluate(async () => {
  await window.__puente.executeAction('createObject', {
    type: 'mesh', name: 'GizmoA', primitive: 'cube', ancho: 1, alto: 1, profundo: 1,
  });
});
await espera(800);
await page.evaluate(async () => {
  await window.__puente.executeAction('createObject', {
    type: 'mesh', name: 'GizmoB', primitive: 'sphere', radio: 0.6,
  });
});
await espera(800);

// Seleccionar A con la fila de la lista (el camino real del usuario:
// handleObjectSelect — el executeAction selectObject NO congela/gestiona).
await page.click('[data-testid="scene-object-0"]', { noWaitAfter: true });
await espera(500);

/** Lee «Gizmo offset» del modal Objeto 3D (abre y cierra el modal). */
const leerOffset = async () => {
  await page.click('[data-testid="actions-menu-trigger"]', { noWaitAfter: true });
  await espera(350);
  await page.click('[data-testid="open-obj3d-modal"]', { noWaitAfter: true });
  await espera(600);
  const texto = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="gizmo-offset-info"]');
    return el ? el.textContent : null;
  });
  await espera(150);
  await page.keyboard.press('Escape');
  await espera(300);
  return texto;
};

const offAntes = await leerOffset();
console.log(`offset de A antes de configurar: «${offAntes}»`);

// ⚙ Configurar asas → arrastrar el asa Y (bola ≈ CSS (1293, 732) con la
// cámara por defecto de la ventana 3D Libre) → ⚙ Aplicar. Cada candidato:
// arrastre, lectura de offset por el modal, y break al primer éxito.
const entrarConfig = async () => {
  await page.click('[data-testid="gizmo-config-btn"]', { noWaitAfter: true });
  await espera(600);
};
let picado = false;
let offDespues = offAntes;
await entrarConfig();
await page.screenshot({ path: `${OUT}/out-gizmo-config.png` });
for (const [dx, dy, dyy] of [
  [0, 0, -45], [0, -2, -45], [0, 2, -45], [0, -4, -45],
  [0, 4, -45], [0, -6, -45], [0, 6, -45], [0, -8, -45],
]) {
  if (picado) break;
  await page.mouse.move(1293 + dx, 732 + dy);
  await page.mouse.down();
  await page.mouse.move(1293 + dx, 732 + dy + dyy, { steps: 8 });
  await page.mouse.up();
  await espera(400);
  // Aplicar (cierra config) → leer estado → volver a entrar en config
  // para el siguiente candidato si no picó.
  await page.click('[data-testid="gizmo-config-btn"]', { noWaitAfter: true });
  await espera(500);
  offDespues = await leerOffset();
  if (offDespues && offDespues !== offAntes) {
    picado = true;
    console.log(`asa picada con ([${dx}, ${dy}]), arrastre ${dyy}px`);
  } else {
    await entrarConfig();
  }
}
if (!picado) {
  // Última salida: salir de config y seguir con lo que haya.
  await page.keyboard.press('Escape');
  await espera(300);
}
console.log(`offset tras el barrido: «${offDespues}»`);
revisar(
  picado,
  `la configuración se GUARDÓ de verdad (offset cambió de «${offAntes}» a «${offDespues}»)`
);
await page.screenshot({ path: `${OUT}/out-gizmo-obj-a-config.png` });

// Seleccionar B: su gizmo debe ir SIN la configuración de A.
await page.click('[data-testid="scene-object-1"]', { noWaitAfter: true });
await espera(600);
const offB = await leerOffset();
console.log(`offset de B: «${offB}»`);

// Volver a A: SU configuración debe reaparecer (el corazón del reporte).
await page.click('[data-testid="scene-object-0"]', { noWaitAfter: true });
await espera(600);
const offVuelta = await leerOffset();
console.log(`offset de A al volver: «${offVuelta}»`);
revisar(
  offVuelta === offDespues,
  `A CONSERVA su configuración al volver (iguales: «${offVuelta}»)`
);
await page.screenshot({ path: `${OUT}/out-gizmo-obj-a-vuelta.png` });

revisar(errores.length === 0, `sin errores de página (${errores.length})${errores[0] ? `: ${errores[0].slice(0, 160)}` : ''}`);
await browser.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);