'use client';

import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import useAppStore from '@/store/app-store';

/**
 * Ventana flotante en la esquina superior izquierda del canvas
 * que muestra el icono original como referencia/plantilla.
 */
export function IconReferencePreview() {
  const referenceImage = useAppStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.referenceImage ?? null;
  });
  const referenceName = useAppStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.referenceName ?? '';
  });
  const clearReferenceImage = useAppStore((s) => s.clearReferenceImage);

  if (!referenceImage) return null;

  return (
    <div className="absolute top-6 left-6 z-40 rounded-lg border border-gray-600 bg-gray-900/95 shadow-2xl backdrop-blur-sm overflow-hidden max-w-[180px]">
      {/* Cabecera */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-gray-800 border-b border-gray-700">
        <span className="text-[10px] font-medium text-gray-300 truncate max-w-[130px]">{referenceName}</span>
        <button
          onClick={() => clearReferenceImage()}
          className="ml-1 p-0.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          title="Cerrar referencia"
        >
          <XMarkIcon className="h-3 w-3" />
        </button>
      </div>

      {/* Imagen */}
      <div className="p-2 flex items-center justify-center">
        <img
          src={referenceImage}
          alt={referenceName}
          className="max-h-32 max-w-full object-contain"
          draggable={false}
        />
      </div>

      {/* Pie */}
      <div className="px-2 py-1 bg-gray-800 border-t border-gray-700">
        <p className="text-[9px] text-gray-500 text-center">Referencia</p>
      </div>
    </div>
  );
}

export default IconReferencePreview;
