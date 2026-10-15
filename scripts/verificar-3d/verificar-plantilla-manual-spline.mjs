// Verificación numérica del ANCLA FRONTAL de las plantillas dibujadas a
// mano (la que ahora aplica Editor3D con updateSplineNodePolygon cuando
// NO hay captura ⤢): cada anilla queda anclada a los ejes de la ventana
// frontal (x del dibujo → mundo X, y del dibujo → mundo −Y), así lo
// dibujado en el lienzo de la plantilla sale en el 3D con la MISMA forma,
// tamaño (2·escala por lado del lienzo) y ángulo — y arreglar un vértice
// ya no retuerce las anillas de los demás (cada anilla depende solo de su
// propio vértice; antes las orientaba el marco transportado del trazado).
//
// Uso:
//   npx esbuild lib/spline-3d.ts --bundle --format=esm \
//     --platform=node --outfile=scripts/verificar-3d/.spline-bundle.mjs
//   node scripts/verificar-3d/verificar-plantilla-manual-spline.mjs

import { buildSpline3DMesh, contornosDeVertices, muestrearSpline } from './.spline-bundle.mjs';

let fallos = 0;
const fallo = (msg) => { console.log(`  ✗ ${msg}`); fallos++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/** Rectángulo 0..1 (ancho 0.8, alto 0.5, centrado). */
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
  return { min, max, centro: min.map((m, k) => (m + max[k]) / 2) };
}

/** Ancla FRONTAL (la misma que Editor3D pone al dibujar a mano). */
const ANCLA = { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, rx: 1, ry: 1 };

console.log('═══ Plantillas dibujadas a mano: ancla frontal ═══');
{
  const ESCALA = 0.5;
  const nodes = [
    { id: 1, p: { x: 0, y: 0, z: 0 }, polygon: rectangulo(), escala: ESCALA, baseMundo: { ...ANCLA, right: { ...ANCLA.right }, up: { ...ANCLA.up } } },
    { id: 2, p: { x: 0, y: 0, z: 1 }, polygon: rectangulo(), escala: ESCALA, baseMundo: { ...ANCLA, right: { ...ANCLA.right }, up: { ...ANCLA.up } } },
  ];
  const anillos = contornosDeVertices(nodes, { closed: false, subdivisions: 5, escala: ESCALA });
  if (anillos.length !== 2) {
    fallo(`esperaba 2 contornos, llegaron ${anillos.length}`);
  } else {
    const ext = extension(anillos[0]);
    const ancho = ext.max[0] - ext.min[0];
    const alto = ext.max[1] - ext.min[1];
    // El lienzo mapea: ancho del dibujo (0.8) × 2·escala (1.0) = 0.8 en X.
    cerca(ancho, 0.8, 1e-3) ? ok(`ancho de la anilla = ${ancho.toFixed(4)} (dibujo 0.8 × 2·escala 1.0)`)
      : fallo(`ancho de la anilla ${ancho.toFixed(4)}, esperado 0.8`);
    cerca(alto, 0.5, 1e-3) ? ok(`alto de la anilla = ${alto.toFixed(4)} (dibujo 0.5 × 2·escala 1.0)`)
      : fallo(`alto de la anilla ${alto.toFixed(4)}, esperado 0.5`);
    // Centrada en el VÉRTICE (rectángulo centrado en el lienzo: su centro
    // de perímetro remuestreado cae también en el centro).
    cerca(ext.centro[0], 0, 1e-3) && cerca(ext.centro[1], 0, 1e-3)
      ? ok('la anilla queda centrada en el vértice')
      : fallo(`centro de la anilla en (${ext.centro[0]}, ${ext.centro[1]}), esperado (0, 0)`);
    // El camino corre por +Z: las anillas viven en el plano XY de la
    // ventana frontal (extensión NULA en Z).
    const profZ = ext.max[2] - ext.min[2];
    profZ < 1e-6 ? ok(`anilla plana en la ventana frontal (profundidad Z = ${profZ.toExponential(1)})`)
      : fallo(`la anilla sale torcida fuera de la ventana: Z = ${profZ.toFixed(4)}`);
  }
}

