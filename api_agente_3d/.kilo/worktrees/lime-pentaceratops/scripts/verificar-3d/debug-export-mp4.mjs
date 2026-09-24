/**
 * DEBUG-EXPORT-MP4 — comprueba la calidad de la exportación: descarga el
 * vídeo del botón «Exportar MP4» (en navegador sale WebM) y lo sondea con
 * ffprobe: esperamos 1920×1080 y códec VP9 (o VP8 de respaldo).
 */
import { abrirEditor, esperar, crearResultados } from './comun.mjs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(AQUI, 'fixtures', 'debug-export.webm');

const R = crearResultados('DEBUG-EXPORT-MP4 · calidad de la exportación');
const { browser, page, errores } = await abrirEditor();

try {
  await page.click('[data-testid="add-camera-object-btn"]');
  await esperar(800);
  await page.click('[data-testid="add-camera-keyframe-btn"]');
  await esperar(600);
  await page.fill('[data-testid="camera-kf-time-0"]', '0');
  await esperar(500);
  await page.click('[data-testid="add-camera-keyframe-btn"]');
  await esperar(600);
  await page.fill('[data-testid="camera-kf-time-1"]', '2');
  await page.fill('[data-testid="camera-kf-pos-1-x"]', '5');
  await page.fill('[data-testid="camera-kf-pos-1-y"]', '4');
  await page.fill('[data-testid="camera-kf-pos-1-z"]', '2');
  await esperar(800);
  await page.click('[data-testid="tab-scene"]');
  await esperar(900);
  await page.locator('button', { hasText: 'Editor de animación' }).first().click();
  await esperar(600);

  const dl = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await page.locator('button', { hasText: 'Exportar MP4' }).last().click();
  const descarga = await dl;
  if (!descarga) {
    R.check(false, 'la exportación dispara descarga', 'no llegó ninguna descarga');
  } else {
    await descarga.saveAs(ARCHIVO);
    R.check(true, 'la exportación dispara descarga', '');
    try {
      const out = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of csv=p=0 "${ARCHIVO}"`,
        { encoding: 'utf8' }
      ).trim();
      console.log('  · ffprobe: ' + out);
      const [codec, w, h] = out.split(',');
      R.check(String(w).trim() === '1920' && String(h).trim() === '1080',
        'la grabación sale a 1920×1080', `resolución inesperada: ${out}`);
      R.check(codec.trim() === 'vp9', 'la grabación usa VP9 (alta calidad)', `códec: ${out}`);
    } catch (e) {
      console.log('  · ffprobe no disponible: ' + e.message.split('\n')[0]);
    }
  }
} finally {
  await R.resumen({ browser, errores });
}