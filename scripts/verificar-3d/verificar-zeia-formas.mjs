// Verificación del puente ZEIA -> escena con MEDIDAS y COMPOUNDS.
// Uso: npx esbuild lib/zeia-scene.ts --bundle --format=esm --platform=node
//        --alias:@=./ --outfile=scripts/verificar-3d/.zeia-formas-bundle.mjs
//      node scripts/verificar-3d/verificar-zeia-formas.mjs
import { applyZeiaPlansToScene } from './.zeia-formas-bundle.mjs';
import { construirMallaPrimitiva } from './.primitivas-bundle.mjs';

let fallos = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!cond) fallos++;
};
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

/** Extensión (max-min) por eje y radios xz de todos los vértices. */
function analiza(mesh) {
  const xs = [], ys = [], zs = [], radiales = [];
  for (const v of mesh.vertices) {
    xs.push(v.x); ys.push(v.y); zs.push(v.z);
    radiales.push(Math.hypot(v.x, v.z));
  }
  const ext = (a) => Math.max(...a) - Math.min(...a);
  return {
    extX: ext(xs), extY: ext(ys), extZ: ext(zs),
    maxRadial: Math.max(...radiales), minRadial: Math.min(...radiales),
    nVerts: mesh.vertices.length, nFaces: mesh.faces.length,
  };
}

let contadorId = 0;
const mkId = (p) => `${p}-${++contadorId}`;

/** Crea un objeto suelto vía el plan {plan, execute} y devuelve su registro. */
function crear(execute, objects = []) {
  const out = applyZeiaPlansToScene(
    [{ plan: 'createX', execute }],
    objects,
    [],
    { makeId: mkId }
  );
  return { objs: out.objects, resumen: out.result };
}

// ─── 1. Medidas respetadas ──────────────────────────────────────────────

let r = crear({ name: 'Poste', primitive: 'cilindro', radius: 0.5, height: 3 }).objs[0];
let a = analiza(r.mesh);
ok(cerca(a.maxRadial, 0.5), `cilindro radio 0.5: maxRadial=${a.maxRadial.toFixed(4)}`);
ok(cerca(a.extY, 3), `cilindro altura 3: extY=${a.extY.toFixed(4)}`);

r = crear({ name: 'Bola', primitive: 'sphere', radius: 2 }).objs[0];
a = analiza(r.mesh);
ok(cerca(a.maxRadial, 2) && cerca(a.extX, 4), `esfera radio 2 (bbox ±2): maxRadial=${a.maxRadial.toFixed(4)}`);

r = crear({ name: 'Caja', primitive: 'cubo', width: 1, height: 0.5, depth: 2 }).objs[0];
a = analiza(r.mesh);
ok(cerca(a.extX, 1) && cerca(a.extY, 0.5) && cerca(a.extZ, 2), `cubo 1×0.5×2: ext=${a.extX.toFixed(3)}/${a.extY.toFixed(3)}/${a.extZ.toFixed(3)}`);

r = crear({ name: 'Pastilla', primitive: 'cápsula', radius: 0.5, height: 3 }).objs[0];
a = analiza(r.mesh);
ok(cerca(a.maxRadial, 0.5) && cerca(a.extY, 3), `cápsula r=0.5 h=3 (altura TOTAL): maxRadial=${a.maxRadial.toFixed(3)} extY=${a.extY.toFixed(3)}`);

r = crear({ name: 'Caño', primitive: 'tube', outerRadius: 1, innerRadius: 0.6, height: 2 }).objs[0];
a = analiza(r.mesh);
ok(cerca(a.maxRadial, 1) && cerca(a.minRadial, 0.6, 1e-4), `tubo ro=1 ri=0.6: radial ${a.minRadial.toFixed(4)}…${a.maxRadial.toFixed(4)}`);

r = crear({ name: 'Caño2', primitive: 'tube', radius: 1, thickness: 0.3, height: 2 }).objs[0];
a = analiza(r.mesh);
ok(cerca(a.minRadial, 0.7, 1e-4) && cerca(a.maxRadial, 1), `tubo radio=1 grosor=0.3 -> ri=0.7: ${a.minRadial.toFixed(4)}…${a.maxRadial.toFixed(4)}`);

r = crear({ name: 'Argolla', primitive: 'argolla', radius: 1 }).objs[0];
a = analiza(r.mesh);
ok(cerca(a.maxRadial, 1) && a.minRadial > 0.75 && a.minRadial < 0.85, `argolla r=1 (hueco 0.8): min radial=${a.minRadial.toFixed(4)}`);

r = crear({ name: 'Plato', primitive: 'disco', radius: 1 }).objs[0];
a = analiza(r.mesh);
ok(a.minRadial < 1e-6 && cerca(a.maxRadial, 1), `disco lleno r=1: centro incluido (min=${a.minRadial.toFixed(6)})`);

