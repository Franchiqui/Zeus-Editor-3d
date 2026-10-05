/**
 * DIAG FX PISTAS — Editor de movimiento con pistas de efecto por objeto:
 * 1. Pista de Fuego del objeto → etiqueta «Fuego — Objeto N».
 * 2. Editar duración y bucle sobre la pista de efecto → los cambios SÍ
 *    se aplican (antes eran un no-op que iba a updatePluginTrack).
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  numObjetos,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG FX PISTAS · duración/bucle y etiqueta de pistas de efecto');

/** Vuelca las pistas de efecto (sin duplicados por id) vía React fiber. */
async function pistasDe(page, etiqueta) {
  const out = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (const cont of conts) {
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      const vistos = new Map();
      const visit = (fib, prof) => {
        if (!fib || prof > 60) return;
        const p = fib.memoizedProps;
        if (p && Array.isArray(p.effectTracks)) {
          for (const tr of p.effectTracks) {
            vistos.set(tr.id, {
              id: tr.id,
              effectType: tr.effectType,
              objectId: tr.objectId ?? null,
              duration: tr.duration,
              looping: tr.looping,
            });
          }
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
      if (vistos.size > 0) return [...vistos.values()];
    }
    return [];
  });
  console.log('  · [' + etiqueta + '] ' + JSON.stringify(out));
  return out;
}

const { browser, page, errores } = await abrirEditor();

try {
  // 1. Un objeto y su editor de movimiento.
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);
  R.check((await numObjetos(page)) >= 1, 'objeto creado', 'no se creó el objeto — BUG');
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(600);
  await page.click('[data-testid="open-motion-editor"]');
  await esperar(1500);

  // 2. Pista de fuego.
  const selFuego = page.locator('select', { has: page.locator('option[value="fire"]') });
  await selFuego.first().selectOption('fire');
  await esperar(500);
  await page.getByText('Añadir pista de efecto', { exact: true }).first().click();
  await esperar(1200);
  let pistas = await pistasDe(page, 'tras añadir');
  const pista = pistas.find((t) => t.effectType === 'fire');
  R.check(!!pista, 'pista de fuego creada', 'no hay pista de fuego — BUG');

  // 3. Duración: input junto a la etiqueta «Duración (s)».
  const durInput = page.locator(
    'input[type="number"]',
    { has: page.locator(':scope') }
  );
  // Más directo: el input numérico cuyo valor actual es 5 (duración de la pista).
  const inputs = await page.locator('label:has-text("Duración (s)") + input[type="number"]').count();
  if (inputs === 0) {
    R.error('no se encontró el input de duración');
  } else {
    await page.locator('label:has-text("Duración (s)") + input[type="number"]').first().fill('7');
    await esperar(1000);
    pistas = await pistasDe(page, 'tras duración 7');
    const p7 = pistas.find((t) => t.effectType === 'fire');
    R.check(
      p7 && p7.duration === 7,
      'la duración de la pista de efecto SÍ se aplica (7 s)',
      'la duración quedó en ' + (p7 ? p7.duration : '?') + ' (no-op) — BUG'
    );

    // 4. Bucle.
    await page.locator('label:has-text("Bucle") input').first().check();
    await esperar(1000);
    pistas = await pistasDe(page, 'tras bucle');
    const pl = pistas.find((t) => t.effectType === 'fire');
    R.check(
      pl && pl.looping === true,
      'el bucle de la pista de efecto SÍ se activa',
      'el bucle quedó en ' + (pl ? String(pl.looping) : '?') + ' (no-op) — BUG'
    );
  }

  // 5. Etiqueta «Fuego — <objeto>» en el listado de pistas.
  const texto = await page.evaluate(() => document.body.innerText);
  const conRaya = texto.match(/Fuego — [^\n]+/);
  R.check(
    !!conRaya,
    'la pista muestra su objeto: ' + (conRaya ? conRaya[0] : '(nada)'),
    'la etiqueta de la pista no nombra al objeto — BUG'
  );
} finally {
  await R.resumen({ browser, errores });
}