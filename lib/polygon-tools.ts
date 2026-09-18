import type { Polygon, Point2D, Handle2D } from './geometry';
import { flattenPolygon } from './geometry';

/**
 * Herramientas de edición de plantillas 2D: escalar sin deformar y
 * sumar/restar vértices sin cambiar la forma. Solo tocan el polígono de
 * la plantilla en el lienzo; no afectan a cómo se construye el objeto.
 */

/**
 * Escala el polígono (asas de curvas incluidas) el mismo factor en X e Y
 * alrededor de su centro, SIN deformarlo. El factor se recorta al máximo
 * que cabe en el lienzo 0..1, así la plantilla nunca se sale del borde.
 */
export function scalePolygonUniform(poly: Polygon, factor: number): Polygon {
  if (poly.length < 2 || !isFinite(factor) || factor <= 0) {
    return poly.map((p) => ({ ...p }));
  }

  // El centro y el tamaño se miden sobre la curva real (asas aplanadas),
  // igual que al ajustar plantillas al ancho de la silueta.
  const flat = flattenPolygon(poly, 24);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of flat) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const halfW = Math.max(1e-6, (maxX - minX) / 2);
  const halfH = Math.max(1e-6, (maxY - minY) / 2);

  // Factor máximo que cabe en el lienzo desde ese centro
  const maxS = Math.min(cx / halfW, (1 - cx) / halfW, cy / halfH, (1 - cy) / halfH);
  const s = Math.min(factor, Math.max(0.05, maxS));

  const map = (p: { x: number; y: number }) => ({
    x: cx + (p.x - cx) * s,
    y: cy + (p.y - cy) * s,
  });
  return poly.map((p) => {
    const q = map(p);
    const next: Point2D = { ...q };
    if (p.hIn) next.hIn = map(p.hIn) as Handle2D;
    if (p.hOut) next.hOut = map(p.hOut) as Handle2D;
    return next;
  });
}

/**
 * Escala el polígono (asas de curvas incluidas) el mismo factor en X e Y
 * alrededor de su centro, SIN deformarlo y SIN recortar al canvas.
 * A diferencia de scalePolygonUniform, permite aumentar el tamaño
 * por encima del canvas.
 */
export function scalePolygonUniformUnbounded(poly: Polygon, factor: number): Polygon {
  if (poly.length < 2 || !isFinite(factor) || factor <= 0) {
    return poly.map((p) => ({ ...p }));
  }

  const flat = flattenPolygon(poly, 24);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of flat) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const map = (p: { x: number; y: number }) => ({
    x: cx + (p.x - cx) * factor,
    y: cy + (p.y - cy) * factor,
  });
  return poly.map((p) => {
    const q = map(p);
    const next: Point2D = { ...q };
    if (p.hIn) next.hIn = map(p.hIn) as Handle2D;
    if (p.hOut) next.hOut = map(p.hOut) as Handle2D;
    return next;
  });
}

/**
 * alrededor de su propio centro: la figura gira sobre sí misma sin
 * cambiar de sitio. Si al girar se saliera del lienzo 0..1, se encoge lo
 * justo para volver a caber (mismo criterio que scalePolygonUniform).
 */
export function rotatePolygonInPlace(poly: Polygon, angleRad: number): Polygon {
  if (poly.length < 2 || !isFinite(angleRad) || angleRad === 0) {
    return poly.map((p) => ({ ...p }));
  }

  // El centro se mide sobre la curva real (asas aplanadas), igual que al
  // escalar: la figura gira alrededor de donde de verdad está.
  const flat = flattenPolygon(poly, 24);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of flat) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rotate = (p: { x: number; y: number }) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  });

  const rotated = poly.map((p) => {
    const q = rotate(p);
    const next: Point2D = { ...q };
    if (p.hIn) next.hIn = rotate(p.hIn) as Handle2D;
    if (p.hOut) next.hOut = rotate(p.hOut) as Handle2D;
    return next;
  });

  // ¿La figura girada cabe en el lienzo? Si no, se encoge alrededor de su
  // nuevo centro sin deformarla.
  const flatR = flattenPolygon(rotated, 24);
  let minXr = Infinity;
  let maxXr = -Infinity;
  let minYr = Infinity;
  let maxYr = -Infinity;
  for (const p of flatR) {
    if (p.x < minXr) minXr = p.x;
    if (p.x > maxXr) maxXr = p.x;
    if (p.y < minYr) minYr = p.y;
    if (p.y > maxYr) maxYr = p.y;
  }
  const cxr = (minXr + maxXr) / 2;
  const cyr = (minYr + maxYr) / 2;
  const halfW = Math.max(1e-6, (maxXr - minXr) / 2);
  const halfH = Math.max(1e-6, (maxYr - minYr) / 2);
  const maxS = Math.min(cxr / halfW, (1 - cxr) / halfW, cyr / halfH, (1 - cyr) / halfH);
  if (maxS >= 1) return rotated;

  const s = Math.max(0.05, maxS);
  const map = (p: { x: number; y: number }) => ({
    x: cxr + (p.x - cxr) * s,
    y: cyr + (p.y - cyr) * s,
  });
  return rotated.map((p) => {
    const q = map(p);
    const next: Point2D = { ...q };
    if (p.hIn) next.hIn = map(p.hIn) as Handle2D;
    if (p.hOut) next.hOut = map(p.hOut) as Handle2D;
    return next;
  });
}

