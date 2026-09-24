/** Asa (punto de control) de una curva Bézier, en la misma escala que los vértices */
export type Handle2D = { x: number; y: number };

export type Point2D = {
  x: number;
  y: number;
  /**
   * Asa de la arista entrante: control de la curva que llega a este
   * vértice desde el anterior. Ausente = la arista entra recta.
   */
  hIn?: Handle2D;
  /**
   * Asa de la arista saliente: control de la curva que sale de este
   * vértice hacia el siguiente. Ausente = la arista sale recta.
   */
  hOut?: Handle2D;
};
export type Polygon = Point2D[];

export type Vertex3D = { x: number; y: number; z: number };
export type Face = [number, number, number, number] | [number, number, number];
export type Mesh = {
  vertices: Vertex3D[];
  faces: number[][];
  /**
   * Color hex ('#rrggbb') por cara, alineado con el índice de `faces`.
   * null o ausente = sin color (material por defecto del visor).
   */
  faceColors?: (string | null)[];
  /** Opacidad por cara, alineada con `faces` (0..1). */
  faceOpacities?: number[];
  /**
   * Textura PNG (data URL) para el modo "vista plana": reproduce la
   * apariencia exacta del texto renderizado en pantalla.
   */
  texture?: string;
  /** Color configurado para teñir la textura sin sustituirla. */
  textureColor?: string;
  /** Intensidad del relieve de la textura (0 = plano). */
  textureRelief?: number;
  /** Acabado de la superficie texturizada. */
  textureFinish?: TextureFinish;
  /**
   * Coordenadas UV por vértice (alineadas con `vertices`), para mapear
   * la textura. Si está ausente, el visor no aplica textura.
   */
  uvs?: [number, number][];
  /**
   * Opacidad global del material (0..1, 1 = sólido). Solo la usa el
   * visor cuando la malla lleva textura.
   */
  opacity?: number;
};

export type LatheTextureProjection = 'planar' | 'cylindrical' | 'spherical';
export type TextureFinish = 'glossy' | 'semi-matte' | 'matte';

export type Views = {
  front: Polygon;
  side: Polygon;
  top: Polygon;
};

/**
 * Sección horizontal del objeto: a la altura `y` (coordenada de modelo,
 * 0 abajo, 1 arriba), la forma en planta es `polygon` (coordenadas 0..1
 * en X y Z). Se usa en la pestaña Mallas para reconstruir a partir de N
 * plantillas en vez de una sola vista Superior.
 */
export type Section = { y: number; polygon: Polygon };

export const GRID_SIZE = 16;
export const VOXEL_COUNT = 16;

/**
 * Resolución interna de la malla de vóxeles fusionados de alta fidelidad:
 * lo bastante fina para que las curvas no pierdan detalle, pero con las
 * caras coplanares fusionadas la malla sigue siendo pequeña y pareja.
 */
export const HIGH_FIDELITY_RES = 96;

/** Longitud por defecto de las asas al curvar una esquina (fracción de la arista más corta) */
export const DEFAULT_HANDLE_LEN = 0.35;

/**
 * Path SVG del polígono con aristas curvas (coordenadas 0..100).
 * Cada arista se traza como curva cúbica de Bézier: el asa saliente
 * del vértice inicial y la entrante del final son sus puntos de control.
 * Sin asas, la arista es recta.
 */
export function roundedPolygonPath(poly: Polygon, closed: boolean): string {
  const n = poly.length;
  if (n === 0) return '';
  const f = (v: number) => (Math.round(v * 1000) / 10).toString();
  const pt = (p: Handle2D) => `${f(p.x)} ${f(p.y)}`;

  if (!closed || n < 3) {
    return (
      poly.map((p, i) => `${i === 0 ? 'M' : 'L'} ${pt(p)}`).join(' ') +
      (closed ? ' Z' : '')
    );
  }

  let d = `M ${pt(poly[0])}`;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p = poly[i];
    const q = poly[j];
    if (p.hOut || q.hIn) {
      d += ` C ${p.hOut ? pt(p.hOut) : pt(p)} ${q.hIn ? pt(q.hIn) : pt(q)} ${pt(q)}`;
    } else {
      d += ` L ${pt(q)}`;
    }
  }
  return d + ' Z';
}

