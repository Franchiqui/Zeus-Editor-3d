/**
 * DIAG8 — Configuración de textura POR OBJETO:
 * 1. Dos objetos; a cada uno SU textura y SUS ajustes desde el panel
 *    centralizado de Escena (cambiar de activo por tarjeta y por
 *    cuadradito; el panel debe saltar a los ajustes del activo).
 * 2. Guardar y reabrir: cada objeto conserva la SUYA (textura,
 *    repeticiones, proyección, acabado, transparencia).
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG8 · textura y ajustes por objeto (guardar/reabrir)');
const LOGO = 'F:/Zeus Media Studio-3D/public/Nuevo-Logo.png';
const ZEUS = 'F:/Zeus Media Studio-3D/public/Zeus-Media.png';

/** Vuelca los objetos de escena (vía fiber): sus ajustes de textura. */
async function volcar(page, etiqueta) {
  const filas = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (let c = 0; c < conts.length; c++) {
      const cont = conts[c];
      if (!cont) continue;
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      const hallados = [];
      const largos = [];
      const visit = (fib, prof) => {
        if (!fib || prof > 60) return;
        const p = fib.memoizedProps;
        if (p && Array.isArray(p.sceneObjects)) {
          largos.push(p.sceneObjects.length);
          if (p.sceneObjects.length > 0 && !hallados.length) {
            for (const o of p.sceneObjects) {
              const m = o.mesh || {};
              hallados.push(
                JSON.stringify({
                  name: o.name,
                  textura: !!m.texture,
                  repeticiones: m.textureRepeat ?? 1,
                  proyeccion: o.textureProjection ?? '—',
                  acabado: m.textureFinish ?? '—',
                  relieve: m.textureRelief ?? 0.25,
                  opacidad: m.opacity ?? 1,
                  verts: (m.vertices || []).length,
                })
              );
            }
          }
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
      if (hallados.length || largos.length) {
        console.log('  · [largos fiber] ' + JSON.stringify(largos));
        return hallados;
      }
    }
    return [];
  }, []);
  console.log('  · [' + etiqueta + '] ' + filas.join(' | '));
  return filas.map((f) => JSON.parse(f));
}

/** Clic en la tarjeta n de Escena sin pasar por elementos tapados. */
const pinTarjeta = (page, n) =>
  page.evaluate((idx) => {
    const el = document.querySelector(`[data-testid="scene-object-${idx}"]`);
    if (!el) throw new Error('sin tarjeta ' + idx);
    el.click();
  }, n);

const { browser, page, errores } = await abrirEditor();

// Ver quién escribe qué en vivo (instrumentación temporal del editor).
page.on('console', (msg) => {
  const t = msg.text();
  if (t.startsWith('[DIAG-')) console.log('    ' + t);
});
page.on('pageerror', (err) => {
  console.log('    [PAGEERROR] ' + String(err).slice(0, 300));
});

