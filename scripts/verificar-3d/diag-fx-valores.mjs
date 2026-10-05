/**
 * DIAG FX VALORES — vuelca los `values` de los kf de la pista de efecto y
 * mide la tinta del visor en la ventana OFF con doble muestra: si el fuego
 * sigue emitiendo, la tinta CRECE entre muestras; si solo se ve la guía
 * circular del foco (marcador de edición), la tinta queda constante y muy
 * por debajo del nivel ON.
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

const R = crearResultados('DIAG FX VALORES · values de la pista y tinta OFF/ON');

const { browser, page, errores } = await abrirEditor();

const vueloFx = () =>
  page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    for (const cont of conts) {
      const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
      if (!llave) continue;
      const mejor = [];
      const visit = (fib, prof) => {
        if (!fib || prof > 60) return;
        const p = fib.memoizedProps;
        if (p && Array.isArray(p.effectTracks) && p.effectTracks.length > mejor.length) {
          mejor.push(
            ...p.effectTracks.map((tr) => ({
              effectType: tr.effectType,
              objectId: tr.objectId ?? null,
              keyframes: tr.keyframes.map((k) => ({
                time: k.time,
                values: k.values ?? {},
              })),
            }))
          );
        }
        visit(fib.child, prof + 1);
        visit(fib.sibling, prof + 1);
      };
      // Subir por los ancestros: los props con effectTracks viven en el
      // componente dueño del contenedor, no en el propio div.
      for (let f = cont[llave]; f; f = f.return) visit(f, 0);
      if (mejor.length > 0) return mejor;
    }
    return [];
  });

const tinta = () => medirFrontal(page);

try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);
  R.check((await numObjetos(page)) >= 1, 'objeto creado', 'no se creó el objeto — BUG');

  const tintaBase = (await tinta())?.tinta ?? 0;
  console.log('tinta base (sin FX):', tintaBase);

  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(600);
  await page.click('[data-testid="open-motion-editor"]');
  await esperar(1500);

  const selFuego = page.locator('select', { has: page.locator('option[value="fire"]') });
  await selFuego.first().selectOption('fire');
  await esperar(500);
  await page.getByText('Añadir pista de efecto', { exact: true }).first().click();
  await esperar(1200);

  const regla = page.locator('[data-testid=motion-timeline-area]').first();
  const rbox = await regla.boundingBox();
  const irA = async (segundos) => {
    await page.mouse.click(rbox.x + Math.round(segundos * 80) + 1, rbox.y + rbox.height / 2);
    await esperar(400);
  };

  // kf @1 → OFF; kf @3 → ON (el kf @0 de la pista ya es ON).
  await irA(1);
  await page.getByText('Añadir fotograma', { exact: true }).first().click();
  await esperar(700);
  await page.locator('label:has-text("Activo") input').first().uncheck();
  await esperar(700);
  await irA(3);
  await page.getByText('Añadir fotograma', { exact: true }).first().click();
  await esperar(700);
  await page.locator('label:has-text("Activo") input').first().check();
  await esperar(700);

  const pistas = await vueloFx();
  console.log('pistas:', JSON.stringify(pistas));
  const kfOff = pistas[0]?.keyframes?.find((k) => k.values?.enabled === false);
  R.check(
    !!kfOff && Math.abs(kfOff.time - 1) < 0.3,
    `la pista tiene el kf OFF a ~1 s (${JSON.stringify(pistas[0]?.keyframes?.map((k) => [k.time, k.values?.enabled]))})`,
    'no se encontró el kf OFF a ~1 s — BUG'
  );

  // ON de referencia a 0.5 s.
  await irA(0.5);
  await esperar(2400);
  const on05 = (await tinta())?.tinta ?? 0;
  console.log('ON@0.5:', on05);

  // OFF a 2 s con DOBLE muestra: emisión viva → la tinta crece.
  await irA(2);
  await esperar(2400);
  const off1 = (await tinta())?.tinta ?? 0;
  await esperar(2600);
  const off2 = (await tinta())?.tinta ?? 0;
  console.log(`OFF@2.0: muestra1 ${off1} · muestra2 ${off2} (base ${tintaBase})`);
  const estable = Math.abs(off2 - off1) <= 25;
  R.check(
    estable,
    `OFF estable (no emite): ${off1} → ${off2}`,
    `la tinta CRECE en OFF (${off1} → ${off2}): sigue emitiendo — BUG`
  );

  // ON a 3.1 s: el fuego vuelve.
  await irA(3.1);
  await esperar(2400);
  const on31 = (await tinta())?.tinta ?? 0;
  console.log(`ON@3.1: ${on31}`);
  R.check(
    on31 > off2 + 30,
    `el fuego vuelve a ON (OFF ${off2} → ON ${on31})`,
    `ON@3.1 no supera a OFF@2 (${off2} → ${on31}) — BUG`
  );

  // Lectura del caso: la guía circular del foco aparece en OFF. El nivel
  // OFF debe quedar claramente por debajo del nivel ON (solo guía + sin
  // partículas) y por encima de la base (la guía suma tinta a las 2 s).
  console.log(
    `RESUMEN: base ${tintaBase} · ON@0.5 ${on05} · OFF@2.0 ${off1}/${off2} · ON@3.1 ${on31}`
  );
} finally {
  await R.resumen({ browser, errores });
}