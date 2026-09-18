import { ShapeUtils, Vector2 } from 'three';
import type { Mesh, Vertex3D } from './geometry';
import {
  buildTextTexture,
  renderTextCanvas,
  rgbToHex,
  type TextGridOptions,
} from './text-voxel';

export type TextSmoothOptions = TextGridOptions & {
  /** Grosor de la extrusión, en las mismas unidades que la profundidad de vóxeles */
  depth: number;
  /** Color base ('#rrggbb') para fuentes monocromas o al ignorar el color propio */
  baseColor: string;
  /** false = fuerza el color base incluso si la fuente trae color propio */
  useFontColor?: boolean;
  /** Opacidad del material completo (0..1, 1 = sólido) */
  opacity?: number;
};

type Pt = { x: number; y: number };

/**
 * MALLA SUAVE para el texto 3D, con la misma filosofía que el estilo
 * "Suave" de las figuras: la superficie sigue las CURVAS REALES del
 * glifo en vez de escalones de vóxeles.
 *
 * Método: se renderiza el texto a alta resolución y se traza su
 * contorno con Marching Squares sobre el canal alfa, interpolando la
 * posición del borde ENTRE píxeles (sub-píxel). Ese contorno —curvas y
 * diagonales tal como las dibuja la fuente— se extruye: muros que
 * siguen el trazo y tapas trianguladas (con agujeros para las letras
 * "o", "e", "a"...). Nada de rejilla de celdas: no hay escalones.
 *
 * Los colores se reproducen con su FORMA exacta, como en la vista
 * plana: las tapas llevan la TEXTURA exacta del texto renderizado
 * (regiones de color, emojis...) y cada muro el color muestreado de su
 * tramo, como en el modo vóxeles.
 */
