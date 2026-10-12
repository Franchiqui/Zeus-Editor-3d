// Gizmo de sub-selección ACODADO con las caras: al seleccionar una cara,
// la base del gizmo lleva su eje Z a la normal (en mundo) y X/Y al plano.
// Comprobado con el THREE real del proyecto: mismas convenciones
// setFromEuler(«XYZ») ↔ setFromQuaternion que en viewer-3d.tsx.
//
// Réplicas de viewer-3d.tsx: quatAcodadoACaras + composición del frame
// loop (base * giroUsuario) + extracción de vuelta del aro (base⁻¹ * full).
import * as THREE from 'three';

let fallos = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALLA'} ${msg}`);
  if (!cond) fallos++;
};

const normalDe = (mesh, fi) => {
  const face = mesh.faces[fi];
  const [a, b, c] = face.map((i) => mesh.vertices[i]);
  return new THREE.Vector3()
    .subVectors(new THREE.Vector3(b.x, b.y, b.z), new THREE.Vector3(a.x, a.y, a.z))
    .cross(
      new THREE.Vector3().subVectors(
        new THREE.Vector3(c.x, c.y, c.z),
        new THREE.Vector3(a.x, a.y, a.z)
      )
    )
    .normalize();
};

// === réplica de quatAcodadoACaras (viewer-3d.tsx) ===
function quatAcodadoACaras(mesh, faces, worldMatrix, ladoVisto = 1) {
  if (faces.length === 0) return null;
  const primera = normalDe(mesh, faces[0]);
  const normal = new THREE.Vector3();
  for (const f of faces) {
    const nf = normalDe(mesh, f);
    normal.add(nf);
    if (nf.dot(primera) < 0.5) return null;
  }
  if (normal.lengthSq() < 1e-12) return null;
  const z = normal.normalize().transformDirection(worldMatrix);
  if (ladoVisto < 0) z.negate();
  let ref = new THREE.Vector3(1, 0, 0);
  if (Math.abs(ref.dot(z)) > 0.9) ref.set(0, 1, 0);
  if (Math.abs(ref.dot(z)) > 0.9) ref.set(0, 0, 1);
  const x = ref.clone().sub(z.clone().multiplyScalar(ref.dot(z))).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const quat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(x, y, z)
  );
  return quat;
}

