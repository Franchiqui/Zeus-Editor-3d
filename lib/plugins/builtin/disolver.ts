import type { Mesh, Vertex3D } from '@/lib/geometry';
import type { ZeusPlugin, PluginParams } from '../types';

const num = (params: PluginParams, id: string, porDefecto = 0) => {
  const v = params[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : porDefecto;
};

const str = (params: PluginParams, id: string, porDefecto = '') => {
  const v = params[id];
  return typeof v === 'string' ? v : porDefecto;
};

const bool = (params: PluginParams, id: string, porDefecto = false) => {
  const v = params[id];
  return typeof v === 'boolean' ? v : porDefecto;
};

/** Hash determinista basado en posición y semilla (sin Math.random). */
function hashDisolver(x: number, y: number, z: number, semilla: number): number {
  let h = semilla * 374761393;
  h = (h + Math.imul(Math.round(x * 1000), 668265263)) | 0;
  h = (h + Math.imul(Math.round(y * 1000), 2147483647)) | 0;
  h = (h + Math.imul(Math.round(z * 1000), 1274126177)) | 0;
  return ((h >>> 0) % 100000) / 100000;
}

type Eje = 'x' | 'y' | 'z';

const EJES: Array<{ valor: Eje; etiqueta: string }> = [
  { valor: 'x', etiqueta: 'X (desde el suelo)' },
  { valor: 'y', etiqueta: 'Y (vertical)' },
  { valor: 'z', etiqueta: 'Z (profundidad)' },
];

const leerEje = (v: Vertex3D, e: Eje) =>
  e === 'x' ? v.x : e === 'y' ? v.y : v.z;

const ejeDe = (params: PluginParams, id: string, porDefecto: Eje): Eje => {
  const v = params[id];
  return v === 'x' || v === 'y' || v === 'z' ? v : porDefecto;
};

/**
 * Disolución progresiva: hace desaparecer caras de la malla a lo largo de un
 * eje, con ruido determinista para un patrón irregular. Las caras que ya
 * estaban visibles conservan su opacidad original; las disueltas pasan a 0.
 *
 * Es un efecto visual (manipula faceOpacities, no vértices), ideal para
 * animaciones de aparición/desaparición, teletransporte, desintegración,
 * o como mágia/energía que consume la geometría.
 */
export const disolver: ZeusPlugin = {
  id: 'disolver',
  nombre: 'Disolver',
  categoria: 'efectos',
  descripcion: 'Hace desaparecer la malla progresivamente con un efecto de desintegración.',
  params: [
    {
      tipo: 'slider',
      id: 'umbral',
      etiqueta: 'Progreso de disolución',
      min: 0,
      max: 100,
      paso: 1,
      valor: 50,
      unidad: '%',
      descripcion: 'Qué parte de la malla ha desaparecido (0 = intacta, 100 = total).',
    },
    {
      tipo: 'select',
      id: 'eje',
      etiqueta: 'Dirección de disolución',
      opciones: EJES,
      valor: 'y',
    },
    {
      tipo: 'select',
      id: 'sentido',
      etiqueta: 'Sentido',
      opciones: [
        { valor: 'inicio', etiqueta: 'Desde la base' },
        { valor: 'fin', etiqueta: 'Desde la cima' },
      ],
      valor: 'inicio',
    },
    {
      tipo: 'slider',
      id: 'ruido',
      etiqueta: 'Ruido de disolución',
      min: 0,
      max: 100,
      paso: 1,
      valor: 30,
      unidad: '%',
      descripcion: 'Variación aleatoria (determinista) en el patrón de disolución.',
    },
    {
      tipo: 'slider',
      id: 'semilla',
      etiqueta: 'Semilla',
      min: 1,
      max: 999,
      paso: 1,
      valor: 42,
      descripcion: 'Cambia el patrón de disolución.',
    },
    {
      tipo: 'check',
      id: 'invertir',
      etiqueta: 'Invertir dirección',
      valor: false,
    },
  ],
  aplicar(mesh, params) {
    const umbral = num(params, 'umbral', 50) / 100;
    const eje = ejeDe(params, 'eje', 'y');
    const sentido = str(params, 'sentido', 'inicio');
    const ruido = num(params, 'ruido', 30) / 100;
    const semilla = num(params, 'semilla', 42);
    const invertir = bool(params, 'invertir', false);

    // Sin umbral → nada disuelto → malla intacta (regla de oro nº 4)
    if (umbral <= 0) return mesh;
    if (mesh.faces.length === 0) return mesh;

    // Disolución total: con ruido el umbral de algunas caras queda por
    // debajo de 1 y quedarían restos visibles. Al 100% se va todo sí o sí.
    if (umbral >= 1) {
      return { ...mesh, faceOpacities: mesh.faces.map(() => 0) };
    }

    // Caja envolvente a lo largo del eje elegido
    let min = Infinity;
    let max = -Infinity;
    for (const v of mesh.vertices) {
      const c = leerEje(v, eje);
      if (c < min) min = c;
      if (c > max) max = c;
    }
    const extension = max - min;
    // Caja degenerada → no se puede normalizar (regla de oro nº 4)
    if (!Number.isFinite(extension) || extension < 1e-9) return mesh;

    // Zona de transición suave (proporcional al ruido + un mínimo fijo)
    const zonaSuave = ruido * 0.25 + 0.02;

    // El ruido se desvanece en los extremos del progreso (margen = 0 en
    // 0% y 100%): garantiza intacta al 0% y total al 100% con cualquier
    // ruido, y el patrón irregular solo manda en la zona intermedia.
    const margen = Math.max(0, Math.min(1, Math.min(umbral, 1 - umbral) * 2));
    const ruidoEfectivo = ruido * margen;

    const faceOpacities: number[] = mesh.faces.map((face, i) => {
      // Centroides de la cara
      let sx = 0, sy = 0, sz = 0;
      for (const idx of face) {
        const v = mesh.vertices[idx];
        sx += v.x;
        sy += v.y;
        sz += v.z;
      }
      const n = face.length;
      const cx = sx / n;
      const cy = sy / n;
      const cz = sz / n;

      // Posición normalizada 0..1 a lo largo del eje
      let t = (leerEje({ x: cx, y: cy, z: cz }, eje) - min) / extension;
      t = Math.max(0, Math.min(1, t));

      // Sentido: desde la base o desde la cima
      if (sentido === 'fin') t = 1 - t;
      if (invertir) t = 1 - t;

      // Ruido determinista (variación del umbral por cara)
      const h = hashDisolver(cx, cy, cz, semilla);
      const umbralConRuido = umbral + (h - 0.5) * 2 * ruidoEfectivo;

      // Opacidad base (preservar la original si existe)
      const base = mesh.faceOpacities?.[i] ?? 1;

      if (t < umbralConRuido - zonaSuave) {
        // Disuelta
        return 0;
      } else if (t > umbralConRuido + zonaSuave) {
        // Visible: preservar opacidad original
        return base;
      } else {
        // Zona de transición (borde suave)
        const s = zonaSuave * 2;
        const progreso = (t - (umbralConRuido - zonaSuave)) / s;
        return base * Math.max(0, Math.min(1, progreso));
      }
    });

    return { ...mesh, faceOpacities };
  },
};
