// E2e del suelo ANIMADO: réplica del paso 3.5 del visor — una pista de
// transformada mueve el objeto (py 0→2, y un caso con rz + escala no
// uniforme animada) y se aplicaDeformador('romper') con los params
// evaluados + paramsSueloLocal del transform COMPLETO del tiempo.
// En cada muestreo TODOS los pedazos deben tocar el suelo (y = -1.05).
import * as THREE from 'three';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { aplicarDeformador } = require('./deform-bundle.cjs');
const anim = require('./anim-bundle.cjs');

const SUELO_MUNDO = -1.05;
const D2R = Math.PI / 180;

// Malla cubo 2x2 (12 caras), como romper-suelo-e2e.
function cubo() {
  const v = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1])
    v.push({ x, y, z });
  const idx = (x, y, z) => v.findIndex((p) => p.x === x && p.y === y && p.z === z);
  const caras = [];
  for (const s of [-1, 1]) {
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

// Réplica literal de paramsSueloLocal (ahora EXPORTADA en viewer-3d.tsx).
function paramsSueloLocal(t) {
  const mat = new THREE.Matrix4().compose(
    new THREE.Vector3(t.px ?? 0, t.py ?? 0, t.pz ?? 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0)),
    new THREE.Vector3(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1)
  );
  const p0 = new THREE.Vector3(0, SUELO_MUNDO, 0).applyMatrix4(mat.clone().invert());
  const e = mat.elements;
  const u = new THREE.Vector3(e[1], e[5], e[9]);
  if (u.lengthSq() < 1e-12) return {};
  u.normalize();
  return { sueloUx: u.x, sueloUy: u.y, sueloUz: u.z, sueloD: u.dot(p0) };
}

// Pista de transformada ANIMADA del objeto: sube flotando py 0→2.
const tTrack = {
  id: 'ttrack-anim',
  objectId: 'obj1',
  looping: false,
  duration: 10,
  keyframes: [
    {
      time: 0,
      values: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 25 * D2R, sx: 1.4, sy: 0.7, sz: 1 },
      easing: 'linear',
    },
    {
      time: 10,
      values: { px: 0.5, py: 2, pz: -0.4, rx: 20 * D2R, ry: -30 * D2R, rz: 25 * D2R, sx: 1.4, sy: 0.7, sz: 1 },
      easing: 'linear',
    },
  ],
};
const transformEstatica = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };

// Pista de deformador animada: romper con fuerza y caída fijas.
const dTrack = {
  id: 'dtrack-anim',
  objectId: 'obj1',
  deformadorId: 'romper',
  looping: false,
  duration: 10,
  keyframes: [
    { time: 0, values: { fuerza: 150, caida: 100, aleatoriedad: 50, tamanoFinal: 100, semilla: 42 }, easing: 'linear' },
    { time: 10, values: { fuerza: 150, caida: 100, aleatoriedad: 50, tamanoFinal: 100, semilla: 42 }, easing: 'linear' },
  ],
};

let fallos = 0;
for (const tt of [0, 0.5, 1]) {
  const time = tt * 10;
  // Paso 1: transform COMPLETO del tiempo (nunca parcial).
  const evaluado = anim.evaluateTransformTrack(tTrack, time) ?? {};
  const transf = { ...transformEstatica, ...evaluado };
  const mat = new THREE.Matrix4().compose(
    new THREE.Vector3(transf.px, transf.py, transf.pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(transf.rx, transf.ry, transf.rz)),
    new THREE.Vector3(transf.sx, transf.sy, transf.sz)
  );
  // Paso 2: params evaluados del deformador + suelo oculto.
  const sampled = anim.evaluateDeformadorTrack(dTrack, time) ?? {};
  const params = {
    fuerza: 0, caida: 0, giroVelocidad: 0, tamanoFinal: 100, aleatoriedad: 50, semilla: 42,
    ...sampled,
    ...paramsSueloLocal(transf),
  };
  const salida = aplicarDeformador('romper', cubo(), params);
  let flotando = 0;
  for (const v of salida.vertices) {
    const w = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(mat);
    if (w.y > SUELO_MUNDO + 1e-6) flotando++;
  }
  const ok = flotando === 0;
  if (!ok) fallos++;
  console.log(`t=${tt.toFixed(1)} ${ok ? 'OK ' : 'MAL'}: pedazos ${salida.faces.length} caras, ${flotando}/${salida.vertices.length} en el aire, py=${transf.py.toFixed(2)}, rz=${((transf.rz ?? 0) / D2R).toFixed(0)}°`);
}
console.log(fallos === 0 ? 'TODO OK' : `${fallos} MUESTREOS FALLAN`);
process.exit(fallos === 0 ? 0 : 1);