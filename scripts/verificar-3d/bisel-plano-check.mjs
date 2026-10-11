/**
 * Verificación numérica del deformador BISEL PLANO (lib/deformadores.ts):
 * marco interior sobre las caras seleccionadas (param oculto carasSel).
 *
 * Uso: node scripts/verificar-3d/bisel-plano-check.mjs
 * (requiere el bundle generado antes por esbuild: deform-bundle.cjs)
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const raiz = path.resolve(import.meta.dirname, '../..');
const {
  DEFORMADORES_DIRECTOS,
  aplicarDeformador,
  unirMallasComoGrupo,
  carasSelEnUnion,
  finicioDeMiembro,
  CARAS_SEL_NINGUNA,
} = require(path.join(raiz, 'scripts/verificar-3d/deform-bundle.cjs'));
const { evaluateDeformadorTrack } = require(
  path.join(raiz, 'scripts/verificar-3d/anim-bundle.cjs')
);

let fallos = 0;
const revisar = (cond, descripcion) => {
  if (!cond) {
    fallos++;
    console.log('  ✗ FALLO:', descripcion);
  }
};

const sinFinitos = (m) =>
  m.vertices.filter(
    (v) => !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)
  ).length;

/** Cubo SIN índices compartidos (24 vértices, 6 quads), cara 0 = cima. */
function cubo() {
  const s = 0.5;
  const caras = [
    // [p1..p4] CCW vistas desde FUERA de cada cara.
    { n: 'cima', vs: [[-s, s, -s], [s, s, -s], [s, s, s], [-s, s, s]] },
    { n: 'base', vs: [[-s, -s, s], [s, -s, s], [s, -s, -s], [-s, -s, -s]] },
    { n: 'frente', vs: [[-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]] },
    { n: 'atras', vs: [[s, -s, -s], [-s, -s, -s], [-s, s, -s], [s, s, -s]] },
    { n: 'der', vs: [[s, -s, s], [s, -s, -s], [s, s, -s], [s, s, s]] },
    { n: 'izq', vs: [[-s, -s, -s], [-s, -s, s], [-s, s, s], [-s, s, -s]] },
  ];
  const vertices = [];
  const faces = [];
  const faceColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
  for (const c of caras) {
    faces.push(c.vs.map(([x, y, z]) => {
      vertices.push({ x, y, z });
      return vertices.length - 1;
    }));
  }
  return { vertices, faces, faceColors };
}

/** Normal Newell (unitaria) de una cara. */
const normalCara = (m, fi) => {
  let nx = 0, ny = 0, nz = 0;
  const f = m.faces[fi];
  for (let i = 0; i < f.length; i++) {
    const A = m.vertices[f[i]];
    const B = m.vertices[f[(i + 1) % f.length]];
    nx += (A.y - B.y) * (A.z + B.z);
    ny += (A.z - B.z) * (A.x + B.x);
    nz += (A.x - B.x) * (A.y + B.y);
  }
  const len = Math.hypot(nx, ny, nz);
  return { x: nx / len, y: ny / len, z: nz / len };
};

const CLAVE = (v) =>
  `${Math.round(v.x * 1e4)}|${Math.round(v.y * 1e4)}|${Math.round(v.z * 1e4)}`;

const PARAMS_BASE = { separacion: 20, profInterior: 0, profMarco: 0 };

console.log('== Registro ==');
{
  const def = DEFORMADORES_DIRECTOS.find((d) => d.id === 'bisel-plano');
  revisar(!!def, 'bisel-plano registrado en DEFORMADORES_DIRECTOS');
  revisar(def?.params?.length === 3, `bisel-plano con 3 sliders (${def?.params?.length})`);
  revisar(
    def?.params.every((p) => p.id !== 'carasSel'),
    'carasSel OCULTO (no aparece en el panel de params)'
  );
  revisar(def?.params[0]?.valor === 0, 'default de separacion NEUTRO (0)');
}

