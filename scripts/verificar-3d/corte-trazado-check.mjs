/**
 * Verificación numérica del CORTE POR TRAZADO (botón «Corte», cuchillo
 * poligonal): cortarMallaPorTrazado (lib/corte-malla.ts).
 *
 * Cada caso SIMULA el visor (cámara + raycaster + la matriz local→px) y
 * comprueba la malla resultante:
 *  1. Quad partido por una línea abierta: 2 caras + UV interpolada.
 *  2. Lazo cuadrado sobre la cara de un cubo: 9 piezas, interior = 1,
 *     las 4 aristas de corte forman un anillo CERRADO (cruces soldados).
 *  3. Lazo sobre un plano 5×5: 9 caras interiores, una por celda.
 *  4. Línea abierta sobre el cubo: caras=7 sin selección interior.
 *  5. Soldadura del RINCÓN de la polilínea dentro de una cara grande:
 *     el punto del rincón es UN solo vértice.
 *  6. Herencia de arrays por cara (colores) + UV interpola en el cruce.
 *  7. Segmento degenerado (dos clics casi iguales): sin plano, sin cortar.
 *  8. CRUZAMIENTO de arista compartida entre caras vecinas: UN vértice
 *     común (ortográfica — ventana 2D: rayos paralelos).
 *  9. Snap a VÉRTICE EXISTENTE: la línea pasa exactamente por 2 vértices
 *     del anillo → no se crea NINGÚN vértice nuevo (5 siguen siendo 5).
 *
 * Uso: node scripts/verificar-3d/corte-trazado-check.mjs
 * (requiere el bundle generado antes por esbuild: corte-trazado-bundle.cjs)
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const raiz = path.resolve(import.meta.dirname, '../..');
const THREE = require('three');
const { cortarMallaPorTrazado } = require(
  path.join(raiz, 'scripts/verificar-3d/corte-trazado-bundle.cjs')
);

let fallos = 0;
const revisar = (cond, descripcion) => {
  if (cond) {
    console.log('  ✓', descripcion);
  } else {
    fallos++;
    console.log('  ✗ FALLO:', descripcion);
  }
};

/**
 * SIMULA EL VISOR: como props van a llegar del visor real. La matriz es
 * exactamente la que usará cierraCorteZona: translación al centro del
 * canvas × escala a px (con Y volteada) × proyección × vista × mundo.
 */
function simularTrazado(cam, puntosMalla, cerrado, W = 300, H = 300) {
  cam.updateProjectionMatrix?.();
  cam.updateMatrixWorld();
  const identidad = new THREE.Matrix4();
  const matriz = new THREE.Matrix4()
    .makeTranslation(W / 2, H / 2, 0)
    .multiply(new THREE.Matrix4().makeScale(W / 2, -H / 2, 1))
    .multiply(cam.projectionMatrix)
    .multiply(cam.matrixWorldInverse)
    .multiply(identidad);
  const raycaster = new THREE.Raycaster();
  const trazado = {
    camara: [...cam.position],
    rayos: [],
    pantalla: [],
    matriz: matriz.elements.slice(),
    cerrado,
  };
  for (const p of puntosMalla) {
    const sp = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(matriz);
    trazado.pantalla.push({ x: sp.x, y: sp.y });
    const ndc = new THREE.Vector2((sp.x / W) * 2 - 1, -((sp.y / H) * 2 - 1));
    raycaster.setFromCamera(ndc, cam);
    trazado.rayos.push({
      o: [...raycaster.ray.origin],
      d: [...raycaster.ray.direction],
    });
  }
  return trazado;
}

/** Plano 10×10 de UNA cara (los cruces a los lados del span se rescatan). */
const planoGrande = (extras = {}) => {
  const m = {
    vertices: [
      { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 }, { x: 0, y: 10, z: 0 },
    ],
    faces: [[0, 1, 2, 3]],
    ...extras,
  };
  return m;
};
const camPlano = () => {
  const c = new THREE.PerspectiveCamera(50, 1);
  c.position.set(5, 5, 12);
  c.lookAt(5, 5, 0);
  return c;
};

