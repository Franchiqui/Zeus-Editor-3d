/**
 * DIAG-CUBO-FRENTE-COSTADO v2
 *
 * Reproduce el gesto del usuario con public/Obj-3D/Cubo.zeus:
 *  A) Ventana 3D libre (3): pose frontal aproximada (rotY→0) + pose de
 *     costado (rotY=90°). Clic directo en los 2 vértices superiores y
 *     mover con los campos numéricos (Y−0.3) y con ARRASTRE.
 *  B) Ventana plana FRENTE (0) y COSTADO (2) como control.
 *  Se descarga el .zeus tras cada operación y se comparan las esquinas.
 */
import { abrirEditor, esperar } from './comun.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CUBO = path.join(AQUI, '..', '..', 'public', 'Obj-3D', 'Cubo.zeus');

const { browser, page, errores } = await abrirEditor();
let fallos = 0;
const check = (cond, okMsg, malMsg) => {
  if (!cond) fallos++;
  console.log(`${cond ? '  ✔' : '  ✘'} ${cond ? okMsg : malMsg}`);
};

/** Vuelca la geometría de la malla del objeto 0 leyendo el canvas: no.
 *  Mejor: se descarga el .zeus y se analiza el JSON. */

async function guardarZeus(nombre) {
  const descarga = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-save-modal"]');
  await esperar(700);
  await page.fill('[data-testid="save-name-input"]', nombre);
  await page.click('[data-testid="save-confirm-btn"]');
  const dl = await descarga;
  if (!dl) return null;
  const dest = path.join(AQUI, `${nombre}.zeus`);
  await dl.saveAs(dest);
  return dest;
}

function analizar(nombre, doc) {
  const obj = doc.sceneObjects[0];
  if (!obj?.mesh) {
    console.log(`${nombre}: SIN MALLA`);
    return;
  }
  const m = obj.mesh;
  const claves = new Map();
  for (const v of m.vertices) {
    const k = `${v.x.toFixed(6)}|${v.y.toFixed(6)}|${v.z.toFixed(6)}`;
    claves.set(k, (claves.get(k) ?? 0) + 1);
  }
  const corners = [...claves.entries()]
    .map(([k, n]) => {
      const [x, y, z] = k.split('|').map(Number);
      return { x, y, z, n };
    })
    .sort((a, b) => b.y - a.y || b.x - a.x || b.z - a.z);
  console.log(`\n--- ${nombre} — vértices ${m.vertices.length}, esquinas ${corners.length} ---`);
  for (const c of corners) console.log(`  (${c.x.toFixed(4)}, ${c.y.toFixed(4)}, ${c.z.toFixed(4)}) ×${c.n}`);
  // Simetría espejada X: cada esquina debe tener pareja (−x,y,z).
  let asim = 0;
  const kArr = [...claves.keys()];
  for (const c of corners) {
    const hay = kArr.some((k) => {
      const [vx, vy, vz] = k.split('|').map(Number);
      return Math.abs(vx + c.x) < 1e-6 && Math.abs(vy - c.y) < 1e-6 && Math.abs(vz - c.z) < 1e-6;
    });
    if (!hay) {
      asim++;
      console.log(`  SIN ESPEJO X: (${c.x.toFixed(4)}, ${c.y.toFixed(4)}, ${c.z.toFixed(4)})`);
    }
  }
  check(asim === 0, `simetría X ✔`, `¡simetría X ROTA en ${asim} esquina(s)!`);
  // Simetría Z (frente-atrás) para la operación frontal.
  let asimZ = 0;
  for (const c of corners) {
    const hay = kArr.some((k) => {
      const [vx, vy, vz] = k.split('|').map(Number);
      return Math.abs(vx - c.x) < 1e-6 && Math.abs(vy - c.y) < 1e-6 && Math.abs(vz + c.z) < 1e-6;
    });
    if (!hay) asimZ++;
  }
  check(asimZ === 0, `simetría Z ✔`, `¡simetría Z ROTA en ${asimZ} esquina(s)!`);
}

