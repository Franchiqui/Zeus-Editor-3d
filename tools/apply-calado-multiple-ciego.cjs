/*
 * apply-calado-multiple-ciego.cjs
 * -------------------------------
 * Aplica, de forma IDEMPOTENTE, el soporte de:
 *   1) VARIOS agujeros (calados) a la vez, cada uno con su profundidad.
 *   2) CALADO CIEGO (con fondo) además del pasante, en LOS DOS tipos de
 *      extrusión: la simple (buildExtrudeMeshes) y el recorrido (buildSweepMesh).
 *
 * Toca: lib/geometry.ts, lib/views-mesh.ts, lib/sweep-mesh.ts,
 *       components/editor/Editor3D.tsx y lib/i18n/translations.ts.
 *
 * Reejecutarlo no cambia nada (cada edición se salta si su marcador ya está).
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const P = (rel) => path.join(root, rel);

function load(rel) {
  const raw = fs.readFileSync(P(rel), 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { rel, eol, text: raw.split('\r\n').join('\n') };
}
function save(f) {
  const out = f.eol === '\r\n' ? f.text.split('\n').join('\r\n') : f.text;
  fs.writeFileSync(P(f.rel), out);
}

let applied = 0;
let skipped = 0;

function edit(f, { name, marker, find, regex, replace }) {
  if (marker && f.text.includes(marker)) {
    skipped++;
    console.log('  = ' + name + ' (ya aplicado)');
    return;
  }
  if (regex) {
    if (!regex.test(f.text)) throw new Error('NO encontrado (regex): ' + name);
    f.text = f.text.replace(regex, replace);
    applied++;
    console.log('  + ' + name);
    return;
  }
  const n = f.text.split(find).length - 1;
  if (n === 0) throw new Error('NO encontrado: ' + name);
  if (n > 1) throw new Error('AMBIGUO (' + n + '): ' + name);
  f.text = f.text.split(find).join(replace);
  applied++;
  console.log('  + ' + name);
}

// ===========================================================================
// 1) lib/geometry.ts  -> tipos de agujero + helpers
// ===========================================================================
{
  const f = load('lib/geometry.ts');
  edit(f, {
    name: 'geometry: tipos Hole/HoleSpec + helpers',
    marker: 'export type HoleSpec = Polygon | Hole;',
    find: 'export type Polygon = Point2D[];\n',
    replace:
      'export type Polygon = Point2D[];\n' +
      '\n' +
      '/**\n' +
      ' * Agujero (calado) para extrusión/recorrido: el polígono a sustraer y,\n' +
      ' * de forma opcional, su profundidad.\n' +
      ' *\n' +
      ' * - `depth` ausente o <= 0 → calado pasante (de lado a lado).\n' +
      ' * - `depth` > 0 → calado ciego: socava esa profundidad desde la cara\n' +
      ' *   delantera (extrusión) o desde el inicio del recorrido (barrido).\n' +
      ' */\n' +
      'export type Hole = { polygon: Polygon; depth?: number };\n' +
      '\n' +
      '/** Un agujero puede darse como polígono suelto (pasante) o como `Hole`. */\n' +
      'export type HoleSpec = Polygon | Hole;\n' +
      '\n' +
      '/** Polígono de un agujero, sea `Polygon` o `Hole`. */\n' +
      'export function holePolygon(h: HoleSpec): Polygon {\n' +
      '  return Array.isArray(h) ? h : h.polygon;\n' +
      '}\n' +
      '\n' +
      '/** Profundidad de un agujero (0 = pasante). */\n' +
      'export function holeDepth(h: HoleSpec): number {\n' +
      '  return Array.isArray(h) ? 0 : h.depth ?? 0;\n' +
      '}\n',
  });
  save(f);
}