console.log('1) Quad partido por línea abierta (+ UV interpolada)');
{
  const conUv = planoGrande({
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  });
  const cam = camPlano();
  const trazado = simularTrazado(
    cam, [{ x: 2, y: 5, z: 0 }, { x: 8, y: 5, z: 0 }], false, 200, 200
  );
  // El propio trazado debe proyectar sus esquinas sobre sí mismas.
  const matriz = new THREE.Matrix4().fromArray(trazado.matriz);
  const p0 = new THREE.Vector3(2, 5, 0).applyMatrix4(matriz);
  revisar(
    Math.hypot(p0.x - trazado.pantalla[0].x, p0.y - trazado.pantalla[0].y) < 1e-6,
    'matriz local→px consistente (idempotencia)'
  );
  const r = cortarMallaPorTrazado(conUv, trazado);
  revisar(!('error' in r), 'sin error');
  revisar(r.mesh.vertices.length === 6, `6 vértices (4 + 2 cruces) [${r.mesh.vertices.length}]`);
  revisar(r.mesh.faces.length === 2, `2 caras [${r.mesh.faces.length}]`);
  revisar(r.carasInterior.length === 0, 'línea abierta: sin interior');
  revisar(r.aristasCorte.length === 1, `1 arista de corte [${r.aristasCorte.length}]`);
  const cruce1 = r.mesh.vertices.find(
    (v) => Math.abs(v.x - 0) < 1e-6 && Math.abs(v.y - 5) < 1e-6
  );
  const cruce2 = r.mesh.vertices.find(
    (v) => Math.abs(v.x - 10) < 1e-6 && Math.abs(v.y - 5) < 1e-6
  );
  revisar(!!cruce1 && !!cruce2, 'cruces en los bordes del quad');
  const idxC1 = r.mesh.vertices.indexOf(cruce1);
  const idxC2 = r.mesh.vertices.indexOf(cruce2);
  revisar(
    !!r.mesh.uvs[idxC1] &&
      Math.abs(r.mesh.uvs[idxC1][1] - 0.5) < 1e-9 &&
      r.mesh.uvs[idxC1][0] < 1e-6 &&
      Math.abs(r.mesh.uvs[idxC2][0] - 1) < 1e-9 &&
      Math.abs(r.mesh.uvs[idxC2][1] - 0.5) < 1e-9,
    `UV interpoladas en los cruces [${r.mesh.uvs[idxC1]}, ${r.mesh.uvs[idxC2]}]`
  );
}

console.log('2) Lazo cuadrado sobre la cara frontal → 9 piezas + interior');
{
  // Cara FRONTAL (z=0, anillo hacia −z) + cara TRASERA (z=10, +z):
  // con la cámara en z=−12 SOLO la frontal es frontal.
  const dosCaras = {
    vertices: [
      { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 }, { x: 0, y: 10, z: 0 },
      { x: 0, y: 0, z: 10 }, { x: 10, y: 0, z: 10 },
      { x: 10, y: 10, z: 10 }, { x: 0, y: 10, z: 10 },
    ],
    faces: [[3, 2, 1, 0], [4, 5, 6, 7]],
  };
  const anilloFrontal = dosCaras.faces[0];
  const anilloTrasero = dosCaras.faces[1];
  const cam = new THREE.PerspectiveCamera(50, 1);
  cam.position.set(5, 5, -12);
  cam.lookAt(5, 5, 0);
  const lazo = [
    { x: 2, y: 2, z: 0 }, { x: 8, y: 2, z: 0 },
    { x: 8, y: 8, z: 0 }, { x: 2, y: 8, z: 0 },
  ];
  const r = cortarMallaPorTrazado(dosCaras, simularTrazado(cam, lazo, true));
  revisar(!('error' in r), 'sin error');
  revisar(r.mesh.faces.length === 10, `10 caras (trasera intacta + 9 piezas) [${r.mesh.faces.length}]`);
  // El plano es INFINITO: cada segmento corta la cara por su línea COMPLETA
  // (con rescue) → 8 cruces en aristas del borde + las 4 esquinas del lazo.
  revisar(r.mesh.vertices.length === 20, `20 vértices (8 + 12) [${r.mesh.vertices.length}]`);
  revisar(r.carasInterior.length === 1, `interior = 1 cara [${r.carasInterior.length}]`);
  // El anillo interior ES el lazo (los 4 cruces del rincón).
  const anilloInt = r.mesh.faces[r.carasInterior[0]];
  revisar(anilloInt.length === 4, `el interior es la pieza central del lazo [${anilloInt.length}]`);
  // Anillo de corte del LAZO cerrado: las 4 esquinas con grado exacto 2.
  const grado = new Map();
  for (const clave of r.aristasCorte) {
    const [a, b] = clave.split('-').map(Number);
    grado.set(a, (grado.get(a) ?? 0) + 1);
    grado.set(b, (grado.get(b) ?? 0) + 1);
  }
  // Los 4 vértices del lazo materializados en su sitio y con grado 2
  // (los cruces de borde son grado 1: la extensión del corte hasta el borde).
  for (const [x, y] of [[2, 2], [8, 2], [8, 8], [2, 8]]) {
    const hay = r.mesh.vertices.some((v) => Math.abs(v.x - x) < 1e-6 && Math.abs(v.y - y) < 1e-6 && Math.abs(v.z) < 1e-6);
    revisar(hay, `esquina (${x},${y}) materializada como vértice`);
    const idx = r.mesh.vertices.findIndex(
      (v) => Math.abs(v.x - x) < 1e-6 && Math.abs(v.y - y) < 1e-6 && Math.abs(v.z) < 1e-6
    );
    revisar(grado.get(idx) === 2, `esquina (${x},${y}) con grado 2 (anillo cerrado) [${grado.get(idx)}]`);
  }
  revisar(grado.size === 12, `12 vértices de corte (8 borde + 4 esquinas) [${grado.size}]`);
  // La cara trasera SIN tocar (anillo intacto).
  revisar(
    r.mesh.faces.some(
      (f) => f.length === anilloTrasero.length && f.every((v) => anilloTrasero.includes(v))
    ),
    'la cara trasera intacta'
  );
}

