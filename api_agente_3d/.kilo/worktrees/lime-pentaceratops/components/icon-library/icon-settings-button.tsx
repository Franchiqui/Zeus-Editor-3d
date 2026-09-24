"use client";

import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Cog6ToothIcon, TrashIcon, PlusIcon, BookOpenIcon, FolderIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useIconLibraryContext } from "@/context/icon-library-context";
import { availableLibraries } from "@/lib/icon-libraries";

interface IconSettingsButtonProps {
  /** Opcional: clase CSS adicional para el botón */
  className?: string;
}

/**
 * Botón de configuración de librerías de iconos.
 * Al hacer clic, abre un modal con las opciones de importación y gestión de bibliotecas.
 */
export function IconSettingsButton({ className }: IconSettingsButtonProps) {
  const [open, setOpen] = useState(false);
  const iconLibraryContext = useIconLibraryContext();
  const systemLibraries = iconLibraryContext?.systemLibraries ?? [];
  const addSystemLibrary = iconLibraryContext?.addSystemLibrary ?? (() => {});
  const removeSystemLibrary = iconLibraryContext?.removeSystemLibrary ?? (() => {});
  const customLibraries = iconLibraryContext?.customLibraries ?? [];
  const createCustomLibrary = iconLibraryContext?.createCustomLibrary ?? (() => {});
  const removeCustomLibrary = iconLibraryContext?.removeCustomLibrary ?? (() => {});
  const [selectedLibId, setSelectedLibId] = useState<string>('');
  const [newLibName, setNewLibName] = useState('');
  const [newLibDesc, setNewLibDesc] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const importedIds = new Set(systemLibraries.map((lib: any) => lib.sourceLibraryId));
  const availableToImport = availableLibraries.filter((lib: any) => !importedIds.has(lib.id));

  const handleImport = () => {
    if (!selectedLibId) return;
    const def = availableLibraries.find((lib) => lib.id === selectedLibId);
    if (!def) return;
    addSystemLibrary({
      name: def.name,
      packageName: def.packageName,
      sourceLibraryId: def.id,
    });
    setSelectedLibId('');
  };

  const handleCreateLibrary = () => {
    if (!newLibName.trim()) return;
    createCustomLibrary(newLibName.trim(), newLibDesc.trim() || undefined);
    setNewLibName('');
    setNewLibDesc('');
    setShowCreateForm(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("rounded-full", className)}
          aria-label="Configuración de librerías de iconos"
          title="Configuración de librerías de iconos"
        >
          <img src="/uploads/Settings.png" alt="icon" width={24} height={24} className="inline-block" />
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-lg text-gray-100 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 overflow-y-auto">
          <Dialog.Title className="text-lg font-semibold text-white">
            Configuración de librerías de iconos
          </Dialog.Title>

          <Dialog.Description className="mt-2 text-sm text-gray-400">
            Administra las bibliotecas de iconos importadas y las tuyas propias.
          </Dialog.Description>

          {/* Sección: Librerías Importadas */}
          <div className="mt-6 space-y-3">
            <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
              <BookOpenIcon className="h-4 w-4" />
              Librerías importadas
            </h3>

            {systemLibraries.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No hay librerías importadas.</p>
            ) : (
              <ul className="space-y-2">
                {systemLibraries.map((lib) => (
                  <li
                    key={lib.id}
                    className="flex items-center justify-between rounded-md border border-gray-700 bg-gray-800 px-3 py-2"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-200">{lib.name}</span>
                      <span className="text-xs text-gray-500">{lib.packageName}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-gray-400 hover:text-red-400 hover:bg-gray-700"
                      onClick={() => removeSystemLibrary(lib.id)}
                      title="Eliminar librería"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Importar nueva librería */}
          {availableToImport.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={selectedLibId}
                  onChange={(e) => setSelectedLibId(e.target.value)}
                  className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="" disabled>Selecciona una librería…</option>
                  {availableToImport.map((lib) => (
                    <option key={lib.id} value={lib.id}>
                      {lib.name} — {lib.description} ({lib.iconCount} iconos)
                    </option>
                  ))}
                </select>
                <Button
                  onClick={handleImport}
                  disabled={!selectedLibId}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Importar
                </Button>
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="my-6 border-t border-gray-700" />

          {/* Sección: Mis bibliotecas */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                <FolderIcon className="h-4 w-4" />
                Mis bibliotecas
              </h3>
              <Button
                size="sm"
                variant="outline"
                className="border-gray-600 text-gray-200 hover:bg-gray-800"
                onClick={() => setShowCreateForm((s) => !s)}
              >
                {showCreateForm ? 'Cancelar' : 'Crear biblioteca'}
              </Button>
            </div>

            {showCreateForm && (
              <div className="rounded-md border border-gray-700 bg-gray-800 p-3 space-y-2">
                <Input
                  placeholder="Nombre de la biblioteca"
                  value={newLibName}
                  onChange={(e) => setNewLibName(e.target.value)}
                  className="bg-gray-900 border-gray-600 text-gray-100"
                />
                <Input
                  placeholder="Descripción (opcional)"
                  value={newLibDesc}
                  onChange={(e) => setNewLibDesc(e.target.value)}
                  className="bg-gray-900 border-gray-600 text-gray-100"
                />
                <Button
                  onClick={handleCreateLibrary}
                  disabled={!newLibName.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                >
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Crear biblioteca
                </Button>
              </div>
            )}

            {customLibraries.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No has creado bibliotecas propias todavía.</p>
            ) : (
              <ul className="space-y-2">
                {customLibraries.map((lib) => (
                  <li
                    key={lib.id}
                    className="flex items-center justify-between rounded-md border border-gray-700 bg-gray-800 px-3 py-2"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-200">{lib.name}</span>
                      <span className="text-xs text-gray-500">
                        {lib.icons.length} icono{lib.icons.length !== 1 ? 's' : ''}
                        {lib.description ? ` · ${lib.description}` : ''}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-gray-400 hover:text-red-400 hover:bg-gray-700"
                      onClick={() => removeCustomLibrary(lib.id)}
                      title="Eliminar biblioteca"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Botón para cerrar */}
          <div className="mt-6 flex justify-end">
            <Dialog.Close asChild>
              <Button variant="outline" className="border-gray-600 text-gray-200 hover:bg-gray-800">Cerrar</Button>
            </Dialog.Close>
          </div>

          <Dialog.Close asChild>
            <button
              className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:ring-offset-gray-900 dark:focus:ring-gray-600"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default IconSettingsButton;
