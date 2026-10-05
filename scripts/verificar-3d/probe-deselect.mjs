/** PROBE — estado THREE + props tras deseleccionar todo. */
import { abrirEditor, esperar, clicTab, escribirTexto, medirFrontal, numObjetos } from './comun.mjs';

const { browser, page } = await abrirEditor();
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
  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(500);
  await page.click('[data-testid="scene-object-check-1"]');
  await esperar(700);
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Llamas', { exact: true }).first().click();
  await esperar(2500);
  console.log('ambos: tinta=' + (await medirFrontal(page))?.tinta);

  const dump = async (et) => {
    const out = await page.evaluate(() => {
      const conts = document.querySelectorAll('[data-testid="viewer-container"]');
      const res = [];
      for (let c = 0; c < conts.length; c++) {
        const cont = conts[c];
        const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
        if (!llave) continue;
        // 1. Props del componente (objects, selectedObjectId, mesh).
        const visitProps = (fib, prof) => {
          if (!fib || prof > 60) return null;
          const p = fib.memoizedProps;
          if (p && Array.isArray(p.sceneObjects) && p.sceneObjects.length) {
            return {
              objetos: p.sceneObjects.map((o) => ({ id: o.id.slice(0, 6), n: (o.efectos ?? []).length })),
              sel: p.selectedObjectId ? String(p.selectedObjectId).slice(0, 6) : null,
              mallaV: p.mesh ? p.mesh.vertices.length : null,
            };
          }
          const a = visitProps(fib.child, prof + 1);
          if (a) return a;
          return visitProps(fib.sibling, prof + 1);
        };
        let props = null;
        for (let f = cont[llave]; f && !props; f = f.return) props = visitProps(f, 0);
        // 2. meshGroup: recorre TODOS los hooks buscando un ref a un Group
        //    con userData.sceneObjectId; dedup por uuid.
        const grupos = new Map();
        const visitHooks = (fib, prof) => {
          if (!fib || prof > 80) return;
          for (let s = fib.memoizedState; s; s = s.next) {
            const cur = s.memoizedState;
            const ref = cur && typeof cur === 'object' && 'current' in cur ? cur.current : null;
            if (ref && ref.isGroup && ref.userData && ref.userData.sceneObjectId) {
              if (!grupos.has(ref.uuid)) {
                const hijos = [];
                ref.children.forEach((h) => {
                  let puntos = 0;
                  h.traverse((o) => {
                    if (o.isPoints && o.visible) {
                      puntos += o.geometry?.getAttribute?.('position')?.count || 0;
                    }
                  });
                  hijos.push({
                    dup: !!h.userData?.sceneObjectDuplicate,
                    oid: h.userData?.sceneObjectId ? String(h.userData.sceneObjectId).slice(0, 10) : null,
                    esFx: !!h.userData?.esGrupoFx,
                    visible: h.visible,
                    ninos: h.children.length,
                    puntos,
                  });
                });
                grupos.set(ref.uuid, {
                  activo: String(ref.userData.sceneObjectId).slice(0, 10),
                  visibleMg: ref.visible,
                  hijos,
                });
              }
            }
          }
          visitHooks(fib.child, prof + 1);
          visitHooks(fib.sibling, prof + 1);
        };
        visitHooks(cont[llave], 0);
        if (grupos.size === 0) {
          for (let f = cont[llave].return; f; f = f.return) {
            visitHooks(f, 0);
            if (grupos.size) break;
          }
        }
        if (props || grupos.size) {
          res.push({ cont: c, props, meshGroups: [...grupos.values()] });
        }
        if (res.length >= 1 && props) break;
      }
      return res;
    });
    console.log('[' + et + '] ' + JSON.stringify(out, null, 1));
  };

  dump('con seleccion');
  await page.click('[data-testid="scene-object-check-1"]');
  await esperar(2000);
  dump('sin objeto 1');
  console.log('solo0: tinta=' + (await medirFrontal(page))?.tinta);
  await page.click('[data-testid="scene-object-check-0"]');
  await esperar(2000);
  dump('sin nada');
  console.log('nada: tinta=' + (await medirFrontal(page))?.tinta);
} finally {
  await browser.close();
}