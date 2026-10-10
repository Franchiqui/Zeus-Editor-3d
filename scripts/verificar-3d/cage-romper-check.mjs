// ¿Qué hace el deformador Romper (y Suavizado/Bisel, que necesitan
// topología) sobre la CAGE ({vertices, faces: []})? Los síntomas del
// usuario (la cage amarilla «se deforma de forma distinta») encajan con
// un deformador que ignora/desbarata la cage sin caras.
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const raiz = path.resolve(process.cwd());
const { aplicarDeformador, DEFORMADORES_DIRECTOS } = require(
  path.join(raiz, 'scripts/verificar-3d/deform-bundle.cjs')
);

// Caja 2×2×2 con aristas muestreadas (como la cage real).
const esquinas = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) esquinas.push({ x, y, z });
const aristas = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[3,7],[2,6]];
const muestras = [];
for (const [a, b] of aristas)
  for (let i = 0; i < 24; i++) {
    const t = i / 23;
    muestras.push({
      x: esquinas[a].x + (esquinas[b].x - esquinas[a].x) * t,
      y: esquinas[a].y + (esquinas[b].y - esquinas[a].y) * t,
      z: esquinas[a].z + (esquinas[b].z - esquinas[a].z) * t,
    });
  }
const neutro = (id) => {
  const def = DEFORMADORES_DIRECTOS.find((d) => d.id === id);
  const n = {};
  if (def) for (const p of def.params) n[p.id] = p.valor;
  return n;
};

const caja = { vertices: muestras.map((v) => ({ ...v })), faces: [] };
const PARAMS = { fuerza: 150, giroVelocidad: 90, tamanoFinal: 100, aleatoriedad: 50, semilla: 42, caida: 0 };
const salida = aplicarDeformador('romper', caja, PARAMS);
let maxDesplaza = 0, moved = 0;
for (let i = 0; i < muestras.length; i++) {
  const d = Math.hypot(salida.vertices[i].x - muestras[i].x, salida.vertices[i].y - muestras[i].y, salida.vertices[i].z - muestras[i].z);
  if (d > 1e-9) moved++;
  maxDesplaza = Math.max(maxDesplaza, d);
}
console.log(`romper sobre cage ({vertices, faces: []}): muestras movidas ${moved}/${muestras.length}, desplazamiento máx ${maxDesplaza.toFixed(4)}`);
console.log(moved > 0 ? '→ la cage SÍ se deforma (no coincide con sintoma)' : '→ la cage NO se mueve en romper: encaja con «la cage se deforma distinta»');