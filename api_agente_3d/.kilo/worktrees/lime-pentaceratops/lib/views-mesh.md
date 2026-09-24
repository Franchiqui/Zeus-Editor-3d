import {
  Views,
  Mesh,
  Vertex3D,
  Point2D,
  normalizePolygon,
  Section,
  flattenPolygon,
  polygonYRange,
  scanlineIntervalsAtY,
  interpolateSection,
} from './geometry';

export interface ViewsMeshOptions {
  /** Cortes horizontales: fidelidad de las curvas de Frente y Costado */
  levels?: number;
  /** Muestras por contorno: fidelidad de las curvas de Superior */
  samples?: number;
  /** Segmentos por arista curva al aplanar las plantillas */
  curveSteps?: number;
  /**
   * Secciones horizontales (plantillas X·Z a alturas Y). Si se pasan,
   * mandan sobre la vista Superior: a cada altura la forma en planta
   * es la sección interpolada, no la Superior escalada. Así cualquier
   * plantilla importa en el resultado.
   */
  sections?: Section[];
}

interface Ring {
  /** Contorno del corte en coordenadas de la vista superior (x, y=z) */
  pts: Point2D[];
  /** Índices de vértice 3D de cada punto del contorno */
  ids: number[];
  cx: number;
  cy: number;
}

/**
 * Construye el objeto 3D como una MALLA SUAVE Y EDITABLE a partir de las
 * tres plantillas, sin pasar por vóxeles: el sólido es el mismo (la
 * intersección de las tres extrusiones), pero sus caras siguen las curvas
 * dibujadas en las plantillas en vez de escalones de vóxeles.
 *
 * Método: cortes horizontales. A cada altura y, la sección del sólido es
 * la vista Superior recortada al intervalo X que permite el Frente a esa
 * altura y al intervalo Z que permite el Costado. Los contornos de cortes
 * consecutivos se empalman con cuadriláteros; las tapas se triangulan.
 * Así:
 *  - las curvas del Frente salen en los muros que miran a ±X,
 *  - las del Costado en los muros que miran a ±Z,
 *  - y las de la Superior en las paredes verticales del contorno.
 */