console.log('\n== Cubo: neutros ==');
{
  const m = cubo();
  const m2 = cubo();
  const s0 = aplicarDeformador('bisel-plano', m, { ...PARAMS_BASE, separacion: 0, carasSel: '0' });
  revisar(s0 === m2 || JSON.stringify(s0) === JSON.stringify(m2),
    'separacion 0: neutro (malla intacta)');
  const s1 = aplicarDeformador('bisel-plano', m, { ...PARAMS_BASE, carasSel: CARAS_SEL_NINGUNA });
  revisar(s1 === m2 || JSON.stringify(s1) === JSON.stringify(m2),
    "carasSel '-1' (sin captura): neutro");
  const s2 = aplicarDeformador('bisel-plano', m, { ...PARAMS_BASE, carasSel: '999' });
  revisar(s2 === m2 || JSON.stringify(s2) === JSON.stringify(m2),
    'carasSel fuera de rango: neutro');
  // Defaults sin params: no explota.
  const s3 = aplicarDeformador('bisel-plano', m, {});
  revisar(sinFinitos(s3) === 0, 'con defaults: sin vértices no finitos');
}

console.log('\n== Cubo: marco plano (profs 0) ==');
{
  const m = cubo();
  const orig = JSON.parse(JSON.stringify(m));
  const s = aplicarDeformador('bisel-plano', m, { ...PARAMS_BASE, carasSel: '0' });
  // La cara 0 (1 quad) → banda 4 quads + interior 1: 6 → 10 caras.
  revisar(s.faces.length === 10, `caras 6 → 10 (banda + interior) salieron ${s.faces.length}`);
  revisar(s.faceColors?.length === s.faces.length, 'faceColors alineado');
  revisar(sinFinitos(s) === 0, 'sin vértices no finitos');
  const igual = orig.vertices.every(
    (v, i) => v.x === m.vertices[i].x && v.y === m.vertices[i].y && v.z === m.vertices[i].z
  );
  revisar(igual, 'la malla de entrada NO mutó');
  // Todo en la caja original (marco plano: nada sobresale).
  const yMax = Math.max(...s.vertices.map((v) => v.y));
  const yMin = Math.min(...s.vertices.map((v) => v.y));
  revisar(yMax <= 0.5 + 1e-9 && yMin >= -0.5 - 1e-9,
    `marco plano: todo dentro de la caja (y ${yMin.toFixed(4)}…${yMax.toFixed(4)})`);
  // 4 vértices nuevos del anillo interior a 0.3 en x y z (sep 20% de 1).
  const interiorRing = s.vertices.filter(
    (v) => Math.abs(Math.abs(v.x) - 0.3) < 1e-6 && Math.abs(Math.abs(v.z) - 0.3) < 1e-6 &&
      Math.abs(v.y - 0.5) < 1e-6
  );
  revisar(interiorRing.length === 4, `anillo interior de 4 esquinas (${interiorRing.length})`);
  // Donante: las 5 caras nuevas heredan el color rojo de la cima.
  const rojas = s.faceColors.slice(5).filter((c) => c === '#ff0000').length;
  revisar(rojas === 5, `caras nuevas donantes del color de la cima (${rojas}/5)`);
  // Determinismo.
  const s2 = aplicarDeformador('bisel-plano', cubo(), { ...PARAMS_BASE, carasSel: '0' });
  revisar(JSON.stringify(s2) === JSON.stringify(s), 'determinista');
}

console.log('\n== Cubo: UVs alineadas ==');
{
  const m = cubo();
  m.uvs = m.vertices.map((_, i) => [i * 0.01, 1 - i * 0.01]);
  const s = aplicarDeformador('bisel-plano', m, { ...PARAMS_BASE, carasSel: '0' });
  revisar(!!s.uvs && s.uvs.length === s.vertices.length,
    `uvs ${s.uvs?.length} alineadas con vértices ${s.vertices.length}`);
}

