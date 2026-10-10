import type { Mesh, Vertex3D } from '@/lib/geometry';
import type { ZeusPlugin, PluginParams } from '../types';

/**
 * Deformadores integrados: los equivalentes libres de los modificadores
 * clásicos de 3ds Max (Bend, Twist, Taper, Noise). Todos operan igual:
 * recorren los vértices de la malla en su espacio local y los reubican
 * según su posición dentro de la caja envolvente. Caras, colores y
 * texturas por cara se conservan intactos.
 */

type Eje = 'x' | 'y' | 'z';

const EJES: Array<{ valor: Eje; etiqueta: string }> = [
  { valor: 'x', etiqueta: 'X (horizontal)' },
  { valor: 'y', etiqueta: 'Y (vertical)' },
  { valor: 'z', etiqueta: 'Z (profundidad)' },
];

const leerEje = (v: Vertex3D, e: Eje) =>
  e === 'x' ? v.x : e === 'y' ? v.y : v.z;

/** Escribe `valor` en el eje dado (copia mutada del vértice nuevo). */
function conEje(v: Vertex3D, e: Eje, valor: number): Vertex3D {
  const copia = { ...v };
  if (e === 'x') copia.x = valor;
  else if (e === 'y') copia.y = valor;
  else copia.z = valor;
  return copia;
}

/** Los dos ejes transversales al dado, en orden. */
function ejesTransversales(e: Eje): [Eje, Eje] {
  if (e === 'x') return ['y', 'z'];
  if (e === 'y') return ['x', 'z'];
  return ['x', 'y'];
}

function caja(mesh: Mesh, e: Eje) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of mesh.vertices) {
    const a = leerEje(v, e);
    if (a < min) min = a;
    if (a > max) max = a;
  }
  return { min, max, centro: (min + max) / 2, extension: max - min };
}

