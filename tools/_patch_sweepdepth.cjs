const fs = require('fs');
const p = 'lib/sweep-mesh.ts';
let s = fs.readFileSync(p, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
const before = s;

// A) Cálculo del fondo: guardar muestra + fracción dentro del tramo.
const aOld = [
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
].join(nl);
const aNew = [
  '  // Fondo de cada agujero: pasante (o recorrido cerrado) => total - 1; ciego',
  '  // => la muestra `e` cuyo tramo [e, e+1] contiene la profundidad `hd`, más',
  '  // la fracción `fr` dentro de ese tramo. Así el suelo se coloca en la',
  '  // profundidad EXACTA (no en la muestra más cercana), imprescindible porque',
  '  // las muestras del recorrido no están equiespaciadas.',
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
].join(nl);
if (!s.includes(aOld)) { console.error('A no encontrada'); process.exit(1); }
s = s.replace(aOld, aNew);

// B) Crear los anillos de fondo interpolados (tras construir los anillos).
const bOld = [
  '    holeRingIds.push(sampleHoleIds);',
  '  }',
  '',
  '  const faces: number[][] = [];',
].join(nl);
const bNew = [
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
].join(nl);
if (!s.includes(bOld)) { console.error('B no encontrada'); process.exit(1); }
s = s.replace(bOld, bNew);

// C) Paredes: añadir el último tramo (muestra e -> anillo de fondo).
const cOld = [
  '      for (let i = 0; i < last; i++) {',
  '        const aIds = holeRingIds[i][h];',
  '        const bIds = holeRingIds[i + 1][h];',
  '        const axis = vmul(',
  '          vadd(faceCenter(aIds, vertices), faceCenter(bIds, vertices)),',
  '          0.5',
  '        );',
  '        stitch(aIds, bIds, axis, -1);',
  '      }',
  '      if (closed) {',
].join(nl);
const cNew = [
  '      for (let i = 0; i < last; i++) {',
  '        const aIds = holeRingIds[i][h];',
  '        const bIds = holeRingIds[i + 1][h];',
  '        const axis = vmul(',
  '          vadd(faceCenter(aIds, vertices), faceCenter(bIds, vertices)),',
  '          0.5',
  '        );',
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
].join(nl);
if (!s.includes(cOld)) { console.error('C no encontrada'); process.exit(1); }
s = s.replace(cOld, cNew);

// D) Tapa del suelo: usar el anillo interpolado cuando exista.
const dOld = [
  '    for (let h = 0; h < holeCount; h++) {',
  '      const e = holeEndIdx[h];',
  '      if (e >= total - 1) continue;',
  '      cap(holeRingIds[e][h], [], samples[e].pos, tangents[e], -1);',
  '    }',
].join(nl);
const dNew = [
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
].join(nl);
if (!s.includes(dOld)) { console.error('D no encontrada'); process.exit(1); }
s = s.replace(dOld, dNew);

if (s !== before) {
  fs.writeFileSync(p, s);
  console.log('Fondo exacto del recorrido aplicado.');
}
