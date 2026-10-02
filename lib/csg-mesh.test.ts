/**
 * Tests de regresión para las operaciones booleanas (sustraer/unir/intersectar).
 *
 * El caso «base trasladada» y el «base escalada» son los que destaparon el bug
 * histórico de la DOBLE inversa (three-csg-ts ya devuelve la geometría en
 * espacio LOCAL del base y se volvía a aplicar inverseBaseMatrix): con base
 * movida o escalada salían mallas «raras» al sustraer.
 *
 * La aserción central compara el VOLUMEN del resultado (en coordenadas de
 * mundo, transformando los vértices por la TRS del base) con el volumen
 * esperado de la operación booleana.
 */
import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import type { Mesh } from './geometry';
import { buildPrimitiveMesh } from './zeia-primitives';
import { performCSGOperation } from './csg-mesh';

// Reexporta el tipo de transform para no importar viewer-3d (componente pesado)
type ObjectTransform = {
  px: number; py: number; pz: number;
  rx: number; ry: number; rz: number;
  sx: number; sy: number; sz: number;
};

const T = (p: [number, number, number] = [0, 0, 0], s: [number, number, number] = [1, 1, 1], r: [number, number, number] = [0, 0, 0]): ObjectTransform => ({
  px: p[0], py: p[1], pz: p[2],
  rx: r[0], ry: r[1], rz: r[2],
  sx: s[0], sy: s[1], sz: s[2],
});

/** Volumen de la malla transformada a mundo (fórmula de la divergencia / tetraedros firmados). */
function worldVolume(mesh: Mesh, t: ObjectTransform): number {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(t.px, t.py, t.pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rx, t.ry, t.rz)),
    new THREE.Vector3(t.sx || 1, t.sy || 1, t.sz || 1)
  );
  const v = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let vol = 0;
  for (const face of mesh.faces) {
    for (let i = 1; i < face.length - 1; i++) {
      const i0 = mesh.vertices[face[0]], i1 = mesh.vertices[face[i]], i2 = mesh.vertices[face[i + 1]];
      if (!i0 || !i1 || !i2) continue;
      a.set(i0.x, i0.y, i0.z).applyMatrix4(m);
      b.set(i1.x, i1.y, i1.z).applyMatrix4(m);
      c.set(i2.x, i2.y, i2.z).applyMatrix4(m);
      vol += a.dot(b.clone().cross(c)) / 6;
    }
  }
  return Math.abs(vol);
}

/** Bounding box de la malla transformada a mundo, como [min, max]. */
function worldBBox(mesh: Mesh, t: ObjectTransform): [THREE.Vector3, THREE.Vector3] {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(t.px, t.py, t.pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rx, t.ry, t.rz)),
    new THREE.Vector3(t.sx || 1, t.sy || 1, t.sz || 1)
  );
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const v = new THREE.Vector3();
  for (const vert of mesh.vertices) {
    v.set(vert.x, vert.y, vert.z).applyMatrix4(m);
    min.min(v);
    max.max(v);
  }
  return [min, max];
}

const EPS = 1e-3;

