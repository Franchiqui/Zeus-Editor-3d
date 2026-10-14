// Verificación numérica del botón «Espejo» (lib/espejo.ts): reflexión
// respecto al centro de la caja del eje elegido, winding saliente
// conservado (volumen con signo constante), manifold intacto, atributos
// por cara alineados y UVs espejadas respetando la repetición.
//
// Uso:
//   npx esbuild lib/espejo.ts --bundle --format=esm \
//     --platform=node --outfile=scripts/verificar-3d/.espejo-bundle.mjs
//   node scripts/verificar-3d/verificar-espejo.mjs

import { espejarMesh, espejarObjetoMundo } from './.espejo-bundle.mjs';
import * as THREE from 'three';

let fallos = 0;
const fallo = (msg) => { console.log(`  ✗ ${msg}`); fallos++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const cerca = (a, b, tol) => Math.abs(a - b) <= tol;

/** Volumen con signo (triangulando quads), saliente => positivo. */
function volumen(mesh) {
  let v = 0;
  for (const f of mesh.faces) {
    for (let i = 1; i + 1 < f.length; i++) {
      const A = mesh.vertices[f[0]], B = mesh.vertices[f[i]], C = mesh.vertices[f[i + 1]];
      v += (A.x * (B.y * C.z - C.y * B.z)
        - B.x * (A.y * C.z - C.y * A.z)
        + C.x * (A.y * B.z - B.y * A.z)) / 6;
    }
  }
  return v;
}

/** Manifold cerrado: cada arista sin dirigir la comparten 2 caras. */
function manifoldCerrada(mesh) {
  const usos = new Map();
  for (const f of mesh.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      usos.set(k, (usos.get(k) || 0) + 1);
    }
  }
  for (const n of usos.values()) if (n !== 2) return false;
  return true;
}

// Cubo con esquinas ±1 (centro de caja en el origen) — winding base:
// se comprueba al inicio que su volumen sale positivo.
const ESQ = [];
for (const y of [-1, 1]) for (const z of [-1, 1]) for (const x of [-1, 1])
  ESQ.push({ x, y, z });
// índices 0..7 con x variando más rápido.
if (ESQ[0].x !== -1 || ESQ[7].x !== 1) throw new Error('fixture: orden de vértices inesperado');
const CUBO = [
  { vertices: ESQ, faces: [[1, 3, 2, 0], [6, 7, 5, 4], [4, 5, 1, 0], [3, 7, 6, 2], [5, 7, 3, 1], [2, 6, 4, 0]] },
];
CUBO[0].faceColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];

console.log('═══ Espejo según X ═══');
{
  const original = CUBO[0];
  const vol0 = volumen(original);
  if (vol0 <= 0) fallo(`fixture: el cubo base no sale (vol=${vol0})`);
  else ok(`fixture: cubo con volumen saliente (${vol0.toFixed(3)})`);

  const mx = espejarMesh(original, 'x');
  // Centro de caja x=0 → x' = -x.
  const v1 = mx.vertices[1];
  if (!cerca(v1.x, -ESQ[1].x, 1e-9) || !cerca(v1.y, ESQ[1].y, 1e-9))
    fallo(`x: vértice 1 ({${v1.x},${v1.y}}) ≠ reflejo (${(-ESQ[1].x)},${ESQ[1].y})`);
  else ok('x: cada vértice se refleja respecto al centro (x→-x)');

  const vol1 = volumen(mx);
  if (!cerca(vol1, vol0, 1e-9) || vol1 <= 0)
    fallo(`x: volumen tras espejo ${vol1.toFixed(6)} (≠ ${vol0.toFixed(3)} o <= 0 — winding invertido)`);
  else ok('x: volumen con signo IDÉNTICO y saliente (winding compensado)');
  if (!manifoldCerrada(mx)) fallo('x: manifold rota tras el espejo');
  else ok('x: manifold cerrada intacta');

  // Nº de caras y atributos por cara alineados.
  if (mx.faces.length !== original.faces.length)
    fallo('x: número de caras cambió');
  else if (JSON.stringify(mx.faceColors) !== JSON.stringify(original.faceColors))
    fallo('x: faceColors desalineados tras el espejo');
  else ok('x: caras y colores por cara alineados');

  // La ORIGINAL no debe mutarse (malla nueva, vértices nuevos).
  if (original.vertices[1].x === ESQ[1].x) ok('x: la malla original no muta');
  else fallo('x: ¡la malla original se mutó!');
}