// ===========================================================================
// 2) lib/views-mesh.ts  -> extrusión simple con calado ciego
// ===========================================================================
{
  const f = load('lib/views-mesh.ts');
  edit(f, {
    name: 'views-mesh: import de HoleSpec/holePolygon/holeDepth',
    marker: '  holePolygon,\n  holeDepth,\n  normalizePolygon,',
    find: '  Polygon,\n  normalizePolygon,\n',
    replace: '  Polygon,\n  type HoleSpec,\n  holePolygon,\n  holeDepth,\n  normalizePolygon,\n',
  });

  const NEW_EXTRUDE = `function extrudeSinglePolygon(
  polygon: Polygon,
  depth: number,
  holes: HoleSpec[] = []
): Mesh {
  // CALADO-CIEGO-EXTRUDE: soporta varios agujeros y calado ciego (con fondo).
  const curveSteps = Math.max(8, 24);

  if (polygon.length < 3) return { vertices: [], faces: [] as number[][] };

  const front = flattenPolygon(normalizePolygon(polygon), curveSteps);
  if (front.length < 3) return { vertices: [], faces: [] as number[][] };

  // Quitar punto final duplicado (ShapeUtils.triangulateShape lo hace
  // internamente y rompería el alineamiento de índices con los vértices 3D)
  const frontClosed = dedupe(front);
  if (frontClosed.length < 3) return { vertices: [], faces: [] as number[][] };

  // Positive shoelace = CW en el lienzo = CCW en 3D visto desde +Z.
  // Se garantiza para que la tapa delantera mire a +Z.
  if (shoelace(frontClosed) < 0) frontClosed.reverse();

  // Aplanar agujeros (winding CW en el lienzo) y anotar su profundidad.
  // 0 (o >= profundidad total) = pasante; 0 < d < profundidad = ciego.
  const normHoles: { flat: Point2D[]; depth: number }[] = [];
  for (const hole of holes) {
    const poly = holePolygon(hole);
    if (poly.length < 3) continue;
    const flat = flattenPolygon(normalizePolygon(poly), curveSteps);
    if (flat.length < 3) continue;
    const flatClosed = dedupe(flat);
    if (flatClosed.length < 3) continue;
    // ShapeUtils/Earcut requires holes to have OPPOSITE winding from the
    // exterior. Exterior is CCW (positive shoelace); holes must be CW
    // (negative shoelace). If a hole comes in CCW, reverse it to CW.
    if (shoelace(flatClosed) > 0) flatClosed.reverse();
    normHoles.push({ flat: flatClosed, depth: holeDepth(hole) });
  }

  const isBlind = (hd: number): boolean => hd > 0 && hd < depth;
  const throughHoles = normHoles.filter((h) => !isBlind(h.depth));
  const blindHoles = normHoles.filter((h) => isBlind(h.depth));

  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];

  // Helper: crear vértices 3D a partir de puntos 2D a una altura z dada
  const makeVerts = (pts: Point2D[], z: number): number[] => {
    return pts.map((q) => {
      const x = 2 * q.x - 1;
      const y = 1 - 2 * q.y;
      return vertices.push({ x, y, z }) - 1;
    });
  };

  // Vértices frontales (z = 0)
  const frontCap = makeVerts(frontClosed, 0);
  const backCap = makeVerts(frontClosed, -depth);

  // Anillas de agujero: delantera para todos (abren en la cara frontal),
  // trasera solo para los pasantes, y suelo relleno para los ciegos.
  const throughFront: number[][] = [];
  const throughBack: number[][] = [];
  const blindFront: number[][] = [];
  const blindFloor: number[][] = [];      // anilla del suelo en su orden de tri.
  const blindFloorRing: Point2D[][] = []; // puntos del suelo (shoelace positivo)
  const blindWallBack: number[][] = [];   // anilla del suelo en orden de pared
  for (const h of throughHoles) {
    throughFront.push(makeVerts(h.flat, 0));
    throughBack.push(makeVerts(h.flat, -depth));
  }
  for (const h of blindHoles) {
    blindFront.push(makeVerts(h.flat, 0));
    // El suelo es el polígono relleno del agujero; se invierte para que su
    // shoelace sea positivo y la tapa mire a +Z (hacia el hueco del bolsillo).
    const rev = [...h.flat].reverse();
    const floor = makeVerts(rev, -h.depth);
    blindFloor.push(floor);
    blindFloorRing.push(rev);
    blindWallBack.push([...floor].reverse());
  }
  const allHoleFronts: number[][] = [...throughFront, ...blindFront];

  // --- Triangulación de una tapa (con agujeros) usando ShapeUtils ---
  const triangulate = (contour: Point2D[], hs: Point2D[][]): number[][] => {
    try {
      const raw = ShapeUtils.triangulateShape(
        contour.map((q) => new Vector2(q.x, q.y)),
        hs.map((h) => h.map((q) => new Vector2(q.x, q.y)))
      );
      const t = (Array.isArray(raw) ? raw : []) as number[][];
      if (t.length) return t;
    } catch {
      // Fallback: triangulación con agujeros (ear-clip + bridge).
    }
    const ear = earClipWithHoles(contour, hs);
    const t: number[][] = [];
    for (let i = 0; i + 2 < ear.length; i += 3) t.push([ear[i], ear[i + 1], ear[i + 2]]);
    return t;
  };

  const makeOffsets = (flat: number[][]): number[] => {
    const offs: number[] = [];
    let acc = 0;
    for (const f of flat) {
      offs.push(acc);
      acc += f.length;
    }
    return offs;
  };
  const idAt = (flat: number[][], offs: number[], i: number): number => {
    for (let g = flat.length - 1; g >= 0; g--) {
      if (i >= offs[g]) return flat[g][i - offs[g]];
    }
    return flat[0][0];
  };

  // Tapa delantera: en esta cara abren TODOS los agujeros (pasantes y ciegos).
  const frontHolePolys = [...throughHoles, ...blindHoles].map((h) => h.flat);
  const trisFront = triangulate(frontClosed, frontHolePolys);
  const flat3dFront: number[][] = [frontCap, ...allHoleFronts];
  const offF = makeOffsets(flat3dFront);
  for (const t of trisFront) {
    if (t.length < 3) continue;
    faces.push([idAt(flat3dFront, offF, t[0]), idAt(flat3dFront, offF, t[1]), idAt(flat3dFront, offF, t[2])]);
  }

  // Tapa trasera: solo los agujeros PASANTES la atraviesan.
  const throughPolys = throughHoles.map((h) => h.flat);
  const trisBack = triangulate(frontClosed, throughPolys);
  const flat3dBack: number[][] = [backCap, ...throughBack];
  const offB = makeOffsets(flat3dBack);
  for (const t of trisBack) {
    if (t.length < 3) continue;
    faces.push([idAt(flat3dBack, offB, t[2]), idAt(flat3dBack, offB, t[1]), idAt(flat3dBack, offB, t[0])]);
  }

  // Caras laterales del contorno exterior:
  // [frente_k, tras_k, tras_{k+1}, frente_{k+1}] — winding exterior
  for (let k = 0; k < frontCap.length; k++) {
    const k2 = (k + 1) % frontCap.length;
    faces.push([frontCap[k], backCap[k], backCap[k2], frontCap[k2]]);
  }

  // Paredes de los agujeros PASANTES (frente z=0 → fondo trasero z=-depth).
  // El interior es aire, winding hacia dentro:
  // [frente_k, frente_{k+1}, tras_{k+1}, tras_k]
  for (let h = 0; h < throughFront.length; h++) {
    const fIds = throughFront[h];
    const bIds = throughBack[h];
    const nh = fIds.length;
    for (let k = 0; k < nh; k++) {
      const k2 = (k + 1) % nh;
      faces.push([fIds[k], fIds[k2], bIds[k2], bIds[k]]);
    }
  }

  // Paredes de los agujeros CIEGOS (frente z=0 → suelo z=-depth_ciego).
  for (let h = 0; h < blindFront.length; h++) {
    const fIds = blindFront[h];
    const bIds = blindWallBack[h];
    const nh = fIds.length;
    for (let k = 0; k < nh; k++) {
      const k2 = (k + 1) % nh;
      faces.push([fIds[k], fIds[k2], bIds[k2], bIds[k]]);
    }
  }

  // Suelo (fondo) de cada agujero ciego: polígono relleno mirando a +Z.
  for (let h = 0; h < blindFloor.length; h++) {
    const ring = blindFloor[h];
    const t = triangulate(blindFloorRing[h], []);
    for (const tri of t) {
      if (tri.length < 3) continue;
      faces.push([ring[tri[0]], ring[tri[1]], ring[tri[2]]]);
    }
  }

  return { vertices, faces };
}`;

  edit(f, {
    name: 'views-mesh: extrudeSinglePolygon con calado múltiple/ciego',
    marker: '// CALADO-CIEGO-EXTRUDE',
    regex: /function extrudeSinglePolygon\([\s\S]*?\n\}\n\n\/\*\*\n \* Construye un objeto 3D extruyendo/,
    replace: NEW_EXTRUDE + '\n\n/**\n * Construye un objeto 3D extruyendo',
  });

  edit(f, {
    name: 'views-mesh: buildExtrudeMeshes acepta HoleSpec[]',
    marker: 'subtractHoles: HoleSpec[] = []',
    find: '  subtractHoles: Polygon[] = []\n',
    replace: '  subtractHoles: HoleSpec[] = []\n',
  });

  save(f);
}

