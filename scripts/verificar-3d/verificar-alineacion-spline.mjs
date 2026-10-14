// Verificación numérica de la ALINEACIÓN de plantillas calcadas (⤢→spline)
// a la ventana donde se dibujaron: baseMundo {right,up,rx,ry} + giro φ
// automático del marco. Camino vertical (+Y) y plantilla calcada en la
// ventana SUPERIOR (right=(1,0,0), up=(0,0,−1)): antes el anillo salía
// rotado 90° («torcida, mirando para otro lado», reporte 13/10).
//
// Uso:
//   npx esbuild lib/spline-3d.ts --bundle --format=esm \
//     --platform=node --outfile=scripts/verificar-3d/.spline-bundle.mjs
//   node scripts/verificar-3d/verificar-alineacion-spline.mjs

import { buildSpline3DMesh, contornosDeVertices } from './.spline-bundle.mjs';

const BASE = {
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 0, z: -1 },
};

let fallos = 0;
const fallo = (msg) => { console.log(`  ✗ ${msg}`); fallos++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/** Rectángulo 0..1 (ancho 0.8, alto 0.5, centrado en 0.5). */
function rectangulo(ancho = 0.8, alto = 0.5) {
  return [
    { x: 0.5 - ancho / 2, y: 0.5 - alto / 2 },
    { x: 0.5 + ancho / 2, y: 0.5 - alto / 2 },
    { x: 0.5 + ancho / 2, y: 0.5 + alto / 2 },
    { x: 0.5 - ancho / 2, y: 0.5 + alto / 2 },
  ];
}

/** {min, max} por eje de una lista de puntos. */
function extension(anillo) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of anillo) {
    for (const [k, c] of [[0, p.x], [1, p.y], [2, p.z]]) {
      if (c < min[k]) min[k] = c;
      if (c > max[k]) max[k] = c;
    }
  }
  return { min, max };
}

/* ── Camino vertical en el mundo + plantilla calcada en SUPERIOR ─────── */

// Camino: (2,·,1) vertical (⟂ al plano XZ de la ventana Superior); el
// cruce del tubo es exactamente el plano de la ventana. El anillo del
// primer vértice sale de contornosDeVertices (anillo COMPLETO).
const ESC = 1.2;
const anchoMundo = 0.8 * 2 * ESC; // lienzo 0.8 de ancho
const altoMundo = 0.5 * 2 * ESC;
const opts = { closed: false, subdivisions: 4 };

const nodosBase = [
  { id: 0, p: { x: 2, y: 0.05, z: 1 }, polygon: rectangulo(), escala: ESC },
  { id: 1, p: { x: 2, y: 1.7, z: 1 }, polygon: rectangulo(), escala: ESC },
  { id: 2, p: { x: 2, y: 3.3, z: 1 }, polygon: rectangulo(), escala: ESC },
];

// SIN baseMundo (comportamiento de antes): el marco arranca en
// primeraNormal(T=(0,1,0)) = (0,0,1), B=(−1,0,0): el anillo cae en el
// MISMO plano XZ pero ROTADO 90° — ancho y alto intercambiados.
{
  const e = extension(contornosDeVertices(nodosBase, opts)[0]);
  const xE = e.max[0] - e.min[0];
  const zE = e.max[2] - e.min[2];
  if (e.max[1] - e.min[1] > 1e-9) {
    fallo('sin baseMundo el anillo ni siquiera es plano (Δy≠0) — cambia la premisa del test');
  } else if (cerca(xE, altoMundo, 1e-3) && cerca(zE, anchoMundo, 1e-3)) {
    ok(`BUG reproducido sin baseMundo: X=${xE.toFixed(3)} Z=${zE.toFixed(3)} — ancho y alto INTERCAMBIADOS (la «torcida»)`);
  } else {
    fallo(`sin baseMundo dio X=${xE.toFixed(3)} Z=${zE.toFixed(3)}; se esperaba el rotado X=${altoMundo.toFixed(3)} Z=${anchoMundo.toFixed(3)}`);
  }
}