function closestOnSegment(
  p: Point2D,
  a: Point2D,
  b: Point2D
): { dist: number; point: Point2D } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { dist: Math.hypot(p.x - a.x, p.y - a.y), point: a };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { dist: Math.hypot(p.x - point.x, p.y - point.y), point };
}

/**
 * Punto de la frontera del polígono más cercano a `pt`: devuelve el índice
 * de la arista, la distancia y el punto proyectado sobre ella (recta o
 * curva Bézier muestreada). En polilíneas abiertas no considera el cierre.
 */
export function closestEdgeHit(
  poly: Polygon,
  pt: Point2D,
  steps = 12
): { edge: number; dist: number; point: Point2D } | null {
  const n = poly.length;
  if (n < 2) return null;
  const edgeCount = n >= 3 ? n : n - 1;
  let best: { edge: number; dist: number; point: Point2D } | null = null;
  for (let i = 0; i < edgeCount; i++) {
    const j = (i + 1) % n;
    const a = poly[i];
    const b = poly[j];
    if (a.hOut || b.hIn) {
      const c1 = a.hOut ?? a;
      const c2 = b.hIn ?? b;
      let prev: Point2D = a;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        const cur: Point2D = {
          x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
          y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
        };
        const hit = closestOnSegment(pt, prev, cur);
        if (!best || hit.dist < best.dist) best = { edge: i, ...hit };
        prev = cur;
      }
    } else {
      const hit = closestOnSegment(pt, a, b);
      if (!best || hit.dist < best.dist) best = { edge: i, ...hit };
    }
  }
  return best;
}

/**
 * Convierte las aristas curvas en muchos puntos rectos (aproxima cada
 * cúbica con `steps` segmentos), para poder rasterizar el polígono con
 * curvas en la rejilla de vóxeles.
 */
export function flattenPolygon(poly: Polygon, steps = 16): Polygon {
  const n = poly.length;
  if (n < 3) return poly.map((p) => ({ x: p.x, y: p.y }));
  const out: Polygon = [{ x: poly[0].x, y: poly[0].y }];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p = poly[i];
    const q = poly[j];
    const c1 = p.hOut ?? p;
    const c2 = q.hIn ?? q;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push({
        x: u * u * u * p.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * q.x,
        y: u * u * u * p.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * q.y,
      });
    }
  }
  return out;
}

export function polygonArea(poly: Polygon): number {
  if (poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y;
    area -= poly[j].x * poly[i].y;
  }
  return Math.abs(area / 2);
}

export function isClockwise(poly: Polygon): boolean {
  if (poly.length < 3) return false;
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    sum += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
  }
  return sum > 0;
}

export function pointInPolygon(p: Point2D, poly: Polygon): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function normalizePolygon(poly: Polygon): Polygon {
  if (poly.length === 0) return [];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  return poly.map((p) => {
    const out: Point2D = {
      x: (p.x - minX) / w,
      y: (p.y - minY) / h,
    };
    // Las asas son coordenadas absolutas: se transforman igual que el vértice
    if (p.hIn) out.hIn = { x: (p.hIn.x - minX) / w, y: (p.hIn.y - minY) / h };
    if (p.hOut) out.hOut = { x: (p.hOut.x - minX) / w, y: (p.hOut.y - minY) / h };
    return out;
  });
}

/** Rango [mínimo, máximo] de la coordenada y de los puntos del polígono */
export function polygonYRange(poly: Point2D[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    if (p.y < lo) lo = p.y;
    if (p.y > hi) hi = p.y;
  }
  return [lo, hi];
}

/**
 * Dada una pila de secciones (con `y` en 0..1, coordenada de modelo),
 * devuelve la sección interpolada a la altura `y`. Si `y` queda fuera
 * del rango, devuelve la primera o la última. Resamplea todas las
 * plantillas al mismo número de vértices para poder interpolar 1:1.
 */