console.log('\n== Cubo: profInterior 50 (interior sube) ==');
{
  const m = cubo();
  const diag = Math.sqrt(3); // caja 1×1×1
  const profAbs = (50 / 100) * diag * 0.5; // 0.866
  const nCima = normalCara(m, 0); // (0,±1,0) según enrolado
  const s = aplicarDeformador('bisel-plano', m, {
    ...PARAMS_BASE, profInterior: 50, carasSel: '0',
  });
  // Delta a lo largo de la normal orientada hacia FUERA del material
  // (positivo = sale). La cima: fuera = +Y.
  const esperadoY = 0.5 + profAbs;
  const arriba = s.vertices.filter(
    (v) => Math.abs(v.y - esperadoY) < 1e-6 &&
      Math.abs(Math.abs(v.x) - 0.3) < 1e-6 && Math.abs(Math.abs(v.z) - 0.3) < 1e-6
  );
  revisar(arriba.length === 4,
    `4 vértices del interior se movieron profAbs=${profAbs.toFixed(4)} a y=${esperadoY.toFixed(4)} (${arriba.length})`);
  // La banda comparte el anillo interior con el polígono (se inclina con él):
  // los 4 canones del borde EXTERIOR quedan en su sitio (12 copias del cubo
  // sin índices: cada esquina arriba aparece 3 veces: cima + 2 laterales).
  const borde = s.vertices.filter(
    (v) => Math.abs(Math.abs(v.x) - 0.5) < 1e-9 && Math.abs(Math.abs(v.z) - 0.5) < 1e-9 &&
      Math.abs(v.y - 0.5) < 1e-9
  );
  revisar(borde.length === 12,
    `el borde exterior NO se movió con profInterior (12 copias, salieron ${borde.length})`);
  revisar(sinFinitos(s) === 0, 'sin vértices no finitos');
}

console.log('\n== CONSISTENCIA: dos caras se mueven al MISMO lado ==');
{
  // Cima (0) y frente (2) de un cubo con enrolados MIXTOS: ambas han de
  // responder al mismo slider en el mismo sentido (fuera con positivo —
  // el fallo del usuario: una se metía y la otra salía).
  const m = cubo();
  const profAbs = (50 / 100) * Math.sqrt(3) * 0.5;
  const s = aplicarDeformador('bisel-plano', m, {
    ...PARAMS_BASE, profInterior: 50, carasSel: '0,2',
  });
  // Interior de la CIMA sale hacia +Y: y = 0.5+profAbs.
  const cima = s.vertices.filter(
    (v) => Math.abs(v.y - (0.5 + profAbs)) < 1e-6 &&
      Math.abs(Math.abs(v.x) - 0.3) < 1e-6 && Math.abs(Math.abs(v.z) - 0.3) < 1e-6
  );
  // Interior del FRENTE sale hacia +Z: z = 0.5+profAbs.
  const frente = s.vertices.filter(
    (v) => Math.abs(v.z - (0.5 + profAbs)) < 1e-6 &&
      Math.abs(Math.abs(v.x) - 0.3) < 1e-6 && Math.abs(Math.abs(v.y) - 0.3) < 1e-6
  );
  revisar(cima.length === 4 && frente.length === 4,
    `ambos interiores SALIERON hacia fuera (cima ${cima.length}, frente ${frente.length})`);
  // Y con el signo contrario: ambos se meten hacia adentro.
  const s2 = aplicarDeformador('bisel-plano', cubo(), {
    ...PARAMS_BASE, profInterior: -50, carasSel: '0,2',
  });
  const cimaIn = s2.vertices.filter(
    (v) => Math.abs(v.y - (0.5 - profAbs)) < 1e-6 &&
      Math.abs(Math.abs(v.x) - 0.3) < 1e-6 && Math.abs(Math.abs(v.z) - 0.3) < 1e-6
  );
  const frenteIn = s2.vertices.filter(
    (v) => Math.abs(v.z - (0.5 - profAbs)) < 1e-6 &&
      Math.abs(Math.abs(v.x) - 0.3) < 1e-6 && Math.abs(Math.abs(v.y) - 0.3) < 1e-6
  );
  revisar(cimaIn.length === 4 && frenteIn.length === 4,
    `negativo: ambos se METEN hacia dentro (cima ${cimaIn.length}, frente ${frenteIn.length})`);
}

