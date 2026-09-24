/*
 * apply-calado-fix.cjs
 * --------------------
 * Aplica (de forma IDEMPOTENTE) el arreglo completo del calado tras el
 * cambio a "varios agujeros + ciego". Reejecutarlo no altera nada.
 *
 * Corrige cuatro defectos:
 *   1) views-mesh: los agujeros se normalizaban con su PROPIO bounding box, así
 *      que se estiraban hasta cubrir toda la cara y el calado no se veía.
 *      Ahora comparten el bbox del contorno exterior (normalizeInBox).
 *   2) views-mesh: el volumen salía negativo (caras hacia dentro). Se orienta
 *      el sólido hacia fuera (orientedFaces), como el recorrido.
 *   3) views-mesh: los muros del agujero quedaban al revés; se invierte su
 *      winding para que miren hacia el eje del agujero.
 *   4) sweep-mesh: el fondo del calado ciego se anclaba a la muestra más
 *      cercana (recorrido no equiespaciado). Ahora se interpola el último
 *      tramo para colocar el suelo en la profundidad EXACTA.
 *
 * Uso:  node tools/apply-calado-fix.cjs
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

let applied = 0;
let skipped = 0;

function edit(rel, steps) {
  const p = path.join(root, rel);
  let s = fs.readFileSync(p, 'utf8');
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  const before = s;
  for (const st of steps) {
    const oldTxt = Array.isArray(st.old) ? st.old.join(nl) : st.old;
    const newTxt = Array.isArray(st.new) ? st.new.join(nl) : st.new;
    const marker = st.marker || newTxt;
    if (s.includes(marker)) { skipped++; continue; }
    if (!s.includes(oldTxt)) {
      console.error('[' + rel + '] ancla no encontrada para: ' + st.name);
      process.exit(1);
    }
    s = st.replaceAll ? s.split(oldTxt).join(newTxt) : s.replace(oldTxt, newTxt);
    applied++;
  }
  if (s !== before) fs.writeFileSync(p, s);
}

// ----------------------------------------------------------------------------
// 1) + 2) + 3)  lib/views-mesh.ts
// ----------------------------------------------------------------------------
edit('lib/views-mesh.ts', [
  {
    name: 'helpers bbox/marco compartido',
    marker: 'function normalizeInBox(',
    old: 'function extrudeSinglePolygon(',
    new: [
      '/** Bounding box de un polígono (en sus propias coordenadas). */',
      'interface Box {',
      '  minX: number;',
      '  minY: number;',
      '  w: number;',
      '  h: number;',
      '}',
      'function polygonBox(poly: Polygon): Box {',
      '  let minX = Infinity,',
      '    maxX = -Infinity,',
      '    minY = Infinity,',
      '    maxY = -Infinity;',
      '  for (const q of poly) {',
      '    minX = Math.min(minX, q.x);',
      '    maxX = Math.max(maxX, q.x);',
      '    minY = Math.min(minY, q.y);',
      '    maxY = Math.max(maxY, q.y);',
      '  }',
      '  return { minX, minY, w: maxX - minX || 1, h: maxY - minY || 1 };',
      '}',
      '',
      '/**',
      ' * Normaliza un polígono a [0,1] usando un bounding box EXPLÍCITO.',
      ' * Imprescindible para los agujeros: deben compartir el marco (bounding box)',
      ' * del contorno exterior para conservar su posición dentro de él. Si cada',
      ' * agujero se normalizara con su propio bbox se estiraría hasta cubrir toda',
      ' * la cara y el calado no se vería (parecía que "no hacía nada").',
      ' */',
      'function normalizeInBox(poly: Polygon, bb: Box): Polygon {',
      '  return poly.map((q) => {',
      '    const out: Point2D = {',
      '      x: (q.x - bb.minX) / bb.w,',
      '      y: (q.y - bb.minY) / bb.h,',
      '    };',
      '    if (q.hIn) out.hIn = { x: (q.hIn.x - bb.minX) / bb.w, y: (q.hIn.y - bb.minY) / bb.h };',
      '    if (q.hOut) out.hOut = { x: (q.hOut.x - bb.minX) / bb.w, y: (q.hOut.y - bb.minY) / bb.h };',
      '    return out;',
      '  });',
      '}',
      '',
      'function extrudeSinglePolygon(',
    ],
  },
  {
    name: 'contorno con marco compartido',
    marker: 'normalizeInBox(polygon, mainBox)',
    old: '  const front = flattenPolygon(normalizePolygon(polygon), curveSteps);',
    new: [
      '  // Marco compartido: el bbox del contorno exterior. Tanto el contorno',
      '  // como TODOS los agujeros se normalizan con él para que cada agujero',
      '  // conserve su posición relativa dentro de la figura.',
      '  const mainBox = polygonBox(polygon);',
      '  const front = flattenPolygon(normalizeInBox(polygon, mainBox), curveSteps);',
    ],
  },
  {
    name: 'agujeros con el mismo marco',
    marker: 'normalizeInBox(poly, mainBox)',
    old: '    const flat = flattenPolygon(normalizePolygon(poly), curveSteps);',
    new: '    const flat = flattenPolygon(normalizeInBox(poly, mainBox), curveSteps);',
  },
  {
    name: 'orientación hacia fuera',
    marker: 'const orientedFaces =',
    old: [
      '      faces.push([ring[tri[0]], ring[tri[1]], ring[tri[2]]]);',
      '    }',
      '  }',
      '',
      '  return { vertices, faces };',
    ],
    new: [
      '      faces.push([ring[tri[0]], ring[tri[1]], ring[tri[2]]]);',
      '    }',
      '  }',
      '',
      '  // Orientación hacia FUERA: este constructor deja las caras con winding',
      '  // INTERIOR (convenio heredado). Se invierten todas para que las normales',
      '  // miren hacia fuera, igual que el recorrido (buildSweepMesh), de modo que',
      '  // el suelo del calado ciego mire a +Z y las exportaciones STL/OBJ salgan',
      '  // correctas.',
      '  const orientedFaces = faces.map((f) => [...f].reverse());',
      '  return { vertices, faces: orientedFaces };',
    ],
  },
  {
    name: 'winding de muros de agujero',
    marker: 'faces.push([bIds[k], bIds[k2], fIds[k2], fIds[k]]);',
    old: '      faces.push([fIds[k], fIds[k2], bIds[k2], bIds[k]]);',
    new: '      faces.push([bIds[k], bIds[k2], fIds[k2], fIds[k]]);',
    replaceAll: true,
  },
]);