console.log('3) Lazo sobre plano 5×5: 9 caras interiores (una por celda)');
{
  const cols = 5;
  const filas = 5;
  const idxDe = (i, j) => j * (cols + 1) + i;
  const grid = { vertices: [], faces: [] };
  for (let j = 0; j <= filas; j++) {
    for (let i = 0; i <= cols; i++) {
      grid.vertices.push({ x: i * 2, y: j * 2, z: 0 });
    }
  }
  for (let j = 0; j < filas; j++) {
    for (let i = 0; i < cols; i++) {
      grid.faces.push([
        idxDe(i, j), idxDe(i + 1, j), idxDe(i + 1, j + 1), idxDe(i, j + 1),
      ]);
    }
  }
  const cam = camPlano();
  const trazado = simularTrazado(
    cam, [{ x: 3, y: 3, z: 0 }, { x: 7, y: 3, z: 0 }, { x: 7, y: 7, z: 0 }, { x: 3, y: 7, z: 0 }],
    true, 200, 200
  );
  const r = cortarMallaPorTrazado(grid, trazado);
  revisar(!('error' in r), 'sin error');
  revisar(r.carasInterior.length === 9, `interior = 9 caras [${r.carasInterior.length}]`);
  // El interior coincide con las 9 celdas del interior (3×3): un anillo
  // interior con 4 cruces o recortes de sus celdas.
  const centros = new Set();
  for (const fi of r.carasInterior) {
    const an = r.mesh.faces[fi];
    let sx = 0, sy = 0;
    for (const vi of an) {
      sx += r.mesh.vertices[vi].x;
      sy += r.mesh.vertices[vi].y;
    }
    const celda = `${Math.floor(sx / an.length / 2)},${Math.floor(sy / an.length / 2)}`;
    if (celda !== '3,3' && (sx / an.length < 3 || sx / an.length > 7)) {
      centros.add(celda + '?');
    } else {
      centros.add(celda);
    }
  }
  const celdasEsperadas = [];
  for (let j = 1; j <= 3; j++) for (let i = 1; i <= 3; i++) celdasEsperadas.push(`${i},${j}`);
  revisar(
    celdasEsperadas.every((c) => centros.has(c)),
    'cubren las 9 celdas 1..3 × 1..3'
  );
  revisar(centros.size === 9, `sin extrañas [${[...centros].join(' ')}]`);
}

