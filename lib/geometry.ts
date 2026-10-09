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

/**
 * Agujero (calado) para extrusión/recorrido: el polígono a sustraer y,
 * de forma opcional, su profundidad.
 *
 * - `depth` ausente o <= 0 → calado pasante (de lado a lado).
 * - `depth` > 0 → calado ciego: socava esa profundidad desde la cara
 *   delantera (extrusión) o desde el inicio del recorrido (barrido).
 */
export type Hole = { polygon: Polygon; depth?: number };

/** Un agujero puede darse como polígono suelto (pasante) o como `Hole`. */
export type HoleSpec = Polygon | Hole;

/** Polígono de un agujero, sea `Polygon` o `Hole`. */
export function holePolygon(h: HoleSpec): Polygon {
  return Array.isArray(h) ? h : h.polygon;
}

/** Profundidad de un agujero (0 = pasante). */
export function holeDepth(h: HoleSpec): number {
  return Array.isArray(h) ? 0 : h.depth ?? 0;
}

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
   * Textura (data URL o URL) por cara, alineada con `faces`. null o
   * ausente = esa cara usa el material general del objeto.
   */
  faceTextures?: (string | null)[];
  /**
   * Textura PNG (data URL) para el modo "vista plana": reproduce la
   * apariencia exacta del texto renderizado en pantalla.
   */
  texture?: string;
  /**
   * La textura actual la puso el panel de la escena (no está horneada en
   * la figura): al quitar la del panel debe eliminarse de la malla. En
   * los textos el trazo de la fuente va horneado en `texture`; sin esta
   * marca no se puede distinguir de una imagen aplicada después.
   */
  texturePanela?: boolean;
  /** Textura horneada original que el panel sustituyó (textos). */
  textureOriginal?: string;
  /** Color configurado para teñir la textura sin sustituirla. */
  textureColor?: string;
   /** Intensidad del relieve de la textura (0 = plano). */
   textureRelief?: number;
   /**
    * Textura dedicada SOLO al relieve (data URL): si está presente, el
    * relieve sale de ella y la textura normal queda solo con el color.
    */
   bumpTexture?: string;
   /**
    * Veces que se repite la textura de relieve. Ausente = usa la misma
    * repetición que `textureRepeat`.
    */
   bumpTextureRepeat?: number;
   /**
    * Veces que se repite la textura de relieve en VERTICAL. Ausente =
    * igual que `bumpTextureRepeat` en ambos ejes (que a su vez puede
    * seguir la repetición de la textura normal).
    */
   bumpTextureRepeatY?: number;
   /** Número de veces que se repite la textura (1 = sin repetición). */
   textureRepeat?: number;
   /**
    * Veces que se repite la textura en VERTICAL (horizontal =
    * `textureRepeat`). Ausente = misma repetición en ambos ejes.
    */
   textureRepeatY?: number;
  /** Acabado de la superficie texturizada. */
  textureFinish?: TextureFinish;
  /** Si la guía de textura está visible para este objeto. */
  textureHelper?: boolean;
  /** Transform de la guía de textura para este objeto. */
  textureHelperTransform?: ObjectTransform;
  /**
   * Coordenadas UV por vértice (alineadas con `vertices`), para mapear
   * la textura. Si está ausente, el visor no aplica textura.
   */
  uvs?: [number, number][];
  /**
   * Identificador de GRUPO de asignación por cara, alineado con `faces`.
   * Cada «Asignar textura» estampa un id nuevo: las caras del mismo grupo
   * comparten UNA caja de UV (la imagen completa estirada en esa
   * selección) y dos asignaciones distintas —incluso con la misma
   * imagen— no se reescalan entre sí. Ausente o null = las caras se
   * reparten la caja global de siempre (mallas y caras de antes).
   */
  faceTextureGroups?: (string | null)[];
  /**
   * Opacidad global del material (0..1, 1 = sólido). Solo la usa el
   * visor cuando la malla lleva textura.
   */
  opacity?: number;
  /**
   * Parámetros de una textura CREADA (Crea texturas) aplicada a la malla:
   * el visor los usa para montar el MISMO material físico que la vista
   * previa 3D (transmisión en cristal/agua, metalidad, barniz…). Ausente
   * = material normal por acabado.
   */
  textureMaterialParams?: TextureMaterialParams;
};

