/**
 * DIAG FX MULTI — Efectos visuales por objeto:
 * 1. Dos objetos, multiselección, "Llamas" en el menú FX → AMBOS llevan
 *    el efecto (efectos dentro de cada SceneObject).
 * 2. Colocar focos con clic en el objeto (modo colocación) → los focos
 *    quedan persistidos en el efecto del objeto golpeado.
 * 3. Guardar + reabrir → efectos y focos sobreviven (por objeto).
 * 4. Editor de movimiento: pista de Fuego → objectId del objeto; y la
 *    etiqueta «Fuego — <nombre>».
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  numObjetos,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG FX MULTI · efectos por objeto (multi, focos, guardar/reabrir, pistas)');

/** Vuelca objetos (efectos) y pistas de efecto vía React fiber. */
async function volcar(page, etiqueta) {
  const out = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (let c = 0; c < conts.length; c++) {
      const cont = conts[c];
      if (!cont) continue;
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      const objetos = [];
      const pistas = [];
      const visit = (fib, prof) => {
        if (!fib || prof > 60) return;
        const p = fib.memoizedProps;
        if (p && Array.isArray(p.sceneObjects) && p.sceneObjects.length > 0 && !objetos.length) {
          for (const o of p.sceneObjects) {
            objetos.push({
              id: o.id,
              name: o.name,
              efectos: (o.efectos ?? []).map((e) => ({
                tipo: e.tipo,
                activo: e.activo,
                focos: (e.focos ?? []).length,
                estrellas: (e.estrellas ?? []).length,
                params: Object.keys(e.params ?? {}),
              })),
            });
          }
        }
        if (p && Array.isArray(p.effectTracks) && p.effectTracks.length > 0) {
          for (const tr of p.effectTracks) {
            pistas.push({
              effectType: tr.effectType,
              objectId: tr.objectId ?? null,
              objectIds: tr.objectIds ?? null,
              duration: tr.duration,
              looping: tr.looping,
            });
          }
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
      if (objetos.length || pistas.length) return { objetos, pistas };
    }
    return { objetos: [], pistas: [] };
  });
  console.log(
    '  · [' + etiqueta + '] objetos=' + JSON.stringify(out.objetos) +
    ' pistas=' + JSON.stringify(out.pistas)
  );
  return out;
}

/** Total de focos colocados entre todos los efectos de fuego. */
const focosFuego = (vol) =>
  vol.objetos.reduce(
    (n, o) => n + o.efectos.filter((e) => e.tipo === 'fire').reduce((m, e) => m + e.focos, 0),
    0
  );

const { browser, page, errores } = await abrirEditor();