/**
 * Longitud aproximada de la arista i→i+1 siguiendo su curva Bézier real
 * (si tiene asas) o la recta.
 */
function edgeLength(poly: Polygon, i: number): number {
  const a = poly[i];
  const b = poly[(i + 1) % poly.length];
  const c1 = a.hOut ?? a;
  const c2 = b.hIn ?? b;
  const curved = a.hOut !== undefined || b.hIn !== undefined;
  if (!curved) return Math.hypot(b.x - a.x, b.y - a.y);
  let len = 0;
  const steps = 8;
  let prev = { x: a.x, y: a.y };
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const mt = 1 - t;
    // Bézier cúbica
    const x =
      mt * mt * mt * a.x +
      3 * mt * mt * t * c1.x +
      3 * mt * t * t * c2.x +
      t * t * t * b.x;
    const y =
      mt * mt * mt * a.y +
      3 * mt * mt * t * c1.y +
      3 * mt * t * t * c2.y +
      t * t * t * b.y;
    len += Math.hypot(x - prev.x, y - prev.y);
    prev = { x, y };
  }
  return len;
}

/**
 * Añade un vértice en la arista más larga SIN cambiar la forma:
 * - arista recta → su punto medio;
 * - arista curva (asas) → el punto medio exacto de la curva, y las asas se
 *   reparten con De Casteljau, así la curva queda IDÉNTICA (solo se
 *   añade un vértice sobre ella).
 */
export function addPolygonVertex(poly: Polygon): Polygon {
  const n = poly.length;
  if (n < 3) return poly.map((p) => ({ ...p }));

  // Arista más larga (siguiendo la curva, no la cuerda)
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < n; i++) {
    const l = edgeLength(poly, i);
    if (l > bestLen) {
      bestLen = l;
      best = i;
    }
  }

  const a = poly[best];
  const b = poly[(best + 1) % n];
  const out: Polygon = poly.map((p) => ({ ...p }));
  if (a.hOut === undefined && b.hIn === undefined) {
    // Arista recta: punto medio
    out.splice(best + 1, 0, {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });
  } else {
    // Arista curva: partir la Bézier por la mitad (De Casteljau, t=0.5).
    // La unión de las dos mitades es exactamente la curva original.
    const P0 = { x: a.x, y: a.y };
    const P3 = { x: b.x, y: b.y };
    const P1 = a.hOut ?? P0;
    const P2 = b.hIn ?? P3;
    const mid = (p: Point2D, q: Point2D) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const A = mid(P0, P1);
    const B = mid(P1, P2);
    const C = mid(P2, P3);
    const D = mid(A, B);
    const E = mid(B, C);
    const F = mid(D, E); // punto medio exacto de la curva
    out[best].hOut = A;
    out.splice(best + 1, 0, { x: F.x, y: F.y, hIn: D, hOut: E });
    // El vértice b (que en out está en best+2) recibe hIn = C
    out[(best + 2) % (n + 1)].hIn = C;
  }
  return out;
}

/**
 * Quita el vértice que MENOS cambia la forma: el que está más pegado a la
 * recta que une a sus dos vecinos. Si la figura necesita ese vértice
 * (p. ej. una esquina del cuadrado) el cambio se nota, pero siempre es el
 * menor posible. Nunca baja de 3 vértices.
 */
export function removePolygonVertex(poly: Polygon): Polygon {
  const n = poly.length;
  if (n <= 3) return poly.map((p) => ({ ...p }));

  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    // Distancia del vértice a la cuerda prev→next
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy);
    let err: number;
    if (len < 1e-12) {
      err = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    } else {
      err = Math.abs(dy * cur.x - dx * cur.y + next.x * prev.y - next.y * prev.x) / len;
    }
    // Un vértice con asas propias sostiene una curva: penalizarlo un poco
    // para que se prefiera quitar vértices "simples".
    if (cur.hIn || cur.hOut) err += 0.05;
    if (err < bestErr) {
      bestErr = err;
      best = i;
    }
  }
  return poly.filter((_, i) => i !== best);
}

/**
 * Lleva el polígono al número de vértices pedido sin cambiar la forma
 * (añade en las aristas más largas / quita los que menos importan).
 */
export function setPolygonVertexCount(poly: Polygon, count: number): Polygon {
  let out = poly;
  const target = Math.max(3, Math.min(128, Math.floor(count)));
  let guard = 0;
  while (out.length < target && guard++ < 200) out = addPolygonVertex(out);
  guard = 0;
  while (out.length > target && out.length > 3 && guard++ < 200) {
    out = removePolygonVertex(out);
  }
  return out;
}