/**
 * T1 — El texto creado en Texto no desaparece al cambiar de pestaña, y
 * abrir cualquier pestaña no cambia la escena (regla de oro 1).
 *
 * Pasos:
 *  1. El editor abre en Escena, vacío.
 *  2. Texto → escribir "HOLA" → auto-creación: el listado de Escena
 *     muestra 1 objeto y la figura es visible (tinta > base).
 *  3. Volver a Escena → la tinta se mantiene (la figura pasa a verse
 *     desde su instantánea).
 *  4. Seleccionar el texto en el listado de Escena → la tinta no cambia
 *     (clic = solo seleccionar).
 *  5. Entrar manualmente a Texto → re-adueñación: el campo contiene
 *     "HOLA" y la tinta sigue idéntica.
 *  6. Volver a Escena → intacto.
 *
 * Nota: la fuente Textura (de color) carga en asíncrono y cambia el
 * render del texto ~2 s después de escribirlo: tras escribir se espera
 * a que se asiente antes de medir nada.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  medirFrontal,
  numObjetos,
  tabActiva,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('T1 · el texto sobrevive a las pestañas');

const { browser, page, errores } = await abrirEditor();

try {
  R.check(await tabActiva(page, 'scene'), 'el editor abre en la pestaña Escena', 'el editor NO abre en la pestaña Escena');
  R.check((await numObjetos(page)) === 0, 'la escena abre vacía (sin objetos fantasma)', 'la escena abre con objetos inesperados');

  const base = await medirFrontal(page);
  R.check(base && base.tinta >= 0, `tinta base (escena vacía): ${base?.tinta}`, 'no se pudo medir el visor frontal');

  // 2. Crear el texto escribiendo (auto-creación, sin "Nuevo objeto").
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  // Dejar que la fuente de color se cargue y el render se asiente.
  await esperar(2200);

  const tintaTexto = await medirFrontal(page);
  const dTexto = tintaTexto.tinta - base.tinta;
  R.check(dTexto > 300, `la figura del texto es visible en Texto (tinta Δ=${dTexto})`, `la figura del texto NO se ve en Texto (tinta Δ=${dTexto})`);

  // 3. Volver a Escena: 1 objeto y la figura sigue ahí (instantánea).
  await clicTab(page, 'scene');
  const n1 = await numObjetos(page);
  R.check(n1 === 1, 'auto-creación: el listado de Escena muestra 1 objeto (el texto creado)', `se esperaba 1 objeto en el listado de Escena, hay ${n1}`);
  const tintaEscena = await medirFrontal(page);
  const dEscena = tintaEscena.tinta - base.tinta;
  R.check(
    dEscena > 300 && Math.abs(dEscena - dTexto) <= Math.max(150, dTexto * 0.35),
    `la figura NO desaparece al volver a Escena (Δ texto=${dTexto}, Δ escena=${dEscena})`,
    `la figura cambió/desapareció al volver a Escena (Δ texto=${dTexto}, Δ escena=${dEscena})`
  );

  // 4. Seleccionar el objeto en el listado de Escena: solo seleccionar.
  await page.click('[data-testid="scene-object-0"]');
  await esperar(700);
  const tintaSel = await medirFrontal(page);
  const dSel = tintaSel.tinta - base.tinta;
  R.check(
    Math.abs(dSel - dEscena) <= Math.max(150, dEscena * 0.35),
    'clic en el objeto desde Escena no cambia la figura',
    `clic en el objeto desde Escena cambió la figura (Δ ${dEscena} → ${dSel})`
  );
  R.check(await tabActiva(page, 'scene'), 'clic en el objeto desde Escena NO salta de pestaña', 'clic en el objeto saltó de pestaña');

  // 5. Entrar manualmente a Texto: re-adueñación, el campo recupera HOLA.
  await clicTab(page, 'text');
  const valor = await page.inputValue('[data-testid="text-input"]');
  R.check(valor === 'HOLA', `re-adueñación: el campo de texto contiene "HOLA"`, `re-adueñación fallida: el campo contiene "${valor}"`);
  const tintaRe = await medirFrontal(page);
  const dRe = tintaRe.tinta - base.tinta;
  R.check(
    dRe > 300 && Math.abs(dRe - dEscena) <= Math.max(150, dEscena * 0.35),
    'la figura en su pestaña es la misma que se veía desde Escena',
    `la figura cambió al re-adueñar (Δ escena=${dEscena}, Δ texto=${dRe})`
  );

  // 6. Volver a Escena: intacto.
  await clicTab(page, 'scene');
  const tintaFin = await medirFrontal(page);
  const dFin = tintaFin.tinta - base.tinta;
  R.check(
    Math.abs(dFin - dEscena) <= Math.max(150, dEscena * 0.35),
    `tras todo el recorrido la figura sigue intacta (Δ=${dFin})`,
    `al final del recorrido la figura cambió (Δ ${dEscena} → ${dFin})`
  );
} catch (e) {
  R.error(`excepción: ${e.message}`);
}

await R.resumen({ browser, errores });