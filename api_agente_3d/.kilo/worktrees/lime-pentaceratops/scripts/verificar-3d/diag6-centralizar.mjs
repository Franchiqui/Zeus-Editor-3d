/**
 * DIAG6 — Panel de textura CENTRALIZADO en la pestaña Escena:
 * 1. Los controles de textura/color viven SOLO en Escena (0 en las demás).
 * 2. Aplicar textura desde Escena al objeto seleccionado (vía fiber).
 * 3. El deslizador de transparencia escribe mesh.opacity (vía fiber).
 * 4. Guardar/reabrir conserva textura y opacidad.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const LOGO = 'F:/Zeus Media Studio-3D/public/Nuevo-Logo.png';

const R = crearResultados('DIAG6 · panel de textura centralizado en Escena');

/** Vuelca los objetos de escena (vía fiber): textura y opacidad por objeto. */
async function volcar(page, etiqueta) {
  const filas = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (let c = 0; c < conts.length; c++) {
      const cont = conts[c];
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
                visor: c,
                name: o.name,
                frozen: !!o.frozen,
                owner: o.id === p.configObjectId,
                verts: (m.vertices || []).length,
                textura: !!m.texture,
                opacity: m.opacity ?? 1,
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
  return filas;
}

const { browser, page, errores } = await abrirEditor();

try {
  // 1. Los controles de textura SOLO viven en Escena.
  for (const pesta of ['views', 'mesh', 'text', 'lathe', 'extrude']) {
    await clicTab(page, pesta);
    await esperar(500);
    const n = await page.locator('[data-testid="scene-texture-field"]').count();
    R.check(n === 0,
      'pestaña ' + pesta + ': SIN campo de textura (centralizado)',
      'pestaña ' + pesta + ': TODAVÍA tiene ' + n + ' campo(s) de textura');
  }
  await clicTab(page, 'scene');
  await esperar(600);
  const campo = await page.locator('[data-testid="scene-texture-field"]').count();
  const opa = await page.locator('[data-testid="scene-figure-opacity"]').count();
  R.check(campo === 1,
    'Escena: el campo de textura centralizado está presente (' + campo + ')',
    'Escena: no se ve el campo centralizado (' + campo + ')');
  R.check(opa === 1,
    'Escena: el deslizador de transparencia del objeto está (' + opa + ')',
    'Escena: falta el deslizador de transparencia (' + opa + ')');

  // 2. Crear texto con fuente de color y pasar a Escena.
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(1200);
  await page.click('[data-testid="scene-object-0"]');
  await esperar(800);

  // 3. Aplicar textura DESDE Escena (input oculto centralizado).
  await page.setInputFiles('[data-testid="scene-texture-file-input"]', LOGO);
  await esperar(1800);
  const trasTextura = await volcar(page, 'tras aplicar textura en Escena');
  const obj = trasTextura.map((f) => JSON.parse(f))[0] || {};
  R.check(!!obj.textura,
    'Escena: la textura del panel llegó a la malla del objeto (vía fiber)',
    'Escena: el objeto NO recibió la textura del panel — BUG');

  // 4. Transparencia: foco en el pulgar del deslizador y «Inicio» →
  //    valor mínimo (opacidad 0.05), sin depender de la geometría.
  const pulgar = page.locator(
    '[data-testid="scene-figure-opacity"] [role="slider"]'
  );
  await pulgar.click();
  await page.keyboard.press('Home');
  await esperar(900);
  const trasOpacidad = await volcar(page, 'tras bajar la transparencia');
  const obj2 = trasOpacidad.map((f) => JSON.parse(f))[0] || {};
  R.check(obj2.opacity >= 0.05 && obj2.opacity < 0.7,
    'Escena: la transparencia del panel escribió mesh.opacity (' + obj2.opacity + ')',
    'Escena: mesh.opacity no cambió con el deslizador (' + obj2.opacity + ') — BUG');

  // 5. Guardar.
  const descarga = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-save-modal"]');
  await esperar(700);
  await page.fill('[data-testid="save-name-input"]', 'diag6-centralizar');
  await page.click('[data-testid="save-confirm-btn"]');
  const dl = await descarga;
  if (!dl) {
    R.error('no se disparó la descarga al guardar');
  } else {
    await dl.saveAs('diag6-centralizar.zeus');

    // 6. Reabrir y comprobar que textura y opacidad sobreviven.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="tab-scene"]', { timeout: 30000 });
    await esperar(1500);
    await page.click('[data-testid="actions-menu-trigger"]');
    await esperar(500);
    await page.click('[data-testid="open-obj3d-modal"]');
    await esperar(700);
    await page.setInputFiles('[data-testid="zeus-file-input"]', 'diag6-centralizar.zeus');
    await esperar(4000);
    const final = await volcar(page, 'tras reabrir');
    const objF = final.map((f) => JSON.parse(f))[0] || {};
    R.check(!!objF.textura,
      'reabierto: el objeto conserva su textura (' + (objF.texturaLen ?? 0) + ' bytes)',
      'reabierto: el objeto PERDIÓ la textura al reabrir — BUG');
    R.check(objF.opacity >= 0.05 && objF.opacity < 0.7,
      'reabierto: conserva la opacidad (' + objF.opacity + ')',
      'reabierto: perdió la opacidad (' + objF.opacity + ') — BUG');
  }
} finally {
  await R.resumen({ browser, errores });
}