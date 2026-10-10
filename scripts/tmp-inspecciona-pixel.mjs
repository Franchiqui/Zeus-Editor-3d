/** TEMPORAL (diagnóstico): muestrea colores de las capturas e2e/.repro/e*.png
 *  en una rejilla de puntos sobre el cubo, para distinguir dedede vs blanco
 *  puro vs cian. Uso: node scripts/tmp-inspecciona-pixel.mjs */
import { inflateSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';

function decodifica(buf) {
  let off = 8;
  let width = 0, height = 0, colorType = 0;
  const idats = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('ascii');
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') idats.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idats));
  const img = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const s = y * (stride + 1) + 1;
    const d = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? img[d + x - bpp] : 0;
      const b = y > 0 ? img[d - stride + x] : 0;
      const c = y > 0 && x >= bpp ? img[d - stride + x - bpp] : 0;
      let val = raw[s + x];
      if (f === 1) val = (val + a) & 0xff;
      else if (f === 2) val = (val + b) & 0xff;
      else if (f === 3) val = (val + ((a + b) >> 1)) & 0xff;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        val = (val + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      img[d + x] = val;
    }
  }
  return { width, height, bpp, img, stride };
}

const pixel = (d, fx, fy) => {
  const o = (Math.floor(d.height * fy) * d.stride) + Math.floor(d.width * fx) * d.bpp;
  return [d.img[o], d.img[o + 1], d.img[o + 2]];
};
const etiqueta = ([r, g, b]) =>
  r > 200 && g > 200 && b > 200 ? `blanco puro` :
  r > 200 && g < 210 && Math.abs(g - b) < 40 && g > 180 ? `dedede-ish` :
  g > 150 && r < 120 && b < 120 ? `cian` :
  r > 130 && g < 100 && b < 100 ? `rojo` :
  g > 130 && r < 100 && b < 100 ? `verde` : `otro ${r},${g},${b}`;

const dir = 'e2e/.repro';
for (const nombre of readdirSync(dir).filter((f) => f.startsWith('e') && f.endsWith('.png')).sort()) {
  const d = decodifica(readFileSync(`${dir}/${nombre}`));
  // Rejilla: alrededor de (0.42,0.42), el cuadrado del cubo centrado.
  const puntos = [0.38, 0.42, 0.46, 0.50].map((fx) => [fx, 0.40].map !== undefined ? [fx, 0.40] : null);
  const muestras = [];
  for (const fx of [0.36, 0.40, 0.44, 0.48]) {
    for (const fy of [0.36, 0.40, 0.44]) {
      muestras.push(etiqueta(pixel(d, fx, fy)));
    }
  }
  const conteo = {};
  for (const m of muestras) conteo[m] = (conteo[m] ?? 0) + 1;
  console.log(nombre, JSON.stringify(conteo));
}