console.log('4) Línea abierta sobre el cubo: sin interior');
{
  const cubo = {
    vertices: [
      { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 }, { x: 0, y: 10, z: 0 },
      { x: 0, y: 0, z: 10 }, { x: 10, y: 0, z: 10 },
      { x: 10, y: 10, z: 10 }, { x: 0, y: 10, z: 10 },
    ],
    faces: [
      [0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7],
      [1, 5, 6, 2], [4, 5, 1, 0], [7, 3, 2, 6],
    ],
  };
  const cam = camPlano();
  const trazado = simularTrazado(
    cam, [{ x: 2, y: 5, z: 0 }, { x: 8, y: 5, z: 0 }], false, 300, 300
  );
  const r = cortarMallaPorTrazado(cubo, trazado);
  revisar(!('error' in r), 'sin error');
  revisar(r.mesh.faces.length === 7, `cara frontal en 2 (7 en total) [${r.mesh.faces.length}]`);
  revisar(r.carasInterior.length === 0, 'sin selección interior');
  revisar(r.aristasCorte.length === 1, 'cuerda única registrada');
}

console.log('5) Rincón de la polilínea SUEDADO en un solo vértice');
{
  const cam = camPlano();
  const trazado = simularTrazado(
    cam, [{ x: 2, y: 5, z: 0 }, { x: 8, y: 5, z: 0 }, { x: 8, y: 8, z: 0 }],
    false, 200, 200
  );
  const r = cortarMallaPorTrazado(planoGrande(), trazado);
  revisar(!('error' in r), 'sin error');
  revisar(r.mesh.faces.length === 4, `4 piezas [${r.mesh.faces.length}]`);
  const esquinas = r.mesh.vertices.filter(
    (v) => Math.abs(v.x - 8) < 1e-6 && Math.abs(v.y - 5) < 1e-6
  );
  revisar(esquinas.length === 1, `el rincón (8,5) es UN vértice [${esquinas.length}]`);
}

console.log('6) Herencia de arrays por cara + UV en cruces (rejilla 2×2)');
{
  const cols = 2;
  const filas = 2;
  const idxDe = (i, j) => j * (cols + 1) + i;
  const grid = {
    vertices: [],
    faces: [],
    uvs: [],
    faceColors: ['#ff0000', '#00ff00', null, null],
    faceOpacities: [0.5, 1, 1, 1],
    faceTextures: ['tx1.png', null, null, 'tx2.png'],
  };
  for (let j = 0; j <= filas; j++) {
    for (let i = 0; i <= cols; i++) {
      grid.vertices.push({ x: i * 2, y: j * 5, z: 0 });
      grid.uvs.push([i / cols, j / filas]);
    }
  }
  for (let j = 0; j < filas; j++) {
    for (let i = 0; i < cols; i++) {
      grid.faces.push([
        idxDe(i, j), idxDe(i + 1, j), idxDe(i + 1, j + 1), idxDe(i, j + 1),
      ]);
    }
  }
  const cam = camPlano();
  const trazado = simularTrazado(
    cam, [{ x: 1, y: 2.5, z: 0 }, { x: 3, y: 2.5, z: 0 }], true, 300, 300
  );
  const r = cortarMallaPorTrazado(grid, trazado);
  revisar(!('error' in r), 'sin error');
  revisar(r.mesh.faceColors.length === r.mesh.faces.length, 'faceColors alineadas con faces');
  // Las mitades de la cara 0 (roja) heredan el color; las de la 1, verde.
  let rojas = 0;
  let verdes = 0;
  r.mesh.faces.forEach((f, i) => {
    const xs = f.map((v) => r.mesh.vertices[v].x);
    if (r.mesh.faceColors[i] === '#ff0000' && xs.every((x) => x <= 2 + 1e-6)) rojas++;
    if (r.mesh.faceColors[i] === '#00ff00' && xs.every((x) => x >= 2 - 1e-6)) verdes++;
  });
  revisar(rojas === 2, `ambas mitades de la cara roja heredan color [${rojas}]`);
  revisar(verdes === 2, `ambas mitades de la cara verde heredan color [${verdes}]`);
  // El cruce sobre la ARISTA COMPARTIDA (2, 2.5): UN solo vértice.
  const compartidos = r.mesh.vertices.filter(
    (v) => Math.abs(v.x - 2) < 1e-6 && Math.abs(v.y - 2.5) < 1e-6
  );
  revisar(compartidos.length === 1, `cruce compartido soldado a 1 vértice [${compartidos.length}]`);
  const vc = r.mesh.vertices.indexOf(compartidos[0]);
  // (2,0) tiene uv [0.5,0] y (2,5) uv [0.5,0.5] → interp en v=2.5/5 = 0.25.
  revisar(
    !!r.mesh.uvs[vc] &&
      Math.abs(r.mesh.uvs[vc][0] - 0.5) < 1e-9 &&
      Math.abs(r.mesh.uvs[vc][1] - 0.25) < 1e-9,
    `UV interpolada en el cruce [${r.mesh.uvs[vc]}]`
  );
}