console.log('═══ El «arriba» del dibujo es el «arriba» del mundo ═══');
{
  // Triángulo con la PUNTA arriba en el lienzo (y pequeña = arriba): en el
  // mundo debe ser el punto más ALTO de la anilla (canvas y → mundo −Y).
  // (El constructor centra la anilla en el centroide del perímetro
  // remuestreado, así que se comprueba el ORDEN vertical, no el centro.)
  const ESCALA = 0.5;
  const triangulo = [
    { x: 0.5, y: 0.2 },   // punta arriba (en el lienzo)
    { x: 0.3, y: 0.8 },
    { x: 0.7, y: 0.8 },
  ];
  const nodes = [
    { id: 1, p: { x: 0, y: 0, z: 0 }, polygon: triangulo, escala: ESCALA, baseMundo: { ...ANCLA, right: { ...ANCLA.right }, up: { ...ANCLA.up } } },
    { id: 2, p: { x: 0, y: 0, z: 1 }, polygon: triangulo.map((q) => ({ ...q })), escala: ESCALA, baseMundo: { ...ANCLA, right: { ...ANCLA.right }, up: { ...ANCLA.up } } },
  ];
  const anillos = contornosDeVertices(nodes, { closed: false, subdivisions: 5, escala: ESCALA });
  const ext = extension(anillos[0]);
  ext.max[1] > ext.min[1] ? ok(`la punta del dibujo (y=0.2) queda ARRIBA (mundo Y máx = ${ext.max[1].toFixed(4)})`)
    : fallo(`la punta del dibujo quedó ABAJO: Y máx ${ext.max[1].toFixed(4)} < Y mín ${ext.min[1].toFixed(4)}`);
  const altura = ext.max[1] - ext.min[1];
  cerca(altura, 0.6 * 2 * ESCALA, 5e-3) ? ok(`altura de la anilla = ${altura.toFixed(4)} ≈ dibujo 0.6 × 2·escala 1.0`)
    : fallo(`altura de la anilla ${altura.toFixed(4)}, esperado ${(0.6 * 2 * ESCALA).toFixed(4)}`);
}

console.log('═══ Alargar el trazado NO retuerce la anilla ya arreglada ═══');
{
  // Con las anillas ancladas a la ventana, mover/alongar el trazado no
  // cambia la orientación de las anillas fijas (cada una depende SOLO de
  // su vértice) — antes el marco transportado las giraba según TODA la
  // curva y arreglar un vértice descolocaba los anteriores.
  const ESCALA = 0.5;
  const nodo = (id, p, poly) => ({
    id,
    p,
    polygon: poly,
    escala: ESCALA,
    baseMundo: { ...ANCLA, right: { ...ANCLA.right }, up: { ...ANCLA.up } },
  });
  const poly = rectangulo();
  const nodo1 = { x: 0, y: 0, z: 0 };
  const antes = contornosDeVertices(
    [nodo(1, nodo1, poly), nodo(2, { x: 0, y: 0, z: 1 }, poly.map((q) => ({ ...q })))],
    { closed: false, subdivisions: 5, escala: ESCALA }
  )[0];
  const despues = contornosDeVertices(
    [nodo(1, nodo1, poly), nodo(2, { x: 0, y: 0, z: 3 }, poly.map((q) => ({ ...q })))],
    { closed: false, subdivisions: 5, escala: ESCALA }
  )[0];
  const a = extension(antes);
  const b = extension(despues);
  const desvio = Math.max(
    Math.abs(a.centro[0] - b.centro[0]),
    Math.abs(a.centro[1] - b.centro[1]),
    Math.abs((a.max[0] - a.min[0]) - (b.max[0] - b.min[0])),
    Math.abs((a.max[1] - a.min[1]) - (b.max[1] - b.min[1]))
  );
  desvio < 1e-3 ? ok(`anilla del vértice fijo idéntica al alongar el trazado (desvío ${desvio.toExponential(1)})`)
    : fallo(`la anilla del vértice fijo cambió al alongar el trazado: desvío ${desvio.toFixed(4)}`);
}

