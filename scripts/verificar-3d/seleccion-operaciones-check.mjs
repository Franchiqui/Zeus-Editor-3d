/**
 * Verificación numérica de las operaciones de selección por zona
 * (lib/seleccion-operaciones.ts): borrarCarasRegion, submallaDeRegion
 * y hornearEnMundo, sobre un cubo lógico (8 vértices, 6 caras cuadradas
 * con arrays por cara y UV) como el que guardan los .zeus.
 *
 * Uso: node scripts/verificar-3d/seleccion-operaciones-check.mjs
 * (requiere el bundle generado antes por esbuild: seleccion-bundle.cjs)
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const raiz = path.resolve(import.meta.dirname, '../..');
const { borrarCarasRegion, submallaDeRegion, hornearEnMundo } = require(
  path.join(raiz, 'scripts/verificar-3d/seleccion-bundle.cjs')
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

// Cubo lógico: 8 vértices, 6 caras (índices compartidos), 1 cara de otro
// color/textura para probar el realineado de los arrays por cara.
const V = [
  { x: -10, y: -10, z: -10 }, { x: 10, y: -10, z: -10 },
  { x: 10, y: 10, z: -10 },   { x: -10, y: 10, z: -10 },
  { x: -10, y: -10, z: 10 },  { x: 10, y: -10, z: 10 },
  { x: 10, y: 10, z: 10 },    { x: -10, y: 10, z: 10 },
];
const F = [
  [0, 1, 2, 3], // trasera  (z-)
  [5, 4, 7, 6], // frente   (z+)
  [4, 0, 3, 7], // izquierda (x-)
  [1, 5, 6, 2], // derecha  (x+)
  [4, 5, 1, 0], // abajo    (y-)
  [7, 3, 2, 6], // arriba   (y+)
];
const cubo = {
  vertices: V,
  faces: F,
  faceColors: F.map((_, i) => (i === 1 ? '#ff0000' : '#ffffff')),
  faceOpacities: F.map((_, i) => (i === 1 ? 0.5 : 1)),
  faceTextures: F.map((_, i) => (i === 1 ? 'tex.png' : null)),
  faceTextureGroups: F.map((_, i) => (i === 1 ? 'g1' : null)),
  uvs: V.map((_, i) => [i / 8, i % 2 / 2 + 0.25]),
};

console.log('1) borrarCarasRegion');
{
  const r = borrarCarasRegion(cubo, [1]); // quita la frente (cara 1)
  revisar(r && r.faces.length === 5, 'quedan 5 caras');
  revisar(r && r.faces[0][0] === 0 && r.faces[0][3] === 3, 'la trasera intacta en índice 0');
  revisar(r && r.faceColors[0] === '#ffffff', 'color de la cara 0 realineado');
  revisar(r && r.faceColors[1] === '#ffffff', 'el color ROJO de la cara 1 borrada no queda');
  revisar(r && r.faceOpacities[1] === 1, 'opacidad realineada (no la 0.5 de la borrada)');
  revisar(r && r.faceTextures[1] === null, 'textura realineada');
  revisar(r && r.faceTextureGroups[1] === null, 'grupo de textura realineado');
  revisar(r && r.vertices.length === 8, 'vértices intactos (huérfanos permitidos)');
  revisar(r && r.uvs.length === 8, 'uvs intactas');
  revisar(borrarCarasRegion(cubo, []) === null, 'región vacía → null');
  revisar(borrarCarasRegion(cubo, [0, 1, 2, 3, 4, 5]) === null, 'toda la malla → null');
  revisar(borrarCarasRegion(cubo, [1, 1])?.faces.length === 5, 'duplicados de región deduplicados');
}

console.log('2) submallaDeRegion');
{
  const r = submallaDeRegion(cubo, [0, 1]); // trasera + frente (paralelas)
  // Comparten los 4 vértices... NO: [0..3] y [4..7] son disjuntos → 8 vértices.
  revisar(r && r.mesh.vertices.length === 8, '2 caras paralelas = 8 vértices únicos');
  revisar(r && r.mesh.faces.length === 2, '2 caras');
  revisar(
    r && r.mapaVertices.get(4) !== undefined && r.mapaVertices.size === 8,
    'mapaVertices cubre los 8 originales'
  );
  revisar(
    r && r.mesh.uvs && r.mesh.uvs.length === 8 &&
    Math.abs(r.mesh.uvs[r.mapaVertices.get(5)][0] - 5 / 8) < 1e-9,
    'uv del vértice 5 remapeado correcto (5/8)'
  );
  revisar(r && r.mesh.faceColors[1] === '#ff0000', 'color rojo de la cara 1 viaja');
  revisar(r && r.mesh.faceOpacities[1] === 0.5, 'opacidad 0.5 viaja');

  const contiguas = submallaDeRegion(cubo, [0, 3]); // trasera + derecha comparten [1,2]
  revisar(
    contiguas && contiguas.mesh.vertices.length === 6,
    '2 caras contiguas = 6 vértices (comparten 2)'
  );
  revisar(contiguas && contiguas.mesh.faces.every((f) => f.every((v) => v < 6)),
    'índices remapeados a 0..5');
  revisar(submallaDeRegion(cubo, []) === null, 'región vacía → null');
  revisar(submallaDeRegion(cubo, [99]) === null, 'fuera de rango → null');
}

console.log('3) hornearEnMundo');
{
  const { mesh, transform } = hornearEnMundo(cubo, {
    px: 100, py: 50, pz: -20, rx: 0, ry: Math.PI / 2, rz: 0, sx: 2, sy: 1, sz: 1,
  });
  // Con ry=90°, escala x2: el eje local x (largo 20 → 40) va a mundo Z.
  revisar(mesh.vertices.length === 8, '8 vértices horneados');
  revisar(
    transform.px === 100 && transform.py === 50 && transform.pz === -20,
    'pivote en el centro mundial del objeto'
  );
  revisar(transform.rx === 0 && transform.ry === 0 && transform.rz === 0, 'rotación a 0');
  revisar(transform.sx === 1 && transform.sy === 1 && transform.sz === 1, 'escala a 1');
  // Receta exacta con ry=90°: mundo = R(ry90)·(2x, y, z) + (100, 50, -20),
  // R(ry90): (x,y,z) → (z, y, -x) → mundo = (z+100, y+50, -2x-20).
  // El pivote ES el centro de la caja, así que el vértice horneado es
  // mundo - centro = (z, y, -2x).
  const esperadoLocal = (v) => ({ x: v.z, y: v.y, z: -2 * v.x });
  const maxDif = Math.max(
    ...mesh.vertices.map((w, i) => {
      const e = esperadoLocal(V[i]);
      return Math.max(Math.abs(w.x - e.x), Math.abs(w.y - e.y), Math.abs(w.z - e.z));
    })
  );
  revisar(maxDif < 1e-6, `vértices = T·R·S - centro (dif máx ${maxDif.toPrecision(3)})`);
  revisar(mesh.faceColors && mesh.faceColors.length === 6, 'arrays por cara copiados');
  revisar(mesh.uvs && mesh.uvs.length === 8, 'uvs copiadas');
  const vacio = hornearEnMundo({ ...cubo, vertices: [], faces: [] });
  revisar(vacio.mesh.vertices.length === 0, 'malla vacía sin romperse');
}

console.log(fallos === 0 ? 'TODO OK' : `FALLOS: ${fallos}`);
process.exit(fallos === 0 ? 0 : 1);