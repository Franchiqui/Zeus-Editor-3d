/**
 * DIAG FX NEON 5 — ¿Cómo cambia el neón al CAMBIAR el objeto activo?
 * Neón en el objeto 0: capturas «0 activo» → «0 duplicado (activo=1)» →
 * «0 activo otra vez». El diff 0-activo vs 0-duplicado describe la pérdida
 * de cobertura que ve el usuario al pasar la selección a otro objeto.
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG FX NEON 5 · neón al cambiar el objeto activo');

async function firmaDensa(page) {
  return page.evaluate(() => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
    const canvas = cont && cont.querySelector('canvas');
    if (!canvas) return null;
    const url = canvas.toDataURL('image/png');
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    const img = new Image();
    const lista = new Promise((res) => {
      img.onload = res;
      img.onerror = res;
    });
    img.src = url;
    return lista.then(() => {
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, off.width, off.height).data;
      const firma = [];
      for (let i = 0; i < d.length; i += 8) {
        firma.push(d[i] | (d[i + 1] << 5) | (d[i + 2] << 12));
      }
      // Color medio y rango de la imagen (para comparar tono medio).
      let rs = 0, gs = 0, bs = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 2) {
        rs += d[i]; gs += d[i + 1]; bs += d[i + 2]; n++;
      }
      // Cuantiza la figura a 5 bits por canal y guarda las muestras en
      // coordenada: para reconstruir qué cambia exactamente.
      return {
        w: off.width, h: off.height, paso: 2, firma: firma.join(','),
        medio: [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)].join('-'),
        rgb: d,
      };
    });
  });
}

function huella(a, b) {
  if (!a || !b) return null;
  const fa = a.firma.split(',').map(Number);
  const fb = b.firma.split(',').map(Number);
  const cols = Math.ceil(a.w / a.paso);
  let cambio = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const columnas = new Array(cols).fill(0);
  for (let i = 0; i < fa.length; i++) {
    if (Math.abs(fa[i] - fb[i]) > 28) {
      cambio++;
      columnas[i % cols]++;
      const x = (i % cols) * a.paso;
      const y = Math.floor(i / cols) * a.paso;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const bandas = [];
  for (let b = 0; b < 6; b++) {
    let s = 0;
    const desde = Math.floor((b / 6) * cols);
    const hasta = Math.max(desde + 1, Math.floor(((b + 1) / 6) * cols));
    for (let c = desde; c < hasta; c++) s += columnas[c];
    bandas.push(s);
  }
  let res = {
    cambio,
    caja: { ancho: maxX - minX + a.paso, alto: maxY - minY + a.paso },
    bandas: bandas.join(':'),
    colorA: null,
    colorB: null,
  };
  // Color medio de los píxeles cambiantes en cada estado: distingue
  // gris-out de un cambio de sombreado/textura.
  return (a.rgb && b.rgb)
    ? (() => {
        let ar = 0, ag = 0, ab = 0, br = 0, bg = 0, bb = 0;
        let k = 0;
        for (let i = 0; i < fa.length; i++) {
          if (Math.abs(fa[i] - fb[i]) > 28) {
            const o = Math.min(a.rgb.length - 4, i * 8);
            ar += a.rgb[o]; ag += a.rgb[o + 1]; ab += a.rgb[o + 2];
            br += b.rgb[o]; bg += b.rgb[o + 1]; bb += b.rgb[o + 2];
            k++;
          }
        }
        res.colorA = [Math.round(ar / k), Math.round(ag / k), Math.round(ab / k)].join('-');
        res.colorB = [Math.round(br / k), Math.round(bg / k), Math.round(bb / k)].join('-');
        res.k = k;
        return res;
      })()
    : res;
}

/** Índice del objeto activo según la fila resaltada de la lista de escena. */
const activoDe = async (page) =>
  page.evaluate(() => {
    const items = document.querySelectorAll('[data-testid^="scene-object-"]');
    for (let i = 0; i < items.length; i++) {
      if ((items[i].className || '').includes('bg-green-500/10')) return i;
    }
    return -1;
  });

const { browser, page, errores } = await abrirEditor();

