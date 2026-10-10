// Prueba extremo a extremo del suelo real de Romper: replica EXACTAMENTE
// paramsSueloLocal de components/editor/Editor3D.tsx (Matrix4 compose +
// invert + secante) y comprueba que, tras aplicarDeformador('romper', ...)
// con caida 100, TODOS los pedazos tocan el plano visible del mundo
// (y = -1.05) para varios transforms del objeto.
import * as THREE from 'three';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { aplicarDeformador, DEFORMADORES_DIRECTOS } = require('./deform-bundle.cjs');

// Malla cubo 2x2 (12 caras) como la del check principal.
function cubo() {
  const v = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1])
    v.push({ x, y, z });
  const idx = (x, y, z) => v.findIndex((p) => p.x === x && p.y === y && p.z === z);
  const caras = [];
  const rangos = [-1, 1];
  for (const s of rangos) {
    caras.push([idx(-1, s, -1), idx(1, s, -1), idx(1, s, 1), idx(-1, s, 1)]);
    caras.push([idx(s, -1, -1), idx(s, 1, -1), idx(s, 1, 1), idx(s, -1, 1)]);
    caras.push([idx(-1, -1, s), idx(1, -1, s), idx(1, 1, s), idx(-1, 1, s)]);
  }
  const n = caras.length;
  return {
    vertices: v,
    faces: caras,
    faceColors: Array.from({ length: n }, () => '#cc4444'),
    faceOpacities: Array.from({ length: n }, () => 1),
    faceTextures: Array.from({ length: n }, () => null),
    faceTextureGroups: Array.from({ length: n }, () => null),
  };
}

// Réplica literal de paramsSueloLocal (Editor3D): normal del plano =
// gradiente de la y-mundo en local = Lᵀ·ĵ (fila lineal 2 de la matriz).
function paramsSueloLocal(t) {
  const SUELO_MUNDO = -1.05;
  const mat = new THREE.Matrix4().compose(
    new THREE.Vector3(t.px, t.py, t.pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rx, t.ry, t.rz)),
    new THREE.Vector3(t.sx, t.sy, t.sz)
  );
  const p0 = new THREE.Vector3(0, SUELO_MUNDO, 0).applyMatrix4(
    mat.clone().invert()
  );
  const e = mat.elements;
  const u = new THREE.Vector3(e[1], e[5], e[9]);
  if (u.lengthSq() < 1e-12) return {};
  u.normalize();
  return { sueloUx: u.x, sueloUy: u.y, sueloUz: u.z, sueloD: u.dot(p0) };
}

const D2R = Math.PI / 180;
const CASOS = [
  { nombre: 'identidad (objeto apoyado)', t: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 } },
  { nombre: 'flotando py=2', t: { px: 0, py: 2, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 } },
  { nombre: 'flotando + escala (py=2, sy=2)', t: { px: 0, py: 2, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 2, sz: 1 } },
  { nombre: 'tumbado rx=90°', t: { px: 0, py: 1, pz: 0, rx: 90 * D2R, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 } },
  { nombre: 'girado ry=35° + flotando', t: { px: 0.5, py: 1.4, pz: -0.7, rx: 0, ry: 35 * D2R, rz: 0, sx: 1, sy: 1, sz: 1 } },
  { nombre: 'inclinado rz=25° + escala no uniforme', t: { px: -0.3, py: 0.8, pz: 0.4, rx: 0, ry: 0, rz: 25 * D2R, sx: 1.4, sy: 0.7, sz: 1 } },
  { nombre: 'mixto rx=20° ry=-30° pz=1 escala 1.2', t: { px: 0, py: 0.5, pz: 1, rx: 20 * D2R, ry: -30 * D2R, rz: 0, sx: 1.2, sy: 1.2, sz: 1.2 } },
];

const SUELO_MUNDO = -1.05;
let fallos = 0;
for (const caso of CASOS) {
  const ocultos = paramsSueloLocal(caso.t);
  const mat = new THREE.Matrix4().compose(
    new THREE.Vector3(caso.t.px, caso.t.py, caso.t.pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(caso.t.rx, caso.t.ry, caso.t.rz)),
    new THREE.Vector3(caso.t.sx, caso.t.sy, caso.t.sz)
  );
  const params = {
    fuerza: 150, caida: 100, giroVelocidad: 90, tamanoFinal: 100,
    aleatoriedad: 50, semilla: 42, ...ocultos,
  };
  const salida = aplicarDeformador('romper', cubo(), params);
  // Vértices al mundo y alto sobre el suelo = y del mundo.
  const errores = [];
  let flotando = 0;
  for (const v of salida.vertices) {
    const w = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(mat);
    if (w.y > SUELO_MUNDO + 1e-6) flotando++;
  }
  const ok = flotando === 0;
  if (!ok) fallos++;
  console.log(`${ok ? 'OK ' : 'MAL'} ${caso.nombre}: ${salida.faces.length} caras, vértices sobre el suelo: ${flotando}/${salida.vertices.length}${flotando ? ` (exceso máx: ${Math.max(...salida.vertices.map((v) => new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(mat).y - SUELO_MUNDO)).toFixed(6)})` : ''}`);
}
console.log(fallos === 0 ? 'TODO OK' : `${fallos} CASOS FALLAN`);