export function interpolateSection(
  sections: Section[],
  y: number,
  targetN: number
): Point2D[] {
  if (sections.length === 0) return [];
  const sorted = [...sections].sort((a, b) => a.y - b.y);
  const ys = sorted.map((s) => s.y);
  const lo = ys[0];
  const hi = ys[ys.length - 1];
  const yc = Math.max(lo, Math.min(hi, y));

  // Localizar el tramo
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1].y < yc) i++;
  const a = sorted[i];
  const b = sorted[Math.min(sorted.length - 1, i + 1)];
  const t = b.y - a.y > 1e-9 ? (yc - a.y) / (b.y - a.y) : 0;

  // Resamplear ambas al mismo número de vértices
  const pa = resampleClosed(a.polygon, targetN);
  const pb = resampleClosed(b.polygon, targetN);

  // Interpolar
  const out: Point2D[] = [];
  for (let k = 0; k < targetN; k++) {
    out.push({
      x: pa[k].x + (pb[k].x - pa[k].x) * t,
      y: pa[k].y + (pb[k].y - pa[k].y) * t,
    });
  }
  return out;
}

/**
 * Remuestrea un polígono cerrado a `n` puntos uniformes por longitud de
 * arco. Ancla en el vértice de menor (x, y) para que la interpolación
 * entre secciones no retuerza los muros.
 */
export function resampleClosed(poly: Polygon, n: number): Point2D[] {
  const m = poly.length;
  if (m < 3 || n < 3) return poly.map((p) => ({ x: p.x, y: p.y }));
  // Índice inicial: el de menor (x, y)
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
  if (total <= 0) return poly.map((p) => ({ x: p.x, y: p.y }));
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

/**
 * Intervalos [min, max] del interior del polígono a la altura y (regla
 * par-impar, igual que pointInPolygon). Devuelve pares ordenados.
 */
export function scanlineIntervalsAtY(
  poly: Point2D[],
  y: number
): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a.y === b.y) continue;
    if (a.y > y !== b.y > y) {
      xs.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
    }
  }
  if (xs.length < 2) return [];
  xs.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}

export function rasterizePolygon(
  poly: Polygon,
  resolution: number
): boolean[][] {
  const grid: boolean[][] = Array.from({ length: resolution }, () =>
    Array(resolution).fill(false)
  );
  if (poly.length < 3) return grid;

  // Rasterizado por líneas de barrido (even-odd, igual que pointInPolygon):
  // mucho más rápido que probar cada celda suelta, clave para reconstruir
  // en alta resolución con curvas
  for (let j = 0; j < resolution; j++) {
    const py = (j + 0.5) / resolution;
    for (const [xa, xb] of scanlineIntervalsAtY(poly, py)) {
      // Centro de celda dentro de [xIzq, xDer] (como pointInPolygon:
      // inclusive a la izquierda, exclusivo a la derecha)
      const i0 = Math.max(0, Math.ceil(xa * resolution - 0.5));
      const i1 = Math.min(
        resolution - 1,
        Math.ceil(xb * resolution - 0.5) - 1
      );
      for (let i = i0; i <= i1; i++) grid[i][j] = true;
    }
  }
  return grid;
}

/**
 * Sólido de vóxeles reconstruido a partir de las tres vistas: el vóxel
 * (x, y, z) pertenece al objeto si las tres vistas lo admiten a la
 * altura correspondiente.
 */
export type VoxelSolid = {
  /** voxels[x][y][z], con y creciendo hacia arriba */
  voxels: boolean[][][];
  /**
   * Rango en Y del espacio modelo que cubre la rejilla vertical. Las
   * curvas del Frente o del Costado pueden sobresalir del bbox de los
   * vértices (curvar las dos esquinas de arriba levanta el borde por
   * encima de la línea de vértices), así que el objeto puede medir más
   * de 2 en altura; sin curvas es exactamente [-1, 1].
   */
  yModel: [number, number];
};

