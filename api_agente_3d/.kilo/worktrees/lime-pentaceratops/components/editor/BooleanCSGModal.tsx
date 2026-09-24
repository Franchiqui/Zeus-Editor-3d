'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/modal';
import {
  Scissors,
  Layers,
  BoxSelect,
  AlertCircle,
  Loader2,
  Check,
  ArrowRight,
  Info,
} from 'lucide-react';
import type { BooleanOperationType } from '@/lib/csg-mesh';

interface BooleanCSGModalProps {
  isOpen: boolean;
  onClose: () => void;
  sceneObjects: Array<{
    id: string;
    mode?: string;
  }>;
  selectedObjectId: string | null;
  onApply: (params: {
    baseObjectId: string;
    toolObjectId: string;
    operation: BooleanOperationType;
    deleteToolObject: boolean;
  }) => Promise<boolean | void> | boolean | void;
   previewMode?: boolean;
   setPreviewMode?: (v: boolean) => void;
   onToolChange?: (id: string | null) => void;
   onEnterPreview?: (params: {
    baseObjectId: string;
    toolObjectId: string;
    operation: BooleanOperationType;
    deleteToolObject: boolean;
  }) => void;
}

export default function BooleanCSGModal({
   isOpen,
   onClose,
   sceneObjects,
   selectedObjectId,
   onApply,
   previewMode = false,
   setPreviewMode,
   onToolChange,
   onEnterPreview,
}: BooleanCSGModalProps) {
  const [baseId, setBaseId] = useState<string>('');
  const [toolId, setToolId] = useState<string>('');
   const [operation, setOperation] = useState<BooleanOperationType>('subtract');
  const [deleteTool, setDeleteTool] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Inicializar o ajustar selecciones al abrir o cuando cambian los objetos.
   // El activo (selectedObjectId) se toma como base (receptor); la herramienta
   // (cortador) es el primer objeto distinto. El usuario puede reordenar con
   // los selects si lo desea.
   useEffect(() => {
    if (!isOpen || sceneObjects.length < 2) return;

    // Objeto base: el activo actual si existe en la escena, si no el primero
    const initialBase =
      selectedObjectId && sceneObjects.some((o) => o.id === selectedObjectId)
        ? selectedObjectId
        : sceneObjects[0]?.id ?? '';

    // Herramienta (cortador): el primer objeto distinto al base
    const initialTool =
      sceneObjects.find((o) => o.id !== initialBase)?.id ?? '';

    setBaseId(initialBase);
    setToolId(initialTool);
    onToolChange?.(initialTool || null);
    setErrorMessage(null);
    setIsProcessing(false);
   }, [isOpen, sceneObjects, selectedObjectId]);

  const handleBaseChange = (newBaseId: string) => {
    setBaseId(newBaseId);
    if (toolId === newBaseId) {
      const other = sceneObjects.find((o) => o.id !== newBaseId);
      if (other) setToolId(other.id);
    }
  };

  const handleToolChange = (newToolId: string) => {
    setToolId(newToolId);
    onToolChange?.(newToolId);
    if (baseId === newToolId) {
      const other = sceneObjects.find((o) => o.id !== newToolId);
      if (other) setBaseId(other.id);
    }
  };

   const handleExecute = async () => {
   if (!baseId || !toolId || baseId === toolId) {
    setErrorMessage('Debes seleccionar dos objetos diferentes.');
    return;
  }

  setErrorMessage(null);
  setIsProcessing(true);

  try {
   // Si preview está activado: entrar en modo preview live (cerrar modal, mostrar botones en viewport)
   if (previewMode && onEnterPreview) {
    onEnterPreview({
      baseObjectId: baseId,
      toolObjectId: toolId,
      operation,
      deleteToolObject: deleteTool,
    });
    setIsProcessing(false);
    return;
  }

   // Breve timeout para permitir que React renderice el estado de carga
   await new Promise((resolve) => setTimeout(resolve, 50));
   const res = await onApply({
    baseObjectId: baseId,
    toolObjectId: toolId,
    operation,
    deleteToolObject: deleteTool,
   });

   if (res !== false) {
    onClose();
   }
  } catch (err: any) {
   setErrorMessage(err?.message || 'Error al procesar la operación booleana');
  } finally {
   setIsProcessing(false);
  }
 };

  const getObjectIndexName = (id: string) => {
    const idx = sceneObjects.findIndex((o) => o.id === id);
    return idx >= 0 ? `Objeto ${idx + 1}` : 'Objeto';
  };

  return (
    <Modal isOpen={isOpen} onClose={isProcessing ? () => {} : onClose}>
      <div className="flex flex-col gap-5 p-1 max-w-lg w-full text-foreground">
        {/* Cabecera */}
        <div className="flex items-center gap-3 border-b border-white/10 pb-3">
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <Scissors className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Sustracción / Operación Booleana 3D
            </h3>
            <p className="text-xs text-muted-foreground">
              Sustrae la forma de un objeto que atraviesa o roza a otro en el espacio 3D
            </p>
          </div>
        </div>

        {/* Tipo de Operación */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            Tipo de operación
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setOperation('subtract')}
              className={`flex flex-col items-center justify-center p-3 rounded-lg border text-xs font-medium transition-all ${
                operation === 'subtract'
                  ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 shadow-sm'
                  : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10 hover:text-foreground'
              }`}
            >
              <Scissors className="w-4 h-4 mb-1.5" />
              <span>Sustraer</span>
              <span className="text-[10px] text-muted-foreground mt-0.5 opacity-80">
                (Base − Cortador)
              </span>
            </button>

            <button
              type="button"
              onClick={() => setOperation('union')}
              className={`flex flex-col items-center justify-center p-3 rounded-lg border text-xs font-medium transition-all ${
                operation === 'union'
                  ? 'bg-blue-500/20 border-blue-500/60 text-blue-300 shadow-sm'
                  : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10 hover:text-foreground'
              }`}
            >
              <Layers className="w-4 h-4 mb-1.5" />
              <span>Unir</span>
              <span className="text-[10px] text-muted-foreground mt-0.5 opacity-80">
                (Fusión sólida)
              </span>
            </button>

            <button
              type="button"
              onClick={() => setOperation('intersect')}
              className={`flex flex-col items-center justify-center p-3 rounded-lg border text-xs font-medium transition-all ${
                operation === 'intersect'
                  ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300 shadow-sm'
                  : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10 hover:text-foreground'
              }`}
            >
              <BoxSelect className="w-4 h-4 mb-1.5" />
              <span>Intersecar</span>
              <span className="text-[10px] text-muted-foreground mt-0.5 opacity-80">
                (Solo el cruce)
              </span>
            </button>
          </div>
        </div>

        {/* Selección de Objetos */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-black/30 p-3.5 rounded-xl border border-white/5">
          {/* Objeto Base */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              Objeto Base (receptor)
            </label>
            <p className="text-[11px] text-muted-foreground">
              Objeto que conservará el resultado del corte:
            </p>
            <select
              value={baseId}
              onChange={(e) => handleBaseChange(e.target.value)}
              className="mt-1 bg-gray-900 border border-white/15 rounded-md px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-green-500"
            >
              {sceneObjects.map((object, index) => (
                <option key={object.id} value={object.id}>
                  Objeto {index + 1} {object.id === selectedObjectId ? '(Activo)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Objeto Cortador / Herramienta */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Objeto Cortador (herramienta)
            </label>
            <p className="text-[11px] text-muted-foreground">
              Objeto que atraviesa o roza a la base:
            </p>
            <select
              value={toolId}
              onChange={(e) => handleToolChange(e.target.value)}
              className="mt-1 bg-gray-900 border border-white/15 rounded-md px-2.5 py-2 text-xs text-foreground focus:outline-none focus:border-amber-500"
            >
              {sceneObjects
                .filter((object) => object.id !== baseId)
                .map((object) => {
                  const idx = sceneObjects.findIndex((o) => o.id === object.id);
                  return (
                    <option key={object.id} value={object.id}>
                      Objeto {idx + 1} {object.id === selectedObjectId ? '(Activo)' : ''}
                    </option>
                  );
                })}
            </select>
          </div>
        </div>

        {/* Resumen explicativo */}
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-white/5 border border-white/10 text-xs text-muted-foreground">
          <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <div>
            {operation === 'subtract' ? (
              <span>
                Se sustraerá del <strong className="text-foreground">{getObjectIndexName(baseId)}</strong> la
                forma exacta del <strong className="text-foreground">{getObjectIndexName(toolId)}</strong> donde
                ambos se tocan o atraviesan en el espacio 3D.
              </span>
            ) : operation === 'union' ? (
              <span>
                Se unirán el <strong className="text-foreground">{getObjectIndexName(baseId)}</strong> y el{' '}
                <strong className="text-foreground">{getObjectIndexName(toolId)}</strong> en un solo cuerpo sólido.
              </span>
            ) : (
              <span>
                Se conservará únicamente la masa 3D donde el{' '}
                <strong className="text-foreground">{getObjectIndexName(baseId)}</strong> y el{' '}
                <strong className="text-foreground">{getObjectIndexName(toolId)}</strong> coinciden e intersecan.
              </span>
            )}
          </div>
        </div>

        {/* Opciones adicionales */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5 text-xs">
          <div className="flex flex-col">
            <span className="font-medium text-foreground">
              Eliminar objeto cortador tras la operación
            </span>
            <span className="text-[11px] text-muted-foreground">
              Elimina de la escena el {getObjectIndexName(toolId)} una vez realizado el corte
            </span>
          </div>
          <input
            type="checkbox"
            checked={deleteTool}
            onChange={(e) => setDeleteTool(e.target.checked)}
            className="w-4 h-4 rounded bg-gray-800 border-white/20 text-amber-500 focus:ring-amber-500 cursor-pointer"
          />
        </div>

        {/* Preview en vivo */}
        {previewMode !== undefined && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5 text-xs">
            <div className="flex flex-col">
              <span className="font-medium text-foreground">
                Vista previa en vivo
              </span>
              <span className="text-[11px] text-muted-foreground">
                Muestra el objeto cortador transparente mientras lo mueves
              </span>
            </div>
             <input
               type="checkbox"
               checked={previewMode}
               onChange={(e) => setPreviewMode?.(e.target.checked)}
               className="w-4 h-4 rounded bg-gray-800 border-white/20 text-sky-500 focus:ring-sky-500 cursor-pointer"
             />
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
            Cancelar
          </button>

          <button
            type="button"
            disabled={isProcessing || !baseId || !toolId || baseId === toolId}
            onClick={handleExecute}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black shadow-md shadow-amber-500/20 transition-all disabled:opacity-40 disabled:hover:bg-amber-500 cursor-pointer"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Calculando corte...</span>
              </>
            ) : (
              <>
                <Scissors className="w-4 h-4" />
                <span>
                  {operation === 'subtract'
                    ? 'Aplicar sustracción'
                    : operation === 'union'
                      ? 'Aplicar unión'
                      : 'Aplicar intersección'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
