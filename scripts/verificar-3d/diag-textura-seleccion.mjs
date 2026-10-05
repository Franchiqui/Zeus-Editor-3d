/**
 * DIAG TEXTURA SELECCIÓN — la imagen asignada a varias caras seleccionadas
 * es UNA imagen GLOBAL estirada sobre la caja de TODA la selección
 * (comportamiento de siempre), NO una copia por cara.
 *
 * Flujo: texto HOLA → modo selección → área rectangular (varias caras) →
 * «Asignar textura» con PNG de degradado en X.
 *
 * Señal a nivel de DATOS en el grupo texturizado del visor frontal:
 *  1. Se crea el grupo texturizado.
 *  2. GLOBAL: la unión de la U de todos los vértices texturizados reparte
 *     todo [0,1] (y la V casi también) — la imagen cubre la selección.
 *  3. No es copia por cara: ALGUNA cara texturizada tiene su propio
 *     rango de U más estrecho que 0.9 (una pieza del mosaico global).
 *  4. Orientación DERECHA: corr(X↔U) ≥ 0.8 y corr(Y↔V) ≥ 0.8
 *     (V crece hacia arriba; flipY=true muestra la parte alta en V=1).
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG TEXTURA SELECCIÓN · imagen global estirada');

// PNG 16x16 con degradado: rojo = degradado en X, verde = degradado en Y.
const pngDegradado = await (async () => {
  const zlib = (await import('zlib')).default;
  const W = 16, H = 16;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    for (let x = 0; x < W; x++) {
      const off = y * (1 + W * 3) + 1 + x * 3;
      raw[off] = Math.round((x / (W - 1)) * 255);
      raw[off + 1] = Math.round(((H - 1 - y) / (H - 1)) * 255);
      raw[off + 2] = 128;
    }
  }
  const idat = zlib.deflateSync(raw);
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crcOf = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crcOf(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
})();

const { browser, page, errores } = await abrirEditor();
try {
  await clicTab(page, 'text');
  await escribirTexto(page, 'HOLA');
  await esperar(2500);
  await clicTab(page, 'scene');
  await esperar(900);
  await page.locator('button[title*="Seleccionar caras"]').first().click();
  await esperar(700);

  const cont = page.locator('[data-testid="viewer-container"]').first();
  const caja = await cont.boundingBox();
  // Banda ancha sobre el texto: varias caras de varias letras.
  await page.mouse.move(caja.x + caja.width * 0.20, caja.y + caja.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(caja.x + caja.width * 0.55, caja.y + caja.height * 0.62, { steps: 6 });
  await page.mouse.up();
  await esperar(700);
  const barTxt = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="face-select-bar"]');
    const m = b && (b.textContent ?? '').match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  });
  console.log('caras en el área:', barTxt);

  const [elegido] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('button[title*="Asignar textura"]').first().click(),
  ]);
  await elegido.setFiles({
    name: 'degradado.png', mimeType: 'image/png',
    buffer: Buffer.from(pngDegradado, 'base64'),
  });
  await esperar(3000);

  const leer = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const cont = conts[0];
    const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
    let grupos = null;
    const corr = (pares) => {
      const n = pares.length;
      if (n < 3) return NaN;
      let sx = 0, sy = 0;
      for (const [x, y] of pares) { sx += x; sy += y; }
      const mx = sx / n, my = sy / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (const [x, y] of pares) {
        const dx = x - mx, dy = y - my;
        sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
      }
      return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
    };
    const visit = (fib, prof) => {
      if (!fib || prof > 70) return;
      for (let n = fib.memoizedState, i = 0; n && i < 800; i++, n = n.next) {
        const cur = n.memoizedState?.current;
        if (!cur || typeof cur !== 'object' || cur.isGroup !== true) continue;
        cur.traverse((o) => {
          if (!o.isMesh || !Array.isArray(o.material) || !o.material.some((mm) => mm.map)) return;
          const pos = o.geometry.attributes.position;
          const uv = o.geometry.attributes.uv;
          if (!pos || !uv) return;
          const gs = [];
          const todo = { paresX: [], paresY: [] };
          let uMin = 9, uMax = -9, vMin = 9, vMax = -9;
          let caraEstrecha = Infinity;
          for (const g of o.geometry.groups) {
            if (g.materialIndex === 0) continue;
            let gUMin = 9, gUMax = -9, gVMin = 9, gVMax = -9;
            const paresXg = [], paresYg = [];
            for (let i = g.start; i < g.start + g.count; i++) {
              const vi = o.geometry.index ? o.geometry.index.array[i] : i;
              const x = pos.array[vi * 3], y = pos.array[vi * 3 + 1];
              const u = uv.array[vi * 2], v = uv.array[vi * 2 + 1];
              gUMin = Math.min(gUMin, u); gUMax = Math.max(gUMax, u);
              gVMin = Math.min(gVMin, v); gVMax = Math.max(gVMax, v);
              uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
              vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
              todo.paresX.push([x, u]); todo.paresY.push([y, v]);
              paresXg.push([x, u]); paresYg.push([y, v]);
            }
            caraEstrecha = Math.min(caraEstrecha, gUMax - gUMin);
            gs.push({
              mat: g.materialIndex, tris: g.count / 3,
              uRango: (gUMax - gUMin).toFixed(2), vRango: (gVMax - gVMin).toFixed(2),
            });
          }
          if (gs.length) {
            grupos = {
              nGrupos: gs.length, trisTot: gs.reduce((s, x) => s + x.tris, 0),
              uRangoGlobal: (uMax - uMin).toFixed(2),
              uMin: uMin.toFixed(2), vMin: vMin.toFixed(2), vMax: vMax.toFixed(2),
              caraEstrecha: caraEstrecha.toFixed(2),
              corrXU: corr(todo.paresX).toFixed(3),
              corrYV: corr(todo.paresY).toFixed(3),
              gs: gs.slice(0, 6),
            };
          }
        });
      }
      visit(fib.child, prof + 1);
      visit(fib.sibling, prof + 1);
    };
    for (let f = cont[llave]; f; f = f.return) visit(f, 0);
    return grupos;
  });
  console.log('GRUPOS:', JSON.stringify(leer, null, 1));

  R.check(!!leer && leer.trisTot >= 1,
    'el visor creó el grupo de material de la selección con textura',
    'no aparece grupo texturizado — la asignación no llegó al visor — BUG');
  if (leer) {
    R.check(parseFloat(leer.uRangoGlobal) > 0.9,
      `imagen GLOBAL: la U unida reparte casi todo [0,1] (${leer.uRangoGlobal})`,
      `la unidad de la selección no cubre [0,1] en U (${leer.uRangoGlobal}) — BUG de mapeo`);
    R.check(!leer.gs || leer.gs.every((g) => parseFloat(g.uRango) <= 0.99 || leer.gs.length > 1),
      'la textura se reparte en varias piezas (no un remiendo por cara)',
      'una sola pieza con todo el UV — puede ser copia por cara — revisar');
    R.check(parseFloat(leer.corrXU) >= 0.8 && parseFloat(leer.corrYV) >= 0.8,
      `orientación DERECHA (corr X↔U ${leer.corrXU}, Y↔V ${leer.corrYV})`,
      `orientación rota (corr X↔U ${leer.corrXU}, Y↔V ${leer.corrYV}) — textura boca abajo — BUG`);
  }
} finally {
  await R.resumen({ browser, errores });
}