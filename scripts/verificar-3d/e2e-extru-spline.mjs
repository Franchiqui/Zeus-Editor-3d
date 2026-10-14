// e2e-extru-spline.mjs: flujo COMPLETO del modo Extrusión spline en vivo.
// 1) crea un cubo por el puente, 2) pulsa «Extrusión spline» en la ventana
// Frontal, 3) la pestaña Extruir abre con la captura como plantilla, 4)
// traza 3 puntos sobre ella en el lienzo grande, 5) cierra (Esc) y pulsa
// «Colocar objeto», 6) verifica el transform del objeto nuevo contra el
// MATEMÁTICO esperado (misma regla que la libra, recalculada aquí) y
// captura pantallas. El servidor dev ya corre en :3002 (NO se reinicia).
import { sembrarAuth } from './comun.mjs';
import { chromium } from 'playwright';
import * as THREE from 'three';

const BASE_URL = process.env.E2E_BASE ?? 'http://localhost:3002/edit-3d';
const OUT = 'scripts/verificar-3d';

let fallos = 0;
const revisar = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${msg}`);
  if (!cond) fallos++;
};
const cerca = (a, b, tol = 0.02) => Math.abs(a - b) < tol;

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await sembrarAuth(context);
const page = await context.newPage();
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="viewer-container"] canvas', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));

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

const base0 = await page.evaluate(async () => {
  const esc = await window.__puente.executeAction('getScene', {});
  return (esc?.objects ?? []).length;
});
const res = await page.evaluate(async () => {
  const r = await window.__puente.executeAction('createObject', {
    type: 'mesh', name: 'Cubo', primitive: 'cube', ancho: 1, alto: 1, profundo: 1,
  });
  const esc = await window.__puente.executeAction('getScene', {});
  return { created: r?.result?.created ?? null, objetos: (esc?.objects ?? []).length };
});
console.log(`cubo creado: created=${res.created} objetos=${res.objetos} (antes ${base0})`);
revisar(res.objetos === base0 + 1, `createObject cubo creado (escena ${base0} → ${res.objetos})`);
await new Promise((r) => setTimeout(r, 1200));

// 1. Pulsa «Extrusión spline» en la ventana FRONTAL.
const btnExtru = page.locator('[data-testid="extru-spline-front"]');
revisar(await btnExtru.count() > 0, 'botón Extrusión spline existe en la ventana frontal');
await btnExtru.click();
await page.waitForSelector('[data-testid="extrude-colocar-btn"]', { timeout: 10000 });
revisar(true, 'pestaña Extruir abierta con la captura (botón Colocar presente)');

// La plantilla del lienzo grande trae el PNG de la captura.
const imgInfo = await page.evaluate(() => {
  const img = document.querySelector('svg image');
  const href = img?.getAttribute('href') ?? img?.getAttribute('xlink:href') ?? '';
  return { hay: !!img, esPNG: href.startsWith('data:image/png') };
});
revisar(imgInfo.hay && imgInfo.esPNG, 'plantilla = imagen PNG de la captura');

// 2. Traza 3 puntos sobre la plantilla (fracas del lienzo grande).
const svgMax = page.locator('svg:has(image)').first();
const rectSvg = await svgMax.boundingBox();
revisar(!!rectSvg, `lienzo grande visible (${Math.round(rectSvg?.width ?? 0)} px)`);
await page.mouse.click(rectSvg.x + rectSvg.width * 0.42, rectSvg.y + rectSvg.height * 0.42);
await new Promise((r) => setTimeout(r, 250));
await page.mouse.click(rectSvg.x + rectSvg.width * 0.58, rectSvg.y + rectSvg.height * 0.42);
await new Promise((r) => setTimeout(r, 250));
await page.mouse.click(rectSvg.x + rectSvg.width * 0.58, rectSvg.y + rectSvg.height * 0.66);
await new Promise((r) => setTimeout(r, 700)); // deja nacer al dueño del panel

// 3. Cierra el lienzo grande y pulsa «Colocar objeto».
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 500));
const btnColocar = page.locator('[data-testid="extrude-colocar-btn"]');
revisar(await btnColocar.isEnabled(), 'botón Colocar habilitado (el trazo tiene 3+ puntos)');
await btnColocar.click();
await new Promise((r) => setTimeout(r, 1500));

// 4. Verificación: escena por el PUENTE (getScene trae el transform de cada
// objeto) + el meta de la captura pescado escaneando TODOS los hooks del
// árbol de React (la meta viste vista/right/up/spanX).
const extraer = () => page.evaluate(() => {
  const cont = document.querySelector('[data-testid="viewer-container"]');
  const fk = Object.keys(cont).find((k) => k.startsWith('__reactFiber$'));
  let raiz = cont[fk];
  for (let i = 0; i < 80 && raiz.return; i++) raiz = raiz.return;
  const metas = [];
  const vistos = new Set();
  const cola = [raiz];
  while (cola.length > 0) {
    const f = cola.pop();
    if (!f || vistos.has(f)) continue;
    vistos.add(f);
    if (f.child) cola.push(f.child);
    if (f.sibling) cola.push(f.sibling);
    for (let h = f.memoizedState; h; h = h.next) {
      const s = h.memoizedState;
      if (s && typeof s === 'object' && s.vista !== undefined && s.right && s.up && s.spanX) metas.push(s);
    }
  }
  return { metas };
});
const verif = await extraer();
const escenaBridge = await page.evaluate(async () => {
  const esc = await window.__puente.executeAction('getScene', {});
  return (esc?.objects ?? []).map((o) => ({ name: o.name, transform: o.transform }));
});
console.log('escena (puente):', escenaBridge.map((o) => o.name).join(', '));
const metaCap = verif.metas[verif.metas.length - 1] ?? null;
const nuevo = escenaBridge.find((o) => o.name !== 'Cubo');
revisar(escenaBridge.length === base0 + 2, `escena con ${base0 + 2} objetos tras Colocar (${escenaBridge.length})`);
revisar(!!nuevo, `objeto NUEVO en la escena (el extraído)${nuevo ? ` → «${nuevo.name}»` : ''}`);
if (nuevo && metaCap) {
  const t = nuevo.transform;
  // Regla esperada (recalculada aquí desde el meta y el trazo clickado).
  const m = metaCap;
  const afrac = (u, eje) => {
    // plantilla a escala 1 sin offset → frac de lienzo = u mismo
    const k = eje === 'x' ? m.pxW / m.px : m.pxH / m.px;
    const a = eje === 'x' ? (m.px - m.pxW) / (2 * m.px) : (m.px - m.pxH) / (2 * m.px);
    return u * k + a;
  };
  const fx0 = afrac(0.42, 'x'), fx1 = afrac(0.58, 'x');
  const fy0 = afrac(0.42, 'y'), fy1 = afrac(0.66, 'y');
  const fcx = (fx0 + fx1) / 2; // la lib coloca por el CENTRO del bbox
  const fcy = (fy0 + fy1) / 2;
  const px = m.centro.x + (fcx - 0.5) * m.spanX * m.right.x + (0.5 - fcy) * m.spanY * m.up.x;
  const py = m.centro.y + (fcx - 0.5) * m.spanX * m.right.y + (0.5 - fcy) * m.spanY * m.up.y;
  const esperadoSx = Math.abs(fx1 - fx0) * m.spanX / 2;
  const esperadoSy = Math.abs(fy1 - fy0) * m.spanY / 2;
  revisar(cerca(t.px, px, 0.05) && cerca(t.py, py, 0.05), `posición exacta del trazo (esperado ${px.toFixed(3)}, ${py.toFixed(3)} · real ${t.px?.toFixed(3)}, ${t.py?.toFixed(3)})`);
  revisar(cerca(t.sx, esperadoSx, 0.05), `escala X exacta (esperado ${esperadoSx.toFixed(3)} · real ${t.sx?.toFixed(3)})`);
  revisar(cerca(t.sy, esperadoSy, 0.05), `escala Y exacta (esperado ${esperadoSy.toFixed(3)} · real ${t.sy?.toFixed(3)})`);
  revisar(cerca(t.sz ?? 1, 1, 1e-6), `sz = 1 (profundidad real de la malla) (${t.sz})`);
  revisar(cerca(t.rx, 0, 0.02) && cerca(t.ry, 0, 0.02) && cerca(t.rz, 0, 0.02), 'sin giro (captura frontal)');
} else {
  revisar(false, 'meta de captura pescada del estado de React');
}

// 5. Capturas: ventana frontal y 3D (el objeto nuevo debe estar EN SU SITIO).
await new Promise((r) => setTimeout(r, 800));
const conts = await page.$$('[data-testid="viewer-container"]');
await page.screenshot({ path: `${OUT}/out-extraspline-todo.png` });
if (conts.length > 0) {
  const box = await conts[0].boundingBox();
  await page.screenshot({ path: `${OUT}/out-extraspline-frente.png`, clip: box });
  const box3d = await conts[conts.length - 1].boundingBox();
  await page.screenshot({ path: `${OUT}/out-extraspline-3d.png`, clip: box3d });
}

await browser.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);