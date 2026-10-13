import {
  flattenPolygon,
  resampleClosed,
  type Mesh,
  type Point2D,
  type Polygon,
  type Vertex3D,
} from '@/lib/geometry';

/**
 * Spline 3D (botón "Spline") y muelle ("Spline Rosca").
 *
 * Versión tridimensional del barrido de Extruir (`lib/sweep-mesh.ts`, que
 * queda INTACTO para esa pestaña): la plantilla de cada vértice se coloca
 * perpendicular al trazado, interpolándose de una forma a la siguiente, y
 * todas las anillas se cosen en una sola malla. Aquí el trazado vive en el
 * espacio MUNDO (cada vértice guarda su posición x/y/z) y el marco de cada
 * anilla se calcula por transporte paralelo (RMF) para que el tubo no
 * retuerza en las inflexiones.
 */

/** Vector 3D propio de este módulo (posiciones/tangentes/anillos en mundo). */
export type V3 = { x: number; y: number; z: number };

/** Vértice del trazado 3D: posición en MUNDO (no el lienzo 0..1 de Extruir). */
export type SplineNode3D = {
  id: number;
  /** Posición en el mundo. */
  p: V3;
  /** Sin redondeo en este vértice (ángulo recto; la curva entra/sale recta). */
  esquina?: boolean;
  /** Inclinación de la plantilla en grados alrededor del eje del trazado. */
  tilt?: number;
  /** Inclinación en grados alrededor del EJE-X de la plantilla (su ancho):
      la parte alta «se acuesta» — acorta el ALTO del anillo (corte oblicuo). */
  tiltX?: number;
  /** Inclinación en grados alrededor del EJE-Y de la plantilla (su alto):
      acorta el ANCHO del anillo (corte oblicuo). */
  tiltY?: number;
  /**
   * Escala PROPIA de la plantilla (unidades del mundo). Si falta, se usa
   * la escala de los datos del spline (la de los .zeus viejos).
   */
  escala?: number;
  /** Plantilla (0..1, la y hacia abajo, igual que las plantillas de Extruir). */
  polygon?: Polygon;
  /**
   * Alineación MUNDIAL de esta plantilla — la ventana en la que se calcó
   * (⤢ Extrusión spline con destino spline). `right`/`up` son los ejes de
   * pantalla de ESA ventana en el mundo (unitarios), `rx`/`ry` son el mapa
   * del lienzo 0..1 al mundo RELATIVO a la escala del vértice (1 = lienzo
   * cuadrado). Con él, la plantilla sale EXACTAMENTE como se dibujó en esa
   * ventana en vez de torcerse con el marco transportado del trazado.
   * Falta = comportamiento de siempre (marco RMF).
   */
  baseMundo?: { right: V3; up: V3; rx: number; ry: number };
};

export type SplineDatos = {
  nodes: SplineNode3D[];
  /** Unir el último vértice con el primero (trazado cerrado). */
  closed: boolean;
  /** Muestras intermedias entre cada par de vértices (1..64). */
  subdivisions: number;
  /** Tamaño de la plantilla en unidades del mundo (radio mundo = 2·r·escala). */
  escala: number;
  /** 'radial': la plantilla gira con el enrollado (su «derecha» sigue
      apuntando hacia fuera: hilo de un tornillo). Falta = transporte. */
  orientacion?: 'transporte' | 'radial';
  /** Si el trazado nació de una hélice (botón "Spline Rosca"), los
      parámetros del muelle: el panel los enseña y editarlos rehace la
      hélice conservando las plantillas editadas. */
  rosca?: RoscaParams;
};

/** Parámetros del muelle (botón "Spline Rosca"): hélice con tubo redondo. */
export type RoscaParams = {
  /** Nº de vueltas (entero 1..40). */
  vueltas: number;
  /** Resolución del camino: vértices por vuelta (entero 6..128). */
  verticesPorVuelta: number;
  /** Paso (paso de rosca): separación entre vueltas, unidades del mundo. */
  separacion: number;
  /** Radio del círculo del muelle. */
  radioMuelle: number;
  /** Radio del tubo (≤ radioMuelle para que el muelle no se autotravese). */
  radioTubo: number;
};

/** Edición del trazado en las ventanas del visor (frente/costado/arriba). */
export type SplineEdicion = {
  nodes: SplineNode3D[];
  closed: boolean;
  activoId: number | null;
  onAdd?: (p: V3) => void;
  onMove?: (id: number, p: V3) => void;
  onSelect?: (id: number | null) => void;
  onRemove?: (id: number) => void;
};

// ─── Vectorial ──────────────────────────────────────────────────────────

