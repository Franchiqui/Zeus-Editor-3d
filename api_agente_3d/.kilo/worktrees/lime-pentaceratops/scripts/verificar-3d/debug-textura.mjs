/**
 * DEBUG-TEXTURA v5 — ¿se aplica la textura al mesh? ¿la quita el botón?
 * Vuelca mesh.texture (largo) y marca texturePanela tras cada paso.
 */
import { abrirEditor, esperar } from './comun.mjs';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const { browser, page } = await abrirEditor();

/** PNG 64x64 con damero rojo/azul. */
function pngDamasco() {
  const w = 64, h = 64;
  const cruda = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const fila = y * (w * 4 + 1);
    cruda[fila] = 0;
    for (let x = 0; x < w; x++) {
      const celda = ((x >> 3) + (y >> 3)) % 2 === 0;
      const o = fila + 1 + x * 4;
      cruda[o] = celda ? 230 : 20;
      cruda[o + 1] = celda ? 30 : 20;
      cruda[o + 2] = celda ? 30 : 230;
      cruda[o + 3] = 255;
    }
  }
  const crcTabla = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const trozo = (tipo, datos) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crcTabla(cuerpo));
    return Buffer.concat([len, cuerpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(cruda)),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

const RUTA_PNG = 'scripts/verificar-3d/temp-textura.png';
writeFileSync(RUTA_PNG, pngDamasco());

/** Textura de cada objeto de la escena (por el fiber). */
async function texturas(etiqueta) {
  const d = await page.evaluate(() => {
    const cont = document.querySelectorAll('[data-testid="viewer-container"]')[0];
    const llave = Object.keys(cont).find((k) => k.startsWith('__reactFiber'));
    if (!llave) return null;
    const visit = (fib, prof) => {
      if (!fib || prof > 60) return null;
      const p = fib.memoizedProps;
      if (p && Array.isArray(p.sceneObjects)) {
        return p.sceneObjects.map((o) => ({
          id: o.id?.slice(-6),
          tex: o.mesh?.texture ? o.mesh.texture.length : null,
          panela: o.mesh?.texturePanela ?? false,
          original: o.mesh?.textureOriginal ? o.mesh.textureOriginal.length : null,
        }));
      }
      return visit(fib.child, prof + 1) ?? visit(fib.sibling, prof + 1);
    };
    for (let f = cont[llave]; f; f = f.return) {
      const r = visit(f, 0);
      if (r) return r;
    }
    return null;
  });
  console.log(`${etiqueta}: ${JSON.stringify(d)}`);
}

/** Firma hash de la ventana frontal (para comparar renders). */
async function firma(etiqueta) {
  const f = await page.evaluate(() => {
    const conts = document.querySelectorAll('[data-testid="viewer-container"]');
    const canvas = conts[0] && conts[0].querySelector('canvas');
    if (!canvas) return null;
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 4) {
      h ^= d[i] | (d[i + 1] << 8) | (d[i + 2] << 16);
      h = (h * 16777619) >>> 0;
    }
    return f = h;
  });
  console.log(`${etiqueta}: firma=${f}`);
}

try {
  await page.click('[data-testid="tab-text"]');
  await page.fill('[data-testid="text-input"]', 'A');
  await esperar(1500);
  await page.click('[data-testid="tab-scene"]');
  await esperar(900);
  await page.locator('[data-testid="scene-object-0"]').click();
  await esperar(800);
  await texturas('figura recién creada (textura horneada, sin marca)');
  await firma('antes de quitar la horneada');
  await page.click('[data-testid="scene-texture-remove"]');
  await esperar(1200);
  await texturas('tras quitar la horneada (tex debe ser null)');
  await firma('tras quitar (firma debe cambiar)');

  // Caso nuevo: textura del panel → quitar → vuelve la horneada.
  await page.setInputFiles('[data-testid="scene-texture-file-input"]', RUTA_PNG);
  await esperar(1500);
  await texturas('textura del panel aplicada (panela=true)');
  await page.click('[data-testid="scene-texture-remove"]');
  await esperar(1200);
  await texturas('tras quitar la del panel (vuelve la horneada)');
} finally {
  await browser.close();
}