export function reconstructVoxels(
  views: Views,
  resolution: number,
  sections?: Section[]
): VoxelSolid {
  // Se aplanan las curvas antes de rasterizar para que los vóxeles
  // reflejen también las esquinas redondeadas; el muestreo escala con la
  // resolución para que las curvas no pierdan detalle en rejillas finas.
  const curveSteps = Math.max(16, resolution);
  const frontPoly = flattenPolygon(normalizePolygon(views.front), curveSteps);
  const sidePoly = flattenPolygon(normalizePolygon(views.side), curveSteps);
  const topPolyFlat = flattenPolygon(normalizePolygon(views.top), curveSteps);
  const top = rasterizePolygon(topPolyFlat, resolution);

  // Si vienen secciones, preparar la interpolación una sola vez. Las
  // plantillas con esquinas curvadas (asas) se aplanan aquí para que la
  // interpolación siga las curvas dibujadas; sin asas no cambia nada.
  const useSections = Array.isArray(sections) && sections.length >= 2;
  const sectionsSorted = useSections
    ? [...sections!]
        .sort((a, b) => a.y - b.y)
        .map((s) =>
          s.polygon.some((p) => p.hIn || p.hOut)
            ? { ...s, polygon: flattenPolygon(s.polygon, curveSteps) }
            : s
        )
    : [];
  const sectionsTargetN = useSections
    ? Math.max(...sectionsSorted.map((s) => s.polygon.length))
    : 0;
  const sectionsYLo = useSections ? sectionsSorted[0].y : 0;
  const sectionsYHi = useSections
    ? sectionsSorted[sectionsSorted.length - 1].y
    : 1;

  // Rango real en Y de las plantillas: las curvas pueden sobresalir del
  // bbox de los vértices, así que se mide sobre las polilíneas aplanadas.
  // Cada vista manda en su dirección: donde la curva de una vista sobresale
  // de la altura de la otra, la otra NO recorta (usa su último intervalo
  // definido). Así el borde curvado del Frente levanta la cara superior
  // aunque el Costado sea plano (y al revés). Con polígonos sin curvas los
  // rangos coinciden con [0, 1] y no cambia nada.
  const [fLo, fHi] = polygonYRange(frontPoly);
  const [sLo, sHi] = polygonYRange(sidePoly);
  const yLo = Math.min(fLo, sLo);
  const yHi = Math.max(fHi, sHi);
  const span = Math.max(1e-6, yHi - yLo);

  // Vóxeles: el índice y=0 es el de abajo del espacio modelo, que en el
  // lienzo (y hacia abajo) es la altura yc mayor
  const voxels: boolean[][][] = Array.from({ length: resolution }, () =>
    Array.from({ length: resolution }, () => Array(resolution).fill(false))
  );

  // Máscara 1D de una vista a la altura yc: celdas cubiertas por la
  // polilínea (misma regla de celdas que rasterizePolygon)
  const rowMask = (poly: Point2D[], yc: number): boolean[] => {
    const m: boolean[] = Array(resolution).fill(false);
    for (const [xa, xb] of scanlineIntervalsAtY(poly, yc)) {
      const i0 = Math.max(0, Math.ceil(xa * resolution - 0.5));
      const i1 = Math.min(
        resolution - 1,
        Math.ceil(xb * resolution - 0.5) - 1
      );
      for (let i = i0; i <= i1; i++) m[i] = true;
    }
    return m;
  };

  for (let y = 0; y < resolution; y++) {
    const yc = yHi - ((y + 0.5) * span) / resolution;
    const fy = Math.max(fLo, Math.min(fHi, yc));
    const sy = Math.max(sLo, Math.min(sHi, yc));
    const xr = scanlineIntervalsAtY(frontPoly, fy);
    const zr = scanlineIntervalsAtY(sidePoly, sy);
    if (xr.length === 0 || zr.length === 0) continue;

    if (xr.length === 1 && zr.length === 1) {
      const [x0, x1] = xr[0];
      const [z0, z1] = zr[0];
      const kx = x1 - x0;
      const kz = z1 - z0;
      if (kx < 1e-9 || kz < 1e-9) continue;

      // Si hay secciones, usamos la sección interpolada a esta altura;
      // si no, la vista Superior escalada a la caja (comportamiento
      // clásico de las tres vistas).
      let contour: Point2D[];
      if (useSections) {
        // Altura en coordenadas de modelo (0 abajo, 1 arriba)
        const yModel = 1 - yc;              // yc va de yHi a yLo en lienzo
        const yy = Math.max(
          sectionsYLo,
          Math.min(sectionsYHi, yModel)
        );
        contour = interpolateSection(
          sectionsSorted,
          yy,
          sectionsTargetN
        );
        // La sección viene en X·Z (0..1). Escalar al tamaño de la caja
        // que permiten Frente y Costado a esta altura.
        contour = contour.map((q) => ({
          x: x0 + q.x * kx,
          y: z0 + q.y * kz,
        }));
      } else {
        contour = topPolyFlat.map((q) => ({
          x: x0 + q.x * kx,
          y: z0 + q.y * kz,
        }));
      }

      for (let z = 0; z < resolution; z++) {
        const zc = (z + 0.5) / resolution;
        for (const [xa, xb] of scanlineIntervalsAtY(contour, zc)) {
          const i0 = Math.max(0, Math.ceil(xa * resolution - 0.5));
          const i1 = Math.min(
            resolution - 1,
            Math.ceil(xb * resolution - 0.5) - 1
          );
          for (let i = i0; i <= i1; i++) voxels[i][y][z] = true;
        }
      }
    } else {
      // Perfil no convexo a esta altura (varios intervalos): se cae a
      // la intersección clásica, que maneja las piezas por separado
      const fr = rowMask(frontPoly, fy);
      const sr = rowMask(sidePoly, sy);

      // Máscara de la sección a esta altura (si hay secciones)
      let sectionMask: boolean[][] | null = null;
      if (useSections) {
        const yModel = 1 - yc;
        const yy = Math.max(sectionsYLo, Math.min(sectionsYHi, yModel));
        const contour = interpolateSection(sectionsSorted, yy, sectionsTargetN);
        // Contorno en X·Z (0..1): rasterizamos a la resolución
        sectionMask = Array.from({ length: resolution }, () =>
          Array(resolution).fill(false)
        );
        for (let z = 0; z < resolution; z++) {
          const zc = (z + 0.5) / resolution;
          for (const [xa, xb] of scanlineIntervalsAtY(contour, zc)) {
            const i0 = Math.max(0, Math.ceil(xa * resolution - 0.5));
            const i1 = Math.min(
              resolution - 1,
              Math.ceil(xb * resolution - 0.5) - 1
            );
            for (let i = i0; i <= i1; i++) sectionMask[i][z] = true;
          }
        }
      }

      for (let x = 0; x < resolution; x++) {
        if (!fr[x]) continue;
        for (let z = 0; z < resolution; z++) {
          if (!sr[z]) continue;
          if (sectionMask ? sectionMask[x][z] : top[x][z]) {
            voxels[x][y][z] = true;
          }
        }
      }
    }
  }
  return { voxels, yModel: [1 - 2 * yHi, 1 - 2 * yLo] };
}