// ===========================================================================
// 3) lib/sweep-mesh.ts  -> recorrido con calado ciego
// ===========================================================================
{
  const f = load('lib/sweep-mesh.ts');
  edit(f, {
    name: 'sweep-mesh: import de HoleSpec/holePolygon/holeDepth',
    marker: '  type HoleSpec,\n  type Mesh,',
    find: 'import {\n  flattenPolygon,\n  resampleClosed,\n',
    replace: 'import {\n  flattenPolygon,\n  resampleClosed,\n  holePolygon,\n  holeDepth,\n  type HoleSpec,\n',
  });

  edit(f, {
    name: 'sweep-mesh: SweepOptions.holes -> HoleSpec[]',
    marker: '  holes?: HoleSpec[];',
    find: '  holes?: Polygon[];\n',
    replace: '  holes?: HoleSpec[];\n',
  });

  edit(f, {
    name: 'sweep-mesh: normaliza agujeros (polígono + profundidad)',
    marker: '  const holeDepths: number[] = [];',
    find:
      '  const holeRings: Point2D[][] = [];\n' +
      '  for (const hole of options.holes ?? []) {\n' +
      '    if (hole.length < 3) continue;\n' +
      '    const flat = flattenPolygon(hole, 12);\n' +
      '    if (flat.length < 3) continue;\n' +
      '    holeRings.push(resampleClosed(flat, ringCount));\n' +
      '  }\n' +
      '  const holeCount = holeRings.length;\n',
    replace:
      '  const holeRings: Point2D[][] = [];\n' +
      '  const holeDepths: number[] = [];\n' +
      '  for (const hole of options.holes ?? []) {\n' +
      '    const poly = holePolygon(hole);\n' +
      '    if (poly.length < 3) continue;\n' +
      '    const flat = flattenPolygon(poly, 12);\n' +
      '    if (flat.length < 3) continue;\n' +
      '    holeRings.push(resampleClosed(flat, ringCount));\n' +
      '    holeDepths.push(holeDepth(hole));\n' +
      '  }\n' +
      '  const holeCount = holeRings.length;\n',
  });

  edit(f, {
    name: 'sweep-mesh: longitud de arco + última muestra por agujero',
    marker: '  const holeEndIdx: number[] = [];',
    find: '  const vertices: Vertex3D[] = [];\n  const ringIds: number[][] = [];\n',
    replace:
      '  // Longitud de arco acumulada a lo largo del recorrido (calado ciego).\n' +
      '  const cumLen: number[] = [0];\n' +
      '  for (let i = 1; i < total; i++) {\n' +
      '    const dd = vsub(samples[i].pos, samples[i - 1].pos);\n' +
      '    cumLen[i] = cumLen[i - 1] + Math.hypot(dd.x, dd.y, dd.z);\n' +
      '  }\n' +
      '  const pathLen = cumLen[total - 1] || 0;\n' +
      '  // Última muestra que alcanza cada agujero: pasante (o recorrido cerrado)\n' +
      '  // => total - 1; ciego => la muestra donde la longitud de arco llega a su\n' +
      '  // profundidad.\n' +
      '  const holeEndIdx: number[] = [];\n' +
      '  for (let h = 0; h < holeCount; h++) {\n' +
      '    const hd = holeDepths[h];\n' +
      '    if (closed || !(hd > 0) || hd >= pathLen - 1e-9) {\n' +
      '      holeEndIdx.push(total - 1);\n' +
      '      continue;\n' +
      '    }\n' +
      '    let e = 1;\n' +
      '    for (let i = 1; i < total; i++) {\n' +
      '      if (cumLen[i] <= hd + 1e-9) e = i;\n' +
      '      else break;\n' +
      '    }\n' +
      '    holeEndIdx.push(Math.min(e, total - 1));\n' +
      '  }\n' +
      '\n' +
      '  const vertices: Vertex3D[] = [];\n' +
      '  const ringIds: number[][] = [];\n',
  });

  edit(f, {
    name: 'sweep-mesh: paredes interiores respetan el fondo ciego',
    marker: '      const last = holeEndIdx[h];',
    find:
      '  // Piel interior de cada agujero (normales hacia el eje del agujero).\n' +
      '  if (holeCount > 0) {\n' +
      '    for (let i = 0; i + 1 < total; i++) {\n' +
      '      for (let h = 0; h < holeCount; h++) {\n' +
      '        const aIds = holeRingIds[i][h];\n' +
      '        const bIds = holeRingIds[i + 1][h];\n' +
      '        const axis = vmul(\n' +
      '          vadd(faceCenter(aIds, vertices), faceCenter(bIds, vertices)),\n' +
      '          0.5\n' +
      '        );\n' +
      '        stitch(aIds, bIds, axis, -1);\n' +
      '      }\n' +
      '    }\n' +
      '    if (closed) {\n' +
      '      for (let h = 0; h < holeCount; h++) {\n' +
      '        const aIds = holeRingIds[total - 1][h];\n' +
      '        const bIds = holeRingIds[0][h];\n' +
      '        const axis = vmul(\n' +
      '          vadd(faceCenter(aIds, vertices), faceCenter(bIds, vertices)),\n' +
      '          0.5\n' +
      '        );\n' +
      '        stitch(aIds, bIds, axis, -1);\n' +
      '      }\n' +
      '    }\n' +
      '  }\n',
    replace:
      '  // Piel interior de cada agujero (normales hacia el eje del agujero).\n' +
      '  // Un calado ciego solo recorre las muestras hasta su fondo.\n' +
      '  if (holeCount > 0) {\n' +
      '    for (let h = 0; h < holeCount; h++) {\n' +
      '      const last = holeEndIdx[h];\n' +
      '      for (let i = 0; i < last; i++) {\n' +
      '        const aIds = holeRingIds[i][h];\n' +
      '        const bIds = holeRingIds[i + 1][h];\n' +
      '        const axis = vmul(\n' +
      '          vadd(faceCenter(aIds, vertices), faceCenter(bIds, vertices)),\n' +
      '          0.5\n' +
      '        );\n' +
      '        stitch(aIds, bIds, axis, -1);\n' +
      '      }\n' +
      '      if (closed) {\n' +
      '        const aIds = holeRingIds[total - 1][h];\n' +
      '        const bIds = holeRingIds[0][h];\n' +
      '        const axis = vmul(\n' +
      '          vadd(faceCenter(aIds, vertices), faceCenter(bIds, vertices)),\n' +
      '          0.5\n' +
      '        );\n' +
      '        stitch(aIds, bIds, axis, -1);\n' +
      '      }\n' +
      '    }\n' +
      '  }\n',
  });

  edit(f, {
    name: 'sweep-mesh: tapas filtran pasantes y añade suelo de los ciegos',
    marker: 'const throughEndHoles: number[][] = [];',
    find:
      '  if (!closed) {\n' +
      '    cap(ringIds[0], holeRingIds[0], samples[0].pos, tangents[0], -1);\n' +
      '    cap(\n' +
      '      ringIds[total - 1],\n' +
      '      holeRingIds[total - 1],\n' +
      '      samples[total - 1].pos,\n' +
      '      tangents[total - 1],\n' +
      '      1\n' +
      '    );\n' +
      '  }\n',
    replace:
      '  if (!closed) {\n' +
      '    // Tapa inicial: todos los agujeros (pasantes y ciegos) abren aquí.\n' +
      '    cap(ringIds[0], holeRingIds[0], samples[0].pos, tangents[0], -1);\n' +
      '    // Tapa final: solo los agujeros PASANTES la atraviesan; los ciegos\n' +
      '    // quedan cerrados por su propio suelo antes de llegar.\n' +
      '    const throughEndHoles: number[][] = [];\n' +
      '    for (let h = 0; h < holeCount; h++) {\n' +
      '      if (holeEndIdx[h] >= total - 1) throughEndHoles.push(holeRingIds[total - 1][h]);\n' +
      '    }\n' +
      '    cap(\n' +
      '      ringIds[total - 1],\n' +
      '      throughEndHoles,\n' +
      '      samples[total - 1].pos,\n' +
      '      tangents[total - 1],\n' +
      '      1\n' +
      '    );\n' +
      '    // Suelo (fondo) de cada calado ciego: tapa rellena en su muestra\n' +
      '    // final, mirando hacia atrás (hacia la abertura del bolsillo).\n' +
      '    for (let h = 0; h < holeCount; h++) {\n' +
      '      const e = holeEndIdx[h];\n' +
      '      if (e >= total - 1) continue;\n' +
      '      cap(holeRingIds[e][h], [], samples[e].pos, tangents[e], -1);\n' +
      '    }\n' +
      '  }\n',
  });

  save(f);
}