const vsub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vadd = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vmul = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const vdot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const vcross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const vnorm = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const vfinito = (a: V3): boolean =>
  Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);

function centroid(pts: Point2D[]): Point2D {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

/** Punto de una curva de Catmull-Rom (igual que en sweep-mesh.ts). */
function catmull(p0: V3, p1: V3, p2: V3, p3: V3, t: number): V3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number): number =>
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t2 +
      (-a + 3 * b - 3 * c + d) * t3);
  return {
    x: f(p0.x, p1.x, p2.x, p3.x),
    y: f(p0.y, p1.y, p2.y, p3.y),
    z: f(p0.z, p1.z, p2.z, p3.z),
  };
}

/** Triangulación por recorte de orejas (copia de sweep-mesh.ts:107). */
function earClip(poly: Point2D[]): number[] {
  const n = poly.length;
  if (n < 3) return [];
  const idx = Array.from({ length: n }, (_, i) => i);
  const orient = (a: Point2D, b: Point2D, c: Point2D): number =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    signedArea += a.x * b.y - b.x * a.y;
  }
  if (signedArea < 0) idx.reverse();

  const tris: number[] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 6000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = poly[ia];
      const b = poly[ib];
      const c = poly[ic];
      if (orient(a, b, c) <= 0) continue; // cóncavo o degenerado
      let ok = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const p = poly[j];
        if (
          orient(a, b, p) >= 0 &&
          orient(b, c, p) >= 0 &&
          orient(c, a, p) >= 0
        ) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      tris.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) {
    tris.push(idx[0], idx[1], idx[2]);
  } else if (idx.length > 3) {
    for (let i = 1; i + 1 < idx.length; i++) tris.push(idx[0], idx[i], idx[i + 1]);
  }
  return tris;
}

function faceNormal(ids: number[], verts: Vertex3D[]): V3 {
  const a = verts[ids[0]];
  const b = verts[ids[1]];
  const c = verts[ids[2]];
  return vcross(vsub(b, a), vsub(c, a));
}

function faceCenter(ids: number[], verts: Vertex3D[]): V3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const id of ids) {
    x += verts[id].x;
    y += verts[id].y;
    z += verts[id].z;
  }
  const k = ids.length;
  return { x: x / k, y: y / k, z: z / k };
}

/** Orienta la cara para que su normal mire hacia fuera del eje del trazado. */
function orientFace(ids: number[], verts: Vertex3D[], outwardFrom: V3): number[] {
  const nrm = faceNormal(ids, verts);
  const center = faceCenter(ids, verts);
  return vdot(nrm, vsub(center, outwardFrom)) < 0 ? [...ids].reverse() : ids;
}

/**
 * Muestras de la línea del trazado en el mundo (la línea del visor y el
 * interior del constructor usan la misma curva). Con `esquina`, el control
 * de Catmull-Rom colapsa al propio vértice, así que la tangente de
 * entrada/salida sale exactamente por la dirección del segmento.
 */
export function muestrearSpline(
  nodes: SplineNode3D[],
  closed: boolean,
  subdivisions: number
): { pos: V3; seg: number; t: number }[] {
  const m = nodes.length;
  if (m < 2) return [];
  const steps = Math.max(1, Math.min(64, Math.round(subdivisions)));
  const samples: { pos: V3; seg: number; t: number }[] = [];
  const segCount = closed ? m : m - 1;
  for (let s = 0; s < segCount; s++) {
    const env = (i: number): number => (closed ? (i + m) % m : Math.max(0, Math.min(m - 1, i)));
    const i1 = s;
    const i2 = closed ? (s + 1) % m : Math.min(m - 1, s + 1);
    // p0/p3: Catmull-Rom normal, colapsados en los vértices con esquina.
    let p0 = nodes[env(s - 1)].p;
    let p3 = nodes[env(s + 2)].p;
    if (nodes[i1].esquina) p0 = nodes[i1].p;
    if (nodes[i2].esquina) p3 = nodes[i2].p;
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      samples.push({
        pos: catmull(p0, nodes[i1].p, nodes[i2].p, p3, t),
        seg: s,
        t,
      });
    }
  }
  if (!closed) {
    samples.push({ pos: nodes[m - 1].p, seg: m - 2, t: 1 });
  }
  return samples;
}

// ─── Marcos por transporte paralelo ─────────────────────────────────────

/**
 * Normal inicial: la mejor perpendicular a T (referencia 0,0,1 salvo
 * que la tangente sea casi vertical en Z, entonces 0,1,0).
 */