export function buildViewsMesh(
  views: Views,
  opts: ViewsMeshOptions = {}
): Mesh {
  const L = Math.max(8, Math.floor(opts.levels ?? 40));
  const N = Math.max(12, Math.floor(opts.samples ?? 96));
  const curveSteps = Math.max(8, opts.curveSteps ?? 24);

  if (
    views.front.length < 3 ||
    views.side.length < 3 ||
    views.top.length < 3
  ) {
    return { vertices: [], faces: [] };
  }

  // Plantillas con las curvas aplanadas a polilíneas
  const front = flattenPolygon(normalizePolygon(views.front), curveSteps);
  const side = flattenPolygon(normalizePolygon(views.side), curveSteps);
  let top = flattenPolygon(normalizePolygon(views.top), curveSteps);
  // Secciones opcionales: si vienen, mandan sobre `top` a cada altura
  const sections = opts.sections;
  const useSections = Array.isArray(sections) && sections.length >= 2;
  // Las plantillas pueden traer esquinas curvadas (asas hIn/hOut): se
  // aplanan a polilíneas para que la interpolación entre alturas siga las
  // curvas dibujadas en vez de las cuerdas rectas entre vértices. Sin
  // asas no se toca nada (mismo número de puntos que antes).
  const sectionsSorted = useSections
    ? [...sections!]
        .sort((a, b) => a.y - b.y)
        .map((s) =>
          s.polygon.some((p) => p.hIn || p.hOut)
            ? { ...s, polygon: flattenPolygon(s.polygon, curveSteps) }
            : s
        )
    : [];
  const sectionsYLo = useSections ? sectionsSorted[0].y : 0;
  const sectionsYHi = useSections
    ? sectionsSorted[sectionsSorted.length - 1].y
    : 1;
  const sectionsTargetN = useSections
    ? Math.max(...sectionsSorted.map((s) => s.polygon.length))
    : 0;

  // Orientación del contorno superior: shoelace NEGATIVO (antihorario
  // visual con el eje Y del lienzo hacia abajo). Con esta orientación una
  // tapa en ese orden mira a +Y y los muros [p_k, p_k+1, q_k+1, q_k]
  // (p corte inferior, q superior) apuntan hacia fuera.
  if (shoelace(top) > 0) top.reverse();

  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const vmap = new Map<string, number>();
  const getVertex = (x: number, y: number, z: number): number => {
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    const found = vmap.get(key);
    if (found !== undefined) return found;
    const id = vertices.length;
    vertices.push({ x, y, z });
    vmap.set(key, id);
    return id;
  };

  // Tapa de un contorno: dir=+1 mira a +Y (arriba), dir=-1 a -Y (abajo)
  const capFaces = (ring: Ring, dir: number) => {
    const { pts, ids } = ring;
    const n = pts.length;
    if (n < 3) return;
    // El recorte de orejas trabaja con anillos CCW (shoelace positivo):
    // se le pasa el contorno invertido. Los triángulos que salen tienen
    // ese mismo giro físico, así que la tapa superior (que necesita el
    // giro contrario, el del contorno original) se voltea.
    const rev = [...pts].reverse();
    const tris = earClip(rev);
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const a = (n - 1 - tris[t]) % n;
      const b = (n - 1 - tris[t + 1]) % n;
      const c = (n - 1 - tris[t + 2]) % n;
      if (dir > 0) faces.push([ids[a], ids[c], ids[b]]);
      else faces.push([ids[a], ids[b], ids[c]]);
    }
  };

  // Contornos de la sección a la altura yc (coordenadas de lienzo, y abajo)
  const clampY = (y: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, y));

  // Contornos de la sección a la altura yc (coordenadas de lienzo, y abajo)
  const ringsAt = (yc: number): Ring[] => {
    const modelY = 1 - 2 * yc;
    const xr = scanlineIntervalsAtY(front, clampY(yc, fLo, fHi));
    const zr = scanlineIntervalsAtY(side, clampY(yc, sLo, sHi));
    if (xr.length === 0 || zr.length === 0) return [];
    const out: Ring[] = [];

    if (xr.length === 1 && zr.length === 1) {
      // Corte a esta altura: la Superior manda en la FORMA del contorno
      // y el Frente y el Costado en su TAMAÑO. En vez de recortar la
      // Superior a la caja que permiten las otras dos (con tres círculos
      // eso da el sólido de Steinmetz, con aristas en vez de esfera), se
      // escala al ancho exacto de esa caja. Así tres círculos dan una
      // esfera perfecta, y una Superior rectangular sigue dando
      // exactamente la caja de siempre (un cuadro que ocupa todo el
      // lienzo, escalado a la caja, es la caja).
      const [x0, x1] = xr[0];
      const [z0, z1] = zr[0];
      const kx = x1 - x0;
      const kz = z1 - z0;
      if (kx >= 1e-7 && kz >= 1e-7) {
        // Si hay secciones, la forma en planta a esta altura es la
        // sección interpolada; si no, la vista Superior escalada.
        let baseContour: Point2D[];
        if (useSections) {
          const yModel = 1 - yc;
          const yy = Math.max(sectionsYLo, Math.min(sectionsYHi, yModel));
          baseContour = interpolateSection(
            sectionsSorted,
            yy,
            sectionsTargetN
          );
        } else {
          baseContour = top;
        }

        let p = baseContour.map((q) => ({
          x: x0 + q.x * kx,
          y: z0 + q.y * kz,
        }));
        p = dedupe(p);
        if (p.length >= 3 && Math.abs(shoelace(p)) >= 1e-9) {
          if (shoelace(p) > 0) p.reverse();
          const ring = resampleRing(p, N);
          if (ring.length >= 3) {
            let cx = 0;
            let cy = 0;
            const ids = ring.map((q) => {
              cx += q.x;
              cy += q.y;
              return getVertex(2 * q.x - 1, modelY, 2 * q.y - 1);
            });
            out.push({
              pts: ring,
              ids,
              cx: cx / ring.length,
              cy: cy / ring.length,
            });
          }
        }
      }
      return out;
    }

    // Perfil no convexo a esta altura (varios intervalos): intersección
    // clásica con la caja, que maneja cada pieza por separado
    let baseContour: Point2D[];
    if (useSections) {
      const yModel = 1 - yc;
      const yy = Math.max(sectionsYLo, Math.min(sectionsYHi, yModel));
      baseContour = interpolateSection(
        sectionsSorted,
        yy,
        sectionsTargetN
      );
    } else {
      baseContour = top;
    }
    for (const [x0, x1] of xr) {
      for (const [z0, z1] of zr) {
        if (x1 - x0 < 1e-7 || z1 - z0 < 1e-7) continue;
        let p = clipToRect(baseContour, x0, x1, z0, z1);
        p = dedupe(p);
        if (p.length < 3 || Math.abs(shoelace(p)) < 1e-9) continue;
        if (shoelace(p) > 0) p.reverse();
        const ring = resampleRing(p, N);
        if (ring.length < 3) continue;
        let cx = 0;
        let cy = 0;
        const ids: number[] = ring.map((q) => {
          cx += q.x;
          cy += q.y;
          return getVertex(2 * q.x - 1, modelY, 2 * q.y - 1);
        });
        out.push({ pts: ring, ids, cx: cx / ring.length, cy: cy / ring.length });
      }
    }
    return out;
  };

  // Rango real en Y de las plantillas: una curva puede sobresalir del bbox
  // de los vértices (curvar las dos esquinas de arriba levanta el borde
  // superior por encima de la línea de vértices), así que se mide sobre
  // las polilíneas aplanadas. Cada vista manda en su dirección: donde la
  // curva de una vista sobresale de la altura de la otra, la otra NO
  // recorta (usa su último intervalo definido). Así el borde curvado del
  // Frente levanta la cara superior aunque el Costado sea plano (y al
  // revés). Con polígonos sin curvas los rangos coinciden y no cambia
  // nada.
  const [fLo, fHi] = polygonYRange(front);
  const [sLo, sHi] = polygonYRange(side);
  const yLo = Math.min(fLo, sLo);
  const yHi = Math.max(fHi, sHi);
  const span = Math.max(1e-6, yHi - yLo);

  // Cortes de abajo (yc=yHi) a arriba (yc=yLo). Además de los centros
  // uniformes se prueban los extremos exactos: si la plantilla acaba en
  // borde plano, la tapa cae en la altura exacta (el objeto mide lo que
  // marca la plantilla); si acaba en pico, el contorno degenera y se
  // descarta solo. La densidad de cortes se mantiene aunque las curvas
  // estiren el objeto por encima o por debajo del bbox de vértices.
  const EPS_Y = 1e-6;
  const L2 = Math.max(8, Math.ceil(L * span));
  const slices: Ring[][] = [];
  const bottom = ringsAt(yHi - EPS_Y);
  if (bottom.length > 0) slices.push(bottom);
  for (let i = 0; i < L2; i++) {
    slices.push(ringsAt(yHi - (i + 0.5) * (span / L2)));
  }
  const topSlice = ringsAt(yLo + EPS_Y);
  if (topSlice.length > 0) slices.push(topSlice);

  let prev: Ring[] = [];
  for (const cur of slices) {
    // Emparejar cada contorno actual con el más cercano del corte anterior
    const usedPrev = new Set<number>();
    for (const c of cur) {
      let best = -1;
      let bestD = Infinity;
      prev.forEach((p, idx) => {
        if (usedPrev.has(idx)) return;
        const d = (p.cx - c.cx) ** 2 + (p.cy - c.cy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = idx;
        }
      });
      if (best >= 0 && bestD < 0.16) {
        usedPrev.add(best);
        const p = prev[best];
        // Muro entre cortes consecutivos, normal hacia fuera
        for (let k = 0; k < N; k++) {
          const k2 = (k + 1) % N;
          faces.push([p.ids[k], p.ids[k2], c.ids[k2], c.ids[k]]);
        }
      } else {
        // Componente que nace en este corte: tapa inferior
        capFaces(c, -1);
      }
    }
    // Componentes del corte anterior que terminan: tapa superior
    prev.forEach((p, idx) => {
      if (!usedPrev.has(idx)) capFaces(p, +1);
    });
    prev = cur;
  }
  // Tapas superiores del último corte
  for (const p of prev) capFaces(p, +1);

  return { vertices, faces };
}