console.log('═══ Espejo según Y y Z (caja DESCENTRADA) ═══');
{
  // Mismos índices que el cubo (x varía más rápido, luego z, luego y).
  const base = {
    vertices: [
      { x: 2, y: 0, z: -4 }, { x: 6, y: 0, z: -4 },
      { x: 2, y: 0, z: 0 }, { x: 6, y: 0, z: 0 },
      { x: 2, y: 3, z: -4 }, { x: 6, y: 3, z: -4 },
      { x: 2, y: 3, z: 0, }, { x: 6, y: 3, z: 0 },
    ],
    faces: [[1, 3, 2, 0], [6, 7, 5, 4], [4, 5, 1, 0], [3, 7, 6, 2], [5, 7, 3, 1], [2, 6, 4, 0]],
  };
  if (volumen(base) <= 0) throw new Error('fixture descentrada: winding base mal');
  const vol0 = volumen(base);
  // Centro x = (2+6)/2 = 4 → x' = 8-x ; z centro = -2 → z' = -4-z.
  const mY = espejarMesh(base, 'y');
  const b00 = mY.vertices[0];
  if (!cerca(b00.y, 3, 1e-9)) fallo(`y: reflejo y (${b00.y}) ≠ 3`);
  else ok('y: refleja y respecto al centro de la caja (0→3)');
  if (mY.vertices[0].x !== base.vertices[0].x || mY.vertices[0].z !== base.vertices[0].z)
    fallo('y: ¡otros ejes cambiaron!');
  else ok('y: los demás ejes intactos');

  const mZ = espejarMesh(base, 'z');
  const z0 = mZ.vertices[0].z;
  if (!cerca(z0, -4 - base.vertices[0].z, 1e-9))
    fallo(`z: reflejo z (${z0}) ≠ esperado (0)`);
  else ok('z: refleja z respecto al centro (-4→0)');
  for (const m of [mY, mZ]) {
    const vol = volumen(m);
    if (!cerca(vol, vol0, 1e-9) || vol <= 0) fallo(`volumen tras espejo ${vol.toFixed(5)} (base ${vol0.toFixed(5)})`);
  }
  if (manifoldCerrada(mY) && manifoldCerrada(mZ))
    ok('y/z: manifold cerrada y volumen saliente en los tres ejes');
}

console.log('═══ UVs espejadas (con repetición) ═══');
{
  const base = {
    vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }],
    faces: [[0, 1, 2, 3]],
    uvs: [[0.4, 0.7]],
  };
  const conRep = {
    ...base,
    uvs: [[0.4, 0.7]],
    textureRepeat: 2,
    textureRepeatY: 3,
  };
  const mx = espejarMesh(conRep, 'x');
  if (!cerca(mx.uvs[0][0], 2 - 0.4, 1e-9) || mx.uvs[0][1] !== 0.7)
    fallo(`x: uv x → (${mx.uvs[0][0]}, ${mx.uvs[0][1]}) ≠ (1.6, 0.7)`);
  else ok('x: uv u = rep - u (repetición respetada)');
  const my = espejarMesh(conRep, 'y');
  if (!cerca(my.uvs[0][1], 3 - 0.7, 1e-9))
    fallo(`y: uv v → ${my.uvs[0][1]} ≠ 2.3`);
  else ok('y: uv v = repY - v');
  const mz = espejarMesh(conRep, 'z');
  if (mz.uvs[0][0] !== 0.4 || mz.uvs[0][1] !== 0.7)
    fallo('z: ¡las UV cambiaron sin eje de mapeo!');
  else ok('z: eje Z no toca las UVs (proyección plana u↔x, v↔y)');
  // Sin uvs: el resultado no los inventa.
  if (espejarMesh({ vertices: base.vertices, faces: base.faces }, 'x').uvs !== undefined)
    fallo('sin uvs: se inventó un mapeo');
  else ok('sin uvs: la malla espejada tampoco lleva uvs');
}