console.log('═══ Excentricidad: plantilla fuera del camino, trazado intacto ═══');
{
  // Plantilla calcada con ⤢ a un lado de la trayectoria: su anilla se
  //centra donde se dibujó (desvío del vértice) pero el CAMINO no se
  // mueve un milímetro — el desvío viaja aparte y no altera las muestras.
  const ESCALA = 0.5;
  const exc = { x: 0.7, y: -0.3, z: 0.4 };
  const nodes = [
    { id: 1, p: { x: 0, y: 0, z: 0 }, polygon: rectangulo(), escala: ESCALA, excentricidad: { ...exc }, baseMundo: { ...ANCLA, right: { ...ANCLA.right }, up: { ...ANCLA.up } } },
    { id: 2, p: { x: 0, y: 0, z: 1 }, polygon: rectangulo(), escala: ESCALA, baseMundo: { ...ANCLA, right: { ...ANCLA.right }, up: { ...ANCLA.up } } },
  ];
  const anillos = contornosDeVertices(nodes, { closed: false, subdivisions: 5, escala: ESCALA });
  const ext = extension(anillos[0]);
  // La anilla del vértice 1 queda desplazada EXACTAMENTE por la
  // excentricidad (rectángulo centrado → su centro = p + exc).
  const okc = cerca(ext.centro[0], exc.x, 1e-3) && cerca(ext.centro[1], exc.y, 1e-3) && cerca(ext.centro[2], exc.z, 1e-3);
  okc ? ok(`anilla del vértice 1 centrada en p+exc (${exc.x}, ${exc.y}, ${exc.z})`)
    : fallo(`centro de la anilla excéntrica en (${ext.centro[0].toFixed(4)}, ${ext.centro[1].toFixed(4)}, ${ext.centro[2].toFixed(4)})`);
  // La anilla del vértice 2 (sin excentricidad) sigue centrada en SU
  // vértice: el desvío no se contagia al trazado.
  const ext2 = extension(anillos[1]);
  cerca(ext2.centro[0], 0, 1e-3) && cerca(ext2.centro[1], 0, 1e-3)
    ? ok('la anilla del vértice 2 sigue centrada en el trazado')
    : fallo(`el desvío se contagió: centro 2 en (${ext2.centro[0].toFixed(4)}, ${ext2.centro[1].toFixed(4)})`);
  // Tamaño intacto pese a la excentricidad.
  const ancho = ext.max[0] - ext.min[0];
  cerca(ancho, 0.8, 1e-3) ? ok(`el tamaño no cambia con la excentricidad (${ancho.toFixed(4)})`)
    : fallo(`ancho de la anilla excéntrica ${ancho.toFixed(4)}`);
}

