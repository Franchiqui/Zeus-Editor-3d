'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface IconData {
  id?: string;
  title?: string;
  pngData?: string;
  svgData?: string;
  width?: number;
  height?: number;
  layers?: Layer[];
  createdAt?: string;
  updatedAt?: string;
}

interface Layer {
  id: string;
  type: 'shape' | 'text' | 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  properties: Record<string, unknown>;
}

interface EditorState {
  currentIcon: IconData | null;
  zoom: number;
  panX: number;
  panY: number;
  isPanActive: boolean;
  selectedLayerId: string | null;
  layers: Layer[];
  history: IconData[];
  historyIndex: number;
  isDirty: boolean;
  isSaving: boolean;
  isLoading: boolean;
  error: string | null;
}

interface EditorActions {
  setCurrentIcon: (icon: IconData | null) => void;
  updateCurrentIcon: (updates: Partial<IconData>) => void;
  setZoom: (zoom: number) => void;
  setPanX: (panX: number) => void;
  setPanY: (panY: number) => void;
  setIsPanActive: (isPanActive: boolean) => void;
  setSelectedLayerId: (layerId: string | null) => void;
  addLayer: (layer: Layer) => void;
  updateLayer: (layerId: string, updates: Partial<Layer>) => void;
  removeLayer: (layerId: string) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  undo: () => void;
  redo: () => void;
  resetEditor: () => void;
  setError: (error: string | null) => void;
  setIsSaving: (isSaving: boolean) => void;
  setIsLoading: (isLoading: boolean) => void;
  pushToHistory: (icon: IconData) => void;
}

type EditorStore = EditorState & EditorActions;

const initialState: EditorState = {
  currentIcon: null,
  zoom: 100,
  panX: 0,
  panY: 0,
  isPanActive: false,
  selectedLayerId: null,
  layers: [],
  history: [],
  historyIndex: -1,
  isDirty: false,
  isSaving: false,
  isLoading: false,
  error: null,
};

export const useEditorStore = create<EditorStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      setCurrentIcon: (icon) => {
        set({
          currentIcon: icon,
          layers: icon?.layers || [],
          isDirty: false,
          history: icon ? [icon] : [],
          historyIndex: icon ? 0 : -1,
          zoom: 100,
          panX: 0,
          panY: 0,
          selectedLayerId: null,
          error: null,
        });
      },

      updateCurrentIcon: (updates) => {
        const state = get();
        if (!state.currentIcon) return;

        const updatedIcon = { ...state.currentIcon, ...updates };
        set({
          currentIcon: updatedIcon,
          isDirty: true,
        });
      },

      setZoom: (zoom) => {
        const clampedZoom = Math.max(10, Math.min(500, zoom));
        set({ zoom: clampedZoom });
      },

      setPanX: (panX) => set({ panX }),
      setPanY: (panY) => set({ panY }),

      setIsPanActive: (isPanActive) => set({ isPanActive }),

      setSelectedLayerId: (layerId) => set({ selectedLayerId: layerId }),

      addLayer: (layer) => {
        const state = get();
        const newLayers = [...state.layers, layer];
        set({
          layers: newLayers,
          selectedLayerId: layer.id,
          isDirty: true,
        });
      },

      updateLayer: (layerId, updates) => {
        const state = get();
        const newLayers = state.layers.map((layer) =>
          layer.id === layerId ? { ...layer, ...updates } : layer
        );
        set({
          layers: newLayers,
          isDirty: true,
        });
      },

      removeLayer: (layerId) => {
        const state = get();
        const newLayers = state.layers.filter((layer) => layer.id !== layerId);
        set({
          layers: newLayers,
          selectedLayerId:
            state.selectedLayerId === layerId ? null : state.selectedLayerId,
          isDirty: true,
        });
      },

      reorderLayers: (fromIndex, toIndex) => {
        const state = get();
        const newLayers = [...state.layers];
        const [removed] = newLayers.splice(fromIndex, 1);
        newLayers.splice(toIndex, 0, removed);
        set({
          layers: newLayers,
          isDirty: true,
        });
      },

      undo: () => {
        const state = get();
        if (state.historyIndex <= 0) return;

        const newIndex = state.historyIndex - 1;
        const previousIcon = state.history[newIndex];
        
        set({
          currentIcon: previousIcon,
          layers: previousIcon?.layers || [],
          historyIndex: newIndex,
          isDirty: true,
        });
      },

      redo: () => {
        const state = get();
        if (state.historyIndex >= state.history.length - 1) return;

        const newIndex = state.historyIndex + 1;
        const nextIcon = state.history[newIndex];
        
        set({
          currentIcon: nextIcon,
          layers: nextIcon?.layers || [],
          historyIndex: newIndex,
          isDirty: true,
        });
      },

      resetEditor: () => {
        set(initialState);
      },

      setError: (error) => set({ error }),

      setIsSaving: (isSaving) => set({ isSaving }),

      setIsLoading: (isLoading) => set({ isLoading }),

      pushToHistory: (icon) => {
        const state = get();
        const newHistory = state.history.slice(0, state.historyIndex + 1);
        newHistory.push(icon);
        
        // Limit history to 50 entries
        if (newHistory.length > 50) {
          newHistory.shift();
        }

        set({
          history: newHistory,
          historyIndex: newHistory.length - 1,
          currentIcon: icon,
          isDirty: false,
        });
      },
    }),
    {
      name: 'editor-store',
      partialize: (state) => ({
        currentIcon: state.currentIcon,
        zoom: state.zoom,
        panX: state.panX,
        panY: state.panY,
        layers: state.layers,
        history: state.history,
        historyIndex: state.historyIndex,
      }),
    }
  )
);
