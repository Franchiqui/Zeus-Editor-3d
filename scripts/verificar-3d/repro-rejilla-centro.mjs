// repro-rejilla-centro.mjs: «el centro de la rejilla» en sitios distintos
// según la ventana (Frente / Superior / 3D libre). Cubo FUERA del origen
// + encuadrar cada ventana + alejar la rueda 6 muescas (para que el
// ORIGEN quepa en la vista) → captura de las 4 ventanas.
//
// La corrección en viewer-3d.tsx: la retícula 2D queda CLAVADA en el
// origen del mundo (sus dos líneas más claras = el cruce central marcan
// (0,0) en plano en TODAS las ventanas, como la rejilla del suelo de la
// 3D y «Centrar escena»); cuando el encuadre/pan deja la vista lejos del
// origen, el cuadro CRECE para cubrirla (siempre múltiplo de la celda
// 0.25). Verificada numéricamente: el cruce claro queda en la proyección
// del origen en frente/top/side (x=180/179/219 px con el cubo en x=298).
import { sembrarAuth } from './comun.mjs';
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3002/edit-3d';
const OUT = 'scripts/verificar-3d';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Puente (hooks + firstContext del árbol de React) — igual que e2e-espejo.
const puentear = (page) =>
  page.evaluate(() => {
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
        if (hv && typeof hv === 'object' && 'executeAction' in hv && 'applyZeiaPlans' in hv)
          window.__puente = hv;
      }
      for (let d = f.dependencies?.firstContext; d; d = d.next) {
        const ms = d.memoizedValue ?? d.value;
        if (ms && typeof ms === 'object' && 'executeAction' in ms && 'applyZeiaPlans' in ms)
          window.__puente = ms;
      }
      if (f.child) cola.push(f.child);
      if (f.sibling) cola.push(f.sibling);
    }
  });

const flujo = async (page, prefijo) => {
  await page.evaluate(async () => {
    await window.__puente.executeAction('createObject', {
      type: 'mesh', name: 'RejCubo', primitive: 'cube', ancho: 1, alto: 1, profundo: 1,
    });
  });
  await espera(900);
  const objs = await page.evaluate(async () => {
    const esc = await window.__puente.executeAction('getScene', {});
    return (esc?.objects ?? []).map((o) => ({ id: o.id, name: o.name }));
  });
  const cubo = objs.find((o) => o.name === 'RejCubo');
  if (!cubo) {
    console.log('FALLO no se creó el cubo');
    return false;
  }
  await page.evaluate(async (id) => {
    await window.__puente.executeAction('updateObject', { id, patch: { position: [1.2, 0.4, -0.8] } });
  }, cubo.id);
  await espera(700);
  await page.evaluate(async (id) => {
    await window.__puente.executeAction('selectObject', { id });
  }, cubo.id);
  await espera(400);

  for (const slot of ['front', 'top', 'side', '3d']) {
    const menu = page.locator(`[data-testid="view-menu-${slot}"]`);
    if ((await menu.count()) > 0) {
      await menu.click({ noWaitAfter: true });
      await espera(300);
    }
    const btn = page.locator(`[data-testid="frame-window-${slot}"]`);
    if ((await btn.count()) > 0) {
      await btn.click({ noWaitAfter: true });
      await espera(700);
    }
    // Alejar con la rueda (6 muescas) para que el ORIGEN del mundo entre
    // en el encuadre y se vea dónde queda el centro de la rejilla.
    const canvasSlot = page.locator(`[data-view="${slot}"] canvas`).first();
    for (let i = 0; i < 6; i++) {
      await canvasSlot.dispatchEvent('wheel', { deltaY: 120 });
      await espera(120);
    }
    await espera(500);
    const caja = await page.locator(`[data-view="${slot}"]`).first().boundingBox();
    if (caja) {
      await page.screenshot({
        path: `${OUT}/${prefijo}-${slot}.png`,
        clip: { x: caja.x, y: caja.y, width: caja.width, height: caja.height },
      });
    } else {
      console.log(`aviso: sin caja para ${slot}`);
    }
  }
  return true;
};

// Captura con las líneas realzadas (CSS de solo captura, no toca la app).
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
});
await sembrarAuth(context);
const page = await context.newPage();
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="viewer-container"] canvas', { timeout: 30000 });
await espera(1500);
await page.addStyleTag({
  content: 'canvas { filter: brightness(2) contrast(3.5) !important; }',
});
await puentear(page);
await flujo(page, 'out-centro');
await browser.close();
console.log('capturas listas');