function primeraNormal(t: V3): V3 {
  const ref: V3 = Math.abs(t.z) < 0.999 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const n = vnorm(vsub(ref, vmul(t, vdot(ref, t))));
  return n;
}

/**
 * Transporte paralelo: N(i+1) = N(i) girado por el giro minimal que lleva
 * T(i) a T(i+1), re-ortogonalizado. Evita los volteos de Frenet.
 */
function transportadores(tangentes: V3[]): V3[] {
  const total = tangentes.length;
  const normales: V3[] = [primeraNormal(tangentes[0])];
  for (let i = 1; i < total; i++) {
    const t0 = tangentes[i - 1];
    const t1 = tangentes[i];
    const d = vdot(t0, t1);
    let n = normales[i - 1];
    if (d < 0.999999) {
      const eje = vcross(t0, t1);
      if (vfinito(eje) && Math.hypot(eje.x, eje.y, eje.z) > 1e-9) {
        // Fórmula de Rodrigues, sin THREE.
        const e = vnorm(eje);
        const ang = Math.acos(Math.max(-1, Math.min(1, d)));
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const rot = (a: V3): V3 => {
          const cr = vcross(e, a);
          const dr = vdot(e, a);
          return {
            x: a.x * c + cr.x * s + e.x * dr * (1 - c),
            y: a.y * c + cr.y * s + e.y * dr * (1 - c),
            z: a.z * c + cr.z * s + e.z * dr * (1 - c),
          };
        };
        n = rot(n);
      }
      // (d ≈ -1: tangente invertida de golpe; conserva el marco anterior.)
    }
    // Re-ortogonalizar contra la tangente actual.
    const t1n = tangentes[i];
    n = vnorm(vsub(n, vmul(t1n, vdot(n, t1n))));
    normales.push(n);
  }
  return normales;
}

/**
 * Marco radial (Frenet hacia FUERA): N = −dT/ds, la dirección hacia fuera
 * de la curvatura. La plantilla gira con el enrollado del camino — el
 * punto «derecho» de la plantilla (x≈1) sigue mirando hacia fuera en
 * TODAS las vueltas: hilo de un tornillo/rosca. En rectas conserva el
 * marco anterior (la curvatura se anula).
 */
function frenet(tangentes: V3[]): V3[] {
  const total = tangentes.length;
  const normales: V3[] = [];
  let prev: V3 = primeraNormal(tangentes[0]);
  for (let i = 0; i < total; i++) {
    const t = tangentes[i];
    const t0 = tangentes[i === 0 ? 0 : i - 1];
    const t1 = tangentes[i === total - 1 ? total - 1 : i + 1];
    const curv = vsub(t1, t0);
    if (vfinito(curv) && Math.hypot(curv.x, curv.y, curv.z) > 1e-9) {
      // Hacia fuera = el lado por el que la tangente NO se aparta.
      const cu = vnorm(vmul(curv, -1));
      const proj = vsub(cu, vmul(t, vdot(cu, t)));
      if (Math.hypot(proj.x, proj.y, proj.z) > 1e-9) prev = vnorm(proj);
    }
    // Re-ortogonalizar contra la tangente actual.
    prev = vnorm(vsub(prev, vmul(t, vdot(prev, t))));
    normales.push(prev);
  }
  return normales;
}

// ─── Constructor principal ──────────────────────────────────────────────

/** Escala del lienzo 0..1 al mundo, la misma del barrido (sweep-mesh.ts:48). */
const UNIT = 2;
/** Tope de vértices del barrido en vivo (protege el rendimiento). */
const LIMITE_VERTICES = 200000;

export type SplineOptions = {
  closed?: boolean;
  subdivisions?: number;
  /** > 0; por defecto 0.5 (plantilla por defecto radio mundo = 2·0.4·0.5). */
  escala?: number;
  /** Plantilla de los vértices que no traigan `polygon`. */
  plantillaPorDefecto?: Polygon;
  /** 'transporte' (por defecto): transporte paralelo (RMF). 'radial': la
      plantilla gira con el enrollado — la esquina «derecha» de la
      plantilla se mantiene mirando hacia fuera (hilo de un tornillo). */
  orientacion?: 'transporte' | 'radial';
};