export function buildSmoothTextMesh(opts: TextSmoothOptions): Mesh {
  const empty: Mesh = { vertices: [], faces: [] };
  if (typeof document === 'undefined') return empty;

  const {
    text,
    fontFamily,
    resolution,
    fontWeight = '700',
    italic = false,
    depth,
    baseColor,
    useFontColor = true,
    opacity,
  } = opts;
  if (!text.trim()) return empty;

  // Mismo tamaño de rejilla que el modo vóxeles, para que el texto
  // ocupe lo mismo en el visor al cambiar de estilo
  const H = Math.max(8, Math.round(resolution));
  const fontPx = Math.max(96, H * 6);
  const rendered = renderTextCanvas(
    text,
    fontFamily,
    fontWeight,
    italic,
    fontPx,
    '#ffffff'
  );
  if (!rendered) return empty;
  const { ctx, cw, ch } = rendered;
  const img = ctx.getImageData(0, 0, cw, ch);
  const data = img.data;

  const W = Math.max(8, Math.round((cw / ch) * H));
  const D = Math.max(1, Math.round(depth));

  // 1) Contornos sub-píxel del texto (en coordenadas de canvas, Y abajo)
  const rawLoops = traceGlyphLoops(data, cw, ch);

  // 2) Limpieza: suavizado ligero + Douglas-Peucker, y descarte de
  //    motas de ruido del anti-aliasing
  const loops: Pt[][] = [];
  for (const raw of rawLoops) {
    if (Math.abs(shoelace(raw)) < 2) continue; // mota: < 2 px²
    const smooth = smoothLoop(raw, 2);
    const simplified = simplifyLoop(smooth, 0.6);
    if (simplified.length >= 3) loops.push(simplified);
  }
  if (loops.length === 0) return empty;

  // 3) A coordenadas de rejilla con Y hacia arriba (como los vóxeles)
  const toGrid = (p: Pt): Pt => ({
    x: (p.x * W) / cw,
    y: ((ch - p.y) * H) / ch,
  });
  const gridLoops = loops.map((l) => l.map(toGrid));

  // 4) Clasificación exterior/agujero por anidamiento
  const groups = nestLoops(gridLoops);
  if (groups.length === 0) return empty;

  // 5) Construcción de la malla.
  // Las TAPAS llevan la TEXTURA EXACTA del texto (como la vista plana):
  // cada vértice de tapa mapea a su posición 2D en la textura, así los
  // colores de la fuente (emojis, regiones de color) reproducen su
  // FORMA exacta, no un color promediado por triángulo. Los MUROS
  // llevan vértices propios con el UV del color muestreado de su tramo
  // (texel sólido): mismo color por tramo que el modo vóxeles.
  const vertices: Vertex3D[] = [];
  const faces: number[][] = [];
  const faceColors: (string | null)[] = [];
  const faceOpacities: number[] = [];
  const uvs: [number, number][] = [];
  const vmap = new Map<string, number>();
  const maxDim = Math.max(W, H, D);
  const scale = maxDim / 2;

  const pushVertex = (
    gx: number,
    gy: number,
    gz: number,
    uv: [number, number]
  ): number => {
    const id = vertices.length;
    vertices.push({
      x: (gx - W / 2) / scale,
      y: (gy - H / 2) / scale,
      z: (gz - D / 2) / scale,
    });
    uvs.push(uv);
    return id;
  };

  // Vértice de tapa: deduplicado por posición; UV = posición 2D en la
  // textura (gx/W, gy/H — la textura es el propio render del texto)
  const getCapVertex = (p: Pt, gz: number): number => {
    const key = `${p.x.toFixed(5)},${p.y.toFixed(5)},${gz}`;
    const found = vmap.get(key);
    if (found !== undefined) return found;
    const id = pushVertex(p.x, p.y, gz, [p.x / W, p.y / H]);
    vmap.set(key, id);
    return id;
  };

  // Vértice de muro: SIEMPRE nuevo (su UV es el color del tramo, no su
  // posición), para que cada muro tenga su color limpio sin degradados
  const getWallVertex = (p: Pt, gz: number, uv: [number, number]): number =>
    pushVertex(p.x, p.y, gz, uv);

  // Muestreo del MURO: color y UV del texel MÁS OPACO cercano al punto
  // medio del tramo (metido dentro del material). Antes el UV apuntaba
  // a la posición exacta, que en trazos finos cae en un texel
  // semi-transparente del anti-aliasing y, con el material transparent,
  // el muro se veía como un cristal. Apuntando a un texel opaco el
  // muro siempre sale sólido por defecto.
  const sampleWall = (
    gx: number,
    gy: number
  ): { color: string | null; uv: [number, number] } => {
    const px = (gx * cw) / W;
    const py = ch - (gy * ch) / H;
    const cx = Math.round(px);
    const cy = Math.round(py);
    let best: [number, number] | null = null;
    let bestA = 0;
    for (let rad = 0; rad <= 4 && bestA < 250; rad++) {
      for (let dy = -rad; dy <= rad && bestA < 250; dy++) {
        for (let dx = -rad; dx <= rad && bestA < 250; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
          const o = (y * cw + x) * 4;
          if (data[o + 3] > bestA) {
            bestA = data[o + 3];
            best = [x, y];
          }
        }
      }
    }
    if (!best) return { color: null, uv: [gx / W, gy / H] };
    const [bx, by] = best;
    const o = (by * cw + bx) * 4;
    return {
      color: rgbToHex(data[o], data[o + 1], data[o + 2]),
      // Centro del texel: con el filtrado bilinear de la textura, el
      // muro muestrea ese texel exacto y no una media con sus vecinos
      uv: [(bx + 0.5) / cw, 1 - (by + 0.5) / ch],
    };
  };

  for (const { outer, holes } of groups) {
    // --- Muros: siguen el contorno; la orientación (exteriores CCW,
    // agujeros CW) hace que el quad [a0,b0,b1,a1] mire siempre hacia
    // fuera del material
    for (const loop of [outer, ...holes]) {
      const n = loop.length;
      for (let k = 0; k < n; k++) {
        const p = loop[k];
        const q = loop[(k + 1) % n];
        // Color y UV del tramo: punto medio metido ~1.5px DENTRO del
        // material (a la izquierda del sentido de marcha) y de ahí el
        // texel opaco más cercano (sampleWall), para que el muro no
        // herede la transparencia del anti-aliasing del borde.
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const nudge = (1.5 * W) / cw;
        const sx = (p.x + q.x) / 2 + (-dy / len) * nudge;
        const sy = (p.y + q.y) / 2 + (dx / len) * nudge;
        const { color, uv: suv } = sampleWall(sx, sy);
        const a0 = getWallVertex(p, 0, suv);
        const b0 = getWallVertex(q, 0, suv);
        const b1 = getWallVertex(q, D, suv);
        const a1 = getWallVertex(p, D, suv);
        faces.push([a0, b0, b1, a1]);
        faceColors.push(color);
        faceOpacities.push(Math.max(0, Math.min(1, opacity ?? 1)));
      }
    }

    // --- Tapas: triangulación del contorno con sus agujeros
    const contour = outer.map((p) => new Vector2(p.x, p.y));
    const holeVs = holes.map((h) => h.map((p) => new Vector2(p.x, p.y)));
    let tris: number[][] = [];
    try {
      tris = ShapeUtils.triangulateShape(contour, holeVs) as number[][];
    } catch {
      tris = [];
    }
    if (tris.length === 0) {
      // Resguardo: abanico del contorno exterior (sin agujeros)
      for (let k = 1; k + 1 < outer.length; k++) tris.push([0, k, k + 1]);
    }

    // triangulateShape numera sobre [exterior, agujero0, agujero1...]
    const flat: Pt[][] = [outer, ...holes];
    const offsets: number[] = [];
    let acc = 0;
    for (const f of flat) {
      offsets.push(acc);
      acc += f.length;
    }
    const ptAt = (i: number): Pt => {
      for (let g = flat.length - 1; g >= 0; g--) {
        if (i >= offsets[g]) return flat[g][i - offsets[g]];
      }
      return flat[0][0];
    };

    for (const t of tris) {
      if (t.length < 3) continue;
      const a = ptAt(t[0]);
      const b = ptAt(t[1]);
      const c = ptAt(t[2]);
      if (!a || !b || !c) continue;
      const area2 =
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      // CCW en la tapa trasera (z=D) mira a +z; la delantera se voltea
      const tri = area2 > 0 ? [a, b, c] : [a, c, b];
      faces.push([
        getCapVertex(tri[0], D),
        getCapVertex(tri[1], D),
        getCapVertex(tri[2], D),
      ]);
      faceColors.push(null);
      faceOpacities.push(1);
      faces.push([
        getCapVertex(tri[0], 0),
        getCapVertex(tri[2], 0),
        getCapVertex(tri[1], 0),
      ]);
      faceColors.push(null);
      faceOpacities.push(1);
    }
  }

  // 6) Textura exacta del texto (colores reales de la fuente o color
  //    base), la misma que usa la vista plana. Se renderiza a más
  //    resolución que el trazado: los UV están normalizados al área del
  //    glifo, así que la textura puede ser tan nítida como se quiera
  //    independientemente de la resolución de la malla.
  const tex = buildTextTexture({
    text,
    fontFamily,
    fontWeight,
    italic,
    resolution,
    baseColor,
    useFontColor,
    fontPx: Math.max(192, H * 8),
  });

  if (!tex) return { vertices, faces, faceColors, faceOpacities };
  return {
    vertices,
    faces,
    faceColors,
    faceOpacities,
    texture: tex.texture,
    uvs,
  };
}

