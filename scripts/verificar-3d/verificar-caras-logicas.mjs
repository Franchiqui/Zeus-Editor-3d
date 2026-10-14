// Caradas LÓGICAS del pick de caras (sustituto del BFS coplanar por índices):
// cara = celda pareada (cuadrilátero de 2 triángulos, o quad entero) o
// casquete coplanar de caras sueltas (tapa plana de cilindro entera).
// Verificado sobre los .zeus de galería (guardados: triángulos con vértices
// duplicados) Y sobre las mallas REGENERADAS (cuadranguladas, índices
// compartidos) — reproduciendo el bug tras tocar los segmentos en propiedades.
import * as G from './.geometry-bundle.mjs';
import * as P from './.primitivas-diag-bundle.mjs';
import * as fs from 'fs';

let fallos = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALLA'} ${msg}`);
  if (!cond) fallos++;
};

// --- réplicas del viewer -------------------------------------------------
const normalDe = (mesh, fi) => {
  const face = mesh.faces[fi];
  if (!face || face.length < 3) return null;
  const a = mesh.vertices[face[0]];
  const b = mesh.vertices[face[1]];
  const c = mesh.vertices[face[2]];
  if (!a || !b || !c) return null;
  const u = [b.x - a.x, b.y - a.y, b.z - a.z];
  const w = [c.x - a.x, c.y - a.y, c.z - a.z];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const len = Math.hypot(...n) || 1;
  return n.map((x) => x / len);
};

const clavePos = (mesh, vi) => {
  const v = mesh.vertices[vi];
  return `${Math.min(
    0,
    1e5 * (v.x - Math.floor(v.x)),
    0
  ) || Math.round(v.x * 1e5)}|${Math.round(v.y * 1e5)}|${Math.round(v.z * 1e5)}`;
};
const claveBorde = (mesh, a, b) => {
  const A = clavePos(mesh, a);
  const B = clavePos(mesh, b);
  return A < B ? `${A}-${B}` : `${B}-${A}`;
};

// getFaceGroup del viewer, con claves por POSICIÓN (comportamiento antiguo
// sobre una malla sueldada = el caso "regenerada" tras tocar segmentos).
function getFaceGroupSuelda(mesh, startFaceIdx) {
  const grupo = new Set([startFaceIdx]);
  const n0 = normalDe(mesh, startFaceIdx);
  const adyac = new Map();
  for (let i = 0; i < mesh.faces.length; i++) {
    const face = mesh.faces[i];
    for (let j = 0; j < face.length; j++) {
      const a = face[j];
      const b = face[(j + 1) % face.length];
      if (a === b) continue;
      const key = claveBorde(mesh, a, b);
      if (!adyac.has(key)) adyac.set(key, []);
      adyac.get(key).push(i);
    }
  }
  const cola = [startFaceIdx];
  while (cola.length) {
    const cur = cola.shift();
    const face = mesh.faces[cur];
    if (!face) continue;
    for (let j = 0; j < face.length; j++) {
      const va = face[j];
      const vb = face[(j + 1) % face.length];
      if (va === vb) continue;
      const key = claveBorde(mesh, va, vb);
      for (const n of adyac.get(key) || []) {
        if (grupo.has(n)) continue;
        const nn = normalDe(mesh, n);
        if (!nn) continue;
        const dot = n0[0] * nn[0] + n0[1] * nn[1] + n0[2] * nn[2];
        if (dot > 0.99) {
          grupo.add(n);
          cola.push(n);
        }
      }
    }
  }
  return Array.from(grupo);
}

// Replicación de carasElementoCara (viewer-3d.tsx).
const carasElementoCara = (mesh, faceIdx, anillos) => {
  const datos = G.construirAnillos(mesh);
  const salida = new Set();
  if (anillos && anillos.length > 0) {
    for (const f of anillos) {
      if (!datos) { salida.add(f); continue; }
      if (datos.faceACelda[f] >= 0) {
        for (const t of datos.celdas[datos.faceACelda[f]].tris) salida.add(t);
      } else {
        for (const t of G.casqueteCoplanarDe(mesh, datos, f)) salida.add(t);
      }
    }
    return Array.from(salida);
  }
  if (datos) return G.caraLogicaDe(mesh, datos, faceIdx);
  return [];
};

const leeGuardado = (nombre) =>
  JSON.parse(fs.readFileSync(`public/Obj-3D/${nombre}`, 'utf8')).sceneObjects[0].mesh;

const esTapaDe = (mesh) => {
  const flag = new Uint8Array(mesh.faces.length);
  for (let i = 0; i < mesh.faces.length; i++) {
    const n = normalDe(mesh, i);
    if (n && Math.abs(n[1]) > 0.99) flag[i] = 1;
  }
  return flag;
};

