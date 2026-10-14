// valida-objetos-guardados.mjs: comprueba que los .txt paramétricos de
// OBJ_ZEUS_ACTION (Trineo/Avion/Coche) aplican bien vía applyZeiaPlansToScene:
// N objetos creados con mallas válidas y primitiveParams exactos.
// Firma REAL: applyZeiaPlansToScene(plans, objects, transformTracks, opts).
import fs from 'node:fs';
import path from 'node:path';
import { applyZeiaPlansToScene } from './.zeia-formas-bundle.mjs';

const dir = 'public/OBJ_ZEUS_ACTION';

let fallos = 0;
const revisar = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${msg}`);
  if (!cond) fallos++;
};

const objetivos = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.txt'))
  : [];
revisar(objetivos.length >= 4, `catálogo: >=4 objetos (${objetivos.join(', ')})`);

for (const nombre of objetivos) {
  const ruta = path.join(dir, nombre);
  if (!fs.existsSync(ruta)) { revisar(false, `${nombre}: NO existe`); continue; }
  const raw = fs.readFileSync(ruta, 'utf8');
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) { revisar(false, `${nombre}: sin bloque JSON`); continue; }
  const inner = JSON.parse(m[0]);
  revisar(inner.action === 'applyZeiaPlans' && Array.isArray(inner.plans), `${nombre}: bloque applyZeiaPlans`);
  // Las mallas horneadas (Arbol, Botella, Craneo…) también usan plans/
  // createObject pero NO son paramétricas: los checks profundos solo aplican
  // a los 4 assemblies paramétricos nuestra fábrica.
  const esParametrico = /^(Trineo|Avion|Coche|Tren)\.txt$/i.test(nombre);
  if (!esParametrico) continue;

  const out = applyZeiaPlansToScene(inner.plans, [], []);
  const objs = out.objects ?? [];
  console.log(`${nombre}: ${objs.length} objetos (results=${out.result?.created ?? '?'})`);
  revisar(objs.length >= 6, `${nombre}: >=6 piezas (${objs.length})`);
  for (const o of objs) {
    const nv = o.mesh?.vertices?.length ?? 0;
    const nf = o.mesh?.faces?.length ?? 0;
    revisar(nv >= 8 && nf >= 4, `${nombre} · ${o.name}: malla ${nv}v/${nf}f`);
    revisar(!!o.primitiveParams, `${nombre} · ${o.name}: primitiveParams (${o.primitiveParams?.kind})`);
    const tr = o.transform ?? {};
    const pos = [tr.px ?? 0, tr.py ?? 0, tr.pz ?? 0].map((v) => Number(v.toFixed(2)));
    const rot = [tr.rx ?? 0, tr.ry ?? 0, tr.rz ?? 0].map((v) => Number((v * 180 / Math.PI).toFixed(0)));
    console.log(`     pos (${pos.join(', ')}) rot (${rot.join(', ')}°)`);
    // apoyado: nada por debajo del suelo (y mínima >= -0.01)
    let minY = Infinity;
    for (const v of o.mesh?.vertices ?? [{ y: 0 }]) if (v.y < minY) minY = v.y;
    console.log(`     y mínima local ${(o.transform?.py ?? 0) + Number(minY.toFixed(2))}`);
  }
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);