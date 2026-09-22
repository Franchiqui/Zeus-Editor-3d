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

/** Hash determinista basado en posición: mismos vértices → mismo valor. */
function hashPosicion(x: number, y: number, z: number, semilla: number): number {
  // Mezcla simple y estable (sin Math.random)
  let h = semilla * 374761393;
  h = (h + Math.imul(Math.round(x * 1000), 668265263)) | 0;
  h = (h + Math.imul(Math.round(y * 1000), 2147483647)) | 0;
  h = (h + Math.imul(Math.round(z * 1000), 1274126177)) | 0;
  // Normalizar a [0, 1)
  return ((h >>> 0) % 100000) / 100000;
}

export const fragmentar: ZeusPlugin = {
  id: 'fragmentar',
  nombre: 'Fragmentar',
  categoria: 'deformadores',
  descripcion: 'Separa los triángulos hacia fuera como si la malla explotara.',
  params: [
    {
      tipo: 'slider',
      id: 'distancia',
      etiqueta: 'Distancia de explosión',
      min: 0,
      max: 3,
      paso: 0.05,
      valor: 0.6,
      descripcion: 'Cuánto se separan los trozos desde el centro.',
    },
    {
      tipo: 'slider',
      id: 'dispersion',
      etiqueta: 'Dispersión',
      min: 0,
      max: 1,
      paso: 0.01,
      valor: 0.35,
      unidad: '%',
      descripcion: 'Variación aleatoria (determinista) por trozo.',
    },
    {
      tipo: 'select',
      id: 'modo',
      etiqueta: 'Dirección',
      opciones: [
        { valor: 'radial', etiqueta: 'Radial (desde el centro)' },
        { valor: 'normal', etiqueta: 'Normal (hacia fuera)' },
        { valor: 'eje', etiqueta: 'A lo largo del eje' },
      ],
      valor: 'radial',
    },
    {
      tipo: 'select',
      id: 'eje',
      etiqueta: 'Eje (solo modo eje)',
      opciones: [
        { valor: 'x', etiqueta: 'X' },
        { valor: 'y', etiqueta: 'Y' },
        { valor: 'z', etiqueta: 'Z' },
      ],
      valor: 'y',
    },
    {
      tipo: 'slider',
      id: 'semilla',
      etiqueta: 'Semilla',
      min: 1,
      max: 999,
      paso: 1,
      valor: 42,
      descripcion: 'Cambia el patrón de dispersión.',
    },
    {
      tipo: 'check',
      id: 'invertir',
      etiqueta: 'Invertir (implosión)',
      valor: false,
    },
  ],
  aplicar(mesh, params) {
    const distancia = num(params, 'distancia', 0.6);
    const dispersion = num(params, 'dispersion', 0.35);
    const modo = str(params, 'modo', 'radial');
    const eje = str(params, 'eje', 'y');
    const semilla = num(params, 'semilla', 42);
    const invertir = bool(params, 'invertir', false);

    // Sin distancia → nada que hacer (regla de oro nº 4)
    if (distancia === 0) return mesh;

    const signo = invertir ? -1 : 1;
    const fuerza = distancia * signo;

    // Centro de la caja envolvente (pivote de la explosión)
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
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;

    // Extensión para normalizar direcciones
    const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;

    const vertices = mesh.vertices.map((v) => {
      // Dirección base según modo
      let dx = 0, dy = 0, dz = 0;

      if (modo === 'normal') {
        // Aproximación: usamos la dirección desde el centro (no hay normales
        // por vértice en el Mesh). Es un "radial" suavizado.
        dx = (v.x - cx) / ext;
        dy = (v.y - cy) / ext;
        dz = (v.z - cz) / ext;
      } else if (modo === 'eje') {
        if (eje === 'x') dx = 1;
        else if (eje === 'y') dy = 1;
        else dz = 1;
      } else {
        // radial
        dx = (v.x - cx) / ext;
        dy = (v.y - cy) / ext;
        dz = (v.z - cz) / ext;
      }

      // Normalizamos la dirección (si no es nula)
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-9) {
        dx /= len;
        dy /= len;
        dz /= len;
      } else {
        // Vértice justo en el centro → lo empujamos en +Y por defecto
        dy = 1;
      }

      // Variación determinista por POSICIÓN (no por índice → vértices
      // coincidentes se mueven igual y la malla no se agrieta)
      const h = hashPosicion(v.x, v.y, v.z, semilla);
      const factor = 1 + (h - 0.5) * 2 * dispersion;

      const k = fuerza * factor;
      return {
        x: v.x + dx * k,
        y: v.y + dy * k,
        z: v.z + dz * k,
      };
    });

    return { ...mesh, vertices };
  },
};