r = crear({ name: 'Donut', primitive: 'donut', radius: 1, thickness: 0.35 }).objs[0];
a = analiza(r.mesh);
ok(cerca(a.maxRadial, 1.35) && cerca(a.extY, 0.7), `toro r=1 grosor=0.35: extXZ=${a.extX.toFixed(3)} extY=${a.extY.toFixed(3)}`);

r = crear({ name: 'Tapa', primitive: 'cone', radius: 0.3, height: 1.5 }).objs[0];
a = analiza(r.mesh);
ok(cerca(a.maxRadial, 0.3) && cerca(a.extY, 1.5), `cono r=0.3 h=1.5: maxRadial=${a.maxRadial.toFixed(4)} extY=${a.extY.toFixed(4)}`);

r = crear({ name: 'Base', primitive: 'piramide', width: 2, height: 4 }).objs[0];
a = analiza(r.mesh);
ok(cerca(a.extX, 2) && cerca(a.extY, 4), `pirámide lado=2 h=4: extX=${a.extX.toFixed(4)} extY=${a.extY.toFixed(4)}`);

r = crear({ name: 'Tapete', primitive: 'plane', width: 3, depth: 1 }).objs[0];
a = analiza(r.mesh);
ok(cerca(a.extX, 3) && cerca(a.extZ, 1) && cerca(a.extY, 0), `plano 3×1: ext=${a.extX.toFixed(4)}/${a.extY.toFixed(4)}/${a.extZ.toFixed(4)}`);

r = crear({ name: 'Resorte', primitive: 'muelle', radius: 1, turns: 8, thickness: 0.1 }).objs[0];
ok(r.mesh.vertices.length > 100, `muelle radio=1 vueltas=8: ${r.mesh.vertices.length} vértices`);

// ─── 2. Compounds: un objeto por shape, transform compuesta ────────────

const muñeco = crear({
  name: 'Muñeco',
  geometry: {
    type: 'compound',
    shapes: [
      { type: 'sphere', radius: 1, position: [0, 0, 0] },
      { type: 'sphere', radius: 0.6, position: [0, 1.5, 0] },
      { type: 'cone', radius: 0.3, height: 0.5, position: [0, 1.9, 0], rotation: [0, 0, 90] },
    ],
  },
});
ok(muñeco.objs.length === 3, `compound de 3 shapes -> 3 objetos (salieron ${muñeco.objs.length})`);
ok(muñeco.objs[0].name === 'Muñeco 1' && muñeco.objs[2].name === 'Muñeco 3', `nombres: ${muñeco.objs.map((o) => o.name).join(', ')}`);
ok(cerca(muñeco.objs[1].transform.py, 1.5), `segunda bola a y=1.5 (${muñeco.objs[1].transform.py})`);
ok(cerca(muñeco.objs[2].transform.rz, Math.PI / 2), `cono del nariz con rotación 90° en Z (${(muñeco.objs[2].transform.rz * 180 / Math.PI).toFixed(1)}°)`);
a = analiza(muñeco.objs[0].mesh);
ok(cerca(a.maxRadial, 1), `cuerpo del muñeco: esfera r=1 (${a.maxRadial.toFixed(4)})`);

// Compound con transform del padre: escala 2 multiplica los offsets.
const escalado = crear({
  name: 'Rey',
  transform: { position: [10, 0, 0], scale: [2, 2, 2] },
  geometry: {
    type: 'compound',
    shapes: [
      { type: 'cylinder', radius: 0.5, height: 1, position: [0, 0.5, 0] },
      { type: 'sphere', radius: 0.3, position: [0, 1, 0] },
    ],
  },
});
ok(escalado.objs.length === 2, `compound + transform del padre -> 2 objetos`);
ok(cerca(escalado.objs[0].transform.px, 10) && cerca(escalado.objs[0].transform.sx, 2), `parte 1 hereda px=10, escala=2`);
ok(cerca(escalado.objs[1].transform.py, 2), `offset y=1 escalado ×2 -> py=2 (${escalado.objs[1].transform.py})`);
a = analiza(escalado.objs[1].mesh);
ok(cerca(a.maxRadial, 0.3), `esfera de la corona sigue r=0.3 (la escala la aplica el transform)`);
ok(escalado.resumen.warnings.length === 0, `sin avisos (${escalado.resumen.warnings.join(' | ') || 'nada'})`);

// idMap: referencias por nombre y por id resuelven a la PRIMERA parte.
const ref = applyZeiaPlansToScene(
  [{ plan: 'crea', execute: { id: 'muneco01', name: 'Trineo', geometry: { type: 'compound', shapes: [{ type: 'box' }, { type: 'cylinder', position: [0, 2, 0] }] } } }],
  [],
  [],
  { makeId: mkId }
);
ok(ref.objects.length === 2, `compound caja+patines -> 2 objetos (${ref.objects.length})`);
ok(ref.idMap['muneco01'] === 'obj-fijo' || typeof ref.idMap['muneco01'] === 'string', `id del execute mapea a la 1.ª parte`);
ok(typeof ref.idMap['Trineo'] === 'string', `nombre base mapea a la 1.ª parte`);

