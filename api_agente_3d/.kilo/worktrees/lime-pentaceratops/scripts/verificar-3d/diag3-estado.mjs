/**
 * DIAG3 — Inspección del estado React en vivo (vía fiber) durante el
 * flujo del usuario: crear texto en Texto → cambiar a Escena.
 * Vuelca, por cada objeto de escena: tiene instantánea (verts), si trae
 * textura, uvs, y cuántos faceColors reales tiene, además de frozen.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG3 · estado React: instantáneas y colores');

/** Vuelca los objetos de escena leyendo el fiber de React del visor. */
async function volcarObjetos(page, etiqueta) {
  const volcado = await page.evaluate(() => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
    if (!cont) return 'SIN VISOR';
    const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
    if (!llave) return 'SIN FIBER';
    const hallados = [];
    const visit = (fib, prof) => {
      if (!fib || prof > 60 || hallados.length) return;
      const p = fib.memoizedProps;
      if (p && Array.isArray(p.sceneObjects) && p.sceneObjects.length > 0) {
        hallados.push(
          ...p.sceneObjects.map((o) => {
            const m = o.mesh || {};
            const fc = m.faceColors || [];
            const reales = fc.filter((c) => c && c !== '#ffffff').length;
            return JSON.stringify({
              name: o.name,
              frozen: !!o.frozen,
              owner: o.id === p.configObjectId,
              verts: (m.vertices || []).length,
              faces: (m.faces || []).length,
              faceColors: fc.length,
              reales,
              textura: !!m.texture,
              texturaLen: m.texture ? String(m.texture).length : 0,
              uvs: (m.uvs || []).length,
              opacities: (m.faceOpacities || []).length,
            });
          })
        );
        return;
      }
      visit(fib.child, prof + 1);
      for (const h of fib.siblings || []) visit(h, prof + 1);
      if (!hallados.length) visit(fib.sibling, prof + 1);
    };
    // Recorrer hacia ARRIBA y, en cada nivel, hacia abajo.
    let fib = cont[llave];
    for (let f = fib; f && !hallados.length; f = f.return) {
      visit(f, 0);
      // hijos del props: buscar en el subárbol de este fiber
      const buscar = (nodo, prof) => {
        if (!nodo || prof > 12 || hallados.length) return;
        const p = nodo.memoizedProps;
        if (p && Array.isArray(p.sceneObjects) && p.sceneObjects.length > 0) {
          hallados.push(
            ...p.sceneObjects.map((o) => {
              const m = o.mesh || {};
              const fc = m.faceColors || [];
              const reales = fc.filter((c) => c && c !== '#ffffff').length;
              return JSON.stringify({
                name: o.name,
                frozen: !!o.frozen,
                owner: o.id === p.configObjectId,
                verts: (m.vertices || []).length,
                faces: (m.faces || []).length,
                faceColors: fc.length,
                reales,
                textura: !!m.texture,
                texturaLen: m.texture ? String(m.texture).length : 0,
                uvs: (m.uvs || []).length,
                opacities: (m.faceOpacities || []).length,
              });
            })
          );
          return;
        }
        buscar(nodo.child, prof + 1);
        buscar(nodo.sibling, prof + 1);
      };
      buscar(f, 0);
    }
    return hallados.length ? hallados.join(' | ') : 'NO ENCONTRADO';
  });
  console.log('  · ' + etiqueta + ': ' + volcado);
  return volcado;
}

/** Vuelca el mesh vivo del panel (prop `mesh` de Viewer3D) por fiber. */
async function volcarMeshVivo(page, etiqueta) {
  const volcado = await page.evaluate(() => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
    if (!cont) return 'SIN VISOR';
    const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
    if (!llave) return 'SIN FIBER';
    const dumpMesh = (m) => {
      if (!m) return 'sin mesh';
      const fc = m.faceColors || [];
      return JSON.stringify({
        verts: (m.vertices || []).length,
        faces: (m.faces || []).length,
        faceColors: fc.length,
        reales: fc.filter((c) => c && c !== '#ffffff').length,
        textura: !!m.texture,
        texturaLen: m.texture ? String(m.texture).length : 0,
        uvs: (m.uvs || []).length,
        llaves: Object.keys(m).join(','),
      });
    };
    const halla = (fib, prof) => {
      if (!fib || prof > 40) return null;
      const p = fib.memoizedProps;
      if (p && p.mesh && p.mesh.faces && p.mesh.faces.length > 0) {
        return dumpMesh(p.mesh);
      }
      return halla(fib.child, prof + 1) || halla(fib.sibling, prof + 1);
    };
    const r = halla(cont[llave], 0);
    return r || 'NO ENCONTRADO';
  });
  console.log('  · [mesh vivo] ' + etiqueta + ': ' + volcado);
  return volcado;
}

const { browser, page, errores } = await abrirEditor();

try {
  // 1. Texto: escribir y esperar la fuente de color.
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await volcarMeshVivo(page, 'en Texto (tras escribir)');

  // 2. Cambiar a Escena.
  await clicTab(page, 'scene');
  await esperar(1500);
  await volcarMeshVivo(page, 'en Escena (mesh vivo)');

  // 3. Volver a Texto y volver a volcar el mesh vivo.
  await clicTab(page, 'text');
  await esperar(2500);
  await volcarMeshVivo(page, 'en Texto (re-adueñado)');
} finally {
  await R.resumen({ browser, errores });
}