console.log('\n== Cubo: profMarco 50 (marco extruido, estanco) ==');
{
  // nCima se usa solo como comentario de contexto; el sentido esperado es
  // la normal orientada hacia fuera (profMarco positivo = sale).
  const m = cubo();
  const diag = Math.sqrt(3);
  const profAbs = (50 / 100) * diag * 0.5; // 0.866
  const nCima = normalCara(m, 0);
  const dy = profAbs; // fuera de la cima = +Y (normal orientada hacia fuera)
  const s = aplicarDeformador('bisel-plano', m, {
    ...PARAMS_BASE, profMarco: 50, carasSel: '0',
  });
  // Cada canon de la ESQUINA de la cima: 3 copias (cima + 2 laterales).
  // Al desplazar, TODAS las copias quedan en el MISMO punto (sin rajarse).
  const esquinas = [
    [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], // [x, z]
  ];
  for (const [ex, ez] of esquinas) {
    const destino = `${Math.round(ex * 1e4)}|${Math.round((0.5 + dy) * 1e4)}|${Math.round(ez * 1e4)}`;
    const cluster = s.vertices.filter((v) => CLAVE(v) === destino).length;
    revisar(cluster === 3,
      `esquina (${ex},${ez}): 3 copias de canon desplazadas al MISMO punto (${cluster})`);
  }
  // Las 4 caras laterales siguen tocando el borde desplazado (sin agujero):
  // cada cara lateral conserva 4 vértices y su área sigue cubriendo.
  revisar(s.faces.length === 10, `caras 6 → 10 con marco extruido (${s.faces.length})`);
  revisar(sinFinitos(s) === 0, 'sin vértices no finitos');
  // El interior NO se mueve con profMarco (sigue en el plano de la cima).
  const interiorPlano = s.vertices.filter(
    (v) => Math.abs(Math.abs(v.x) - 0.3) < 1e-6 && Math.abs(Math.abs(v.z) - 0.3) < 1e-6 &&
      Math.abs(v.y - 0.5) < 1e-6
  );
  revisar(interiorPlano.length === 4,
    `polígono interior queda en el plano original con profMarco (${interiorPlano.length})`);
}

console.log('\n== Cubo: interior SUELTO (interiorSuelto=1, profInterior 50) ==');
{
  const m = cubo();
  const diag = Math.sqrt(3);
  const profAbs = (50 / 100) * diag * 0.5; // 0.866·0.5·... = 0.433
  const nCima = normalCara(m, 0);
  const tapaY = 0.5 + profAbs; // fuera = +Y
  const s = aplicarDeformador('bisel-plano', m, {
    ...PARAMS_BASE, profInterior: 50, interiorSuelto: 1, carasSel: '0',
  });
  // La cara cima se REEMPLAZA: 5 originales + 4 banda + 4 paredes + 1
  // tapa = 14 caras.
  revisar(s.faces.length === 14, `caras 6 → 14 (5+banda+paredes+tapa) salieron ${s.faces.length}`);
  // El ANILLO del marco queda PLANO (no se inclina): 4 verts a y=0.5.
  const anilloPlano = s.vertices.filter(
    (v) => Math.abs(Math.abs(v.x) - 0.3) < 1e-6 && Math.abs(Math.abs(v.z) - 0.3) < 1e-6 &&
      Math.abs(v.y - 0.5) < 1e-6
  );
  revisar(anilloPlano.length === 4,
    `anillo del marco plano (no inclinado): 4 verts (${anilloPlano.length})`);
  // La TAPA del interior extruido: 4 verts a centro+profAbs por la normal.
  const tapa = s.vertices.filter(
    (v) => Math.abs(v.y - tapaY) < 1e-6 &&
      Math.abs(Math.abs(v.x) - 0.3) < 1e-6 && Math.abs(Math.abs(v.z) - 0.3) < 1e-6
  );
  revisar(tapa.length === 4,
    `4 verts de la TAPA extruida a y=${tapaY.toFixed(4)} (${tapa.length})`);
  revisar(sinFinitos(s) === 0, 'sin vértices no finitos');
  // Determinismo.
  const s2 = aplicarDeformador('bisel-plano', cubo(), {
    ...PARAMS_BASE, profInterior: 50, interiorSuelto: 1, carasSel: '0',
  });
  revisar(JSON.stringify(s2) === JSON.stringify(s), 'suelto: determinista');
}

console.log('\n== Cubo: interior SUELTO con profInterior 0 ==');
{
  const m = cubo();
  const s = aplicarDeformador('bisel-plano', m, {
    ...PARAMS_BASE, profInterior: 0, interiorSuelto: 1, carasSel: '0',
  });
  // Sin desplazamiento: sin paredes ni vértices duplicados — igual al
  // marco plano (10 caras, 28 verts, todo en la caja).
  revisar(s.faces.length === 10, `suelto profInt 0: 10 caras (${s.faces.length})`);
  revisar(s.vertices.length === 28, `suelto profInt 0: 28 verts (${s.vertices.length})`);
  const yMax = Math.max(...s.vertices.map((v) => v.y));
  revisar(yMax <= 0.5 + 1e-9, 'suelto profInt 0: nada sale de la caja');
}

