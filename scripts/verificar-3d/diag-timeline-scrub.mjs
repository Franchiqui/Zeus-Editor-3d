/**
 * DIAG TIMELINE SCRUB — gestos «reales» del usuario sobre la barra de
 * tiempo del editor de movimiento:
 *  1. Clic en la regla de arriba.
 *  2. Presionar y ARRASTRAR por la regla (el tiempo debe seguir al ratón).
 *  3. Arrancar desde el rombo del playhead (agarrar la barra roja).
 *  4. Arrastrar en una fila vacía (sin rombos).
 *  5. Zoom máximo (timeline ancha + desplazamiento horizontal): el tiempo
 *     del clic debe cuadrar con la coordenada de contenido, sin desfase.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG TIMELINE SCRUB · gestos del ratón');

const { browser, page, errores } = await abrirEditor();

const mostrar = () =>
  page.evaluate(
    () =>
      document.querySelector('[data-testid="motion-time-display"]')?.textContent ??
      '(sin display)'
  );
// Tiempo del playhead según DOM (data-testid) — más fiable que el texto.
const playheadLeft = () =>
  page.evaluate(
    () =>
      document
        .querySelector('[data-testid="motion-playhead"]')
        ?.style?.left ?? '(sin playhead)'
  );

try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);

  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(600);
  await page.click('[data-testid="open-motion-editor"]');
  await esperar(1500);

  // Pista de transformada para tener filas.
  await page.getByText('Añadir pista de transformación', { exact: true }).first().click();
  await esperar(1200);

  const zona = page.locator('[data-testid=motion-timeline-area]').first();
  const zbox = await zona.boundingBox();
  if (!zbox) throw new Error('no se encontró la zona de tiempo');
  const yRegla = zbox.y + 14; // franja superior (regla)
  const yFila = zbox.y + zbox.height - 20; // fila de abajo

  // ---------------------------------------------- 1. clic en la regla
  await page.mouse.click(zbox.x + 320, yRegla);
  await esperar(350);
  let t = await playheadLeft();
  R.check(t === '320px', `clic en la regla mueve el playhead (left=${t})`, `clic en la regla NO mueve el playhead (left=${t}) — BUG`);

  // ---------------------------------------- 2. arrastrar en la regla
  const pasos = [];
  await page.mouse.move(zbox.x + 80, yRegla);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(zbox.x + 80 + i * 30, yRegla);
    await esperar(35);
    if (i === 4 || i === 8) pasos.push(await mostrar());
  }
  await page.mouse.up();
  await esperar(400);
  const trasSoltar = await playheadLeft();
  // Cada muestreo a mitad del arrastre debe reflejar su propia x
  // (i=4 → x=200 → 2.50 s; i=8 → x=320 → 4.00 s): ¿sigue igual al ratón?
  const sigue = pasos[0] === '00:02.50' && pasos[1] === '00:04.00';
  R.check(
    sigue && trasSoltar === '380px',
    `arrastrar en la regla sigue al ratón (muestreos ${pasos.join(' · ')}, suelto: ${trasSoltar})`,
    `arrastrar en la regla no sigue al ratón (muestreos ${pasos.join(' · ')}, suelto: ${trasSoltar}) — BUG`
  );

  // ------------------------------- 3. agarrar el rombo rojo del playhead
  // El playhead está a content 380px → viewport x = zbox.x + 380 - scroll.
  const px = await page.evaluate(() => {
    const ph = document.querySelector('[data-testid="motion-playhead"]');
    const r = ph.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  await page.mouse.move(px.x, px.y + 12);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(px.x - i * 40, px.y + 12);
    await esperar(35);
  }
  await page.mouse.up();
  await esperar(400);
  const trasAgarrar = await playheadLeft();
  R.check(
    trasAgarrar !== '380px',
    `agarrar la barra roja la arrastra (left=${trasAgarrar})`,
    `agarrar la barra roja NO la mueve (left=${trasAgarrar}) — BUG`
  );

  // --------------------------------- 4. arrastrar en una fila (rombos no)
  const pasosFila = [];
  await page.mouse.move(zbox.x + 60, yFila);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(zbox.x + 60 + i * 40, yFila);
    await esperar(30);
    if (i === 3 || i === 6) pasosFila.push(await mostrar());
  }
  await page.mouse.up();
  await esperar(400);
  const trasFila = await playheadLeft();
  // i=3 → contenido 180px → 2.25 s; i=6 → 300px → 3.75 s. Al soltar cae
  // más allá del fin de la pista (460px > 400px de línea) → clavada al
  // final es el comportamiento correcto.
  const sigueFila = pasosFila[0] === '00:02.25' && pasosFila[1] === '00:03.75';
  R.check(
    sigueFila && trasFila === '400px',
    `arrastrar en la fila hace scrub (${pasosFila.join(' · ')}, suelto: ${trasFila})`,
    `arrastrar en la fila NO sigue al ratón (${pasosFila.join(' · ')}, suelto: ${trasFila}) — BUG`
  );

  // ---------------------------- 5. zoom alto + scroll horizontal, clic
  // El zoom alarga la línea: el contenedor se desplaza y timeFromEvent
  // debe cuadrar SIN contarlo doble.
  const slider = page.locator('[data-testid="motion-zoom-slider"] [role="slider"]').first();
  await slider.focus();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('ArrowRight');
    await esperar(30);
  }
  await esperar(500);
  await page.evaluate(() => {
    // Elegir el contenedor deslizable que contenga el playhead.
    const ph = document.querySelector('[data-testid="motion-playhead"]');
    for (const cont of document.querySelectorAll('.custom-scrollbar')) {
      if (cont.contains(ph)) {
        cont.scrollLeft = 150;
        break;
      }
    }
  });
  await esperar(400);
  const scrollReal = await page.evaluate(() => {
    const ph = document.querySelector('[data-testid="motion-playhead"]');
    for (const cont of document.querySelectorAll('.custom-scrollbar')) {
      if (cont.contains(ph)) return cont.scrollLeft;
    }
    return -1;
  });
  // Clic a media pantalla de la zona visible y comparar con la coordenada
  // de contenido calculada desde el DOM (referencia correcta: el rect del
  // playhead debe quedar en (clientX - rect.x), sea cual sea el scroll).
  await page.mouse.click(zbox.x + 300, yRegla);
  await esperar(400);
  const despuesScroll = await playheadLeft();
  const esperadoContenido = await page.evaluate((clientX) => {
    const zona = document.querySelector('[data-testid="motion-timeline-area"]');
    return clientX - zona.getBoundingClientRect().x;
  }, zbox.x + 300);
  const desfase = Math.abs(parseFloat(despuesScroll) - esperadoContenido) <= 40;
  R.check(
    scrollReal >= 100 && desfase,
    `con scroll horizontal (${Math.round(scrollReal)}px) el clic cae donde se pincha (left=${despuesScroll}, contenido esperado ${esperadoContenido.toFixed(0)}px)`,
    `con scroll horizontal (${Math.round(scrollReal)}px) el clic está DESFASADO (left=${despuesScroll}, contenido esperado ${esperadoContenido.toFixed(0)}px) — BUG`
  );
} finally {
  await R.resumen({ browser, errores });
}