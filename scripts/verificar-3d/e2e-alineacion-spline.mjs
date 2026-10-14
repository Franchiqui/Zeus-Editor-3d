// e2e-alineacion-spline.mjs: la ALINEACIÓN de la plantilla calcada (⤢) a la
// ventana donde se dibujó (baseMundo, pedido 13/10), en vivo :3002:
//   1) Cubo lejos del origen → 2) Spline → 3) 2 vértices SEPARADOS
//      VERTICALMENTE en Frente (camino ⟂ al plano de la ventana Superior)
//   → 4) ⤢ de la ventana SUPERIOR → calco de 3 puntos → la plantilla queda
//      anclada a ESA ventana (baseMundo)
//   → 5) «Plantilla a TODOS»: el otro vértice hereda plantilla + escala +
//      tilt + baseMundo COMPLETOS (adiós a las «formas chicas»)
//   → 6) Con el balón activo, los CONTORNOS NARANJAS de cada plantilla se
//      ven (filtro de color naranja sobre el canvas de Frente); al
//      desmarcar la casilla desaparecen con el balón
//   → 7) Aplicar: el mesh horneado tiene SUS ANILLAS PLANAS EN XZ (la
//      plantilla sale orientada como se dibujó, no «torcida»)
import { sembrarAuth } from './comun.mjs';
import { chromium } from 'playwright';

const BASE_URL = process.env.E2E_BASE ?? 'http://localhost:3002/edit-3d';
const OUT = 'scripts/verificar-3d';