/** Área con signo (shoelace) de un polígono cerrado */
function shoelace(poly: Point2D[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Quita puntos consecutivos repetidos (típico del recorte) */
function dedupe(poly: Point2D[]): Point2D[] {
  const out: Point2D[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-9) out.push(p);
  }
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-9) out.pop();
  }
  return out;
}

/** Recorte de un polígono contra un rectángulo (Sutherland–Hodgman) */
function clipToRect(
  poly: Point2D[],
  x0: number,
  x1: number,
  z0: number,
  z1: number
): Point2D[] {
  let pts = poly;
  const clipPlane = (
    inp: Point2D[],
    keep: (p: Point2D) => boolean,
    inter: (a: Point2D, b: Point2D) => Point2D
  ): Point2D[] => {
    if (inp.length === 0) return [];
    const out: Point2D[] = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i];
      const b = inp[(i + 1) % inp.length];
      const ka = keep(a);
      const kb = keep(b);
      if (ka) out.push(a);
      if (ka !== kb) out.push(inter(a, b));
    }
    return out;
  };
  const atX = (a: Point2D, b: Point2D, x: number): Point2D => {
    const t = (x - a.x) / (b.x - a.x);
    return { x, y: a.y + (b.y - a.y) * t };
  };
  const atY = (a: Point2D, b: Point2D, y: number): Point2D => {
    const t = (y - a.y) / (b.y - a.y);
    return { x: a.x + (b.x - a.x) * t, y };
  };
  const e = 1e-12;
  pts = clipPlane(pts, (p) => p.x >= x0 - e, (a, b) => atX(a, b, x0));
  pts = clipPlane(pts, (p) => p.x <= x1 + e, (a, b) => atX(a, b, x1));
  pts = clipPlane(pts, (p) => p.y >= z0 - e, (a, b) => atY(a, b, z0));
  pts = clipPlane(pts, (p) => p.y <= z1 + e, (a, b) => atY(a, b, z1));
  return pts;
}

