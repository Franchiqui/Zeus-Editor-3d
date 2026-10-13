/**
 * Modo Extrusión spline: matemáticas de colocación del objeto extruido a
 * partir de la CAPTURA de una ventana.
 *
 * Flujo: el usuario pulsa «Extrusión spline» en una ventana; el visor
 * captura la vista (PNG + metadatos del plano: centro, ejes pantalla y
 * tamaños en mundo). Esa captura entra como plantilla en el lienzo de
 * Extruir; el usuario calca encima y, al pulsar «Colocar objeto», el
 * trazo se vuelve mundo con estas funciones — tamaño EXACTO al calcado y
 * sitio exacto según la ventana capturada.
 *
 * La malla extraída es canónica: ocupa −1..1 en X e Y (el bbox del
 * contorno) con la tapa frontal en z = 0 mirando a +Z (buildExtrudeMesh).
 * La colocación devuelve un transform con rotación en RADIANES.
 */

import type { ObjectTransform } from '@/lib/geometry';

export interface Vec3L {
  x: number;
  y: number;
  z: number;
}

/** Metadatos que entrega la captura de una ventana (Viewer3D). */
export interface CapturaExtrusionMeta {
  /** Vista de la ventana de origen (informativo). */
  vista: string;
  /** PNG CUADRADO (recuadrado a max(ancho,alto) con bandas vacías). */
  dataURL: string;
  /** Lado del PNG cuadrado, en píxeles. */
  px: number;
  /** Ancho/alto en píxeles del contenido capturado (la vista real). */
  pxW: number;
  pxH: number;
  /** Punto de mundo del CENTRO de la vista (plano perpendicular a la cámara). */
  centro: Vec3L;
  /** Eje pantalla-derecha de la ventana (unitario). */
  right: Vec3L;
  /** Eje pantalla-arriba de la ventana (unitario). */
  up: Vec3L;
  /** Ancho en mundo del contenido capturado (a lo largo de `right`). */
  spanX: number;
  /** Alto en mundo del contenido capturado (a lo largo de `up`). */
  spanY: number;
  /** Rotación (GRADOS, Euler XYZ) para que la malla extraída mire como la
   *  ventana: su eje X local → `right`, su Y → `up`, su tapa (+Z) → a la cámara. */
  rotDeg: [number, number, number];
}

/** Resultado de la colocación (transform del objeto, rotación en RADIANES). */
export interface ColocacionExtrusion extends ObjectTransform {}

/**
 * Convierte un trazo (polígono en unidades de lienzo, 0..1 en reposo) en
 * el transform del objeto colocado: la caja del trazo se mapea a la
 * posición de mundo que ocupa su equivalente DENTRO de la plantilla, y la
 * escala va POR EJE para que la malla canónica (bbox normalizado a
 * −1..1) cubra el mundo dibujado sin deformarlo; la profundidad ya vive
 * de verdad en la malla (0..−depth), así que sz = 1.
 *
 * Las unidades del lienzo del trazo y las de la plantilla comparten
 * espacio (la plantilla se dibuja como caja cuadrada `escala` unidades
 * SVG, 100 = ancho del lienzo, con offset desde el centro): el trazo
 * calcado encima de la plantilla lleva las mismas coordenadas que ella.
 *
 * @param polygon Trazo del usuario (unidades del lienzo).
 * @param meta Metadatos de la captura origen.
 * @param plantilla Escala/offset con los que se muestra la plantilla.
 */
export function mapeaColocacionExtrusion(
  polygon: Array<{ x: number; y: number }>,
  meta: CapturaExtrusionMeta,
  plantilla: { escala: number; offset: { x: number; y: number } } = {
    escala: 1,
    offset: { x: 0, y: 0 },
  }
): ColocacionExtrusion {
  const DEG = Math.PI / 180;
  const base: ColocacionExtrusion = {
    px: 0,
    py: 0,
    pz: 0,
    rx: meta.rotDeg[0] * DEG,
    ry: meta.rotDeg[1] * DEG,
    rz: meta.rotDeg[2] * DEG,
    sx: 1,
    sy: 1,
    sz: 1,
  };
  if (polygon.length < 3 || meta.pxW <= 0 || meta.pxH <= 0) return base;

  const escala = Math.max(0.01, plantilla.escala);
  // Caja de la plantilla en unidades de lienzo: el trazo calcado encima
  // da las mismas fracciones de la imagen que la parte que calca.
  const x0 = 0.5 - escala / 2 + plantilla.offset.x / 100;
  const y0 = 0.5 - escala / 2 + plantilla.offset.y / 100;
  // Fracción de lienzo → fracción del CONTENIDO capturado. La plantilla
  // se dibuja como caja cuadrada (escala) con la imagen entera dentro
  // ('meet': imagen cuadrada = caja completa); el contenido capturado
  // vive en la banda central del PNG recuadrado (alfa + pxW/px de la caja).
  const aFrac = (u: number, eje: 'x' | 'y'): number => {
    const fracImg = (u - (eje === 'x' ? x0 : y0)) / escala;
    const alfa =
      eje === 'x'
        ? { k: meta.pxW / meta.px, a: (meta.px - meta.pxW) / (2 * meta.px) }
        : { k: meta.pxH / meta.px, a: (meta.px - meta.pxH) / (2 * meta.px) };
    return fracImg * alfa.k + alfa.a;
  };
  // Fracción de contenido → mundo: tamaño en mundo del contenido completo.
  const mundo = (fcx: number, fcy: number): Vec3L => ({
    x:
      meta.centro.x +
      (fcx - 0.5) * meta.spanX * meta.right.x +
      (0.5 - fcy) * meta.spanY * meta.up.x,
    y:
      meta.centro.y +
      (fcx - 0.5) * meta.spanX * meta.right.y +
      (0.5 - fcy) * meta.spanY * meta.up.y,
    z:
      meta.centro.z +
      (fcx - 0.5) * meta.spanX * meta.right.z +
      (0.5 - fcy) * meta.spanY * meta.up.z,
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const q of polygon) {
    minX = Math.min(minX, q.x);
    maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y);
    maxY = Math.max(maxY, q.y);
  }
  if (!isFinite(minX)) return base;

  const wX = Math.abs(aFrac(maxX, 'x') - aFrac(minX, 'x')) * meta.spanX;
  const wY = Math.abs(aFrac(maxY, 'y') - aFrac(minY, 'y')) * meta.spanY;
  // ESCALA POR EJE: la malla extraída normaliza el bbox del trazo a
  // −1..1 en AMBOS ejes (aunque el trazo no sea cuadrado), así que su
  // escala debe estirar cada eje a su tamaño de mundo dibujado; la Z no
  // se toca (la profundidad ya vive de verdad en la malla, 0..−depth).
  const sxObj = Math.max(1e-4, wX / 2);
  const syObj = Math.max(1e-4, wY / 2);

  const centroTrazo = mundo(
    aFrac((minX + maxX) / 2, 'x'),
    aFrac((minY + maxY) / 2, 'y')
  );

  return {
    ...base,
    px: centroTrazo.x,
    py: centroTrazo.y,
    pz: centroTrazo.z,
    sx: sxObj,
    sy: syObj,
    sz: 1,
  };
}