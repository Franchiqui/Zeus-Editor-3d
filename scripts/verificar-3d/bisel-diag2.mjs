/**
 * Diagnóstico 2 del bisel: aristas FRONTERA (usadas 1 vez = hueco) en la
 * malla chafeada, y una mirada detallada a la esquina (+,+,+) del cubo.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const raiz = path.resolve(import.meta.dirname, '../..');
const { aplicarDeformador } = require(
  path.join(raiz, 'scripts/verificar-3d/deform-bundle.cjs')
);

function cargaMalla(nombre) {
  const doc = JSON.parse(
    readFileSync(path.join(raiz, 'public/Obj-3D', nombre), 'utf8')
  );
  return doc.sceneObjects?.[0]?.mesh ?? null;
}

for (const archivo of ['Cubo.zeus', 'Cilindro.zeus']) {
  const m = cargaMalla(archivo);
  const s = aplicarDeformador('bisel', m, { radio: 10 });
  const clave = (v) => `${Math.round(v.x * 1e5)}|${Math.round(v.y * 1e5)}|${Math.round(v.z * 1e5)}`;
  // Aristas canon de la SALIDA:
  const uso = new Map();
  for (const f of s.faces) {
    const cs = f.map((vi) => clave(s.vertices[vi]));
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      const b = cs[(i + 1) % cs.length];
      if (a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      uso.set(k, (uso.get(k) || 0) + 1);
    }
  }
  let frontera = 0;
  let triple = 0;
  for (const n of uso.values()) {
    if (n === 1) frontera++;
    else if (n > 2) triple++;
  }
  console.log(`\n== ${archivo}: salida ${s.vertices.length}v/${s.faces.length}f`);
  console.log(`  aristas canon: ${uso.size} · frontera(1 uso): ${frontera} · >2 usos: ${triple}`);

  if (archivo === 'Cubo.zeus') {
    // Detalle de la esquina superior (+1,+1,+1):
    const esPos = (v, e) => Math.abs(v - e) < 1e-5;
    const idx = [];
    for (let i = 0; i < s.vertices.length; i++) {
      const v = s.vertices[i];
      if (esPos(v.x, 1) && esPos(v.y, 1) && esPos(v.z, 1)) idx.push(i);
    }
    console.log(`  esquina (1,1,1): ${idx.length} copias del hub original`);
    // Caras que tocan esa esquina:
    const caras = s.faces.filter((f) => f.some((vi) => idx.includes(vi)));
    console.log(`  caras que la tocan: ${caras.length}`);
    for (const f of caras.slice(0, 12)) {
      console.log('    car:', f.map((vi) => `[${s.vertices[vi].x.toFixed(3)},${s.vertices[vi].y.toFixed(3)},${s.vertices[vi].z.toFixed(3)}]`).join(' '));
    }
    // Los insets alrededor: posiciones distintas cerca de la esquina:
    const cerca = [];
    for (let i = 0; i < s.vertices.length; i++) {
      const v = s.vertices[i];
      const d = Math.hypot(v.x - 1, v.y - 1, v.z - 1);
      if (d < 0.25 && d > 1e-6) cerca.push([i, v]);
    }
    console.log(`  vértices cerca de la esquina (0<d<0.25): ${cerca.length}`);
    for (const [i, v] of cerca) console.log(`    v${i}: (${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`);
  }
}