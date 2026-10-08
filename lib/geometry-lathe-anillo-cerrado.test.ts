/**
 * TEST — Toroide en el Torno: falta una banda de malla donde el perfil
 * se cierra (arriba del objeto).
 *
 * El contorno del perfil se DIBUJA cerrado en el lienzo (la forma
 * «Círculo» empieza arriba y termina justo antes de volver arriba), pero
 * `buildLatheMesh` nunca volvía a conectar la última fila de la
 * revolución con la primera → el toroide queda sin malla justo donde el
 * contorno se cierra: arriba.
 */
import { describe, expect, it } from 'vitest';
import { buildLatheMesh } from './geometry';
import type { Point2D } from './geometry';

/** La forma «Círculo» del lienzo (lib/shapes.ts): 32 puntos, abierta,
    empezando ARRIBA y terminando a las 337.5° (a un paso del inicio). */
function circleShape(r = 0.4, n = 32, cx = 0.5, cy = 0.5): Point2D[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });
}

/** ¿Está la banda de superficie entre las filas consecutivas del perfil
    (en bucle: la última vuelve con la primera)? Las filas de la malla del
    torno van en orden: floor(índice / segmentos). */
function bandasDelAnillo(
  vertices: number,
  faces: number[][],
  segments: number,
): Set<number> {
  const rows = Math.floor(vertices / segments);
  const linked = new Set<number>();
  if (rows < 2) return linked;
  for (const f of faces) {
    const filas = [...new Set(f.map((i) => Math.floor(i / segments)))];
    if (filas.length !== 2) continue;
    const [a, b] = filas;
    if ((a + 1) % rows === b) linked.add(a);
    if ((b + 1) % rows === a) linked.add(b);
  }
  return linked;
}

describe('REPRO toroide en el torno', () => {
  it('perfil circular cerrado: la malla cubre TODO el anillo del perfil', () => {
    const segments = 24;
    const mesh = buildLatheMesh(circleShape(), segments, false, 'cylindrical');
    expect(mesh.vertices.length).toBeGreaterThan(0);
    const linked = bandasDelAnillo(mesh.vertices.length, mesh.faces, segments);
    const rows = Math.floor(mesh.vertices.length / segments);
    const faltantes: number[] = [];
    for (let r = 0; r < rows; r++) if (!linked.has(r)) faltantes.push(r);
    expect(faltantes).toEqual([]);
  });

  it('perfil cerrado con el último punto REPETIDO (caso IA/API): cubre todo el anillo', () => {
    const segments = 24;
    const abierta = circleShape();
    const cerrada = [...abierta, { ...abierta[0] }];
    const mesh = buildLatheMesh(cerrada, segments, false, 'cylindrical');
    const linked = bandasDelAnillo(mesh.vertices.length, mesh.faces, segments);
    const rows = Math.floor(mesh.vertices.length / segments);
    const faltantes: number[] = [];
    for (let r = 0; r < rows; r++) if (!linked.has(r)) faltantes.push(r);
    expect(faltantes).toEqual([]);
  });

  it('perfil ABIERTO (vaca, botella…): sigue abierto, sin bandas de cierre espurias', () => {
    const segments = 24;
    // Botella: primer punto en el eje abajo, último en el eje arriba.
    const botella: Point2D[] = [
      { x: 0, y: 2 },
      { x: 0.26, y: 1.96 },
      { x: 0.28, y: 1.82 },
      { x: 0.28, y: 0.96 },
      { x: 0.12, y: 0.5 },
      { x: 0.12, y: 0.04 },
      { x: 0, y: 0 },
    ];
    const mesh = buildLatheMesh(botella, segments, true, 'cylindrical');
    const linked = bandasDelAnillo(mesh.vertices.length, mesh.faces, segments);
    const rows = Math.floor(mesh.vertices.length / segments);
    // Todo par de filas CONSECUTIVAS abierto (0..rows-2) debe tener banda…
    for (let r = 0; r < rows - 1; r++) expect(linked.has(r)).toBe(true);
    // …pero la costura (última → primera) NO debe existir.
    expect(linked.has(rows - 1)).toBe(false);
  });
});