export function voxelsToMesh(
  voxels: boolean[][][],
  resolution: number
): Mesh {
  const half = resolution / 2;
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const idx = (x: number, y: number, z: number) =>
    x * resolution * resolution + y * resolution + z;

  for (let x = 0; x < resolution; x++) {
    for (let y = 0; y < resolution; y++) {
      for (let z = 0; z < resolution; z++) {
        if (!voxels[x][y][z]) continue;
        const fx = x - half;
        const fy = y - half;
        const fz = z - half;
        vertices.push({ x: fx, y: fy, z: fz });

        // Cara superior (faceUp)
        if (y < resolution - 1) {
          faces.push([idx(x, y, z), idx(x + 1, y, z), idx(x + 1, y + 1, z), idx(x, y + 1, z)]);
        }
        // Cara inferior (faceDown)
        if (y > 0) {
          faces.push([idx(x, y, z), idx(x + 1, y, z), idx(x + 1, y - 1, z), idx(x, y - 1, z)]);
        }
        // Cara derecha (faceRight)
        if (x < resolution - 1) {
          faces.push([idx(x, y, z), idx(x, y + 1, z), idx(x + 1, y + 1, z), idx(x + 1, y, z)]);
        }
        // Cara izquierda (faceLeft)
        if (x > 0) {
          faces.push([idx(x, y, z), idx(x - 1, y, z), idx(x - 1, y + 1, z), idx(x, y + 1, z)]);
        }
        // Cara frontal (faceFront)
        if (z < resolution - 1) {
          faces.push([idx(x, y, z), idx(x + 1, y, z), idx(x + 1, y + 1, z + 1), idx(x, y + 1, z + 1)]);
        }
        // Cara trasera (faceBack)
        if (z > 0) {
          faces.push([idx(x, y, z), idx(x, y + 1, z), idx(x + 1, y + 1, z), idx(x + 1, y, z)]);
        }
      }
    }
  }

  return { vertices, faces };
}