// --------------------------------------------------------------------------
// CILINDRO guardado (.zeus triangulado): cara lat/eral = cuadrilátero entero
// (2 tris), tapa = abanico entero (16 tris), NUNCA franjas de varias caras.
{
  const mesh = leeGuardado('Cilindro.zeus');
  const datos = G.construirAnillos(mesh);
  const tapas = esTapaDe(mesh);
  const lateral = mesh.faces.findIndex((_, i) => !tapas[i]);

  const caraL = carasElementoCara(mesh, lateral, null);
  check(tapas[lateral] === 0, `Cilindro guardado: la cara ${lateral} es lateral`);
  check(
    caraL.length === 2 && caraL.every((f) => !tapas[f]),
    `Cilindro guardado anillos OFF: cara lateral = el cuadrilátero entero (2 tris), no 1 tri ni una franja → ${JSON.stringify(caraL)}`
  );

  const primerSuelto = datos.faceACelda.indexOf(-1);
  check(primerSuelto >= 0 && tapas[primerSuelto] === 1, 'Cilindro guardado: los sueltos son de la tapa');
  const caraTapa = carasElementoCara(mesh, primerSuelto, null);
  check(
    caraTapa.length === 16,
    `Cilindro guardado: cara de tapa = abanico entero (16 tris), no media cara → ${caraTapa.length}`
  );

  const a0 = G.carasAnilloDe(datos, lateral, 0);
  const a1 = G.carasAnilloDe(datos, lateral, 1);
  const horizontal = (a1?.length ?? 0) > (a0?.length ?? 0) ? a1 : a0;
  check(horizontal.length === 32, `Cilindro guardado anillos ON: anillo horizontal entero (32 caras) → ${horizontal.length}`);
  const expandido = carasElementoCara(mesh, lateral, horizontal);
  check(expandido.length === 32, `Cilindro guardado: el anillo expandido no toca tapas → ${expandido.length}`);
}

// CILINDRO regenerado (tras tocar segmentos): el bug del usuario.
{
  const params = P.paramsDeArchivo('Cilindro.zeus');
  const mesh = P.construirMallaPrimitiva(params);
  const datos = G.construirAnillos(mesh);
  const quads = mesh.faces.filter((f) => f.length === 4).length;
  const tris = mesh.faces.length - quads;
  check(tris === 32 && quads === 64, `Cilindro regenerado: 64 quads + 32 tris de tapas (${quads}/${tris})`);

  // Reproducción del bug: el BFS coplanar sueldado pega franjas de 4 y la
  // tapa entera de 16 (antes de este arreglo eso era lo que el usuario veía).
  const franjas = new Map();
  for (let i = 0; i < mesh.faces.length; i++) {
    const g = getFaceGroupSuelda(mesh, i).length;
    franjas.set(g, (franjas.get(g) || 0) + 1);
  }
  check(
    franjas.has(4) && franjas.has(16),
    `repro del bug (getFaceGroup suelda): franjas de 4 quads y tapas de 16 tris → ${JSON.stringify([...franjas])}`
  );

  const caraL = carasElementoCara(mesh, 0, null);
  check(caraL.length === 1, `Cilindro regenerado anillos OFF: cara lateral = UNA cara (1 quad), no las 4 de la franja → ${caraL.length}`);

  const sueltos = datos.faceACelda.filter((c) => c < 0).length;
  check(sueltos === 32, `Cilindro regenerado: 32 tris de tapa sueltos (abanicos) → ${sueltos}`);
  const caraTapa = carasElementoCara(mesh, datos.faceACelda.indexOf(-1), null);
  check(caraTapa.length === 16, `Cilindro regenerado: cara de tapa = abanico entero (16 tris), no media cara → ${caraTapa.length}`);

  const a0 = G.carasAnilloDe(datos, 0, 0);
  const a1 = G.carasAnilloDe(datos, 0, 1);
  const horizontal = (a1?.length ?? 0) > (a0?.length ?? 0) ? a1 : a0;
  const vertical = (a1?.length ?? 0) > (a0?.length ?? 0) ? a0 : a1;
  check(horizontal.length === 16, `Cilindro regenerado anillos ON: anillo horizontal entero (16 quads) → ${horizontal.length}`);
  check(vertical.length === 4 + 2, `Cilindro regenerado anillos ON vertical: 4 quads + 2 sueltos de tapa → ${vertical.length}`);
  const verticalExpandido = carasElementoCara(mesh, 0, vertical);
  check(verticalExpandido.length === 4 + 32, `Cilindro regenerado: el anillo vertical EXPANDIDO pinta las dos tapas enteras (4 quads + 32 tris) → ${verticalExpandido.length}`);
  const horizontalExpandido = carasElementoCara(mesh, 0, horizontal);
  check(horizontalExpandido.length === 16, `Cilindro regenerado: el anillo horizontal expandido no pinta tapas que no toca → ${horizontalExpandido.length}`);
}

