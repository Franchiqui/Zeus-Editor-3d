/**
 * Debug: ¿el botón ▶ del editor de animación enciende playing?
 */
import { abrirEditor, esperar, crearResultados } from './comun.mjs';

const R = crearResultados('DEBUG play');
const { browser, page, errores } = await abrirEditor();

try {
  await page.click('[data-testid="add-camera-object-btn"]');
  await esperar(800);
  await page.click('[data-testid="add-camera-keyframe-btn"]');
  await esperar(500);
  await page.fill('[data-testid="camera-kf-time-0"]', '0');
  await esperar(400);
  await page.click('[data-testid="add-camera-keyframe-btn"]');
  await esperar(500);
  await page.fill('[data-testid="camera-kf-time-1"]', '2');
  await esperar(600);
  await page.click('[data-testid="tab-scene"]');
  await esperar(900);

  const btns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .map((b, i) => `${i}:${JSON.stringify((b.textContent || '').trim().slice(0, 12))}`)
      .filter((t) => /[▶⏸❚|]/.test(t))
      .join(' | ')
  );
  console.log('BOTONES: ' + btns);

  const play = page.locator('button:text-is("▶")').last();
  console.log('nplay: ' + (await page.locator('button:text-is("▶")').count()));
  await play.click();
  await esperar(1000);
  const btns2 = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .map((b, i) => `${i}:${JSON.stringify((b.textContent || '').trim().slice(0, 12))}`)
      .filter((t) => /[▶⏸❚|]/.test(t))
      .join(' | ')
  );
  console.log('DESPUÉS: ' + btns2);
  const tiempo = await page.evaluate(() =>
    Array.from(document.querySelectorAll('span')).map((s) => s.textContent).filter((t) => /s$/.test(t || '')).slice(0, 5).join(' ¦ ')
  );
  console.log('TIEMPOS: ' + tiempo);
} finally {
  await R.resumen({ browser, errores });
}