import type { Mesh } from '@/lib/geometry';
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

/**
 * Dobla la malla alrededor de un eje. El "ángulo" es el giro total
 * aplicado a lo largo de la extensión del eje elegido, con el pivote
 * en el centro de la caja envolvente.
 */
export const doblarEje: ZeusPlugin = {
  id: 'doblar-eje',
  nombre: 'Doblar por eje',
  categoria: 'deformadores',
  descripcion: 'Curva la malla alrededor de un eje (arco, tubería, cinta).',
  params: [
    {
      tipo: 'slider',
      id: 'angulo',
      etiqueta: 'Ángulo total',
      min: -360,
      max: 360,
      paso: 5,
      valor: 90,
      unidad: '°',
    },
    {
      tipo: 'select',
      id: 'eje',
      etiqueta: 'Eje de curvatura',
      opciones: [
        { valor: 'x', etiqueta: 'X (curva en YZ)' },
        { valor: 'y', etiqueta: 'Y (curva en XZ)' },
        { valor: 'z', etiqueta: 'Z (curva en XY)' },
      ],
      valor: 'y',
    },
    {
      tipo: 'slider',
      id: 'centro',
      etiqueta: 'Centro del arco',
      min: 0,
      max: 1,
      paso: 0.01,
      valor: 0.5,
      descripcion: 'Dónde empieza a curvarse a lo largo del eje (0 = inicio, 1 = fin).',
    },
    {
      tipo: 'check',
      id: 'invertir',
      etiqueta: 'Invertir dirección',
      valor: false,
    },
  ],
  aplicar(mesh, params) {
    const anguloGrados = num(params, 'angulo', 90);
    const eje = str(params, 'eje', 'y');
    const centro = Math.min(1, Math.max(0, num(params, 'centro', 0.5)));
    const invertir = bool(params, 'invertir', false);

    // Sin ángulo → nada que hacer
    if (anguloGrados === 0) return mesh;

    const signo = invertir ? -1 : 1;
    const angulo = (anguloGrados * signo * Math.PI) / 180;

    // Caja envolvente para saber la extensión a lo largo del eje
    let min = Infinity;
    let max = -Infinity;
    for (const v of mesh.vertices) {
      const c = eje === 'x' ? v.x : eje === 'y' ? v.y : v.z;
      if (c < min) min = c;
      if (c > max) max = c;
    }
    const extension = max - min;

    // Caja degenerada → devolver intacta (regla de oro nº 4)
    if (!Number.isFinite(extension) || extension < 1e-9) return mesh;

    // Pivote en el centro de la caja a lo largo del eje
    const pivote = min + extension * centro;

    const vertices = mesh.vertices.map((v) => {
      const coord = eje === 'x' ? v.x : eje === 'y' ? v.y : v.z;

      // t = 0 en el pivote, negativo antes, positivo después
      const t = (coord - pivote) / extension;

      // Radio de curvatura: radio = extension / |angulo|
      const radio = extension / Math.abs(angulo);
      const theta = t * angulo;

      // Descomponemos las dos coordenadas perpendiculares al eje
      let a: number;
      let b: number;
      if (eje === 'x') {
        a = v.y;
        b = v.z;
      } else if (eje === 'y') {
        a = v.x;
        b = v.z;
      } else {
        a = v.x;
        b = v.y;
      }

      // Rotamos (a, b) alrededor del centro del arco (0, radio) en el
      // plano perpendicular, y desplazamos para mantener el pivote fijo.
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);

      // Coordenadas relativas al centro del arco
      const ra = a;
      const rb = b - radio;

      // Rotación en el plano (a, b)
      const na = ra * cos - rb * sin;
      const nb = ra * sin + rb * cos;

      // Volvemos al sistema original
      const aFinal = na;
      const bFinal = nb + radio;

      // Reconstruimos el vértice
      if (eje === 'x') {
        return { x: v.x, y: aFinal, z: bFinal };
      }
      if (eje === 'y') {
        return { x: aFinal, y: v.y, z: bFinal };
      }
      return { x: aFinal, y: bFinal, z: v.z };
    });

    return { ...mesh, vertices };
  },
};