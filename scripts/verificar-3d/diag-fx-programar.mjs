/**
 * DIAG FX PROGRAMAR — programar (agenda temporal) de una pista de efecto:
 * fuego ON @0 → OFF @1 → ON @3. Mide la tinta del visor frontal en parado
 * (el override se aplica al hacer scrub, no solo al reproducir).
 * Comprueba también: ¿el scrub mueve el playhead desde las FILAS?, y ¿se
 * puede añadir un fotograma SIN seleccionar uno antes?
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

const R = crearResultados('DIAG FX PROGRAMAR · agenda ON/OFF de fuego');

const { browser, page, errores } = await abrirEditor();

try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);
  R.check((await numObjetos(page)) >= 1, 'objeto creado', 'no se creó el objeto — BUG');

  const tintaBase = (await medirFrontal(page))?.tinta ?? 0;

  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(600);
  await page.click('[data-testid="open-motion-editor"]');
  await esperar(1500);

  const selFuego = page.locator('select', { has: page.locator('option[value="fire"]') });
  await selFuego.first().selectOption('fire');
  await esperar(500);
  await page.getByText('Añadir pista de efecto', { exact: true }).first().click();
  await esperar(1200);

  // La pista queda seleccionada sin kf elegido: ¿existe «Añadir
  // fotograma» sin picar un rombo antes?
  const botonAdd = page.getByText('+ Fotograma', { exact: true }).or(page.getByText('Añadir fotograma', { exact: true }));
  const hayAdd = (await botonAdd.count()) > 0;
  R.check(
    hayAdd,
    '«Añadir fotograma» disponible con la pista seleccionada y sin kf elegido',
    'no se puede añadir un fotograma sin picar un rombo previo — FLUJO IMPOSIBLE'
  );

  const regla = page.locator('[data-testid=motion-timeline-area]').first();
  const rbox = (await regla.boundingBox()) ?? null;
  const irA = async (segundos) => {
    if (!rbox) return;
    await page.mouse.click(rbox.x + Math.round(segundos * 80) + 1, rbox.y + rbox.height / 2);
    await esperar(400);
  };

  // kf @1 → apagar; kf @3 → encender (el kf @0 de la pista ya está ON).
  await irA(1);
  await page.getByText('Añadir fotograma', { exact: true }).first().click();
  await esperar(700);
  await page.locator('label:has-text("Activo") input').first().uncheck();
  await esperar(700);
  await irA(3);
  await page.getByText('Añadir fotograma', { exact: true }).first().click();
  await esperar(700);
  // El kf @3 hereda Activo=false: encendemos.
  await page.locator('label:has-text("Activo") input').first().check();
  await esperar(700);

  // En OFF el visor muestra la guía circular del foco (marcador de
  // edición), así que la tinta NO vuelve a la base: la prueba correcta es
  // que se estabilice (sin emisión viva la tinta no crece) y quede muy
  // por debajo del nivel ON.
  const tintaEn = async (t, espera = 2400) => {
    await irA(t);
    await esperar(espera);
    return (await medirFrontal(page))?.tinta ?? 0;
  };

  const on05 = await tintaEn(0.5);
  await irA(2.0);
  await esperar(2400);
  const off1 = (await medirFrontal(page))?.tinta ?? 0;
  await esperar(2600);
  const off2 = (await medirFrontal(page))?.tinta ?? 0;
  const on31 = await tintaEn(3.1);
  R.check(on05 > tintaBase + 30, `fuego ON en 0.5 s (base ${tintaBase} → ${on05})`, `debería estar ON en 0.5 s (base ${tintaBase} → ${on05}) — BUG`);
  R.check(Math.abs(off2 - off1) <= 25, `fuego OFF en 2.0 s sin emisión viva (${off1} → ${off2} tras 2.6 s)`, `en OFF@2.0 la tinta CRECE (${off1} → ${off2}): sigue emitiendo — BUG`);
  R.check(on31 > off2 + 30, `fuego vuelve a ON en 3.1 s (OFF ${off2} → ON ${on31})`, `debería volver a ON en 3.1 s (OFF ${off2} → ON ${on31}) — BUG`);

  // Scrub pinchando la FILA (no la regla).
  const mostrar = () =>
    page.evaluate(() => document.querySelector('[data-testid="motion-time-display"]')?.textContent ?? '');
  const antesFila = await mostrar();
  const fila = page.locator(
    '[data-testid="motion-editor"] div[class*="relative"][class*="flex-1"][class*="h-full"]'
  ).first();
  const fbox = await fila.boundingBox();
  if (!fbox) {
    R.error('fila sin boundingBox');
  } else {
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
    const despues = await mostrar();
    R.check(
      despues !== antesFila,
      `scrub en fila funciona (${antesFila} → ${despues})`,
      `pinchar la FILA no mueve el playhead (${antesFila} → ${despues}) — BUG`
    );
  }
} finally {
  await R.resumen({ browser, errores });
}