import type { Mesh } from '@/lib/geometry';
import { smoothVoxelMesh } from '@/lib/mesh-smooth';
import { decimateMesh } from '@/lib/obj3d-thumbnails';
import type { ZeusPlugin, PluginParams } from '../types';

/**
 * Utilidades integradas: herramientas que reutilizan el procesado de
 * malla que Zeus ya tiene (suavizado Taubin, decimado) expuestas como
 * plugins de un clic.
 */

const num = (params: PluginParams, id: string, porDefecto = 0) => {
  const v = params[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : porDefecto;
};

/** Suaviza aristas y escalones (redondea la figura sin encogerla). */
const suavizar: ZeusPlugin = {
  id: 'suavizar',
  nombre: 'Suavizar aristas',
  categoria: 'utilidades',
  descripcion:
    'Redondea aristas y escalones (suavizado Taubin). Ideal en figuras de vóxeles.',
  params: [
    {
      tipo: 'slider',
      id: 'iteraciones',
      etiqueta: 'Intensidad',
      min: 1,
      max: 10,
      paso: 1,
      valor: 3,
    },
  ],
  aplicar(mesh, params) {
    const iteraciones = Math.max(1, Math.round(num(params, 'iteraciones', 3)));
    return smoothVoxelMesh(mesh, iteraciones);
  },
};

/** Reduce el número de caras de la malla (malla más ligera). */
const decimar: ZeusPlugin = {
  id: 'decimar',
  nombre: 'Reducir caras (Decimar)',
  categoria: 'utilidades',
  descripcion:
    'Simplifica la malla quedándose con las caras más importantes. Acelera la escena.',
  params: [
    {
      tipo: 'slider',
      id: 'maxCaras',
      etiqueta: 'Caras destino',
      min: 100,
      max: 20000,
      paso: 100,
      valor: 2000,
    },
  ],
  aplicar(mesh, params) {
    const maxCaras = Math.max(50, Math.round(num(params, 'maxCaras', 2000)));
    return decimateMesh(mesh, maxCaras);
  },
};

export const UTILIDADES: ZeusPlugin[] = [suavizar, decimar];