export function voxelsToBoxMesh(
  voxels: boolean[][][],
  resolution: number,
  _greedy = false,
  yModel: [number, number] = [-1, 1]
): Mesh {
  const half = resolution / 2;
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const vertexMap = new Map<string, number>();
  const vertex = (x: number, y: number, z: number) => {
    const key = `${x},${y},${z}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const index = vertices.length;
    vertices.push({
      x: (x - half) / half,
      y: yModel[0] + (y / resolution) * (yModel[1] - yModel[0]),
      z: (z - half) / half,
    });
    vertexMap.set(key, index);
    return index;
  };
  const filled = (x: number, y: number, z: number) =>
    x >= 0 && x < resolution && y >= 0 && y < resolution && z >= 0 && z < resolution && voxels[x][y][z];
  const addFace = (corners: [number, number, number][]) => {
    faces.push(corners.map(([x, y, z]) => vertex(x, y, z)));
  };

  for (let x = 0; x < resolution; x++) {
    for (let y = 0; y < resolution; y++) {
      for (let z = 0; z < resolution; z++) {
        if (!voxels[x][y][z]) continue;
        const px = x + 1;
        const py = y + 1;
        const pz = z + 1;
        if (!filled(x + 1, y, z)) addFace([[px, y, z], [px, py, z], [px, py, pz], [px, y, pz]]);
        if (!filled(x - 1, y, z)) addFace([[x, y, z], [x, y, pz], [x, py, pz], [x, py, z]]);
        if (!filled(x, y + 1, z)) addFace([[x, py, z], [x, py, pz], [px, py, pz], [px, py, z]]);
        if (!filled(x, y - 1, z)) addFace([[x, y, z], [px, y, z], [px, y, pz], [x, y, pz]]);
        if (!filled(x, y, z + 1)) addFace([[x, y, pz], [px, y, pz], [px, py, pz], [x, py, pz]]);
        if (!filled(x, y, z - 1)) addFace([[x, y, z], [x, py, z], [px, py, z], [px, y, z]]);
      }
    }
  }
  return { vertices, faces };
}

export function meshToTriangles(mesh: Mesh): Mesh {
  const faces: number[][] = [];
  // faceColors viene 1:1 con las caras ORIGINALES: al partir cada
  // polígono en triángulos hay que duplicar también su color, o el
  // visor (que exige faceColors.length === faces.length) descarta
  // todos los colores — p. ej. los de las fuentes de color en el
  // texto 3D en modo vóxeles.
  const outColors: (string | null)[] | undefined = mesh.faceColors ? [] : undefined;
  // Igual que los colores, la opacidad está alineada con las caras
  // originales. Un lateral cuadrado se divide en dos triángulos, que
  // deben conservar la misma opacidad para que el control de costados
  // siga funcionando en el visor.
  const outOpacities: number[] | undefined = mesh.faceOpacities ? [] : undefined;
  mesh.faces.forEach((face, faceIdx) => {
    for (let i = 1; i < face.length - 1; i++) {
      faces.push([face[0], face[i], face[i + 1]]);
      outColors?.push(mesh.faceColors![faceIdx] ?? null);
      outOpacities?.push(mesh.faceOpacities![faceIdx] ?? 1);
    }
  });

  const out: Mesh = { ...mesh, faces };
  if (outColors) out.faceColors = outColors;
  if (outOpacities) out.faceOpacities = outOpacities;
  if (mesh.opacity !== undefined) {
    out.opacity = mesh.opacity;
  }
  return out;
}


export const DEFAULT_VIEWS: Views = {
  front: [
    { x: 0.5, y: 0.85 },     // Pico superior
    { x: 0.1, y: 0.1 },      // Esquina inferior izquierda
    { x: 0.9, y: 0.1 },      // Esquina inferior derecha
  ],
  side: [
    { x: 0.5, y: 0.85 },     // Pico superior
    { x: 0.1, y: 0.1 },      // Esquina inferior izquierda
    { x: 0.9, y: 0.1 },      // Esquina inferior derecha
  ],
  top: [
    { x: 0.5, y: 0.85 },     // Punta superior
    { x: 0.62, y: 0.55 },    // Valle superior derecho
    { x: 0.9, y: 0.55 },     // Punta derecha
    { x: 0.68, y: 0.35 },    // Valle derecho
    { x: 0.78, y: 0.05 },    // Punta inferior derecha
    { x: 0.5, y: 0.25 },     // Valle inferior
    { x: 0.22, y: 0.05 },    // Punta inferior izquierda
    { x: 0.32, y: 0.35 },    // Valle izquierdo
    { x: 0.1, y: 0.55 },     // Punta izquierda
    { x: 0.38, y: 0.55 },    // Valle superior izquierdo
  ],
};

/**
 * Genera un mesh de revolución a partir de un perfil
 * @param profile - Puntos del perfil (x = distancia al eje, y = altura)
 * @param segments - Número de segmentos de rotación
 * @param clamp - Cerrar los extremos (true) o dejarlos abiertos (false)
 */
export function buildLatheMesh(
  profile: Polygon,
  segments: number = 32,
  clamp: boolean = true,
  textureProjection: LatheTextureProjection = 'cylindrical'
): Mesh {
  if (profile.length < 3) return { vertices: [], faces: [] };

  const safeSegments = Math.max(3, Math.round(Number.isFinite(segments) ? segments : 32));
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const colors: string[] = [];

  // El perfil del torno es una polilínea de sección radial. Hay que conservar
  // el orden dibujado: una "L" necesita que su segundo tramo genere la pared
  // interior del vaso, no que los puntos se reordenen por altura.
  const normalized = [...profile];
  if (
    normalized.length > 1 &&
    normalized[0].x === normalized[normalized.length - 1].x &&
    normalized[0].y === normalized[normalized.length - 1].y
  ) {
    normalized.pop();
  }

  const curvedProfile: Point2D[] = [];
  const curveSteps = 16;
  for (let i = 0; i < normalized.length; i++) {
    const point = normalized[i];
    if (i === 0) curvedProfile.push({ x: point.x, y: point.y });
    if (i >= normalized.length - 1) continue;
    const next = normalized[i + 1];
    const c1 = point.hOut ?? point;
    const c2 = next.hIn ?? next;
    for (let step = 1; step <= curveSteps; step++) {
      const t = step / curveSteps;
      const inverse = 1 - t;
      curvedProfile.push({
        x:
          inverse * inverse * inverse * point.x +
          3 * inverse * inverse * t * c1.x +
          3 * inverse * t * t * c2.x +
          t * t * t * next.x,
        y:
          inverse * inverse * inverse * point.y +
          3 * inverse * inverse * t * c1.y +
          3 * inverse * t * t * c2.y +
          t * t * t * next.y,
      });
    }
  }

  const safeProfile = curvedProfile.map((p) => {
    const screenY = Number(p.y.toFixed(6));
    // El editor del perfil dibuja Y hacia abajo. En el torno, la altura de
    // la pieza debe ir en coordenadas de mundo (arriba = valor mayor). La
    // inversión evita que arrastrar la esquina superior izquierda mueva la
    // inferior izquierda como si la plantilla estuviera al revés.
    const y = 1 - screenY;
    const x = Math.max(0.01, Number.isFinite(p.x) ? p.x : 0.01);
    return { x, y };
  });

  if (safeProfile.length < 2) return { vertices: [], faces: [] };

  // Generar vértices: para cada punto del perfil, crear 'segments' vértices alrededor
  for (let i = 0; i < safeProfile.length; i++) {
    const p = safeProfile[i];
    for (let j = 0; j < safeSegments; j++) {
      const theta = (j / safeSegments) * Math.PI * 2;
      const x = p.x * Math.cos(theta);
      const z = p.x * Math.sin(theta);
      vertices.push({ x, y: p.y, z });
    }
  }

  // Generar caras (cuadriláteros entre puntos adyacentes)
  for (let i = 0; i < safeProfile.length - 1; i++) {
    for (let j = 0; j < safeSegments; j++) {
      const jNext = (j + 1) % safeSegments;
      const idx = i * safeSegments + j;
      const idxNext = i * safeSegments + jNext;
      const idxBelow = (i + 1) * safeSegments + j;
      const idxBelowNext = (i + 1) * safeSegments + jNext;

      // Crear dos triángulos por cuadrilátero
      faces.push([idx, idxNext, idxBelow]);
      faces.push([idxNext, idxBelowNext, idxBelow]);
    }
  }

  // Cerrar extremos (tapas)
  const axisEpsilon = 0.06;
  const topProfile = safeProfile[safeProfile.length - 1];
  const bottomProfile = safeProfile[0];

  if (clamp && topProfile.x <= axisEpsilon) {
    // Solo cerrar si el extremo del perfil realmente toca el eje.
    const topIdx = (safeProfile.length - 1) * safeSegments;
    const centerTopIdx = vertices.length;
    vertices.push({ x: 0, y: topProfile.y, z: 0 });
    for (let j = 0; j < safeSegments; j++) {
      const jNext = (j + 1) % safeSegments;
      faces.push([centerTopIdx, topIdx + j, topIdx + jNext]);
    }

  }

  if (clamp && bottomProfile.x <= axisEpsilon) {
    const bottomIdx = 0;
    const centerBottomIdx = vertices.length;
    vertices.push({ x: 0, y: bottomProfile.y, z: 0 });
    for (let j = 0; j < safeSegments; j++) {
      const jNext = (j + 1) % safeSegments;
      faces.push([centerBottomIdx, bottomIdx + jNext, bottomIdx + j]);
    }
  }

  const minY = Math.min(...vertices.map((vertex) => vertex.y));
  const maxY = Math.max(...vertices.map((vertex) => vertex.y));
  const height = Math.max(1e-6, maxY - minY);
  const maxRadius = Math.max(
    1e-6,
    ...vertices.map((vertex) => Math.hypot(vertex.x, vertex.z))
  );
  const uvs: [number, number][] = vertices.map((vertex) => {
    const angle = Math.atan2(vertex.z, vertex.x);
    const cylindricalU = (angle / (Math.PI * 2) + 1) % 1;
    const planarU = (vertex.x / maxRadius + 1) / 2;
    const v = (vertex.y - minY) / height;

    if (textureProjection === 'planar') return [planarU, v];
    if (textureProjection === 'spherical') {
      const radius = Math.max(1e-6, Math.hypot(vertex.x, vertex.y, vertex.z));
      return [cylindricalU, 1 - Math.acos(vertex.y / radius) / Math.PI];
    }
    return [cylindricalU, v];
  });

  return { vertices, faces, faceColors: colors, uvs };
}

/**
 * Rotación de un polígono 2D en 3D usando matrices de rotación.
 * Primero se proyectan los puntos 2D a 3D (asumiendo que están en el plano XY),
 * luego se rotan, y finalmente se proyectan de nuevo a 2D.
 */
export function rotatePolygon(
  poly: Polygon,
  x: number,
  y: number,
  z: number
): Polygon {
  if (poly.length === 0) return [];

  const center = { x: 0.5, y: 0.5, z: 0 };

  const rotatePoint = (point: { x: number; y: number; z: number }) => {
    const xRotated = {
      x: point.x * Math.cos(x) + point.z * Math.sin(x),
      y: point.y,
      z: point.z * Math.cos(x) - point.x * Math.sin(x),
    };
    const yRotated = {
      x: xRotated.x * Math.cos(y) + xRotated.z * Math.sin(y),
      y: xRotated.y,
      z: xRotated.z * Math.cos(y) - xRotated.x * Math.sin(y),
    };
    return {
      x: yRotated.x * Math.cos(z) - yRotated.y * Math.sin(z) + center.x,
      y: yRotated.x * Math.sin(z) + yRotated.y * Math.cos(z) + center.y,
      z: yRotated.z,
    };
  };

  const rotatePoint2D = (point: Handle2D): Handle2D => {
    const rotated = rotatePoint({ x: point.x - center.x, y: point.y - center.y, z: 0 });
    return { x: rotated.x, y: rotated.y };
  };

  return poly.map(point => ({
    ...rotatePoint2D(point),
    ...(point.hIn ? { hIn: rotatePoint2D(point.hIn) } : {}),
    ...(point.hOut ? { hOut: rotatePoint2D(point.hOut) } : {}),
  }));
}
