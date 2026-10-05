/**
 * DIAG4 — Volcado de props de la cadena de fibers del visor: qué props
 * llaman mesh/sceneObjects y qué traen (¿la malla viva lleva textura?).
 */
import { abrirEditor, esperar } from './comun.mjs';

const { browser, page, errores } = await abrirEditor();

try {
  // 1. Texto: escribir y esperar la fuente de color.
  await page.click('[data-testid="tab-text"]');
  await page.fill('[data-testid="text-input"]', 'HOLA');
  await new Promise((r) => setTimeout(r, 2500));

  const dump = async (etiqueta) => {
    const filas = await page.evaluate(() => {
      const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
      if (!cont) return ['SIN VISOR'];
      const key = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!key) return ['SIN FIBER'];
      const filas = [];
      for (let f = cont[key]; f && filas.length < 14; f = f.return) {
        const pr = f.memoizedProps;
        if (!pr || typeof pr !== 'object') continue;
        const ks = Object.keys(pr).filter(
          (k) => k === 'mesh' || k === 'sceneObjects' || /mesh/i.test(k)
        );
        if (!ks.length) continue;
        filas.push(
          ks
            .map((k) => {
              const v = pr[k];
              let d = typeof v;
              if (v && v.faces) {
                d = 'mesh(faces=' + v.faces.length + ',textura=' + !!v.texture + ')';
                if (v.faceColors) d += ',colores=' + v.faceColors.length;
              }
              if (Array.isArray(v)) d = 'arr(' + v.length + ')';
              return k + '=' + d;
            })
            .join(', ')
        );
      }
      return filas;
    });
    console.log('  · ' + etiqueta + ':');
    for (const f of filas) console.log('    ' + f);
  };

  await dump('en Texto tras escribir');
  await page.click('[data-testid="tab-scene"]');
  await new Promise((r) => setTimeout(r, 1200));
  await dump('en Escena');
} finally {
  await browser.close();
}