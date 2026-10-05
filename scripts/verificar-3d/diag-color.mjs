/**
 * DIAG — Color propio de la fuente en un texto pegado a Escena, y su
 * supervivencia al guardar/reabrir el .zeus.
 *
 * Flujo del usuario:
 *  1. Texto: escribir "HOLA" (la fuente Textura es de color) → se ve con colores.
 *  2. Copiar el objeto → pegarlo en la pestaña Escena → se ve con colores.
 *  3. Guardar el archivo (.zeus) → reabrirlo → los colores se pierden.
 *
 * Métrica: además de la "tinta" (píxeles de figura), cuenta "colores" =
 * píxeles con saturación (canal máx − mín > 45): la tinta monocroma no
 * cuenta, solo la textura de la fuente de color.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  numObjetos,
  escribirTexto,
  crearResultados,
} from './comun.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(AQUI, 'fixtures');
mkdirSync(FIXTURES, { recursive: true });
const ARCHIVO = join(FIXTURES, 'diag-color.zeus');

const R = crearResultados('DIAG · color de fuente tras guardar/reabrir');

/** Mide la vista frontal: tinta (figura) + coloridos (píxeles saturados). */
async function medir(page) {
  return page.evaluate(async () => {
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
  });
}

/** ¿El .zeus guardado trae faceColors con colores reales por objeto? */
function revisarArchivo(path) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return (data.sceneObjects || []).map((o) => {
      const m = o.mesh || {};
      const fc = m.faceColors || [];
      const reales = fc.filter((c) => c && c !== '#ffffff').length;
      return {
        name: o.name,
        verts: (m.vertices || []).length,
        faceColors: fc.length,
        reales,
        textura: !!m.texture,
      };
    });
  } catch (e) {
    return `no se pudo leer: ${e.message}`;
  }
}

const { browser, page, errores } = await abrirEditor();

try {
  // 1. Texto: escribir y esperar la fuente de color.
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  const s1 = await medir(page);
  R.check(s1 && s1.tinta > 300, `Texto: figura visible (tinta ${s1?.tinta})`, `Texto: figura NO visible (${JSON.stringify(s1)})`);
  R.check(s1 && s1.coloridos > 100, `Texto: CON colores de la fuente (coloridos ${s1?.coloridos})`, `Texto: SIN colores de la fuente (coloridos ${s1?.coloridos})`);

  // 2. Copiar y pegar en Escena.
  await page.click('[data-testid="copy-object-btn"]');
  await esperar(700);
  await clicTab(page, 'scene');
  await page.click('[data-testid="paste-object-btn"]');
  await esperar(1500);
  const n = await numObjetos(page);
  R.check(n === 2, `Escena: 2 objetos tras pegar (hay ${n})`, `Escena: se esperaban 2 objetos, hay ${n}`);
  const s2 = await medir(page);
  R.check(s2 && s2.coloridos > 100, `Escena (pegado): CON colores (coloridos ${s2?.coloridos})`, `Escena (pegado): SIN colores (coloridos ${s2?.coloridos})`);

  // 3. Guardar el archivo (destino por defecto: objeto).
  const descarga = page
    .waitForEvent('download', { timeout: 30000 })
    .catch(() => null);
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-save-modal"]');
  await esperar(700);
  await page.fill('[data-testid="save-name-input"]', 'diag-color');
  await page.click('[data-testid="save-confirm-btn"]');
  const dl = await descarga;
  if (dl) {
    await dl.saveAs(ARCHIVO);
    R.check(true, `archivo guardado en ${ARCHIVO}`, `no se guardó`);
  } else {
    // Sin descarga: volcar lo que diga el modal (mensaje de error).
    const modalTxt = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[class*="rounded-lg px-4"]'))
        .map((d) => d.textContent)
        .join(' | ')
    );
    R.error(`no se disparó la descarga al guardar. Mensajes del modal: ${modalTxt || '(ninguno)'}`);
  }
  await esperar(1000);

  // 4. El archivo guardado: ¿trae faceColors?
  if (dl) {
    const revision = revisarArchivo(ARCHIVO);
    console.log('  · contenido del .zeus:', JSON.stringify(revision));
    const objs = Array.isArray(revision) ? revision : [];
    const conColor = objs.filter((o) => o.reales > 0);
    R.check(conColor.length > 0, `el .zeus guarda faceColors reales (${objs.map((o) => `${o.name}:${o.reales}/${o.faceColors}`).join(', ')})`, `el .zeus perdió los faceColors: ${JSON.stringify(revision)}`);
  }

  // 5. Medir en vivo tras guardar (aún sin recargar).
  const s3 = await medir(page);
  R.check(s3 && s3.coloridos > 100, `post-guardado en vivo: CON colores (coloridos ${s3?.coloridos})`, `post-guardado en vivo: SIN colores (coloridos ${s3?.coloridos})`);

  // 6. Recargar la página y reabrir el archivo.
  if (dl) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tab-scene"]', { timeout: 30000 });
  await esperar(1500);
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-obj3d-modal"]');
  await esperar(700);
  await page.setInputFiles('[data-testid="zeus-file-input"]', ARCHIVO);
  await esperar(4000); // carga + fuente de color async

  const n2 = await numObjetos(page);
  R.check(n2 > 0, `reabierto: hay ${n2} objeto(s) en la escena`, `reabierto: la escena quedó VACÍA (0 objetos)`);
  const s5 = await medir(page);
  console.log(`  · medidas tras reabrir: tinta=${s5?.tinta}, coloridos=${s5?.coloridos}`);
  R.check(s5 && s5.coloridos > 100, `reabierto: CON colores (coloridos ${s5?.coloridos})`, `reabierto: SIN colores de la fuente (coloridos ${s5?.coloridos}) — BUG REPRODUCIDO`);

  // 7. También medir el visor 3D (ventana 3) por si la frontal difiere.
  const s53d = await page.evaluate(async () => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const canvas = conts[3] && conts[3].querySelector('canvas');
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
    let coloridos = 0;
    for (let i = 0; i < d.length; i += 8) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (Math.abs(r - f0[0]) + Math.abs(g - f0[1]) + Math.abs(b - f0[2]) >= 45) {
        if (Math.max(r, g, b) - Math.min(r, g, b) > 45) coloridos++;
      }
    }
    return { coloridos };
  });
  console.log(`  · visor 3D tras reabrir: coloridos=${s53d?.coloridos}`);
  } else {
    R.error(`no se disparó la descarga al guardar; sin fase de reabrir`);
  }
} finally {
  await R.resumen({ browser, errores });
}