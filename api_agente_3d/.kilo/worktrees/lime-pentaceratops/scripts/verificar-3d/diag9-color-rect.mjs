/**
 * DIAG9 — Color de figura desde Escena + rectángulo de selección parcial:
 * 1. El rectángulo discontinuo del visor (banda parcial, sin cubrir el
 *    canvas entero) selecciona a los 2 objetos.
 * 2. El color del panel centralizado repinta a los SELECCIONADOS (vía
 *    fiber: faceColors) y deja al resto con lo suyo.
 * 3. Guardar/reabrir: el color horneado sobrevive por objeto.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG9 · color en Escena + rectángulo parcial');

/** Vuelca los objetos (vía fiber): id, nombre y colores únicos de caras. */
async function volcar(page, etiqueta) {
  const filas = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (const cont of conts) {
      if (!cont) continue;
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      const hallados = [];
      const visit = (fib, prof) => {
        if (!fib || prof > 60 || hallados.length) return;
        const p = fib.memoizedProps;
        if (p && Array.isArray(p.sceneObjects) && p.sceneObjects.length > 0) {
          for (const o of p.sceneObjects) {
            const m = o.mesh || {};
            hallados.push(
              JSON.stringify({
                id: o.id.slice(-6),
                name: o.name,
                caras: (m.faces || []).length,
                colores: [...new Set(m.faceColors || [])],
              })
            );
          }
          return;
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f && !hallados.length; f = f.return) visit(f, 0);
      if (hallados.length) return hallados;
    }
    return [];
  }, []);
  console.log('  · [' + etiqueta + '] ' + filas.join(' | '));
  return filas.map((f) => JSON.parse(f));
}

/** Lee p.selectedObjectIds del fiber del visor (subiendo y bajando). */
async function leerSeleccion(page, etiqueta) {
  const sel = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (const cont of conts) {
      if (!cont) continue;
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      let hallado = null;
      const visit = (fib, prof) => {
        if (!fib || prof > 60 || hallado) return;
        const p = fib.memoizedProps;
        if (p && Array.isArray(p.selectedObjectIds)) {
          hallado = p.selectedObjectIds;
          return;
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f && !hallado; f = f.return) visit(f, 0);
      if (hallado) return hallado;
    }
    return null;
  }, []);
  console.log(
    '  · [' + etiqueta + '] seleccionados: ' + JSON.stringify(sel)
  );
  return sel || [];
}

/** Cambia el color del panel de Escena y devuelve el hex que muestra. */
/** Cambia el color del panel de Escena y devuelve el hex que muestra. */
const ponerColor = (page, color) =>
  page.evaluate(async (col) => {
    const el = document.querySelector('[data-testid="scene-figure-color"]');
    if (!el) throw new Error('sin control de color de Escena');
    // Con el setter NATIVO: `el.value = x` actualiza también el
    // rastreador interno de React y el onChange no se entera del cambio.
    const nativo = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set;
    nativo.call(el, col);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const hex = document
      .querySelector('[data-testid="scene-figure-color"]')
      ?.closest('div')?.previousElementSibling?.querySelector?.(
        'span.font-mono'
      )?.textContent;
    return hex ?? '(sin hex a la vista)';
  }, color);

// Ver quién escribe qué en vivo (instrumentación temporal del visor).
const { browser, page, errores } = await abrirEditor();
page.on('console', (msg) => {
  const t = msg.text();
  if (t.startsWith('[DIAG-RECT]')) console.log('    ' + t);
});


