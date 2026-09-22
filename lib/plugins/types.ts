import type { Mesh } from '@/lib/geometry';

/**
 * Contrato de plugins de Zeus Editor 3D.
 *
 * Un plugin es una herramienta que transforma la malla de un objeto de
 * la escena (el equivalente libre de un modificador de 3ds Max: Bend,
 * Twist, Taper, Noise…). Zeus lo descubre a través del registro
 * (lib/plugins/registry.ts), lo muestra en el modal «Plugins» con su UI
 * de parámetros generada automáticamente y le pasa la malla del objeto
 * elegido cuando el usuario pulsa Aplicar.
 */

/** Definición de un control de la UI del plugin. */
export type PluginParam =
  /** Deslizador numérico (el valor viaja como number). */
  | {
      tipo: 'slider';
      id: string;
      etiqueta: string;
      min: number;
      max: number;
      paso?: number;
      valor: number;
      /** Unidad mostrada junto al valor (°, %, cm…). */
      unidad?: string;
      /** Texto de ayuda opcional mostrado bajo el control. */
      descripcion?: string;
    }
  /** Lista de opciones (el valor viaja como string). */
  | {
      tipo: 'select';
      id: string;
      etiqueta: string;
      opciones: Array<{ valor: string; etiqueta: string }>;
      valor: string;
    }
  /** Casilla on/off (el valor viaja como boolean). */
  | {
      tipo: 'check';
      id: string;
      etiqueta: string;
      descripcion?: string;
      valor: boolean;
    };

/** Valores actuales de los parámetros, indexados por su `id`. */
export type PluginParams = Record<string, number | string | boolean>;

/** Categorías bajo las que se agrupan los plugins en el modal. */
export type PluginCategoria =
  | 'deformadores'
  | 'utilidades'
  | (string & {});

export type ZeusPlugin = {
  /** Identificador único (estable, en kebab-case). */
  id: string;
  /** Nombre visible en el modal. */
  nombre: string;
  categoria: PluginCategoria;
  /** Descripción corta de lo que hace (una línea). */
  descripcion: string;
  /**
   * Definición de los controles del panel. El orden aquí es el orden en
   * la UI; los valores iniciales son los que viajan a `aplicar` si el
   * usuario no los toca.
   */
  params: PluginParam[];
  /**
   * Aplica el efecto sobre una copia de la malla del objeto y devuelve
   * la malla resultante. NO debe mutar la malla recibida: el editor
   * guarda la original en el historial (deshacer/rehacer).
   *
   * La malla llega en el espacio local del objeto (sin su transformada),
   * igual que la usan las booleanas.
   */
  aplicar: (mesh: Mesh, params: PluginParams) => Mesh;
};