console.log('═══ GIRO REAL de la plantilla (tiltX/tiltY): la barra / ||| ═══');
{
  // Reporte del usuario 15/10: la plantilla debe poder INCLINARSE de verdad
  // hacia la plantilla vecina (la barra / |||), no solo acortarse a escuadra.
  // Camino por +Z (la plantilla vecina queda en +Z), rectángulo alto:
  // con tiltX=90 la parte ALTA de la anilla (+Y) se lanza a +Z (siguiente);
  // con −90, hacia el vértice ANTERIOR (−Z). Con tiltY=90 es el ANCHO (±X)
  // el que se inclina hacia la tangente.
  const ESCALA = 0.5;
  const rectAlto = [
    { x: 0.5 - 0.2, y: 0.5 - 0.4 },
    { x: 0.5 + 0.2, y: 0.5 - 0.4 },
    { x: 0.5 + 0.2, y: 0.5 + 0.4 },
    { x: 0.5 - 0.2, y: 0.5 + 0.4 },
  ];
  const gira = (tiltX, tiltY) => contornosDeVertices(
    [
      { id: 1, p: { x: 0, y: 0, z: 0 }, polygon: rectAlto.map((q) => ({ ...q })), escala: ESCALA, tiltX, tiltY },
      { id: 2, p: { x: 0, y: 0, z: 1 }, polygon: rectAlto.map((q) => ({ ...q })), escala: ESCALA },
    ],
    { closed: false, subdivisions: 5, escala: ESCALA }
  )[0];
  // Dirección y tamaño: los anillos comparten el orden de remuestreo, así
  // que la coordenada del anillo PLANO que vivía en el eje que se gira
  // (X del anillo = la parte que lanza el tiltX) se correlaciona con la Z
  // que gana el anillo inclinado — el signo revela hacia qué vértice se
  // lanza esa esquina (vecino siguiente +Z o anterior −Z).
  const correla = (base, lean, eje) => {
    let s = 0;
    for (let k = 0; k < base.length; k++) s += base[k][eje] * lean[k].z;
    return s;
  };
  // (base[k] es V3: los ejes se pasan como 'x'/'y'/'z'.)
  const n0 = gira(0, 0);
  const plano = Math.max(...n0.map((p) => Math.abs(p.z)));
  plano < 1e-9 ? ok(`sin tilt la anilla queda plana (Z máx = ${plano.toExponential(1)})`)
    : fallo(`la anilla sin tilt no es plana: Z máx ${plano.toExponential(2)}`);
  const alto0 = extension(n0);
  const prof = (e) => e.max[2] - e.min[2];
  const mas = gira(90, 0);
  const extMas = extension(mas);
  prof(extMas) > 0.7 ? ok(`tiltX=90: el ALTO sale del plano y va al vecino (prof Z = ${prof(extMas).toFixed(4)})`)
    : fallo(`tiltX=90 no inclina la parte alta hacia el trazado (prof Z = ${prof(extMas).toFixed(4)})`);
  correla(n0, mas, 'x') > 1e-3 ? ok(`tiltX=90: ese lado apunta al vértice SIGUIENTE (Σ x·z = ${correla(n0, mas, 'x').toFixed(4)})`)
    : fallo(`tiltX=90 no apunta al siguiente (Σ x·z = ${correla(n0, mas, 'x').toFixed(4)})`);
  const anti = gira(-90, 0);
  correla(n0, anti, 'x') < -1e-3 ? ok(`tiltX=−90: se lanza al vértice ANTERIOR (Σ x·z = ${correla(n0, anti, 'x').toFixed(4)})`)
    : fallo(`tiltX=−90 no inclina hacia el anterior (Σ x·z = ${correla(n0, anti, 'x').toFixed(4)})`);
  const lat = gira(0, 90);
  const extLat = extension(lat);
  prof(extLat) > 0.3 ? ok(`tiltY=90: el ANCHO se inclina hacia el vecino (prof Z = ${prof(extLat).toFixed(4)})`)
    : fallo(`tiltY=90 no inclina el ancho (prof Z = ${prof(extLat).toFixed(4)})`);
  // A 90° el plano inclinado guarda su tamaño (sin el recorte ·cos de
  // antes): la medida que gira (el alto del dibujo, 0.4·2·0.5·2 = 0.8 en el
  // anillo plano) reaparece COMPLETA a lo largo del trazado.
  cerca(alto0.max[0] - alto0.min[0], prof(extMas), 5e-3)
    ? ok(`el tamaño se conserva al inclinarse (alto ${alto0.max[0] - alto0.min[0]} = su Z ganada ${prof(extMas).toFixed(4)})`)
    : fallo(`el giro recortó la anilla: alto ${alto0.max[0] - alto0.min[0]} → Z ganada ${prof(extMas).toFixed(4)}`);
}

