// Diagnóstico: ¿las normales de los .zeus apuntan hacia FUERA del objeto?
// normal cara (a,b,c CCW) comparada con la dirección del centroide de la
// cara hacia el centroide de la malla.
import * as fs from 'fs';

const lee = (n) => JSON.parse(fs.readFileSync(`public/Obj-3D/${n}`, 'utf8')).sceneObjects[0].mesh;

const centroide = (mesh) => {
  const c = { x: 0, y: 0, z: 0 };
  for (const v of mesh.vertices) { c.x += v.x; c.y += v.y; c.z += v.z; }
  const n = mesh.vertices.length;
  return { x: c.x / n, y: c.y / n, z: c.z / n };
};

const centroCara = (mesh, f) => {
  const c = { x: 0, y: 0, z: 0 };
  for (const i of f) { const v = mesh.vertices[i]; c.x += v.x; c.y += v.y; c.z += v.z; }
  const n = f.length;
  return { x: c.x / n, y: c.y / n, z: c.z / n };
};

const normalCara = (mesh, f) => {
  const [ia, ib, ic] = f.length === 3 ? f : [f[0], f[1], f[2]];
  const a = mesh.vertices[ia], b = mesh.vertices[ib], c = mesh.vertices[ic];
  const u = [b.x - a.x, b.y - a.y, b.z - a.z];
  const w = [c.x - a.x, c.y - a.y, c.z - a.z];
  const n = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]];
  const L = Math.hypot(...n) || 1;
  return n.map((x) => x/L);
};

for (const nombre of ['Cubo.zeus', 'Cilindro.zeus', 'Capsula.zeus', 'Esfera.zeus', 'Toroide.zeus']) {
  try {
    const mesh = lee(nombre);
    const cm = centroide(mesh);
    let dentro = 0, fuera = 0;
    for (const f of mesh.faces) {
      const nrm = normalCara(mesh, f);
      const cf = centroCara(mesh, f);
      const d = [cf.x - cm.x, cf.y - cm.y, cf.z - cm.z];
      const dot = nrm[0]*d[0] + nrm[1]*d[1] + nrm[2]*d[2];
      if (dot >= 0) fuera++; else dentro++;
    }
    console.log(`${nombre}: fuera=${fuera} dentro=${dentro} (${mesh.faces.length} caras ${fuera>dentro?'→ NORMALES HACIA FUERA':'→ INVERTIDAS'})`);
  } catch (e) { console.log(`${nombre}: ${e.message}`); }
}