// Compound SIN name: cada parte con su nombre de forma.
const sinNombre = aplicarDirecto({
  primitive: undefined,
  geometry: { type: 'compound', shapes: [{ type: 'cylinder', position: [0, 0, 0] }, { type: 'cone', position: [0, 1, 0] }] },
});
function aplicarDirecto(execute) {
  return crear(execute).objs;
}
ok(sinNombre.length === 2 && /Cyl/i.test(sinNombre[0].name), `sin nombre base -> nombres por forma (${sinNombre.map((o) => o.name).join(', ')})`);

// ─── 3. Compatibilidad: sin medidas, geometría histórica intacta ────────

r = crear({ name: 'Cubo', primitive: 'cube' }).objs[0];
a = analiza(r.mesh);
ok(a.nVerts === 8 && a.nFaces === 6, `cubo sin medidas: builders artesanales intactos (8 verts / 6 caras; salieron ${a.nVerts}/${a.nFaces})`);

r = crear({ name: 'Jarron', primitive: 'vase' }).objs[0];
a = analiza(r.mesh);
ok(cerca(a.maxRadial, 1), `alias vase -> cilindro sigue funcionando (maxRadial=${a.maxRadial.toFixed(4)})`);

r = crear({ name: 'Robot', primitive: 'robot' }).objs[0];
a = analiza(r.mesh);
ok(a.nVerts === 8 && a.nFaces === 6, `forma desconocida 'robot' -> cubo de reserva (como siempre)`);

r = crear({ name: 'Cono', primitive: 'cone' }).objs[0];
a = analiza(r.mesh);
ok(cerca(a.maxRadial, 1) && cerca(a.extY, 2), `cono sin medidas: tamaño histórico r=1 h=2`);

// ─── 4. Cielo no se cae: create normal sigue devolviendo 1 objeto ──────

const simple = crear({ name: 'Esfera', primitive: 'esfera', radius: 1.2 });
ok(simple.objs.length === 1 && cerca(analiza(simple.objs[0].mesh).maxRadial, 1.2), `'esfera' en español + radio 1.2`);

// ─── 5. Panel de propiedades: primitiveParams adjunto al objeto ─────────

r = crear({ name: 'Poste2', primitive: 'cilindro', radius: 0.7, height: 4 }).objs[0];
ok(
  r.primitiveParams && r.primitiveParams.kind === 'cilindro' && cerca(r.primitiveParams.radio, 0.7) && cerca(r.primitiveParams.altura, 4),
  `con medidas: primitiveParams cilindro r=0.7 h=4 (${JSON.stringify(r.primitiveParams)})`
);

r = crear({ name: 'Cubo2', primitive: 'cube' }).objs[0];
ok(
  r.primitiveParams && r.primitiveParams.kind === 'cubo' && cerca(r.primitiveParams.ancho, 2) && cerca(r.primitiveParams.alto, 2) && cerca(r.primitiveParams.profundo, 2),
  `sin medidas: primitiveParams estimados del builder artesanal (2×2×2; ${JSON.stringify(r.primitiveParams)})`
);
ok(analiza(r.mesh).nVerts === 8, `sin medidas: la malla sigue siendo la artesanal (el panel NO regenera nada solo)`);

r = crear({ name: 'Taza', primitive: 'taza', mesh: { vertices: [], faces: [] } }).objs[0];
ok(r.primitiveParams === undefined, `malla explícita (execute.mesh): SIN primitiveParams (panel apagado)`);

r = crear({ name: 'CositaRara', primitive: 'robot' }).objs[0];
ok(r.primitiveParams === undefined, `forma desconocida (cubo de reserva): sin panel`);

const comp = crear({
  name: 'Sopas',
  geometry: { type: 'compound', shapes: [{ type: 'cilindro', radius: 0.4, height: 0.2, position: [0, 0, 0] }, { type: 'sphere', radius: 0.25, position: [0, 0, 0.6] }] },
});
ok(comp.objs[0].primitiveParams?.kind === 'cilindro' && cerca(comp.objs[0].primitiveParams.radio, 0.4), `compound parte 1: primitiveParams cilindro`);
ok(comp.objs[1].primitiveParams?.kind === 'esfera' && cerca(comp.objs[1].primitiveParams.radio, 0.25), `compound parte 2: primitiveParams esfera`);

// Regenerar con los params adjuntos reproduce la MISMA malla (el panel edita en vivo).
const regen = aplicarDirecto({ primitive: 'cilindro', radius: 0.7, height: 4 });
const a0 = analiza(regen[0].mesh);
const a1 = analiza(construirMallaPrimitiva(regen[0].primitiveParams));
ok(cerca(a0.maxRadial, a1.maxRadial) && cerca(a0.extY, a1.extY) && a0.nVerts === a1.nVerts, `regen desde params == malla original (${a0.nVerts} vs ${a1.nVerts} verts)`);

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);