// ===========================================================================
// 4) components/editor/Editor3D.tsx  -> estado + UI + paso de profundidad
// ===========================================================================
{
  const f = load('components/editor/Editor3D.tsx');

  edit(f, {
    name: 'Editor3D: import type HoleSpec',
    marker: '  type HoleSpec,\n} from',
    find: '  type Handle2D,\n} from ',
    replace: '  type Handle2D,\n  type HoleSpec,\n} from ',
  });

  edit(f, {
    name: 'Editor3D: estado extrudeHoleDepths',
    marker: 'const [extrudeHoleDepths, setExtrudeHoleDepths]',
    find: '  const [extrudeHoles, setExtrudeHoles] = useState<string[]>([]);\n',
    replace:
      '  const [extrudeHoles, setExtrudeHoles] = useState<string[]>([]);\n' +
      '  // Profundidad de cada calado (id de polilínea → profundidad).\n' +
      '  // 0/ausente = pasante; > 0 = ciego (socava esa profundidad).\n' +
      '  const [extrudeHoleDepths, setExtrudeHoleDepths] = useState<Record<string, number>>({});\n',
  });

  edit(f, {
    name: 'Editor3D: recorrido pasa profundidad de cada calado',
    marker: 'if (poly) holes.push({ polygon: poly, depth: extrudeHoleDepths[line.id] ?? 0 });',
    find:
      '        const frontPolylines = getPolylines(\'views:front\');\n' +
      '        const holes: Polygon[] = [];\n' +
      '        for (const line of frontPolylines) {\n' +
      '          if (!extrudeHoles.includes(line.id)) continue;\n' +
      '          const poly = polylineToPolygon(line);\n' +
      '          if (poly) holes.push(poly);\n' +
      '        }\n',
    replace:
      '        const frontPolylines = getPolylines(\'views:front\');\n' +
      '        const holes: HoleSpec[] = [];\n' +
      '        for (const line of frontPolylines) {\n' +
      '          if (!extrudeHoles.includes(line.id)) continue;\n' +
      '          const poly = polylineToPolygon(line);\n' +
      '          if (poly) holes.push({ polygon: poly, depth: extrudeHoleDepths[line.id] ?? 0 });\n' +
      '        }\n',
  });

  edit(f, {
    name: 'Editor3D: extrusión simple pasa profundidad de cada calado',
    marker: '            holes.push({ polygon: poly, depth: extrudeHoleDepths[line.id] ?? 0 });\n          } else {',
    find:
      '        const shapes: Polygon[] = [views.front];\n' +
      '        const holes: Polygon[] = [];\n' +
      '        for (const line of frontPolylines) {\n' +
      '          const poly = polylineToPolygon(line);\n' +
      '          if (!poly) continue;\n' +
      '          if (extrudeHoles.includes(line.id)) {\n' +
      '            holes.push(poly);\n' +
      '          } else {\n' +
      '            shapes.push(poly);\n' +
      '          }\n' +
      '        }\n',
    replace:
      '        const shapes: Polygon[] = [views.front];\n' +
      '        const holes: HoleSpec[] = [];\n' +
      '        for (const line of frontPolylines) {\n' +
      '          const poly = polylineToPolygon(line);\n' +
      '          if (!poly) continue;\n' +
      '          if (extrudeHoles.includes(line.id)) {\n' +
      '            holes.push({ polygon: poly, depth: extrudeHoleDepths[line.id] ?? 0 });\n' +
      '          } else {\n' +
      '            shapes.push(poly);\n' +
      '          }\n' +
      '        }\n',
  });

  edit(f, {
    name: 'Editor3D: extrudeHoleDepths en deps del useMemo',
    marker: '    extrudeHoles,\n    extrudeHoleDepths,',
    find: '    extrudeDepth,\n    extrudeHoles,\n    figureColor,\n',
    replace: '    extrudeDepth,\n    extrudeHoles,\n    extrudeHoleDepths,\n    figureColor,\n',
  });

  // UI: lista de calados con pasante/ciego + profundidad.
  const UI_BLOCK = [
    '{/* CALADO-MULTI-CIEGO: lista de calados con su profundidad */}',
    '{extrudeHoles.length > 0 && (',
    '  <div className="flex flex-col gap-2 rounded-md border border-red-500/20 bg-red-500/5 p-2">',
    '    <div className="flex items-center justify-between gap-2">',
    "      <span className=\"text-[10px] font-medium text-red-300\">{t('editor3D.subtract')} · {extrudeHoles.length}</span>",
    '      <button',
    '        onClick={() => { setExtrudeHoles([]); setExtrudeHoleDepths({}); }}',
    "        className=\"text-[10px] text-red-300/80 hover:text-red-200\"",
    "        title={t('editor3D.holeRemove')}",
    '      >',
    "        {t('editor3D.holeRemove')}",
    '      </button>',
    '    </div>',
    '{extrudeHoles.map((id, i) => {',
    '  const d = extrudeHoleDepths[id] ?? 0;',
    '  const blind = d > 0 && d < extrudeDepth;',
    '  return (',
    '    <div key={id} className="flex items-center gap-2">',
    '      <span className="w-5 text-[10px] text-muted-foreground/80">{i + 1}.</span>',
    '      <span className="w-14 whitespace-nowrap text-[10px] text-red-200">{blind ? t(\'editor3D.holeBlind\') : t(\'editor3D.holeThrough\')}</span>',
    '      <Slider',
    '        min={0}',
    '        max={extrudeDepth}',
    '        step={0.05}',
    '        value={[Math.min(d, extrudeDepth)]}',
    '        onValueChange={([v]) => setExtrudeHoleDepths((prev) => ({ ...prev, [id]: v }))}',
    '        className="flex-1"',
    '      />',
    '      <span className="w-10 text-right font-mono text-[10px] text-green-400">{blind ? d.toFixed(2) : \'-\'}</span>',
    '      <button',
    '        onClick={() => setExtrudeHoles((prev) => prev.filter((x) => x !== id))}',
    '        className="px-1 text-[10px] text-red-300/70 hover:text-red-200"',
    "        title={t('editor3D.holeRemove')}",
    '      >',
    '        ✕',
    '      </button>',
    '    </div>',
    '  );',
    '})}',
    '    <p className="text-[10px] text-muted-foreground/60">{t(\'editor3D.holeDepthLabel\')}</p>',
    '  </div>',
    ')}',
  ]
    .map((s) => (s ? '                      ' + s : s))
    .join('\n');

  const UI_ANCHOR = [
    '                     </div>',
    '                    </div>',
    '                  </div>',
    '              ) : (',
    '                <div className="flex-1 overflow-y-auto grid grid-rows-[320px_320px_320px] gap-2 p-3 min-h-0 custom-scrollbar">',
  ].join('\n');

  const UI_REPLACE = [
    '                     </div>',
    UI_BLOCK,
    '                    </div>',
    '                  </div>',
    '              ) : (',
    '                <div className="flex-1 overflow-y-auto grid grid-rows-[320px_320px_320px] gap-2 p-3 min-h-0 custom-scrollbar">',
  ].join('\n');

  edit(f, {
    name: 'Editor3D: bloque UI de calados (múltiples + ciego)',
    marker: 'CALADO-MULTI-CIEGO',
    find: UI_ANCHOR,
    replace: UI_REPLACE,
  });

  // Resetear profundidades al cargar/reiniciar.
  edit(f, {
    name: 'Editor3D: reset depths al aplicar estado (histórico)',
    marker: 'setExtrudeHoles(state.extrudeHoles ?? []);\n    setExtrudeHoleDepths',
    find: '    setExtrudeHoles(state.extrudeHoles ?? []);\n',
    replace: '    setExtrudeHoles(state.extrudeHoles ?? []);\n    setExtrudeHoleDepths({});\n',
  });
  edit(f, {
    name: 'Editor3D: reset depths al aplicar config',
    marker: 'setExtrudeHoles(config.extrudeHoles ?? []);\n    setExtrudeHoleDepths',
    find: '    setExtrudeHoles(config.extrudeHoles ?? []);\n',
    replace: '    setExtrudeHoles(config.extrudeHoles ?? []);\n    setExtrudeHoleDepths({});\n',
  });
  edit(f, {
    name: 'Editor3D: reset depths al cargar datos',
    marker: 'setExtrudeHoles(data.extrudeHoles);\n        setExtrudeHoleDepths',
    find: '        if (Array.isArray(data.extrudeHoles))\n          setExtrudeHoles(data.extrudeHoles);\n',
    replace: '        if (Array.isArray(data.extrudeHoles))\n          setExtrudeHoles(data.extrudeHoles);\n        setExtrudeHoleDepths({});\n',
  });
  edit(f, {
    name: 'Editor3D: reset depths al reiniciar la pestaña',
    marker: '      setExtrudeHoles([]);\n      setExtrudeHoleDepths({});\n      setEditedVertices(null);',
    find: '      setExtrudeDepth(0.5);\n      setExtrudeHoles([]);\n      setEditedVertices(null);\n',
    replace: '      setExtrudeDepth(0.5);\n      setExtrudeHoles([]);\n      setExtrudeHoleDepths({});\n      setEditedVertices(null);\n',
  });
  edit(f, {
    name: 'Editor3D: botón Sustraer también limpia profundidades',
    marker: 'setExtrudeHoles([]);\n                              setExtrudeHoleDepths({});\n                            }',
    find: '                            if (extrudeHoles.length > 0) {\n                              setExtrudeHoles([]);\n                            }\n',
    replace: '                            if (extrudeHoles.length > 0) {\n                              setExtrudeHoles([]);\n                              setExtrudeHoleDepths({});\n                            }\n',
  });

  save(f);
}