console.log('7) Segmento degenerado: sin plano, sin cortar');
{
  const cam = camPlano();
  const trazado = simularTrazado(
    cam, [{ x: 2, y: 5, z: 0 }, { x: 2, y: 5, z: 0 }], false, 300, 300
  );
  const r = cortarMallaPorTrazado(planoGrande(), trazado);
  revisar('error' in r && r.error === 'sin-trazado',
    `doble clic = puntos dedupe a 1 → sin-trazado [${'error' in r ? r.error : 'ok'}]`);
}
// Y un trazo de UN punto también es error.
{
  const cam = camPlano();
  const trazado = simularTrazado(cam, [{ x: 2, y: 5, z: 0 }], false, 300, 300);
  const r = cortarMallaPorTrazado(planoGrande(), trazado);
  revisar('error' in r && r.error === 'sin-trazado', `1 punto → sin-trazado [${'error' in r ? r.error : 'ok'}]`);
}

console.log('8) ORTOGRÁFICA (ventana 2D): rayos paralelos, plano por orígenes');
{
  const cols = 2;
  const filas = 2;
  const idxDe = (i, j) => j * (cols + 1) + i;
  const grid = { vertices: [], faces: [] };
  for (let j = 0; j <= filas; j++) {
    for (let i = 0; i <= cols; i++) grid.vertices.push({ x: i * 2, y: j * 5, z: 0 });
  }
  for (let j = 0; j < filas; j++) {
    for (let i = 0; i < cols; i++) {
      grid.faces.push([
        idxDe(i, j), idxDe(i + 1, j), idxDe(i + 1, j + 1), idxDe(i, j + 1),
      ]);
    }
  }
  const cam = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 100);
  cam.position.set(4, 5, 10);
  cam.lookAt(4, 5, 0);
  // Línea vertical x=1 que CRUZA la rejilla entera (y de −1 a 11).
  const trazado = simularTrazado(
    cam, [{ x: 1, y: -1, z: 0 }, { x: 1, y: 11, z: 0 }], false, 300, 300
  );
  const r = cortarMallaPorTrazado(grid, trazado);
  revisar(!('error' in r), 'sin error en ortográfica');
  revisar(r.mesh.faces.length === 6, `la celda f0 y f2 en 2 cada una (6 en total) [${r.mesh.faces.length}]`);
  revisar(
    r.mesh.vertices.filter((v) => Math.abs(v.x - 1) < 1e-6).length === 3,
    '3 cruces en x=1 (y=0, y=5 compartido, y=10)'
  );
}

console.log('9) Snap a VÉRTICE EXISTENTE: línea por 2 vértices del anillo');
{
  // Rombo: la línea x=5 pasa EXACTAMENTE por los vértices (5,0) y (5,10).
  const rombo = {
    vertices: [
      { x: 5, y: 0, z: 0 }, { x: 10, y: 5, z: 0 },
      { x: 5, y: 10, z: 0 }, { x: 0, y: 5, z: 0 },
    ],
    faces: [[0, 1, 2, 3]],
  };
  const cam = camPlano();
  const trazado = simularTrazado(
    cam, [{ x: 5, y: -1, z: 0 }, { x: 5, y: 11, z: 0 }], false, 300, 300
  );
  const r = cortarMallaPorTrazado(rombo, trazado);
  revisar(!('error' in r), 'sin error');
  revisar(r.mesh.vertices.length === 4, `SIN vértices nuevos (4 = 4) [${r.mesh.vertices.length}]`);
  revisar(r.mesh.faces.length === 2, `2 mitades [${r.mesh.faces.length}]`);
  revisar(r.aristasCorte.length === 1, '1 cuerda registrada (entre los 2 vértices del anillo)');
  revisar(
    r.aristasCorte[0] === '0-2' || r.aristasCorte[0] === '2-0',
    `la cuerda une (5,0) y (5,10) [${r.aristasCorte[0]}]`
  );
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);