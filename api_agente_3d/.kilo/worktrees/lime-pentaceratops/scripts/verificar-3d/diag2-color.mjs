/**
 * DIAG2 — Color propio de la fuente en el flujo ORIGINAL del usuario
 * (sin copiar/pegar): crear el texto en Texto, cambiar de pestaña,
 * y guardarlo/reabrirlo.
 *
 * Métrica: "coloridos" = píxeles de figura con saturación (máx−mín > 45).
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(AQUI, 'fixtures');
mkdirSync(FIXTURES, { recursive: true });
const ARCHIVO = join(FIXTURES, 'diag2-color.zeus');

const R = crearResultados('DIAG2 · color de fuente: pestañas + guardar/reabrir');

/** Mide tinta y coloridos del visor dado (0=frontal, 3=3D). */
function medidor(page, indice) {
  return page.evaluate(async (idx) => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const cont = conts[idx];
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
    let coloridos = 0;
    for (let y = 0; y < off.height; y += 2) {
      for (let x = 0; x < off.width; x += 2) {
        const o = (y * off.width + x) * 4;
        const r = d[o], g = d[o + 1], b = d[o + 2];
        if (Math.abs(r - f0[0]) + Math.abs(g - f0[1]) + Math.abs(b - f0[2]) >= 45) {
          tinta++;
          if (Math.max(r, g, b) - Math.min(r, g, b) > 45) coloridos++;
        }
      }
    }
    return { tinta, coloridos };
  }, indice);
}

/** ¿El .zeus trae faceColors reales por objeto? */
function revisarArchivo(path) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return (data.sceneObjects || []).map((o) => {
      const m = o.mesh || {};
      const fc = m.faceColors || [];
      const reales = fc.filter((c) => c && c !== '#ffffff').length;
      return { name: o.name, verts: (m.vertices || []).length, faceColors: fc.length, reales };
    });
  } catch (e) {
    return 'no se pudo leer: ' + e.message;
  }
}

const { browser, page, errores } = await abrirEditor();

try {
  // 1. Texto: escribir y esperar la fuente de color.
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  const s1 = await medidor(page, 0);
  R.check(s1 && s1.tinta > 300 && s1.coloridos > 100,
    'Texto: CON colores (tinta ' + s1?.tinta + ', coloridos ' + s1?.coloridos + ')',
    'Texto: sin colores (' + JSON.stringify(s1) + ')');

  // 2. Cambiar a Escena (el dueño se congela al salir).
  await clicTab(page, 'scene');
  await esperar(1200);
  const s2 = await medidor(page, 0);
  R.check(s2 && s2.coloridos > 100,
    'Escena: CON colores (coloridos ' + s2?.coloridos + ')',
    'Escena: SIN colores (coloridos ' + s2?.coloridos + ', tinta ' + s2?.tinta + ') — BUG al cambiar de pestaña');

  // 3. Seleccionar el objeto en el listado de Escena (solo seleccionar).
  await page.click('[data-testid="scene-object-0"]');
  await esperar(1000);
  const s3 = await medidor(page, 0);
  R.check(s3 && s3.coloridos > 100,
    'Escena (seleccionado): CON colores (coloridos ' + s3?.coloridos + ')',
    'Escena (seleccionado): SIN colores (coloridos ' + s3?.coloridos + ')');

  // 4. Entrar a Texto (re-adueñación) y volver a Escena.
  await clicTab(page, 'text');
  await esperar(2500);
  const s4 = await medidor(page, 0);
  R.check(s4 && s4.coloridos > 100,
    'Texto (re-adueñado): CON colores (coloridos ' + s4?.coloridos + ')',
    'Texto (re-adueñado): SIN colores (coloridos ' + s4?.coloridos + ')');
  await clicTab(page, 'scene');
  await esperar(1200);
  const s5 = await medidor(page, 0);
  R.check(s5 && s5.coloridos > 100,
    'Escena (tras re-adueñarse): CON colores (coloridos ' + s5?.coloridos + ')',
    'Escena (tras re-adueñarse): SIN colores (coloridos ' + s5?.coloridos + ')');

  // 5. Guardar el archivo.
  const descarga = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-save-modal"]');
  await esperar(700);
  await page.fill('[data-testid="save-name-input"]', 'diag2-color');
  await page.click('[data-testid="save-confirm-btn"]');
  const dl = await descarga;
  if (dl) {
    await dl.saveAs(ARCHIVO);
    const revision = revisarArchivo(ARCHIVO);
    console.log('  · contenido del .zeus: ' + JSON.stringify(revision));
    const objs = Array.isArray(revision) ? revision : [];
    R.check(objs.some((o) => o.reales > 0 && o.verts > 0),
      'el .zeus guarda la figura CON faceColors (' + objs.map((o) => o.name + ':verts=' + o.verts + ',reales=' + o.reales + '/' + o.faceColors).join('; ') + ')',
      'el .zeus perdió figura/colores: ' + JSON.stringify(revision));
  } else {
    R.error('no se disparó la descarga al guardar');
  }

  // 6. Recargar y reabrir ("En escena nueva").
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tab-scene"]', { timeout: 30000 });
  await esperar(1500);
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-obj3d-modal"]');
  await esperar(700);
  await page.setInputFiles('[data-testid="zeus-file-input"]', ARCHIVO);
  await esperar(4000);
  const s6 = await medidor(page, 0);
  console.log('  · tras reabrir: tinta=' + s6?.tinta + ', coloridos=' + s6?.coloridos);
  R.check(s6 && s6.coloridos > 100,
    'reabierto: CON colores (coloridos ' + s6?.coloridos + ')',
    'reabierto: SIN colores (coloridos ' + s6?.coloridos + ', tinta ' + s6?.tinta + ') — BUG REPRODUCIDO');
} finally {
  await R.resumen({ browser, errores });
}