/**
 * DIAG FUERZA DEL FOCO — ¿cuánta luz VISIBLE aporta el foco a la
 * escena en pantalla? Contexto: «el foco proyecta luz sobre los
 * objetos excluidos» — el parche del shader quedó anclado al tag
 * `#include <lights_fragment_begin>` (los reemplazos contra código
 * interno del chunk eran no-ops con los includes sin resolver) y las
 * uniformes por objeto están correctas, pero la sonda diag-luces no
 * logra VER la caída con tinta de todo el canvas (~15-30 de ~3279):
 * la tinta cuenta píxeles ≠ fondo, y el foco por defecto (intensidad
 * 2, a 5 m) apenas alumbra sobre los que ya alumbran la llave/fill.
 *
 *  1. Escena base (un objeto) → tinta y brillo Σ de tinta.
 *  2. + foco en (0,5,5) a intensidad 10 → idem (subida = su aporte).
 *  3. Intensidad 0 → idem (vuelta a la base).
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  numObjetos,
  medirFrontal,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG FUERZA DEL FOCO · aporte visible');

const { browser, page, errores } = await abrirEditor();

/** Tinta + Σ de brillo de los píxeles de tinta (la caída de luz de
 *  un encendido cambia el BRILLO de los píxeles, no su cuenta). */
const medirConBrillo = () =>
  page.evaluate(async () => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const cont = conts[0];
    const canvas = cont && cont.querySelector('canvas');
    if (!canvas) return null;
    const url = canvas.toDataURL('image/png');
    const img = new Image();
    await new Promise((res) => {
      img.onload = res;
      img.onerror = res;
      img.src = url;
    });
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    const f0 = [d[0], d[1], d[2]];
    let tinta = 0;
    let brillo = 0;
    for (let y = 0; y < off.height; y += 3) {
      for (let x = 0; x < off.width; x += 3) {
        const o = (y * off.width + x) * 4;
        const r = d[o];
        const g = d[o + 1];
        const b = d[o + 2];
        if (Math.abs(r - f0[0]) + Math.abs(g - f0[1]) + Math.abs(b - f0[2]) >= 45) {
          tinta++;
          brillo += (r + g + b) / 3;
        }
      }
    }
    return { tinta, brillo: Math.round(brillo) };
  });

try {
  // ------------------------------------------------ 1. un objeto
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);
  const n = await numObjetos(page);
  R.check(n >= 1, `objeto base creado (${n})`, `sin objeto (${n}) — FLUJO`);

  const base = await medirConBrillo();
  console.log('sin foco:', JSON.stringify(base));
  R.check(!!base && base.tinta > 500, `tinta base (${base?.tinta})`, `tinta base baja (${base?.tinta}) — FLUJO`);

  // ------------------------------------- 2. foco a intensidad 10
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.getByText(/^Luces/).first().click();
  await esperar(700);
  const dialogo = page.getByRole('dialog');
  await dialogo
    .getByRole('button', { name: 'Añadir foco' })
    .evaluate((b) => b.click());
  await esperar(500);
  const controles = dialogo.locator('[role="slider"]');
  console.log(
    'sliders:',
    await controles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-valuenow')))
  );
  // [1] Intensidad del foco → al tope (10) con la tecla Fin (Radix).
  await controles.nth(1).focus();
  await page.keyboard.press('End');
  await esperar(300);
  await dialogo
    .getByRole('button', { name: 'Guardar' })
    .evaluate((b) => b.click());
  await esperar(1200);
  const conFoco = await medirConBrillo();
  console.log('foco al tope:', JSON.stringify(conFoco));

  // ------------------------------------------- 3. foco a intensidad 0
  await page
    .locator('[data-radix-popper-content-wrapper]')
    .last()
    .isVisible()
    .catch(() => false);
  if (
    await page
      .locator('[data-radix-popper-content-wrapper]')
      .last()
      .isVisible()
      .catch(() => false)
  ) {
    await page.keyboard.press('Escape');
    await esperar(400);
  }
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.getByText(/^Luces/).first().click();
  await esperar(700);
  const dialogo2 = page.getByRole('dialog');
  const controles2 = dialogo2.locator('[role="slider"]');
  console.log(
    'sliders (2ª mano):',
    await controles2.evaluateAll((els) => els.map((e) => e.getAttribute('aria-valuenow')))
  );
  await controles2.nth(1).focus();
  await page.keyboard.press('Home');
  await esperar(300);
  await dialogo2
    .getByRole('button', { name: 'Guardar' })
    .evaluate((b) => b.click());
  await esperar(1200);
  const sinFoco = await medirConBrillo();
  console.log('foco en 0:', JSON.stringify(sinFoco));

  R.check(
    !!conFoco && !!sinFoco && conFoco.brillo - sinFoco.brillo > 100,
    `el foco aporta brillo visible en pantalla (Σ con foco ${conFoco?.brillo} vs ${sinFoco?.brillo} sin)`,
    `el foco apenas cambia la pantalla (Σ ${conFoco?.brillo} con vs ${sinFoco?.brillo} sin — señal inservible para el check visual)`
  );
} finally {
  await R.resumen({ browser, errores });
}