/** Preparación común de la malla y de los contornos por vértice. */
type Preparo = {
  util: SplineNode3D[];
  closed: boolean;
  /** Plantillas remuestreadas (una anilla por vértice). */
  rings: Point2D[][];
  ringCount: number;
  muestras: { pos: V3; seg: number; t: number }[];
  tangentes: V3[];
  normales: V3[];
  /** Giro TOTAL de cada vértice alrededor del trazado (radianes): el tilt
      manual + el φ automático de baseMundo (ver prepararSpline). */
  rolls: number[];
  /** Inclinación de cada vértice alrededor del eje-x / eje-y de SU
      plantilla (radianes): acortan alto/ancho del anillo (corte oblicuo). */
  inclX: number[];
  inclY: number[];
  escalas: number[];
  /** Factores anisótropos del lienzo→mundo (baseMundo.rx/ry; 1 = cuadrado). */
  facX: number[];
  facY: number[];
  /** Muestras por segmento: el cruce del vértice j queda en j·steps
      (en trazado abierto el último vértice es la muestra final). */
  steps: number;
};

function prepararSpline(
  nodes: SplineNode3D[],
  options: SplineOptions
): Preparo | null {
  const util: SplineNode3D[] = nodes.filter(
    (n) => vfinito(n.p) && (n.esquina || (n.polygon ?? []).length >= 3)
  );
  if (util.length < 2) return null;

  const closed = !!options.closed;
  const esc = options.escala && options.escala > 0 ? options.escala : 0.5;

  // Anillas (mismo remuestreo común que el barrido).
  const DEF: Polygon = options.plantillaPorDefecto ?? [];
  const flats: Point2D[][] = util.map((n) => {
    const poly = n.polygon ?? DEF;
    return flattenPolygon(poly.length >= 3 ? poly : DEF, 12);
  });
  let densa = 0;
  for (const f of flats) densa = Math.max(densa, f.length);
  if (flats.some((f) => f.length < 3)) return null;
  const ringCount = Math.max(16, Math.min(96, densa));
  const rings: Point2D[][] = flats.map((f) => resampleClosed(f, ringCount));

  // Muestreo del trazado (con los toques del vértice en esquina).
  const subdivisions = Math.max(1, Math.min(64, Math.round(options.subdivisions ?? 5)));
  const muestras = muestrearSpline(util, closed, subdivisions);
  if (muestras.length < 2) return null;

  // Protección de rendimiento: recorta subdivisiones si la malla va a ser
  // gigante (la vista previa se regenera en vivo durante el arrastre).
  let steps = subdivisions;
  const maxSteps = Math.max(1, Math.floor(LIMITE_VERTICES / (util.length * ringCount)));
  if (steps > maxSteps) steps = maxSteps;
  const muestrasFinal =
    steps === subdivisions ? muestras : muestrearSpline(util, closed, steps);

  const total = muestrasFinal.length;

  // Tangentes por diferencias finitas (patrón del barrido).
  const tangentes: V3[] = muestrasFinal.map((_, i) => {
    const prev = muestrasFinal[i === 0 ? (closed ? total - 1 : 0) : i - 1].pos;
    const next = muestrasFinal[i === total - 1 ? (closed ? 0 : total - 1) : i + 1].pos;
    const d = vsub(next, prev);
    return Math.hypot(d.x, d.y, d.z) < 1e-9 ? { x: 1, y: 0, z: 0 } : vnorm(d);
  });

  // Marco según orientación: transporte paralelo (RMF) o radial (la
  // plantilla gira con el enrollado; Frenet hacia fuera de la curvatura).
  const normales =
    options.orientacion === 'radial'
      ? frenet(tangentes)
      : transportadores(tangentes);

  const tilts = util.map((n) => ((n.tilt ?? 0) * Math.PI) / 180);
  // Inclinación del CORTE alrededor de los ejes de la propia plantilla: el
  // eje-x «acuesta» el alto (canvas-y · cos) y el eje-y acorta el ancho.
  const inclX = util.map((n) => ((n.tiltX ?? 0) * Math.PI) / 180);
  const inclY = util.map((n) => ((n.tiltY ?? 0) * Math.PI) / 180);
  // Escala de plantilla por vértice (0.01..8): la del nodo si la trae,
  // si no la de los datos (compatibilidad con .zeus anteriores).
  const escalas = util.map(
    (n) => (n.escala && n.escala > 0 ? Math.max(0.01, Math.min(8, n.escala)) : esc)
  );

  // ALINEACIÓN A LA VENTANA DE LA CAPTURA (baseMundo). Giro TOTAL de cada
  // vértice = tilt manual + φ automático: φ rota el marco EN SU PROPIO
  // plano para que el eje-x de la plantilla salga mirando al «right» de la
  // ventana donde se calcó (con el trazado ⟂ a esa ventana — el uso
  // normal: plantilla de Superior, camino por Frente — sale EXACTO:
  // plantilla-x → right de la ventana y plantilla-y → −up). Rotar en el
  // propio plano NO toca el radio: vale también para 'radial'. Sin un
  // baseMundo válido, todo queda idéntico a antes (compatibilidad .zeus).
  const rolls = tilts.slice();
  const facX: number[] = util.map(() => 1);
  const facY: number[] = util.map(() => 1);
  if (util.some((n) => n.baseMundo)) {
    // Proyección de un eje de ventana sobre el plano ⟂ de la tangente.
    const proyecta = (v: V3, t: V3): { d: V3; largo: number } => {
      const p = vsub(v, vmul(t, vdot(v, t)));
      return { d: vnorm(p), largo: Math.hypot(p.x, p.y, p.z) };
    };
    for (let j = 0; j < util.length; j++) {
      const base = util[j].baseMundo;
      if (!base) continue;
      if (
        !vfinito(base.right) ||
        !vfinito(base.up) ||
        Math.hypot(base.right.x, base.right.y, base.right.z) < 1e-9 ||
        Math.hypot(base.up.x, base.up.y, base.up.z) < 1e-9
      )
        continue;
      facX[j] = Math.max(0.01, Math.min(32, base.rx > 0 ? base.rx : 1));
      facY[j] = Math.max(0.01, Math.min(32, base.ry > 0 ? base.ry : 1));
      const idx = !closed && j === util.length - 1 ? total - 1 : j * steps;
      const t = tangentes[idx];
      const n1 = normales[idx];
      const b1 = vcross(n1, t);
      const dR = proyecta(base.right, t);
      const dU = proyecta(base.up, t);
      let d: V3 | null = null;
      let ejeY = false;
      if (dR.largo >= 0.05) {
        // Normal: el eje-x de la plantilla mira al «right» de la ventana.
        d = dR.d;
      } else if (dU.largo >= 0.05) {
        // Camino DEGENERADO: el trazado corre hacia el eje-x (‖ right), la
        // proyección muere y algún eje se sacrifica sí o sí (un giro de 90°
        // es inevitable en esa esquina). Mejor candidato: mantener el eje-y
        // de la plantilla mirando al «up» de la ventana — así la VERTICAL
        // del dibujo sigue leyéndose bien («arriba» arriba).
        d = dU.d;
        ejeY = true;
      }
      if (!d) continue;
      // φ que pone el eje pedido mirando a d — la misma rotación que sufre
      // el (lx, ly) de la plantilla en el mapeo: plantilla-x → (cosφ, sinφ)
      // y plantilla-y → (−sinφ, cosφ) en (N, B).
      rolls[j] = tilts[j]
        + (ejeY
          ? Math.atan2(-vdot(d, n1), vdot(d, b1))
          : Math.atan2(vdot(d, b1), vdot(n1, d)));
    }
  }

  return {
    util,
    closed,
    rings,
    ringCount,
    muestras: muestrasFinal,
    tangentes,
    normales,
    rolls,
    inclX,
    inclY,
    escalas,
    facX,
    facY,
    steps,
  };
}