// ----------------------------------------------------------------------------
// 4)  lib/sweep-mesh.ts  (fondo ciego exacto)
// ----------------------------------------------------------------------------
edit('lib/sweep-mesh.ts', [
  {
    name: 'fondo ciego: muestra + fracción',
    marker: 'holeFloorFrac',
    old: [
      '  // Última muestra que alcanza cada agujero: pasante (o recorrido cerrado)',
      '  // => total - 1; ciego => la muestra donde la longitud de arco llega a su',
      '  // profundidad.',
      '  const holeEndIdx: number[] = [];',
      '  for (let h = 0; h < holeCount; h++) {',
      '    const hd = holeDepths[h];',
      '    if (closed || !(hd > 0) || hd >= pathLen - 1e-9) {',
      '      holeEndIdx.push(total - 1);',
      '      continue;',
      '    }',
      '    let e = 1;',
      '    for (let i = 1; i < total; i++) {',
      '      if (cumLen[i] <= hd + 1e-9) e = i;',
      '      else break;',
      '    }',
      '    holeEndIdx.push(Math.min(e, total - 1));',
      '  }',
    ],
    new: [
      '  // Fondo de cada agujero: pasante (o recorrido cerrado) => total - 1; ciego',
      '  // => la muestra `e` cuyo tramo [e, e+1] contiene la profundidad `hd`, más',
      '  // la fracción `fr` dentro de ese tramo. Así el suelo se coloca en la',
      '  // profundidad EXACTA (las muestras del recorrido no están equiespaciadas).',
      '  const holeEndIdx: number[] = [];',
      '  const holeFloorFrac: number[] = [];',
      '  for (let h = 0; h < holeCount; h++) {',
      '    const hd = holeDepths[h];',
      '    if (closed || !(hd > 0) || hd >= pathLen - 1e-9) {',
      '      holeEndIdx.push(total - 1);',
      '      holeFloorFrac.push(0);',
      '      continue;',
      '    }',
      '    let e = total - 1;',
      '    for (let i = 0; i + 1 < total; i++) {',
      '      if (cumLen[i] <= hd + 1e-12 && hd <= cumLen[i + 1] + 1e-12) {',
      '        e = i;',
      '        break;',
      '      }',
      '    }',
      '    let fr = 0;',
      '    const seg = cumLen[e + 1] - cumLen[e];',
      '    if (e + 1 < total && seg > 1e-12) {',
      '      fr = (hd - cumLen[e]) / seg;',
      '      if (fr < 0) fr = 0;',
      '      if (fr > 1) fr = 1;',
      '      if (fr > 1 - 1e-9) { e += 1; fr = 0; } // justo en la muestra siguiente',
      '    }',
      '    holeEndIdx.push(Math.min(e, total - 1));',
      '    holeFloorFrac.push(fr);',
      '  }',
    ],
  },
  {
    name: 'anillos de fondo interpolados',
    marker: 'holeFloorIds',
    old: [
      '    holeRingIds.push(sampleHoleIds);',
      '  }',
      '',
      '  const faces: number[][] = [];',
    ],
    new: [
      '    holeRingIds.push(sampleHoleIds);',
      '  }',
      '',
      '  // Anillos de FONDO de los calados ciegos: interpolados dentro del tramo',
      '  // [e, e+1] según `fr`, para colocar el suelo en la profundidad exacta.',
      '  const holeFloorIds: (number[] | null)[] = new Array(holeCount).fill(null);',
      '  for (let h = 0; h < holeCount; h++) {',
      '    const e = holeEndIdx[h];',
      '    const fr = holeFloorFrac[h];',
      '    if (e >= total - 1 || fr <= 1e-9) continue;',
      '    const aIds = holeRingIds[e][h];',
      '    const bIds = holeRingIds[e + 1][h];',
      '    const ids: number[] = [];',
      '    for (let k = 0; k < ringCount; k++) {',
      '      const A = vertices[aIds[k]];',
      '      const B = vertices[bIds[k]];',
      '      vertices.push({',
      '        x: A.x + (B.x - A.x) * fr,',
      '        y: A.y + (B.y - A.y) * fr,',
      '        z: A.z + (B.z - A.z) * fr,',
      '      });',
      '      ids.push(vertices.length - 1);',
      '    }',
      '    holeFloorIds[h] = ids;',
      '  }',
      '',
      '  const faces: number[][] = [];',
    ],
  },
  {
    name: 'tramo final al fondo',
    marker: 'Tramo final hasta el fondo exacto',
    old: [
      '        stitch(aIds, bIds, axis, -1);',
      '      }',
      '      if (closed) {',
    ],
    new: [
      '        stitch(aIds, bIds, axis, -1);',
      '      }',
      '      // Tramo final hasta el fondo exacto (calado ciego interpolado).',
      '      const floorIds = holeFloorIds[h];',
      '      if (floorIds) {',
      '        const eIds = holeRingIds[holeEndIdx[h]][h];',
      '        const axis = vmul(',
      '          vadd(faceCenter(eIds, vertices), faceCenter(floorIds, vertices)),',
      '          0.5',
      '        );',
      '        stitch(eIds, floorIds, axis, -1);',
      '      }',
      '      if (closed) {',
    ],
  },
  {
    name: 'tapa del suelo interpolada',
    marker: 'cap(fIds, [], center, tan, -1);',
    old: [
      '    for (let h = 0; h < holeCount; h++) {',
      '      const e = holeEndIdx[h];',
      '      if (e >= total - 1) continue;',
      '      cap(holeRingIds[e][h], [], samples[e].pos, tangents[e], -1);',
      '    }',
    ],
    new: [
      '    for (let h = 0; h < holeCount; h++) {',
      '      const e = holeEndIdx[h];',
      '      if (e >= total - 1) continue;',
      '      const fIds = holeFloorIds[h];',
      '      if (fIds) {',
      '        const A = samples[e].pos;',
      '        const B = samples[e + 1].pos;',
      '        const fr = holeFloorFrac[h];',
      '        const center = {',
      '          x: A.x + (B.x - A.x) * fr,',
      '          y: A.y + (B.y - A.y) * fr,',
      '          z: A.z + (B.z - A.z) * fr,',
      '        };',
      '        const t0 = tangents[e];',
      '        const t1 = tangents[e + 1];',
      '        const tan = vnorm({',
      '          x: t0.x + (t1.x - t0.x) * fr,',
      '          y: t0.y + (t1.y - t0.y) * fr,',
      '          z: t0.z + (t1.z - t0.z) * fr,',
      '        });',
      '        cap(fIds, [], center, tan, -1);',
      '      } else {',
      '        cap(holeRingIds[e][h], [], samples[e].pos, tangents[e], -1);',
      '      }',
      '    }',
    ],
  },
]);

console.log(
  'apply-calado-fix: ' + applied + ' aplicado(s), ' + skipped + ' ya presente(s).'
);