// CON baseMundo: anillo 0 plano en XZ, ancho en X = anchoMundo (right de
// la ventana), alto en Z = altoMundo (up=(0,0,−1): «arriba» del dibujo = −Z).
const nodosCon = nodosBase.map((n) => ({
  ...n,
  baseMundo: { ...BASE, rx: 1, ry: 1 },
}));
{
  const anillos = contornosDeVertices(nodosCon, opts);
  const RC = anillos[0].length;
  const e = extension(anillos[0]);
  const xE = e.max[0] - e.min[0];
  const zE = e.max[2] - e.min[2];
  const variacionY = e.max[1] - e.min[1];
  if (variacionY > 1e-4) fallo(`anillo 0 NO es plano (Δy=${variacionY.toFixed(6)})`);
  else ok(`anillo 0 plano en XZ (Δy=${variacionY.toFixed(6)})`);
  if (cerca(xE, anchoMundo, 1e-3) && cerca(zE, altoMundo, 1e-3)) {
    ok(`orientación correcta: X=${xE.toFixed(4)} (ancho dibujado), Z=${zE.toFixed(4)} (alto dibujado, arriba→−Z)`);
  } else {
    fallo(`orientación mal: X=${xE.toFixed(4)} Z=${zE.toFixed(4)} ≠ X=${anchoMundo.toFixed(4)} Z=${altoMundo.toFixed(4)}`);
  }

  // La malla usa el MISMO mapeo: el anillo del vértice j está en la muestra
  // j·steps (subdivisions=4, sin recorte de rendimiento con 3 vértices)
  // y coincide EXACTO con el contorno.
  const malla = buildSpline3DMesh(nodosCon, opts);
  let maxdif = 0;
  for (let j = 0; j < anillos.length; j++) {
    const cruce = malla.vertices.slice(j * 4 * RC, j * 4 * RC + RC);
    for (let i = 0; i < RC; i++) {
      maxdif = Math.max(
        maxdif,
        Math.abs(cruce[i].x - anillos[j][i].x) +
          Math.abs(cruce[i].y - anillos[j][i].y) +
          Math.abs(cruce[i].z - anillos[j][i].z)
      );
    }
  }
  maxdif < 1e-9
    ? ok('contornos == anillos de la malla en sus cruces (mismo mapeo)')
    : fallo(`contornos ≠ malla (dif ${maxdif.toExponential(2)})`);
}

/* ── Aspecto no cuadrado (ventana ancha): rx/ry llevan el estiramiento ─ */

// Lienzo→mundo: X = 2·esc (rx 1), Y = 2·esc·0.75 (ry 0.75, ventana ancha).
{
  const esc = 1.6;
  const nodos = nodosBase.map((n) => ({
    ...n,
    escala: esc,
    baseMundo: { ...BASE, rx: 1, ry: 0.75 },
  }));
  const e = extension(contornosDeVertices(nodos, opts)[0]);
  const anchoX = e.max[0] - e.min[0];
  const altoZ = e.max[2] - e.min[2];
  if (cerca(anchoX, 0.8 * 2 * esc, 1e-3) && cerca(altoZ, 0.5 * 2 * esc * 0.75, 1e-3)) {
    ok(`aspecto real de la ventana: ${anchoX.toFixed(3)} × ${altoZ.toFixed(3)} (ry=0.75 respetado)`);
  } else {
    fallo(`aspecto malo: X=${anchoX.toFixed(3)} Z=${altoZ.toFixed(3)} (esperado ${(0.8 * 2 * esc).toFixed(3)} × ${(0.5 * 2 * esc * 0.75).toFixed(3)})`);
  }
}

/* ── Escala del vértice con baseMundo: la escala SIGUE multiplicando ─── */

{
  const esc = 2;
  const nodos = nodosBase.map((n) => ({
    ...n,
    escala: esc,
    baseMundo: { ...BASE, rx: 1, ry: 1 },
  }));
  const e = extension(contornosDeVertices(nodos, opts)[0]);
  const xE = e.max[0] - e.min[0];
  if (cerca(xE, 0.8 * 2 * esc, 1e-3)) {
    ok(`la escala del vértice sigue gobernando el tamaño con baseMundo: X=${xE.toFixed(4)}`);
  } else {
    fallo(`escala con baseMundo: X=${xE.toFixed(4)} ≠ ${(0.8 * 2 * esc).toFixed(4)}`);
  }
}

/* ── tilt manual + baseMundo: se SUMAN (tilt + φ), no se sustituyen ──── */

{
  const conTilt = nodosBase.map((n) => ({
    ...n,
    tilt: 30,
    baseMundo: { ...BASE, rx: 1, ry: 1 },
  }));
  const ref = contornosDeVertices(nodosCon, opts)[0];
  const con = contornosDeVertices(conTilt, opts)[0];
  let distinta = false;
  for (let i = 0; i < con.length; i++) {
    if (
      Math.abs(con[i].x - ref[i].x) > 1e-4 ||
      Math.abs(con[i].z - ref[i].z) > 1e-4
    ) {
      distinta = true;
      break;
    }
  }
  distinta
    ? ok('tilt manual (30°) + baseMundo: se añade al φ (rotación extra visible)')
    : fallo('tilt manual ignorado en presencia de baseMundo');
}