/**
 * Anillo (V3 en mundo) de UNA muestra preparada: plantilla interpolada
 * entre vértices, giro interpolado, mapa al plano (N, B) del marco.
 */
function anilloDeMuestra(prep: Preparo, i: number): V3[] {
  const m = prep.muestras[i];
  const j = m.seg;
  const j2 = (j + 1) % prep.util.length;
  const ringA = prep.rings[j];
  const ringB = prep.rings[j2];
  // Plantilla interpolada (deformación progresiva entre vértices).
  const prof: Point2D[] = [];
  for (let k = 0; k < prep.ringCount; k++) {
    const a = ringA[k];
    const b = ringB[k];
    prof.push({ x: a.x + (b.x - a.x) * m.t, y: a.y + (b.y - a.y) * m.t });
  }
  const c = centroid(prof);
  const esc = prep.escalas[j] + (prep.escalas[j2] - prep.escalas[j]) * m.t;
  const fX = prep.facX[j] + (prep.facX[j2] - prep.facX[j]) * m.t;
  const fY = prep.facY[j] + (prep.facY[j2] - prep.facY[j]) * m.t;
  const t1 = prep.tangentes[i];
  const n1 = prep.normales[i];
  const b1 = vcross(n1, t1);
  const roll = prep.rolls[j] + (prep.rolls[j2] - prep.rolls[j]) * m.t;
  // Inclinación del corte interpolada A→B: el giro alrededor del eje-y
  // acorta el ANCHO (lx·cos) y el del eje-x acorta el ALTO (ly·cos) — el
  // anillo sale elíptico como un corte oblicuo del barrido.
  const inclXi = prep.inclX[j] + (prep.inclX[j2] - prep.inclX[j]) * m.t;
  const inclYi = prep.inclY[j] + (prep.inclY[j2] - prep.inclY[j]) * m.t;
  const cosX = Math.cos(inclXi);
  const cosY = Math.cos(inclYi);
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);
  const ux = UNIT * esc * fX * cosY;
  const uy = UNIT * esc * fY * cosX;
  const anillo: V3[] = [];
  for (let k = 0; k < prep.ringCount; k++) {
    const lx = (prof[k].x - c.x) * ux;
    const ly = (prof[k].y - c.y) * uy;
    const a2 = lx * cos - ly * sin;
    const b2 = lx * sin + ly * cos;
    anillo.push(vadd(m.pos, vadd(vmul(n1, a2), vmul(b1, b2))));
  }
  return anillo;
}