console.log('═══ Espejo EN MUNDO (crear objeto nuevo) ═══');
{
  // El BUG del usuario: cubo inclinado 45° — el espejo LOCAL daba la MISMA
  // figura (parecía copia). El espejo en MUNDO debe reflejar la inclinación.
  const ang = Math.PI / 4;
  const transform = {
    px: 3, py: 1, pz: -2,
    rx: 0, ry: 0, rz: ang,
    sx: 1, sy: 1, sz: 1,
  };
  const T = new THREE.Matrix4().compose(
    new THREE.Vector3(3, 1, -2),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, ang)),
    new THREE.Vector3(1, 1, 1)
  );
  const mundoDe = (m) =>
    m.vertices.map(
      (v) => new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(T)
    );

  const base = { vertices: ESQ.map((v) => ({ ...v })), faces: CUBO[0].faces };
  const mundo0 = mundoDe(base);

  // La inclinación de partida: un vértice del cubo girado.
  const mLocal = espejarMesh(base, 'x');
  // Comparar como FIGURA (nube ordenada), no por índice: el volteo local
  // permuta los vértices y el cubo simétrico vuelve a caer sobre sí mismo.
  const nube = (ws) =>
    ws.map((w) => [w.x, w.y, w.z])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const nubeA = nube(mundoDe(mLocal));
  const nubeB = nube(mundo0);
  const mismaFigura = nubeA.every(
    (w, i) => Math.abs(w[0] - nubeB[i][0]) < 1e-9 && Math.abs(w[1] - nubeB[i][1]) < 1e-9
  );
  if (mismaFigura)
    ok('contraste: el espejo LOCAL del cubo inclinado da la MISMA figura (el bug)');
  else fallo('contraste: el cubo inclinado sí cambia con espejo local (contraste invalido)');

  const res = espejarObjetoMundo(base, transform, 'x');
  // El gemelo: transform con pivote en el centro de su caja y SIN giro.
  if (res.transform.rx !== 0 || res.transform.ry !== 0 || res.transform.rz !== 0)
    fallo(`gemelo con giro (${res.transform.rz}) — debía quedar horneado`);
  else ok('gemelo con rotación a CERO (inclinación horneada en la malla)');
  const esperadoPivote = new THREE.Vector3(
    Math.min(...mundo0.map((w) => w.x)) + Math.max(...mundo0.map((w) => w.x)),
    Math.min(...mundo0.map((w) => w.y)) + Math.max(...mundo0.map((w) => w.y)),
    Math.min(...mundo0.map((w) => w.z)) + Math.max(...mundo0.map((w) => w.z))
  ).multiplyScalar(0.5);
  if (
    !cerca(res.transform.px, esperadoPivote.x, 1e-9) ||
    !cerca(res.transform.py, esperadoPivote.y, 1e-9) ||
    !cerca(res.transform.pz, esperadoPivote.z, 1e-9)
  )
    fallo('gemelo con pivote ≠ centro de la caja mundial');
  else ok(`gemelo con pivote en el centro de la caja (${esperadoPivote.toArray().map((n) => n.toFixed(2)).join(', ')})`);

  // INDEPENDIENTE: el gemelo en mundo debe ser el REFLEJO del original
  // respecto al plano x = centro (composición de matrices, otro camino).
  const Tm = new THREE.Matrix4().compose(
    new THREE.Vector3(res.transform.px, res.transform.py, res.transform.pz),
    new THREE.Quaternion(),
    new THREE.Vector3(res.transform.sx, res.transform.sy, res.transform.sz)
  );
  // M_x(c): x' = 2c - x  ==  Trans(c)·Diag(-1,1,1)·Trans(-c)
  const Mx_c = new THREE.Matrix4()
    .makeTranslation(esperadoPivote.x, esperadoPivote.y, esperadoPivote.z)
    .multiply(new THREE.Matrix4().makeScale(-1, 1, 1))
    .multiply(
      new THREE.Matrix4().makeTranslation(
        -esperadoPivote.x, -esperadoPivote.y, -esperadoPivote.z
      )
    );
  const esperado = mundo0.map((w) => w.clone().applyMatrix4(Mx_c));
  const twinMundo = res.mesh.vertices.map(
    (v) =>
      new THREE.Vector3(
        v.x * res.transform.sx,
        v.y * res.transform.sy,
        v.z * res.transform.sz
      )
        .applyQuaternion(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(res.transform.rx, res.transform.ry, res.transform.rz)
          )
        )
        .add(
          new THREE.Vector3(
            res.transform.px, res.transform.py, res.transform.pz
          )
        )
  );
  const peor = Math.max(
    ...esperado.map((w, i) => w.distanceTo(twinMundo[i] ?? new THREE.Vector3()))
  );
  if (peor > 1e-9) fallo(`gemelo en mundo ≠ reflejo del original (peor err ${peor.toExponential(2)})`);
  else ok('gemelo en mundo = REFLEJO EXACTO del original (eje de la vista, con inclinación)');
  if (twinMundo.every((w, i) => w.distanceTo(mundo0[i]) < 1e-9))
    fallo('el gemelo en mundo es IGUAL al original — no refeja nada');
  else ok('el gemelo en mundo es DISTINTO del original (deja de parecer copia)');

  if (!manifoldCerrada(res.mesh)) fallo('mundo: manifold rota tras el espejo');
  else ok('mundo: manifold cerrada intacta');
  if (volumen(res.mesh) <= 0) fallo('mundo: volumen negativo (winding sin compensar)');
  else ok('mundo: volumen saliente (caras recorridas al revés)');

  // Sin giro: el espejo en mundo COINCIDE con el local (regresión).
  const recto = espejarObjetoMundo(base, { sx: 1, sy: 1, sz: 1 }, 'x');
  const conLocal = espejarMesh(base, 'x');
  const igualLocal = recto.mesh.vertices.every(
    (v, i) =>
      Math.abs(v.x - conLocal.vertices[i].x) < 1e-9 &&
      Math.abs(v.y - conLocal.vertices[i].y) < 1e-9 &&
      Math.abs(v.z - conLocal.vertices[i].z) < 1e-9
  );
  if (!igualLocal) fallo('objeto sin girar: el espejo en mundo ≠ espejo local');
  else ok('objeto sin girar: espejo en mundo ≡ espejo local (sin cambio de conducta)');

  // Escala por eje + giro: la regla T·R·S también debe reflejar exacto.
  const esc = { ...transform, sx: 2, sy: 0.5 };
  const TE = new THREE.Matrix4().compose(
    new THREE.Vector3(3, 1, -2),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, ang)),
    new THREE.Vector3(2, 0.5, 1)
  );
  const mundoEsc = base.vertices.map(
    (v) => new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(TE)
  );
  const cxEsc = (Math.min(...mundoEsc.map((w) => w.x)) + Math.max(...mundoEsc.map((w) => w.x))) / 2;
  const resEsc = espejarObjetoMundo(base, esc, 'x');
  const twinEsc = resEsc.mesh.vertices.map(
    (v) =>
      new THREE.Vector3(
        v.x * resEsc.transform.sx,
        v.y * resEsc.transform.sy,
        v.z * resEsc.transform.sz
      ).applyQuaternion(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(resEsc.transform.rx, resEsc.transform.ry, resEsc.transform.rz)
        )
      ).add(
        new THREE.Vector3(resEsc.transform.px, resEsc.transform.py, resEsc.transform.pz)
      )
  );
  const peorEsc = Math.max(...mundoEsc.map((w, i) =>
    Math.abs(2 * cxEsc - w.x - twinEsc[i].x) +
    Math.abs(w.y - twinEsc[i].y) + Math.abs(w.z - twinEsc[i].z)
  ));
  if (peorEsc > 1e-9) fallo(`escala+giro: reflejo mal (peor err ${peorEsc.toExponential(2)})`);
  else ok('escala por eje + giro: reflejo exacto también');
}

console.log('═══ Degenerados ═══');
{
  const vacio = espejarMesh({ vertices: [], faces: [] }, 'x');
  if (vacio.vertices.length !== 0) fallo('malla vacía no se conserva vacía');
  else ok('malla vacía → vacía (sin romper)');
  const cara = espejarMesh({ vertices: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], faces: [[0, 1]] }, 'x');
  if (cara.faces[0][0] !== 0 || cara.faces[0][1] !== 1) fallo('cara degenerada (<3) tocada');
  else ok('cara degenerada (<3 vértices) sin invertir');
}

console.log(fallos === 0 ? '\n✔ Todos los checks en verde' : `\n✗ ${fallos} checks en rojo`);
process.exit(fallos === 0 ? 0 : 1);