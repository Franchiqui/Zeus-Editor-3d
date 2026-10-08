/**
 * Remuestreo del perfil del torno (control «Vértices del perfil»):
 * cambia el número de puntos del contorno sin cambiar la silueta.
 */
import { describe, expect, it } from 'vitest';
import { resampleLatheProfile } from './lathe-profiles';
import { buildLatheMesh } from './geometry';
import type { Point2D } from './geometry';

/** Copia reducida de circleShape (lib/shapes.ts): 32 puntos abiertos, empieza arriba. */
function circleShape(r = 0.4, n = 32, cx = 0.5, cy = 0.5): Point2D[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });
}

describe('resampleLatheProfile', () => {
  it('círculo 32 → 8: 8 vértices, todos a distancia del centro ≈ el radio', () => {
    const out = resampleLatheProfile(circleShape(), 8);
    expect(out).toHaveLength(8);
    for (const p of out) {
      const d = Math.hypot(p.x - 0.5, p.y - 0.5);
      expect(d).toBeCloseTo(0.4, 2);
    }
  });

  it('mismo número de vértices: sin cambios (se conservan las asas)', () => {
    const conAsas: Point2D[] = [
      { x: 0.4, y: 0.4, hIn: { x: 0.35, y: 0.4 }, hOut: { x: 0.45, y: 0.4 } },
      { x: 0.6, y: 0.4, hIn: { x: 0.55, y: 0.4 }, hOut: { x: 0.65, y: 0.4 } },
      { x: 0.6, y: 0.6, hIn: { x: 0.6, y: 0.55 }, hOut: { x: 0.6, y: 0.65 } },
      { x: 0.4, y: 0.6, hIn: { x: 0.4, y: 0.65 }, hOut: { x: 0.4, y: 0.55 } },
    ];
    const out = resampleLatheProfile(conAsas, 4);
    expect(out).toHaveLength(4);
    expect(out[0].hIn).toBeDefined();
    expect(out[2].hOut).toBeDefined();
  });

  it('círculo a lo grande (32 → 96): la silueta crece por VÉRTICES, no por radio', () => {
    const out = resampleLatheProfile(circleShape(), 96);
    for (const p of out) {
      const d = Math.hypot(p.x - 0.5, p.y - 0.5);
      expect(d).toBeCloseTo(0.4, 2);
    }
  });

  it('perfil ABIERTO (botella): los extremos quedan tal cual', () => {
    const botella: Point2D[] = [
      { x: 0, y: 2 },
      { x: 0.26, y: 1.96 },
      { x: 0.28, y: 1.82 },
      { x: 0.28, y: 0.96 },
      { x: 0.12, y: 0.5 },
      { x: 0.12, y: 0.04 },
      { x: 0, y: 0 },
    ];
    const mas = resampleLatheProfile(botella, 5);
    const menos = resampleLatheProfile(botella, 12);
    for (const out of [mas, menos]) {
      expect(out[0]).toEqual({ x: 0, y: 2 });
      expect(out[out.length - 1]).toEqual({ x: 0, y: 0 });
    }
    expect(mas.length).toBe(5);
    expect(menos.length).toBe(12);
    // Y ningún punto sale negativo de radio
    for (const p of [...mas, ...menos]) expect(p.x).toBeGreaterThanOrEqual(-1e-6);
  });

  it('círculo remuestreado sigue construyendo un toroido SIN hueco', () => {
    const remuestreado = resampleLatheProfile(circleShape(), 16);
    const segments = 24;
    const mesh = buildLatheMesh(remuestreado, segments, false, 'cylindrical');
    expect(mesh.vertices.length).toBeGreaterThan(0);
    const rows = Math.floor(mesh.vertices.length / segments);
    expect(rows).toBeGreaterThanOrEqual(16 * 16);
    // La banda de cierre no puede faltar: cada fila con su siguiente en bucle
    const linked = new Set<number>();
    for (const f of mesh.faces) {
      const filas = [...new Set(f.map((i) => Math.floor(i / segments)))];
      if (filas.length !== 2) continue;
      const [a, b] = filas;
      if ((a + 1) % rows === b) linked.add(a);
      if ((b + 1) % rows === a) linked.add(b);
    }
    for (let r = 0; r < rows; r++) expect(linked.has(r)).toBe(true);
  });
});