/** Todos los anillos del barrido (uno por muestra). */
function anillosDelBarrido(prep: Preparo): V3[][] {
  const salida: V3[][] = [];
  for (let i = 0; i < prep.muestras.length; i++) {
    salida.push(anilloDeMuestra(prep, i));
  }
  return salida;
}

/**
 * Anillo de plantilla de cada VÉRTICE en el mundo — la forma dibujada en
 * ese punto. Con baseMundo el anillo cae alineado a la ventana de la
 * captura: es el MISMO mapeo de la malla, así lo que se ve contorneado es
 * lo que sale al aplicar.
 */
export function contornosDeVertices(
  nodes: SplineNode3D[],
  options: SplineOptions = {}
): V3[][] {
  const prep = prepararSpline(nodes, options);
  if (!prep) return [];
  const ultima = prep.util.length - 1;
  const salida: V3[][] = [];
  for (let j = 0; j <= ultima; j++) {
    // El cruce del vértice j: t=0 del segmento que lo empieza (en abierto,
    // el último vértice es la muestra final). En cerrado, el índice j·steps
    // cae igualmente entre los anillos de la malla.
    const idx =
      !prep.closed && j === ultima ? prep.muestras.length - 1 : j * prep.steps;
    salida.push(anilloDeMuestra(prep, idx));
  }
  return salida;
}

/**
 * Construye la malla de un trazado spline 3D: cada vértice lleva su
 * plantilla (perpendicular al trazado, interpolada entre vértices) y las
 * anillas se cosen en una sola malla con tapas planas en los extremos.
 */
export function buildSpline3DMesh(
  nodes: SplineNode3D[],
  options: SplineOptions = {}
): Mesh {
  const empty: Mesh = { vertices: [], faces: [] };
  const prep = prepararSpline(nodes, options);
  if (!prep) return empty;

  const total = prep.muestras.length;
  const vertices: Vertex3D[] = [];
  const anillas: number[][] = [];
  for (let i = 0; i < total; i++) {
    const ids: number[] = [];
    for (const p of anilloDeMuestra(prep, i)) {
      vertices.push({ x: p.x, y: p.y, z: p.z });
      ids.push(vertices.length - 1);
    }
    anillas.push(ids);
  }

  // Aliases del bloque de cosido y tapas (el mismo vocabulario de siempre).
  const ringCount = prep.ringCount;
  const closed = prep.closed;
  const muestrasFinal = prep.muestras;
  const tangentes = prep.tangentes;
  const normales = prep.normales;

  const faces: number[][] = [];
  const stitch = (aIds: number[], bIds: number[], eje: V3) => {
    for (let k = 0; k < ringCount; k++) {
      const k2 = (k + 1) % ringCount;
      faces.push(orientFace([aIds[k], aIds[k2], bIds[k2], bIds[k]], vertices, eje));
    }
  };

  // Piel: coser anillas consecutivas (y el último→primero en cerrado).
  for (let i = 0; i + 1 < total; i++) {
    const eje = vmul(vadd(muestrasFinal[i].pos, muestrasFinal[i + 1].pos), 0.5);
    stitch(anillas[i], anillas[i + 1], eje);
  }
  if (closed && total > 2) {
    const eje = vmul(vadd(muestrasFinal[total - 1].pos, muestrasFinal[0].pos), 0.5);
    stitch(anillas[total - 1], anillas[0], eje);
  }

  // Tapas planas en los extremos (solo trazado abierto).
  if (!closed) {
    const cap = (ids: number[], centro: V3, tangente: V3, signo: number) => {
      const salida = vmul(tangente, signo);
      const local: Point2D[] = ids.map((id) => {
        const d = vsub(vertices[id], centro);
        // En el plano del marco: (N, B) — la misma base que las anillas.
        return { x: vdot(d, normales[0]), y: vdot(d, vcross(normales[0], tangente)) };
      });
      const tris = earClip(local);
      for (let i = 0; i + 2 < tris.length; i += 3) {
        const tri = [ids[tris[i]], ids[tris[i + 1]], ids[tris[i + 2]]];
        const nrm = faceNormal(tri, vertices);
        if (vdot(nrm, salida) < 0) tri.reverse();
        faces.push(tri);
      }
    };
    cap(anillas[0], muestrasFinal[0].pos, tangentes[0], -1);
    cap(
      anillas[total - 1],
      muestrasFinal[total - 1].pos,
      tangentes[total - 1],
      1
    );
  }

  return { vertices, faces };
}

