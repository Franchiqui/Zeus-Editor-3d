// Prueba de la lógica de ANILLOS de caras (construirAnillos + carasAnilloDe)
// contra las mallas reales de public/Obj-3D/*.zeus.
// Uso: npx esbuild lib/geometry.ts --bundle --format=esm --platform=node
//        --outfile=scripts/verificar-3d/.anillos-bundle.mjs
//      node scripts/verificar-3d/probar-anillos.mjs

import { readFileSync } from 'fs';
import { construirAnillos, carasAnilloDe } from './.anillos-bundle.mjs';

const OBJ = ['Cubo', 'Esfera', 'Toroide', 'Tubo', 'Cono', 'Cilindro', 'Disco', 'Piramide'];

for (const nombre of OBJ) {
  const doc = JSON.parse(readFileSync(`public/Obj-3D/${nombre}.zeus`, 'utf8'));
  const obj = (doc.sceneObjects || [])[0];
  if (!obj || !obj.mesh) { console.log(`${nombre}: sin malla`); continue; }
  const mesh = obj.mesh;
  const datos = construirAnillos(mesh);
  if (!datos) { console.log(`${nombre}: construirAnillos = null`); continue; }

  const emparejados = datos.faceACelda.filter(v => v >= 0).length;
  const n = mesh.faces.length;

  // Elegir una cara CON celda (pared) y probar ambos clases.
  let celdaProbada = -1;
  for (let f = 0; f < n; f++) {
    if (datos.faceACelda[f] >= 0) { celdaProbada = f; break; }
  }
  let extra = '';
  if (celdaProbada >= 0) {
    const partes = [];
    for (const clase of [0, 1]) {
      const r = carasAnilloDe(datos, celdaProbada, clase);
      if (!r) { partes.push(`clase${clase}=null`); continue; }
      const set = new Set(r);
      let aviso = '';
      if (set.size !== r.length) aviso += '[dupts!]';
      if (r.some(x => x < 0 || x >= n)) aviso += '[rango!]';
      // ¿El anillo de la cara inicial incluye a la cara inicial?
      if (!set.has(celdaProbada)) aviso += '[sin-origen!]';
      partes.push(`clase${clase}=${r.length}${aviso}`);
    }
    extra = ` | cara ${celdaProbada}: ${partes.join(' ')}`;
  }
  console.log(
    `${nombre}: caras=${n} celdas=${datos.celdas.length} caras en celda=${emparejados}/${n}${extra}`
  );
}

// --- Mallas VIVAS de la app (quads con índices compartidos, zeia) ---
// espejo de lib/zeia-primitives.ts: las primitivas que la app crea en vivo.
const vivos = [];

function v(x, y, z) { return { x, y, z }; }

// cube(half): 6 cuads compartidos
{
  const vertices = [
    v(-1, -1, -1), v(1, -1, -1), v(1, 1, -1), v(-1, 1, -1),
    v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1),
  ];
  const faces = [
    [4, 5, 6, 7], [1, 0, 3, 2], [0, 4, 7, 3],
    [5, 1, 2, 6], [3, 7, 6, 2], [0, 1, 5, 4],
  ];
  vivos.push(['Cubo vivo', { vertices, faces }]);
}

// sphere(radius, rings, segments): [a, a+1, b+1, b]
{
  for (const [rings, segs] of [[16, 24], [8, 12]]) {
    const vertices = [];
    const faces = [];
    for (let i = 0; i <= rings; i++) {
      const phi = (i / rings) * Math.PI;
      const y = Math.cos(phi) * 1;
      const r = Math.sin(phi) * 1;
      for (let j = 0; j <= segs; j++) {
        const th = (j / segs) * Math.PI * 2;
        vertices.push(v(Math.cos(th) * r, y, Math.sin(th) * r));
      }
    }
    const rowLen = segs + 1;
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * rowLen + j;
        const b = a + rowLen;
        faces.push([a, a + 1, b + 1, b]);
      }
    }
    vivos.push([`Esfera viva ${rings}x${segs}`, { vertices, faces }]);
  }
}

// cylinder wall: verticales pareados + tapas triángulos al abanico
{
  const segs = 12;
  const vertices = [];
  const faces = [];
  for (let j = 0; j <= segs; j++) {
    const th = (j / segs) * Math.PI * 2;
    vertices.push(v(Math.cos(th), 1, Math.sin(th)));
    vertices.push(v(Math.cos(th), -1, Math.sin(th)));
  }
  for (let j = 0; j < segs; j++) {
    const t0 = j * 2;
    const t1 = (j + 1) * 2;
    faces.push([t0, t1, t1 + 1, t0 + 1]); // pared quad
  }
  const centroS = vertices.length;
  vertices.push(v(0, 1, 0));
  const centroI = vertices.length;
  vertices.push(v(0, -1, 0));
  for (let j = 0; j < segs; j++) {
    faces.push([j * 2, ((j + 1) % segs) * 2, centroS]); // tapa sup tri
    faces.push([((j + 1) % segs) * 2 + 1, j * 2 + 1, centroI]); // tapa inf tri
  }
  vivos.push([`Cilindro vivo ${segs}`, { vertices, faces }]);
}

console.log('\n=== MALLAS VIVAS (quads) ===');
for (const [nombre, mesh] of vivos) {
  const datos = construirAnillos(mesh);
  if (!datos) { console.log(`${nombre}: construirAnillos = null`); continue; }
  const n = mesh.faces.length;
  const enCelda = datos.faceACelda.filter(x => x >= 0).length;
  let celdaProbada = -1;
  for (let f = 0; f < n; f++) {
    if (datos.faceACelda[f] >= 0) { celdaProbada = f; break; }
  }
  const partes = [];
  if (celdaProbada >= 0) {
    for (const clase of [0, 1]) {
      const r = carasAnilloDe(datos, celdaProbada, clase);
      if (!r) { partes.push(`clase${clase}=null`); continue; }
      const set = new Set(r);
      let aviso = '';
      if (set.size !== r.length) aviso += '[dupts!]';
      if (r.some(x => x < 0 || x >= n)) aviso += '[rango!]';
      if (!set.has(celdaProbada)) aviso += '[sin-origen!]';
      partes.push(`clase${clase}=${r.length}${aviso}`);
    }
  }
  console.log(`${nombre}: caras=${n} celdas=${datos.celdas.length} enCelda=${enCelda}/${n} | cara ${celdaProbada}: ${partes.join(' ')}`);
}