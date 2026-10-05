/**
 * DIAG TEXTURA POR CARA — ¿la textura asignada a cara(s) seleccionada(s)
 * sale DERECHA (no boca abajo)?
 *
 * Flujo: texto HOLA → modo selección de caras → clic en una cara →
 * «Asignar textura» con una imagen PNG roja arriba / azul abajo.
 *
 * Señal a nivel de DATOS (inmune al mosaico de color de la fuente,
 * que enmascara el píxel): en el grupo de material texturizado del visor
 * frontal, la V del UV debe crecer con la Y del vértice (v=1 arriba =
 * parte ALTA de la imagen con flipY=true) y la U con la X. Correlación
 * ≥ +0.8 ⇒ orientación correcta; ≈ −1 sería la textura boca abajo.
 * Además la cara debe repartir V en todo [0,1] (la imagen ENCAJA en la
 * cara, no muestra una franja del atlas global).
 */
import {
  abrirEditor,
  esperar,
  clicTab,
  escribirTexto,
  crearResultados,
} from './comun.mjs';

const R = crearResultados('DIAG TEXTURA POR CARA · orientación + encaje');

// Imagen PNG 8x8: mitad superior ROJA, inferior AZUL (sin transparencia).
const pngRojoAzul = await (async () => {
  const zlib = (await import('zlib')).default;
  const W = 8, H = 8;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    for (let x = 0; x < W; x++) {
      const off = y * (1 + W * 3) + 1 + x * 3;
      const top = y < H / 2;
      raw[off] = top ? 255 : 0; raw[off + 1] = 0; raw[off + 2] = top ? 0 : 255;
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
  // Clic en el CENTRO del texto (cara de tapa de una letra).
  await page.mouse.click(caja.x + caja.width * 0.40, caja.y + caja.height * 0.42);
  await esperar(700);

  const [elegido] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('button[title*="Asignar textura"]').first().click(),
  ]);
  await elegido.setFiles({
    name: 'rojo-azul.png', mimeType: 'image/png',
    buffer: Buffer.from(pngRojoAzul, 'base64'),
  });
  await esperar(3000);

  // Lectura de datos del grupo texturizado (visor FRONTAL).
  const grupos = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const cont = conts[0]; // vista FRONTAL
    const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
    let resultado = null;
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
          for (const g of o.geometry.groups) {
            if (g.materialIndex === 0) continue;
            const paresY = [], paresX = [];
            let vMin = 9, vMax = -9;
            for (let i = g.start; i < g.start + g.count; i++) {
              const vi = o.geometry.index ? o.geometry.index.array[i] : i;
              const y = pos.array[vi * 3 + 1], x = pos.array[vi * 3];
              const v = uv.array[vi * 2 + 1], u = uv.array[vi * 2];
              paresY.push([y, v]);
              paresX.push([x, u]);
              vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
            }
            gs.push({
              mat: g.materialIndex, tris: g.count / 3,
              corrYV: corr(paresY).toFixed(3),
              corrXU: corr(paresX).toFixed(3),
              vEncaja: vMax > 0.9 && vMin < 0.1,
            });
          }
          if (gs.length) resultado = gs;
        });
      }
      visit(fib.child, prof + 1);
      visit(fib.sibling, prof + 1);
    };
    for (let f = cont[llave]; f; f = f.return) visit(f, 0);
    return resultado;
  });
  console.log('GRUPOS TEXTURIZADOS:', JSON.stringify(grupos));
  R.check(!!grupos && grupos.some((g) => g.tris >= 1),
    'el visor creó el grupo de material de la cara con textura',
    'no aparece grupo texturizado — la asignación no llegó al visor — BUG');

  const g = grupos && grupos[0];
  if (g) {
    R.check(g.vEncaja,
      `la imagen ENCAJA en la cara (V reparte todo [0,1])`,
      `la cara muestra una franja del atlas global: v fuera de [0,1] — BUG de mapeo`);
    R.check(parseFloat(g.corrYV) >= 0.8 && parseFloat(g.corrXU) >= 0.8,
      `orientación DERECHA (corr Y↔V ${g.corrYV}, X↔U ${g.corrXU})`,
      `orientación rota (corr Y↔V ${g.corrYV}, X↔U ${g.corrXU}) — textura boca abajo — BUG`);
  }
} finally {
  await R.resumen({ browser, errores });
}