/** Tipo de una textura creada (igual que `TextureType` en types/index.ts). */
export type CreatedTextureType =
  | 'glass'
  | 'water'
  | 'wood'
  | 'metal'
  | 'concrete'
  | 'plastic';

/**
 * Ajustes físicos de una textura creada tal como los muestra la vista
 * previa: se guardan en la malla al aplicarla para que el material del
 * objeto coincida con lo que se ve en la previsualización.
 */
export type TextureMaterialParams = {
  type: CreatedTextureType;
  /** Color hex de la textura ('#rrggbb'). */
  color: string;
  /** Opacidad 0..1. */
  opacity: number;
  /** Rugosidad 0..1. */
  roughness: number;
};

/** Contador de asignaciones de textura: cada «Asignar» lleva id nuevo. */
let contadorGruposTextura = 0;
export function nuevoGrupoTextura(): string {
  contadorGruposTextura += 1;
  return `tg${contadorGruposTextura.toString(36)}${Date.now().toString(36)}`;
}

/** Estampa el id de esta asignación solo en las caras indicadas. */
export function estamparGrupoTextura(
  grupos: (string | null)[],
  caras: number[],
  id: string,
): (string | null)[] {
  const resultado = [...grupos];
  for (const cara of caras) {
    if (cara < 0 || cara >= resultado.length) continue;
    resultado[cara] = id;
  }
  return resultado;
}

export type LatheTextureProjection = 'planar' | 'cylindrical' | 'spherical';
export type TextureFinish = 'glossy' | 'semi-matte' | 'matte' | 'mirror' | 'metallic';

export type ObjectTransform = {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
};

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
 * Área con signo (shoelace) de un polígono cerrado. Positiva = recorrido
 * horario en pantalla (el lienzo tiene y hacia abajo), que es el sentido
 * de las plantillas predefinidas.
 */
