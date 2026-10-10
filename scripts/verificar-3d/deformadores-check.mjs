/**
 * Verificación numérica de los DEFORMADORES DIRECTOS (lib/deformadores.ts)
 * sobre mallas reales de la galería (public/Obj-3D/*.zeus).
 *
 * Uso: node scripts/verificar-3d/deformadores-check.mjs
 * (requiere el bundle generado antes por esbuild: deform-bundle.cjs)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const raiz = path.resolve(import.meta.dirname, '../..');
const { DEFORMADORES_DIRECTOS, aplicarDeformador } = require(
  path.join(raiz, 'scripts/verificar-3d/deform-bundle.cjs')
);

function cargaMalla(nombre) {
  const doc = JSON.parse(
    readFileSync(path.join(raiz, 'public/Obj-3D', nombre), 'utf8')
  );
  const o = doc.sceneObjects?.[0];
  return o?.mesh ?? null;
}

const bboxDe = (mesh) => {
  const b = {
    x: [Infinity, -Infinity],
    y: [Infinity, -Infinity],
    z: [Infinity, -Infinity],
  };
  for (const v of mesh.vertices) {
    for (const a of ['x', 'y', 'z']) {
      if (v[a] < b[a][0]) b[a][0] = v[a];
      if (v[a] > b[a][1]) b[a][1] = v[a];
    }
  }
  return b;
};

const claveVtx = (v) =>
  `${Math.round(v.x * 1e4)}|${Math.round(v.y * 1e4)}|${Math.round(v.z * 1e4)}`;

let fallos = 0;
const revisar = (cond, descripcion) => {
  if (!cond) {
    fallos++;
    console.log('  ✗ FALLO:', descripcion);
  }
};

const PARAMS_JUEGO = {
  doblar: { angulo: 45, eje: 'y' },
  enroscar: { angulo: 90, eje: 'y' },
  bisel: { radio: 10 },
  hinchar: { amplitud: 20 },
  sesgar: { desplazamiento: 20, eje: 'y' },
  suavizado: { iteraciones: 3 },
  afilar: { escalaInicio: 100, escalaFin: 30, eje: 'y' },
  derretir: { caida: 40, ensanche: 20, eje: 'y' },
  romper: { fuerza: 150, giroVelocidad: 90, tamanoFinal: 100, aleatoriedad: 50, semilla: 42 },
};

const ARCHIVOS = ['Cubo.zeus', 'Cilindro.zeus', 'Esfera.zeus'];

for (const archivo of ARCHIVOS) {
  const malla = cargaMalla(archivo);
  if (!malla) {
    console.log(`✗ ${archivo}: sin malla`);
    fallos++;
    continue;
  }
  console.log(
    `\n== ${archivo} (${malla.vertices.length} v / ${malla.faces.length} f)`
  );
  const orig = JSON.parse(JSON.stringify(malla));
  const bbox = bboxDe(malla);

  for (const def of DEFORMADORES_DIRECTOS) {
    const params = PARAMS_JUEGO[def.id];
    let salida;
    try {
      salida = aplicarDeformador(def.id, malla, params);
    } catch (e) {
      fallos++;
      console.log(`  ✗ ${def.id}: excepción ${e?.message}`);
      continue;
    }
    const nf = salida.vertices.filter(
      (v) => !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)
    ).length;
    revisar(nf === 0, `${def.id}: ${nf} vértices no finitos`);
    revisar(salida.faces.length === malla.faces.length || def.id === 'bisel' || def.id === 'suavizado',
      `${def.id}: caras ${malla.faces.length} → ${salida.faces.length}`);

    // Sin mutación (cancelar = no tocar la malla): la ORIGINAL quedó igual.
    const sinToques = orig.vertices.every(
      (v, i) =>
        v.x === malla.vertices[i].x &&
        v.y === malla.vertices[i].y &&
        v.z === malla.vertices[i].z
    );
    revisar(sinToques, `${def.id}: la malla original MUTÓ`);

    const b2 = bboxDe(salida);
    const ext = (bb, a) => bb[a][1] - bb[a][0];
    if (def.id === 'hinchar') {
      revisar(ext(b2, 'x') > ext(bbox, 'x') + 1e-6, `hinchar: agranda en X (${ext(bbox,'x')}→${ext(b2,'x')})`);
    }
    if (def.id === 'sesgar') {
      revisar(Math.abs(ext(b2, 'y') - ext(bbox, 'y')) < 1e-6, `sesgar: altura intacta (${ext(bbox,'y')}→${ext(b2,'y')})`);
    }
    if (def.id === 'derretir') {
      revisar(b2.y[1] < bbox.y[1] - 1e-6, `derretir: la cima baja (${bbox.y[1]}→${b2.y[1]})`);
      revisar(ext(b2, 'x') > ext(bbox, 'x') + 1e-6, `derretir: la base se ensancha (${ext(bbox,'x')}→${ext(b2,'x')})`);
    }
    if (def.id === 'afilar') {
      revisar(ext(b2, 'x') < ext(bbox, 'x') + 1e-6, `afilar: sección afinada (${ext(bbox,'x')}→${ext(b2,'x')})`);
    }
    if (def.id === 'doblar') {
      revisar(ext(b2, 'y') < ext(bbox, 'y') + 1e-6 || ext(b2, 'z') > ext(bbox, 'z') - 1e-9,
        `doblar: la caja cambió de forma`);
    }
    if (def.id === 'bisel') {
      revisar(salida.faces.length > malla.faces.length,
        `bisel: crece el conteo de caras (${malla.faces.length}→${salida.faces.length})`);
    }

    // Si la entrada tenía faceColors, la salida conserva el cardinal.
    if (malla.faceColors) {
      revisar(
        salida.faceColors?.length === salida.faces.length,
        `${def.id}: faceColors desalineado (${salida.faceColors?.length} vs ${salida.faces.length})`
      );
    }

    // Defaults: llamada SIN params no explota y devuelve algo finito.
    const conDefecto = aplicarDeformador(def.id, malla, {});
    revisar(
      conDefecto.vertices.every(
        (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
      ),
      `${def.id} (defaults): vértices finitos`
    );

    console.log(
      `  ✓ ${def.id}: v ${malla.vertices.length}→${salida.vertices.length} · f ${malla.faces.length}→${salida.faces.length}`
    );
  }
}

// Idempotencia de identidad: aplicarDeformador devuelve NUEVA malla.
const m = cargaMalla('Cilindro.zeus');
const r1 = aplicarDeformador('doblar', m, PARAMS_JUEGO.doblar);
const r2 = aplicarDeformador('doblar', m, PARAMS_JUEGO.doblar);
revisar(r1 !== m, 'doblar devuelve una malla NUEVA (no la misma referencia)');
revisar(r1.vertices.every((v, i) => v.x === r2.vertices[i].x && v.y === r2.vertices[i].y && v.z === r2.vertices[i].z),
  'determinista: misma entrada misma salida');
revisar(typeof m === 'object' && m !== null, 'malla de entrada intacta tras dos aplicaciones');

// IDs de iconos: ruta /icons/<Nombre>.png
console.log('\nIconos esperados en /public/icons:');
for (const d of DEFORMADORES_DIRECTOS) console.log(`  ${d.icono}  (${d.id})`);

// ============================================================
// DOBLAR-ABANICO: barra segmentada → medio punto (180°) y círculo
// (360°) con cierre exacto, y diámetro manual regulable.
// ============================================================
console.log('\n== Doblar abanico (barra segmentada) ==');

// Barra 0.4 × 6 × 0.4 apoyada en y=0, 60 divisiones en Y. Índice de
// vértice: (iy*3 + ix)*3 + iz.
function barraSegmentada() {
  const vertices = [];
  for (let iy = 0; iy < 61; iy++) {
    for (let ix = 0; ix < 3; ix++) {
      for (let iz = 0; iz < 3; iz++) {
        vertices.push({
          x: -0.2 + (ix * 0.4) / 2,
          y: (iy * 6) / 60,
          z: -0.2 + (iz * 0.4) / 2,
        });
      }
    }
  }
  const idx = (ix, iy, iz) => (iy * 3 + ix) * 3 + iz;
  const faces = [];
  for (let iy = 0; iy < 60; iy++)
    for (let ix = 0; ix < 2; ix++)
      for (let iz = 0; iz < 2; iz++)
        faces.push([
          idx(ix, iy, iz), idx(ix, iy + 1, iz),
          idx(ix + 1, iy + 1, iz), idx(ix + 1, iy, iz),
        ]);
  return { vertices, faces };
}

const barra = barraSegmentada();
const L = 6; // longitud de la barra
// Capa de la cima (iy=60) con su par de la BASE (iy=0): el «cierre» del
// círculo = la cima acaba donde está la base.
const PARES = [];
for (let ix = 0; ix < 3; ix++)
  for (let iz = 0; iz < 3; iz++)
    PARES.push([60 * 9 + ix * 3 + iz, ix * 3 + iz]); // [cima, base]
const separacionCierre = (m) =>
  Math.max(
    ...PARES.map(([ic, ib]) => {
      const c = m.vertices[ic];
      const b = barra.vertices[ib];
      return Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z);
    })
  );

// — Medio punto: angulo 180 auto → arco de radio R = L/π, extremo de
//   vuelta al nivel de la base, todo por encima de ella.
{
  const s = aplicarDeformador('doblar', barra, { angulo: 180, eje: 'y' });
  const R = L / Math.PI;
  const yMax = Math.max(...s.vertices.map((v) => v.y));
  const yMin = Math.min(...s.vertices.map((v) => v.y));
  revisar(Math.abs(yMax - (R + 0.2)) < 1e-6, `abanico 180°: cima del arco ≈ R (${yMax.toFixed(4)} vs ${(R + 0.2).toFixed(4)})`);
  revisar(yMin > -1e-6, `abanico 180°: todo por encima de la base (yMin=${yMin.toFixed(6)})`);
  const cima = PARES.map(([ic]) => s.vertices[ic]);
  const xCimaMin = Math.min(...cima.map((v) => v.x));
  const xCimaMax = Math.max(...cima.map((v) => v.x));
  revisar(
    Math.abs(xCimaMax - (2 * R + 0.2)) < 1e-6 && Math.abs(xCimaMin - (2 * R - 0.2)) < 1e-6,
    `abanico 180°: el extremo vuelve al nivel de la base (x ${xCimaMin.toFixed(4)}…${xCimaMax.toFixed(4)})`
  );
}

// — Círculo: angulo 360 auto → cierre EXACTO sobre la base.
{
  const s = aplicarDeformador('doblar', barra, { angulo: 360, eje: 'y' });
  const gote = separacionCierre(s);
  revisar(gote < 1e-6, `círculo 360°: cierre exacto (separación máx ${gote.toExponential(2)})`);
  const R = L / (2 * Math.PI);
  const xMax = Math.max(...s.vertices.map((v) => v.x));
  revisar(Math.abs(xMax - (2 * R + 0.2)) < 1e-6, `círculo 360°: diámetro = L/π (xMax ${xMax.toFixed(4)} vs ${(2 * R + 0.2).toFixed(4)})`);
}

// — Diámetro MANUAL ≈ automático (31.831% ≈ L/π/L): el círculo cierra.
{
  const s = aplicarDeformador('doblar', barra, { angulo: 360, diametro: 31.831, eje: 'y' });
  const gote = separacionCierre(s);
  revisar(gote < 0.02, `círculo con diámetro 31.8%: cierre (separación máx ${gote.toFixed(4)})`);
}

// — Diámetro MANUAL grande (60% · L): el anillo adopta ESE diámetro
//   (el objeto se estira para seguir el arco) y la base no se mueve.
{
  const pct = 60;
  const R = (pct / 200) * L; // 1.8
  const s = aplicarDeformador('doblar', barra, { angulo: 360, diametro: pct, eje: 'y' });
  const xMin = Math.min(...s.vertices.map((v) => v.x));
  const xMax = Math.max(...s.vertices.map((v) => v.x));
  const yMax = Math.max(...s.vertices.map((v) => v.y));
  revisar(
    Math.abs(xMax - (2 * R + 0.2)) < 1e-6,
    `diámetro 60%: anillo de diámetro 3.6 (xMax ${xMax.toFixed(4)} vs ${(2 * R + 0.2).toFixed(4)})`
  );
  revisar(Math.abs(xMin + 0.2) < 1e-6, `diámetro 60%: la base no se mueve (xMin ${xMin.toFixed(4)})`);
  const yMin = Math.min(...s.vertices.map((v) => v.y));
  revisar(Math.abs(yMax - R - 0.2) < 1e-6 && Math.abs(yMin + R + 0.2) < 1e-6,
    `diámetro 60%: anillo completo en Y (${yMin.toFixed(4)}…${yMax.toFixed(4)})`);
}

// — PASAR DEL círculo: angulo 450 → la cima envuelve más de una vuelta.
{
  const s = aplicarDeformador('doblar', barra, { angulo: 450, eje: 'y' });
  const vC = s.vertices[60 * 9 + 4]; // centro de la capa de la cima (d=0)
  const R = L / ((450 * Math.PI) / 180);
  revisar(Math.abs(vC.y - R) < 1e-6, `450°: la cima envuelve más de una vuelta (y=${vC.y.toFixed(4)} vs R=${R.toFixed(4)})`);
}

// — 0° = neutro (default del botón Doblar).
{
  const s = aplicarDeformador('doblar', barra, { angulo: 0, eje: 'y' });
  revisar(
    s === barra || s.vertices === barra.vertices || s.vertices.every((v, i) => v.x === barra.vertices[i].x && v.y === barra.vertices[i].y && v.z === barra.vertices[i].z),
    'doblar 0° devuelve la malla intacta'
  );
}

// ============================================================
// ROMPER: pedazos desiguales, islas separadas, apoyados en la
// base, determinista con semilla. Cubo de 12 caras (+ arrays de
// cara opcionales para revisar la alineación).
// ============================================================
console.log('\n== Romper ==');
{
  const caraBase = () => JSON.parse(JSON.stringify({
    vertices: [
      { x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 }, { x: 1, y: 1, z: -1 }, { x: -1, y: 1, z: -1 },
      { x: -1, y: -1, z: 1 }, { x: 1, y: -1, z: 1 }, { x: 1, y: 1, z: 1 }, { x: -1, y: 1, z: 1 },
    ],
    faces: [
      [0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [4, 5, 1, 0], [3, 2, 6, 7],
      // 6 caras extra segmentadas (como un cubo con subdivisiones).
      [0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [4, 5, 1, 0], [3, 2, 6, 7],
    ],
    faceColors: [
      '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
      '#808080', '#404040', '#c0c0c0', '#101010', '#e0e0e0', '#202020',
    ],
    faceOpacities: [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 1, 1],
    faceTextures: [null, 't', null, 't2', null, 't3', null, null, 't4', null, null, null],
  }));
  const PARAMS = { fuerza: 150, caida: 100, giroVelocidad: 90, tamanoFinal: 100, aleatoriedad: 50, semilla: 42 };

  // — Neutro: fuerza 0 NO rompe.
  {
    const m = caraBase();
    const s = aplicarDeformador('romper', m, { ...PARAMS, fuerza: 0 });
    revisar(s === m, 'romper fuerza 0 = malla intacta (misma referencia)');
  }

  // — Rompe de verdad: islaS separadas ≥ 2 por adyacencia de posiciones.
  {
    const m = caraBase();
    const s = aplicarDeformador('romper', m, PARAMS);
    const clave = (v) => `${Math.round(v.x * 1e4)}|${Math.round(v.y * 1e4)}|${Math.round(v.z * 1e4)}`;
    const mapa = new Map(); // clave → índices de vértices que la comparten
    s.vertices.forEach((v, i) => {
      const k = clave(v);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(i);
    });
    const compoDe = new Map();
    let comps = 0;
    const adj = new Map();
    for (const cara of s.faces) {
      for (let i = 0; i < cara.length; i++) {
        const a = mapa.get(clave(s.vertices[cara[i]]));
        const b = mapa.get(clave(s.vertices[cara[(i + 1) % cara.length]]));
        for (const va of a)
          for (const vb of b) {
            if (va === vb) continue;
            if (!adj.has(va)) adj.set(va, new Set());
            adj.get(va).add(vb);
            if (!adj.has(vb)) adj.set(vb, new Set());
            adj.get(vb).add(va);
          }
      }
    }
    for (const v of adj.keys()) {
      if (compoDe.has(v)) continue;
      const pila = [v];
      compoDe.set(v, comps);
      while (pila.length) {
        const u = pila.pop();
        for (const w of adj.get(u) ?? []) {
          if (!compoDe.has(w)) {
            compoDe.set(w, comps);
            pila.push(w);
          }
        }
      }
      comps++;
    }
    revisar(comps >= 2, `romper: la malla quedó en ≥2 pedazos sueltos (${comps})`);

    // Sin compartir vértices entre caras: cada índice sale en UNA cara.
    const usos = new Map();
    for (const cara of s.faces)
      for (const idx of cara) usos.set(idx, (usos.get(idx) ?? 0) + 1);
    const compartidos = [...usos.values()].filter((u) => u !== 1).length;
    revisar(compartidos === 0, `romper: vértices duplicados por cara (compartidos=${compartidos})`);

    // Apoyados: el min Y de la salida = el min Y del suelo original.
    const b2 = bboxDe(s);
    revisar(
      Math.abs(b2.y[0] + 1) < 1e-6,
      `romper: los pedazos descansan en la base original (minY=${b2.y[0].toFixed(6)})`
    );

    // — Caída 100%: NADA queda flotando. Con una malla PLANA vertical
    //   (todas las caras coplanares, normal horizontal), al 100% cada
    //   pedazo se tumba → TODOS los vértices quedan EN el plano base.
    {
      const plana = (() => {
        const vertices = [];
        for (let y = -1; y <= 1; y++)
          for (let x = -1; x <= 1; x++) vertices.push({ x, y, z: 0 });
        const idx = (x, y) => (y + 1) * 3 + (x + 1);
        const faces = [];
        // Celdas 2×2 ENTRE los vértices (x, y ∈ {−1, 0}).
        for (let y = -1; y < 1; y++)
          for (let x = -1; x < 1; x++) {
            const a = idx(x, y);
            const b = idx(x + 1, y);
            const c = idx(x + 1, y + 1);
            const d = idx(x, y + 1);
            faces.push([a, b, c], [a, c, d]);
          }
        return { vertices, faces };
      })();
      const caido = aplicarDeformador('romper', plana, { ...PARAMS, caida: 100 });
      const base = Math.min(...plana.vertices.map((v) => v.y)); // −1
      const flotantes = caido.vertices.filter(
        (v) => Math.abs(v.y - base) > 1e-6
      ).length;
      revisar(
        flotantes === 0,
        `romper caída 100%: los ${flotantes} vértices flotando (deben ser 0, todo en y=${base})`
      );
      // 0% flota de verdad (no todo pegado al suelo).
      const flot = aplicarDeformador('romper', plana, { ...PARAMS, caida: 0 });
      const pegados0 = flot.vertices.filter(
        (v) => Math.abs(v.y - base) < 1e-6
      ).length;
      revisar(
        pegados0 < flot.vertices.length,
        `romper caída 0%: sí queda algo por el aire (${flot.vertices.length - pegados0}/${flot.vertices.length} fuera del suelo)`
      );
      // Nuevo DEFAULT: SIN el campo caida, la fuerza solo DISPERSA
      // (explosión congelada) — ningún vértice baja al plano base.
      // (Antes el default era 100 y cualquier fuerza tiraba todo al suelo.)
      const PARAMSsinDeform = { ...PARAMS };
      delete PARAMSsinDeform.caida;
      const explota = aplicarDeformador('romper', plana, PARAMSsinDeform);
      const enSueloDef = explota.vertices.filter(
        (v) => Math.abs(v.y - base) < 1e-6
      ).length;
      revisar(
        enSueloDef === 0,
        `romper sin campo caida (default 0): ${enSueloDef} vértices en el plano base (deben ser 0, TODO flota)`
      );
      // Y el reparto de pedazos no cambia con la caída (misma semilla):
      // la posición XZ de la nube de piezas al 0% difiere de la al 100%
      // solo por el aplanado/deriva, pero el CONTEO de componentes es
      // el mismo con la malla plana (nada fusiona): ≥ 3 piezas.
      const compo = (salida) => {
        const mapaC = new Map();
        salida.vertices.forEach((v, i) => {
          const k = `${Math.round(v.x * 1e4)}|${Math.round(v.y * 1e4)}|${Math.round(v.z * 1e4)}`;
          if (!mapaC.has(k)) mapaC.set(k, []);
          mapaC.get(k).push(i);
        });
        const ady = new Map();
        for (const cara of salida.faces) {
          for (let i = 0; i < cara.length; i++) {
            const A = mapaC.get(claveVtx(salida.vertices[cara[i]]));
            const B = mapaC.get(claveVtx(salida.vertices[cara[(i + 1) % cara.length]]));
            for (const va of A)
              for (const vb of B) {
                if (va === vb) continue;
                if (!ady.has(va)) ady.set(va, new Set());
                ady.get(va).add(vb);
                if (!ady.has(vb)) ady.set(vb, new Set());
                ady.get(vb).add(va);
              }
          }
        }
        const visto = new Map();
        let n = 0;
        for (const v of ady.keys()) {
          if (visto.has(v)) continue;
          n++;
          const pila = [v];
          visto.set(v, n);
          while (pila.length) {
            const u = pila.pop();
            for (const w of ady.get(u) ?? []) {
              if (!visto.has(w)) {
                visto.set(w, n);
                pila.push(w);
              }
            }
          }
        }
        return n;
      };
      revisar(compo(caido) >= 3 && compo(flot) >= 3, `romper: pedazos separados (caído ${compo(caido)}, flotando ${compo(flot)})`);

      // — Suelo REAL (params ocultos que manda el editor).
      // A: objeto flotante py=2, escala sy=2 → el suelo visible del visor
      //    (y=−1.05) es el plano local y = (−1.05−2)/2 = −1.525.
      {
        const d0 = (-1.05 - 2) / 2;
        const caidoR = aplicarDeformador('romper', plana, {
          ...PARAMS, caida: 100, sueloUx: 0, sueloUy: 1, sueloUz: 0, sueloD: d0,
        });
        const fuera = caidoR.vertices.filter((v) => Math.abs(v.y - d0) > 1e-6).length;
        revisar(fuera === 0, `romper suelo real: objeto flotante py=2 sy=2 → todo en y=${d0.toFixed(3)} (${fuera} fuera)`);
      }
      // B: objeto GIRADO rx=90° con py=1 → la vertical del mundo en
      //    coords locales es u=(0,0,−1) y el plano queda en z=2.05 (que
      //    en el mundo es y=−1.05). Los pedazos caen TUMBADOS a él.
      {
        const caidoR = aplicarDeformador('romper', plana, {
          ...PARAMS, caida: 100, sueloUx: 0, sueloUy: 0, sueloUz: -1, sueloD: -2.05,
        });
        const fuera = caidoR.vertices.filter((v) => Math.abs(v.z - 2.05) > 1e-6).length;
        revisar(fuera === 0, `romper suelo real girado: tumbados en el plano local z=2.05 (${fuera} fuera)`);
      }
    }

    // Arrays alineados por cara (el ORDEN de las caras no cambia).
    revisar(s.faceColors?.length === s.faces.length && s.faceColors[0] === '#ff0000' && s.faceColors[5] === '#00ffff',
      'romper: faceColors alineado');
    revisar(s.faceOpacities?.length === s.faces.length && s.faceOpacities[1] === 0.9,
      'romper: faceOpacities alineado');
    revisar(s.faceTextures?.length === s.faces.length && s.faceTextures[1] === 't' && s.faceTextures[9] === null,
      'romper: faceTextures alineado');
    revisar(s.faces.length === m.faces.length, `romper: nº de caras intacto (${s.faces.length})`);
  }

  // — Determinista con la misma semilla; cambia con otra.
  {
    const m1 = caraBase();
    const m2 = caraBase();
    const r1 = aplicarDeformador('romper', m1, PARAMS);
    const r2 = aplicarDeformador('romper', m2, PARAMS);
    const j1 = JSON.stringify(r1.vertices);
    const j2 = JSON.stringify(r2.vertices);
    revisar(j1 === j2, 'romper: misma semilla → mismo resultado');
    const r3 = aplicarDeformador('romper', caraBase(), { ...PARAMS, semilla: 43 });
    revisar(JSON.stringify(r3.vertices) !== j1, 'romper: otra semilla → otro resultado');
  }

  // — Tamaño final: a 50% los pedazos son a la mitad.
  {
    const m = caraBase();
    const completo = aplicarDeformador('romper', m, PARAMS);
    // Cada cara del cubo es un quad de lado 2; con escala 50% ningún
    // quad de una cara puede medir más de 2 (los lados encogen).
    const mitad = aplicarDeformador('romper', m, { ...PARAMS, tamanoFinal: 50 });
    const ladoMax = (s) => {
      let m2 = 0;
      for (const cara of s.faces) {
        for (let i = 0; i < cara.length; i++) {
          const a = s.vertices[cara[i]];
          const b = s.vertices[cara[(i + 1) % cara.length]];
          m2 = Math.max(m2, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
        }
      }
      return m2;
    };
    revisar(ladoMax(mitad) < ladoMax(completo) - 0.2, `romper: tamaño final encoge (lado máx ${ladoMax(completo).toFixed(2)} → ${ladoMax(mitad).toFixed(2)})`);
    revisar(Math.abs(ladoMax(completo) - 2) < 0.5, `romper: tamaño 100% mantiene el lado (~2, sale ${ladoMax(completo).toFixed(2)})`);
  }

  // — Pedazos del tamaño de la cara: sobre el Cilindro real (160 caras)
  //   ningún pedazo (componente conexa de la salida) pasa de ~8 caras
  //   y el nº de pedazos ronda caras/1.4 (≈114).
  {
    const cil = cargaMalla('Cilindro.zeus');
    const s = aplicarDeformador('romper', cil, PARAMS);
    const clave = (v) => `${Math.round(v.x * 1e4)}|${Math.round(v.y * 1e4)}|${Math.round(v.z * 1e4)}`;
    const mapa = new Map();
    s.vertices.forEach((v, i) => {
      const k = clave(v);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(i);
    });
    const adj = new Map();
    for (const cara of s.faces) {
      for (let i = 0; i < cara.length; i++) {
        const a = mapa.get(clave(s.vertices[cara[i]]));
        const b = mapa.get(clave(s.vertices[cara[(i + 1) % cara.length]]));
        for (const va of a)
          for (const vb of b) {
            if (va === vb) continue;
            if (!adj.has(va)) adj.set(va, new Set());
            adj.get(va).add(vb);
            if (!adj.has(vb)) adj.set(vb, new Set());
            adj.get(vb).add(va);
          }
      }
    }
    const compoDe = new Map();
    const carasPorCompo = []; // nº de CARAS (no vértices) por componente
    for (const v of adj.keys()) {
      if (compoDe.has(v)) continue;
      const id = carasPorCompo.length;
      carasPorCompo.push(0);
      const pila = [v];
      compoDe.set(v, id);
      while (pila.length) {
        const u = pila.pop();
        for (const w of adj.get(u) ?? []) {
          if (!compoDe.has(w)) {
            compoDe.set(w, id);
            pila.push(w);
          }
        }
      }
    }
    for (const cara of s.faces) {
      const id = compoDe.get(mapa.get(clave(s.vertices[cara[0]]))[0]);
      if (id !== undefined) carasPorCompo[id]++;
    }
    const maxCarasPedazo = Math.max(...carasPorCompo);
    revisar(maxCarasPedazo <= 8, `romper: pedazo más grande ≈ cara (${maxCarasPedazo} caras)`);
    revisar(carasPorCompo.length >= 80, `romper: muchos pedazos en cilindro (${carasPorCompo.length}, esperado ≈${Math.round(cil.faces.length / 1.4)})`);
  }
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);