try {
  // 1. Dos objetos: texto + copia pegada.
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await page.click('[data-testid="copy-object-btn"]');
  await esperar(600);
  await clicTab(page, 'scene');
  await esperar(900);
  await page.click('[data-testid="paste-object-btn"]');
  await esperar(1400);
  const n = await numObjetos(page);
  R.check(n === 2, 'dos objetos en la escena (' + n + ')', 'se esperaban 2 objetos, hay ' + n + ' — BUG');

  // 2. Multiselección por las casillas de las tarjetas.
  await clicTab(page, 'scene');
  await esperar(800);
  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(600);
  await page.click('[data-testid="scene-object-check-1"]');
  await esperar(800);

  // 3. FX → Llamas: efecto en AMBOS objetos.
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Llamas', { exact: true }).first().click();
  await esperar(1200);
  let v = await volcar(page, 'tras Llamas en la multiselección');
  const conFuego = v.objetos.filter((o) =>
    o.efectos.some((e) => e.tipo === 'fire' && e.activo)
  );
  R.check(
    conFuego.length === 2,
    'los 2 objetos llevan el efecto de fuego por objeto (' + conFuego.length + ')',
    'solo ' + conFuego.length + ' de 2 objetos llevan fuego — BUG'
  );
  R.check(
    conFuego.every((o) => o.efectos.find((e) => e.tipo === 'fire').params.includes('fireCount')),
    'los efectos llevan params concretados (fireCount)',
    'el efecto de fuego llegó sin params — BUG'
  );

  // 4. Colocar focos: modo colocación y dos clics sobre el visor frontal.
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Colocar efecto', { exact: false }).first().click();
  await esperar(700);
  const c0 = page.locator('[data-testid="viewer-container"]').first();
  const caja = await c0.boundingBox();
  const cx = caja.x + caja.width / 2;
  const cy = caja.y + caja.height / 2;
  await page.mouse.click(cx, cy);
  await esperar(1000);
  v = await volcar(page, 'tras 1er foco');
  let tot = focosFuego(v);
  R.check(tot === 1, '1er clic de colocación → foco persistido en el objeto (total ' + tot + ')', 'el foco no quedó persistido (total ' + tot + ') — BUG');

  await page.mouse.click(cx + 50, cy - 50);
  await esperar(1000);
  v = await volcar(page, 'tras 2do clic');
  tot = focosFuego(v);
  R.check(tot >= 1, '2do clic: focos totales ' + tot + ' (sin pérdida)', 'los focos se perdieron con el 2do clic (' + tot + ') — BUG');

  // 5. Guardar + reabrir.
  const descarga = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-save-modal"]');
  await esperar(700);
  await page.fill('[data-testid="save-name-input"]', 'diag-fx-multi');
  await page.click('[data-testid="save-confirm-btn"]');
  const dl = await descarga;
  if (!dl) {
    R.error('no se disparó la descarga al guardar');
  } else {
    await dl.saveAs('diag-fx-multi.zeus');
    const antes = await volcar(page, 'antes de reabrir');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="tab-scene"]', { timeout: 30000 });
    await esperar(1500);
    await page.click('[data-testid="actions-menu-trigger"]');
    await esperar(500);
    await page.click('[data-testid="open-obj3d-modal"]');
    await esperar(700);
    await page.setInputFiles('[data-testid="zeus-file-input"]', 'diag-fx-multi.zeus');
    await esperar(4000);
    const despues = await volcar(page, 'tras reabrir');
    const conFuego2 = despues.objetos.filter((o) =>
      o.efectos.some((e) => e.tipo === 'fire' && e.activo)
    );
    R.check(
      conFuego2.length === 2,
      'reabierto: los 2 objetos conservan su efecto de fuego',
      'reabierto: solo ' + conFuego2.length + ' de 2 conservan fuego — BUG'
    );
    R.check(
      focosFuego(despues) === focosFuego(antes),
      'reabierto: los focos sobreviven (' + focosFuego(despues) + ')',
      'reabierto: los focos se PERDIERON (antes ' + focosFuego(antes) + ', ahora ' + focosFuego(despues) + ') — BUG'
    );

    // 6. Editor de movimiento: pista de fuego POR OBJETO.
    await page.click('[data-testid="actions-menu-trigger"]');
    await esperar(600);
    await page.click('[data-testid="open-motion-editor"]');
    await esperar(1500);
    // Seleccionar el tipo Fuego en el selector de efectos.
    const selFuego = page.locator('select', {
      has: page.locator('option[value="fire"]'),
    });
    await selFuego.first().selectOption('fire');
    await esperar(500);
    await page.getByText('Añadir pista de efecto', { exact: true }).first().click();
    await esperar(1200);
    const pistas = await volcar(page, 'pistas de efecto');
    const pista = pistas.pistas.find((t) => t.effectType === 'fire');
    R.check(
      !!pista,
      'el editor de movimiento creó la pista de fuego',
      'no hay pista de fuego en el editor de movimiento — BUG'
    );
    R.check(
      pista && (pista.objectId || pista.objectIds?.length),
      'la pista de fuego está ligada a un objeto (objectId=' + JSON.stringify(pista?.objectId ?? pista?.objectIds) + ')',
      'la pista de fuego no lleva objectId — BUG'
    );
    // Botón deshabilitado si ya existe la pista (objeto, tipo).
    const deshabilitado = await page
      .getByText('Añadir pista de efecto', { exact: true })
      .first()
      .isDisabled();
    R.check(
      deshabilitado,
      'el botón de añadir pista se deshabilita para (objeto, tipo)',
      'el botón de añadir pista no se deshabilitó con la pista existente — BUG'
    );
  }
} finally {
  await R.resumen({ browser, errores });
}