function polygonSignedArea(poly: Point2D[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/**
 * Dada una pila de secciones (con `y` en 0..1, coordenada de modelo),
 * devuelve la sección interpolada a la altura `y`. Si `y` queda fuera
 * del rango, devuelve la primera o la última. Resamplea todas las
 * plantillas al mismo número de vértices para poder interpolar 1:1.
 *
 * Antes de emparejar, además del ancla (el vértice más abajo), se alinea
 * el SENTIDO de recorrido: las plantillas de los botones y las editadas
 * arrastrando vértices van todas en el mismo sentido, pero una dibujada a
 * mano puede quedar guardada al revés. Si los sentidos no coinciden, el
 * emparejamiento 1:1 avanza en direcciones opuestas, la mezcla se cruza
 * (papiroflexia) y el objeto sale retorcido. Se pone cada plantilla en
 * el sentido de las predefinidas (horario en pantalla) antes de
 * remuestrear; para las que ya van bien esto no cambia nada.
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

  // Sentido de recorrido común (mismo criterio para todas las alturas, así
  // el emparejamiento no se voltea al pasar por una plantilla rara)
  const canonical = (poly: Polygon): Polygon => {
    const pts = poly.map((p) => ({ x: p.x, y: p.y }));
    return polygonSignedArea(pts) < 0 ? pts.reverse() : pts;
  };

  // Resamplear ambas al mismo número de vértices
  const pa = resampleClosed(canonical(a.polygon), targetN);
  const pb = resampleClosed(canonical(b.polygon), targetN);

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
 * arco. Ancla en el vértice MÁS ABAJO (y a igualdad de altura, el más a
 * la derecha) para que la interpolación entre secciones no retuerza los
 * muros: así una plantilla girada (p. ej. un cuadrado puesto en rombo)
 * empareja cada esquina con la esquina de la otra que le toca en su
 * mismo sector, en vez de dar una vuelta y enroscar la figura.
 */
export function resampleClosed(poly: Polygon, n: number): Point2D[] {
  const m = poly.length;
  if (m < 3 || n < 3) return poly.map((p) => ({ x: p.x, y: p.y }));
  // Índice inicial: el de más abajo (y a igualdad, el de más a la derecha)
  let s = 0;
  for (let i = 1; i < m; i++) {
    if (
      poly[i].y > poly[s].y + 1e-12 ||
      (Math.abs(poly[i].y - poly[s].y) <= 1e-12 && poly[i].x > poly[s].x + 1e-12)
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
  // Además cada plantilla se estira a su PROPIO bbox (0..1): la plantilla
  // manda en la FORMA del corte, no en el tamaño, y así al escalarla a la
  // caja que permiten el Frente y el Costado ocupa EXACTAMENTE ese ancho
  // y ese fondo (igual que la vista Superior). Una plantilla dibujada
  // grande no se sale de la silueta y una chica no deja el cuerpo flaco.
  const useSections = Array.isArray(sections) && sections.length >= 2;
  const sectionsSorted = useSections
    ? [...sections!]
        .sort((a, b) => a.y - b.y)
        .map((s) => {
          let poly = s.polygon;
          if (poly.some((p) => p.hIn || p.hOut)) {
            poly = flattenPolygon(poly, curveSteps);
          }
          return { ...s, polygon: normalizePolygon(poly) };
        })
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

/**
 * Voxeliza la SUPERFICIE de una malla arbitraria: encaja la caja envolvente
 * del objeto en una rejilla cúbica y marca los vóxeles que toca cada
 * triángulo (muestreo barycéntrico denso). El resultado alimenta
 * voxelsToBoxMesh para «mostrar como voxeles» una figura que no nació de
 * vistas 2D. El vóxel (0,0,0) es la esquina mínima; la malla sale centrada.
 */
export function meshToVoxels(
  mesh: Mesh,
  resolution: number = 24
): { voxels: boolean[][][]; resolution: number } {
  const empty = { voxels: [] as boolean[][][], resolution: 0 };
  if (!mesh.vertices.length || !mesh.faces.length || resolution < 2) return empty;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of mesh.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }
  // La rejilla es cúbica: el eje más largo manda y los otros centrados.
  const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
  const size = Math.max(spanX, spanY, spanZ);
  if (size <= 1e-9) return empty;
  const scale = (resolution - 1) / size;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const voxels: boolean[][][] = Array.from({ length: resolution }, () =>
    Array.from({ length: resolution }, () => Array(resolution).fill(false))
  );
  let marcados = 0;
  const marcar = (x: number, y: number, z: number) => {
    const ix = Math.round((x - cx) * scale + (resolution - 1) / 2);
    const iy = Math.round((y - cy) * scale + (resolution - 1) / 2);
    const iz = Math.round((z - cz) * scale + (resolution - 1) / 2);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= resolution || iy >= resolution || iz >= resolution) return;
    if (!voxels[ix][iy][iz]) { voxels[ix][iy][iz] = true; marcados++; }
  };

  for (const face of mesh.faces) {
    for (let i = 1; i + 1 < face.length; i++) {
      const a = mesh.vertices[face[0]];
      const b = mesh.vertices[face[i]];
      const c = mesh.vertices[face[i + 1]];
      if (!a || !b || !c) continue;
      // Densidad de muestreo: la arista mayor medida en vóxeles.
      const lenAB = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * scale;
      const lenAC = Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z) * scale;
      const lenBC = Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z) * scale;
      const pasos = Math.min(64, Math.max(1, Math.ceil(Math.max(lenAB, lenAC, lenBC) * 1.5)));
      for (let u = 0; u <= pasos; u++) {
        for (let v = 0; v + u <= pasos; v++) {
          const pu = u / pasos;
          const pv = v / pasos;
          const pw = 1 - pu - pv;
          marcar(
            a.x * pw + b.x * pu + c.x * pv,
            a.y * pw + b.y * pu + c.y * pv,
            a.z * pw + b.z * pu + c.z * pv
          );
        }
      }
    }
  }
  if (marcados === 0) return empty;
  return { voxels, resolution };
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

// ==================== ANILLOS DE CARAS ====================
//
// Los objetos del editor (esfera, toroide, tubo, cubo...) se guardan como
// mallas TRIANGULADAS y sin índices compartidos: cada triángulo trae sus
// propios 3 vértices, repetidos en las caras vecinas. Para agrupar
// «anillos» (bandas completas de caras — los meridianos y paralelos de una
// esfera, por ejemplo) se reconstruye primero la TOPOLOGÍA LÓGICA uniendo
// los vértices por posición, después se forman las celdas cuadriláteras —
// pareando triángulos vecinos (.zeus triangulados) o tomando la cara de 4
// lados entera (primitivas de la app) — y por último se recorre la tira de
// celdas que pasa por el borde apuntado.

/** Celda cuadrilátera: dos triángulos pareados por su diagonal, o una cara
 *  de 4 lados entera (mallas con índices compartidos). */
export interface CeldaAnillo {
  /** Caras de la malla que forman la celda (1 o 2). */
  tris: number[];
  /** Bordes lógicos del contorno de la celda (claves «a-b» unificadas). */
  bordes: string[];
  /** Los dos pares de bordes opuestos. El anillo NO cruza los bordes de
   *  su clase bloqueada y sí cruza los de la otra. */
  clases: [string[], string[]];
}

/** Topología de anillos de una malla (ver `construirAnillos`). */
export interface AnillosMalla {
  /** Celda de cada cara (-1 = suelto: casquete de polo, resto). */
  faceACelda: Int32Array;
  celdas: CeldaAnillo[];
  /** Borde lógico → caras que lo tocan (para cruzar de celda en celda). */
  bordeAFaces: Map<string, number[]>;
  /** Posición representativa de cada vértice lógico (para proyectar). */
  canonPos: Vertex3D[];
}

const claveVertAnillo = (v: Vertex3D): string =>
  `${Math.round(v.x * 1e5)}|${Math.round(v.y * 1e5)}|${Math.round(v.z * 1e5)}`;

const claveBordeAnillo = (a: number, b: number): string =>
  a < b ? `${a}-${b}` : `${b}-${a}`;

/**
 * Construye la topología de anillos de la malla: unifica vértices por
 * posición, empareja triángulos vecinos en cuadriláteros y prepara los
 * mapas para recorrer tiras de celdas. Barato (O(n caras)) — se puede
 * llamar en cada revision de hover.
 */
export function construirAnillos(mesh: Mesh): AnillosMalla | null {
  const nFaces = mesh.faces.length;
  if (nFaces === 0) return null;

  // 1. Vértices lógicos: unificar por posición (malla sin índices compartidos).
  const canonDe = new Int32Array(mesh.vertices.length).fill(-1);
  const canonPos: Vertex3D[] = [];
  const canonPorClave = new Map<string, number>();
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    if (!v) continue;
    const clave = claveVertAnillo(v);
    let cid = canonPorClave.get(clave);
    if (cid === undefined) {
      cid = canonPos.length;
      canonPorClave.set(clave, cid);
      canonPos.push({ x: v.x, y: v.y, z: v.z });
    }
    canonDe[i] = cid;
  }

  // 2. Bordes lógicos → caras que los tocan (solo triángulos pareables).
  const bordeAFacesConTri = new Map<string, number[]>();
  const esTri = new Uint8Array(nFaces);
  for (let i = 0; i < nFaces; i++) {
    const face = mesh.faces[i];
    if (!face || face.length !== 3) continue;
    const a = canonDe[face[0]];
    const b = canonDe[face[1]];
    const c = canonDe[face[2]];
    if (a < 0 || b < 0 || c < 0) continue;
    esTri[i] = 1;
    const aristas = [
      [a, b],
      [b, c],
      [c, a],
    ];
    for (const [p, q] of aristas) {
      if (p === q) continue;
      const key = claveBordeAnillo(p, q);
      const lista = bordeAFacesConTri.get(key);
      if (lista) lista.push(i);
      else bordeAFacesConTri.set(key, [i]);
    }
  }

  // 3. Pareo voraz de triángulos: entre los vecinos por cada borde se
  //    prefiere el de normal más parecida (las dos mitades de la MISMA
  //    celda son casi coplanares; las de celdas contiguas ya curvan) y, a
  //    igualdad, el borde compartido más largo (la diagonal de la celda).
  //    Bordes que tocan un vértice de MUCHAS caras (polos de abanico)
  //    no se tratan de diagonal para no encadenar casquetes.
  const incidentes = new Map<number, Set<string>>();
  for (const key of bordeAFacesConTri.keys()) {
    const [pa, qa] = key.split('-').map(Number);
    if (!incidentes.has(pa)) incidentes.set(pa, new Set());
    if (!incidentes.has(qa)) incidentes.set(qa, new Set());
    incidentes.get(pa)!.add(key);
    incidentes.get(qa)!.add(key);
  }

  const normalDe = (fi: number): number[] | null => {
    const face = mesh.faces[fi];
    const a = mesh.vertices[face[0]];
    const b = mesh.vertices[face[1]];
    const c = mesh.vertices[face[2]];
    if (!a || !b || !c) return null;
    const u = [b.x - a.x, b.y - a.y, b.z - a.z];
    const w = [c.x - a.x, c.y - a.y, c.z - a.z];
    const n = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / len, n[1] / len, n[2] / len];
  };

  type Candidato = { t1: number; t2: number; dot: number; len: number };
  const candidatos: Candidato[] = [];
  for (const [key, faces] of bordeAFacesConTri) {
    if (faces.length !== 2) continue;
    const [f1, f2] = faces;
    if (!esTri[f1] || !esTri[f2]) continue;
    const n1 = normalDe(f1);
    const n2 = normalDe(f2);
    if (!n1 || !n2) continue;
    const [pa, qa] = key.split('-').map(Number);
    // Guarda de abanicos: un diagonal real no toca vértices con muchas caras.
    if ((incidentes.get(pa)?.size ?? 0) > 8) continue;
    if ((incidentes.get(qa)?.size ?? 0) > 8) continue;
    const A = canonPos[pa];
    const B = canonPos[qa];
    const len = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
    const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
    candidatos.push({ t1: f1, t2: f2, dot, len });
  }

  // 3a. Vecino por el borde MÁS LARGO de cada triángulo: en un cuadrilátero
  //     la diagonal es el borde más largo de sus dos triángulos (triángulo-
  //     inecuación), así que «el vecino por el borde más largo» se eligen
  //     MUTUAMENTE en la celda real. Resuelve las superficies en regla
  //     (cono, cilindro) donde las normales a lo largo del meridiano son
  //     idénticas y engañan al criterio de coplanaridad.
  const vecinoMasLargo = new Int32Array(nFaces).fill(-1);
  const vecinoMasLargoLen = new Float64Array(nFaces).fill(-1);
  for (const cand of candidatos) {
    if (cand.len > vecinoMasLargoLen[cand.t1]) {
      vecinoMasLargoLen[cand.t1] = cand.len;
      vecinoMasLargo[cand.t1] = cand.t2;
    }
    if (cand.len > vecinoMasLargoLen[cand.t2]) {
      vecinoMasLargoLen[cand.t2] = cand.len;
      vecinoMasLargo[cand.t2] = cand.t1;
    }
  }

  const pareja = new Int32Array(nFaces).fill(-1);

  // 3b. Pareo mutuo primero (la celda real elegida por su diagonal).
  for (let fi = 0; fi < nFaces; fi++) {
    const n = vecinoMasLargo[fi];
    if (n < 0 || n <= fi) continue;
    if (vecinoMasLargo[n] === fi && pareja[fi] < 0 && pareja[n] < 0) {
      pareja[fi] = n;
      pareja[n] = fi;
    }
  }

  // 3c. Resto: voraz por normales más parecidas y, a igualdad, el borde
  //     compartido más largo (la diagonal de la celda).
  candidatos.sort((x, y) => (y.dot !== x.dot ? y.dot - x.dot : y.len - x.len));
  for (const cand of candidatos) {
    if (pareja[cand.t1] < 0 && pareja[cand.t2] < 0) {
      pareja[cand.t1] = cand.t2;
      pareja[cand.t2] = cand.t1;
    }
  }

  // 4. Celdas: contorno (bordes lógicos) y sus dos clases de bordes
  //    opuestos. Hay celdas de dos clases de origen: pares de triángulos
  //    (mallas .zeus trianguladas) y caras de 4 lados enteras (las primitivas
  //    viven de la app ya llegan cuadranguladas, esfera = [a, a+1, b+1, b]).
  const faceACelda = new Int32Array(nFaces).fill(-1);
  const celdas: CeldaAnillo[] = [];

  const extremosDe = (key: string): Set<number> => {
    const [p, q] = key.split('-').map(Number);
    return new Set([p, q]);
  };
  // Clases: parear cada borde con el (los) que NO comparte puntas. Debe
  // quedar 2+2; con otro reparto (cuadriláteros degenerados de polo que
  // pierden la arista p-p) la celda no sirve y la cara queda suelta — el
  // anillo la toca pero no la atraviesa, igual que los casquetes .zeus.
  const clasesDe = (bordes: string[]): [string[], string[]] | null => {
    if (bordes.length !== 4) return null;
    const usados = new Set<number>();
    const clases: [string[], string[]] = [[], []];
    let idxClase = 0;
    for (let i0 = 0; i0 < bordes.length; i0++) {
      if (usados.has(i0)) continue;
      const ext = extremosDe(bordes[i0]);
      usados.add(i0);
      clases[idxClase].push(bordes[i0]);
      for (let j0 = i0 + 1; j0 < bordes.length; j0++) {
        if (usados.has(j0)) continue;
        const ext2 = extremosDe(bordes[j0]);
        let comparten = false;
        for (const eVal of ext2) if (ext.has(eVal)) { comparten = true; break; }
        if (!comparten) {
          clases[idxClase].push(bordes[j0]);
          usados.add(j0);
          break;
        }
      }
      idxClase++;
      if (idxClase === 2) break;
    }
    if (clases[0].length === 0 || clases[1].length === 0) return null;
    return clases;
  };
  // Bordes lógicos de una cara (dedupe de degenerados «p-p»).
  const bordesDeCara = (fi: number): string[] => {
    const face = mesh.faces[fi];
    const out: string[] = [];
    for (let j = 0; j < face.length; j++) {
      const p = canonDe[face[j]];
      const q = canonDe[face[(j + 1) % face.length]];
      if (p < 0 || q < 0 || p === q) continue;
      out.push(claveBordeAnillo(p, q));
    }
    return out;
  };

  // 4a. Pares de triángulos.
  for (let fi = 0; fi < nFaces; fi++) {
    if (pareja[fi] < 0 || pareja[fi] < fi) continue; // cada par una vez
    const fj = pareja[fi];
    const c1 = mesh.faces[fi];
    const c2 = mesh.faces[fj];
    const m1 = new Set(c1.map((v) => canonDe[v]));
    // Bordes de cada triángulo que NO son el compartido.
    const bordesDe = (face: number[]): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      for (let j = 0; j < 3; j++) {
        const p = canonDe[face[j]];
        const q = canonDe[face[(j + 1) % 3]];
        if (m1.has(p) && m1.has(q) && bordeAFacesConTri.has(claveBordeAnillo(p, q))) {
          const lista = bordeAFacesConTri.get(claveBordeAnillo(p, q))!;
          if (lista.includes(fi) && lista.includes(fj)) continue; // diagonal compartida
        }
        out.push([p, q]);
      }
      return out;
    };
    const b1 = bordesDe(c1);
    const b2 = bordesDe(c2);
    if (b1.length !== 2 || b2.length !== 2) continue;
    const todos = [
      ...b1.map((e) => claveBordeAnillo(e[0], e[1])),
      ...b2.map((e) => claveBordeAnillo(e[0], e[1])),
    ];
    const clases = clasesDe(todos);
    if (!clases || clases[0].length !== 2 || clases[1].length !== 2) continue;
    const celda = celdas.length;
    celdas.push({ tris: [fi, fj], bordes: todos, clases });
    faceACelda[fi] = celda;
    faceACelda[fj] = celda;
  }

  // 4b. Caras cuadrilaterales enteras (mallas de la app con índices
  //     compartidos): cada quad es su propia celda. Los bordes que unen dos
  //     vértices en la MISMA posición (la arista degenerada de los polos de
  //     la esfera) no existen topológicamente y no entran.
  for (let fi = 0; fi < nFaces; fi++) {
    if (faceACelda[fi] >= 0) continue;
    const face = mesh.faces[fi];
    if (!face || face.length !== 4) continue;
    const todos = Array.from(new Set(bordesDeCara(fi)));
    const clases = clasesDe(todos);
    if (!clases || clases[0].length !== 2 || clases[1].length !== 2) continue;
    const celda = celdas.length;
    celdas.push({ tris: [fi], bordes: todos, clases });
    faceACelda[fi] = celda;
  }

  // Borde → caras (todas, no solo triángulos) para cruzar en el recorrido.
  const bordeAFaces = new Map<string, number[]>();
  for (let i = 0; i < nFaces; i++) {
    const face = mesh.faces[i];
    if (!face || face.length < 3) continue;
    const canon = face.map((v) => canonDe[v]);
    if (canon.some((v) => v < 0)) continue;
    for (let j = 0; j < face.length; j++) {
      const va = canon[j];
      const vb = canon[(j + 1) % face.length];
      if (va === vb) continue;
      const key = claveBordeAnillo(va, vb);
      const lista = bordeAFaces.get(key);
      if (lista) lista.push(i);
      else bordeAFaces.set(key, [i]);
    }
  }

  return { faceACelda, celdas, bordeAFaces, canonPos };
}

