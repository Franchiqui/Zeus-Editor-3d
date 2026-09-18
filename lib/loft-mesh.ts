import type { Mesh, Polygon, Vertex3D } from '@/lib/geometry';

/**
 * Remuestrea un polígono para que tenga exactamente `targetN` vértices,
 * repartiéndolos uniformemente a lo largo de su perímetro.
 */
function resamplePolygon(polygon: Polygon, targetN: number): Polygon {
  if (polygon.length === targetN) return polygon;
  if (polygon.length < 2 || targetN < 3) return polygon;

  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(d);
    total += d;
  }
  if (total === 0) return polygon;

  const result: Polygon = [];
  for (let k = 0; k < targetN; k++) {
    const target = (k / targetN) * total;
    let acc = 0;
    let i = 0;
    while (i < lengths.length && acc + lengths[i] < target) {
      acc += lengths[i];
      i++;
    }
    const a = polygon[i % polygon.length];
    const b = polygon[(i + 1) % polygon.length];
    const t = lengths[i] > 0 ? (target - acc) / lengths[i] : 0;
    result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return result;
}

/**
 * Devuelve el factor de escala (X, Z) que aplica la silueta a una altura Y.
 */
function silhouetteScaleAt(silhouette: Polygon, y: number): [number, number] {
  const pts = silhouette;
  if (pts.length < 2) return [1, 1];

  const ys = pts.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (maxY - minY < 1e-6) return [1, 1];

  let scale = 1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    if (y >= lo && y <= hi) {
      const t = hi - lo > 1e-6 ? (y - lo) / (hi - lo) : 0;
      const ax = Math.abs(a.x - 0.5) * 2;
      const bx = Math.abs(b.x - 0.5) * 2;
      scale = ax + (bx - ax) * t;
      break;
    }
  }
  return [scale, scale];
}

/**
 * Construye una malla "loft" a partir de una pila de plantillas horizontales
 * y una silueta lateral.
 */
export function buildLoftMesh(
  sections: Array<{ id: number; polygon: Polygon; y: number }>,
  silhouette: Polygon,
  silhouetteView: 'front' | 'side' | 'both',
  subdivisions: number
): Mesh {
  const sorted = [...sections].sort((a, b) => a.y - b.y);
  if (sorted.length < 2 || silhouette.length < 2) {
    return { vertices: [], faces: [] as number[][] };
  }

  const maxN = Math.max(...sorted.map((s) => s.polygon.length));
  const normalizedSections = sorted.map((s) => ({
    y: s.y,
    polygon: resamplePolygon(s.polygon, maxN),
  }));

  // ▼ Interpolar plantillas intermedias ▼
  const sub = Math.max(1, Math.floor(subdivisions));
  const interpolated: Array<{ y: number; polygon: Polygon }> = [];
  for (let s = 0; s < normalizedSections.length - 1; s++) {
    const a = normalizedSections[s];
    const b = normalizedSections[s + 1];
    interpolated.push(a);
    for (let k = 1; k < sub; k++) {
      const t = k / sub;
      const y = a.y + (b.y - a.y) * t;
      const polygon: Polygon = a.polygon.map((p, i) => {
        const q = b.polygon[i];
        return {
          x: p.x + (q.x - p.x) * t,
          y: p.y + (q.y - p.y) * t,
        };
      });
      interpolated.push({ y, polygon });
    }
  }
  interpolated.push(normalizedSections[normalizedSections.length - 1]);

  const n = maxN;

  // ▼ Usa `interpolated`, no `normalizedSections`, para escalar ▼
  const scaledSections = interpolated.map((s) => {
    const [scaleX, scaleZ] = silhouetteScaleAt(silhouette, s.y);
    return {
      y: s.y,
      polygon: s.polygon.map((p: { x: number; y: number }) => {
        const cx = p.x - 0.5;
        const cz = p.y - 0.5;
        let x = cx;
        let z = cz;
        if (silhouetteView === 'front' || silhouetteView === 'both') x *= scaleX;
        if (silhouetteView === 'side' || silhouetteView === 'both') z *= scaleZ;
        return { x, z };
      }),
    };
  });

  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];

  for (const s of scaledSections) {
    for (const p of s.polygon) {
      vertices.push({ x: p.x, y: s.y, z: p.z });
    }
  }

  for (let s = 0; s < scaledSections.length - 1; s++) {
    const baseA = s * n;
    const baseB = (s + 1) * n;
    for (let i = 0; i < n; i++) {
      const a0 = baseA + i;
      const a1 = baseA + ((i + 1) % n);
      const b0 = baseB + i;
      const b1 = baseB + ((i + 1) % n);
      faces.push([a0, b0, b1]);
      faces.push([a0, b1, a1]);
    }
  }

  const firstBase = 0;
  const lastBase = (scaledSections.length - 1) * n;
  for (let i = 1; i < n - 1; i++) {
    faces.push([firstBase, firstBase + i + 1, firstBase + i]);
    faces.push([lastBase, lastBase + i, lastBase + i + 1]);
  }

  return { vertices, faces };
}