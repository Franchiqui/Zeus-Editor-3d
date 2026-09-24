'use client';

import React, { useState } from 'react';
import { useIconLibraryContext } from '@/context/icon-library-context';
import { availableLibraries } from '@/lib/icon-libraries';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Download } from 'lucide-react';

export function IconConfigModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const iconLibraryContext = useIconLibraryContext();
  const systemLibraries = iconLibraryContext?.systemLibraries ?? [];
  const customLibraries = iconLibraryContext?.customLibraries ?? [];
  const addSystemLibrary = iconLibraryContext?.addSystemLibrary ?? (() => {});
  const removeSystemLibrary = iconLibraryContext?.removeSystemLibrary ?? (() => {});
  const removeCustomLibrary = iconLibraryContext?.removeCustomLibrary ?? (() => {});
  const createCustomLibrary = iconLibraryContext?.createCustomLibrary ?? (() => {});
  const [tab, setTab] = useState<'custom' | 'system'>('system');
  const [newLibName, setNewLibName] = useState('');

  const importedIds = new Set(systemLibraries.map((lib: any) => lib.sourceLibraryId));
  const availableToImport = availableLibraries.filter((lib: any) => !importedIds.has(lib.id));

  const handleImport = (lib: any) => {
    addSystemLibrary({
      name: lib.name,
      packageName: lib.packageName,
      sourceLibraryId: lib.id,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-4">Configurar Bibliotecas de Iconos</h2>

        <div className="mb-4 border-b border-gray-700">
          <div className="flex gap-2">
            <button
              onClick={() => setTab('custom')}
              className={`px-3 py-1 text-sm rounded-t ${tab === 'custom' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Personalizadas
            </button>
            <button
              onClick={() => setTab('system')}
              className={`px-3 py-1 text-sm rounded-t ${tab === 'system' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Sistema (npm)
            </button>
          </div>
        </div>

        {tab === 'custom' ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Nombre de la biblioteca"
                value={newLibName}
                onChange={(e) => setNewLibName(e.target.value)}
              />
              <Button
                onClick={() => {
                  createCustomLibrary(newLibName);
                  setNewLibName('');
                }}
                disabled={!newLibName.trim()}
              >
                <Plus className="h-4 w-4 mr-1" /> Crear
              </Button>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {customLibraries.length === 0 ? (
                <p className="text-sm text-gray-500 italic py-4">No hay bibliotecas personalizadas. Crea una arriba.</p>
              ) : (
                customLibraries.map((lib: any) => (
                  <div key={lib.id} className="flex items-center justify-between p-2 bg-gray-800 rounded">
                    <span>{lib.name} ({lib.icons?.length || 0} iconos)</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCustomLibrary(lib.id)}
                      className="text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4 mr-1" /> Eliminar
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Bibliotecas disponibles para importar */}
            {availableToImport.length > 0 && (
              <div className="space-y-3 mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Disponibles para importar
                </h3>
                {availableToImport.map((lib: any) => (
                  <div key={lib.id} className="flex items-center justify-between p-3 bg-gray-900 rounded border border-gray-700">
                    <div>
                      <p className="font-medium text-white">{lib.name}</p>
                      <p className="text-xs text-gray-400">{lib.description} ({lib.iconCount} iconos)</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleImport(lib)}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      <Plus className="h-4 w-4 mr-1" /> Importar
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Bibliotecas ya importadas */}
            <div className="max-h-60 overflow-y-auto">
              {systemLibraries.length === 0 && availableToImport.length === 0 ? (
                <p className="text-sm text-gray-500 italic py-4">No hay bibliotecas importadas. Importa una de las disponibles arriba.</p>
              ) : systemLibraries.length === 0 ? null : (
                systemLibraries.map((lib: any) => (
                  <div key={lib.id} className="flex items-center justify-between p-2 bg-gray-800 rounded">
                    <span>{lib.name} ({lib.packageName})</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeSystemLibrary(lib.id)}
                      className="text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4 mr-1" /> Eliminar
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}