let fallos = 0;
const revisar = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${msg}`);
  if (!cond) fallos++;
};
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
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

// Puente (hooks + firstContext del árbol de React).
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
    type: 'mesh', name: 'CuboA', primitive: 'cube', ancho: 1, alto: 1, profundo: 1,
  });
});
await espera(1000);
await page.evaluate(() => window.__puente.executeAction('getScene', {})).then(async (esc) => {
  const cubo = (esc?.objects ?? []).find((o) => o.name === 'CuboA');
  revisar(!!cubo, 'cubo base en la escena');
  await page.evaluate(async (id) => {
    await window.__puente.executeAction('updateObject', { id, patch: { position: [1.2, 0.4, -0.8] } });
    await window.__puente.executeAction('selectObject', { id });
  }, cubo.id);
});
await espera(700);

// Pesca del spline vivo: nodes + baseMundo + tilt/escala por vértice.
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
      if (Array.isArray(s) && s.length === 2 && s[0] && typeof s[0] === 'object') s = s[0];
      if (s && typeof s === 'object' && !Array.isArray(s) && Array.isArray(s.nodes) && 'activoId' in s && 'onAdd' in s && 'onRemove' in s && 'closed' in s) {
        salida.push({
          nodes: s.nodes.map((n) => ({
            id: n.id,
            nVert: (n.polygon ?? []).length,
            escala: n.escala ?? null,
            tilt: n.tilt ?? null,
            base: n.baseMundo
              ? { rx: n.baseMundo.rx, ry: n.baseMundo.ry, right: n.baseMundo.right, up: n.baseMundo.up }
              : null,
            py: n.p?.y ?? null,
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
revisar(await page.locator('[data-testid="spline-panel"]').count() > 0, 'panel del spline visible');

// 3. Dos clics en Frente, MISMO x y distinto y: camino vertical ⟂ Superior.
const frenteBox = await page.locator('[data-view="front"] canvas').first().boundingBox();
revisar(!!frenteBox, 'ventana Frente presente');
if (frenteBox) {
  await page.mouse.click(frenteBox.x + frenteBox.width * 0.5, frenteBox.y + frenteBox.height * 0.28);
  await espera(400);
  await page.mouse.click(frenteBox.x + frenteBox.width * 0.5, frenteBox.y + frenteBox.height * 0.68);
  await espera(500);
}
let sp = await pescarSpline();
const sp2 = sp.find((s) => s.nodes.length === 2) ?? null;
revisar(!!sp2, `dos vértices en Frente (${sp.map((s) => s.nodes.length).join(',')})`);

// 4. ⤢ de la ventana SUPERIOR: captura con destino SPLINE + baseMundo.
await page.click('[data-testid="extru-spline-top"]', { noWaitAfter: true });
await espera(1200);
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
  return salida
    ? { spanX: salida.spanX, spanY: salida.spanY, px: salida.px, pxW: salida.pxW, pxH: salida.pxH, right: salida.right, up: salida.up }
    : null;
});
revisar(!!meta, 'meta de la captura pescada');
if (meta) {
  revisar(
    cerca(meta.right.x, 1, 1e-6) && cerca(meta.up.z, -1, 1e-6),
    `ventana Superior: right≈+X (${JSON.stringify(meta.right)}) up≈−Z (${JSON.stringify(meta.up)})`,
  );
}

// Calco de 3 puntos sobre el lienzo grande.
const svgMax = page.locator('svg:has(image)').first();
const rectSvg = await svgMax.boundingBox();
revisar(!!rectSvg, `lienzo grande visible (${Math.round(rectSvg?.width ?? 0)} px)`);
if (rectSvg) {
  await page.mouse.click(rectSvg.x + rectSvg.width * 0.40, rectSvg.y + rectSvg.height * 0.42);
  await espera(250);
  await page.mouse.click(rectSvg.x + rectSvg.width * 0.62, rectSvg.y + rectSvg.height * 0.42);
  await espera(250);
  await page.mouse.click(rectSvg.x + rectSvg.width * 0.62, rectSvg.y + rectSvg.height * 0.66);
  await espera(600);
}
const sp3 = (await pescarSpline()).find((s) => s.nodes.length === 2) ?? null;
const activo = sp3?.nodes.find((n) => n.id === sp3.activo) ?? null;
revisar((activo?.nVert ?? 0) >= 3, `calco en la plantilla del vértice activo (${activo?.nVert ?? 0} lados)`);
revisar(!!activo?.base, 'vértice activo con baseMundo (anclado a la ventana Superior)');
if (activo?.base && sp3) {
  const otro = sp3.nodes.find((n) => n.id !== activo.id);
  revisar(otro?.base === null, 'el OTRO vértice aún SIN anclaje (no lo tocó la captura)');
}

// 5. Escape cierra el lienzo; «Plantilla a TODOS» hereda la plantilla
//    COMPLETA (polygon + escala + tilt + baseMundo) — fin de las «chicas».
await page.keyboard.press('Escape');
await espera(700);
await page.click('[data-testid="spline-plantilla-todos"]', { noWaitAfter: true });
await espera(500);
const sp4 = (await pescarSpline()).find((s) => s.nodes.length === 2) ?? null;
if (sp4 && activo) {
  const act = sp4.nodes.find((n) => n.id === activo.id);
  const otros = sp4.nodes.filter((n) => n.id !== activo.id);
  const hermana = otros[otros.length - 1] ?? null;
  const mismas =
    hermana &&
    hermana.nVert === act.nVert &&
    cerca(hermana.escala ?? 0, act.escala ?? 0, 1e-9) &&
    cerca(hermana.tilt ?? 0, act.tilt ?? 0, 1e-9) &&
    cerca(hermana.base?.rx ?? 0, act.base?.rx ?? 0, 1e-9) &&
    cerca(hermana.base?.ry ?? 0, act.base?.ry ?? 0, 1e-9) &&
    !!hermana.base?.right && !!act.base?.right &&
    cerca(hermana.base.right.x, act.base.right.x, 1e-9) &&
    cerca(hermana.base.up.z, act.base.up.z, 1e-9);
  revisar(mismas, 'plantilla a TODOS: clon COMPLETO (polygon, escala, tilt, baseMundo)');
  if (mismas) {
    revisar((act.escala ?? 0) > 0.2, `escala heredada GRANDE (= captura, ${act.escala?.toFixed(3)}) — no la global 0.5`);
  }
} else {
  revisar(false, 'estado tras plantilla-a-todos');
}

// 6. Contornos NARANJAS de las plantillas con el balón activo.
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
// naranja 0xff9300 op 0.95 sobre fondo/cian: ~(243,140,3) — R alto, G medio, B bajo.
const cuentoNaranja = () => page.evaluate(() => {
  const cv = document.querySelector('[data-view="front"] canvas');
  const tmp = document.createElement('canvas');
  tmp.width = cv.width;
  tmp.height = cv.height;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(cv, 0, 0);
  const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] > 200 && px[i + 1] > 100 && px[i + 1] < 180 && px[i + 2] < 60) n++;
  }
  return n;
});

const casilla = page.locator('[data-testid="spline-preview-toggle"]');
revisar(await casilla.count() > 0, 'casilla «Vista previa» presente');
revisar(!(await casilla.isChecked()), 'casilla DESmarcada por defecto');
const naranjaSin = await cuentoNaranja();
await casilla.check({ noWaitAfter: true });
await espera(700);
const naranjaCon = await cuentoNaranja();
revisar(
  naranjaCon > 120 && naranjaCon > naranjaSin * 3,
  `contornos NARANJAS visibles con el balón (sin casilla ${naranjaSin} px, con casilla ${naranjaCon} px)`,
);
await page.screenshot({ path: `${OUT}/out-alinear-contornos.png` });
const refBalon = await snapshot();
await casilla.uncheck({ noWaitAfter: true });
await espera(600);
const naranjaApagada = await cuentoNaranja();
revisar(naranjaApagada <= Math.max(30, naranjaCon * 0.2), `contornos (y balón) desaparecen al desmarcar (${naranjaApagada} px naranja)`);
await casilla.check({ noWaitAfter: true });
await espera(600);
const cambioVolver = await difContra(refBalon);
revisar(cambioVolver < 3000, `reaparece idéntico al volver a marcar (dif ${cambioVolver} px)`);

// 7. Aplicar: el mesh horneado con anillas PLANAS EN XZ, orientado como
//    se dibujó (ancho en X, alto en Z — Superior: up=(0,0,−1)).
await page.click('[data-testid="spline-aplicar"]', { noWaitAfter: true });
await espera(1400);
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
  return (salida ?? []).map((o) => ({
    name: o.name,
    spline: o.spline ? { nodes: (o.spline.nodes ?? []).map((n) => ({ p: n.p, polygon: n.polygon, escala: n.escala, base: n.baseMundo ?? null })) } : null,
    mesh: o.mesh && Array.isArray(o.mesh.vertices) ? o.mesh.vertices : null,
  }));
});
const objetos = await pescarObjetos();
const horneado = objetos.find((o) => o.name !== 'CuboA' && o.mesh);
revisar(!!horneado, 'objeto del spline horneado con mesh');
if (horneado && horneado.mesh) {
  const verts = horneado.mesh;
  revisar(verts.length > 200, `mesh con vértices (${verts.length})`);
  // Anillas planas en XZ: cada anilla comparte su y → pocos valores de y
  // distintos (una muestra por cruce). Una anilla torcida haría la y
  // variar CONTINUO dentro de cada anilla.
  const ys = new Set(verts.map((v) => Math.round(v.y * 100)));
  revisar(
    ys.size < 40,
    `anillas PLANAS en XZ (${ys.size} valores de y distintos en ${verts.length} vértices; torcido tendría ~${verts.length})`,
  );
  // Orientado como se dibujó: cada extensión (X, Z) sale de la MISMA
  // fórmula que la malla, con las coordenadas REALES del calco fishado:
  //   eje-x de plantilla → right=(1,0,0) → X = (pxMax−pxMin)·UNIT·esc·rx
  //   eje-y → B (−up=+Z en Superior) →       Z = (pyMax−pyMin)·UNIT·esc·ry
  // (el lienzo no es 0..1: su span depende de zoom/mano — coord. fishadas).
  if (meta && horneado?.spline?.nodes?.length >= 2) {
    const act = horneado.spline.nodes.find((n) => n.base && n.polygon);
    revisar(!!act, 'el trazado horneado conserva polygon + baseMundo');
    if (act) {
      const poly = act.polygon;
      const pxM = Math.min(...poly.map((q) => q.x));
      const pxX = Math.max(...poly.map((q) => q.x));
      const pyM = Math.min(...poly.map((q) => q.y));
      const pyX = Math.max(...poly.map((q) => q.y));
      const esc = act.escala ?? 1;
      // X (right=(1,0,0)): el eje-x de la plantilla va a +X mundiales.
      let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
      for (const v of verts) {
        if (v.x < minx) minx = v.x;
        if (v.x > maxx) maxx = v.x;
        if (v.z < minz) minz = v.z;
        if (v.z > maxz) maxz = v.z;
      }
      const espX = Math.abs(pxX - pxM) * 2 * esc * act.base.rx;
      const espZ = Math.abs(pyX - pyM) * 2 * esc * act.base.ry;
      revisar(
        Math.abs((maxx - minx) - espX) < Math.max(0.05, espX * 0.1),
        `ancho en X = ancho dibujado·UNIT·esc·rx (${(maxx - minx).toFixed(3)} ≈ ${espX.toFixed(3)})`,
      );
      revisar(
        Math.abs((maxz - minz) - espZ) < Math.max(0.05, espZ * 0.1),
        `alto en Z = alto dibujado·UNIT·esc·ry (${(maxz - minz).toFixed(3)} ≈ ${espZ.toFixed(3)})`,
      );
    }
    const minY = Math.min(horneado.spline.nodes[0]?.p?.y ?? 0, horneado.spline.nodes[1]?.p?.y ?? 0);
    const maxY = Math.max(horneado.spline.nodes[0]?.p?.y ?? 0, horneado.spline.nodes[1]?.p?.y ?? 0);
    let anchoX = Infinity, altoZ2 = -Infinity;
    anchoX = 0; // evita el doble uso de minx/maxx fuera de bloque
    for (const v of verts) { if (v.z > altoZ2) altoZ2 = v.z; }
    revisar(
      Math.abs(maxY - minY) > 0.01 && isFinite(altoZ2),
      'camino vertical presente (la y del horneado recorre el trazado)',
    );
  } else {
    revisar(false, 'estado del spline tras aplicar (para el chequeo de orientación)');
  }
}
await page.screenshot({ path: `${OUT}/out-alinear-horneado.png` });

revisar(errores.length === 0, `sin errores de página (${errores.length})${errores[0] ? `: ${errores[0].slice(0, 160)}` : ''}`);

await browser.close();
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);