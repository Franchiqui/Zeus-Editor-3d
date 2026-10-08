// Parche: pickSubElemento('vertice') ahora exige hit de rayo sobre la malla
// y elige la esquina más cercana al punto golpeado en 3D (tolerancia relativa
// al tamaño de la malla). Reemplaza el bloque entre "  if (target === 'vertice') {"
// y su "  }" de cierre (la última "  }" antes del marcador "  // Arista:").
const fs = require('fs');
const path = 'components/viewer-3d.tsx';
const raw = fs.readFileSync(path, 'utf8');
const crlf = raw.includes('\r\n');
const lines = raw.split(crlf ? '\r\n' : '\n');

const i0 = lines.findIndex(
  (l) => l.startsWith('  if') && l.includes("target === 'vertice'")
);
if (i0 < 0) {
  console.error('No se encontró el inicio del bloque de vértices');
  process.exit(1);
}
let iArista = -1;
for (let i = i0; i < lines.length; i++) {
  if (lines[i].trim().startsWith('// Arista:')) { iArista = i; break; }
}
if (iArista < 0) {
  console.error('No se encontró el marcador "// Arista:"');
  process.exit(1);
}
let i1 = -1;
for (let i = iArista - 1; i > i0; i--) {
  if (lines[i].trim() === '}') { i1 = i; break; }
}
if (i1 < 0) {
  console.error('No se encontró el cierre del bloque de vértices');
  process.exit(1);
}

const nuevo = [
  "  if (target === 'vertice') {",
  "    // Vértice: el cursor debe estar SOBRE la superficie (raycast con hit)",
  "    // y la esquina elegida es la más cercana al punto golpeado en 3D,",
  "    // dentro de una tolerancia relativa al tamaño de la malla. Así solo",
  "    // se detecta la esquina realmente apuntada: nunca todas a la vez ni",
  "    // vértices lejanos por mera proximidad en pantalla.",
  "    const hitsV = raycasterPick.intersectObject(meshObj, false);",
  "    if (hitsV.length === 0) return null;",
  "    const puntoV = hitsV[0].point;",
  "    let verticeVisible: Uint8Array | null = null;",
  "    if (frente) {",
  "      verticeVisible = new Uint8Array(m.vertices.length);",
  "      for (let i = 0; i < m.faces.length; i++) {",
  "        if (!frente[i]) continue;",
  "        for (const vi of m.faces[i]) {",
  "          if (vi < verticeVisible.length) verticeVisible[vi] = 1;",
  "        }",
  "      }",
  "    }",
  "    // Proyección en mundo de cada vértice + caja envolvente para la",
  "    // tolerancia relativa (independiente del zoom y de la escala).",
  "    const worldPts: Array<THREE.Vector3 | null> = [];",
  "    let minX = Infinity, maxX = -Infinity;",
  "    let minY = Infinity, maxY = -Infinity;",
  "    let minZ = Infinity, maxZ = -Infinity;",
  "    for (let i = 0; i < m.vertices.length; i++) {",
  "      const v = m.vertices[i];",
  "      if (!v) { worldPts.push(null); continue; }",
  "      const wp = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(worldMatrix);",
  "      worldPts.push(wp);",
  "      minX = Math.min(minX, wp.x); maxX = Math.max(maxX, wp.x);",
  "      minY = Math.min(minY, wp.y); maxY = Math.max(maxY, wp.y);",
  "      minZ = Math.min(minZ, wp.z); maxZ = Math.max(maxZ, wp.z);",
  "    }",
  "    const maxDimMundo =",
  "      Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;",
  "    const tolerancia = maxDimMundo * 0.25;",
  "    let mejorVi = -1;",
  "    let mejorVd = Infinity;",
  "    for (let i = 0; i < worldPts.length; i++) {",
  "      if (verticeVisible && !verticeVisible[i]) continue;",
  "      const wp = worldPts[i];",
  "      if (!wp) continue;",
  "      const dist = wp.distanceTo(puntoV);",
  "      if (dist < mejorVd) { mejorVd = dist; mejorVi = i; }",
  "    }",
  "    if (mejorVi >= 0 && mejorVd <= tolerancia) {",
  "      return { t: 'vertice', id: mejorVi };",
  "    }",
  "    return null;",
  "  }",
].join('\n');

lines.splice(i0, i1 - i0 + 1, nuevo);
fs.writeFileSync(path, lines.join(crlf ? '\r\n' : '\n'), 'utf8');
console.log(
  `Bloque reemplazado: líneas ${i0 + 1} a ${i1 + 1} (${i1 - i0 + 1} líneas) -> ${nuevo.split('\n').length} líneas nuevas`
);