try {
  // 1. Objeto 0 (texto) y su copia (objeto 1).
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await page.click('[data-testid="copy-object-btn"]');
  await esperar(600);
  await clicTab(page, 'scene');
  await esperar(900);
  await page.click('[data-testid="paste-object-btn"]');
  await esperar(1400);

  // 2. OBJETO 0: textura A, repeticiones 3, proyección cilíndrica,
  //    acabado metálico, transparencia 0.05.
  await pinTarjeta(page, 0);
  await esperar(900);
  await page.setInputFiles('[data-testid="scene-texture-file-input"]', LOGO);
  await esperar(1500);
  await page.fill('[data-testid="scene-texture-repeat"]', '3');
  await esperar(700);
  await page.selectOption(
    '[data-testid="scene-texture-projection"]',
    'cylindrical'
  );
  await esperar(500);
  await page.selectOption('[data-testid="scene-texture-finish"]', 'metallic');
  await esperar(500);
  // Relieve: al máximo (Fin → 1).
  const relieve0 = page.locator(
    '[data-testid="scene-texture-relief"] [role="slider"]'
  );
  await relieve0.click({ force: true });
  await page.keyboard.press('End');
  await esperar(500);
  const pulgar = page.locator(
    '[data-testid="scene-figure-opacity"] [role="slider"]'
  );
  await pulgar.click({ force: true });
  await page.keyboard.press('Home');
  await esperar(800);
  const a = await volcar(page, 'objeto 0 configurado');
  const obj0 = a.find((o) => o.repeticiones === 3) || a[0] || {};
  R.check(
    !!obj0.textura && obj0.repeticiones === 3 &&
      obj0.proyeccion === 'cylindrical' && obj0.acabado === 'metallic' &&
      obj0.relieve === 1,
    'objeto 0: textura A + rep 3 + cilíndrica + metálico + relieve 1',
    'objeto 0 no quedó con SU configuración: ' + JSON.stringify(obj0) + ' — BUG'
  );

  // 3. OBJETO 1 (activo por TARJETA; el panel salta a lo suyo, sin
  //    textura) → textura B, repeticiones 5, planar, mate.
  await pinTarjeta(page, 1);
  await esperar(900);
  await page.setInputFiles('[data-testid="scene-texture-file-input"]', ZEUS);
  await esperar(1500);
  await page.fill('[data-testid="scene-texture-repeat"]', '5');
  await esperar(700);
  await page.selectOption('[data-testid="scene-texture-projection"]', 'planar');
  await esperar(500);
  await page.selectOption('[data-testid="scene-texture-finish"]', 'matte');
  await esperar(500);
  // Relieve: al mínimo (Inicio → 0).
  const relieve1 = page.locator(
    '[data-testid="scene-texture-relief"] [role="slider"]'
  );
  await relieve1.click({ force: true });
  await page.keyboard.press('Home');
  await esperar(500);
  const b = await volcar(page, 'objeto 1 configurado');
  const obj1 = b.find((o) => o.repeticiones === 5) || {};
  R.check(
    !!obj1.textura && obj1.proyeccion === 'planar' &&
      obj1.acabado === 'matte' && obj1.opacidad === 1 && obj1.relieve === 0,
    'objeto 1: textura B + rep 5 + planar + mate + relieve 0, y el 0 intacto',
    'objeto 1 no quedó con SU configuración: ' + JSON.stringify(b) + ' — BUG'
  );

  // 4. Guardar (descarga .zeus).
  const descarga = page
    .waitForEvent('download', { timeout: 30000 })
    .catch(() => null);
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-save-modal"]');
  await esperar(700);
  await page.fill('[data-testid="save-name-input"]', 'diag8-por-objeto');
  await page.click('[data-testid="save-confirm-btn"]');
  const dl = await descarga;
  if (!dl) {
    R.error('no se disparó la descarga al guardar');
  } else {
    await dl.saveAs('diag8-por-objeto.zeus');

    // 5. Reabrir: cada objeto debe conservar LO SUYO.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="tab-scene"]', { timeout: 30000 });
    await esperar(1500);
    await page.click('[data-testid="actions-menu-trigger"]');
    await esperar(500);
    await page.click('[data-testid="open-obj3d-modal"]');
    await esperar(700);
    await page.setInputFiles(
      '[data-testid="zeus-file-input"]',
      'diag8-por-objeto.zeus'
    );
    await esperar(4000);
    const final = await volcar(page, 'tras reabrir');
    const f0 = final.find((o) => o.repeticiones === 3) || {};
    const f1 = final.find((o) => o.repeticiones === 5) || {};
    R.check(
      !!f0.textura && f0.repeticiones === 3 &&
        f0.proyeccion === 'cylindrical' && f0.acabado === 'metallic' &&
        f0.opacidad <= 0.06 && f0.relieve === 1,
      'reabierto: el objeto 0 conserva SU textura/rep/proyección/acabado/transparencia (' +
        JSON.stringify(f0) + ')',
      'reabierto: el objeto 0 PERDIÓ su configuración — BUG'
    );
    R.check(
      !!f1.textura && f1.repeticiones === 5 &&
        f1.proyeccion === 'planar' && f1.acabado === 'matte' &&
        f1.opacidad === 1 && f1.relieve === 0,
      'reabierto: el objeto 1 conserva SU configuración (' +
        JSON.stringify(f1) + ')',
      'reabierto: el objeto 1 PERDIÓ su configuración — BUG'
    );
  }
} finally {
  await R.resumen({ browser, errores });
}