// ===========================================================================
// 5) lib/i18n/translations.ts  -> claves nuevas (solo idioma base; el resto
//    cae en español por el fallback), pero como el tipo exige todas las
//    lenguas, se añaden a las 7.
// ===========================================================================
{
  const f = load('lib/i18n/translations.ts');
  const ADD = [
    [
      "holeDepthLabel: 'Profundidad del calado',",
      "holeThrough: 'Pasante',",
      "holeBlind: 'Ciego',",
      "holeRemove: 'Quitar calado',",
    ],
    [
      "holeDepthLabel: 'Hole depth',",
      "holeThrough: 'Through',",
      "holeBlind: 'Blind',",
      "holeRemove: 'Remove hole',",
    ],
    [
      "holeDepthLabel: 'Profondeur de la découpe',",
      "holeThrough: 'Traversant',",
      "holeBlind: 'Borgne',",
      "holeRemove: 'Retirer la découpe',",
    ],
    [
      "holeDepthLabel: 'Schnitttiefe',",
      "holeThrough: 'Durchgehend',",
      "holeBlind: 'Sackloch',",
      "holeRemove: 'Schnitt entfernen',",
    ],
    [
      "holeDepthLabel: 'Profondità del taglio',",
      "holeThrough: 'Passante',",
      "holeBlind: 'Cieco',",
      "holeRemove: 'Rimuovi taglio',",
    ],
    [
      "holeDepthLabel: '挖孔深度',",
      "holeThrough: '贯穿',",
      "holeBlind: '盲孔',",
      "holeRemove: '移除挖孔',",
    ],
    [
      "holeDepthLabel: 'कटाव गहराई',",
      "holeThrough: 'आर-पार',",
      "holeBlind: 'बंद',",
      "holeRemove: 'कटाव हटाएं',",
    ],
  ];

  if (f.text.includes('holeDepthLabel')) {
    skipped++;
    console.log('  = i18n: claves de calado (ya aplicado)');
  } else {
    const lines = f.text.split('\n');
    let idx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("    subtractDrawn: '")) {
        const add = ADD[idx++];
        if (!add) throw new Error('más bloques subtractDrawn de los esperados');
        const block = add.map((s) => '    ' + s).join('\n');
        lines[i] = lines[i] + '\n' + block;
      }
    }
    if (idx !== ADD.length) throw new Error('subtractDrawn encontrados: ' + idx + ', esperados ' + ADD.length);
    f.text = lines.join('\n');
    applied++;
    console.log('  + i18n: claves de calado en ' + idx + ' idiomas');
    save(f);
  }
}

