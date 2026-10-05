/**
 * DIAG FX DESELECCION — ¿Se apagan los efectos al DESMARCAR la selección?
 * 1. Dos objetos, multiselección, Llamas en ambos → tinta sube.
 * 2. Desmarcar el objeto 1 → el fuego del activo debe seguir viéndose.
 * 3. Desmarcar el objeto 0 (nada seleccionado) → el fuego de AMBOS debe
 *    seguir viéndose.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  medirFrontal,
  numObjetos,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG FX DESELECCION · efectos al desmarcar la selección');

/** Vuelca el estado THREE de los runtimes de FX vía React fiber. */
async function estadoFx(page, etiqueta) {
  const out = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (let c = 0; c < conts.length; c++) {
      const cont = conts[c];
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      const visit = (fib, prof) => {
        if (!fib || prof > 60) return null;
        const st = fib.memoizedState;
        for (let s = st; s; s = s.next) {
          const cur = s.memoizedState;
          const ref = cur && typeof cur === 'object' && 'current' in cur ? cur.current : null;
          if (ref && typeof ref === 'object' && ref.isGroup && ref.userData?.sceneObjectId) {
            return ref; // meshGroup
          }
        }
        const a = visit(fib.child, prof + 1);
        if (a) return a;
        return visit(fib.sibling, prof + 1);
      };
      const mg = visit(cont[llave], 0);
      if (!mg) continue;
      const res = { activo: mg.userData.sceneObjectId ?? null, grupos: [] };
      const contar = (grupo, origen) => {
        let puntos = 0;
        let visibles = 0;
        grupo.traverse((o) => {
          if (o.isPoints && o.visible) {
            puntos += (o.geometry?.getAttribute?.('position')?.count) || 0;
            visibles++;
          }
        });
        if (puntos > 0) res.grupos.push({ origen: origen, puntos });
      };
      // Grupo FX dentro de la malla principal.
      for (const h of mg.children) {
        if (h.userData?.esGrupoFx) contar(h, 'principal(activo)');
      }
      // Grupos FX dentro de duplicados.
      for (const dup of mg.children) {
        if (!dup.userData?.sceneObjectDuplicate) continue;
        for (const h of dup.children) {
          if (h.userData?.esGrupoFx) {
            contar(h, 'duplicado:' + String(dup.userData.sceneObjectId).slice(0, 6));
          }
        }
      }
      return res;
    }
    return null;
  });
  console.log('  · [' + etiqueta + '] ' + JSON.stringify(out));
  return out;
}

const { browser, page, errores } = await abrirEditor();

try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await page.click('[data-testid="copy-object-btn"]');
  await esperar(600);
  await clicTab(page, 'scene');
  await esperar(900);
  await page.click('[data-testid="paste-object-btn"]');
  await esperar(1400);
  R.check((await numObjetos(page)) === 2, 'dos objetos', 'no hay 2 objetos — BUG');

  // Multiselección + fuego en ambos.
  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(500);
  await page.click('[data-testid="scene-object-check-1"]');
  await esperar(700);
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Llamas', { exact: true }).first().click();
  await esperar(2500);

  const base = await medirFrontal(page);
  await estadoFx(page, 'fuego en ambos (seleccionados)');
  R.check(!!base && base.tinta > 800, 'fuego encendido con selección (tinta ' + base?.tinta + ')', 'no arrancó el fuego — BUG');

  // Desmarcar el objeto 1: el activo pasa a ser el objeto 0.
  await page.click('[data-testid="scene-object-check-1"]');
  await esperar(2200);
  const solo0 = await medirFrontal(page);
  await estadoFx(page, 'tras desmarcar objeto 1');
  R.check(
    !!solo0 && !!base && solo0.tinta > base.tinta * 0.75,
    `tras desmarcar 1, el fuego sigue visible (${base?.tinta} → ${solo0?.tinta})`,
    `tras desmarcar 1 la tinta cayó (${base?.tinta} → ${solo0?.tinta}): se apagó — BUG`
  );

  // Desmarcar el objeto 0: nada seleccionado.
  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(2200);
  const nada = await medirFrontal(page);
  await estadoFx(page, 'tras desmarcar todo');
  R.check(
    !!nada && !!base && nada.tinta > base.tinta * 0.9,
    `sin nada seleccionado, el fuego sigue visible (${base?.tinta} → ${nada?.tinta})`,
    `sin selección la tinta cayó (${base?.tinta} → ${nada?.tinta}): se apagó — BUG`
  );
} finally {
  await R.resumen({ browser, errores });
}