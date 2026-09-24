'use client';

import React, { useState, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Modal } from '@/components/ui/modal';
import { Slider } from '@/components/ui/slider';
import {
  Puzzle,
  Sparkles,
  Wrench,
  AlertCircle,
  Loader2,
  Info,
  Check,
} from 'lucide-react';
import {
  listarPlugins,
  suscribirsePlugins,
  obtenerPlugin,
  DESTINO_NUEVO_OBJETO,
  type ZeusPlugin,
  type PluginParams,
} from '@/lib/plugins';
import { useI18n } from '@/lib/i18n';

interface PluginsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Objetos de la escena a los que se puede aplicar un plugin. */
  sceneObjects: Array<{ id: string }>;
  selectedObjectId: string | null;
  /**
   * Aplica el plugin al objeto elegido. El editor resuelve la malla,
   * ejecuta `aplicar`, guarda el resultado en el objeto y lo mete en el
   * historial. Devolver false indica error (el modal no se cierra).
   *
   * Si `targetObjectId` es `DESTINO_NUEVO_OBJETO`, el editor crea un
   * objeto nuevo con la malla que devuelva el plugin (generadores).
   */
  onApply: (params: {
    pluginId: string;
    targetObjectId: string;
    valores: PluginParams;
  }) => Promise<boolean | void> | boolean | void;
}

/** Etiqueta de categoría traducida; las categorías nuevas salen tal cual. */
function etiquetaCategoria(
  categoria: string,
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  const clave = `editor3D.plugins.cat${categoria.charAt(0).toUpperCase()}${categoria.slice(1)}`;
  const traducida = t(clave);
  return traducida === clave ? categoria : traducida;
}

/** Icono por categoría (fallback: engranaje). */
function IconoCategoria({ categoria }: { categoria: string }) {
  if (categoria === 'deformadores') {
    return <Sparkles className="w-4 h-4" />;
  }
  if (categoria === 'utilidades') {
    return <Wrench className="w-4 h-4" />;
  }
  return <Puzzle className="w-4 h-4" />;
}

/**
 * Modal «Plugins»: lista las herramientas registradas en
 * lib/plugins/registry.ts agrupadas por categoría, genera su panel de
 * parámetros a partir de la definición del plugin y aplica el resultado
 * sobre el objeto de la escena elegido. Los plugins generadores pueden
 * además crear un objeto nuevo desde cero.
 */
