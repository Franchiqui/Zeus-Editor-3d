'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid';

// Types
export interface VectorPoint {
  x: number;
  y: number;
}

export interface VectorPath {
  id: string;
  points: VectorPoint[];
  closed: boolean;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
}

export interface VectorElement {
  id: string;
  type: 'rectangle' | 'ellipse' | 'line' | 'path' | 'text' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  name: string;
  path?: VectorPath;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  children?: string[]; // IDs de elementos hijos para grupos
}

export interface EditorLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  elements: string[];
}

export interface EditorHistory {
  past: EditorState[];
  future: EditorState[];
}

export interface EditorState {
  elements: VectorElement[];
  layers: EditorLayer[];
  selectedElementIds: string[];
  activeLayerId: string;
  tool: string;
  zoom: number;
  pan: VectorPoint;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  history: EditorHistory;
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string;
  clipboard: VectorElement[];
}

export interface EditorActions {
  // Element operations
  addElement: (element: Omit<VectorElement, 'id'>) => void;
  updateElement: (id: string, updates: Partial<VectorElement>) => void;
  removeElement: (id: string) => void;
  duplicateElement: (id: string) => void;
  selectElement: (id: string) => void;
  selectMultipleElements: (ids: string[]) => void;
  deselectAll: () => void;
  moveElement: (id: string, dx: number, dy: number) => void;
  resizeElement: (id: string, width: number, height: number) => void;
  rotateElement: (id: string, rotation: number) => void;
  
  // Layer operations
  addLayer: (name?: string) => void;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string) => void;
  moveElementToLayer: (elementId: string, layerId: string) => void;
  reorderLayer: (id: string, newIndex: number) => void;
  
  // Tool operations
  setTool: (tool: string) => void;
  
  // View operations
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setPan: (pan: VectorPoint) => void;
  toggleGrid: () => void;
  toggleSnapToGrid: () => void;
  
  // Color operations
  setFillColor: (color: string) => void;
  setStrokeColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setOpacity: (opacity: number) => void;
  
  // History operations
  undo: () => void;
  redo: () => void;
  
  // Clipboard operations
  copy: () => void;
  cut: () => void;
  paste: () => void;
  
  // Alignment operations
  alignLeft: () => void;
  alignCenterHorizontal: () => void;
  alignRight: () => void;
  alignTop: () => void;
  alignCenterVertical: () => void;
  alignBottom: () => void;
  distributeHorizontal: () => void;
  distributeVertical: () => void;
  
  // Order operations
  bringToFront: () => void;
  sendToBack: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  
  // Group operations
  group: () => void;
  ungroup: () => void;
  
  // Visibility and lock
  toggleVisibility: (id: string) => void;
  toggleLock: (id: string) => void;
  
  // Canvas
  setCanvasSize: (width: number, height: number) => void;
  setBackgroundColor: (color: string) => void;
  
  // Selection
  selectAll: () => void;
  deleteSelected: () => void;
  
  // Reset
  resetEditor: () => void;
}

type EditorStore = EditorState & EditorActions;

const initialState: EditorState = {
  elements: [],
  layers: [
    {
      id: 'default-layer',
      name: 'Layer 1',
      visible: true,
      locked: false,
      opacity: 1,
      elements: [],
    },
  ],
  selectedElementIds: [],
  activeLayerId: 'default-layer',
  tool: 'select',
  zoom: 100,
  pan: { x: 0, y: 0 },
  showGrid: true,
  snapToGrid: true,
  gridSize: 10,
  fillColor: '#3B82F6',
  strokeColor: '#1E40AF',
  strokeWidth: 1,
  opacity: 1,
  history: {
    past: [],
    future: [],
  },
  canvasWidth: 800,
  canvasHeight: 600,
  backgroundColor: '#FFFFFF',
  clipboard: [],
};