console.log('\n== Cubo: CTRL a MITAD (base capturada, sin salto) ==');
{
  // Extruir hasta 50 compartido → pulsar CTRL: el panel captura base=50.
  // El anillo e interior coinciden AHÍ (continuidad) y al seguir (70) el
  // marco queda en 50 y sólo el interior sigue.
  const diag = Math.sqrt(3);
  const abs = (p) => (p / 100) * diag * 0.5;
  // Continuidad: P == B (justo al pulsar) — idéntico al compartido.
  const s0 = aplicarDeformador('bisel-plano', cubo(), {
    ...PARAMS_BASE, profInterior: 50, interiorSuelto: 1, profInteriorBase: 50,
    carasSel: '0',
  });
  const sComp = aplicarDeformador('bisel-plano', cubo(), {
    ...PARAMS_BASE, profInterior: 50, carasSel: '0',
  });
  revisar(s0.faces.length === sComp.faces.length && s0.faces.length === 10,
    `P==B: sin salto (mismo marco, 10 caras) salieron ${s0.faces.length}`);
  const anillos0 = s0.vertices.filter(
    (v) => Math.abs(Math.abs(v.x) - 0.3) < 1e-6 && Math.abs(Math.abs(v.z) - 0.3) < 1e-6 &&
      Math.abs(v.y - (0.5 + abs(50))) < 1e-6
  );
  revisar(anillos0.length === 4, `P==B: anillo+interior coinciden a y=${(0.5 + abs(50)).toFixed(4)} (${anillos0.length})`);
  // Seguir a 70: marco congelado en 50, interior en 70, con paredes.
  const s1 = aplicarDeformador('bisel-plano', cubo(), {
    ...PARAMS_BASE, profInterior: 70, interiorSuelto: 1, profInteriorBase: 50,
    carasSel: '0',
  });
  revisar(s1.faces.length === 14,
    `P>B: banda + 4 paredes + tapa (14 caras) salieron ${s1.faces.length}`);
  const anillo = s1.vertices.filter(
    (v) => Math.abs(Math.abs(v.x) - 0.3) < 1e-6 && Math.abs(Math.abs(v.z) - 0.3) < 1e-6 &&
      Math.abs(v.y - (0.5 + abs(50))) < 1e-6
  );
  const tapa = s1.vertices.filter(
    (v) => Math.abs(Math.abs(v.x) - 0.3) < 1e-6 && Math.abs(Math.abs(v.z) - 0.3) < 1e-6 &&
      Math.abs(v.y - (0.5 + abs(70))) < 1e-6
  );
  revisar(anillo.length === 4 && tapa.length === 4,
    `anillo congelado en 50 (${anillo.length}) y tapa en 70 (${tapa.length})`);
  revisar(sinFinitos(s1) === 0, 'sin vértices no finitos');
  // Con P < B (retroceder el slider): el interior vuelve a pasar por el
  // anillo — debe producir geometría válida sin NaN.
  const s2 = aplicarDeformador('bisel-plano', cubo(), {
    ...PARAMS_BASE, profInterior: 20, interiorSuelto: 1, profInteriorBase: 50,
    carasSel: '0',
  });
  revisar(sinFinitos(s2) === 0, 'P<B: sin vértices no finitos');
  revisar(s2.faces.length === 14, `P<B: paredes conservadas (${s2.faces.length})`);
}

