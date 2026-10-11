/**
 * Repro en Node del picking de vértices (pickSubElemento) del visor:
 *  cubo de public/Obj-3D/Cubo.zeus + cámara de la ventana 3D libre
 *  (rotX=30°, rotY=0, perspectiva 45°, distancia 5.5/zoom=2.85).
 * Reproduce la lógica EXACTA de viewer-3d.tsx (visible-only + vértice
 * más cercano en 3D al punto golpeado, tolerancia 25% del tamaño).
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

const doc = JSON.parse(readFileSync(new URL('../../public/Obj-3D/Cubo.zeus', import.meta.url), 'utf8'));
const obj = doc.sceneObjects[0];
const m = {
  vertices: obj.mesh.vertices.map((v) => ({ x: v.x, y: v.y, z: v.z })),
  faces: obj.mesh.faces,
};

function pickSubElemento(mesh, meshObj, camera, ndcX, ndcY, visibleOnly) {
  const raycasterPick = new THREE.Raycaster();
  raycasterPick.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const worldMatrix = meshObj.matrixWorld;
  let frente = null;
  if (visibleOnly) {
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    frente = new Uint8Array(mesh.faces.length);
    for (let i = 0; i < mesh.faces.length; i++) {
      const face = mesh.faces[i];
      if (face.length < 3) continue;
      const a = mesh.vertices[face[0]];
      const b = mesh.vertices[face[1]];
      const c = mesh.vertices[face[2]];
      if (!a || !b || !c) continue;
      const wa = new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(worldMatrix);
      const wb = new THREE.Vector3(b.x, b.y, b.z).applyMatrix4(worldMatrix);
      const wc = new THREE.Vector3(c.x, c.y, c.z).applyMatrix4(worldMatrix);
      const n = new THREE.Vector3().subVectors(wb, wa).cross(new THREE.Vector3().subVectors(wc, wa));
      if (n.dot(new THREE.Vector3().subVectors(camPos, wa)) > 0) frente[i] = 1;
    }
  }
  const hitsV = raycasterPick.intersectObject(meshObj, false);
  if (hitsV.length === 0) return { vi: -2, hit: 0 };
  const puntoV = hitsV[0].point;
  let verticeVisible = null;
  if (frente) {
    verticeVisible = new Uint8Array(mesh.vertices.length);
    for (let i = 0; i < mesh.faces.length; i++) {
      if (!frente[i]) continue;
      for (const vi of mesh.faces[i]) if (vi < verticeVisible.length) verticeVisible[vi] = 1;
    }
  }
  const worldPts = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    if (!v) { worldPts.push(null); continue; }
    const wp = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(worldMatrix);
    worldPts.push(wp);
    minX = Math.min(minX, wp.x); maxX = Math.max(maxX, wp.x);
    minY = Math.min(minY, wp.y); maxY = Math.max(maxY, wp.y);
    minZ = Math.min(minZ, wp.z); maxZ = Math.max(maxZ, wp.z);
  }
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const tolerancia = maxDim * 0.25;
  let mejorVi = -1, mejorVd = Infinity;
  for (let i = 0; i < worldPts.length; i++) {
    if (verticeVisible && !verticeVisible[i]) continue;
    const wp = worldPts[i];
    if (!wp) continue;
    const dist = wp.distanceTo(puntoV);
    if (dist < mejorVd) { mejorVd = dist; mejorVi = i; }
  }
  if (mejorVi >= 0 && mejorVd <= tolerancia) return { vi: mejorVi, mejorVi, mejorVd, tolerancia, dist: mejorVd };
  return { vi: -3, hit: 1, mejorVi, mejorVd, tolerancia };
}

// Malla THREE como la del visor: posiciones únicas con triángulos por abanico.
function buildMeshObj() {
  const geo = new THREE.BufferGeometry();
  const pos = [];
  const idxs = [];
  for (const f of m.faces) {
    const base = pos.length / 3;
    for (const vi of f) pos.push(m.vertices[vi].x, m.vertices[vi].y, m.vertices[vi].z);
    // abanico: (0,1,2), (0,2,3)
    for (let i = 1; i < f.length - 1; i++) idxs.push(base, base + i, base + i + 1);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idxs);
  geo.computeVertexNormals();
  const meshObj = new THREE.Mesh(geo);
  meshObj.updateWorldMatrix(true, false);
  return meshObj;
}

function camaraPose(rotX, rotY, zoom = 1.9282344274319385, orto = false) {
  const baseDistance = 5.5;
  const distance = baseDistance / zoom;
  let camera;
  if (orto) {
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    const alto = 1.35 / Math.max(0.1, Math.min(5, zoom));
    camera.left = -alto * 2.37; camera.right = alto * 2.37;
    camera.top = alto; camera.bottom = -alto;
    camera.zoom = 1; camera.near = 0.1; camera.far = Math.max(100, distance * 2 + 10);
    camera.updateProjectionMatrix();
  } else {
    camera = new THREE.PerspectiveCamera(45, 2.37, 0.1, 100);
  }
  const esOrto = camera instanceof THREE.OrthographicCamera;
  // vista frontal exacta: rotX 0 → pos (0,0,distancia)
  if (rotX === 0 && rotY === 0) {
    camera.position.set(0, 0, distance);
  } else {
    camera.position.set(
      distance * Math.cos(rotX) * Math.sin(rotY),
      distance * Math.sin(rotX),
      distance * Math.cos(rotX) * Math.cos(rotY)
    );
  }
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  void esOrto;
  return camera;
}

const meshObj = buildMeshObj();
const casos = [
  ['3D libre por defecto rotX=30° rotY=0 (⇡ arriba)', 0.5235987755982989, 0],
  ['3D frontal rotX=0 rotY=0', 0, 0],
  ['3D costado rotX=0 rotY=90°', 0, Math.PI / 2],
];
for (const [nombre, rotX, rotY] of casos) {
  const cam = camaraPose(rotX, rotY);
  // Proyección de los 8 esquinas del cubo vía raycaster NDC.
  // Los clics del script: esquinas de la SILUETA proyectada.
  console.log(`\n=== ${nombre} ===`);
  // Proyectar el punto (±0.5, ±0.5, ±0.5) a NDC:
  const proyectar = (p) => {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(cam);
    return { x: v.x, y: v.y };
  };
  const corners3D = [
    [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5],
  ].map(([x, y, z]) => ({ x, y, z }));
  const proys = corners3D.map(proyectar);
  // clic en los 2 vértices superiores de la SILUETA (los de mayor NDC.y).
  const orden = proys.map((p, i) => ({ p, i })).sort((a, b) => b.p.y - a.p.y);
  const topY = orden[0].p.y;
  const topRow = orden.filter((o) => Math.abs(o.p.y - topY) < 0.01).map((o) => o.i);
  console.log('proyecciones NDC:');
  corners3D.forEach((c, i) => console.log(`  (${c.x},${c.y},${c.z}) → ndc(${proys[i].x.toFixed(3)}, ${proys[i].y.toFixed(3)})`));
  console.log('fila superior de la silueta (idx):', topRow.map((i) => corners3D[i]));
  for (const i of topRow) {
    const p = proys[i];
    const c = corners3D[i];
    for (const inset of [0, 0.01, 0.02, 0.05]) {
      const ndcx = p.x - Math.sign(p.x || 1) * inset;
      const ndcy = p.y - inset;
      const res = pickSubElemento(m, meshObj, cam, ndcx, ndcy, true);
      // vi: >=0 elegido | -2 raycast sin golpe | -3 golpe pero fuera de tolerancia
      const elegido = !res ? 'NULL'
        : res.vi === -2 ? 'SIN RAYO'
        : res.vi === -3 ? `FUERA TOLERANCIA (mejor V${res.mejorVi} dist=${res.mejorVd.toFixed(4)} tol=${res.tolerancia.toFixed(3)})`
        : `V${res.vi} (${m.vertices[res.vi].x},${m.vertices[res.vi].y},${m.vertices[res.vi].z}) dist=${res.dist.toFixed(4)}`;
      console.log(`   clic ${JSON.stringify(c)} inset=${inset} → ${elegido}`);
    }
  }
}