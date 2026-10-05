/**
 * DIAG TIMELINE INTERACCIÓN — Editor de movimiento:
 * 1. Arrastrar un rombo de fotograma (transformada) con el ratón → su
 *    `time` cambia de verdad en la pista.
 * 2. Scrub de la línea de tiempo PINCHANDO EN LAS FILAS (no solo la
 *    regla): el tiempo del playhead cambia.
 * 3. Pista de efecto (fuego): al reproducir, el sistema de partículas
 *    aparece en el visor (tinta frontal crece respecto a la base).
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  numObjetos,
  crearResultados,
  medirFrontal,
} from './comun.mjs';

const R = crearResultados('DIAG TIMELINE INTERACCIÓN · rombos, scrub filas y efectos');

/** Vuelca pistas de transformada (id + tiempos de kf) vía React fiber. */
async function kfsDeTransformada(page) {
  return page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (const cont of conts) {
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      const mejor = [];
      const visit = (fib, prof) => {
        if (!fib || prof > 60) return;
        const p = fib.memoizedProps;
        if (p && Array.isArray(p.transformTracks)) {
          const copia = p.transformTracks.map((tr) => {
            const kfs = (tr.keyframes ?? []).map((k) => {
              const t = k.time + Math.random() * 1e-9; // key React único
              return { key: t, real: k.time, values: k.values ?? null };
            });
            kfs.sort?.(() => {});
            return { id: tr.id, objectId: tr.objectId, keyframes: kfs };
          });
          if (copia.length > mejor.length) mejor.push(...copia);
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
      if (mejor.length > 0) return mejor;
    }
    return [];
  });
}

const { browser, page, errores } = await abrirEditor();

try {
  // Escena base: un objeto «HOLA».
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);
  R.check((await numObjetos(page)) >= 1, 'objeto creado', 'no se creó el objeto — BUG');

  const tintaBase = (await medirFrontal(page))?.tinta ?? 0;

  // Editor de movimiento + pista de transformada (crear kf en t=0).
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(600);
  await page.click('[data-testid="open-motion-editor"]');
  await esperar(1500);

  await page.getByText('Añadir pista de transformación', { exact: true }).first().click();
  await esperar(1200);
  let pistas = await kfsDeTransformada(page);
  R.check(pistas.length === 1 && pistas[0].keyframes.length === 1,
    'pista de transformada creada (1 kf @0)', 'no hay pista con kf — BUG');

  // Playhead a 2 s pinchando la regla (80 px/s → 160 px).
  const regla = page.locator('[data-testid=motion-timeline-area]').first();
  const rbox = await regla.boundingBox();
  if (!rbox) {
    R.error('no se encontró la regla de tiempo');
  } else {
    await page.mouse.click(rbox.x + 160, rbox.y + rbox.height / 2);
    await esperar(500);
  }

  // Seleccionar el kf @0 (muestra el inspector) y añadir fotograma a 2 s.
  await page
    .locator('[data-testid="motion-editor"] button[title="00:00.00s"]')
    .first()
    .click();
  await esperar(500);
  await page.mouse.click(rbox.x + 160, rbox.y + rbox.height / 2);
  await esperar(400);
  await page.getByText('Añadir fotograma', { exact: true }).first().click();
  await esperar(900);
  pistas = await kfsDeTransformada(page);
  const kf2 = pistas[0].keyframes.find((k) => Math.abs(k.real - 2) < 0.3);
  R.check(!!kf2, 'fotograma a 2 s creado', `no hay kf a 2 s (tiempos ${JSON.stringify(pistas[0].keyframes.map((k) => k.real))}) — BUG`);

  // ------------------------------------------------------------ 1. rombos
  if (kf2) {
    // Pinchar el kf @2 y arrastrar el playhead otra vez a 2 s (el click
    // del rombo lo salta al pinchado tras él).
    await page.mouse.click(rbox.x + 160, rbox.y + rbox.height / 2);
    await esperar(300);
    const rombo = page.locator(
      `[data-testid="motion-editor"] button[title="00:02.00s"]`
    ).first();
    const caja = await rombo.boundingBox();
    if (!caja) {
      R.error('no se encontró el rombo a 2 s para arrastrar');
    } else {
      const cx = caja.x + caja.width / 2;
      const cy = caja.y + caja.height / 2;
      // Puntero dentro, bajar, arrastrar 80 px (1 s a 80 px/s), soltar.
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(cx + (80 * i) / 12, cy);
        await esperar(40);
      }
      await esperar(120);
      await page.mouse.up();
      await esperar(1200);
      const tras = await kfsDeTransformada(page);
      const tiempos = tras[0]?.keyframes?.map((k) => k.real) ?? [];
      const movio = tiempos.some((t) => Math.abs(t - 2) > 0.15);
      R.check(
        movio,
        `rombo arrastrado a ${JSON.stringify(tiempos)}`,
        `el rombo VOLVIÓ al sitio (tiempos ${JSON.stringify(tiempos)}) — BUG`
      );
    }
  }

  // ------------------------------------------------- 2. scrub en las filas
  const timeDisplay = () =>
    page.evaluate(
      () =>
        document.querySelector('[data-testid="motion-time-display"]')?.textContent ??
        ''
    );
  const antesFila = await timeDisplay();
  const filas = page.locator(
    '[data-testid="motion-editor"] div[class*="relative"][class*="flex-1"][class*="h-full"]'
  );
  const nFilas = await filas.count();
  if (nFilas === 0) {
    R.error('no se encontraron filas de la timeline');
  } else {
    const fbox = await filas.nth(0).boundingBox();
    if (!fbox || fbox.x === 0) R.error('fila sin boundingBox');
    else {
      const fx = fbox.x + Math.min(fbox.width * 0.6, 500);
      const fy = fbox.y + fbox.height / 2;
      await page.mouse.move(fx, fy);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(fx + (200 * i) / 8, fy);
        await esperar(35);
      }
      await page.mouse.up();
      await esperar(500);
      const despuesFila = await timeDisplay();
      R.check(
        despuesFila !== antesFila,
        `scrub en fila funciona (${antesFila} → ${despuesFila})`,
        `scrub pinchando la FILA NO mueve el playhead (${antesFila} → ${despuesFila}) — BUG (solo la regla responde)`
      );
    }
  }

  // ------------------------------------------------------ 3. pista de FX
  // Playhead al inicio y crear pista de fuego.
  const regla2 = page.locator('[data-testid=motion-timeline-area]').first();
  const rbox2 = (await regla2.boundingBox()) ?? rbox;
  if (rbox2) {
    await page.mouse.click(rbox2.x + 10, rbox2.y + rbox2.height / 2);
    await esperar(400);
  }

  const selFuego = page.locator('select', { has: page.locator('option[value="fire"]') });
  await selFuego.first().selectOption('fire');
  await esperar(500);
  await page.getByText('Añadir pista de efecto', { exact: true }).first().click();
  await esperar(1200);

  // Play y medir tinta frontal con la pista activa (fuego = partículas).
  await page.click('[data-testid="motion-play-btn"]');
  await esperar(2500);
  const tintaFuego = (await medirFrontal(page))?.tinta ?? 0;
  await page.click('[data-testid="motion-play-btn"]').catch(() => {});
  await esperar(700);
  R.check(
    tintaFuego > tintaBase + 30,
    `fuego visible al reproducir (tinta base ${tintaBase} → ${tintaFuego})`,
    `la pista de fuego NO inflama el visor (tinta base ${tintaBase} → ${tintaFuego}) — BUG`
  );
} finally {
  await R.resumen({ browser, errores });
}