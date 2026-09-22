/**
 * Punto de entrada del sistema de plugins de Zeus Editor 3D.
 *
 * Importar este módulo registra los plugins integrados en el registro
 * (registry.ts). El editor importa desde aquí y el modal «Plugins»
 * consume la lista desde el registro, así que añadir un plugin nuevo
 * es: escribirlo en lib/plugins/builtin/ y añadirlo al registro abajo.
 */

import { registrarPlugin } from './registry';
import { DEFORMADORES } from './builtin/deformadores';
import { UTILIDADES } from './builtin/utilidades';

export type {
  ZeusPlugin,
  PluginParam,
  PluginParams,
  PluginCategoria,
} from './types';
export {
  registrarPlugin,
  quitarPlugin,
  obtenerPlugin,
  listarPlugins,
  suscribirsePlugins,
} from './registry';

let registrado = false;

/** Registra los plugins integrados (idempotente). */
export function registrarPluginsIntegrados(): void {
  if (registrado) return;
  registrado = true;
  for (const p of [...DEFORMADORES, ...UTILIDADES]) registrarPlugin(p);
}

// Auto-registro al importar: cualquier módulo que importe
// '@/lib/plugins' ve la lista completa sin pasos extra.
registrarPluginsIntegrados();