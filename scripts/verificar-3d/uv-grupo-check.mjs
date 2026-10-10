/**
 * Texturas al DEFORMAR GRUPO: si los miembros MEZCLAN (uno con UVs y otro
 * sin), el reparto NO debe inventar UVs [0,0] para el miembro sin ellas:
 * el constructor del visual las usa tal cual (proyeccion planar) y la
 * textura colapsa a un texel ("pierde la textura").
 *
 * Reproduce: unir A (con UVs) + B (sin UVs, textura planar) -> repartir ->
 * buildSnapshotObjectVisual (EXACTO al visor) -> UV del visual de B.
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const raiz = path.resolve(import.meta.dirname, '../..');

// El TextureLoader de THREE necesita un <img> del DOM; en node basta un
// esqueleto para asegurar el ATRIBUTO uv (que se llena sincrono).
if (typeof document === 'undefined') {
  globalThis.document = {
    createElementNS: () => ({ addEventListener() {}, style: {} }),
  };
}

const { buildSnapshotObjectVisual } = require(
  path.join(raiz, 'scripts/verificar-3d/viewer-bundle.cjs')
);
const {
  unirMallasComoGrupo,
  repartirGrupoDeformado,
  aplicarDeformador,
} = require(path.join(raiz, 'scripts/verificar-3d/deform-bundle.cjs'));

let fallos = 0;
const revisar = (cond, desc) => {
  console.log((cond ? '  OK  ' : '  X FALLO  ') + desc);
  if (!cond) fallos++;
};

// Cubo unitario 0..1 SIN UVs
const cubo = () => {
  const v = [];
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) v.push({ x, y, z });
  const F = (a) => [a[0], a[1], a[2], a[3]];
  const faces = [
    F([0, 1, 3, 2]), F([4, 6, 7, 5]), F([0, 2, 6, 4]),
    F([1, 5, 7, 3]), F([0, 4, 5, 1]), F([2, 3, 7, 6]),
  ];
  return { vertices: v, faces };
};

// Miembro A: CON UVs; Miembro B: SIN UVs, textura por proyeccion planar.
const uvsA = cubo().vertices.map((v) => [v.x, v.y]);
const mA = { ...cubo(), uvs: uvsA, texture: '/textures/a.jpg', textureRepeat: 1 };
const mB = { ...cubo(), texture: '/textures/b.jpg', textureRepeat: 1 };
const A = { id: 'A', mesh: mA, transform: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 } };
const B = { id: 'B', mesh: mB, transform: { px: 0, py: 1.5, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 } };
const marco = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };

const union = unirMallasComoGrupo([A, B], marco);
const deformada = aplicarDeformador('doblar', union.unida, { angulo: 60 });
const porMiembro = repartirGrupoDeformado(union, deformada);
const parteB = porMiembro.find((p) => p.id === 'B');
const parteA = porMiembro.find((p) => p.id === 'A');

console.log('B original uvs: ' + (mB.uvs ? 'SI' : 'NO') + ' / B repartido uvs: ' + (parteB.mesh.uvs ? 'EXISTE(' + parteB.mesh.uvs.length + ')' : 'AUSENTE'));

// 1) El repartido de B NO debe llevar array de uvs si B no tenia.
revisar(!parteB.mesh.uvs, 'reparto: miembro sin UVs conserva AUSENCIA de uvs');
// 2) El miembro CON uvs conserva las suyas.
revisar(!!parteA.mesh.uvs, 'reparto: miembro con UVs conserva sus uvs');

// 3) El visual ORIGINAL de B (sin uvs) PROYECTA sus UVs (varian).
const visualOriginal = buildSnapshotObjectVisual(
  mB, false, 'planar', undefined, 1, undefined, null
);
const uvOriginal = visualOriginal.children[0].geometry.getAttribute('uv').array;
let distinta = false;
for (let i = 2; i < uvOriginal.length; i++) {
  if (Math.abs(uvOriginal[i] - uvOriginal[0]) > 1e-6) { distinta = true; break; }
}
revisar(distinta, 'visual original (sin uvs): UVs PROYECTADAS (varian)');

// 4) El visual del repartido NO debe llevar uvs colapsados (todo 0).
const visualReparto = buildSnapshotObjectVisual(parteB.mesh, false, 'planar', undefined, 1, undefined, null);
const uvReparto = visualReparto.children[0].geometry.getAttribute('uv').array;
let todoCero = true;
for (let i = 0; i < uvReparto.length; i++) {
  if (Math.abs(uvReparto[i]) > 1e-9) { todoCero = false; break; }
}
revisar(!todoCero, 'visual del repartido: UVs NO colapsadas a 0,0');

// 5) Los campos de la textura de B (nivel objeto) quedan intactos.
revisar(
  parteB.mesh.texture === '/textures/b.jpg' && !parteB.mesh.textureMaterialParams,
  'reparto: los campos de textura de B intactos (texture/params)'
);

// 7) El MAPA del material entra SINCRONO y COMPARTIDO: dos reconstrucciones
// del mismo visual devuelven el mismo Texture (antes cada material nacia
// con map null y la carga asincrona se descartaba al reconstruir de nuevo).
const visT1 = buildSnapshotObjectVisual(mB, false, 'planar', undefined, 1, undefined, null);
const visT2 = buildSnapshotObjectVisual(mB, false, 'planar', undefined, 1, undefined, null);
revisar(
  !!visT1.children[0].material.map && visT1.children[0].material.map === visT2.children[0].material.map,
  'visual: el mapa de imagen se asigna SINCRONO y COMPARTIDO entre reconstrucciones'
);

// 6) ESPEJO: solo B tiene colores por cara - B los conserva tras el
// reparto (la union siempre emite los arrays por cara).
const mC = { ...cubo(), faceColors: cubo().faces.map(() => '#3388ff') };
const C = { id: 'C', mesh: mC, transform: B.transform };
const u2 = unirMallasComoGrupo([A, C], marco);
const d2 = aplicarDeformador('doblar', u2.unida, { angulo: 60 });
const p2 = repartirGrupoDeformado(u2, d2);
const pC = p2.find((p) => p.id === 'C');
const pA2 = p2.find((p) => p.id === 'A');
revisar(!!pC.mesh.faceColors && pC.mesh.faceColors.every((c) => c === '#3388ff'),
  'reparto espejo: el solo miembro CON colores conserva faceColors');
revisar(!pA2.mesh.faceColors,
  'reparto espejo: el miembro SIN colores no recibe faceColors inventados');

console.log('');
console.log(fallos === 0 ? 'TODO OK' : 'FALLOS: ' + fallos);
process.exitCode = fallos ? 1 : 0;