try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await page.click('[data-testid="copy-object-btn"]');
  await esperar(600);
  await clicTab(page, 'scene');
  await esperar(900);
  await page.click('[data-testid="paste-object-btn"]');
  await esperar(1400);

  // Quitar el gizmo para que la huella del cambio de activo sea solo la
  // figura viva vs instantánea (el gizmo viaja con el activo).
  const gizmoBtn = page.locator('[data-testid="toggle-gizmo-btn"]').first();
  if (await gizmoBtn.count()) await gizmoBtn.click();
  await esperar(700);

  // --- Fase A: cambio de activo SIN neón (gizmo + figura viva vs instantánea).
  const s0 = await firmaDensa(page);
  await page.click('[data-testid="scene-object-1"]');
  await esperar(2500);
  const s1 = await firmaDensa(page);
  await page.click('[data-testid="scene-object-0"]');
  await esperar(2500);
  const s0b = await firmaDensa(page);
  const sinFx = huella(s0, s1);
  console.log(
    '  · SIN neón, activo 0→1: píxeles=' + sinFx?.cambio +
    ' caja=' + JSON.stringify(sinFx?.caja) +
    ' bandas=' + sinFx?.bandas +
    ' colorA=' + sinFx?.colorA + ' colorB=' + sinFx?.colorB
  );
  // Mapa ASCII de la huella: filas ~cada 10% de alto, cols cada 5% de ancho.
  const mapa = (a, b) => {
    if (!a || !b) return '(null)';
    const fa = a.firma.split(',').map(Number);
    const fb = b.firma.split(',').map(Number);
    const cols = Math.ceil(a.w / a.paso);
    const filas = Math.ceil(a.h / a.paso);
    const bw = 60;
    const bh = 12;
    const rejilla = Array.from({ length: bh }, () => new Array(bw).fill(0));
    for (let i = 0; i < fa.length; i++) {
      if (Math.abs(fa[i] - fb[i]) > 28) {
        const cx = Math.min(bw - 1, Math.floor(((i % cols) / cols) * bw));
        const cy = Math.min(bh - 1, Math.floor((Math.floor(i / cols) / filas) * bh));
        rejilla[cy][cx] = 1;
      }
    }
    return rejilla.map((fila) => fila.map((v) => (v ? '#' : '.')).join('')).join('\n');
  };
  console.log('  · mapa sin neón (cada # = zona de cambio):\n' + mapa(s0, s1));
  console.log('  · SIN neón, regreso: ' + JSON.stringify(huella(s0b, s1)));

  // --- Fase B: la misma secuencia CON neón en el objeto 0.

  // Neón SOLO en el objeto 0 (activo).
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(500);
  await page.getByText('Brillo neón', { exact: true }).first().click();
  await esperar(2200);
  const sel0 = await firmaDensa(page);

  // Seleccionar el objeto 1 → el 0 pasa a duplicado.
  await page.click('[data-testid="scene-object-1"]');
  await esperar(2500);
  const dup0 = await firmaDensa(page);

  // Volver a seleccionar el 0.
  await page.click('[data-testid="scene-object-0"]');
  await esperar(2500);
  const sel0B = await firmaDensa(page);

  const dCambio = huella(sel0, dup0);
  console.log(
    '  · CON neón, activo→duplicado: píxeles=' + dCambio?.cambio +
    ' caja=' + JSON.stringify(dCambio?.caja) +
    ' bandas=' + dCambio?.bandas
  );
  const dRegreso = huella(sel0B, dup0);
  console.log(
    '  · CON neón, duplicado→regreso: píxeles=' + dRegreso?.cambio +
    ' caja=' + JSON.stringify(dRegreso?.caja) +
    ' bandas=' + dRegreso?.bandas
  );
  // ¿El tono medio cambia entre estados? (gris-out, material, sombreado)
  console.log('  · color medio: sel0=' + sel0?.medio + ' dup0=' + dup0?.medio + ' regreso=' + sel0B?.medio);
  // Comparación: la huella CON neón debe ser de la misma escala que SIN
  // neón (gizmo). Si es mucho mayor, el halo cambia con el activo — BUG.
  R.check(
    !!dCambio && !!sinFx && dCambio.cambio <= sinFx.cambio * 3 + 120,
    `cambiar el activo apenas altera el neón (${dCambio?.cambio} px vs ${sinFx?.cambio} px sin neón)`,
    `cambiar el activo altera la cobertura del neón (${dCambio?.cambio} px vs ${sinFx?.cambio} px sin neón) — BUG`
  );
  // --- Fase C: neón en AMBOS objetos, cambiar el activo 0↔1.
  await page.click('[data-testid="scene-object-1"]');
  await esperar(800);
  await page.locator('button[title="Efectos visuales"]').first().click();
  await esperar(400);
  await page.getByText('Brillo neón', { exact: true }).first().click();
  await page.keyboard.press('Escape');
  await esperar(400);
  await esperar(2200);
  const ambos0 = await firmaDensa(page); // activo = 0, neón en 0 y 1
  console.log('  · activo tras aplicar a ambos: ' + (await activoDe(page)));
  await page.click('[data-testid="scene-object-1"]');
  await esperar(2500);
  const ambos1 = await firmaDensa(page); // activo = 1
  console.log('  · activo tras cambio: ' + (await activoDe(page)));
  await page.click('[data-testid="scene-object-0"]');
  await esperar(2500);
  const ambos0b = await firmaDensa(page); // activo = 0 otra vez
  console.log('  · activo tras regreso: ' + (await activoDe(page)));
  const dAmbos = huella(ambos0, ambos1);
  console.log(
    '  · NEÓN EN AMBOS, activo 0→1: píxeles=' + dAmbos?.cambio +
    ' caja=' + JSON.stringify(dAmbos?.caja) + ' bandas=' + dAmbos?.bandas
  );
  console.log('  · NEÓN EN AMBOS, regreso: ' + JSON.stringify(huella(ambos0b, ambos1)?.cambio));
  R.check(
    !!dAmbos && dAmbos.cambio <= (sinFx?.cambio ?? 9999) * 3 + 120,
    `con neón en ambos, cambiar el activo apenas altera la vista (${dAmbos?.cambio} px vs ${sinFx?.cambio} px sin neón)`,
    `el neón cambia al cambiar de activo (${dAmbos?.cambio} px vs ${sinFx?.cambio} px sin neón) — BUG`
  );
} catch (e) {
  R.check(false, 'no debió fallar', 'falló: ' + e.message);
} finally {
  await R.resumen({ browser, errores });
}