/**
 * Caras del ANILLO que pasa por la celda de `faceIdx`, sin cruzar los
 * bordes de la clase bloqueada (0/1). Los triángulos sueltos que toca el
 * anillo (casquetes de polo) entran pero no se atraviesan.
 */
export function carasAnilloDe(
  malla: AnillosMalla,
  faceIdx: number,
  claseBloqueo: 0 | 1
): number[] | null {
  const celda0 = malla.faceACelda[faceIdx];
  if (celda0 < 0) return null;
  const celdas = malla.celdas;
  const visitadas = new Set<number>([celda0]);
  const caras = new Set<number>();
  for (const t of celdas[celda0].tris) caras.add(t);
  const cola: Array<{ celda: number; clase: 0 | 1 }> = [
    { celda: celda0, clase: claseBloqueo },
  ];
  while (cola.length > 0) {
    const { celda, clase } = cola.pop()!;
    const celdaAct = celdas[celda];
    const bloqueadas = celdaAct.clases[clase];
    for (const borde of celdaAct.bordes) {
      if (bloqueadas.includes(borde)) continue;
      const faces = malla.bordeAFaces.get(borde) || [];
      for (const f of faces) {
        if (caras.has(f)) continue;
        const tc = malla.faceACelda[f];
        if (tc === celda) continue;
        if (tc >= 0) {
          if (!visitadas.has(tc)) {
            visitadas.add(tc);
            const c2 = celdas[tc];
            for (const t of c2.tris) caras.add(t);
            cola.push({
              celda: tc,
              // La clase BLOQUEADA de la celda vecina es la OPUESTA al borde
              // de entrada: lo que se cruzó (el borde de entrada) es justamente
              // lo que hay que seguir cruzando para avanzar por el anillo.
              clase: c2.clases[0].includes(borde) ? 1 : 0,
            });
          }
        } else {
          // Triángulo suelto (casquete del polo, remate): entra en el
          // anillo pero no se sigue cruzando a través de él.
          caras.add(f);
        }
      }
    }
  }
  return caras.size > 0 ? Array.from(caras).sort((a, b) => a - b) : null;
}