/* ── baseMundo degenerado (right‖trazado o up=0): sin corrección, sin NaN */
{
  const nodos = nodosBase.map((n) => ({
    ...n,
    baseMundo: {
      right: { x: 0, y: 1, z: 0 }, // ‖ T vertical: proyección muere
      up: { x: 0, y: 0, z: 0 },    // muerto: candidato de reserva muerto
      rx: 1,
      ry: 1,
    },
  }));
  const malla = buildSpline3DMesh(nodos, opts);
  const todoFinito = malla.vertices.every(
    (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
  );
  todoFinito
    ? ok('baseMundo degenerado (right‖T, up=0): sin corrección y SIN NaN')
    : fallo('baseMundo degenerado produce NaN');
}

/* ── Trazado CERRADO: baseMundo cambia el anillo y todo es finito ────── */

{
  const nodos = [
    { id: 0, p: { x: 0, y: 0, z: 0 }, polygon: rectangulo(), escala: ESC, baseMundo: { ...BASE, rx: 1, ry: 1 } },
    { id: 1, p: { x: 0, y: 1.6, z: 0 }, polygon: rectangulo(), escala: ESC, baseMundo: { ...BASE, rx: 1, ry: 1 } },
    { id: 2, p: { x: 1.5, y: 1.6, z: 0 }, polygon: rectangulo(), escala: ESC, baseMundo: { ...BASE, rx: 1, ry: 1 } },
  ];
  const optsC = { closed: true, subdivisions: 3 };
  const malla = buildSpline3DMesh(nodos, optsC);
  const conts = contornosDeVertices(nodos, optsC);
  const mallaSin = buildSpline3DMesh(
    nodos.map(({ baseMundo: _b, ...n }) => n),
    optsC
  );
  if (malla.vertices.length === 0) fallo('cerrado: malla vacía');
  else ok('cerrado: malla completa construida con baseMundo');
  if (conts.length !== 3) fallo(`cerrado: ${conts.length} contornos ≠ 3 vértices`);
  else ok('cerrado: 3 contornos');
  // En una curva cerrada el cruce del vértice 0 es una ESQUINA (la tangente
  // central promedia entrada y salida), así que el anillo no puede quedar
  // exacto en el plano de la ventana: lo que debe pasar es que la
  // alineación de baseMundo CAMBIE el resultado (φ≠0) — el mismo giro que
  // en el caso abierto ⟂.
  let dif = false;
  for (let i = 0; i < conts[0].length; i++) {
    if (
      Math.abs(conts[0][i].x - mallaSin.vertices[i].x) > 1e-6 ||
      Math.abs(conts[0][i].y - mallaSin.vertices[i].y) > 1e-6 ||
      Math.abs(conts[0][i].z - mallaSin.vertices[i].z) > 1e-6
    ) {
      dif = true;
      break;
    }
  }
  dif
    ? ok('cerrado: baseMundo gira el marco también (φ añadido al tilt)')
    : fallo('cerrado: baseMundo sin efecto');
  const todoFinito = malla.vertices.every(
    (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
  );
  todoFinito ? ok('cerrado: todo finito') : fallo('cerrado: NaN en la malla');
}

/* ── validarSplineDatos conserva/limpia baseMundo ────────────────────── */

{
  const { validarSplineDatos } = await import('./.spline-bundle.mjs');
  const bien = [
    ...nodosCon,
    { ...nodosBase[0], baseMundo: { right: { x: 2, y: 0, z: 0 }, up: BASE.up, rx: -1, ry: 0 } },
  ];
  const datos = validarSplineDatos({ nodes: bien, closed: false, subdivisions: 2, escala: 1 });
  const nodosV = datos?.nodes ?? [];
  const conBase = nodosV.filter((n) => n.baseMundo);
  if (conBase.length === nodosCon.length) {
    const b0 = nodosV[0].baseMundo;
    const rUnit = Math.hypot(b0.right.x, b0.right.y, b0.right.z);
    if (cerca(rUnit, 1, 1e-6)) {
      ok('validarSplineDatos conserva baseMundo válido (unitario)');
    } else {
      fallo('validarSplineDatos: right NO unitario');
    }
  } else {
    fallo(`validarSplineDatos: ${conBase.length} baseMundo ≠ ${nodosCon.length} esperados`);
  }
  const podrido = [
    ...nodosCon,
    { ...nodosBase[0], baseMundo: { right: { x: 0, y: 0, z: 0 }, up: BASE.up, rx: 1, ry: 1 } },
    { ...nodosBase[0], baseMundo: { right: BASE.right, up: BASE.up, rx: 'x', ry: 1 } },
  ];
  const datos2 = validarSplineDatos({ nodes: podrido, closed: false, subdivisions: 2, escala: 1 });
  const limpio = (datos2?.nodes ?? []).filter((n) => n.baseMundo).length;
  if (limpio === nodosCon.length) {
    ok(`validarSplineDatos tira el baseMundo podrido (quedan ${limpio}/${podrido.length})`);
  } else {
    fallo(`validarSplineDatos con baseMundo podrido: quedan ${limpio} ≠ ${nodosCon.length}`);
  }
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);