export default function PluginsModal({
  isOpen,
  onClose,
  sceneObjects,
  selectedObjectId,
  onApply,
}: PluginsModalProps) {
  const { t } = useI18n();
  // La lista se lee del registro con useSyncExternalStore: si un plugin
  // se registra en caliente, el modal se refresca solo.
  const plugins = useSyncExternalStore(
    suscribirsePlugins,
    listarPlugins,
    listarPlugins
  );

  const [pluginId, setPluginId] = useState<string>('');
  const [valores, setValores] = useState<PluginParams>({});
  const [targetId, setTargetId] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const plugin: ZeusPlugin | undefined = pluginId
    ? obtenerPlugin(pluginId)
    : undefined;
  // ¿El plugin elegido sabe generar la malla desde cero?
  const esGenerador = !!plugin?.generador;

  // Al abrir (o cambiar la lista): plugin por defecto = el primero;
  // objeto destino = el activo si existe, si no el primero. Para los
  // plugins generadores el destino por defecto es «Nuevo objeto».
  useEffect(() => {
    if (!isOpen) return;
    if (!pluginId && plugins.length > 0) setPluginId(plugins[0].id);
    const pluginInicial = pluginId ? obtenerPlugin(pluginId) : plugins[0];
    const inicial = pluginInicial?.generador
      ? DESTINO_NUEVO_OBJETO
      : selectedObjectId && sceneObjects.some((o) => o.id === selectedObjectId)
        ? selectedObjectId
        : sceneObjects[0]?.id ?? '';
    setTargetId(inicial);
    setErrorMessage(null);
    setIsProcessing(false);
    // `pluginId` NO va en dependencias: solo inicializamos al abrir,
    // nunca al cambiar de plugin (el usuario ya eligió).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, plugins.length, selectedObjectId, sceneObjects]);

  // Al cambiar de plugin se restauran los valores por defecto y se ajusta
  // el destino: los generadores apuntan a «Nuevo objeto», el resto a un
  // objeto de la escena (el seleccionado o el primero).
  useEffect(() => {
    if (!plugin) return;
    const iniciales: PluginParams = {};
    for (const p of plugin.params) iniciales[p.id] = p.valor;
    setValores(iniciales);
    if (plugin.generador) {
      setTargetId(DESTINO_NUEVO_OBJETO);
    } else {
      setTargetId((prev) => {
        if (prev && prev !== DESTINO_NUEVO_OBJETO) return prev;
        return selectedObjectId &&
          sceneObjects.some((o) => o.id === selectedObjectId)
          ? selectedObjectId
          : sceneObjects[0]?.id ?? '';
      });
    }
  }, [pluginId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si el plugin elegido NO es generador y el destino quedó en «Nuevo
  // objeto» (p. ej. al cambiar desde un generador), volvemos a un objeto
  // válido para que el botón Aplicar no apunte a un destino inexistente.
  useEffect(() => {
    if (!plugin) return;
    if (!plugin.generador && targetId === DESTINO_NUEVO_OBJETO) {
      const fallback =
        selectedObjectId && sceneObjects.some((o) => o.id === selectedObjectId)
          ? selectedObjectId
          : sceneObjects[0]?.id ?? '';
      setTargetId(fallback);
    }
  }, [plugin, targetId, sceneObjects, selectedObjectId]);

  // Agrupar por categoría manteniendo el orden del registro.
  const grupos = useMemo(() => {
    const mapa = new Map<string, ZeusPlugin[]>();
    for (const p of plugins) {
      const lista = mapa.get(p.categoria) ?? [];
      lista.push(p);
      mapa.set(p.categoria, lista);
    }
    return [...mapa.entries()];
  }, [plugins]);

  const setValor = (id: string, valor: number | string | boolean) => {
    setValores((prev) => ({ ...prev, [id]: valor }));
  };

  const handleExecute = async () => {
    if (!plugin || !targetId) {
      setErrorMessage(t('editor3D.plugins.errSelect'));
      return;
    }
    setErrorMessage(null);
    setIsProcessing(true);
    try {
      // Pequeña pausa para que React pinte el estado de carga.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const res = await onApply({
        pluginId: plugin.id,
        targetObjectId: targetId,
        valores,
      });
      if (res !== false) onClose();
    } catch (err: unknown) {
      const mensaje =
        err instanceof Error
          ? err.message
          : t('editor3D.plugins.errGeneric');
      setErrorMessage(mensaje);
    } finally {
      setIsProcessing(false);
    }
  };

  const nombreObjeto = (id: string) => {
    if (id === DESTINO_NUEVO_OBJETO) return t('editor3D.plugins.newObject');
    const idx = sceneObjects.findIndex((o) => o.id === id);
    return idx >= 0
      ? t('editor3D.plugins.object', { n: idx + 1 })
      : t('editor3D.plugins.object', { n: '' }).replace(/\s+$/, '');
  };

  return (
    <Modal isOpen={isOpen} onClose={isProcessing ? () => {} : onClose}>
      <div className="flex flex-col gap-4 p-1 w-full max-w-2xl text-foreground">
        {/* Cabecera */}
        <div className="flex items-center gap-3 border-b border-white/10 pb-3">
          <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-400">
            <Puzzle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-foreground">
              {t('editor3D.plugins.title')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('editor3D.plugins.desc')}
            </p>
          </div>
          <span className="text-[10px] px-2 py-1 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-300 font-medium">
            {t('editor3D.plugins.count', { count: plugins.length })}
          </span>
        </div>

        {plugins.length === 0 ? (
          <p className="text-xs text-muted-foreground p-4 text-center">
            {t('editor3D.plugins.empty')}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-4 min-h-[280px]">
            {/* Columna izquierda: lista por categorías */}
            <div className="flex flex-col gap-3 overflow-y-auto modal-scrollbar max-h-[320px] pr-1">
              {grupos.map(([categoria, items]) => (
                <div key={categoria} className="flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                    <IconoCategoria categoria={categoria} />
                    {etiquetaCategoria(categoria, t)}
                  </span>
                  {items.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPluginId(p.id)}
                      className={`text-left px-3 py-2 rounded-lg border text-xs transition-all ${
                        p.id === pluginId
                          ? 'bg-violet-500/20 border-violet-500/60 text-violet-200'
                          : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10 hover:text-foreground'
                      }`}
                    >
                      <span className="block font-semibold text-foreground">
                        {p.nombre}
                      </span>
                      <span className="block text-[10px] mt-0.5 opacity-80">
                        {p.descripcion}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {/* Columna derecha: parámetros del plugin elegido */}
            <div className="flex flex-col gap-3 bg-black/30 p-3.5 rounded-xl border border-white/5">
              {plugin && (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-violet-400" />
                      {t('editor3D.plugins.applyTo')}
                    </label>
                    <select
                      value={targetId}
                      onChange={(e) => setTargetId(e.target.value)}
                      className="bg-gray-900 border border-white/15 rounded-md px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-violet-500"
                    >
                      {esGenerador && (
                        <option value={DESTINO_NUEVO_OBJETO}>
                          ✨ {t('editor3D.plugins.newObject')}
                        </option>
                      )}
                      {sceneObjects.map((objeto, index) => (
                        <option key={objeto.id} value={objeto.id}>
                          {nombreObjeto(objeto.id)}{' '}
                          {objeto.id === selectedObjectId
                            ? t('editor3D.plugins.active')
                            : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {plugin.params.length > 0 && (
                    <div className="flex flex-col gap-3 pt-1">
                      {plugin.params.map((param) => {
                        if (param.tipo === 'slider') {
                          const valor = typeof valores[param.id] === 'number'
                            ? (valores[param.id] as number)
                            : param.valor;
                          return (
                            <div key={param.id} className="flex flex-col gap-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-foreground">
                                  {param.etiqueta}
                                </span>
                                <span className="text-[10px] text-violet-300 font-mono bg-violet-500/10 border border-violet-500/30 rounded px-1.5 py-0.5">
                                  {valor}
                                  {param.unidad ?? ''}
                                </span>
                              </div>
                              <Slider
                                value={[valor]}
                                min={param.min}
                                max={param.max}
                                step={param.paso ?? 1}
                                onValueChange={(vals: number[]) =>
                                  setValor(param.id, vals[0])
                                }
                              />
                            </div>
                          );
                        }
                        if (param.tipo === 'select') {
                          return (
                            <div key={param.id} className="flex flex-col gap-1.5">
                              <span className="text-xs font-medium text-foreground">
                                {param.etiqueta}
                              </span>
                              <select
                                value={
                                  typeof valores[param.id] === 'string'
                                    ? (valores[param.id] as string)
                                    : param.valor
                                }
                                onChange={(e) =>
                                  setValor(param.id, e.target.value)
                                }
                                className="bg-gray-900 border border-white/15 rounded-md px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-violet-500"
                              >
                                {param.opciones.map((op) => (
                                  <option key={op.valor} value={op.valor}>
                                    {op.etiqueta}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        }
                        // check
                        return (
                          <label
                            key={param.id}
                            className="flex items-center justify-between gap-3 cursor-pointer"
                          >
                            <span className="flex flex-col">
                              <span className="text-xs font-medium text-foreground">
                                {param.etiqueta}
                              </span>
                              {param.descripcion && (
                                <span className="text-[10px] text-muted-foreground">
                                  {param.descripcion}
                                </span>
                              )}
                            </span>
                            <input
                              type="checkbox"
                              checked={valores[param.id] !== false}
                              onChange={(e) =>
                                setValor(param.id, e.target.checked)
                              }
                              className="w-4 h-4 rounded bg-gray-800 border-white/20 text-violet-500 focus:ring-violet-500 cursor-pointer"
                            />
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-white/5 border border-white/10 text-[11px] text-muted-foreground mt-auto">
                    <Info className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                    <span>
                      {targetId === DESTINO_NUEVO_OBJETO
                        ? t('editor3D.plugins.willCreate', {
                            plugin: plugin.nombre,
                          })
                        : t('editor3D.plugins.willApply', {
                            plugin: plugin.nombre,
                            objeto: nombreObjeto(targetId),
                          })}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Mensaje de error si ocurre */}
        {errorMessage && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Botones de acción */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/10">
          <button
            type="button"
            disabled={isProcessing}
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent hover:border-white/10 transition-colors disabled:opacity-50"
          >
            {t('editor3D.cancel')}
          </button>

          <button
            type="button"
            disabled={isProcessing || !plugin || !targetId}
            onClick={handleExecute}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-violet-500 hover:bg-violet-400 text-white shadow-md shadow-violet-500/20 transition-all disabled:opacity-40 cursor-pointer"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t('editor3D.plugins.applying')}</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>{t('editor3D.plugins.applyBtn')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