// CÁPSULA regenerada: polos curvos — cada suelto es su propia cara (nada de
// casquetes falsos) y los anillos quedan enteros.
{
  const params = P.paramsDeArchivo('Capsula.zeus');
  const mesh = P.construirMallaPrimitiva(params);
  const datos = G.construirAnillos(mesh);
  check(mesh.faces.filter((f) => f.length === 4).length === 160, 'Cápsula regenerada: 160 quads');
  const sueltos = datos.faceACelda.filter((c) => c < 0).length;
  check(sueltos === 32, `Cápsula regenerada: 32 polos sueltos → ${sueltos}`);
  const caraPolo = carasElementoCara(mesh, datos.faceACelda.indexOf(-1), null);
  check(caraPolo.length === 1, `Cápsula regenerada: un polo curvo es UNA cara (el casquete coplanar no se expande) → ${caraPolo.length}`);

  const paresRings = new Set();
  for (let i = 0; i < mesh.faces.length; i++) {
    if (datos.faceACelda[i] < 0) continue;
    paresRings.add(`${G.carasAnilloDe(datos, i, 0)?.length}/${G.carasAnilloDe(datos, i, 1)?.length}`);
  }
  check(paresRings.size === 1, `Cápsula regenerada anillos: mismos tamaños de anillo en toda la malla → ${[...paresRings][0]}`);
}

// ESFERA: polos curvos; los meridianos siguen pasando POR el polo.
{
  const params = P.paramsDeArchivo('Esfera.zeus');
  const mesh = P.construirMallaPrimitiva(params);
  const datos = G.construirAnillos(mesh);
  const paresRings = new Set();
  for (let i = 0; i < mesh.faces.length; i++) {
    if (datos.faceACelda[i] < 0) continue;
    paresRings.add(`${G.carasAnilloDe(datos, i, 0)?.length}/${G.carasAnilloDe(datos, i, 1)?.length}`);
  }
  check(paresRings.size === 1, `Esfera regenerada anillos: un solo par de tamaños en toda la malla → ${[...paresRings][0]}`);
  const meridiano = [...paresRings][0].split('/')[0] === '26' ? 0 : 1;
  let unoMeridiano = null;
  for (let i = 0; i < mesh.faces.length; i++) {
    if (datos.faceACelda[i] < 0) continue;
    const a = G.carasAnilloDe(datos, i, /* clase */ meridiano === 0 ? 0 : 1);
    if (a && a.length === 26) { unoMeridiano = a; break; }
  }
  check(!!unoMeridiano && unoMeridiano.length === 26, `Esfera regenerada: meridiano de 26 caras enteras (24 quads + 2 polos) → ${unoMeridiano?.length}`);
  // Y expandido sigue igual (los polos curvos no se expanden).
  const exp = carasElementoCara(mesh, datos.faceACelda.findIndex((c) => c >= 0), unoMeridiano);
  check(exp.length === 26, `Esfera regenerada: meridiano expandido sin cambios → ${exp.length}`);

  // Esfera GUARDADA: cara = cuadrilátero entero (2 tris).
  const meshG = leeGuardado('Esfera.zeus');
  const datosG = G.construirAnillos(meshG);
  const caraG = carasElementoCara(meshG, 0, null);
  check(caraG.length === 2, `Esfera guardada: cara = el quad entero (2 tris), no media cara → ${caraG.length}`);
  const poloG = carasElementoCara(meshG, datosG.faceACelda.indexOf(-1), null);
  check(poloG.length === 1, `Esfera guardada: polo curvo = un tri (sin casquete) → ${poloG.length}`);
}

// CUBO guardado (6 quads, uno por lado): cara = su quad, y el hover NO
// engancha lados vecinos (el BFS coplanar viejo con malla sueldada si lo
// haría a través de... comprobamos que no hay ningún enganche).
{
  const mesh = leeGuardado('Cubo.zeus');
  const datos = G.construirAnillos(mesh);
  check(
    mesh.faces.every((f) => f.length === 4) && datos.celdas.length === 6,
    `Cubro guardado: 6 quads → ${datos.celdas.length} celdas`
  );
  const caras = Array.from(
    { length: mesh.faces.length }, (_, i) => carasElementoCara(mesh, i, null).length
  );
  check(
    caras.every((n) => n === 1),
    `Cubo guardado: cada cara = 1 quad (sin enganchar lados vecinos) → ${caras.join(',')}`
  );
  // Con la malla SUELDADA el BFS coplanar viejo tampoco engancha (lados no
  // coplanares) — lo mismo que el nuevo.
  const antes = Array.from({ length: mesh.faces.length }, (_, i) => getFaceGroupSuelda(mesh, i).length);
  check(antes.every((n) => n === 1), 'Cubo guardado: getFaceGroup (suelda) también 1 por cara — sin regresión');
}

console.log(fallos === 0 ? '\nTODO OK' : `\nFALLOS: ${fallos}`);
process.exit(fallos === 0 ? 0 : 1);