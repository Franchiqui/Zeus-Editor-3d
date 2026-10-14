/**
 * Verificación numérica de la GUÍA de los deformadores (slider `guia`).
 * La guía decide DÓNDE empieza/centra la deformación a lo largo del eje:
 * doblar (recto por debajo del guía), enroscar (giro cero EN el guía,
 * simétrico), afilar (constante escalaInicio por debajo), sesgar
 * (desplazamiento cero en el guía, simétrico) y derretir (la caída
 * empieza en el guía; por debajo solo el ensanche del barril).
 *
 * Default 0 = neutro EXACTO (el ancla de siempre: el borde min de la
 * caja) — los .zeus/pistas viejos sin la clave no cambian.
 *
 * Uso: node scripts/verificar-3d/guia-deform-check.mjs
 * (requiere el bundle generado antes por esbuild: deform-bundle.cjs)
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const raiz = path.resolve(import.meta.dirname, '../..');
const { DEFORMADORES_DIRECTOS, aplicarDeformador } = require(
  path.join(raiz, 'scripts/verificar-3d/deform-bundle.cjs')
);

let fallos = 0;
const fallo = (msg) => { console.log(`  ✗ ${msg}`); fallos++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const cerca = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

const CON_GUÍA = ['doblar', 'enroscar', 'afilar', 'sesgar', 'derretir'];

// Columna LARGA: niveles y=0..10 cada 0.5 (¡7.5 existe!), esquinas x/z=±1
// (faces: [] — los 5 deformadores solo tocan vértices).
const columna = (() => {
  const vertices = [];
  for (let y = 0; y <= 10; y += 0.5) {
    vertices.push({ x: -1, y, z: -1 });
    vertices.push({ x: 1, y, z: -1 });
    vertices.push({ x: -1, y, z: 1 });
    vertices.push({ x: 1, y, z: 1 });
  }
  return { vertices, faces: [] };
})();
const m = (ms) => Math.min(...ms);
const M = (ms) => Math.max(...ms);

const defDe = (id) => {
  const def = DEFORMADORES_DIRECTOS.find((d) => d.id === id);
  if (!def) throw new Error(`falta el deformador ${id}`);
  const tiene = def.params.some((p) => p.id === 'guia');
  return { def, tiene };
};

console.log('═══ Neutro: sin guia ≡ guia 0 (5 deformadores) ═══');
{
  const juego = {
    doblar: { angulo: 60, eje: 'y' },
    enroscar: { angulo: 120, eje: 'y' },
    afilar: { escalaInicio: 100, escalaFin: 30, eje: 'y' },
    sesgar: { desplazamiento: 25, eje: 'y' },
    derretir: { caida: 50, ensanche: 30, eje: 'y' },
  };
  for (const id of CON_GUÍA) {
    const { tiene } = defDe(id);
    if (!tiene) { fallo(`${id}: NO lleva el param guia`); continue; }
    const a = aplicarDeformador(id, columna, juego[id]);
    const b = aplicarDeformador(id, columna, { ...juego[id], guia: 0 });
    const igual = a.vertices.every(
      (v, i) =>
        cerca(v.x, b.vertices[i].x) &&
        cerca(v.y, b.vertices[i].y) &&
        cerca(v.z, b.vertices[i].z)
    );
    if (!igual) fallo(`${id}: guia 0 cambiaste el comportamiento histórico`);
    else ok(`${id}: sin guia ≡ guia 0 (default neutro exacto)`);
  }
}

console.log('═══ Doblar con guía 75 (largo 10 → guía en y=7.5) ═══');
{
  // Ángulo 90°, radio automático R = ext/θ = 10/(π/2).
  const th = (90 * Math.PI) / 180;
  const R = 10 / th;
  const s = aplicarDeformador('doblar', columna, { angulo: 90, eje: 'y', guia: 75 });
  // Por íNDICE (la salida conserva el orden de vértices): así se sabe
  // cuál era la esquina original de cada vértice arqueado.
  let bajoQuieto = true;
  let guiaQuieta = true;
  let arribaArqueado = true;
  let radioExacto = true;
  for (let i = 0; i < s.vertices.length; i++) {
    const v = s.vertices[i];
    const o = columna.vertices[i];
    if (o.y <= 7.5) {
      // Debajo: RECTA en su sitio (la base original intacta).
      if (!cerca(v.x, o.x) || !cerca(v.y, o.y) || !cerca(v.z, o.z)) bajoQuieto = false;
    } else {
      // Arco: distancia al centro del arco (e1=x: centro +R, nivel y=7.5)
      // = radial = R − d, con d = x original − centro e1 (0).
      const dCentro = Math.hypot(v.x - R, v.y - 7.5);
      if (!cerca(dCentro, R - o.x, 1e-9)) radioExacto = false;
      if (!(v.y >= 7.5 - 1e-9)) arribaArqueado = false;
    }
  }
  // El guía (sus 4 esquinas): x/z intactos e y intacto (la Cruz no se mueve).
  const filaGuia = s.vertices.filter((v) => cerca(v.y, 7.5));
  for (const o of columna.vertices.filter((v) => cerca(v.y, 7.5))) {
    const t = filaGuia.find((v) => cerca(v.x, o.x, 1e-9) && cerca(v.z, o.z, 1e-9));
    if (!t || !cerca(t.y, o.y, 1e-9)) { guiaQuieta = false; break; }
  }
  if (!bajoQuieto) fallo('doblar: la parte DEBAJO del guía se movió (debe quedar recta y en su sitio)');
  else ok('doblar: abajo del guía la pieza queda RECTA y sin mover');
  if (!guiaQuieta) fallo('doblar: la cruz del guía se movió');
  else ok('doblar: la sección del guía queda clavada (pivote)');
  if (!radioExacto) fallo('doblar: el arco de arriba no ronda el radio R');
  else ok('doblar: la parte de arriba es un ARCO de radio constante');
  // Y con guia 0 (regresión): idéntico a sin guia.
  const cero = aplicarDeformador('doblar', columna, { angulo: 90, eje: 'y', guia: 0 });
  const sin = aplicarDeformador('doblar', columna, { angulo: 90, eje: 'y' });
  const igual = cero.vertices.every(
    (v, i) => cerca(v.x, sin.vertices[i].x) && cerca(v.y, sin.vertices[i].y) && cerca(v.z, sin.vertices[i].z)
  );
  if (!igual) fallo('doblar: guia 0 ≠ comportamiento clásico de arco');
  else ok('doblar: guia 0 = arco clásico desde la base (regresión)');
}

console.log('═══ Enroscar con guía 75 (giro CERO en el guía, simétrico) ═══');
{
  const s = aplicarDeformador('enroscar', columna, { angulo: 90, eje: 'y', guia: 75 });
  // Por índice: la esquina (x=1, z=-1) de cada nivel y=n (0.5 de paso,
  // 4 esquinas por nivel, orden [-1,1,-1]... el índice (n/0.5)*4+1).
  const idxEsquina = (n) => Math.round(n / 0.5) * 4 + 1;
  const angulo = (n) => {
    const o = columna.vertices[idxEsquina(n)];
    const v = s.vertices[idxEsquina(n)];
    return Math.atan2(v.z, v.x) - Math.atan2(o.z, o.x);
  };
  const guia = angulo(7.5);
  const base = angulo(0);
  const cima = angulo(10);
  if (!cerca(guia, 0, 1e-9)) fallo(`enroscar: giro EN el guía ≠ 0 (${guia})`);
  else ok('enroscar: giro CERO en la sección del guía');
  if (!cerca(-base / cima, 3, 1e-6) || base * cima >= 0)
    fallo(`enroscar: giro simétrico mal (base ${base}, cima ${cima})`);
  else
    ok('enroscar: gira hacia los DOS lados del guía (base −75%, cima 25% del total)');
  // Total del giro conservado: cima − base = θ (90°).
  if (!cerca(cima - base, (90 * Math.PI) / 180, 1e-6))
    fallo(`enroscar: el giro TOTAL cambió (${((cima - base) * 180) / Math.PI}°)`);
  else ok('enroscar: el giro total (90°) se conserva entero');
}

console.log('═══ Afilar con guía 75 (constante abajo, perfil arriba) ═══');
{
  const s = aplicarDeformador('afilar', columna, {
    escalaInicio: 100, escalaFin: 30, eje: 'y', guia: 75,
  });
  const ancho = (nivel) => {
    const salidas = s.vertices.filter((v) => cerca(v.y, nivel));
    return M(salidas.map((v) => v.x)) - m(salidas.map((v) => v.x));
  };
  if (!cerca(ancho(0), 2, 1e-9) || !cerca(ancho(5), 2, 1e-9) || !cerca(ancho(7.5), 2, 1e-9))
    fallo(`afilar: por debajo del guía NO constante (${ancho(0)}, ${ancho(5)}, ${ancho(7.5)})`);
  else ok('afilar: bajo el guía el ancho queda CONSTANTE a escalaInicio (100%)');
  const arriba = ancho(10);
  // t = (10 − 7.5)/10 = 0.25 → f = 1 + (0.3 − 1)·0.25 = 0.825 → ancho 1.65.
  if (!cerca(arriba, 2 * 0.825, 1e-9))
    fallo(`afilar: arriba ${arriba.toFixed(4)} ≠ 1.65 (perfil desde el guía)`);
  else ok('afilar: el perfil arranca EN el guía y llega a escalaFin a un largo de caja');
}

console.log('═══ Sesgar con guía 75 (cero en el guía, simétrico) ═══');
{
  const s = aplicarDeformador('sesgar', columna, { desplazamiento: 20, eje: 'y', guia: 75 });
  // Desplaza el eje e1 (x): desplaz = Δx de la esquina (1,−1) del nivel.
  const desplaz = (n) => {
    const idx = Math.round(n / 0.5) * 4 + 1;
    return s.vertices[idx].x - 1;
  };
  const guia = desplaz(7.5);
  if (!cerca(guia, 0, 1e-9)) fallo(`sesgar: desplazamiento EN el guía ≠ 0 (${guia})`);
  else ok('sesgar: desplazamiento CERO en la sección del guía');
  const abajo = desplaz(0);
  const arriba = desplaz(10);
  if (!cerca(-abajo / arriba, 3, 1e-6) || abajo * arriba >= 0)
    fallo(`sesgar: no simétrico a los dos lados (${abajo}, ${arriba})`);
  else ok('sesgar: sesga simétrico a los dos lados del guía');

  // Guía en OTRO eje (x) también manda: desplaza el transversal e1=y.
  const sx = aplicarDeformador('sesgar', columna, { desplazamiento: 40, eje: 'x', guia: 50 });
  const desplA = sx.vertices[0].y - 0;       // vértice 0: (x=−1,y,z=−1) → t = −0.5
  const desplB = sx.vertices[1].y - 0;       // vértice 1: (x=1,y,z=−1) → t = +0.5
  if (!cerca(-desplA / desplB, 1, 1e-6) || desplA * desplB >= 0)
    fallo(`sesgar eje x: desplaz no simétrico alrededor del guía (${desplA}, ${desplB})`);
  else ok('sesgar: funciona en cualquier eje (x: guía 50 = centro, ±simétrico)');
}

console.log('═══ Derretir con guía 75 (cuelga DESDE el guía) ═══');
{
  const s = aplicarDeformador('derretir', columna, { caida: 60, ensanche: 0, eje: 'y', guia: 75 });
  const yDe = (n) => {
    // índice de la esquina (x=-1, z=-1) del nivel y=n (4 por nivel).
    const idx = Math.round(n / 0.5) * 4 + 0;
    return s.vertices[idx].y;
  };
  const bajoQuieto = [0, 2, 5, 7.5].every((n) => cerca(yDe(n), n, 1e-9));
  if (!bajoQuieto) fallo('derretir: por debajo del guía la caída NO es cero (se movió)');
  else ok('derretir: bajo el guía SIN caída (queda pegado)');
  const y10 = yDe(10);
  const caidaAbs = 0.6 * 10;
  const esperado = 10 - caidaAbs * (0.25 * 0.25);
  if (!cerca(y10, esperado, 1e-9))
    fallo(`derretir: caída arriba ${y10.toFixed(4)} ≠ ${esperado.toFixed(4)} (t² desde el guía)`);
  else ok('derretir: encima cuelga con caída t² a partir del guía');
}

console.log('\n' + (fallos === 0 ? '✔ Todos los checks en verde' : `✗ ${fallos} checks en rojo`));
process.exit(fallos === 0 ? 0 : 1);