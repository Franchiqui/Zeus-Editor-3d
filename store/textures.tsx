'use client';

/**
 * Store de texturas creadas (zustand) — comparte la MISMA clave de
 * localStorage ('textures_db') que la página /edit-texturas y el modal
 * de crear texturas del Editor 3D, de modo que todo lo creado aparece
 * en los tres sitios.
 */

import { create } from 'zustand';
import { Texture, TextureStore, TextureFormData } from '@/types';
import { CREATED_TEXTURES_KEY, readCreatedTextures } from '@/lib/texture-generator';

export const useTexturesStore = create<TextureStore>((set) => ({
  textures: [],

  // Carga inicial desde localStorage.
  loadTextures: () => {
    set({ textures: readCreatedTextures() });
  },

  addTexture: async (data) => {
    const newTexture: Texture = {
      ...data,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const list = [...readCreatedTextures(), newTexture];
    localStorage.setItem(CREATED_TEXTURES_KEY, JSON.stringify(list));
    set({ textures: list });
    return newTexture;
  },

  updateTexture: async (id, data) => {
    const list = readCreatedTextures();
    const existing = list.find((t) => t.id === id);
    if (!existing) return null;
    const updated: Texture = {
      ...existing,
      ...data,
      id,
      updated_at: new Date().toISOString(),
    };
    const next = list.map((t) => (t.id === id ? updated : t));
    localStorage.setItem(CREATED_TEXTURES_KEY, JSON.stringify(next));
    set({ textures: next });
    return updated;
  },

  deleteTexture: async (id) => {
    const next = readCreatedTextures().filter((t) => t.id !== id);
    localStorage.setItem(CREATED_TEXTURES_KEY, JSON.stringify(next));
    set({ textures: next });
    return true;
  },
}));