try {
  // 1. Dos objetos en Escena (texto + copia pegada).
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await page.click('[data-testid="copy-object-btn"]');
  await esperar(600);
  await clicTab(page, 'scene');
  await esperar(900);
  await page.click('[data-testid="paste-object-btn"]');
  await esperar(1400);

  // 2. Rectángulo PARCIAL del visor (banda central) → selecciona 2.
  const toggle = page
    .locator(
      'button[title="Seleccionar múltiples objetos (arrastra en la ventana)"]'
    )
    .last();
  await toggle.click({ force: true });
  await esperar(600);
  const lienzo = page
    .locator('[data-testid="viewer-container"] canvas')
    .last();
  const caja = await lienzo.boundingBox();
  if (caja) {
    await page.mouse.move(caja.x + caja.width * 0.2, caja.y + caja.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(
      caja.x + caja.width * 0.8,
      caja.y + caja.height * 0.65,
      { steps: 10 }
    );
    await page.mouse.up();
    await esperar(900);
  }
  const sel = await leerSeleccion(page, 'tras rectángulo central');
  R.check(
    sel.length === 2,
    'el rectángulo central selecciona los 2 objetos',
    'el rectángulo solo tomó ' + JSON.stringify(sel) + ' — BUG'
  );
  await toggle.click({ force: true }); // dejar el modo apagado

  // 3. Color con la multiselección del rectángulo: repinta a TODOS.
  const hex1 = await ponerColor(page, '#ff6600');
  console.log('  · [tras ponerColor] el panel muestra: ' + hex1);
  await esperar(900);
  const b = await volcar(page, 'tras color naranja (2 seleccionados)');
  R.check(
    b.length === 2 && b.every((o) => o.colores?.[0] === '#ff6600'),
    'el color del panel repinta a los 2 seleccionados (#ff6600)',
    'el color multiselección no llegó a todos: ' + JSON.stringify(b) + ' — BUG'
  );

  // 4. Guardar y reabrir: el color horneado sobrevive por objeto.
  const descarga = page
    .waitForEvent('download', { timeout: 30000 })
    .catch(() => null);
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-save-modal"]');
  await esperar(700);
  await page.fill('[data-testid="save-name-input"]', 'diag9-color');
  await page.click('[data-testid="save-confirm-btn"]');
  const dl = await descarga;
  if (!dl) {
    R.error('no se disparó la descarga al guardar');
  } else {
    await dl.saveAs('diag9-color.zeus');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="tab-scene"]', {
      timeout: 30000,
    });
    await esperar(1500);
    await page.click('[data-testid="actions-menu-trigger"]');
    await esperar(500);
    await page.click('[data-testid="open-obj3d-modal"]');
    await esperar(700);
    await page.setInputFiles(
      '[data-testid="zeus-file-input"]',
      'diag9-color.zeus'
    );
    await esperar(4000);
    const final = await volcar(page, 'tras reabrir');
    R.check(
      final.length === 2 && final.every((o) => o.colores?.[0] === '#ff6600'),
      'reabierto: ambos objetos conservan el color horneado',
      'reabierto: el color se perdió: ' + JSON.stringify(final) + ' — BUG'
    );

    // 5. POR OBJETO: activar solo la tarjeta 1 y darle OTRO color; el 0
    //    (sin selección) no se toca.
    await page.evaluate(() =>
      document.querySelector('[data-testid="scene-object-1"]')?.click()
    );
    await esperar(700);
    await ponerColor(page, '#0033ff');
    await esperar(900);
    const d = await volcar(page, 'tras 2º color (activo = tarjeta 1)');
    const d0 = d.find((o) => o.name === 'Objeto 1') || {};
    const d1 = d.find((o) => o.name === 'Objeto 2') || {};
    R.check(
      d1.colores?.length === 1 && d1.colores[0] === '#0033ff',
      'color POR OBJETO: el activo (tarjeta 1) pasa a #0033ff',
      'el color del activo no cambió: ' + JSON.stringify(d1) + ' — BUG'
    );
    R.check(
      d0.colores?.length === 1 && d0.colores[0] === '#ff6600',
      'color POR OBJETO: el otro conserva #ff6600',
      'el otro objeto cambió sin selección: ' + JSON.stringify(d0) + ' — BUG'
    );
  }
} finally {
  await R.resumen({ browser, errores });
}