// ---------------------------------------------------------------------------
// Marching squares: contornos sub-píxel del canal alfa
// ---------------------------------------------------------------------------

const ALPHA_T = 128;

function traceGlyphLoops(
  data: Uint8ClampedArray,
  cw: number,
  ch: number
): Pt[][] {
  const alphaAt = (x: number, y: number): number =>
    data[(y * cw + x) * 4 + 3];
  const inside = (x: number, y: number): boolean =>
    x >= 0 && x < cw && y >= 0 && y < ch && alphaAt(x, y) >= ALPHA_T;

  // Cruce de una arista, interpolado entre los dos píxeles que une.
  // h(x,y) = arista entre (x,y) y (x+1,y); v(x,y) = entre (x,y) y (x,y+1).
  // Se cachea por arista: las dos celdas que la comparten calculan el
  // MISMO punto, con lo que encadenar segmentos es exacto.
  const hMap = new Map<string, Pt>();
  const vMap = new Map<string, Pt>();
  const H = (x: number, y: number): Pt => {
    const key = `${x},${y}`;
    let p = hMap.get(key);
    if (!p) {
      const a0 = alphaAt(x, y);
      const a1 = alphaAt(x + 1, y);
      const t = a1 === a0 ? 0.5 : (ALPHA_T - a0) / (a1 - a0);
      p = { x: x + Math.max(0, Math.min(1, t)), y };
      hMap.set(key, p);
    }
    return p;
  };
  const V = (x: number, y: number): Pt => {
    const key = `${x},${y}`;
    let p = vMap.get(key);
    if (!p) {
      const a0 = alphaAt(x, y);
      const a1 = alphaAt(x, y + 1);
      const t = a1 === a0 ? 0.5 : (ALPHA_T - a0) / (a1 - a0);
      p = { x, y: y + Math.max(0, Math.min(1, t)) };
      vMap.set(key, p);
    }
    return p;
  };

  type Seg = { a: Pt; b: Pt; ka: string; kb: string };
  const segs: Seg[] = [];
  const addSeg = (
    a: Pt,
    b: Pt,
    ka: string,
    kb: string
  ) => segs.push({ a, b, ka, kb });

  for (let y = 0; y < ch - 1; y++) {
    for (let x = 0; x < cw - 1; x++) {
      const tl = inside(x, y);
      const tr = inside(x + 1, y);
      const br = inside(x + 1, y + 1);
      const bl = inside(x, y + 1);
      const idx =
        (tl ? 1 : 0) | (tr ? 2 : 0) | (br ? 4 : 0) | (bl ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const kT = `h${x},${y}`;
      const kB = `h${x},${y + 1}`;
      const kL = `v${x},${y}`;
      const kR = `v${x + 1},${y}`;
      switch (idx) {
        case 1:
        case 14:
          addSeg(V(x, y), H(x, y), kL, kT);
          break;
        case 2:
        case 13:
          addSeg(H(x, y), V(x + 1, y), kT, kR);
          break;
        case 3:
        case 12:
          addSeg(V(x, y), V(x + 1, y), kL, kR);
          break;
        case 4:
        case 11:
          addSeg(V(x + 1, y), H(x, y + 1), kR, kB);
          break;
        case 6:
        case 9:
          addSeg(H(x, y), H(x, y + 1), kT, kB);
          break;
        case 7:
        case 8:
          addSeg(V(x, y), H(x, y + 1), kL, kB);
          break;
        case 5: {
          // Silla: se resuelve con la media de la celda para que las
          // diagonales de una curva no se corten en zigzag
          const c =
            (alphaAt(x, y) +
              alphaAt(x + 1, y) +
              alphaAt(x + 1, y + 1) +
              alphaAt(x, y + 1)) /
              4 >=
            ALPHA_T;
          if (c) {
            addSeg(H(x, y), V(x + 1, y), kT, kR);
            addSeg(H(x, y + 1), V(x, y), kB, kL);
          } else {
            addSeg(V(x, y), H(x, y), kL, kT);
            addSeg(V(x + 1, y), H(x, y + 1), kR, kB);
          }
          break;
        }
        case 10: {
          const c =
            (alphaAt(x, y) +
              alphaAt(x + 1, y) +
              alphaAt(x + 1, y + 1) +
              alphaAt(x, y + 1)) /
              4 >=
            ALPHA_T;
          if (c) {
            addSeg(V(x, y), H(x, y), kL, kT);
            addSeg(V(x + 1, y), H(x, y + 1), kR, kB);
          } else {
            addSeg(H(x, y), V(x + 1, y), kT, kR);
            addSeg(H(x, y + 1), V(x, y), kB, kL);
          }
          break;
        }
      }
    }
  }

  // Encadena los segmentos en bucles cerrados
  const byKey = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const k of [s.ka, s.kb]) {
      const arr = byKey.get(k);
      if (arr) arr.push(i);
      else byKey.set(k, [i]);
    }
  });

  const loops: Pt[][] = [];
  const used = new Array(segs.length).fill(false);
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const loop: Pt[] = [segs[i].a, segs[i].b];
    let curKey = segs[i].kb;
    let curSeg = i;
    let guard = 0;
    while (guard++ < segs.length + 2) {
      const cands = byKey.get(curKey) ?? [];
      let next = -1;
      for (const c of cands) {
        if (c !== curSeg && !used[c]) {
          next = c;
          break;
        }
      }
      if (next === -1) break; // bucle cerrado
      used[next] = true;
      const s = segs[next];
      loop.push(s.ka === curKey ? s.b : s.a);
      curKey = s.ka === curKey ? s.kb : s.ka;
      curSeg = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// ---------------------------------------------------------------------------
// Limpieza de contornos
// ---------------------------------------------------------------------------

/** Área con signo (shoelace) de un polígono cerrado */
function shoelace(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/**
 * Suavizado ligero del contorno: cada punto se promedia con sus
 * vecinos. Dos pasadas quitan el peludo sub-píxel del trazado sin
 * apenas encoger las curvas.
 */
function smoothLoop(pts: Pt[], iterations: number): Pt[] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const n = cur.length;
    cur = cur.map((p, i) => {
      const prev = cur[(i + n - 1) % n];
      const next = cur[(i + 1) % n];
      return {
        x: (prev.x + 2 * p.x + next.x) / 4,
        y: (prev.y + 2 * p.y + next.y) / 4,
      };
    });
  }
  return cur;
}