// ─── Muelle (Spline Rosca) ──────────────────────────────────────────────

/** Parámetros por defecto de un muelle nuevo. */
export const ROSCA_DEFECTO: RoscaParams = {
  vueltas: 6,
  verticesPorVuelta: 16,
  separacion: 0.4,
  radioMuelle: 0.5,
  radioTubo: 0.12,
};

/**
 * Nodos del camino helicoidal del muelle (eje Y, centrado en el origen,
 * la misma convención que cilindro/toroide de primitivas-parametricas).
 */
export function construirMuestraHelix(params: RoscaParams): SplineNode3D[] {
  const totalNodos = params.vueltas * params.verticesPorVuelta;
  if (totalNodos < 1) return [];
  const altura = params.vueltas * params.separacion;
  const plantilla = circuloExacto(32);
  const nodes: SplineNode3D[] = [];
  for (let i = 0; i <= totalNodos; i++) {
    // θ SIN módulo: la altura (separación·θ/2π) sube vuelta a vuelta; el
    // seno/coseno son periódicos y no necesitan el redondeo.
    const th = (i / params.verticesPorVuelta) * Math.PI * 2;
    nodes.push({
      id: i,
      p: {
        x: Math.cos(th) * params.radioMuelle,
        y: (params.separacion * th) / (Math.PI * 2) - altura / 2,
        z: Math.sin(th) * params.radioMuelle,
      },
      polygon: plantilla,
    });
  }
  return nodes;
}

/** Círculo exacto de N puntos, radio 0.5, centrado en (0.5, 0.5) (0..1). */
function circuloExacto(n: number): Polygon {
  const pts: Polygon = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    pts.push({ x: 0.5 + Math.cos(th) * 0.5, y: 0.5 + Math.sin(th) * 0.5 });
  }
  return pts;
}

/** Plantilla por defecto de un vértice nuevo del trazado: círculo lleno. */
export const PLANTILLA_SPLINE_DEFECTO: Polygon = circuloExacto(32);

/** Construye la malla del muelle (hélice con tubo redondo, eje Y). */
export function buildRoscaMesh(params: RoscaParams): Mesh {
  const nodes = construirMuestraHelix(params);
  if (nodes.length < 2) return { vertices: [], faces: [] };
  // La plantilla del tubo vive en 0..1: un círculo exacto de radio 0.5
  // (llena el lienzo) con escala = radioTubo da un tubo de radio exacto.
  return buildSpline3DMesh(nodes, {
    closed: false,
    subdivisions: 1, // el camino ya es denso, sin muestras intermedias
    escala: params.radioTubo,
  });
}

// ─── Sanitizado (.zeus) ─────────────────────────────────────────────────

const puntoNum = (n: unknown): number | null => {
  const x = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(x) ? x : null;
};

/**
 * Valida `spline` de cualquier fuente (proyecto .zeus). Devuelve undefined
 * si no sirve nada (el objeto queda con su malla horneada).
 */
