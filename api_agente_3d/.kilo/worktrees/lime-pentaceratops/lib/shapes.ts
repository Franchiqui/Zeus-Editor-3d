import type { Polygon, Point2D } from './geometry';

/**
 * Formas geométricas listas para insertar en una vista con un clic.
 * Todas en coordenadas de lienzo 0..1 (y hacia abajo), recorridas en el
 * mismo sentido que las plantillas por defecto (horario en pantalla).
 */

/** Constante kappa: con asas de longitud kappa·r un círculo de 4 vértices
 *  Bézier coincide con la circunferencia exacta. */
const KAPPA = 0.5522847498310778;

/** Grados a radianes */
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Punto de un polígono regular centrado en (0.5, 0.5) */
const pt = (angleDeg: number, r: number): Point2D => ({
  x: 0.5 + r * Math.cos(rad(angleDeg)),
  // El lienzo tiene y hacia abajo: seno negativo = hacia arriba en pantalla
  y: 0.5 - r * Math.sin(rad(angleDeg)),
});

/**
 * Circunferencia exacta: 4 vértices en los puntos cardinales con las dos
 * asas tangentes de longitud kappa·r. En el editor se ve un círculo
 * perfecto y el objeto 3D sale redondo (las curvas se muestrean tal cual).
 */
export function circleShape(r = 0.4): Polygon {
  const n = 32;
  const cx = 0.5;
  const cy = 0.5;
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    };
  });
}

/** Cuadrado */
export function squareShape(half = 0.4): Polygon {
  const l = 0.5 - half;
  const h = 0.5 + half;
  return [
    { x: l, y: l },
    { x: h, y: l },
    { x: h, y: h },
    { x: l, y: h },
  ];
}

/** Triángulo equilátero con el vértice arriba */
export function triangleShape(r = 0.45): Polygon {
  return [
    pt(90, r),
    pt(-30, r),
    pt(210, r),
  ];
}

/** Hexágono regular con vértices arriba y abajo */
export function hexagonShape(r = 0.42): Polygon {
  return [90, 30, -30, -90, -150, 150].map((a) => pt(a, r));
}

/** Estrella de 5 puntas con una punta arriba */
export function starShape(outer = 0.42, inner = 0.17): Polygon {
  const out: Polygon = [];
  for (let i = 0; i < 10; i++) {
    out.push(pt(90 - i * 36, i % 2 === 0 ? outer : inner));
  }
  return out;
}

export interface ShapePreset {
  id: 'circulo' | 'cuadrado' | 'triangulo' | 'hexagono' | 'estrella';
  name: string;
  build: () => Polygon;
}

/** Botones de formas: círculo y demás figuras de un clic */
export const SHAPES: ShapePreset[] = [
  { id: 'circulo', name: 'Círculo', build: () => circleShape() },
  { id: 'cuadrado', name: 'Cuadrado', build: () => squareShape() },
  { id: 'triangulo', name: 'Triángulo', build: () => triangleShape() },
  { id: 'hexagono', name: 'Hexágono', build: () => hexagonShape() },
  { id: 'estrella', name: 'Estrella', build: () => starShape() },
];