function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 <= 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Douglas-Peucker de una polilínea ABIERTA; devuelve los índices conservados */
function dpChain(pts: Pt[], eps: number): number[] {
  const n = pts.length;
  if (n < 3) return pts.map((_, i) => i);
  const keep = new Array(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    if (e <= s + 1) continue;
    let maxD = -1;
    let maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegDist(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > eps) {
      keep[maxI] = true;
      stack.push([s, maxI], [maxI, e]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/**
 * Simplifica un contorno CERRADO: ancla en el punto más alejado del
 * primero y Douglas-Peucker sobre las dos mitades. Los tramos rectos
 * quedan en un solo segmento (muro de una cara); las curvas conservan
 * puntos donde hacen falta.
 */
function simplifyLoop(pts: Pt[], eps: number): Pt[] {
  const n = pts.length;
  if (n <= 8) return pts;
  let far = 1;
  let farD = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const first = pts.slice(0, far + 1);
  const second = pts.slice(far).concat([pts[0]]);
  const k1 = dpChain(first, eps);
  const k2 = dpChain(second, eps);
  const out: Pt[] = [];
  for (const i of k1) out.push(first[i]);
  for (const i of k2.slice(1, -1)) out.push(second[i]);
  return out;
}

// ---------------------------------------------------------------------------
// Anidamiento: exteriores y agujeros
// ---------------------------------------------------------------------------

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      (a.y > p.y) !== (b.y > p.y) &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

type LoopGroup = { outer: Pt[]; holes: Pt[][] };

/**
 * Clasifica los contornos por profundidad de anidamiento (par = trazo
 * exterior, impar = agujero) y asigna cada agujero al exterior que lo
 * contiene. Orienta los exteriores CCW y los agujeros CW: así, al
 * recorrer cualquier contorno, el material queda SIEMPRE a la
 * izquierda y los muros construidos con el mismo quad miran hacia
 * fuera en ambos casos.
 */
function nestLoops(loops: Pt[][]): LoopGroup[] {
  const areas = loops.map((l) => Math.abs(shoelace(l)));
  const containers: number[][] = loops.map((l, i) => {
    const out: number[] = [];
    const probe = l[0];
    for (let j = 0; j < loops.length; j++) {
      if (j === i) continue;
      if (pointInPoly(probe, loops[j])) out.push(j);
    }
    return out;
  });

  const isHole = containers.map((c) => c.length % 2 === 1);
  const outers: number[] = [];
  loops.forEach((_, i) => {
    if (!isHole[i]) outers.push(i);
  });

  const groups: LoopGroup[] = outers.map((oi) => {
    let outer = loops[oi].slice();
    if (shoelace(outer) < 0) outer.reverse(); // CCW
    const holes: Pt[][] = [];
    loops.forEach((_, hi) => {
      if (!isHole[hi]) return;
      // Su contenedor inmediato: el exterior que lo contiene con menor área
      let best = -1;
      loops.forEach((_, oi2) => {
        if (containers[hi].includes(oi2) && !isHole[oi2]) {
          if (best === -1 || areas[oi2] < areas[best]) best = oi2;
        }
      });
      if (best !== oi) return;
      const h = loops[hi].slice();
      if (shoelace(h) > 0) h.reverse(); // CW
      holes.push(h);
    });
    return { outer, holes };
  });
  return groups;
}