// ===========================================================================
// 6) Actualiza aserciones de los tests previos afectadas por el cambio de tipo
// ===========================================================================
{
  const f = load('tools/test-sweep-hole.cjs');
  edit(f, {
    name: 'test-sweep-hole: espera HoleSpec[]',
    marker: 'holes\\?:\\s*HoleSpec',
    find: "ok('SweepOptions incluye holes', /holes\\?:\\s*Polygon\\[\\]/.test(sweep));",
    replace: "ok('SweepOptions incluye holes (HoleSpec)', /holes\\?:\\s*HoleSpec\\[\\]/.test(sweep));",
  });
  save(f);

  const g = load('tools/test-subtract-hole.cjs');
  edit(g, {
    name: 'test-subtract-hole: espera holes.push({polygon, depth})',
    marker: 'holes\\.push\\(\\{ polygon: poly, depth: extrudeHoleDepths',
    find:
      "  ok('el mesh añade los ids en extrudeHoles a holes',\n" +
      "     /if \\(extrudeHoles\\.includes\\(line\\.id\\)\\) \\{\\s*\\n\\s*holes\\.push\\(poly\\);/.test(src));",
    replace:
      "  ok('el mesh añade los ids en extrudeHoles a holes',\n" +
      "     /if \\(extrudeHoles\\.includes\\(line\\.id\\)\\) \\{\\s*\\n\\s*holes\\.push\\(\\{ polygon: poly, depth: extrudeHoleDepths\\[line\\.id\\] \\?\\? 0 \\}\\);/.test(src));",
  });
  save(g);
}

console.log('\n----------------------------------------');
console.log('Aplicadas: ' + applied + ', ya presentes: ' + skipped);
process.exit(0);
