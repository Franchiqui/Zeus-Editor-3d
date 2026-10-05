/**
 * DIAG5 — Tras REABRIR un .zeus con textura de fuente de color:
 * ¿conserva el objeto cargado su mesh.texture en memoria (vía fiber)?
 * Si el archivo trae textura pero el estado vivo no, el despelleje
 * queda en la CARGA; si el estado la trae y no se pinta, es el RENDER.
 */
import { abrirEditor, esperar, crearResultados } from './comun.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(AQUI, 'fixtures', 'diag2-color.zeus');

const R = crearResultados('DIAG5 · estado del objeto tras reabrir');

const { browser, page, errores } = await abrirEditor();

try {
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-obj3d-modal"]');
  await esperar(700);
  await page.setInputFiles('[data-testid="zeus-file-input"]', ARCHIVO);
  await esperar(4500); // carga + fuente de color async

  const volcado = await page.evaluate(() => {
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
            const fc = m.faceColors || [];
            hallados.push(
              JSON.stringify({
                visor: c,
                name: o.name,
                frozen: !!o.frozen,
                owner: o.id === p.configObjectId,
                verts: (m.vertices || []).length,
                faces: (m.faces || []).length,
                faceColors: fc.length,
                reales: fc.filter((x) => x && x !== '#ffffff').length,
                textura: !!m.texture,
                texturaLen: m.texture ? String(m.texture).length : 0,
                uvs: (m.uvs || []).length,
                textureColor: m.textureColor ?? '(sin)',
              })
            );
          }
          return;
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      // Subir hacia la raíz y, en cada nivel, también descendir: los
      // props con sceneObjects pueden estar en un antecesor del visor.
      for (let f = cont[llave]; f && !hallados.length; f = f.return) {
        visit(f, 0);
      }
      if (hallados.length) return hallados.join(' | ');
    }
    return 'NO ENCONTRADO';
  });
  console.log('  · objeto cargado: ' + volcado);
} finally {
  await R.resumen({ browser, errores });
}