console.log('═══ El trazado atraviesa la plantilla A ESCUADRA ═══');
{
  // Invariante del barrido (la regla geométrica de la herramienta): en el
  // cruce de cada vértice, el segmento entra PERPENDICULAR a la anilla —
  // toda la anilla vive en el plano ⟂ a la tangente local del camino. Se
  // comprueba con un trazado CURVADO (la tangente cambia de segmento a
  // segmento) y sin ningún ancla: vale para plantillas a mano y calcadas.
  const ESCALA = 0.5;
  const nodes = [
    { id: 1, p: { x: 0, y: 0, z: 0 }, polygon: rectangulo(0.6), escala: ESCALA },
    { id: 2, p: { x: 1, y: 1, z: 1 }, polygon: rectangulo(), escala: ESCALA },
    { id: 3, p: { x: 2, y: 0, z: 0 }, polygon: rectangulo(0.7, 0.4), escala: ESCALA },
  ];
  const SUB = 5;
  const anillos = contornosDeVertices(nodes, { closed: false, subdivisions: SUB, escala: ESCALA });
  const muestras = muestrearSpline(nodes, false, SUB);
  let maxDot = 0;
  for (let j = 0; j < anillos.length; j++) {
    // Índice del cruce del vértice j (abierto: el último es la muestra final).
    const idx = j === anillos.length - 1 ? muestras.length - 1 : j * SUB;
    const a = muestras[Math.max(0, idx - 1)].pos;
    const b = muestras[Math.min(muestras.length - 1, idx + 1)].pos;
    const t = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const l = Math.hypot(t.x, t.y, t.z) || 1;
    // Centro de la propia anilla (el desvío no participa: TODO el anillo,
    // también excéntrico, vive en el plano ⟂ a la tangente).
    let cx = 0, cy = 0, cz = 0;
    for (const p of anillos[j]) { cx += p.x; cy += p.y; cz += p.z; }
    const n = anillos[j].length;
    cx /= n; cy /= n; cz /= n;
    for (const p of anillos[j]) {
      maxDot = Math.max(
        maxDot,
        Math.abs(((p.x - cx) * t.x + (p.y - cy) * t.y + (p.z - cz) * t.z) / l)
      );
    }
  }
  maxDot < 1e-6 ? ok(`las 3 anillas viven ⟂ al trazado en su cruce (máx |p−c|·t = ${maxDot.toExponential(1)})`)
    : fallo(`el trazado no entra a escuadra: máx |p−c|·t = ${maxDot.toFixed(6)}`);
}

console.log('═══ Malla completa con anclas frontales ═══');
{
  const ESCALA = 0.5;
  const nodes = [
    { id: 1, p: { x: 0, y: 0, z: 0 }, polygon: rectangulo(), escala: ESCALA, baseMundo: { ...ANCLA, right: { ...ANCLA.right }, up: { ...ANCLA.up } } },
    { id: 2, p: { x: 0.2, y: 0.1, z: 0.5 }, polygon: rectangulo(0.6), escala: ESCALA, baseMundo: { ...ANCLA, right: { ...ANCLA.right }, up: { ...ANCLA.up } } },
    { id: 3, p: { x: 0, y: 0, z: 1 }, polygon: rectangulo(), escala: ESCALA, baseMundo: { ...ANCLA, right: { ...ANCLA.right }, up: { ...ANCLA.up } } },
  ];
  const malla = buildSpline3DMesh(nodes, { closed: false, subdivisions: 5, escala: ESCALA });
  const todoFinito = malla.vertices.every((v) => [
    Number.isFinite(v.x), Number.isFinite(v.y), Number.isFinite(v.z),
  ].every(Boolean));
  todoFinito && malla.faces.length > 0 ? ok(`malla construida: ${malla.vertices.length} vértices, ${malla.faces.length} caras, todo finito`)
    : fallo('malla rota (vacía o con NaN)');
}

if (fallos === 0) console.log('\n✔ Todo en verde');
else {
  console.log(`\n✘ ${fallos} comprobaciones en rojo`);
  process.exit(1);
}