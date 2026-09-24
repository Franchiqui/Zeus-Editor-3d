"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import useLocalStorage from '@/hooks/use-local-storage-2';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  points: Point[];
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  type: 'line' | 'curve';
  holes?: Point[][];
  shapeType?: 'circle' | 'rectangle' | 'text';
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  rotation?: number;
}

/** Icono guardado por el usuario en una biblioteca personalizada */
export interface SavedIcon {
  id: string;
  name: string;
  strokes: Stroke[];
  createdAt: number;
}

/** Biblioteca importada de un paquete npm (sistema) */
export interface SystemLibrary {
  id: string;
  name: string;
  packageName: string;
  sourceLibraryId: string;
}

/** Biblioteca creada por el usuario */
export interface CustomLibrary {
  id: string;
  name: string;
  description?: string;
  icons: SavedIcon[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

interface IconLibraryContextType {
  // Sistema (librerías npm)
  systemLibraries: SystemLibrary[];
  addSystemLibrary: (lib: Omit<SystemLibrary, 'id'>) => void;
  removeSystemLibrary: (id: string) => void;

  // Personalizadas (bibliotecas del usuario)
  customLibraries: CustomLibrary[];
  createCustomLibrary: (name: string, description?: string) => void;
  removeCustomLibrary: (id: string) => void;

  // Iconos guardados
  saveIconToLibrary: (libraryId: string, icon: Omit<SavedIcon, 'id' | 'createdAt'>) => void;
  removeIconFromLibrary: (libraryId: string, iconId: string) => void;

  // Modal de biblioteca
  isModalOpen: boolean;
  toggleModal: () => void;
}

const IconLibraryContext = createContext<IconLibraryContextType | undefined>(undefined);

export function IconLibraryProvider({ children }: { children: ReactNode }) {
  const [storedSystemLibraries, setStoredSystemLibraries] = useLocalStorage<SystemLibrary[]>({
    key: 'zeus-system-libraries',
    initialValue: [],
  });
  const [storedCustomLibraries, setStoredCustomLibraries] = useLocalStorage<CustomLibrary[]>({
    key: 'zeus-custom-libraries',
    initialValue: [],
  });
  const [isModalOpen, setIsModalOpen] = useState(false);

  // ---------------------------------------------------------------
  // System libraries
  // ---------------------------------------------------------------
  const addSystemLibrary = useCallback(
    (library: Omit<SystemLibrary, 'id'>) => {
      const newLibrary: SystemLibrary = {
        ...library,
        id: library.sourceLibraryId + '-' + Date.now(),
      };
      setStoredSystemLibraries((prev) => {
        if (prev.some((lib) => lib.sourceLibraryId === library.sourceLibraryId)) {
          return prev;
        }
        return [...prev, newLibrary];
      });
    },
    [setStoredSystemLibraries]
  );

  const removeSystemLibrary = useCallback(
    (id: string) => {
      setStoredSystemLibraries((prev) => prev.filter((lib) => lib.id !== id));
    },
    [setStoredSystemLibraries]
  );

  // ---------------------------------------------------------------
  // Custom libraries
  // ---------------------------------------------------------------
  const createCustomLibrary = useCallback(
    (name: string, description?: string) => {
      const newLibrary: CustomLibrary = {
        id: 'custom-' + Date.now(),
        name,
        description,
        icons: [],
        createdAt: Date.now(),
      };
      setStoredCustomLibraries((prev) => [...prev, newLibrary]);
    },
    [setStoredCustomLibraries]
  );

  const removeCustomLibrary = useCallback(
    (id: string) => {
      setStoredCustomLibraries((prev) => prev.filter((lib) => lib.id !== id));
    },
    [setStoredCustomLibraries]
  );

  // ---------------------------------------------------------------
  // Save / remove icons
  // ---------------------------------------------------------------
  const saveIconToLibrary = useCallback(
    (libraryId: string, icon: Omit<SavedIcon, 'id' | 'createdAt'>) => {
      const newIcon: SavedIcon = {
        ...icon,
        id: 'icon-' + Date.now(),
        createdAt: Date.now(),
      };
      setStoredCustomLibraries((prev) =>
        prev.map((lib) =>
          lib.id === libraryId ? { ...lib, icons: [...lib.icons, newIcon] } : lib
        )
      );
    },
    [setStoredCustomLibraries]
  );

  const removeIconFromLibrary = useCallback(
    (libraryId: string, iconId: string) => {
      setStoredCustomLibraries((prev) =>
        prev.map((lib) =>
          lib.id === libraryId
            ? { ...lib, icons: lib.icons.filter((ic) => ic.id !== iconId) }
            : lib
        )
      );
    },
    [setStoredCustomLibraries]
  );

  const toggleModal = useCallback(() => {
    setIsModalOpen((prev) => !prev);
  }, []);

  const value: IconLibraryContextType = {
    systemLibraries: storedSystemLibraries,
    addSystemLibrary,
    removeSystemLibrary,
    customLibraries: storedCustomLibraries,
    createCustomLibrary,
    removeCustomLibrary,
    saveIconToLibrary,
    removeIconFromLibrary,
    isModalOpen,
    toggleModal,
  };

  return (
    <IconLibraryContext.Provider value={value}>
      {children}
    </IconLibraryContext.Provider>
  );
}

export function useIconLibraryContext(): IconLibraryContextType | undefined {
  const context = useContext(IconLibraryContext);
  return context;
}