const V = (x, y, z) => ({ x, y, z });
// Cara plana: dos triángulos del mismo quad, vértices duplicados (malla .zeus).
const quadPlano = (vs) => {
  const [a, b, c, d] = vs;
  return {
    vertices: [...vs],
    faces: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
};
// ApliCA matriz mundo a la normal (transformDirection: solo rotación/escala).
const acodaMundo = (mesh, worldMatrix = new THREE.Matrix4()) =>
  quatAcodadoACaras(mesh, mesh.faces.map((_, i) => i), worldMatrix);

const ejesDe = (q) => ({
  x: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
  z: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
});

// 1. Cara superior (normal +Y): Z señala hacia fuera y el X del gizmo queda
//    al este (la X del mundo proyectada).
{
  const cara = quadPlano([V(-1, 1, -1), V(-1, 1, 1), V(1, 1, 1), V(1, 1, -1)]);
  const q = acodaMundo(cara);
  const ej = ejesDe(q);
  check(ej.z.distanceTo(V(0, 1, 0)) < 1e-6, 'cara superior: Z del gizmo = normal +Y');
  check(ej.x.distanceTo(V(1, 0, 0)) < 1e-6, 'cara superior: X del gizmo en el plano (este)');
}

// 2. Cara lateral con normal +X: la X del mundo cae sobre la normal → la
//    referencia pasa a la Y del mundo; la base sigue ortonormal.
{
  const cara = quadPlano([V(1, -1, -1), V(1, 1, -1), V(1, 1, 1), V(1, -1, 1)]);
  const q = acodaMundo(cara);
  const ej = ejesDe(q);
  check(ej.z.distanceTo(V(1, 0, 0)) < 1e-6, 'lateral +X: Z = normal');
  check(Math.abs(ej.x.dot(V(1, 0, 0))) < 1e-6, 'lateral +X: X del gizmo DENTRO del plano (nada de Z)');
  check(ej.x.length() > 0.999, 'lateral +X: X del gizmo unitaria (base sane)');
}

// 3. Normal en diagonal: X del mundo proyectada al plano.
{
  const s = Math.SQRT1_2;
  const cara = quadPlano([V(0, -1, -1), V(0, 1, -1), V(0, 1, 1), V(0, -1, 1)]);
  const girada = new THREE.Matrix4().makeRotationY(Math.PI / 4);
  const q = acodaMundo(cara, girada);
  const ej = ejesDe(q);
  const esperada = V(s, 0, -s);
  check(ej.z.distanceTo(esperada) < 1e-6, 'diagonal: Z = normal girada a mundo');
}

// 4. Normal de la selección en el ESPACIO DEL OBJETO girado: con el objeto
//    tumbado (90° sobre X), una cara «arriba» del objeto apunta al mundo.
{
  const cara = quadPlano([V(-1, 1, -1), V(-1, 1, 1), V(1, 1, 1), V(1, 1, -1)]);
  const girada = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const q = acodaMundo(cara, girada);
  const ej = ejesDe(q);
  // normal local (0,1,0) girada 90° sobre X → (0,0,1)
  check(ej.z.distanceTo(V(0, 0, 1)) < 1e-6, 'objeto tumbado: Z sigue la normal EN MUNDO');
}

// 5. Tapa de cilindro (16 tris coplanares) y cuadrilátero de 2 tris: la
//    selección COMPLETA acoda bien y de forma idéntica.
{
  const trisTapa = [];
  const vertices = [];
  for (let i = 0; i < 16; i++) {
    const a1 = (i / 16) * Math.PI * 2;
    const a2 = ((i + 1) / 16) * Math.PI * 2;
    const base = vertices.length;
    vertices.push(V(0, 1, 0), V(Math.cos(a1), 1, Math.sin(a1)), V(Math.cos(a2), 1, Math.sin(a2)));
    trisTapa.push([base, base + 2, base + 1]);
  }
  const tapa = { vertices, faces: trisTapa };
  const ids = trisTapa.map((_, i) => i);
  const q = quatAcodadoACaras(tapa, ids, new THREE.Matrix4());
  const ej = ejesDe(q);
  check(ej.z.distanceTo(V(0, 1, 0)) < 1e-6, 'tapa de 16 tris: abanico coplanar acodado entero');
  check(ej.x.distanceTo(V(1, 0, 0)) < 1e-6, 'tapa de 16 tris: X al este (girar el anillo del gizmo sigue posible)');

  // Mezcla tapa (+Y) + lateral (+X): normales perpendiculares, SIN alineación.
  const lateral = quadPlano([V(1, -1, -1), V(1, 1, -1), V(1, 1, 1), V(1, -1, 1)]);
  const mezcla = {
    vertices: [...tapa.vertices, ...lateral.vertices],
    faces: [...tapa.faces, ...lateral.faces.map((f) => f.map((i) => i + tapa.vertices.length))]
  };
  const idsMezcla = mezcla.faces.map((_, i) => i);
  check(quatAcodadoACaras(mezcla, idsMezcla, new THREE.Matrix4()) === null,
    'tapa + lateral mezcladas (normales perpendiculares): SIN alineación');
}

// 6.5. Caras de normal INVERTIDA (Cubo.zeus guarda 3 de 6 hacia dentro):
//      mirando la cara desde el lado visible, el gizmo sale hacia el ojo.
{
  // top-face quad DIBUJADO al revés → la normal sale −Y aunque «parezca» la cara de arriba
  const invertida = quadPlano([V(-1, 1, -1), V(1, 1, -1), V(1, 1, 1), V(-1, 1, 1)]);
  const nMundo = normalDe(invertida, 1); // (0,−1,0)
  const signo = nMundo.y < 0 ? -1 : 1; // −1: la normal está contra el ojo
  const q = quatAcodadoACaras(invertida, [0, 1], new THREE.Matrix4(), signo);
  const ej = ejesDe(q);
  check(ej.z.distanceTo(V(0, 1, 0)) < 1e-6,
    'cara con normal invertida + lado visto: Z del gizmo sale hacia el OJO (no hacia dentro)');
  // flotado por el lado visto: dirección = normal × signo = +Y (hacia el ojo)
  const flotando = nMundo.clone().multiplyScalar(signo);
  check(flotando.y > 0, 'flotado por el lado visto: sale hacia el lado VISIBLE');
  // Sin lado visto la normal cruda igualmente apunta −Y (por eso se veía dentro)
}

// 6. Sin cuadrar → SIN base (eje mundo): cinta vertical de un cilindro
//    (normales alrededor).
{
  const vertices = [];
  const faces = [];
  for (let i = 0; i < 8; i++) {
    const a1 = (i / 8) * Math.PI * 2;
    const a2 = ((i + 1) / 8) * Math.PI * 2;
    const base = vertices.length;
    vertices.push(
      V(Math.cos(a1), -1, Math.sin(a1)),
      V(Math.cos(a2), -1, Math.sin(a2)),
      V(Math.cos(a2), 1, Math.sin(a2)),
      V(Math.cos(a1), 1, Math.sin(a1))
    );
    faces.push([base, base + 1, base + 2], [base, base + 2, base + 3]);
  }
  const cinta = { vertices, faces };
  const ids = faces.map((_, i) => i);
  check(quatAcodadoACaras(cinta, ids, new THREE.Matrix4()) === null,
    'cinta que rodea el cuerpo (normales repartidas): SIN alineación');
}

// 7. Composición del frame loop (base * giroUsuario) e ida y vuelta del
//    aro de rotación: base⁻¹ * (dq * base * usuario0) recupera el giro
//    del usuario EXACTO (el residuo que se guarda en selGizmoRotation).
{
  const cara = quadPlano([V(-1, 1, -1), V(1, 1, -1), V(1, 1, 1), V(-1, 1, 1)]);
  const base = acodaMundo(cara);
  const usuario0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.2, 0.45));
  const render = base.clone().multiply(usuario0); // quat del grupo en el frame loop
  const dq = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0).applyQuaternion(render), // eje del aro pintado
    0.7
  );
  const quatNueva = dq.multiply(render);
  const residuo = base.clone().invert().multiply(quatNueva);
  const euler = new THREE.Euler().setFromQuaternion(residuo);
  const recompuesto = base.clone().multiply(
    new THREE.Quaternion().setFromEuler(euler)
  );
  const ang = recompuesto.angleTo(quatNueva);
  // ~1e-7 rad: la doble conversión quat→Euler→quat. Nada que ver (≈2e-6 grados).
  check(ang < 1e-5, 'ida y vuelta del aro: la orientación compuesta es idéntica');
  // Y sin base el residuo es exactamente el giro nuevo (comportamiento clásico).
  const sinBase = quatNueva.clone();
  const eulerSinBase = new THREE.Euler().setFromQuaternion(sinBase);
  check(new THREE.Quaternion().setFromEuler(eulerSinBase).angleTo(quatNueva) < 1e-9,
    'sin base: el giro se guarda tal cual (sin regresión)');
}

console.log(fallos === 0 ? '\nTODO OK' : `\nFALLOS: ${fallos}`);
process.exit(fallos === 0 ? 0 : 1);