const useEditorStore = create<EditorStore>()(
  persist(
    immer((set, get) => ({
      ...initialState,

      addElement: (element) =>
        set((state) => {
          const newElement: VectorElement = {
            ...element,
            id: uuidv4(),
          };
          state.elements.push(newElement);
          const layer = state.layers.find((l: EditorLayer) => l.id === state.activeLayerId);
          if (layer) {
            layer.elements.push(newElement.id);
          }
          state.selectedElementIds = [newElement.id];
          state.history.past.push(structuredClone(state));
          state.history.future = [];
        }),

      updateElement: (id, updates) =>
        set((state) => {
          const element = state.elements.find((el: VectorElement) => el.id === id);
          if (element) {
            Object.assign(element, updates);
            state.history.past.push(structuredClone(state));
            state.history.future = [];
          }
        }),

      removeElement: (id) =>
        set((state) => {
          state.elements = state.elements.filter((el: VectorElement) => el.id !== id);
          state.layers.forEach((layer: EditorLayer) => {
            layer.elements = layer.elements.filter((elId: string) => elId !== id);
          });
          state.selectedElementIds = state.selectedElementIds.filter(
            (elId: string) => elId !== id
          );
          state.history.past.push(structuredClone(state));
          state.history.future = [];
        }),

      duplicateElement: (id) =>
        set((state) => {
          const element = state.elements.find((el: VectorElement) => el.id === id);
          if (element) {
            const newElement: VectorElement = {
              ...structuredClone(element),
              id: uuidv4(),
              x: element.x + 20,
              y: element.y + 20,
              name: `${element.name} (copy)`,
            };
            state.elements.push(newElement);
            const layer = state.layers.find((l: EditorLayer) => l.id === state.activeLayerId);
            if (layer) {
              layer.elements.push(newElement.id);
            }
            state.selectedElementIds = [newElement.id];
            state.history.past.push(structuredClone(state));
            state.history.future = [];
          }
        }),

      selectElement: (id) =>
        set((state) => {
          state.selectedElementIds = [id];
        }),

      selectMultipleElements: (ids) =>
        set((state) => {
          state.selectedElementIds = ids;
        }),

      deselectAll: () =>
        set((state) => {
          state.selectedElementIds = [];
        }),

      moveElement: (id, dx, dy) =>
        set((state) => {
          const element = state.elements.find((el: VectorElement) => el.id === id);
          if (element) {
            element.x += dx;
            element.y += dy;
          }
        }),

      resizeElement: (id, width, height) =>
        set((state) => {
          const element = state.elements.find((el: VectorElement) => el.id === id);
          if (element) {
            element.width = width;
            element.height = height;
          }
        }),

      rotateElement: (id, rotation) =>
        set((state) => {
          const element = state.elements.find((el: VectorElement) => el.id === id);
          if (element) {
            element.rotation = rotation;
          }
        }),

      addLayer: (name) =>
        set((state) => {
          const newLayer: EditorLayer = {
            id: uuidv4(),
            name: name || `Layer ${state.layers.length + 1}`,
            visible: true,
            locked: false,
            opacity: 1,
            elements: [],
          };
          state.layers.push(newLayer);
          state.activeLayerId = newLayer.id;
        }),

      removeLayer: (id) =>
        set((state) => {
          if (state.layers.length <= 1) return;
          const layer = state.layers.find((l: EditorLayer) => l.id === id);
          if (layer) {
            state.elements = state.elements.filter(
              (el: VectorElement) => !layer.elements.includes(el.id)
            );
            state.layers = state.layers.filter((l: EditorLayer) => l.id !== id);
            if (state.activeLayerId === id) {
              state.activeLayerId = state.layers[state.layers.length - 1].id;
            }
          }
        }),

      setActiveLayer: (id) =>
        set((state) => {
          state.activeLayerId = id;
        }),

      moveElementToLayer: (elementId, layerId) =>
        set((state) => {
          state.layers.forEach((layer: EditorLayer) => {
            layer.elements = layer.elements.filter((elId: string) => elId !== elementId);
          });
          const targetLayer = state.layers.find((l: EditorLayer) => l.id === layerId);
          if (targetLayer) {
            targetLayer.elements.push(elementId);
          }
        }),

      reorderLayer: (id, newIndex) =>
        set((state) => {
          const currentIndex = state.layers.findIndex((l: EditorLayer) => l.id === id);
          if (currentIndex !== -1) {
            const [layer] = state.layers.splice(currentIndex, 1);
            state.layers.splice(newIndex, 0, layer);
          }
        }),

      setTool: (tool) =>
        set((state) => {
          state.tool = tool;
        }),

      setZoom: (zoom) =>
        set((state) => {
          state.zoom = Math.max(10, Math.min(500, zoom));
        }),

      zoomIn: () =>
        set((state) => {
          state.zoom = Math.min(500, state.zoom + 10);
        }),

      zoomOut: () =>
        set((state) => {
          state.zoom = Math.max(10, state.zoom - 10);
        }),

      resetZoom: () =>
        set((state) => {
          state.zoom = 100;
          state.pan = { x: 0, y: 0 };
        }),

      setPan: (pan) =>
        set((state) => {
          state.pan = pan;
        }),

      toggleGrid: () =>
        set((state) => {
          state.showGrid = !state.showGrid;
        }),

      toggleSnapToGrid: () =>
        set((state) => {
          state.snapToGrid = !state.snapToGrid;
        }),

      setFillColor: (color) =>
        set((state) => {
          state.fillColor = color;
        }),

      setStrokeColor: (color) =>
        set((state) => {
          state.strokeColor = color;
        }),

      setStrokeWidth: (width) =>
        set((state) => {
          state.strokeWidth = width;
        }),

      setOpacity: (opacity) =>
        set((state) => {
          state.opacity = opacity;
        }),

      undo: () =>
        set((state) => {
          if (state.history.past.length > 0) {
            const previous = state.history.past.pop()!;
            state.history.future.push(structuredClone(state));
            Object.assign(state, previous);
          }
        }),

      redo: () =>
        set((state) => {
          if (state.history.future.length > 0) {
            const next = state.history.future.pop()!;
            state.history.past.push(structuredClone(state));
            Object.assign(state, next);
          }
        }),

      copy: () =>
        set((state) => {
          state.clipboard = state.elements
            .filter((el: VectorElement) => state.selectedElementIds.includes(el.id))
            .map((el: VectorElement) => structuredClone(el));
        }),

      cut: () =>
        set((state) => {
          state.clipboard = state.elements
            .filter((el: VectorElement) => state.selectedElementIds.includes(el.id))
            .map((el: VectorElement) => structuredClone(el));
          state.elements = state.elements.filter(
            (el: VectorElement) => !state.selectedElementIds.includes(el.id)
          );
          state.layers.forEach((layer: EditorLayer) => {
            layer.elements = layer.elements.filter(
              (elId: string) => !state.selectedElementIds.includes(elId)
            );
          });
          state.selectedElementIds = [];
        }),

      paste: () =>
        set((state) => {
          const newElements = state.clipboard.map((el: VectorElement) => ({
            ...structuredClone(el),
            id: uuidv4(),
            x: el.x + 20,
            y: el.y + 20,
          }));
          state.elements.push(...newElements);
          const layer = state.layers.find((l: EditorLayer) => l.id === state.activeLayerId);
          if (layer) {
            layer.elements.push(...newElements.map((el: VectorElement) => el.id));
          }
          state.selectedElementIds = newElements.map((el: VectorElement) => el.id);
        }),

      deleteSelected: () =>
        set((state) => {
          state.elements = state.elements.filter(
            (el: VectorElement) => !state.selectedElementIds.includes(el.id)
          );
          state.layers.forEach((layer: EditorLayer) => {
            layer.elements = layer.elements.filter(
              (elId: string) => !state.selectedElementIds.includes(elId)
            );
          });
          state.selectedElementIds = [];
        }),

      selectAll: () =>
        set((state) => {
          state.selectedElementIds = state.elements.map((el: VectorElement) => el.id);
        }),

      group: () =>
        set((state) => {
          if (state.selectedElementIds.length < 2) return;
          const groupId = uuidv4();
          const group: VectorElement = {
            id: groupId,
            type: 'group',
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            rotation: 0,
            fillColor: '#000000',
            strokeColor: '#000000',
            strokeWidth: 1,
            opacity: 1,
            locked: false,
            visible: true,
            name: `Group ${state.elements.length + 1}`,
            children: state.selectedElementIds,
          };
          state.elements.push(group);
          state.selectedElementIds = [groupId];
        }),

      ungroup: () =>
        set((state) => {
          const groupsToUngroup = state.elements.filter(
            (el: VectorElement) =>
              el.type === 'group' && state.selectedElementIds.includes(el.id)
          );
          groupsToUngroup.forEach((group: VectorElement) => {
            if (group.children) {
              state.selectedElementIds = [
                ...state.selectedElementIds.filter((id: string) => id !== group.id),
                ...group.children,
              ];
            }
          });
          state.elements = state.elements.filter(
            (el: VectorElement) => !groupsToUngroup.includes(el)
          );
        }),

      bringToFront: () =>
        set((state) => {
          state.selectedElementIds.forEach((id: string) => {
            const index = state.elements.findIndex((el: VectorElement) => el.id === id);
            if (index !== -1) {
              const [element] = state.elements.splice(index, 1);
              state.elements.push(element);
            }
          });
        }),

      sendToBack: () =>
        set((state) => {
          state.selectedElementIds.reverse().forEach((id: string) => {
            const index = state.elements.findIndex((el: VectorElement) => el.id === id);
            if (index !== -1) {
              const [element] = state.elements.splice(index, 1);
              state.elements.unshift(element);
            }
          });
        }),

      bringForward: () =>
        set((state) => {
          state.selectedElementIds.forEach((id: string) => {
            const index = state.elements.findIndex((el: VectorElement) => el.id === id);
            if (index !== -1 && index < state.elements.length - 1) {
              const [element] = state.elements.splice(index, 1);
              state.elements.splice(index + 1, 0, element);
            }
          });
        }),

      sendBackward: () =>
        set((state) => {
          state.selectedElementIds.forEach((id: string) => {
            const index = state.elements.findIndex((el: VectorElement) => el.id === id);
            if (index > 0) {
              const [element] = state.elements.splice(index, 1);
              state.elements.splice(index - 1, 0, element);
            }
          });
        }),

      alignLeft: () =>
        set((state) => {
          const selectedElements = state.elements.filter((el: VectorElement) =>
            state.selectedElementIds.includes(el.id)
          );
          if (selectedElements.length < 2) return;
          const minX = Math.min(...selectedElements.map((el: VectorElement) => el.x));
          selectedElements.forEach((el: VectorElement) => {
            const element = state.elements.find((e: VectorElement) => e.id === el.id);
            if (element) element.x = minX;
          });
        }),

      alignCenterHorizontal: () =>
        set((state) => {
          const selectedElements = state.elements.filter((el: VectorElement) =>
            state.selectedElementIds.includes(el.id)
          );
          if (selectedElements.length < 2) return;
          const centerX =
            selectedElements.reduce((sum: any, el: VectorElement) => sum + el.x + el.width / 2, 0) /
            selectedElements.length;
          selectedElements.forEach((el: VectorElement) => {
            const element = state.elements.find((e: VectorElement) => e.id === el.id);
            if (element) element.x = centerX - element.width / 2;
          });
        }),

      alignRight: () =>
        set((state) => {
          const selectedElements = state.elements.filter((el: VectorElement) =>
            state.selectedElementIds.includes(el.id)
          );
          if (selectedElements.length < 2) return;
          const maxRight = Math.max(
            ...selectedElements.map((el: VectorElement) => el.x + el.width)
          );
          selectedElements.forEach((el: VectorElement) => {
            const element = state.elements.find((e: VectorElement) => e.id === el.id);
            if (element) element.x = maxRight - element.width;
          });
        }),

      alignTop: () =>
        set((state) => {
          const selectedElements = state.elements.filter((el: VectorElement) =>
            state.selectedElementIds.includes(el.id)
          );
          if (selectedElements.length < 2) return;
          const minY = Math.min(...selectedElements.map((el: VectorElement) => el.y));
          selectedElements.forEach((el: VectorElement) => {
            const element = state.elements.find((e: VectorElement) => e.id === el.id);
            if (element) element.y = minY;
          });
        }),

      alignCenterVertical: () =>
        set((state) => {
          const selectedElements = state.elements.filter((el: VectorElement) =>
            state.selectedElementIds.includes(el.id)
          );
          if (selectedElements.length < 2) return;
          const centerY =
            selectedElements.reduce((sum: any, el: VectorElement) => sum + el.y + el.height / 2, 0) /
            selectedElements.length;
          selectedElements.forEach((el: VectorElement) => {
            const element = state.elements.find((e: VectorElement) => e.id === el.id);
            if (element) element.y = centerY - element.height / 2;
          });
        }),

      alignBottom: () =>
        set((state) => {
          const selectedElements = state.elements.filter((el: VectorElement) =>
            state.selectedElementIds.includes(el.id)
          );
          if (selectedElements.length < 2) return;
          const maxBottom = Math.max(
            ...selectedElements.map((el: VectorElement) => el.y + el.height)
          );
          selectedElements.forEach((el: VectorElement) => {
            const element = state.elements.find((e: VectorElement) => e.id === el.id);
            if (element) element.y = maxBottom - element.height;
          });
        }),

      distributeHorizontal: () =>
        set((state) => {
          const selectedElements = state.elements
            .filter((el: VectorElement) => state.selectedElementIds.includes(el.id))
            .sort((a: VectorElement, b: VectorElement) => a.x - b.x);
          if (selectedElements.length < 3) return;
          const totalWidth = selectedElements.reduce(
            (sum: number, el: VectorElement) => sum + el.width,
            0
          );
          const startX = selectedElements[0].x;
          const endX =
            selectedElements[selectedElements.length - 1].x +
            selectedElements[selectedElements.length - 1].width;
          const space = endX - startX - totalWidth;
          const gap = space / (selectedElements.length - 1);
          let currentX = startX;
          selectedElements.forEach((el: VectorElement) => {
            const element = state.elements.find((e: VectorElement) => e.id === el.id);
            if (element) {
              element.x = currentX;
              currentX += element.width + gap;
            }
          });
        }),

      distributeVertical: () =>
        set((state) => {
          const selectedElements = state.elements
            .filter((el: VectorElement) => state.selectedElementIds.includes(el.id))
            .sort((a: VectorElement, b: VectorElement) => a.y - b.y);
          if (selectedElements.length < 3) return;
          const totalHeight = selectedElements.reduce(
            (sum: number, el: VectorElement) => sum + el.height,
            0
          );
          const startY = selectedElements[0].y;
          const endY =
            selectedElements[selectedElements.length - 1].y +
            selectedElements[selectedElements.length - 1].height;
          const space = endY - startY - totalHeight;
          const gap = space / (selectedElements.length - 1);
          let currentY = startY;
          selectedElements.forEach((el: VectorElement) => {
            const element = state.elements.find((e: VectorElement) => e.id === el.id);
            if (element) {
              element.y = currentY;
              currentY += element.height + gap;
            }
          });
        }),

      toggleVisibility: (id) =>
        set((state) => {
          const element = state.elements.find((el: VectorElement) => el.id === id);
          if (element) {
            element.visible = !element.visible;
          }
        }),

      toggleLock: (id) =>
        set((state) => {
          const element = state.elements.find((el: VectorElement) => el.id === id);
          if (element) {
            element.locked = !element.locked;
          }
        }),

      setCanvasSize: (width, height) =>
        set((state) => {
          state.canvasWidth = width;
          state.canvasHeight = height;
        }),

      setBackgroundColor: (color) =>
        set((state) => {
          state.backgroundColor = color;
        }),

      resetEditor: () =>
        set((state) => {
          Object.assign(state, initialState);
        }),
    })),
    {
      name: 'editor-storage',
      partialize: (state) => ({
        elements: state.elements,
        layers: state.layers,
        canvasWidth: state.canvasWidth,
        canvasHeight: state.canvasHeight,
        backgroundColor: state.backgroundColor,
      }),
    }
  )
);

export default useEditorStore;