/** Extremos (posición lógica) de un borde «a-b» de la topología de anillos. */
export function extremosBordeAnillo(
  malla: AnillosMalla,
  borde: string
): [Vertex3D, Vertex3D] | null {
  const [pa, qa] = borde.split('-').map(Number);
  const A = malla.canonPos[pa];
  const B = malla.canonPos[qa];
  if (!A || !B) return null;
  return [A, B];
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


// Plantillas de las tres vistas por defecto: vacías. Los lienzos 2D
// arrancan en blanco — el usuario dibuja desde cero o inserta una
// forma de un clic. La reconstrucción 3D necesita ≥3 vértices por
// vista, así que sin dibujo no hay figura (área de trabajo vacío).
export const DEFAULT_VIEWS: Views = {
  front: [],
  side: [],
  top: [],
};

/**
 * Detecta si el perfil del torno cierra el contorno consigo mismo (un anillo,
 * un toroide…). El lienzo DIBUJA la figura cerrada (une el último punto con
 * el primero con la forma y el relleno) pero no guarda esa unión: la banda
 * de superficie que va del último punto del perfil hasta el primero no llega
 * a existir — en un toroide (círculo insertado como forma, que empieza arriba
 * y acaba un paso antes de volver a subir) queda un hueco justo en la parte
 * superior. Devuelve la polilínea y si cierra o no, con tolerancia relativa
 * al tamaño del perfil. Solo se recorta el último punto cuando es un
 * DUPLICADO exacto del primero (cierre dibujado de verdad): en el círculo de
 * la forma, ese último punto es un vértice real de la silueta y recortarlo
 * cortaría la esquina. Los perfiles abiertos clásicos (botella, vasija…)
 * acaban lejos del inicio: sus extremos ya los cierran las tapas del eje.
 */
export function latheProfileLoop(
  poly: Polygon,
): { points: Polygon; closed: boolean } {
  const points: Polygon = poly.map((p) => ({ x: p.x, y: p.y }));
  if (points.length <= 2) return { points, closed: false };
  const first = points[0];
  const last = points[points.length - 1];
  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // El contorno se DIBUJA cerrado: la cuerda de cierre (último → primero)
  // es una arista más de la figura. En un anillo su longitud apena (≈ una
  // arista cualquiera, círculo de 32 puntos u octógono da igual), mientras
  // que en un perfil abierto de vasija cruza toda la pieza (2 unidades
  // contra aristas de décimas). Se cierra cuando la cuerda de cierre es del
  // orden de las aristas de la propia figura (3× la media como tope).
  let perimeter = 0;
  for (let i = 1; i < points.length; i++) {
    perimeter += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y
    );
  }
  const avgEdge = Math.max(perimeter / (points.length - 1), 1e-12);
  const seam = Math.hypot(last.x - first.x, last.y - first.y);
  if (seam <= avgEdge * 3) {
    // Cierre exacto: el último punto repite al primero y sobra.
    if (last.x === first.x && last.y === first.y) points.pop();
    return { points, closed: true };
  }
  return { points, closed: false };
}

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
  const profileLoop = latheProfileLoop(profile);
  const normalized = profileLoop.points;
  const closedLoop = profileLoop.closed;

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

  // Contorno cerrado: submuestrar también el tramo de cierre (último punto
  // → primero, respetando sus asas de curva) para que la costura del anillo
  // siga la misma curvatura que el resto del perfil. El paso final (t = 1)
  // coincide con la primera fila y lo generan las caras de cierre.
  if (closedLoop && normalized.length >= 2) {
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    const c1 = last.hOut ?? last;
    const c2 = first.hIn ?? first;
    for (let step = 1; step < curveSteps; step++) {
      const t = step / curveSteps;
      const inverse = 1 - t;
      curvedProfile.push({
        x:
          inverse * inverse * inverse * last.x +
          3 * inverse * inverse * t * c1.x +
          3 * inverse * t * t * c2.x +
          t * t * t * first.x,
        y:
          inverse * inverse * inverse * last.y +
          3 * inverse * inverse * t * c1.y +
          3 * inverse * t * t * c2.y +
          t * t * t * first.y,
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

  if (closedLoop) {
    // Contorno cerrado: la última banda de superficie, que vuelve de la
    // última fila del perfil a la primera (la costura del anillo). Con el
    // mismo patrón de aristas que las bandas anteriores, el winding queda
    // igual que el resto del objeto.
    const lastRow = (safeProfile.length - 1) * safeSegments;
    for (let j = 0; j < safeSegments; j++) {
      const jNext = (j + 1) % safeSegments;
      const idx = lastRow + j;
      const idxNext = lastRow + jNext;
      faces.push([idx, idxNext, j]);
      faces.push([idxNext, jNext, j]);
    }
  }

  // Cerrar extremos (tapas)
  const axisEpsilon = 0.06;
  const topProfile = safeProfile[safeProfile.length - 1];
  const bottomProfile = safeProfile[0];

  if (clamp && !closedLoop && topProfile.x <= axisEpsilon) {
    // Solo cerrar si el extremo del perfil realmente toca el eje.
    // Con contorno cerrado no se toca: la última fila del perfil es la
    // MISMA que la primera (el anillo se cierra sobre sí), así que una tapa
    // ahí duplicaría la de abajo en el mismo punto (parpadeo en el polo).
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

  let minY = Infinity;
  let maxY = -Infinity;
  let maxRadius = 0;
  for (const vertex of vertices) {
    if (vertex.y < minY) minY = vertex.y;
    if (vertex.y > maxY) maxY = vertex.y;
    const radius = Math.hypot(vertex.x, vertex.z);
    if (radius > maxRadius) maxRadius = radius;
  }
  const height = Math.max(1e-6, maxY - minY);
  maxRadius = Math.max(1e-6, maxRadius);
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
