/**
 * Verificación numérica del CORTE RÁPIDO (mallas enormes del botón
 * Seleccionar) y de las cachés O(1) de grupos del visor:
 *  1. getVertexGroup coincide con la búsqueda bruta (vértices DUPLICADOS
 *     como los de un OBJ importado sin soldar).
 *  2. getEdgeGroup (partición de líneas de coplanares) coincide con la
 *     BFS bruta con la semántica original.
 *  3. RENDIMIENTO: 300k vértices duplicados + 100k consultas en segundos
 *     (antes cada consulta re-escaneaba TODA la malla: horas).
 *  4. Mapeo triángulo→cara lógica (regla del abanico de meshToTriangles)
 *     + borrarCarasRegion: el camino que recorre el corte rápido del
 *     editor para mallas quad (.zeus) y para OBJ (identidad).
 *
 * Uso: node scripts/verificar-3d/corte-rapido-check.mjs
 * (requiere el bundle generado antes por esbuild: viewer-bundle.cjs)
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const raiz = path.resolve(import.meta.dirname, '../..');
const viewer = require(path.join(raiz, 'scripts/verificar-3d/viewer-bundle.cjs'));
const { deriveMeshEdges, getEdgeGroup, getVertexGroup, meshToTriangles } = viewer;
const { borrarCarasRegion } = require(
  path.join(raiz, 'scripts/verificar-3d/seleccion-bundle.cjs')
);
const v = { deriveMeshEdges, getEdgeGroup, getVertexGroup, meshToTriangles };

let fallos = 0;
const revisar = (cond, descripcion) => {
  if (cond) {
    console.log('  ✓', descripcion);
  } else {
    fallos++;
    console.log('  ✗ FALLO:', descripcion);
  }
};

const iguales = (a, b) =>
  a.slice().sort().join(',') === b.slice().sort().join(','); // sort LÉXICO: las claves de arista son «a-b»

const bruteVertex = (mesh, start) => {
  const s = mesh.vertices[start];
  if (!s) return [start];
  const g = [];
  for (let i = 0; i < mesh.vertices.length; i++) {
    const vt = mesh.vertices[i];
    if (vt && Math.abs(vt.x - s.x) < 1e-5 && Math.abs(vt.y - s.y) < 1e-5 && Math.abs(vt.z - s.z) < 1e-5) {
      g.push(i);
    }
  }
  return g;
};

const bruteEdgeGroup = (mesh, startKey) => {
  // BFS bruta, la MISMA semántica que el getEdgeGroup original:
  // máximo recorrido CONECTADO y COLINEAL con la arista inicial.
  const edges = v.deriveMeshEdges(mesh);
  const edgeMap = new Map(edges.map((e) => [e.key, e]));
  const adj = new Map();
  for (const e of edges) {
    for (const vx of [e.a, e.b]) {
      if (!adj.has(vx)) adj.set(vx, []);
      adj.get(vx).push(e.key);
    }
  }
  const start = edgeMap.get(startKey);
  if (!start) return [startKey];
  const dirDe = (e) => {
    const p1 = mesh.vertices[e.a];
    const p2 = mesh.vertices[e.b];
    if (!p1 || !p2) return null;
    const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
    const l = Math.hypot(dx, dy, dz);
    return l < 0.316 ? null : [dx / l, dy / l, dz / l]; // lengthSq<0.1 → degenerada
  };
  const d0 = dirDe(start);
  if (!d0) return [startKey];
  const grupo = new Set([startKey]);
  const queue = [startKey];
  while (queue.length) {
    const key = queue.shift();
    const e = edgeMap.get(key);
    if (!e) continue;
    for (const vx of [e.a, e.b]) {
      for (const nk of adj.get(vx) || []) {
        if (grupo.has(nk)) continue;
        const dn = dirDe(edgeMap.get(nk));
        if (dn && Math.abs(d0[0] * dn[0] + d0[1] * dn[1] + d0[2] * dn[2]) > 0.99) {
          grupo.add(nk);
          queue.push(nk);
        }
      }
    }
  }
  return Array.from(grupo);
};

// Malla «OBJ sin soldar»: 2 triángulos de UN quad con 6 vértices duplicados.
const dupQuad = {
  vertices: [
    { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 },
    { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }, { x: 0, y: 10, z: 0 },
  ],
  faces: [[0, 1, 2], [5, 4, 3]],
};

console.log('1) getVertexGroup con vértices duplicados (OBJ)');
{
  const g0 = v.getVertexGroup(dupQuad, 0);
  revisar(g0.length === 1 && g0[0] === 0, 'vértice único → grupo de 1');
  const g1 = v.getVertexGroup(dupQuad, 1);
  revisar(iguales(g1, bruteVertex(dupQuad, 1)), 'coincidente compartido (1≈3): grupo de 2 bruto = igual');
  const g4 = v.getVertexGroup(dupQuad, 4);
  revisar(iguales(g4, [2, 4]), 'coincidente compartido (2≈4): grupo de 2');

  // Escalera de quads coplanares (6 cuadrados en fila, triangulados): los
  // recorridos de coplanares son cadenas largas que la partición debe
  // igualar a la BFS bruta.
  const pasos = [];
  const mallaEscalera = { vertices: [], faces: [] };
  let vx = 0;
  const filas = 8;
  const cols = 12;
  const idxDe = (i, j) => i * (cols + 1) + j;
  for (let i = 0; i <= filas; i++) {
    for (let j = 0; j <= cols; j++) {
      mallaEscalera.vertices.push({ x: j * 5, y: i * (i % 2 < 1 ? 3 : 3), z: (i % 2) * 0.001 });
    }
  }
  for (let i = 0; i < filas; i++) {
    for (let j = 0; j < cols; j++) {
      const a = idxDe(i, j), b = idxDe(i, j + 1), c = idxDe(i + 1, j), d = idxDe(i + 1, j + 1);
      mallaEscalera.faces.push([a, b, d], [a, d, c]);
      pasos.push(a);
    }
  }
  const g3 = v.getVertexGroup(mallaEscalera, idxDe(3, 2));
  revisar(iguales(g3, bruteVertex(mallaEscalera, idxDe(3, 2))), 'grupo coincidente en rejilla 9×13 = bruto');
}

console.log('2) getEdgeGroup partición de coplanares = BFS bruta');
{
  const edges = v.deriveMeshEdges(dupQuad);
  revisar(edges.length === 6, 'quad de 2 tris sin soldar: 6 aristas (cada una en su triángulo)');
  for (const e of edges) {
    revisar(iguales(v.getEdgeGroup(dupQuad, e.key), bruteEdgeGroup(dupQuad, e.key)),
      `getEdgeGroup(${e.key}) = bruta`);
  }
  const escalera = { vertices: [], faces: [] };
  const cols = 10, filas = 2;
  const idxDe = (i, j) => i * (cols + 1) + j;
  for (let i = 0; i <= filas; i++) {
    for (let j = 0; j <= cols; j++) {
      escalera.vertices.push({ x: j * 5, y: (i % 2) * 4, z: 0 });
    }
  }
  for (let i = 0; i < filas; i++) {
    for (let j = 0; j < cols; j++) {
      const a = idxDe(i, j), b = idxDe(i, j + 1), c = idxDe(i + 1, j), d = idxDe(i + 1, j + 1);
      escalera.faces.push([a, b, d], [a, d, c]);
    }
  }
  const aristas = v.deriveMeshEdges(escalera);
  let diffs = 0;
  for (const e of aristas) {
    const esperada = bruteEdgeGroup(escalera, e.key);
    if (!iguales(v.getEdgeGroup(escalera, e.key), esperada)) {
      diffs++;
      if (diffs <= 3) {
        console.log(`    DIFF ${e.key}: nuevo=${JSON.stringify(v.getEdgeGroup(escalera, e.key))} bruta=${JSON.stringify(esperada)}`);
      }
    }
  }
  revisar(diffs === 0, `partición de coplanares en rejilla 3×11 (${aristas.length} aristas) = bruta`);
}

console.log('3) RENDIMIENTO (300k vértices duplicados + 100k consultas)');
{
  const TRIS = 100000;
  const mallon = { vertices: [], faces: [] };
  for (let t = 0; t < TRIS; t++) {
    const x = (t % 500) * 1, y = Math.floor(t / 500) * 1;
    mallon.vertices.push({ x, y, z: 0 }, { x: x + 1, y, z: 0 }, { x, y: y + 1, z: 0 });
    mallon.faces.push([t * 3, t * 3 + 1, t * 3 + 2]);
  }
  const t0 = performance.now();
  const primera = v.getVertexGroup(mallon, 3);
  const t1 = performance.now();
  for (let i = 3000; i < 103000; i++) v.getVertexGroup(mallon, i);
  const t2 = performance.now();
  const e0 = performance.now();
  v.deriveMeshEdges(mallon);
  const e1 = performance.now();
  v.deriveMeshEdges(mallon);
  const e2 = performance.now();
  v.getEdgeGroup(mallon, '0-1');
  const e3 = performance.now();
  const total = t2 - t0;
  console.log(`    getVertexGroup 1ª: ${primera.length} grupo en ${(t1 - t0).toFixed(0)}ms; 100k más en ${(t2 - t1).toFixed(0)}ms`);
  console.log(`    deriveMeshEdges 1ª: ${(e1 - e0).toFixed(0)}ms; 2ª: ${(e2 - e1).toFixed(2)}ms; getEdgeGroup primera en ${(e3 - e2).toFixed(0)}ms`);
  revisar(total < 5000, `300k vértices + 100k consultas < 5 s (${(total / 1000).toFixed(2)} s)`);
  revisar(e2 - e1 < 50, 'deriveMeshEdges cacheada: 2ª llamada instantánea');
}

console.log('4) mapeo triángulo→cara lógica (cubo .zeus) + borrarCarasRegion');
{
  const cubo = {
    vertices: [
      { x: -10, y: -10, z: -10 }, { x: 10, y: -10, z: -10 },
      { x: 10, y: 10, z: -10 },   { x: -10, y: 10, z: -10 },
      { x: -10, y: -10, z: 10 },  { x: 10, y: -10, z: 10 },
      { x: 10, y: 10, z: 10 },    { x: -10, y: 10, z: 10 },
    ],
    faces: [
      [0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7],
      [1, 5, 6, 2], [4, 5, 1, 0], [7, 3, 2, 6],
    ],
    faceColors: ['#ffffff', '#ff0000', '#ffffff', '#ffffff', '#ffffff', '#ffffff'],
    faceOpacities: [1, 0.5, 1, 1, 1, 1],
    faceTextures: [null, 'tex.png', null, null, null, null],
    faceTextureGroups: [null, 'g1', null, null, null, null],
  };
  const tris = v.meshToTriangles(cubo);
  revisar(tris.faces.length === 12, 'triMesh: 12 triángulos');
  // Regla EXACTA del triangleToFaceMap del editor: por cara lógica f, los
  // triángulos del abanico son map.push(f) tantas veces como tri ángulos.
  const mapa = [];
  cubo.faces.forEach((face, faceIdx) => {
    for (let i = 1; i < face.length - 1; i++) mapa.push(faceIdx);
  });
  revisar(mapa.length === 12 && mapa.every((f) => f === undefined || (f >= 0 && f < 6)), 'mapa de 12 → caras 0..5');

  // El corte rápido llega con TRI ids [4,5] (cara lógica 2 = izquierda):
  const triZona = [4, 5];
  const region = [...new Set(triZona.map((tx) => mapa[tx]).filter((f) => f !== undefined))];
  revisar(region.join(',') === '2', 'tri 4,5 → cara lógica 2 (izquierda)');
  const hueco = borrarCarasRegion(cubo, region);
  revisar(hueco && hueco.faces.length === 5, 'quedan 5 caras');
  revisar(hueco && hueco.faceColors[2] === '#ffffff', 'colores por cara realineados');
  revisar(hueco && hueco.faceOpacities[2] === 1 && hueco.faceTextures[2] === null, 'opacidad/textura realineadas');

  // OBJ importado: la malla VISTA YA ES la del objeto (mapa identidad).
  const objMalla = { vertices: dupQuad.vertices, faces: dupQuad.faces.map((f) => f.slice()) };
  const regionObj = [1, 1];
  const huecoObj = borrarCarasRegion(objMalla, regionObj);
  revisar(huecoObj && huecoObj.faces.length === 1, 'OBJ: 1 triángulo cortado de 2 (identidad, deduplicado)');
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);