export function validarSplineDatos(raw: unknown): SplineDatos | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.nodes)) return undefined;
  const nodes: SplineNode3D[] = [];
  for (const item of r.nodes.slice(0, 256)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (!o.p || typeof o.p !== 'object') continue;
    const pp = o.p as Record<string, unknown>;
    const x = puntoNum(pp.x);
    const y = puntoNum(pp.y);
    const z = puntoNum(pp.z);
    if (x === null || y === null || z === null) continue;
    const idN = puntoNum(o.id);
    const node: SplineNode3D = {
      p: { x, y, z },
      id: idN !== null ? idN : nodes.length,
    };
    if (o.esquina === true) node.esquina = true;
    if (typeof o.tilt === 'number' && Number.isFinite(o.tilt))
      node.tilt = Math.max(-360, Math.min(360, o.tilt));
    if (typeof o.tiltX === 'number' && Number.isFinite(o.tiltX))
      node.tiltX = Math.max(-360, Math.min(360, o.tiltX));
    if (typeof o.tiltY === 'number' && Number.isFinite(o.tiltY))
      node.tiltY = Math.max(-360, Math.min(360, o.tiltY));
    const escalaN = puntoNum(o.escala);
    if (escalaN !== null && escalaN > 0) node.escala = Math.max(0.01, Math.min(8, escalaN));
    if (Array.isArray(o.polygon)) {
      const poly: Polygon = [];
      for (const ptRaw of o.polygon) {
        if (Array.isArray(ptRaw) || !ptRaw || typeof ptRaw !== 'object') continue;
        const pto = ptRaw as Record<string, unknown>;
        const px = puntoNum(pto.x);
        const py = puntoNum(pto.y);
        if (px === null || py === null) continue;
        const punto: Point2D = { x: px, y: py };
        if (pto.hOut && typeof pto.hOut === 'object') {
          const h = pto.hOut as Record<string, unknown>;
          const hx = puntoNum(h.x);
          const hy = puntoNum(h.y);
          if (hx !== null && hy !== null) punto.hOut = { x: hx, y: hy };
        }
        if (pto.hIn && typeof pto.hIn === 'object') {
          const h = pto.hIn as Record<string, unknown>;
          const hx = puntoNum(h.x);
          const hy = puntoNum(h.y);
          if (hx !== null && hy !== null) punto.hIn = { x: hx, y: hy };
        }
        poly.push(punto);
      }
      if (poly.length >= 3) node.polygon = poly;
    }
    // Alineación mundial de la plantilla (la ventana donde se calcó con ⤢):
    // right/up se renormalizan; si alguno está podrido, se tira TODO el
    // anclaje (mejor el marco de siempre que un marco roto).
    if (o.baseMundo && typeof o.baseMundo === 'object') {
      const b = o.baseMundo as Record<string, unknown>;
      const v3 = (v: unknown): V3 | null => {
        if (!v || typeof v !== 'object') return null;
        const w = v as Record<string, unknown>;
        const vx = puntoNum(w.x);
        const vy = puntoNum(w.y);
        const vz = puntoNum(w.z);
        if (vx === null || vy === null || vz === null) return null;
        const p = { x: vx, y: vy, z: vz };
        if (Math.hypot(p.x, p.y, p.z) < 1e-9) return null;
        return vnorm(p);
      };
      const right = v3(b.right);
      const up = v3(b.up);
      const rxN = puntoNum(b.rx);
      const ryN = puntoNum(b.ry);
      if (right && up && rxN !== null && ryN !== null && rxN > 0 && ryN > 0) {
        node.baseMundo = {
          right,
          up,
          rx: Math.max(0.01, Math.min(32, rxN)),
          ry: Math.max(0.01, Math.min(32, ryN)),
        };
      }
    }
    nodes.push(node);
  }
  if (nodes.length < 2) return undefined;
  let closed = false;
  if (r.closed === true || r.closed === 'true') closed = true;
  const subdivisionsN = puntoNum(r.subdivisions);
  const escalaN = puntoNum(r.escala);
  const datos: SplineDatos = {
    nodes,
    closed,
    subdivisions:
      subdivisionsN !== null
        ? Math.max(1, Math.min(64, Math.round(subdivisionsN)))
        : 5,
    escala: escalaN !== null ? Math.max(0.01, Math.min(8, escalaN)) : 0.5,
    orientacion: r.orientacion === 'radial' ? 'radial' : undefined,
  };
  // Parámetros del muelle precargado (si los trae): clamps iguales a los
  // de la primitiva — sin ellos el panel del muelle no reaparece al
  // reeditar y el trazado pierde su origen.
  if (r.rosca && typeof r.rosca === 'object') {
    const c = r.rosca as Record<string, unknown>;
    const vueltas = puntoNum(c.vueltas);
    const vpv = puntoNum(c.verticesPorVuelta);
    const sep = puntoNum(c.separacion);
    const rm = puntoNum(c.radioMuelle);
    const rt = puntoNum(c.radioTubo);
    if (
      vueltas !== null && vpv !== null && sep !== null && rm !== null && rt !== null
    ) {
      const radioMuelle = Math.max(0.001, rm);
      datos.rosca = {
        vueltas: Math.max(1, Math.min(40, Math.round(vueltas))),
        verticesPorVuelta: Math.max(6, Math.min(128, Math.round(vpv))),
        separacion: Math.max(0.001, sep),
        radioMuelle,
        radioTubo: Math.max(0.005, Math.min(radioMuelle * 0.999, rt)),
      };
    }
  }
  return datos;
}