/** Recuadro de figura en el canvas idx: píxeles distintos del fondo
 *  (esquina del canvas), menos la rejilla — se compara contra la BASE
 *  capturada con la escena vacía. */
async function recuadroFigura(idx, _base) {
  return page.evaluate((i) => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const canvas = conts[i]?.querySelector('canvas');
    if (!canvas) return null;
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    // Fondo: pixel de la esquina inferior-izquierda (fuera de la figura).
    const oFondo = ((off.height - 3) * off.width + 3) * 4;
    const bg = [d[oFondo], d[oFondo + 1], d[oFondo + 2]];
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, tinta = 0;
    for (let y = 0; y < off.height; y += 2) {
      for (let x = 0; x < off.width; x += 2) {
        const o = (y * off.width + x) * 4;
        const b = Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]);
        if (b >= 45) {
          tinta++;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (tinta < 12) return null;
    const r = conts[i].getBoundingClientRect();
    return {
      css: { w: canvas.clientWidth, h: canvas.clientHeight, x: r.x, y: r.y },
      buf: { w: canvas.width, h: canvas.height },
      bg,
      q: { x0, x1, y0, y1 },
    };
  }, idx);
}

/** Fondo del canvas idx antes de cargar nada (color puro de esquina). */
async function fondoBase(idx) {
  return page.evaluate((i) => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const canvas = conts[i]?.querySelector('canvas');
    if (!canvas) return [0, 0, 0];
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    const o = ((Math.floor(off.height * 0.5)) * off.width + off.width - 2) * 4;
    return [d[o], d[o + 1], d[o + 2]];
  }, idx);
}

/** Clic en las dos esquinas SUPERIORES de la silueta del canvas idx.
 *  Reintenta con varios márgenes hasta que la barra cuenta selección. */
async function clicarVerticesSuperiores(idx) {
  const c = await recuadroFigura(idx);
  if (!c) throw new Error(`sin figura en ventana ${idx}`);
  console.log(`  recuadro ventana ${idx}:`, JSON.stringify(c.q));
  const sx = c.css.w / c.buf.w;
  const sy = c.css.h / c.buf.h;

  const clicEsquina = async (lado, insetPx) => {
    const cx = lado === 'TL' ? c.q.x0 + insetPx : c.q.x1 - insetPx;
    const cy = c.q.y0 + insetPx;
    await page.mouse.move(c.css.x + cx * sx, c.css.y + cy * sy);
    await page.mouse.click(c.css.x + cx * sx, c.css.y + cy * sy);
    await esperar(600);
  };

  let selTxt1 = await textoBarra();
  for (const inset of [10, 20, 35, 60]) {
    await clicEsquina('TL', inset);
    selTxt1 = await textoBarra();
    const n1 = parseInt((selTxt1.match(/(\d+)\s*v[eé]rtice(s?)/) || [])[1] ?? '0', 10);
    if (n1 > 0) break;
  }
  // Segundo vértice: MAYÚS+clic (añade), reintentando igual.
  let selTxt2 = selTxt1;
  for (const inset of [10, 20, 35, 60]) {
    await page.keyboard.down('Shift');
    await clicEsquina('TR', inset);
    await page.keyboard.up('Shift');
    selTxt2 = await textoBarra();
    const n2 = parseInt((selTxt2.match(/(\d+)\s*v[eé]rtice(s?)/) || [])[1] ?? '0', 10);
    const n1 = parseInt((selTxt1.match(/(\d+)\s*v[eé]rtice(s?)/) || [])[1] ?? '0', 10);
    if (n2 > n1) break;
  }
  return { selTxt1, selTxt2, q: c.q };
}

async function textoBarra() {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="face-select-bar"]');
    return bar ? bar.textContent?.replace(/\s+/g, ' ').slice(0, 100) : '(sin barra)';
  });
}

async function moverY(v) {
  await page.fill('[data-testid="face-move-y"]', String(v));
  await page.click('[data-testid="face-move-apply"]');
  await esperar(1500);
}

