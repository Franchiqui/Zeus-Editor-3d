// Prueba del picking de vértices: simula pickSubElemento('vertice')
// con un cubo de 8 vértices y verifica que SOLO detecta la esquina apuntada.
import * as THREE from 'three';
import { buildPrimitiveMesh } from '../lib/zeia-primitives';

const m = buildPrimitiveMesh('cube' as any)!
console.log('Cubo: vertices =', m.vertices.length, '| faces =', m.faces.length);

// Construir BufferGeometry con triángulos (fan) como hace el viewer
const geo = new THREE.BufferGeometry();
const pos: number[] = [];
for (const f of m.faces) {
  for (let i = 1; i < f.length - 1; i++) {
    const a = m.vertices[f[0]];
    const b = m.vertices[f[i]];
    const c = m.vertices[f[i + 1]];
    if (!a || !b || !c) continue;
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
}
geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
geo.computeVertexNormals();
const meshObj = new THREE.Mesh(geo);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(3, 3, 3);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();

// Raycaster apuntando a la esquina (1,1,1)
const proyectada = new THREE.Vector3(1, 1, 1).project(camera);
const ray = new THREE.Raycaster();
ray.setFromCamera(new THREE.Vector2(proyectada.x, proyectada.y), camera);

const hits = ray.intersectObject(meshObj, false);
console.log('Rayo a la esquina (1,1,1): hits =', hits.length);
if (hits.length > 0) {
  const punto = hits[0].point;
  console.log('Punto golpeado:', punto.x.toFixed(3), punto.y.toFixed(3), punto.z.toFixed(3));
  // Elegir vértice más cercano al punto golpeado (lógica del parche)
  let mejorVi = -1;
  let mejorVd = Infinity;
  for (let i = 0; i < m.vertices.length; i++) {
    const w = m.vertices[i];
    if (!w) continue;
    const d = new THREE.Vector3(w.x, w.y, w.z).distanceTo(punto);
    if (d < mejorVd) { mejorVd = d; mejorVi = i; }
  }
  console.log('Vértice elegido:', mejorVi, '→', m.vertices[mejorVi], '| dist =', mejorVd.toFixed(4));
}

// Ahora un rayo al CENTRO de una cara (no a una esquina): no debe detectar
// ningún vértice si la tolerancia es razonable... pero con la lógica nueva
// SÍ devolvería el más cercano si dist <= tolerancia (25% del tamaño).
const centroCara = new THREE.Vector3(0, 0, 1).project(camera);
ray.setFromCamera(new THREE.Vector2(centroCara.x, centroCara.y), camera);
const hits2 = ray.intersectObject(meshObj, false);
if (hits2.length > 0) {
  const punto2 = hits2[0].point;
  let mejorVi2 = -1;
  let mejorVd2 = Infinity;
  for (let i = 0; i < m.vertices.length; i++) {
    const w = m.vertices[i];
    if (!w) continue;
    const d = new THREE.Vector3(w.x, w.y, w.z).distanceTo(punto2);
    if (d < mejorVd2) { mejorVd2 = d; mejorVi2 = i; }
  }
  console.log('Rayo al centro de cara: vértice más cercano =', mejorVi2, '| dist =', mejorVd2.toFixed(4));
  console.log('  (tolerancia del parche = 25% de la diagonal del cubo =', (2 * Math.sqrt(3) * 0.25).toFixed(3), ')');
}
console.log('OK: prueba terminada');