'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { drawStroke, getTextBounds } from '@/lib/draw-stroke';

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
  closed?: boolean;
  shapeType?: 'circle' | 'rectangle' | 'text';
  // Propiedades exclusivas de shapeType === 'text'
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  rotation?: number; // grados, sólo usado por texto (gira sobre su propio centro)
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  strokes: Stroke[];
  colorGroup: 1 | 2 | 3;
}

export interface Icon {
  id: string;
  title: string;
  description: string;
  layers: Layer[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Tab {
  id: string;
  icon: Icon;
  selectedStrokes: string[];
  selectedLayerId: string | null;
  historyPast: Layer[][];
  historyFuture: Layer[][];
  zoom: number;
  panX: number;
  panY: number;
  isDrawing: boolean;
  currentStroke: Point[];
  templateImage: string | null;
  templateOpacity: number;
  templateScale: number;
  templateOffsetX: number;
  templateOffsetY: number;
  referenceImage: string | null;
  referenceName: string;
}

export type ActiveState = AppState & Tab & { currentIcon: Icon | null };

export interface AppState {
  // Tabs
  tabs: Tab[];
  activeTabId: string;

  // Catálogo global de iconos guardados
  icons: Icon[];

  // Estado global de herramientas (compartido entre pestañas)
  tool: string;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  gridSize: number;
  snapEnabled: boolean;
  canvasTransparent: boolean;
  clipboard: Stroke[];
  cornerRadius: number;
  cornerSegments: number;
  curveClosed: boolean;
  fillHistory: string[];
  strokeHistory: string[];

  // Actions
  createTab: (icon?: Icon) => string;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;

  addStroke: (stroke: Stroke) => void;
  removeStroke: (id: string) => void;
  updateStroke: (id: string, strokeUpdate: Partial<Stroke>) => void;
  replaceStrokeWith: (id: string, newStrokes: Stroke[]) => void;
  setSelectedStrokes: (ids: string[]) => void;
  addLayer: () => void;
  removeLayer: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  selectLayer: (id: string | null) => void;
  toggleLayerVisibility: (id: string) => void;
  toggleLayerLock: (id: string) => void;
  setLayerColorGroup: (id: string, group: 1 | 2 | 3) => void;
  setTool: (tool: string) => void;
  setFillColor: (color: string) => void;
  setStrokeColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setGridSize: (size: number) => void;
  setZoom: (zoom: number) => void;
  setPanX: (panX: number) => void;
  setPanY: (panY: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setCurveClosed: (closed: boolean) => void;
  setCanvasTransparent: (transparent: boolean) => void;
  setIsDrawing: (isDrawing: boolean) => void;
  setCurrentStroke: (points: Point[]) => void;
  addPointToCurrentStroke: (point: Point) => void;
  copyStrokes: () => void;
  cutStrokes: () => void;
  pasteStrokes: () => void;
  deleteSelectedStrokes: () => void;
  bringSelectedForward: () => void;
  sendSelectedBackward: () => void;
  undo: () => void;
  redo: () => void;
  setCurrentIcon: (icon: Icon) => void;
  renameActiveTab: (title: string) => void;
  saveIcon: () => void;
  loadIcon: (id: string) => void;
  deleteIcon: (id: string) => void;
  importPNG: (file: File, canvasSize?: { width: number; height: number }, detailLevel?: number) => void;
  extractStrokes: (boundaryStrokeId: string) => void;
  replaceStrokes: (strokes: Stroke[]) => void;
  replaceStrokesNoHistory: (strokes: Stroke[]) => void;
  updateStrokeNoHistory: (id: string, strokeUpdate: Partial<Stroke>) => void;
  setTemplateImage: (image: string | null) => void;
  setTemplateOpacity: (opacity: number) => void;
  setTemplateScale: (scale: number) => void;
  setTemplateOffsetX: (x: number) => void;
  setTemplateOffsetY: (y: number) => void;
  setReferenceImage: (image: string | null, name: string) => void;
  clearReferenceImage: () => void;
  setCornerRadius: (radius: number) => void;
  setCornerSegments: (segments: number) => void;
  addFillHistory: (color: string) => void;
  addStrokeHistory: (color: string) => void;
  pushHistory: () => void;
  exportAsPNG: () => void;
  exportAsICO: () => void;
  copyPNGCode: () => void;
  exportAsSVG: () => void;
  copyAsJSON: () => void;

  // Getters / Helpers
  getActiveTab: () => Tab | null;
  getActiveIcon: () => Icon | null;
  getActiveState: () => ActiveState;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepCloneStrokes(strokes: Stroke[]): Stroke[] {
  return strokes.map(s => ({
    ...s,
    points: s.points.map(p => ({ ...p })),
    holes: s.holes ? s.holes.map(h => h.map(p => ({ ...p }))) : undefined,
  }));
}

function deepCloneLayers(layers: Layer[]): Layer[] {
  return layers.map(l => ({
    ...l,
    strokes: deepCloneStrokes(l.strokes),
  }));
}

function createDefaultLayer(): Layer {
  return {
    id: uuidv4(),
    name: 'Layer 1',
    visible: true,
    locked: false,
    strokes: [],
    colorGroup: 1,
  };
}

function createEmptyIcon(): Icon {
  return {
    id: uuidv4(),
    title: '',
    description: '',
    layers: [createDefaultLayer()],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createEmptyTab(): Tab {
  return {
    id: uuidv4(),
    icon: createEmptyIcon(),
    selectedStrokes: [],
    selectedLayerId: null,
    historyPast: [],
    historyFuture: [],
    zoom: 1,
    panX: 0,
    panY: 0,
    isDrawing: false,
    currentStroke: [],
    templateImage: null,
    templateOpacity: 0.5,
    templateScale: 1,
    templateOffsetX: 0,
    templateOffsetY: 0,
    referenceImage: null,
    referenceName: '',
  };
}

// ---------------------------------------------------------------------------
// Contour helpers (needed by importPNG)
// ---------------------------------------------------------------------------

function getCentroid(pts: Point[]): Point {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function simplifyContourOrdered(pts: Point[], step: number): Point[] {
  if (pts.length <= 2) return pts;
  const result: Point[] = [];
  for (let i = 0; i < pts.length; i += step) {
    result.push(pts[i]);
  }
  if (result.length > 2) {
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.abs(last.x - first.x) > 1 || Math.abs(last.y - first.y) > 1) {
      result.push(first);
    }
  }
  return result;
}

function douglasPeucker(pts: Point[], epsilon: number): Point[] {
  if (pts.length <= 2) return pts;
  const sqEps = epsilon * epsilon;

  function findFarthest(start: number, end: number): { index: number; maxSq: number } {
    let maxSq = 0;
    let index = start;
    const x1 = pts[start].x, y1 = pts[start].y;
    const x2 = pts[end].x, y2 = pts[end].y;
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    for (let i = start + 1; i < end; i++) {
      let distSq: number;
      if (lenSq === 0) {
        const a = pts[i].x - x1;
        const b = pts[i].y - y1;
        distSq = a * a + b * b;
      } else {
        const t = ((pts[i].x - x1) * dx + (pts[i].y - y1) * dy) / lenSq;
        const clamped = Math.max(0, Math.min(1, t));
        const projX = x1 + clamped * dx;
        const projY = y1 + clamped * dy;
        const a = pts[i].x - projX;
        const b = pts[i].y - projY;
        distSq = a * a + b * b;
      }
      if (distSq > maxSq) {
        maxSq = distSq;
        index = i;
      }
    }
    return { index, maxSq };
  }

  const stack: [number, number][] = [[0, pts.length - 1]];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    const { index, maxSq } = findFarthest(start, end);
    if (maxSq > sqEps) {
      keep[index] = 1;
      stack.push([start, index]);
      stack.push([index, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) result.push(pts[i]);
  }
  return result.length >= 2 ? result : pts.slice(0, 2);
}

function traceContourBoundary(filled: Uint8Array, w: number, h: number): Point[] {
  let startX = -1, startY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (filled[y * w + x]) {
        startX = x; startY = y;
        break;
      }
    }
    if (startX !== -1) break;
  }
  if (startX === -1) return [];

  const isFilled = (x: number, y: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return false;
    return filled[y * w + x] === 1;
  };

  const dirs = [
    { dx: 0, dy: -1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 1 },
    { dx: 0, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: 0 }, { dx: -1, dy: -1 },
  ];

  const contour: Point[] = [];
  let x = startX, y = startY;
  let backtrack = 6;

  do {
    contour.push({ x, y });
    let found = false;
    for (let i = 1; i <= 8; i++) {
      const d = (backtrack + i) % 8;
      const nx = x + dirs[d].dx;
      const ny = y + dirs[d].dy;
      if (isFilled(nx, ny)) {
        backtrack = (d + 4) % 8;
        x = nx; y = ny;
        found = true;
        break;
      }
    }
    if (!found) break;
  } while (x !== startX || y !== startY);

  return contour;
}

function findAllContours(filled: Uint8Array, w: number, h: number): { points: Point[]; type: 'outer' | 'inner' }[] {
  const contours: { points: Point[]; type: 'outer' | 'inner' }[] = [];

  const visited = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (filled[idx] && !visited[idx]) {
        const region = new Uint8Array(w * h);
        const queue: [number, number][] = [[x, y]];
        visited[idx] = 1;
        region[idx] = 1;
        let qi = 0;
        while (qi < queue.length) {
          const [cx, cy] = queue[qi++];
          const nbs = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (const [nx, ny] of nbs) {
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const nidx = ny * w + nx;
              if (filled[nidx] && !visited[nidx]) {
                visited[nidx] = 1;
                region[nidx] = 1;
                queue.push([nx, ny]);
              }
            }
          }
        }
        const contour = traceContourBoundary(region, w, h);
        if (contour.length > 2) contours.push({ points: contour, type: 'outer' });
      }
    }
  }

  const tVisited = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!filled[idx] && !tVisited[idx]) {
        const queue: [number, number][] = [[x, y]];
        tVisited[idx] = 1;
        const pixels: [number, number][] = [[x, y]];
        let touchesBorder = false;
        let qi = 0;
        while (qi < queue.length) {
          const [cx, cy] = queue[qi++];
          if (cx === 0 || cx === w - 1 || cy === 0 || cy === h - 1) touchesBorder = true;
          const nbs = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (const [nx, ny] of nbs) {
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const nidx = ny * w + nx;
              if (!filled[nidx] && !tVisited[nidx]) {
                tVisited[nidx] = 1;
                queue.push([nx, ny]);
                pixels.push([nx, ny]);
              }
            }
          }
        }
        if (!touchesBorder) {
          const region = new Uint8Array(w * h);
          for (const [px, py] of pixels) region[py * w + px] = 1;
          const contour = traceContourBoundary(region, w, h);
          if (contour.length > 2) contours.push({ points: contour, type: 'inner' });
        }
      }
    }
  }

  return contours;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const useAppStore = create<AppState>()(
  persist(
    (set, get) => {
      const initialTab = createEmptyTab();

      return {
        tabs: [initialTab],
        activeTabId: initialTab.id,
        icons: [],
        tool: 'select',
        fillColor: 'transparent',
        strokeColor: '#ffffff',
        strokeWidth: 1,
        gridSize: 10,
        snapEnabled: true,
        canvasTransparent: false,
        clipboard: [],

        cornerRadius: 20,
        cornerSegments: 2,
        curveClosed: false,
        fillHistory: [],
        strokeHistory: [],

        getActiveTab: () => {
          const state = get();
          return state.tabs.find(t => t.id === state.activeTabId) || null;
        },

        getActiveIcon: () => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          return tab?.icon || null;
        },

        getActiveState: () => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          return {
            ...state,
            ...(tab || {}),
            currentIcon: tab?.icon ?? null,
            selectedStrokes: tab?.selectedStrokes ?? [],
            selectedLayerId: tab?.selectedLayerId ?? null,
            zoom: tab?.zoom ?? 1,
            panX: tab?.panX ?? 0,
            panY: tab?.panY ?? 0,
            currentStroke: tab?.currentStroke ?? [],
            historyPast: tab?.historyPast ?? [],
            historyFuture: tab?.historyFuture ?? [],
            templateImage: tab?.templateImage ?? null,
            templateOpacity: tab?.templateOpacity ?? 0.5,
            templateScale: tab?.templateScale ?? 1,
            templateOffsetX: tab?.templateOffsetX ?? 0,
            templateOffsetY: tab?.templateOffsetY ?? 0,
            referenceImage: tab?.referenceImage ?? null,
            referenceName: tab?.referenceName ?? '',
          } as ActiveState;
        },

        createTab: (icon) => {
          const state = get();
          let newIcon = icon ? { ...icon, id: uuidv4(), updatedAt: new Date() } : createEmptyIcon();
          if ((newIcon as any).strokes && !newIcon.layers) {
            newIcon = {
              ...newIcon,
              layers: [{
                id: uuidv4(),
                name: 'Layer 1',
                visible: true,
                locked: false,
                strokes: (newIcon as any).strokes as Stroke[],
                colorGroup: 1,
              }],
            };
          }
          const newTab: Tab = {
            ...createEmptyTab(),
            icon: newIcon,
            selectedLayerId: newIcon.layers[0]?.id || null,
          };
          set({ tabs: [...state.tabs, newTab], activeTabId: newTab.id });
          return newTab.id;
        },

        closeTab: (tabId) => {
          const state = get();
          if (state.tabs.length <= 1) {
            // Si es la última pestaña, reemplazar con una vacía
            const newTab = createEmptyTab();
            set({ tabs: [newTab], activeTabId: newTab.id });
            return;
          }
          const newTabs = state.tabs.filter(t => t.id !== tabId);
          const newActiveId = state.activeTabId === tabId
            ? newTabs[newTabs.length - 1].id
            : state.activeTabId;
          set({ tabs: newTabs, activeTabId: newActiveId });
        },

        switchTab: (tabId) => {
          const state = get();
          if (!state.tabs.some(t => t.id === tabId)) return;
          // Limpiar estado transitorio de dibujo en todas las pestañas
          const newTabs = state.tabs.map(t =>
            t.id === tabId ? t : { ...t, isDrawing: false, currentStroke: [] }
          );
          set({ tabs: newTabs, activeTabId: tabId });
        },

        addStroke: (stroke) => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          const activeLayerId = tab.selectedLayerId || tab.icon.layers[0]?.id;
          if (!activeLayerId) return;
          const activeLayer = tab.icon.layers.find(l => l.id === activeLayerId);
          if (activeLayer?.locked) return;

          const past = [...tab.historyPast, deepCloneLayers(tab.icon.layers)];
          const updatedLayers = tab.icon.layers.map(l =>
            l.id === activeLayerId ? { ...l, strokes: [...l.strokes, stroke] } : l
          );
          const updatedIcon = {
            ...tab.icon,
            layers: updatedLayers,
            updatedAt: new Date(),
          };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon: updatedIcon, historyPast: past, historyFuture: [] } : t
          );
          set({ tabs: newTabs });
        },

        removeStroke: (id) => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          if (isStrokeLocked(tab.icon, id)) return;

          const past = [...tab.historyPast, deepCloneLayers(tab.icon.layers)];
          const updatedLayers = tab.icon.layers.map(l => ({
            ...l,
            strokes: l.strokes.filter(s => s.id !== id),
          }));
          const updatedIcon = {
            ...tab.icon,
            layers: updatedLayers,
            updatedAt: new Date(),
          };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId
              ? { ...t, icon: updatedIcon, historyPast: past, historyFuture: [], selectedStrokes: t.selectedStrokes.filter(sid => sid !== id) }
              : t
          );
          set({ tabs: newTabs });
        },

        replaceStrokeWith: (id, newStrokes) => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          if (isStrokeLocked(tab.icon, id)) return;
          if (newStrokes.length === 0) return;

          const past = [...tab.historyPast, deepCloneLayers(tab.icon.layers)];
          const updatedLayers = tab.icon.layers.map(l => {
            if (!l.strokes.some(s => s.id === id)) return l;
            return {
              ...l,
              strokes: [...l.strokes.filter(s => s.id !== id), ...newStrokes],
            };
          });
          const updatedIcon = {
            ...tab.icon,
            layers: updatedLayers,
            updatedAt: new Date(),
          };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId
              ? { ...t, icon: updatedIcon, historyPast: past, historyFuture: [], selectedStrokes: newStrokes.map(s => s.id) }
              : t
          );
          set({ tabs: newTabs });
        },

        updateStroke: (id, strokeUpdate) => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          if (isStrokeLocked(tab.icon, id)) return;

          const past = [...tab.historyPast, deepCloneLayers(tab.icon.layers)];
          const updatedLayers = tab.icon.layers.map(l => ({
            ...l,
            strokes: l.strokes.map(s => s.id === id ? { ...s, ...strokeUpdate } : s),
          }));
          const updatedIcon = {
            ...tab.icon,
            layers: updatedLayers,
            updatedAt: new Date(),
          };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon: updatedIcon, historyPast: past, historyFuture: [] } : t
          );
          set({ tabs: newTabs });
        },

        setSelectedStrokes: (ids) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, selectedStrokes: ids } : t
          );
          set({ tabs: newTabs });
        },

        addLayer: () => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          const newLayer: Layer = {
            id: uuidv4(),
            name: `Layer ${tab.icon.layers.length + 1}`,
            visible: true,
            locked: false,
            strokes: [],
            colorGroup: ((tab.icon.layers.length % 3) + 1) as 1 | 2 | 3,
          };
          const updatedIcon = { ...tab.icon, layers: [...tab.icon.layers, newLayer], updatedAt: new Date() };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon: updatedIcon, selectedLayerId: newLayer.id } : t
          );
          set({ tabs: newTabs });
        },

        removeLayer: (id) => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab || tab.icon.layers.length <= 1) return;
          const newLayers = tab.icon.layers.filter(l => l.id !== id);
          const updatedIcon = { ...tab.icon, layers: newLayers, updatedAt: new Date() };
          const newSelectedLayerId = tab.selectedLayerId === id ? newLayers[0]?.id || null : tab.selectedLayerId;
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId
              ? { ...t, icon: updatedIcon, selectedLayerId: newSelectedLayerId, selectedStrokes: t.selectedStrokes.filter(sid => newLayers.some(l => l.strokes.some(s => s.id === sid))) }
              : t
          );
          set({ tabs: newTabs });
        },

        renameLayer: (id, name) => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          const updatedIcon = {
            ...tab.icon,
            layers: tab.icon.layers.map(l => l.id === id ? { ...l, name } : l),
            updatedAt: new Date(),
          };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon: updatedIcon } : t
          );
          set({ tabs: newTabs });
        },

        selectLayer: (id) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, selectedLayerId: id } : t
          );
          set({ tabs: newTabs });
        },

        toggleLayerVisibility: (id) => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          const updatedIcon = {
            ...tab.icon,
            layers: tab.icon.layers.map(l => l.id === id ? { ...l, visible: !l.visible } : l),
            updatedAt: new Date(),
          };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon: updatedIcon } : t
          );
          set({ tabs: newTabs });
        },

        toggleLayerLock: (id) => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          const updatedIcon = {
            ...tab.icon,
            layers: tab.icon.layers.map(l => l.id === id ? { ...l, locked: !l.locked } : l),
            updatedAt: new Date(),
          };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon: updatedIcon } : t
          );
          set({ tabs: newTabs });
        },

        setLayerColorGroup: (id, group) => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          const updatedIcon = {
            ...tab.icon,
            layers: tab.icon.layers.map(l => l.id === id ? { ...l, colorGroup: group } : l),
            updatedAt: new Date(),
          };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon: updatedIcon } : t
          );
          set({ tabs: newTabs });
        },

        setTool: (tool) => set({ tool }),
        setFillColor: (color) => set({ fillColor: color }),
        setStrokeColor: (color) => set({ strokeColor: color }),
        setStrokeWidth: (width) => set({ strokeWidth: width }),
        setGridSize: (size) => set({ gridSize: Math.max(4, Math.min(50, size)) }),

        setZoom: (zoom) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, zoom: Math.max(0.1, Math.min(5, zoom)) } : t
          );
          set({ tabs: newTabs });
        },

        setPanX: (panX) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, panX } : t
          );
          set({ tabs: newTabs });
        },

        setPanY: (panY) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, panY } : t
          );
          set({ tabs: newTabs });
        },

        setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
        setCanvasTransparent: (transparent) => set({ canvasTransparent: transparent }),
        setIsDrawing: (isDrawing) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, isDrawing } : t
          );
          set({ tabs: newTabs });
        },

        setCurrentStroke: (points) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, currentStroke: points } : t
          );
          set({ tabs: newTabs });
        },

        addPointToCurrentStroke: (point) => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, currentStroke: [...t.currentStroke, point] } : t
          );
          set({ tabs: newTabs });
        },

        copyStrokes: () => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          const allStrokes = tab.icon.layers.flatMap(l => l.strokes);
          const strokesToCopy = allStrokes.filter(s => tab.selectedStrokes.includes(s.id));
          set({ clipboard: strokesToCopy });
        },

        cutStrokes: () => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          const allStrokes = tab.icon.layers.flatMap(l => l.strokes);
          const strokesToCut = allStrokes.filter(s => tab.selectedStrokes.includes(s.id) && !isStrokeLocked(tab.icon, s.id));
          set({ clipboard: strokesToCut });
          state.deleteSelectedStrokes();
        },

        pasteStrokes: () => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab || state.clipboard.length === 0) return;
          const activeLayerId = tab.selectedLayerId || tab.icon.layers[0]?.id;
          if (!activeLayerId) return;
          const activeLayer = tab.icon.layers.find(l => l.id === activeLayerId);
          if (activeLayer?.locked) return;

          const past = [...tab.historyPast, deepCloneLayers(tab.icon.layers)];
          const newStrokes = state.clipboard.map(s => ({
            ...s,
            id: uuidv4(),
            points: s.points.map(p => ({ x: p.x + 20, y: p.y + 20 })),
            holes: s.holes ? s.holes.map(h => h.map(p => ({ x: p.x + 20, y: p.y + 20 }))) : undefined,
          }));
          const updatedLayers = tab.icon.layers.map(l =>
            l.id === activeLayerId ? { ...l, strokes: [...l.strokes, ...newStrokes] } : l
          );
          const updatedIcon = {
            ...tab.icon,
            layers: updatedLayers,
            updatedAt: new Date(),
          };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon: updatedIcon, historyPast: past, historyFuture: [] } : t
          );
          set({ tabs: newTabs });
        },

        deleteSelectedStrokes: () => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;

          const past = [...tab.historyPast, deepCloneLayers(tab.icon.layers)];
          const updatedLayers = tab.icon.layers.map(l => ({
            ...l,
            strokes: l.strokes.filter(s => !(tab.selectedStrokes.includes(s.id) && !isStrokeLocked(tab.icon, s.id))),
          }));
          const updatedIcon = {
            ...tab.icon,
            layers: updatedLayers,
            updatedAt: new Date(),
          };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId
              ? { ...t, icon: updatedIcon, selectedStrokes: t.selectedStrokes.filter(sid => !isStrokeLocked(tab.icon, sid)), historyPast: past, historyFuture: [] }
              : t
          );
          set({ tabs: newTabs });
        },

        bringSelectedForward: () => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab || tab.selectedStrokes.length === 0) return;

          const hasLocked = tab.selectedStrokes.some(id => isStrokeLocked(tab.icon, id));
          if (hasLocked) return;

          const past = [...tab.historyPast, deepCloneLayers(tab.icon.layers)];
          const updatedLayers = tab.icon.layers.map(l => {
            const strokes = [...l.strokes];
            for (const id of tab.selectedStrokes) {
              const idx = strokes.findIndex(s => s.id === id);
              if (idx >= 0 && idx < strokes.length - 1) {
                const temp = strokes[idx];
                strokes[idx] = strokes[idx + 1];
                strokes[idx + 1] = temp;
              }
            }
            return { ...l, strokes };
          });
          const updatedIcon = { ...tab.icon, layers: updatedLayers, updatedAt: new Date() };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon: updatedIcon, historyPast: past, historyFuture: [] } : t
          );
          set({ tabs: newTabs });
        },

        sendSelectedBackward: () => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab || tab.selectedStrokes.length === 0) return;

          const hasLocked = tab.selectedStrokes.some(id => isStrokeLocked(tab.icon, id));
          if (hasLocked) return;

          const past = [...tab.historyPast, deepCloneLayers(tab.icon.layers)];
          const updatedLayers = tab.icon.layers.map(l => {
            const strokes = [...l.strokes];
            for (const id of tab.selectedStrokes) {
              const idx = strokes.findIndex(s => s.id === id);
              if (idx > 0) {
                const temp = strokes[idx];
                strokes[idx] = strokes[idx - 1];
                strokes[idx - 1] = temp;
              }
            }
            return { ...l, strokes };
          });
          const updatedIcon = { ...tab.icon, layers: updatedLayers, updatedAt: new Date() };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon: updatedIcon, historyPast: past, historyFuture: [] } : t
          );
          set({ tabs: newTabs });
        },

        undo: () => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab || tab.historyPast.length === 0) return;

          const previous = tab.historyPast[tab.historyPast.length - 1];
          const newPast = tab.historyPast.slice(0, -1);
          const newFuture = [deepCloneLayers(tab.icon.layers), ...tab.historyFuture];
          const updatedIcon = { ...tab.icon, layers: deepCloneLayers(previous) };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId
              ? { ...t, icon: updatedIcon, historyPast: newPast, historyFuture: newFuture, selectedStrokes: [] }
              : t
          );
          set({ tabs: newTabs });
        },

        redo: () => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab || tab.historyFuture.length === 0) return;

          const next = tab.historyFuture[0];
          const newFuture = tab.historyFuture.slice(1);
          const newPast = [...tab.historyPast, deepCloneLayers(tab.icon.layers)];
          const updatedIcon = { ...tab.icon, layers: deepCloneLayers(next) };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId
              ? { ...t, icon: updatedIcon, historyPast: newPast, historyFuture: newFuture, selectedStrokes: [] }
              : t
          );
          set({ tabs: newTabs });
        },

        setCurrentIcon: (icon) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon } : t
          );
          set({ tabs: newTabs });
        },

        renameActiveTab: (title) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon: { ...t.icon, title } } : t
          );
          set({ tabs: newTabs });
        },

        saveIcon: () => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;

          const existingIndex = state.icons.findIndex(i => i.id === tab.icon.id);
          let updatedIcons: Icon[];
          if (existingIndex >= 0) {
            updatedIcons = [...state.icons];
            updatedIcons[existingIndex] = tab.icon;
          } else {
            updatedIcons = [...state.icons, tab.icon];
          }
          set({ icons: updatedIcons });

          fetch('/api/icons', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tab.icon),
          }).catch(console.error);
        },

        loadIcon: (id) => {
          const state = get();
          let icon = state.icons.find(i => i.id === id);
          if (!icon) return;

          // Migrar iconos antiguos que aún tengan strokes plano
          if ((icon as any).strokes && !icon.layers) {
            icon = {
              ...icon,
              layers: [{
                id: uuidv4(),
                name: 'Layer 1',
                visible: true,
                locked: false,
                strokes: (icon as any).strokes as Stroke[],
                colorGroup: 1,
              }],
            };
          }

          const tab = state.tabs.find(t => t.id === state.activeTabId);
          const isEmpty = icon.layers.length === 1 && icon.layers[0].strokes.length === 0 && icon.title === 'Untitled';
          if (tab && isEmpty) {
            // Reemplazar pestaña vacía
            const newTabs = state.tabs.map(t =>
              t.id === state.activeTabId ? { ...t, icon: { ...icon }, selectedStrokes: [], selectedLayerId: icon.layers[0]?.id || null, historyPast: [], historyFuture: [] } : t
            );
            set({ tabs: newTabs });
          } else {
            // Nueva pestaña
            state.createTab(icon);
          }
        },

        deleteIcon: (id) => {
          const state = get();
          set({ icons: state.icons.filter(i => i.id !== id) });
          fetch(`/api/icons?id=${id}`, { method: 'DELETE' }).catch(console.error);
        },

        importPNG: (file, canvasSize, detailLevel) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
              const level = detailLevel ?? 50;

              // Calcular resolucion de rasterizado segun el nivel de detalle.
              // 0%   -> 64px de lado maximo
              // 50%  -> 256px
              // 100% -> tamaño original (max 1024px para no petar la memoria)
              const origMaxDim = Math.max(img.width, img.height);
              let rasterMaxDim: number;
              if (level <= 0) {
                rasterMaxDim = 64;
              } else if (level >= 100) {
                rasterMaxDim = Math.min(origMaxDim, 1024);
              } else {
                rasterMaxDim = Math.round(64 + (level / 100) * (Math.min(origMaxDim, 1024) - 64));
              }
              const scale = origMaxDim > 0 ? rasterMaxDim / origMaxDim : 1;
              const w = Math.max(1, Math.round(img.width * scale));
              const h = Math.max(1, Math.round(img.height * scale));

              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              if (!ctx) return;
              ctx.drawImage(img, 0, 0, w, h);
              const imageData = ctx.getImageData(0, 0, w, h);
              const filled = new Uint8Array(w * h);
              for (let i = 0; i < w * h; i++) {
                if (imageData.data[i * 4 + 3] > 128) {
                  filled[i] = 1;
                }
              }
              const contourInfos = findAllContours(filled, w, h);
              const outerContours = contourInfos.filter(c => c.type === 'outer');
              const innerContours = contourInfos.filter(c => c.type === 'inner');

              // Epsilon adaptativo al tamaño del canvas escalado
              const epsilon = Math.max(0.3, Math.min(3, Math.max(w, h) / 400));

              const strokes: Stroke[] = [];
              // Factor para escalar los puntos de vuelta al tamaño visual original
              const visualScale = origMaxDim / rasterMaxDim;

              for (const outer of outerContours) {
                if (outer.points.length <= 2) continue;
                const maxPoints = Math.max(32, Math.round((level / 100) * 512));
                const step = Math.max(1, Math.floor(outer.points.length / maxPoints));
                const sampledOuter = simplifyContourOrdered(outer.points, step);
                const simplifiedOuter = douglasPeucker(sampledOuter, epsilon);

                // Escalar puntos al tamaño visual original
                const scaledOuter = simplifiedOuter.map(p => ({
                  x: p.x * visualScale,
                  y: p.y * visualScale,
                }));

                const holes: Point[][] = [];
                for (const inner of innerContours) {
                  if (inner.points.length <= 2) continue;
                  const centroid = getCentroid(inner.points);
                  if (pointInPolygon(centroid, outer.points)) {
                    const stepInner = Math.max(1, Math.floor(inner.points.length / maxPoints));
                    const sampledInner = simplifyContourOrdered(inner.points, stepInner);
                    const simplifiedInner = douglasPeucker(sampledInner, epsilon);
                    holes.push(simplifiedInner.map(p => ({
                      x: p.x * visualScale,
                      y: p.y * visualScale,
                    })));
                  }
                }

                strokes.push({
                  id: uuidv4(),
                  points: scaledOuter,
                  strokeColor: '#ffffff',
                  strokeWidth: 1,
                  fillColor: 'transparent',
                  type: 'line',
                  holes: holes.length > 0 ? holes : undefined,
                });
              }

              const state = get();
              const tab = state.tabs.find(t => t.id === state.activeTabId);
              if (!tab) return;

              // Center imported strokes on canvas
              if (canvasSize && strokes.length > 0) {
                const worldCenterX = (canvasSize.width / 2 - tab.panX) / tab.zoom;
                const worldCenterY = (canvasSize.height / 2 - tab.panY) / tab.zoom;

                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const s of strokes) {
                  for (const p of s.points) {
                    minX = Math.min(minX, p.x);
                    minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x);
                    maxY = Math.max(maxY, p.y);
                  }
                  if (s.holes) {
                    for (const h of s.holes) {
                      for (const p of h) {
                        minX = Math.min(minX, p.x);
                        minY = Math.min(minY, p.y);
                        maxX = Math.max(maxX, p.x);
                        maxY = Math.max(maxY, p.y);
                      }
                    }
                  }
                }

                const strokeCenterX = (minX + maxX) / 2;
                const strokeCenterY = (minY + maxY) / 2;
                const dx = worldCenterX - strokeCenterX;
                const dy = worldCenterY - strokeCenterY;

                for (const s of strokes) {
                  s.points = s.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
                  if (s.holes) {
                    s.holes = s.holes.map(h => h.map(p => ({ x: p.x + dx, y: p.y + dy })));
                  }
                }
              }

              const newIcon: Icon = {
                id: uuidv4(),
                title: file.name.replace('.png', ''),
                description: '',
                layers: [{ id: uuidv4(), name: 'Layer 1', visible: true, locked: false, strokes, colorGroup: 1 }],
                createdAt: new Date(),
                updatedAt: new Date(),
              };

              const newTabs = state.tabs.map(t =>
                t.id === state.activeTabId
                  ? { ...t, icon: newIcon, selectedStrokes: [], selectedLayerId: newIcon.layers[0].id, historyPast: [], historyFuture: [] }
                  : t
              );
              set({ tabs: newTabs });
            };
            img.src = e.target?.result as string;
          };
          reader.readAsDataURL(file);
        },

        extractStrokes: (boundaryStrokeId) => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          if (isStrokeLocked(tab.icon, boundaryStrokeId)) return;

          const allStrokes = tab.icon.layers.flatMap(l => l.strokes);
          const boundaryStroke = allStrokes.find(s => s.id === boundaryStrokeId);
          if (!boundaryStroke) return;

          const strokesToExtract: Stroke[] = [boundaryStroke];
          const remainingStrokes: Stroke[] = [];

          for (const stroke of allStrokes) {
            if (stroke.id === boundaryStrokeId) continue;
            if (isStrokeLocked(tab.icon, stroke.id)) {
              remainingStrokes.push(stroke);
              continue;
            }
            const centroid = getStrokeCentroid(stroke);
            if (isPointInStroke(centroid, boundaryStroke)) {
              strokesToExtract.push(stroke);
            } else {
              remainingStrokes.push(stroke);
            }
          }

          const updatedLayers = tab.icon.layers.map(l => ({
            ...l,
            strokes: l.strokes.filter(s => remainingStrokes.some(r => r.id === s.id)),
          }));
          const updatedIcon = {
            ...tab.icon,
            layers: updatedLayers,
            updatedAt: new Date(),
          };

          const past = [...tab.historyPast, deepCloneLayers(tab.icon.layers)];

          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId
              ? { ...t, icon: updatedIcon, clipboard: strokesToExtract, selectedStrokes: [], historyPast: past, historyFuture: [] }
              : t
          );
          set({ tabs: newTabs });
        },

        replaceStrokes: (strokes) => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          const activeLayerId = tab.selectedLayerId || tab.icon.layers[0]?.id;
          const activeLayer = tab.icon.layers.find(l => l.id === activeLayerId);
          if (activeLayer?.locked) return;

          const past = [...tab.historyPast, deepCloneLayers(tab.icon.layers)];
          const updatedLayers = tab.icon.layers.map(l =>
            l.id === activeLayerId ? { ...l, strokes } : l
          );
          const updatedIcon = {
            ...tab.icon,
            layers: updatedLayers,
            updatedAt: new Date(),
          };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon: updatedIcon, historyPast: past, historyFuture: [] } : t
          );
          set({ tabs: newTabs });
        },

        replaceStrokesNoHistory: (strokes) => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          const activeLayerId = tab.selectedLayerId || tab.icon.layers[0]?.id;
          const activeLayer = tab.icon.layers.find(l => l.id === activeLayerId);
          if (activeLayer?.locked) return;

          const updatedLayers = tab.icon.layers.map(l =>
            l.id === activeLayerId ? { ...l, strokes } : l
          );
          const updatedIcon = { ...tab.icon, layers: updatedLayers, updatedAt: new Date() };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon: updatedIcon } : t
          );
          set({ tabs: newTabs });
        },

        updateStrokeNoHistory: (id, strokeUpdate) => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          if (isStrokeLocked(tab.icon, id)) return;

          const updatedLayers = tab.icon.layers.map(l => ({
            ...l,
            strokes: l.strokes.map(s => s.id === id ? { ...s, ...strokeUpdate } : s),
          }));
          const updatedIcon = { ...tab.icon, layers: updatedLayers, updatedAt: new Date() };
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, icon: updatedIcon } : t
          );
          set({ tabs: newTabs });
        },

        setTemplateImage: (image) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, templateImage: image } : t
          );
          set({ tabs: newTabs });
        },

        setTemplateOpacity: (opacity) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, templateOpacity: Math.max(0, Math.min(1, opacity)) } : t
          );
          set({ tabs: newTabs });
        },

        setTemplateScale: (scale) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, templateScale: Math.max(0.1, Math.min(5, scale)) } : t
          );
          set({ tabs: newTabs });
        },

        setTemplateOffsetX: (x) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, templateOffsetX: x } : t
          );
          set({ tabs: newTabs });
        },

        setTemplateOffsetY: (y) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, templateOffsetY: y } : t
          );
          set({ tabs: newTabs });
        },

        setReferenceImage: (image, name) => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, referenceImage: image, referenceName: name } : t
          );
          set({ tabs: newTabs });
        },

        clearReferenceImage: () => {
          const state = get();
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, referenceImage: null, referenceName: '' } : t
          );
          set({ tabs: newTabs });
        },

        setCornerRadius: (radius) => set({ cornerRadius: Math.max(1, Math.min(100, radius)) }),
        setCornerSegments: (segments) => set({ cornerSegments: Math.max(1, Math.min(8, segments)) }),
        setCurveClosed: (closed) => set({ curveClosed: closed }),

        addFillHistory: (color) => {
          set((state) => {
            const filtered = state.fillHistory.filter((c) => c !== color);
            return { fillHistory: [color, ...filtered].slice(0, 5) };
          });
        },

        addStrokeHistory: (color) => {
          set((state) => {
            const filtered = state.strokeHistory.filter((c) => c !== color);
            return { strokeHistory: [color, ...filtered].slice(0, 5) };
          });
        },

        pushHistory: () => {
          const state = get();
          const tab = state.tabs.find(t => t.id === state.activeTabId);
          if (!tab) return;
          const newTabs = state.tabs.map(t =>
            t.id === state.activeTabId
              ? { ...t, historyPast: [...t.historyPast, deepCloneLayers(tab.icon.layers)], historyFuture: [] }
              : t
          );
          set({ tabs: newTabs });
        },

        exportAsPNG: () => {
          const state = get();
          const icon = state.getActiveIcon();
          if (!icon) return;
          const allStrokes = icon.layers.flatMap(l => l.strokes);
          if (allStrokes.length === 0) return;
          const allX = allStrokes.flatMap((s) => s.points.map((p) => p.x));
          const allY = allStrokes.flatMap((s) => s.points.map((p) => p.y));
          const minX = Math.min(...allX);
          const maxX = Math.max(...allX);
          const minY = Math.min(...allY);
          const maxY = Math.max(...allY);
          const padding = 20;
          const width = Math.ceil(maxX - minX + padding * 2);
          const height = Math.ceil(maxY - minY + padding * 2);
          const off = document.createElement('canvas');
          off.width = Math.max(1, width);
          off.height = Math.max(1, height);
          const ctx = off.getContext('2d')!;
          ctx.translate(-minX + padding, -minY + padding);
          allStrokes.forEach((stroke) => drawStroke(ctx, stroke));
          const link = document.createElement('a');
          link.download = `${icon.title || 'icon'}.png`;
          link.href = off.toDataURL('image/png');
          link.click();
        },

        exportAsICO: () => {
          const state = get();
          const icon = state.getActiveIcon();
          if (!icon) return;
          const allStrokes = icon.layers.flatMap(l => l.strokes);
          if (allStrokes.length === 0) return;
          const allX = allStrokes.flatMap((s) => s.points.map((p) => p.x));
          const allY = allStrokes.flatMap((s) => s.points.map((p) => p.y));
          const minX = Math.min(...allX);
          const maxX = Math.max(...allX);
          const minY = Math.min(...allY);
          const maxY = Math.max(...allY);
          const padding = 20;
          const srcW = Math.max(1, Math.ceil(maxX - minX + padding * 2));
          const srcH = Math.max(1, Math.ceil(maxY - minY + padding * 2));
          const sizes = [16, 32, 48, 64, 128, 256];
          const renderAtSize = (size: number) => {
            return new Promise<Uint8Array>((resolve) => {
              const off = document.createElement('canvas');
              off.width = size;
              off.height = size;
              const ctx = off.getContext('2d')!;
              const scale = Math.min(size / srcW, size / srcH);
              const dx = (size - srcW * scale) / 2;
              const dy = (size - srcH * scale) / 2;
              ctx.translate(dx, dy);
              ctx.scale(scale, scale);
              ctx.translate(-minX + padding, -minY + padding);
              allStrokes.forEach((stroke) => drawStroke(ctx, stroke));
              off.toBlob((blob) => {
                if (!blob) {
                  resolve(new Uint8Array());
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
                reader.readAsArrayBuffer(blob);
              }, 'image/png');
            });
          };
          Promise.all(sizes.map(renderAtSize)).then((pngDatas) => {
            const count = pngDatas.length;
            const headerSize = 6 + count * 16;
            let offset = headerSize;
            const imageOffsets: number[] = [];
            const imageSizes: number[] = [];
            for (const data of pngDatas) {
              imageOffsets.push(offset);
              imageSizes.push(data.length);
              offset += data.length;
            }
            const totalSize = offset;
            const ico = new Uint8Array(totalSize);
            const view = new DataView(ico.buffer);
            view.setUint16(0, 0, true);
            view.setUint16(2, 1, true);
            view.setUint16(4, count, true);
            for (let i = 0; i < count; i++) {
              const base = 6 + i * 16;
              const s = sizes[i];
              view.setUint8(base + 0, s === 256 ? 0 : s);
              view.setUint8(base + 1, s === 256 ? 0 : s);
              view.setUint8(base + 2, 0);
              view.setUint8(base + 3, 0);
              view.setUint16(base + 4, 1, true);
              view.setUint16(base + 6, 32, true);
              view.setUint32(base + 8, imageSizes[i], true);
              view.setUint32(base + 12, imageOffsets[i], true);
            }
            for (let i = 0; i < count; i++) {
              ico.set(pngDatas[i], imageOffsets[i]);
            }
            const blob = new Blob([ico], { type: 'image/x-icon' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = `${icon.title || 'icon'}.ico`;
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
          });
        },

        copyPNGCode: () => {
          const state = get();
          const icon = state.getActiveIcon();
          if (!icon) return;
          const allStrokes = icon.layers.flatMap(l => l.strokes);
          if (allStrokes.length === 0) return;
          const allX = allStrokes.flatMap((s) => s.points.map((p) => p.x));
          const allY = allStrokes.flatMap((s) => s.points.map((p) => p.y));
          const minX = Math.min(...allX);
          const maxX = Math.max(...allX);
          const minY = Math.min(...allY);
          const maxY = Math.max(...allY);
          const padding = 20;
          const width = Math.ceil(maxX - minX + padding * 2);
          const height = Math.ceil(maxY - minY + padding * 2);
          const off = document.createElement('canvas');
          off.width = Math.max(1, width);
          off.height = Math.max(1, height);
          const ctx = off.getContext('2d')!;
          ctx.translate(-minX + padding, -minY + padding);
          allStrokes.forEach((stroke) => drawStroke(ctx, stroke));
          const dataUrl = off.toDataURL('image/png');
          const jsonObj = {
            name: icon.title || 'icon',
            width,
            height,
            src: dataUrl,
          };
          navigator.clipboard.writeText(JSON.stringify(jsonObj, null, 2));
        },

        exportAsSVG: () => {
          const state = get();
          const icon = state.getActiveIcon();
          if (!icon) return;
          const allStrokes = icon.layers.flatMap(l => l.strokes);
          if (allStrokes.length === 0) return;
          const allX: number[] = [];
          const allY: number[] = [];
          for (const s of allStrokes) {
            if (s.shapeType === 'text') {
              const b = getTextBounds(s);
              allX.push(b.minX, b.maxX);
              allY.push(b.minY, b.maxY);
            }
            for (const p of s.points) {
              allX.push(p.x);
              allY.push(p.y);
            }
          }
          const minX = Math.min(...allX);
          const maxX = Math.max(...allX);
          const minY = Math.min(...allY);
          const maxY = Math.max(...allY);
          const padding = 20;
          const width = maxX - minX + padding * 2;
          const height = maxY - minY + padding * 2;
          const offsetX = -minX + padding;
          const offsetY = -minY + padding;
          const svgParts: string[] = [];
          for (const stroke of allStrokes) {
            if (stroke.shapeType === 'text' && stroke.points.length >= 1 && stroke.text) {
              const anchor = stroke.points[0];
              const fontSize = stroke.fontSize ?? 24;
              const fontFamily = stroke.fontFamily ?? 'sans-serif';
              const rotation = stroke.rotation ?? 0;
              const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              const lines = stroke.text.split('\n');
              const lineHeight = fontSize * 1.2;
              // Centro aproximado del texto (coincide con el del canvas) para rotar sobre sí mismo
              let maxLen = 0;
              for (const line of lines) if (line.length > maxLen) maxLen = line.length;
              const tw = maxLen * fontSize * 0.55;
              const th = lines.length * lineHeight;
              const cx = anchor.x + tw / 2 + offsetX;
              const cy = anchor.y + th / 2 + offsetY;
              const transform = rotation !== 0 ? ` transform="rotate(${rotation} ${cx} ${cy})"` : '';
              const hasInterior = stroke.fillColor && stroke.fillColor !== 'transparent';
              const interiorColor = hasInterior ? stroke.fillColor : stroke.strokeColor;
              const borderWidth = stroke.strokeWidth ?? 0;
              const strokeAttrs = borderWidth > 0
                ? ` stroke="${stroke.strokeColor}" stroke-width="${borderWidth}" paint-order="stroke"`
                : '';
              for (let i = 0; i < lines.length; i++) {
                svgParts.push(`<text x="${anchor.x + offsetX}" y="${anchor.y + offsetY + i * lineHeight + fontSize}" font-family="${fontFamily}" font-size="${fontSize}" fill="${interiorColor}"${strokeAttrs}${transform}>${escapeXml(lines[i])}</text>`);
              }
            } else if (stroke.shapeType === 'circle' && stroke.points.length >= 2) {
              const [c, rPt] = stroke.points;
              const r = Math.hypot(rPt.x - c.x, rPt.y - c.y);
              svgParts.push(`<circle cx="${c.x + offsetX}" cy="${c.y + offsetY}" r="${r}" fill="${stroke.fillColor}" stroke="${stroke.strokeColor}" stroke-width="${stroke.strokeWidth}" />`);
            } else if (stroke.points.length >= 2) {
              const d = strokeToSvgPathD(stroke, offsetX, offsetY);
              const fill = stroke.fillColor && stroke.fillColor !== 'transparent' ? stroke.fillColor : 'none';
              const hasHoles = stroke.holes && stroke.holes.length > 0;
              svgParts.push(`<path d="${d}" fill="${fill}"${hasHoles ? ' fill-rule="evenodd"' : ''} stroke="${stroke.strokeColor}" stroke-width="${stroke.strokeWidth}" />`);
            }
          }
          const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${svgParts.join('\n')}\n</svg>`;
          const blob = new Blob([svgContent], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.download = `${icon.title || 'icon'}.svg`;
          link.href = url;
          link.click();
          URL.revokeObjectURL(url);
        },

        copyAsJSON: () => {
          const state = get();
          const icon = state.getActiveIcon();
          if (!icon) return;
          const round = (n: number) => Math.round(n);
          const allStrokes = icon.layers.flatMap(l => l.strokes);
          const data: any = {
            title: icon.title,
            strokes: allStrokes.map((s) => {
              const stroke: any = {
                points: s.points.map((p) => ({ x: round(p.x), y: round(p.y) })),
                strokeColor: s.strokeColor,
                strokeWidth: s.strokeWidth,
              };
              if (s.fillColor && s.fillColor !== 'transparent') stroke.fillColor = s.fillColor;
              if (s.type === 'curve') stroke.type = s.type;
              if (s.shapeType) stroke.shapeType = s.shapeType;
              if (s.shapeType === 'text') {
                if (s.text) stroke.text = s.text;
                if (s.fontSize) stroke.fontSize = s.fontSize;
                if (s.fontFamily) stroke.fontFamily = s.fontFamily;
                if (s.rotation) stroke.rotation = s.rotation;
              }
              if (s.holes && s.holes.length > 0) {
                stroke.holes = s.holes.map((h) => h.map((p) => ({ x: round(p.x), y: round(p.y) })));
              }
              return stroke;
            }),
          };
          if (icon.description) data.description = icon.description;
          navigator.clipboard.writeText(JSON.stringify(data));
        },
      };
    },
    {
      name: 'icon-editor-storage',
      partialize: (state) => ({
        icons: state.icons,
        fillHistory: state.fillHistory,
        strokeHistory: state.strokeHistory,
      }),
    }
  )
);

// ---------------------------------------------------------------------------
// Layer helpers
// ---------------------------------------------------------------------------

function findLayerContainingStroke(icon: Icon, strokeId: string): Layer | undefined {
  return icon.layers.find(l => l.strokes.some(s => s.id === strokeId));
}

function isStrokeLocked(icon: Icon, strokeId: string): boolean {
  const layer = findLayerContainingStroke(icon, strokeId);
  return layer?.locked ?? false;
}

// ---------------------------------------------------------------------------
// Pure geometry helpers (used by store actions)
// ---------------------------------------------------------------------------

function getStrokeCentroid(stroke: Stroke): Point {
  if (stroke.shapeType === 'circle' && stroke.points.length >= 2) {
    return stroke.points[0];
  }
  if (stroke.shapeType === 'text' && stroke.points.length >= 1) {
    return stroke.points[0];
  }
  return getCentroid(stroke.points);
}

function isPointInStroke(point: Point, stroke: Stroke): boolean {
  if (stroke.shapeType === 'text' && stroke.points.length >= 1) {
    const b = getTextBounds(stroke);
    return point.x >= b.minX && point.x <= b.maxX && point.y >= b.minY && point.y <= b.maxY;
  }
  if (stroke.shapeType === 'circle' && stroke.points.length >= 2) {
    const [c, rPt] = stroke.points;
    const r = Math.hypot(rPt.x - c.x, rPt.y - c.y);
    return Math.hypot(point.x - c.x, point.y - c.y) <= r;
  }
  if (stroke.points.length < 3) return false;
  const insideOuter = pointInPolygon(point, stroke.points);
  if (!insideOuter) return false;
  if (stroke.holes) {
    for (const hole of stroke.holes) {
      if (hole.length >= 3 && pointInPolygon(point, hole)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// SVG path helpers
// ---------------------------------------------------------------------------

// Construye el `d` de un anillo (contorno) en coords SVG. Curvas Catmull-Rom
// (interpola los puntos) para type==='curve' con >=4 puntos; recto en resto.
function ringToSvgPathD(pts: Point[], offX: number, offY: number, type: 'line' | 'curve', close: boolean): string {
  if (pts.length < 2) return '';
  const X = (p: Point) => p.x + offX;
  const Y = (p: Point) => p.y + offY;
  let d = `M ${X(pts[0])} ${Y(pts[0])} `;
  if (type === 'curve' && pts.length >= 4) {
    const n = pts.length;
    const closed = Math.abs(pts[0].x - pts[n - 1].x) < 0.5 && Math.abs(pts[0].y - pts[n - 1].y) < 0.5;
    const m = closed ? n - 1 : n;
    const get = (i: number) => pts[(i + m) % m];
    const segs = closed ? m : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = closed ? get(i - 1) : (pts[i - 1] ?? pts[i]);
      const p1 = closed ? get(i) : pts[i];
      const p2 = closed ? get(i + 1) : pts[i + 1];
      const p3 = closed ? get(i + 2) : (pts[i + 2] ?? pts[i + 1]);
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += `C ${c1x + offX} ${c1y + offY} ${c2x + offX} ${c2y + offY} ${p2.x + offX} ${p2.y + offY} `;
    }
    if (!closed) d += `L ${X(pts[n - 1])} ${Y(pts[n - 1])} `;
  } else if (type === 'curve' && pts.length === 3) {
    d += `Q ${X(pts[1])} ${Y(pts[1])} ${X(pts[2])} ${Y(pts[2])} `;
  } else {
    for (let i = 1; i < pts.length; i++) d += `L ${X(pts[i])} ${Y(pts[i])} `;
  }
  if (close) d += 'Z ';
  return d;
}

// Construye el `d` de un trazo (contorno exterior + huecos) para SVG.
function strokeToSvgPathD(stroke: Stroke, offX: number, offY: number): string {
  const hasFill = stroke.fillColor && stroke.fillColor !== 'transparent';
  const n = stroke.points.length;
  const closed = n >= 2 && Math.abs(stroke.points[0].x - stroke.points[n - 1].x) < 0.5 && Math.abs(stroke.points[0].y - stroke.points[n - 1].y) < 0.5;
  const close = closed || !!hasFill;
  let d = ringToSvgPathD(stroke.points, offX, offY, stroke.type, close);
  if (stroke.holes) {
    for (const hole of stroke.holes) {
      d += ringToSvgPathD(hole, offX, offY, stroke.type, true);
    }
  }
  return d.trim();
}

export default useAppStore;
