// e2e-captura-spline.mjs: el ⤢ Extrusión spline con DESTINO SPLINE (en
// vivo, servidor :3002, NO se reinicia). 1) cubo por el puente en un sitio
// distinto del origen → 2) botón Spline → 3) dos clics en la ventana
// Frente (clic = vértice, dos vértices en la lista) → 4) pulsa ⤢ en la
// MISMA ventana: la captura NO va a la pestaña Extruir — abre el lienzo
// grande de la plantilla del vértice ACTIVO con la captura como calco, la
// plantilla del lienzo LIMPIA y la escala del vértice preajustada al
// TAMÑO EXACTO del cuadro capturado → 5) traza 3 puntos: la plantilla
// queda del vértice al instante → 6) Aplicar: nace el objeto del spline.
import { sembrarAuth } from './comun.mjs';
import { chromium } from 'playwright';

const BASE_URL = process.env.E2E_BASE ?? 'http://localhost:3002/edit-3d';
const OUT = 'scripts/verificar-3d';

let fallos = 0;
const revisar = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${msg}`);
  if (!cond) fallos++;
};
const cerca = (a, b, tol = 0.02) => Math.abs(a - b) < tol;
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

// Puente (hooks + firstContext del árbol de React) — igual que e2e-deform-guia.
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

// 1. Cubo LEJOS del origen (para que el calco tenga qué calcarse).
await page.evaluate(async () => {
  await window.__puente.executeAction('createObject', {
    type: 'mesh', name: 'CuboS', primitive: 'cube', ancho: 1, alto: 1, profundo: 1,
  });
});
await espera(1000);
const objs = await page.evaluate(async () => {
  const esc = await window.__puente.executeAction('getScene', {});
  return (esc?.objects ?? []).map((o) => ({ id: o.id, name: o.name }));
});
const cubo = objs.find((o) => o.name === 'CuboS');
revisar(!!cubo, 'cubo base en la escena');
await page.evaluate(async (id) => {
  await window.__puente.executeAction('updateObject', { id, patch: { position: [1.2, 0.4, -0.8] } });
}, cubo.id);
await espera(700);
await page.evaluate(async (id) => {
  await window.__puente.executeAction('selectObject', { id });
}, cubo.id);
await espera(400);

// Pescar el estado del spline de los hooks: el memo `splineEdicion`
// (nodes + activoId + onAdd/onRemove...) se reconoce en el valor del
// useMemo — guardado como [valor, deps], hay que desenvolverlo. Ancla: la
// raíz del documento (el visor no existe cuando el lienzo grande
// reemplaza las ventanas; el panel del spline es solo en modo spline).
const pescarSpline = () => page.evaluate(() => {
  const ancla = document.querySelector('#__next')
    ?? document.querySelector('[data-testid="spline-panel"]')
    ?? document.querySelector('[data-testid="viewer-container"]');
  const fk = Object.keys(ancla).find((k) => k.startsWith('__reactFiber$'));
  let raiz = ancla[fk];
  for (let i = 0; i < 200 && raiz?.return; i++) raiz = raiz.return;
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
      let s = h && h.memoizedState;
      // useMemo guarda [valor, deps]: desenvolver UNA vez.
      if (Array.isArray(s) && s.length === 2 && s[0] && typeof s[0] === 'object') s = s[0];
      if (s && typeof s === 'object' && !Array.isArray(s) && Array.isArray(s.nodes) && 'activoId' in s && 'onAdd' in s && 'onRemove' in s && 'closed' in s) {
        salida.push({
          nodes: s.nodes.map((n) => ({
            id: n.id,
            nVert: (n.polygon ?? []).length,
            escala: n.escala,
            p: n.p,
          })),
          activo: s.activoId,
        });
      }
    }
  }
  return salida;
});

// 2. Modo spline.
await page.click('[data-testid="boton-spline"]', { noWaitAfter: true });
await espera(700);
let sp = await pescarSpline();
revisar(sp.some((s) => s.nodes.length === 0), 'modo spline activo, listo sin vértices');
revisar(await page.locator('[data-testid="spline-panel"]').count() > 0, 'panel del spline visible');

// 3. Dos clics en la ventana FRENNTE (clic = vértice): nacen 2 vértices.
const frenteBox = await page.locator('[data-view="front"] canvas').first().boundingBox();
revisar(!!frenteBox, 'ventana Frente presente');
if (frenteBox) {
  await page.mouse.click(frenteBox.x + frenteBox.width * 0.35, frenteBox.y + frenteBox.height * 0.45);
  await espera(400);
  await page.mouse.click(frenteBox.x + frenteBox.width * 0.62, frenteBox.y + frenteBox.height * 0.6);
  await espera(500);
}
sp = await pescarSpline();
const sp2 = sp.find((s) => s.nodes.length === 2) ?? null;
revisar(!!sp2, `dos vértices en la lista (${sp.length} estados, nodos ${sp.map((s) => s.nodes.length).join(',')})`);
if (sp2) {
  const n0 = sp2.nodes[0];
  revisar(n0.nVert >= 3, `vértice 1 con plantilla inicial (${n0.nVert} lados)`);
  const tituloSpline = await page.locator('[data-testid="extru-spline-front"]').getAttribute('title');
  revisar(
    (tituloSpline ?? '').includes('VÉRTICE') || (tituloSpline ?? '').includes('vértice'),
    `⤢ anuncia destino vértice («${(tituloSpline ?? '').slice(0, 70)}…»)`,
  );
}

// 4. ⤢ en la MISMA ventana: captura con destino SPLINE (vértice activo = el
// último clicado). La pestaña Extruir NO debe abrirse.
const escalaAntes = sp2?.nodes[1]?.escala ?? null; // sin propia = hereda la global
await page.click('[data-testid="extru-spline-front"]', { noWaitAfter: true });
await espera(1200);
revisar(
  (await page.locator('[data-testid="extrude-colocar-btn"]').count()) === 0,
  'sin botón Colocar (no abrió la pestaña Extruir, el destino de siempre)',
);
// Lienzo grande abierto con el PNG de la captura como plantilla.
const imgInfo = await page.evaluate(() => {
  const img = document.querySelector('svg image');
  const href = img?.getAttribute('href') ?? img?.getAttribute('xlink:href') ?? '';
  return { hay: !!img, esPNG: href.startsWith('data:image/png') };
});
revisar(imgInfo.hay && imgInfo.esPNG, 'lienzo grande con la captura como calco (imagen PNG)');

sp = await pescarSpline();
const sp3 = sp.find((s) => s.nodes.length === 2) ?? null;
revisar(!!sp3, 'spline vivo tras la captura (nada se limpió de más)');
const activo = sp3?.nodes.find((n) => n.id === sp3.activo) ?? null;
revisar(!!activo, 'hay vértice activo del destino');
revisar(activo?.nVert === 0, `plantilla del vértice activo LIMPIA para el calco (${activo?.nVert} lados)`);
revisar(
  activo?.escala != null && (escalaAntes == null || !cerca(activo.escala, escalaAntes, 1e-6)) && activo.escala <= 8,
  `escala del vértice PREAJUSTADA al tamaño de la captura (${escalaAntes ?? 'hereda-global'} → ${activo?.escala})`,
);
// El valor exacto debe cuadrar con el meta de la captura (spanX/Y en mundo).
// Ancla = raíz del documento (el visor no existe con el lienzo grande).
const meta = await page.evaluate(() => {
  const ancla = document.querySelector('#__next')
    ?? document.querySelector('[data-testid="spline-panel"]')
    ?? document.querySelector('[data-testid="viewer-container"]');
  const fk = Object.keys(ancla).find((k) => k.startsWith('__reactFiber$'));
  let raiz = ancla[fk];
  for (let i = 0; i < 200 && raiz?.return; i++) raiz = raiz.return;
  const vistos = new Set();
  const cola = [raiz];
  let salida = null;
  while (cola.length > 0) {
    const f = cola.pop();
    if (!f || vistos.has(f)) continue;
    vistos.add(f);
    if (f.child) cola.push(f.child);
    if (f.sibling) cola.push(f.sibling);
    for (let h = f.memoizedState; h; h = h.next) {
      const s = h && h.memoizedState;
      if (s && typeof s === 'object' && s.vista !== undefined && s.right && s.up && s.spanX) salida = s;
    }
  }
  return salida ? { spanX: salida.spanX, spanY: salida.spanY, px: salida.px, pxW: salida.pxW, pxH: salida.pxH } : null;
});
if (meta && activo?.escala != null) {
  const kX = meta.pxW / Math.max(1, meta.px);
  const kY = meta.pxH / Math.max(1, meta.px);
  const esperado = Math.max(0.05, Math.min(8, Math.max(meta.spanX * kX, meta.spanY * kY) / 2));
  revisar(
    cerca(activo.escala, esperado, 0.05),
    `escala = lado de mundo del cuadro capturado / 2 (esperado ${esperado.toFixed(3)} · real ${activo.escala.toFixed(3)})`,
  );
} else {
  revisar(false, 'meta de la captura pescada');
}

// 5. Traza 3 puntos sobre la captura en el lienzo grande (igual que
// e2e-extru-spline): la plantilla queda del vértice AL INSTANTE.
const svgMax = page.locator('svg:has(image)').first();
const rectSvg = await svgMax.boundingBox();
revisar(!!rectSvg, `lienzo grande visible (${Math.round(rectSvg?.width ?? 0)} px)`);
if (rectSvg) {
  await page.mouse.click(rectSvg.x + rectSvg.width * 0.42, rectSvg.y + rectSvg.height * 0.42);
  await espera(250);
  await page.mouse.click(rectSvg.x + rectSvg.width * 0.58, rectSvg.y + rectSvg.height * 0.42);
  await espera(250);
  await page.mouse.click(rectSvg.x + rectSvg.width * 0.58, rectSvg.y + rectSvg.height * 0.66);
  await espera(600);
}
sp = await pescarSpline();
const sp4 = sp.find((s) => s.nodes.length === 2) ?? null;
const traced = sp4?.nodes.find((n) => n.id === sp4.activo) ?? null;
revisar((traced?.nVert ?? 0) >= 3, `calco aplicado a la plantilla del vértice (${traced?.nVert} lados)`);

// 6. Esc escapa del lienzo; el vértice 1 conserva SU plantilla; Aplicar
// hornea el objeto del spline con las dos plantillas.
await page.keyboard.press('Escape');
await espera(700);
sp = await pescarSpline();
const sp5 = sp.find((s) => s.nodes.length === 2) ?? null;
const n1 = sp5?.nodes[0] ?? null;
revisar((n1?.nVert ?? 0) >= 3, `plantilla del vértice 1 INTACTA (${n1?.nVert} lados)`);
await page.screenshot({ path: `${OUT}/out-captura-spline-panel.png` });
await page.click('[data-testid="spline-aplicar"]', { noWaitAfter: true });
await espera(1200);
let final = null;
try {
  final = await page.evaluate(async () => {
    const esc = await window.__puente.executeAction('getScene', {});
    return (esc?.objects ?? []).map((o) => ({ name: o.name, spline: o.spline ?? null }));
  });
} catch {
  // El dev dev puede recargar la página (HMR) en medio de la verificación:
  // rearmar el puente y volver a pedir la escena.
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="viewer-container"] canvas', { timeout: 30000 });
  await espera(1200);
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
  final = await page.evaluate(async () => {
    const esc = await window.__puente.executeAction('getScene', {});
    return (esc?.objects ?? []).map((o) => ({ name: o.name, spline: o.spline ?? null }));
  });
}
const horneado = final.find((o) => o.name !== 'CuboS');
revisar(!!horneado, 'objeto del spline horneado (nuevo en la escena)');
// getScene (puente) no serializa `spline`: el trazado horneado se pesca
// del estado sceneObjects (array de objetos con transform+spline+mesh).
const pescarObjetos = () => page.evaluate(() => {
  const ancla = document.querySelector('#__next')
    ?? document.querySelector('[data-testid="viewer-container"]');
  const fk = Object.keys(ancla).find((k) => k.startsWith('__reactFiber$'));
  let raiz = ancla[fk];
  for (let i = 0; i < 200 && raiz?.return; i++) raiz = raiz.return;
  const vistos = new Set();
  const cola = [raiz];
  let salida = null;
  while (cola.length > 0 && !salida) {
    const f = cola.pop();
    if (!f || vistos.has(f)) continue;
    vistos.add(f);
    if (f.child) cola.push(f.child);
    if (f.sibling) cola.push(f.sibling);
    for (let h = f.memoizedState; h; h = h.next) {
      const s = h && h.memoizedState;
      if (Array.isArray(s) && s.length > 0 && s.every(
        (x) => x && typeof x === 'object' && 'transform' in x && ('spline' in x || 'mesh' in x || 'kind' in x)
      )) { salida = s; break; }
    }
  }
  return (salida ?? []).map((o) => ({ name: o.name, spline: o.spline ?? null }));
});
const conSpline = await pescarObjetos();
const horneadoS = conSpline.find((o) => o.name !== 'CuboS');
revisar(
  !!horneadoS?.spline?.nodes?.length && horneadoS.spline.nodes.some((n) => (n.polygon ?? []).length >= 3),
  'el objeto lleva el trazado con su plantilla calcada',
);
revisar(errores.length === 0, `sin errores de página (${errores.length})${errores[0] ? `: ${errores[0].slice(0, 160)}` : ''}`);
await page.screenshot({ path: `${OUT}/out-captura-spline.png` });

await browser.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);