const num = (params: PluginParams, id: string, porDefecto = 0) => {
  const v = params[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : porDefecto;
};

const ejeDe = (params: PluginParams, id: string, porDefecto: Eje): Eje => {
  const v = params[id];
  return v === 'x' || v === 'y' || v === 'z' ? v : porDefecto;
};

/**
 * Doblar (como el modificador Bend, en versión «abanico»): el eje
 * elegido se curva en un arco de radio constante. El ángulo es el giro
 * TOTAL entre la base y la cima del objeto. Con suficiente segmentación
 * alcanza desde un pequeño vuelco hasta el arco de medio punto
 * (180°) o un círculo entero (360°).
 *
 * DIÁMETRO: 0 = automático (el arco gasta exactamente la longitud del
 * objeto, sin estirar — como el Bend clásico). Con un valor, el arco
 * adopta ESE diámetro (en % de la longitud del objeto) y el objeto se
 * estira o encoge along-the-arc (factor k = R·θ/L) para seguirlo:
 * medio punto pide ≈64% y un círculo ≈32%.
 */
const doblar: ZeusPlugin = {
  id: 'doblar',
  nombre: 'Doblar (Bend)',
  categoria: 'deformadores',
  descripcion: 'Curva la figura en un arco a lo largo del eje elegido.',
  params: [
    {
      tipo: 'slider',
      id: 'angulo',
      etiqueta: 'Ángulo total',
      min: -720,
      max: 720,
      paso: 1,
      valor: 45,
      unidad: '°',
    },
    {
      tipo: 'slider',
      id: 'diametro',
      etiqueta: 'Diámetro de la curva',
      min: 0,
      max: 500,
      paso: 5,
      valor: 0,
      unidad: '%',
      descripcion:
        '0 = automático (el propio objeto manda). Si lo tocas, el arco usa ESE diámetro (% de la longitud del objeto) y el objeto se estira o encoge para seguirlo: medio punto ≈ 64, círculo entero ≈ 32.',
    },
    {
      tipo: 'select',
      id: 'eje',
      etiqueta: 'Eje de curvatura',
      opciones: EJES,
      valor: 'y',
    },
  ],
  aplicar(mesh, params) {
    const anguloDeg = num(params, 'angulo', 45);
    const eje = ejeDe(params, 'eje', 'y');
    const theta = (anguloDeg * Math.PI) / 180;
    const cajaEje = caja(mesh, eje);
    if (Math.abs(theta) < 1e-6 || cajaEje.max - cajaEje.min < 1e-9) {
      return mesh;
    }

    const [e1] = ejesTransversales(eje);
    const extent = cajaEje.max - cajaEje.min;
    const diametroPct = num(params, 'diametro', 0);
    // Radio AUTOMÁTICO: R = L/θ (el arco gasta la longitud exacta —
    // sin estirar). Manual (diámetro, % de la longitud L): R = D%·L/200.
    //
    // El radio manual NUNCA baja del AUTOMÁTICO: R = max(R_manual, L/θ).
    // El manual puro aplasta la malla entera en un arco diminuto cuando θ
    // (y el diámetro animado) salen de 0: la columna se desploma a un
    // bulto pegado al suelo y va creciendo con el ángulo — «semilla que
    // echa raíces» (reproducido con columna-anim-check.mjs). Con el max,
    // con θ chico manda el auto (doblado clásico k=1) y el manual solo
    // manda cuando pide un arco MÁS ANCHO que el material permite (estira
    // el objeto para seguirlo). En θ→0 el manual→0 converge con el auto:
    // animar diametro desde su neutro 0 es CONTINUO, sin salto.
    const RManual = diametroPct > 0 ? (diametroPct / 200) * extent : 0;
    const R = Math.max(RManual, extent / theta);
    // Estiramiento a lo largo del arco para calar en el radio pedido:
    // k = R·θ/L. R auto → k = 1 (comportamiento clásico sin estirar);
    // R manual (> auto) → estira la malla para cubrir el arco ancho.
    const k = (R * theta) / extent;
    if (!Number.isFinite(R) || R < 1e-9) return mesh;
    const centroTransversal = caja(mesh, e1).centro;

    const vertices = mesh.vertices.map((v) => {
      // s: avance del vértice por el arco desde la base (0 abajo), ya
      // reescalado por k; d: separación respecto al eje de curvatura en
      // el eje transversal — se vuelve RADIAL (radio R − d: los puntos
      // de +e1 quedan más cerca del centro del arco).
      const s = (leerEje(v, eje) - cajaEje.min) * k;
      const d = leerEje(v, e1) - centroTransversal;
      const phi = s / R;
      // Arco de curvatura con la BASE FIJA: la cruz de la base no se
      // mueve; el objeto se alza como un abanico curvándose hacia +e1.
      // d2/h2: punto (d, s) envuelto en el círculo de radio R cuyo
      // centro queda al nivel de la base, a distancia R hacia +e1.
      const radial = R - d;
      const d2 = R - radial * Math.cos(phi);
      const h2 = radial * Math.sin(phi);
      let nuevo = conEje(v, eje, cajaEje.min + h2);
      nuevo = conEje(nuevo, e1, centroTransversal + d2);
      return nuevo;
    });

    return { ...mesh, vertices };
  },
};

/**
 * Torsión (como el modificador Twist): gira la sección transversal de
 * forma progresiva a lo largo del eje elegido.
 */
const torcionar: ZeusPlugin = {
  id: 'torcer',
  nombre: 'Torsión (Twist)',
  categoria: 'deformadores',
  descripcion: 'Gira la figura progresivamente alrededor del eje elegido.',
  params: [
    {
      tipo: 'slider',
      id: 'angulo',
      etiqueta: 'Ángulo total',
      min: -720,
      max: 720,
      paso: 1,
      valor: 90,
      unidad: '°',
    },
    {
      tipo: 'select',
      id: 'eje',
      etiqueta: 'Eje de giro',
      opciones: EJES,
      valor: 'y',
    },
  ],
  aplicar(mesh, params) {
    const anguloDeg = num(params, 'angulo', 90);
    const eje = ejeDe(params, 'eje', 'y');
    const theta = (anguloDeg * Math.PI) / 180;
    const cajaEje = caja(mesh, eje);
    if (Math.abs(theta) < 1e-6 || cajaEje.max - cajaEje.min < 1e-9) {
      return mesh;
    }

    const [e1, e2] = ejesTransversales(eje);
    const c1 = caja(mesh, e1).centro;
    const c2 = caja(mesh, e2).centro;

    const vertices = mesh.vertices.map((v) => {
      // 0..1 según la altura del vértice en el eje de giro
      const t =
        (leerEje(v, eje) - cajaEje.min) / (cajaEje.max - cajaEje.min);
      const phi = theta * t;
      const cos = Math.cos(phi);
      const sin = Math.sin(phi);
      const d1 = leerEje(v, e1) - c1;
      const d2 = leerEje(v, e2) - c2;
      let nuevo = conEje(v, e1, c1 + d1 * cos - d2 * sin);
      nuevo = conEje(nuevo, e2, c2 + d1 * sin + d2 * cos);
      return nuevo;
    });

    return { ...mesh, vertices };
  },
};

/**
 * Afilado (como el modificador Taper): escala la sección transversal de
 * forma progresiva, de un factor a otro entre la base y la cima.
 */
const afilar: ZeusPlugin = {
  id: 'afilar',
  nombre: 'Afilado (Taper)',
  categoria: 'deformadores',
  descripcion: 'Engorda o afina la figura de forma progresiva por un extremo.',
  params: [
    {
      tipo: 'slider',
      id: 'escalaInicio',
      etiqueta: 'Escala en la base',
      min: 1,
      max: 300,
      paso: 1,
      valor: 100,
      unidad: '%',
    },
    {
      tipo: 'slider',
      id: 'escalaFin',
      etiqueta: 'Escala en la cima',
      min: 1,
      max: 300,
      paso: 1,
      valor: 30,
      unidad: '%',
    },
    {
      tipo: 'select',
      id: 'eje',
      etiqueta: 'Eje de afilado',
      opciones: EJES,
      valor: 'y',
    },
  ],
  aplicar(mesh, params) {
    const fInicio = num(params, 'escalaInicio', 100) / 100;
    const fFin = num(params, 'escalaFin', 30) / 100;
    const eje = ejeDe(params, 'eje', 'y');
    const cajaEje = caja(mesh, eje);
    if (cajaEje.max - cajaEje.min < 1e-9) return mesh;

    const [e1, e2] = ejesTransversales(eje);
    const c1 = caja(mesh, e1).centro;
    const c2 = caja(mesh, e2).centro;

    const vertices = mesh.vertices.map((v) => {
      const t =
        (leerEje(v, eje) - cajaEje.min) / (cajaEje.max - cajaEje.min);
      const f = fInicio + (fFin - fInicio) * t;
      let nuevo = conEje(v, e1, c1 + (leerEje(v, e1) - c1) * f);
      nuevo = conEje(nuevo, e2, c2 + (leerEje(v, e2) - c2) * f);
      return nuevo;
    });

    return { ...mesh, vertices };
  },
};

/**
 * Ruido (como el modificador Noise): desplaza cada vértice con ondas
 * suaves superpuestas, para rugosidad, terreno o superficies orgánicas.
 */
const ruido: ZeusPlugin = {
  id: 'ruido',
  nombre: 'Ruido (Noise)',
  categoria: 'deformadores',
  descripcion: 'Deforma la superficie con ondas suaves (rugosidad orgánica).',
  params: [
    {
      tipo: 'slider',
      id: 'amplitud',
      etiqueta: 'Amplitud',
      min: 0,
      max: 200,
      paso: 1,
      valor: 20,
      unidad: '%',
    },
    {
      tipo: 'slider',
      id: 'escala',
      etiqueta: 'Tamaño de la onda',
      min: 1,
      max: 100,
      paso: 1,
      valor: 25,
      unidad: '%',
    },
    {
      tipo: 'slider',
      id: 'semilla',
      etiqueta: 'Semilla',
      min: 0,
      max: 999,
      paso: 1,
      valor: 7,
    },
    {
      tipo: 'check',
      id: 'deformarEjes',
      etiqueta: 'Deformar en los 3 ejes',
      descripcion:
        'Si se desactiva, el desplazamiento solo empuja hacia arriba (útil para terrenos).',
      valor: true,
    },
  ],
  aplicar(mesh, params) {
    const amplitud = num(params, 'amplitud', 20) / 100;
    const escala = num(params, 'escala', 25) / 100 + 0.01;
    const semilla = num(params, 'semilla', 7);
    const tresEjes = params['deformarEjes'] !== false;
    if (amplitud <= 0) return mesh;

    // Ondas senoidales de distintas frecuencias: suaves, deterministas
    // (misma semilla = mismo resultado) y baratas de calcular.
    const f1 = 0.045 / escala;

    const vertices = mesh.vertices.map((v) => {
      const px = v.x * f1 + semilla * 12.9898;
      const py = v.y * f1 + semilla * 78.233;
      const pz = v.z * f1 + semilla * 37.719;
      const dx = Math.sin(py) * Math.cos(pz * 1.31);
      const dy = Math.sin(pz) * Math.cos(px * 1.17);
      const dz = Math.sin(px) * Math.cos(py * 1.43);
      if (tresEjes) {
        return {
          x: v.x + dx * amplitud,
          y: v.y + dy * amplitud,
          z: v.z + dz * amplitud,
        };
      }
      // Solo vertical: desplazamiento por Y (apto para terrenos)
      return {
        x: v.x,
        y: v.y + dy * amplitud,
        z: v.z,
      };
    });

    return { ...mesh, vertices };
  },
};

export const DEFORMADORES: ZeusPlugin[] = [doblar, torcionar, afilar, ruido];