import type { ZeusPlugin, PluginCategoria } from './types';

/**
 * Registro de plugins de Zeus Editor 3D.
 *
 * Los plugins se dan de alta aquí (los integrados en lib/plugins/index.ts
 * al importar el módulo; en el futuro, los que cargue el usuario) y el
 * modal «Plugins» lee la lista desde aquí. El registro notifica a sus
 * suscriptores cuando cambia, así la UI se refresca sin recargar.
 */

const plugins = new Map<string, ZeusPlugin>();
const suscriptores = new Set<() => void>();
/**
 * Lista cacheada para useSyncExternalStore: getSnapshot debe devolver
 * SIEMPRE la misma referencia entre cambios, o React entra en bucle.
 */
let listaCacheada: ZeusPlugin[] | null = null;

function notificar() {
  listaCacheada = null;
  for (const fn of suscriptores) fn();
}

/** Da de alta un plugin. Si el id ya existía, lo sustituye. */
export function registrarPlugin(plugin: ZeusPlugin): void {
  if (!plugin.id || typeof plugin.aplicar !== 'function') {
    // Un plugin mal formado no debe tumbar el editor: se ignora.
    console.warn('[plugins] Plugin inválido descartado:', plugin);
    return;
  }
  plugins.set(plugin.id, plugin);
  notificar();
}

/** Quita un plugin del registro (por si el usuario desactiva el suyo). */
export function quitarPlugin(id: string): void {
  if (plugins.delete(id)) notificar();
}

/** Busca un plugin por id (para ejecutarlo sin listar la UI). */
export function obtenerPlugin(id: string): ZeusPlugin | undefined {
  return plugins.get(id);
}

/** Todos los plugins registrados, agrupados por categoría y ordenados. */
export function listarPlugins(): ZeusPlugin[] {
  if (listaCacheada) return listaCacheada;
  const ordenCategorias: string[] = ['deformadores', 'utilidades', 'efectos'];
  const categorias = new Set<PluginCategoria>();
  for (const p of plugins.values()) categorias.add(p.categoria);
  const ordenadas = [...categorias].sort(
    (a, b) =>
      (ordenCategorias.indexOf(a) + 1 || ordenCategorias.length + 1) -
      (ordenCategorias.indexOf(b) + 1 || ordenCategorias.length + 1)
  );
  const lista: ZeusPlugin[] = [];
  for (const cat of ordenadas) {
    for (const p of plugins.values()) {
      if (p.categoria === cat) lista.push(p);
    }
  }
  listaCacheada = lista;
  return lista;
}

/** Se suscribe a cambios del registro (para useSyncExternalStore). */
export function suscribirsePlugins(fn: () => void): () => void {
  suscriptores.add(fn);
  return () => suscriptores.delete(fn);
}