console.log('\n== L cóncavo (sin excepción) ==');
{
  // L de 2 celdas unitarias en el plano z=0, dividida en TRIÁNGULOS
  // (el grupo coplanar debe reconocer el polígono entero pese al refile).
  const vertices = [];
  const verticeDe = new Map();
  const idDe = (x, y) => {
    const k = `${x}|${y}`;
    if (!verticeDe.has(k)) {
      verticeDe.set(k, vertices.length);
      vertices.push({ x, y, z: 0 });
    }
    return verticeDe.get(k);
  };
  const celdas = [
    [idDe(0, 0), idDe(2, 0), idDe(2, 1), idDe(0, 1)], // brazo horizontal
    [idDe(0, 1), idDe(1, 1), idDe(1, 2), idDe(0, 2)], // brazo vertical
  ];
  const facesL = [];
  for (const [p, q, r, s2] of celdas) {
    facesL.push([p, q, r]);
    facesL.push([p, r, s2]);
  }
  const mL = { vertices, faces: facesL };
  const origL = JSON.parse(JSON.stringify(mL));
  const salida = aplicarDeformador('bisel-plano', mL, {
    separacion: 15, profInterior: 0, profMarco: 0,
    carasSel: facesL.map((_, i) => i).join(','),
  });
  revisar(sinFinitos(salida) === 0, 'L cóncavo: sin vértices no finitos');
  revisar(salida.faces.length > facesL.length, `L cóncavo: marco emitido (${facesL.length} → ${salida.faces.length})`);
  revisar(
    salida.faces.every((f) => f.every((i) => i >= 0 && i < salida.vertices.length)),
    'L cóncavo: índices de caras dentro de rango'
  );
  revisar(
    origL.vertices.every(
      (v, i) => v.x === mL.vertices[i].x && v.y === mL.vertices[i].y && v.z === mL.vertices[i].z
    ),
    'L cóncavo: entrada sin mutar'
  );
}

console.log('\n== Unión de GRUPO (remap de carasSel) ==');
{
  const a = cubo();
  const b = cubo();
  const partes = [
    { id: 'a', mesh: a, transform: {} },
    { id: 'b', mesh: b, transform: { px: 3 } },
  ];
  const union = unirMallasComoGrupo(partes, {});
  revisar(union.unida.faces.length === 12, `unión con 12 caras (${union.unida.faces.length})`);
  // carasSel del miembro 'b' cara 0 → offset = 6 caras de 'a'.
  const off = finicioDeMiembro(partes, 'b');
  revisar(off === 6, `finicioDeMiembro('b') = 6 (${off})`);
  const enUnion = carasSelEnUnion('0', union.partes, 'b');
  revisar(enUnion === '6', `carasSelEnUnion('0', partes, 'b') = '6' ('${enUnion}')`);
  revisar(carasSelEnUnion('0', union.partes, 'no-existe') === CARAS_SEL_NINGUNA,
    "carasSelEnUnion con miembro ausente → '-1'");
  const s = aplicarDeformador('bisel-plano', union.unida, {
    ...PARAMS_BASE, carasSel: enUnion,
  });
  revisar(s.faces.length === 16, `unión deformada: 12 → 16 caras (${s.faces.length})`);
  // Sin profMarco ninguna copia del canon se duplicó: la cima de 'a' sigue
  // con SUS 12 copias originales (cubos sin índices: 3 copias por esquina).
  const cimaA = s.vertices.filter(
    (v) => Math.abs(v.y - 0.5) < 1e-9 && v.x <= 0.5 && v.z <= 0.5
  );
  revisar(cimaA.length === 12, `cima de 'a' intacta (12 copias, salieron ${cimaA.length})`);
}

console.log('\n== Pista animable (carasSel se sostiene, números interpolan) ==');
{
  const pista = {
    id: 'dtrack-prueba',
    objectId: 'obj',
    deformadorId: 'bisel-plano',
    duration: 1,
    looping: false,
    keyframes: [
      {
        id: 'kf-a', time: 0, easing: 'linear',
        values: { separacion: 0, profInterior: 0, profMarco: 0, carasSel: '0' },
      },
      {
        id: 'kf-b', time: 1, easing: 'linear',
        values: { separacion: 30, profInterior: 20, profMarco: 0, carasSel: '0' },
      },
    ],
  };
  const mitad = evaluateDeformadorTrack(pista, 0.5);
  revisar(!!mitad, 'evaluateDeformadorTrack devuelve params');
  const sep = typeof mitad?.separacion === 'number' ? mitad.separacion : NaN;
  revisar(Math.abs(sep - 15) < 1e-6, `separacion interpola 15 (sale ${sep})`);
  revisar(mitad?.carasSel === '0', `carasSel se SOSTIENE como string ('${mitad?.carasSel}')`);
  const m = cubo();
  const s = aplicarDeformador('bisel-plano', m, {
    ...mitad, separacion: sep,
  });
  revisar(s.faces.length === 10, `animación al 50%: marco con separacion 15 (${s.faces.length} caras)`);
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);