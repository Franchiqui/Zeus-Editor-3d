// e2e-extru-dos-pruebas.mjs: reproduce las DOS pruebas seguidas del usuario
// tras el ARREGLO (cada captura limpia el lienzo; Colocar admite calcados
// con la herramienta Línea; la 2.ª prueba no debe heredar el trazo viejo).
// Pesca el estado vivo de Editor3D (vistas/polilíneas/meta) tras cada paso.
import { sembrarAuth } from './comun.mjs';
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3002/edit-3d';
const OUT = 'scripts/verificar-3d';

let fallos = 0;
const revisar = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${msg}`);
  if (!cond) fallos++;
};
const cerca = (a, b, tol = 0.05) => Math.abs(a - b) < tol;

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await sembrarAuth(context);
const page = await context.newPage();
page.on('pageerror', (err) => console.log('PAGEERROR:', String(err).slice(0, 400)));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('CONSOLE:', msg.text().slice(0, 300));
});
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="viewer-container"] canvas', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));

// Puente
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

const n0 = await page.evaluate(async () => {
  const esc = await window.__puente.executeAction('getScene', {});
  return (esc?.objects ?? []).length;
});
await page.evaluate(async () => {
  await window.__puente.executeAction('createObject', {
    type: 'mesh', name: 'Cubo', primitive: 'cube', ancho: 1, alto: 1, profundo: 1,
  });
});
await new Promise((r) => setTimeout(r, 1000));

// Pesca del estado de Editor3D (vistas = {front}, polilíneas, metas).
const pescarEstado = () => page.evaluate(() => {
  const cont = document.querySelector('[data-testid="viewer-container"]');
  const fk = Object.keys(cont).find((k) => k.startsWith('__reactFiber$'));
  let raiz = cont[fk];
  for (let i = 0; i < 80 && raiz.return; i++) raiz = raiz.return;
  const vistos = new Set();
  const cola = [raiz];
  const metas = [], vistas = [], polylines = [];
  const redondea = (n, d = 3) => (typeof n === 'number' ? Math.round(n * 10 ** d) / 10 ** d : n);
  while (cola.length > 0) {
    const f = cola.pop();
    if (!f || vistos.has(f)) continue;
    vistos.add(f);
    if (f.child) cola.push(f.child);
    if (f.sibling) cola.push(f.sibling);
    for (let h = f.memoizedState; h; h = h.next) {
      const s = h.memoizedState;
      if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
      if (s.vista !== undefined && s.right && s.up && s.spanX) {
        metas.push({ vista: s.vista, spanX: redondea(s.spanX, 3), spanY: redondea(s.spanY, 3), centro: { x: redondea(s.centro.x), y: redondea(s.centro.y), z: redondea(s.centro.z) }, rotDeg: s.rotDeg, px: s.px, pxW: s.pxW, pxH: s.pxH });
      }
      if (s.front !== undefined && Array.isArray(s.front)) {
        vistas.push(s.front.map((q) => ({ x: redondea(q.x), y: redondea(q.y) })));
      }
      if (Array.isArray(s) && s.length > 0 && typeof s[0] === 'object' && 'id' in s[0] && 'points' in s[0]) {
        polylines.push(s.map((p) => ({ id: p.id, n: p.points.length })));
      }
    }
  }
  return { metas, vistas, polylines };
});

const escena = () => page.evaluate(async () => {
  const esc = await window.__puente.executeAction('getScene', {});
  return (esc?.objects ?? []).map((o) => ({ name: o.name, t: o.transform }));
});
const redT = (t) => t ? `{px:${(t.px ?? 0).toFixed(3)} py:${(t.py ?? 0).toFixed(3)} pz:${(t.pz ?? 0).toFixed(3)} sx:${(t.sx ?? 1).toFixed(3)} sy:${(t.sy ?? 1).toFixed(3)} sz:${(t.sz ?? 1).toFixed(3)}}` : '—';

// Trazo con la herramienta LÍNEA: selecciona la herramienta y pica puntos
// fracs del lienzo grande; re-pulsar Línea confirma (commit) la polilínea.
async function trazarConLinea(fracs) {
  await page.click('button:has-text("Línea")');
  await new Promise((r) => setTimeout(r, 200));
  const rectSvg = await page.locator('svg:has(image)').first().boundingBox();
  for (const frac of fracs) {
    await page.mouse.click(rectSvg.x + rectSvg.width * frac[0], rectSvg.y + rectSvg.height * frac[1]);
    await new Promise((r) => setTimeout(r, 200));
  }
  await page.mouse.click(rectSvg.x + rectSvg.width * fracs[0][0], rectSvg.y + rectSvg.height * fracs[0][1]);
  await new Promise((r) => setTimeout(r, 200));
  await page.click('button:has-text("Línea")'); // confirma el borrador
  await new Promise((r) => setTimeout(r, 700));
}

// ── PRUEBA 1: rombo con Línea ─────────────────────────────────────────────
await page.click('[data-testid="extru-spline-front"]');
await page.waitForSelector('[data-testid="extrude-colocar-btn"]', { timeout: 10000 });
await trazarConLinea([[0.44, 0.5], [0.5, 0.4], [0.56, 0.5], [0.5, 0.6]]);
await page.keyboard.press("Escape");
await new Promise((r) => setTimeout(r, 400));
await page.click('[data-testid="extrude-colocar-btn"]');
await new Promise((r) => setTimeout(r, 1200));

const est1 = await pescarEstado();
const objs1 = await escena();
const meta1 = est1.metas[est1.metas.length - 1];
const obj2 = objs1.find((o) => o.name !== 'Cubo');
console.log('\nTRAS PRUEBA 1 (rombo con Línea):');
console.log('  vistas(front):', JSON.stringify(est1.vistas));
console.log('  polylines:', JSON.stringify(est1.polylines));
console.log('  metas:', JSON.stringify(est1.metas));
for (const o of objs1) console.log(`  obj ${o.name} ${redT(o.t)}`);
revisar(!!meta1, 'meta de captura pescada');
revisar(!!obj2, 'objeto colocado (rombo)');
if (meta1 && obj2) {
  const t = obj2.t;
  const kx = 1, ky = meta1.pxH / meta1.px, ay = (meta1.px - meta1.pxH) / (2 * meta1.px);
  const fx0 = 0.44, fx1 = 0.56, fy0 = 0.4 * ky + ay, fy1 = 0.6 * ky + ay;
  const fcy = (fy0 + fy1) / 2;
  const esperadoPy = meta1.centro.y + (0.5 - fcy) * meta1.spanY * (meta1.centro && 1);
  revisar(cerca(t.sx, Math.abs(fx1 - fx0) * meta1.spanX / 2, 0.1), `rombo · escala X (esperado ${(Math.abs(fx1 - fx0) * meta1.spanX / 2).toFixed(3)} · real ${t.sx?.toFixed(3)})`);
  revisar(cerca(t.sy, Math.abs(fy1 - fy0) * meta1.spanY / 2, 0.05), `rombo · escala Y (esperado ${(Math.abs(fy1 - fy0) * meta1.spanY / 2).toFixed(3)} · real ${t.sy?.toFixed(3)})`);
  revisar(cerca(t.py, esperadoPy, 0.05), `rombo · posición Y (esperado ${esperadoPy.toFixed(3)} · real ${t.py?.toFixed(3)})`);
  revisar(typeof (obj2.t.rx) === 'number' && cerca(t.rx ?? 0, 0), 'rombo · sin giro (frontal)');
}

// ── PRUEBA 2: NUEVA captura + cuadrado grande con Línea ───────────────────
// Debe crear OTRO objeto cuyo tamaño NO dependa del trazo de la prueba 1.
await page.click('[data-testid="extru-spline-front"]');
await page.waitForSelector('[data-testid="extrude-colocar-btn"]', { timeout: 10000 });
await trazarConLinea([[0.3, 0.3], [0.7, 0.3], [0.7, 0.62], [0.3, 0.62]]);
await page.keyboard.press("Escape");
await new Promise((r) => setTimeout(r, 400));
await page.click('[data-testid="extrude-colocar-btn"]');
await new Promise((r) => setTimeout(r, 1200));

const est2 = await pescarEstado();
const objs2 = await escena();
const meta2 = est2.metas[est2.metas.length - 1];
const obj3 = objs2[objs2.length - 1];
console.log('\nTRAS PRUEBA 2 (cuadrado grande con Línea):');
console.log('  vistas(front):', JSON.stringify(est2.vistas));
console.log('  polylines:', JSON.stringify(est2.polylines));
console.log('  metas:', JSON.stringify(est2.metas));
for (const o of objs2) console.log(`  obj ${o.name} ${redT(o.t)}`);
revisar(objs2.length === n0 + 3, `la 2.ª prueba CREÓ su objeto (${objs2.length} = ${n0 + 3})`);
revisar(obj2 && est2.vistas.at(-1)?.length === 0, `el 2.º capture LIMPIÓ el lienzo (front ${JSON.stringify(est2.vistas.at(-1)?.length)})`);
if (meta2 && obj3) {
  const t = obj3.t;
  const ky = meta2.pxH / meta2.px, ay = (meta2.px - meta2.pxH) / (2 * meta2.px);
  const fx0 = 0.3, fx1 = 0.7, fy0 = 0.3 * ky + ay, fy1 = 0.62 * ky + ay;
  const fcy = (fy0 + fy1) / 2, fcx = 0.5;
  const esperadoPx = meta2.centro.x + (fcx - 0.5) * meta2.spanX * 1;
  const esperadoSy = Math.abs(fy1 - fy0) * meta2.spanY / 2;
  const esperadoSx = Math.abs(fx1 - fx0) * meta2.spanX / 2;
  revisar(cerca(t.sx, esperadoSx, 0.15), `cuadrado · escala X ≠ rombo (esperado ${esperadoSx.toFixed(3)} · real ${t.sx?.toFixed(3)})`);
  revisar(cerca(t.sy, esperadoSy, 0.1), `cuadrado · escala Y (esperado ${esperadoSy.toFixed(3)} · real ${t.sy?.toFixed(3)})`);
  revisar(cerca(t.px, esperadoPx, 0.1), `cuadrado · posición X ≈ centro (esperado ${esperadoPx.toFixed(3)} · real ${t.px?.toFixed(3)})`);
}

await page.screenshot({ path: `${OUT}/out-extru-2pruebas-todo.png` });
const contsP = await page.$$('[data-testid="viewer-container"]');
if (contsP.length > 0) {
  const box = await contsP[0].boundingBox();
  await page.screenshot({ path: `${OUT}/out-extru-2pruebas-frente.png`, clip: box });
}
await browser.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);