async function deshacer(n) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');
    await esperar(400);
  }
  await esperar(700);
}

try {
  // 0. Baseline vacía (ya no hace falta: recuadroFigura toma su propio fondo).

  // 1. Cargar el cubo.
  await page.click('[data-testid="actions-menu-trigger"]');
  await esperar(500);
  await page.click('[data-testid="open-obj3d-modal"]');
  await esperar(800);
  await page.setInputFiles('[data-testid="zeus-file-input"]', CUBO);
  await esperar(4000);
  await page.keyboard.press('Escape');
  await esperar(600);

  const objetos = await page.evaluate(() => {
    const lista = document.querySelector('[data-testid="scene-object-list"]');
    if (!lista) return [];
    return [...lista.querySelectorAll('[data-testid^="scene-object-"]:not([data-testid^="scene-object-check"])')].map(
      (el) => el.getAttribute('data-testid')
    );
  });
  if (objetos.length > 0) {
    await page.click(`[data-testid="${objetos[0]}"]`);
    await esperar(1000);
  }

  // 2. Modo Puntos.
  await page.click('[data-testid="subselect-vertice"]');
  await esperar(900);

  // ══════ A) VENTANA 3D LIBRE: pose FRONTAL (rotY→0 con ↻ desde −45°).
  // El botón ↻ está en la cabecera del panel ([data-view="3d"]).
  const panel3 = page.locator('[data-view="3d"]');
  const rotRight = panel3.locator('button', { hasText: '↻' });
  for (let i = 0; i < 3; i++) {
    await rotRight.click();
    await esperar(500);
  }
  await esperar(1200);
  const selA = await clicarVerticesSuperiores(3);
  console.log('selección (3D frontal):', selA.selTxt1, '→', selA.selTxt2);

  await moverY(-0.3);
  const zF = await guardarZeus('tmp-cubo-3d');
  if (zF) analizar('A · 3D libre FRONTAL, Y−0.3 aplicado', JSON.parse(readFileSync(zF, 'utf8')));
  await deshacer(6);

  // ══════ B) VENTANA 3D LIBRE: pose COSTADO (rotY 90° con ↻ ×6).
  for (let i = 0; i < 6; i++) {
    await rotRight.click();
    await esperar(400);
  }
  await esperar(1200);
  const selB = await clicarVerticesSuperiores(3);
  console.log('selección (3D costado):', selB.selTxt1, '→', selB.selTxt2);
  await moverY(-0.3);
  const zS = await guardarZeus('tmp-cubo-3d-costado');
  if (zS) analizar('B · 3D libre COSTADO, Y−0.3 aplicado', JSON.parse(readFileSync(zS, 'utf8')));
  await deshacer(6);

  // ══════ C) CONTROL: ventana plana FRENTE (0).
  const selC = await clicarVerticesSuperiores(0);
  console.log('selección (plana frontal):', selC.selTxt1, '→', selC.selTxt2);
  await moverY(-0.3);
  const zC = await guardarZeus('tmp-cubo-plano-front');
  if (zC) analizar('C · plana FRENTE, Y−0.3 aplicado', JSON.parse(readFileSync(zC, 'utf8')));
  await deshacer(6);

  // ══════ D) CONTROL: ventana plana COSTADO (2).
  const selD = await clicarVerticesSuperiores(2);
  console.log('selección (plana costado):', selD.selTxt1, '→', selD.selTxt2);
  await moverY(-0.3);
  const zD = await guardarZeus('tmp-cubo-plano-costado');
  if (zD) analizar('D · plana COSTADO, Y−0.3 aplicado', JSON.parse(readFileSync(zD, 'utf8')));

  if (errores.length) console.log('⚠ consola:', errores.slice(0, 8));
  console.log(fallos === 0 ? '\nTODO SIMÉTRICO' : `\n${fallos} fallo(s) de simetría`);
} finally {
  await browser.close();
}