/**
 * DIAG CONGELADOS — un objeto congelado NO se puede seleccionar (ni con
 * clic en el visor, ni por rectángulo) y el gizmo no aparece aunque la
 * lista de la escena lo deje seleccionado. Al descongelar, todo vuelve.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  numObjetos,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG CONGELADOS · no seleccionable, sin gizmo');

const { browser, page, errores } = await abrirEditor();

/**
 * Recorre los hooks del espectador: vuelca `objects` (congelado?), el
 * `selectedObjectId`, y el grupo del manipulador (children con userData.mode)
 * con su `visible`.
 */
const estado = () =>
  page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (const cont of conts) {
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      const out = {
        gizmoVisible: null,
        gizmoHallado: false,
        selId: null,
        objetos: [],
        nVertices: null,
      };
      const esSel = (p) =>
        p &&
        typeof p.selectedObjectId !== 'undefined' &&
        typeof p.onObjectSelect === 'function' &&
        Array.isArray(p.objects);
      const visit = (fib, prof) => {
        if (!fib || prof > 70) return;
        const p = fib.memoizedProps;
        if (esSel(p)) {
          out.selId = p.selectedObjectId ?? null;
          out.objetos = p.objects.map((o) => ({
            id: o.id.slice(-6),
            frozen: !!o.frozen,
          }));
          out.nVertices = (p.mesh?.vertices?.length ?? -1);
          // TANTO el gizmo principal como el del texture-helper se
          // construyen con buildGizmoHandles (hijos con «uniform-scale»).
          // El principal cuelga DIRECTO de la escena; el del helper, del
          // grupo de mallas: me quedo con el de padre-escena.
          let n = fib.memoizedState;
          for (let i = 0; i < 400 && n; i++, n = n.next) {
            const cur = n.memoizedState?.current;
            if (
              cur &&
              typeof cur === 'object' &&
              'visible' in cur &&
              Array.isArray(cur.children) &&
              cur.children.some(
                (h) =>
                  h.userData?.mode === 'uniform-scale' ||
                  h.userData?.mode === 'planar-scale'
              )
            ) {
              out.gizmoHallado = true;
              out.padreEscena = cur.parent?.isScene === true;
              if (out.padreEscena) out.gizmoVisible = !!cur.visible;
            }
          }
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
      if (out.objetos) return out;
    }
    return null;
  });

try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);
  const n = await numObjetos(page);
  R.check(n >= 1, `objeto creado (${n})`, `sin objetos (${n}) — FLUJO`);

  const congelarBtn = page.locator('[title="Congelar objeto"]').first();
  await congelarBtn.waitFor({ timeout: 15000 });

  // -------- LÍNEA BASE: el objeto recién creado está seleccionado y su
  // gizmo DEBE verse (si no, la sonda lee el grupo equivocado).
  const base = await estado();
  console.log('base:', JSON.stringify(base));
  R.check(
    base.gizmoHallado && base.gizmoVisible === true,
    `línea base: gizmo VISIBLE (sel ${base.selId}, vts ${base.nVertices})`,
    `línea base: gizmo ${base.gizmoHallado ? 'no hallado' : `OCULTO (sel ${base.selId})`} — sonda/flujo`
  );

  // Congelar el último objeto (el dueño activo de la sonda).
  await page.locator('[title="Congelar objeto"]').last().click();
  await esperar(900);

  const est1 = await estado();
  console.log('tras congelar:', JSON.stringify(est1));
  R.check(
    est1.gizmoHallado && est1.gizmoVisible === false,
    `congelado selecionado (sel ${est1.selId}): gizmo OCULTO`,
    `congelado selecionado (sel ${est1.selId}) y el gizmo SIGUE (${est1.gizmoVisible}) — BUG`
  );

  // Clic en el visor (sobre el objeto congelado al centro): NO debe
  // producir selección (el id de selection no puede ser de un congelado).
  const visor = page.locator('[data-testid="viewer-container"]').first();
  const vbox = await visor.boundingBox();
  await page.mouse.click(vbox.x + vbox.width / 2, vbox.y + vbox.height / 2);
  await esperar(500);
  const trasClic = await estado();
  R.check(
    trasClic.selId !== null,
    `clic en el visor con objeto congelado: sel = ${trasClic.selId} (sin cambiar a un congelado)`,
    'estado de selección indeterminado tras el clic — FLUJO'
  );

  // Descongelar → el gizmo vuelve (sel de la lista sigue válida).
  await page.locator('[title="Descongelar objeto"]').first().click();
  await esperar(900);
  const est2 = await estado();
  console.log('tras descongelar:', JSON.stringify(est2));
  R.check(
    est2.gizmoVisible === true,
    `descongelado: gizmo visible otra vez (sel ${est2.selId})`,
    `descongelado y el gizmo NO aparece (sel ${est2.selId}) — BUG`
  );
} finally {
  await R.resumen({ browser, errores });
}