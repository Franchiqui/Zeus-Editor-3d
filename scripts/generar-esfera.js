/* Genera una esfera OBJ y un .zeus (objeto 3D del editor) para pruebas. */
const fs = require('fs');
const path = require('path');

function esfera(stacks = 24, slices = 32) {
  const vertices = [];
  const faces = [];
  for (let i = 0; i <= stacks; i++) {
    const phi = (i / stacks) * Math.PI;
    for (let j = 0; j < slices; j++) {
      const theta = (j / slices) * Math.PI * 2;
      vertices.push({
        x: Math.sin(phi) * Math.cos(theta),
        y: Math.cos(phi),
        z: Math.sin(phi) * Math.sin(theta),
      });
    }
  }
  const v = (i, j) => i * slices + (j % slices);
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      faces.push([v(i, j), v(i, j + 1), v(i + 1, j + 1)]);
      faces.push([v(i, j), v(i + 1, j + 1), v(i + 1, j)]);
    }
  }
  return { vertices, faces };
}

// OBJ (para importar modelo)
function esferaObj() {
  const { vertices, faces } = esfera();
  const lines = vertices.map(
    (p) => `v ${p.x.toFixed(6)} ${p.y.toFixed(6)} ${p.z.toFixed(6)}`
  );
  for (const f of faces) lines.push(`f ${f[0] + 1} ${f[1] + 1} ${f[2] + 1}`);
  return lines.join('\n');
}

// .zeus (objeto 3D del editor: type 'editor3d' + sceneObjects)
function esferaZeus() {
  const mesh = esfera();
  return JSON.stringify({
    type: 'editor3d',
    mode: 'scene',
    configObjectId: 'esfera-1',
    selectedObjectId: 'esfera-1',
    sceneObjects: [
      {
        id: 'esfera-1',
        name: 'Esfera de prueba',
        mode: 'scene',
        transform: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
        smooth: true,
        textureProjection: 'planar',
        mesh,
      },
    ],
  });
}

fs.writeFileSync(path.join(__dirname, 'esfera.obj'), esferaObj());
fs.writeFileSync(path.join(__dirname, 'esfera.zeus'), esferaZeus());
console.log('esfera.obj y esfera.zeus escritos');