/**
 * Remuestrea el contorno cerrado a n puntos uniformes por longitud de
 * arco, empezando en el vértice de menor (x, y): ancla estable para que
 * los muros entre cortes consecutivos no se retuerzan.
 */
function resampleRing(poly: Point2D[], n: number): Point2D[] {
  const m = poly.length;
  let s = 0;
  for (let i = 1; i < m; i++) {
    if (
      poly[i].x < poly[s].x - 1e-12 ||
      (Math.abs(poly[i].x - poly[s].x) <= 1e-12 && poly[i].y < poly[s].y)
    ) {
      s = i;
    }
  }
  const segLen: number[] = [];
  let total = 0;
  for (let k = 0; k < m; k++) {
    const a = poly[(s + k) % m];
    const b = poly[(s + k + 1) % m];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    segLen.push(l);
    total += l;
  }
  if (total <= 0) return [];
  const out: Point2D[] = [];
  let seg = 0;
  let acc = 0;
  const step = total / n;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (seg < m - 1 && acc + segLen[seg] < target) {
      acc += segLen[seg];
      seg++;
    }
    const a = poly[(s + seg) % m];
    const b = poly[(s + seg + 1) % m];
    const t = segLen[seg] > 1e-12 ? (target - acc) / segLen[seg] : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function cross(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function pointInTriangle(p: Point2D, a: Point2D, b: Point2D, c: Point2D): boolean {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  const hasNeg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12;
  const hasPos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
  return !(hasNeg && hasPos);
}

/**
 * Triangulación por recorte de orejas de un polígono simple CCW (shoelace
 * positivo). Devuelve triángulos como índices [i0,i1,i2, i0,i1,i2, ...]
 * sobre el propio array. Si se atasca (polígono degenerado) cae a un
 * abanico desde el primer punto.
 */
function earClip(poly: Point2D[]): number[] {
  const n = poly.length;
  if (n < 3) return [];
  const idx = Array.from({ length: n }, (_, i) => i);
  const tris: number[] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 2 * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = poly[ia];
      const b = poly[ib];
      const c = poly[ic];
      if (cross(a, b, c) <= 1e-12) continue; // cóncavo o colineal
      let inside = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (pointInTriangle(poly[j], a, b, c)) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      tris.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
  // Resguardo: si quedaron puntos sin triangular, abanico desde el primero
  if (idx.length > 3) {
    const base = idx[0];
    for (let i = 1; i + 1 < idx.length; i++) {
      tris.push(base, idx[i], idx[i + 1]);
    }
  }
  return tris;
}