describe('performCSGOperation (regresión del sustraer forma)', () => {
  it('subtract con base y cortador sin transformar: recorta el volumen del cortador', () => {
    const base = buildPrimitiveMesh('cube')!;
    const tool = buildPrimitiveMesh('cube')!;
    // cube(1) mide 2x2x2 (volumen 8); el cortador a escala 0.5 mide 1x1x1 (=1)
    const res = performCSGOperation(base, T(), tool, T([0, 0, 0], [0.5, 0.5, 0.5]), 'subtract');
    expect(res.success).toBe(true);
    expect(res.resultMesh?.vertices.length).toBeGreaterThan(0);
    expect(worldVolume(res.resultMesh!, T())).toBeGreaterThan(7 - EPS);
    expect(worldVolume(res.resultMesh!, T())).toBeLessThan(7 + EPS);
  });

  it('subtract con base TRASLADADA: el resultado queda donde estaba el base (bug de doble inversa)', () => {
    const base = buildPrimitiveMesh('cube')!;
    const tool = buildPrimitiveMesh('cube')!;
    const baseT = T([3, 0, 0]);
    const toolT = T([3, 0, 0], [0.5, 0.5, 0.5]);
    const res = performCSGOperation(base, baseT, tool, toolT, 'subtract');
    expect(res.success).toBe(true);
    const mesh = res.resultMesh!;
    expect(mesh.vertices.length).toBeGreaterThan(0);
    // Cubo 2x2x2 menos cortador 1x1x1 dentro de él
    expect(worldVolume(mesh, baseT)).toBeGreaterThan(7 - EPS);
    expect(worldVolume(mesh, baseT)).toBeLessThan(7 + EPS);
    // Y el resultado sigue centrado en el base, NO desplazado al doble
    const [min, max] = worldBBox(mesh, baseT);
    expect(min.x).toBeGreaterThan(2 - 0.05);
    expect(max.x).toBeLessThan(4 + 0.05);
  });

  it('subtract con base ESCALADA x2: sin deformación, medidas del mundo correctas (bug de doble inversa)', () => {
    const base = buildPrimitiveMesh('cube')!;
    const tool = buildPrimitiveMesh('cube')!;
    const baseT = T([0, 0, 0], [2, 2, 2]);
    const toolT = T([0, 0, 0]); // cortador 2x2x2 dentro del base escalado (4x4x4=64)
    const res = performCSGOperation(base, baseT, tool, toolT, 'subtract');
    expect(res.success).toBe(true);
    const mesh = res.resultMesh!;
    expect(mesh.vertices.length).toBeGreaterThan(0);
    // 64 - 8 = 56 (el bug de doble inversa daba geometría deformada)
    expect(worldVolume(mesh, baseT)).toBeGreaterThan(56 - 5 * EPS);
    expect(worldVolume(mesh, baseT)).toBeLessThan(56 + 5 * EPS);
    const [min, max] = worldBBox(mesh, baseT);
    // El mundo del resultado mide 4x4x4 (el base escalado)
    expect(max.x - min.x).toBeLessThan(4 + 0.05);
    expect(max.x - min.x).toBeGreaterThan(3.95);
    expect(max.y - min.y).toBeLessThan(4 + 0.05);
  });

  it('subtract con base GIRADA 45°: el resultado hereda el giro sin volverse malla rara', () => {
    const base = buildPrimitiveMesh('cube')!;
    const tool = buildPrimitiveMesh('cube')!;
    const baseT = T([0, 0, 0], [1, 1, 1], [0, 0, Math.PI / 4]);
    // Cortador 0.5x0.5x0.5 (escala 0.25) totalmente dentro del base girado
    const toolT = T([0, 0.2, 0], [0.25, 0.25, 0.25]);
    const res = performCSGOperation(base, baseT, tool, toolT, 'subtract');
    expect(res.success).toBe(true);
    const mesh = res.resultMesh!;
    expect(mesh.vertices.length).toBeGreaterThan(0);
    expect(worldVolume(mesh, baseT)).toBeGreaterThan(8 - 0.126 - EPS);
    expect(worldVolume(mesh, baseT)).toBeLessThan(8 - 0.124 + EPS);
  });

  it('subtract con cortador girado y escalado', () => {
    const base = buildPrimitiveMesh('cube')!;
    const tool = buildPrimitiveMesh('cube')!;
    const baseT = T([2, 1, -1], [1.5, 1.5, 1.5], [0, Math.PI / 6, 0]);
    const toolT = T([2, 1, -1], [0.5, 2, 0.5], [0, 0, Math.PI / 3]);
    const res = performCSGOperation(base, baseT, tool, toolT, 'subtract');
    expect(res.success).toBe(true);
    const mesh = res.resultMesh!;
    expect(mesh.vertices.length).toBeGreaterThan(0);
    const volBase = worldVolume(base, baseT);
    const volRes = worldVolume(mesh, baseT);
    // Sustraer nunca crece, y el cortador (máx 4 de volumen mundo) tampoco puede vaciar el base
    expect(volRes).toBeLessThan(volBase);
    expect(volRes).toBeGreaterThan(volBase - 4.5);
    // El resultado sigue dentro del volumen del base
    const [min, max] = worldBBox(mesh, baseT);
    const [bmin, bmax] = worldBBox(base, baseT);
    expect(min.x).toBeGreaterThanOrEqual(bmin.x - 1e-3);
    expect(max.x).toBeLessThanOrEqual(bmax.x + 1e-3);
    expect(min.y).toBeGreaterThanOrEqual(bmin.y - 1e-3);
    expect(max.y).toBeLessThanOrEqual(bmax.y + 1e-3);
  });

  it('union de dos cubos que se solapan: volumen ≈ suma - solape', () => {
    const base = buildPrimitiveMesh('cube')!;
    const tool = buildPrimitiveMesh('cube')!;
    const toolT = T([0, 0, 1.5]); // cubos de tamaño 2 → solape 2x2x0.5
    const res = performCSGOperation(base, T(), tool, toolT, 'union');
    expect(res.success).toBe(true);
    expect(res.resultMesh?.vertices.length).toBeGreaterThan(0);
    expect(worldVolume(res.resultMesh!, T())).toBeGreaterThan(14 - EPS);
    expect(worldVolume(res.resultMesh!, T())).toBeLessThan(14 + EPS);
  });

  it('intersect de dos cubos que se solapan: queda solo el solape', () => {
    const base = buildPrimitiveMesh('cube')!;
    const tool = buildPrimitiveMesh('cube')!;
    const toolT = T([0, 0, 1.5]);
    const res = performCSGOperation(base, T(), tool, toolT, 'intersect');
    expect(res.success).toBe(true);
    expect(res.resultMesh?.vertices.length).toBeGreaterThan(0);
    // Solape: 2x2x0.5
    expect(worldVolume(res.resultMesh!, T())).toBeGreaterThan(2 - EPS);
    expect(worldVolume(res.resultMesh!, T())).toBeLessThan(2 + EPS);
  });

  it('subtract esfera DEL CUBO: quita el volumen de la esfera (winding de primitivas)', () => {
    // Regresión: esfera/cono/torus tenían las caras hacia DENTRO → el CSG
    // se comportaba invertido con esos cortadores. Con la esfera inscrita
    // (radio 1 ≈ las caras del cubo 2x2x2), el resultado es 8 − 4.19.
    const base = buildPrimitiveMesh('cube')!;
    const bola = buildPrimitiveMesh('sphere')!;
    const res = performCSGOperation(base, T(), bola, T(), 'subtract');
    expect(res.success).toBe(true);
    expect(res.resultMesh?.vertices.length).toBeGreaterThan(0);
    // Volumen de la esfera teselada (r=1): ≈4.1013 → 8 − 4.1013 = 3.8987
    expect(worldVolume(res.resultMesh!, T())).toBeGreaterThan(3.88);
    expect(worldVolume(res.resultMesh!, T())).toBeLessThan(3.92);
  });

  it('subtract donde el cortador NO toca al base: el base queda intacto', () => {
    const base = buildPrimitiveMesh('cube')!;
    const tool = buildPrimitiveMesh('cube')!;
    const res = performCSGOperation(base, T(), tool, T([10, 10, 10]), 'subtract');
    expect(res.success).toBe(true);
    expect(worldVolume(res.resultMesh!, T())).toBeGreaterThan(8 - EPS);
    expect(worldVolume(res.resultMesh!, T())).toBeLessThan(8 + EPS);
  });

  it('error controlado con malla vacía', () => {
    const vacia: Mesh = { vertices: [], faces: [] };
    const res = performCSGOperation(vacia, T(), buildPrimitiveMesh('cube')!, T(), 'subtract');
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
  });
});