'use client';

import { useEffect, useState, useRef, useCallback, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { FontStudioModal } from '@/components/FontStudioModal';
import { Slider } from '@/components/ui/slider';
import { startTextureApi, stopTextureApi, getServerStatus, isElectron } from '@/lib/electron-fs';
import {
  MousePointer2,
  PenLine,
  Minus,
  Spline,
  Square,
  Circle,
  Eraser,
  Eye,
  EyeOff,
  Hand,
  ZoomIn,
  ZoomOut,
  Grid3X3,
  Magnet,
  Download,
  Plus,
  Trash2,
  Undo2,
  Save,
  FolderOpen,
  Copy,
  Scissors,
  Clipboard,
  Maximize2,
  Combine,
  Waypoints,
  LayoutGrid,
  Pencil,
  PaintBucket,
  Type,
  ExternalLink,
  Server,
  Power,
  RefreshCw,
  Loader2,
  Zap,
} from 'lucide-react';

// -------------------- Types --------------------
// Un punto puede tener manijas Bézier relativas:
//  - out: control que sale de este punto hacia el siguiente (define el segmento i -> i+1)
//  - in:  control que entra a este punto desde el anterior (define el segmento i-1 -> i)
// Si un punto no tiene out/in, ese lado es una línea recta (vértice "corner").
type Offset = { x: number; y: number };

type Point = {
  x: number;
  y: number;
  in?: Offset;
  out?: Offset;
  // Inicio de un contorno nuevo dentro del mismo glifo (tras "Unir"). No se
  // dibuja el segmento que llega hasta este punto: se emite un M (nuevo subpath).
  break?: boolean;
  // Si el contorno ANTERIOR a este punto de corte estaba cerrado, se cierra con
  // Z antes de saltar al nuevo contorno.
  closePrev?: boolean;
  // Soldadura a un vértice de otro glifo (herramienta "Connect"): mientras exista
  // este link, la posición del punto se resuelve desde el vértice objetivo.
  link?: { glyphId: string; vertex: number };
  // Color propio de este segmento (el que sale de este punto hacia el siguiente).
  // Si no está definido, el segmento usa el color de trazo del glifo (g.stroke).
  segStroke?: string;
};

type Glyph = {
  id: string;
  name: string;
  points: Point[];
  closed: boolean;
  stroke: string;
  fill: string;
  strokeWidth: number;
  texture: string | null;
  hidden?: boolean;
  // Relleno y textura por contorno individual (zona). Cada entrada corresponde
  // al contorno en el mismo orden que splitContours(). Si no existe, usa fill/texture del glifo.
  contourFills?: { fill: string; texture: TextureKey | null }[];
  // Nombre de la fuente a la que pertenece esta letra (galería multi-fuente).
  font?: string;
};

type Tool = 'select' | 'pen' | 'line' | 'rect' | 'circle' | 'curve' | 'erase' | 'hand' | 'scale' | 'connect' | 'paint' | 'fillzone' | 'brush';

type TextureKey = 'solid' | 'dots' | 'lines' | 'checker';

type HandleRef = { vertex: number; kind: 'in' | 'out' };

// -------------------- Store --------------------
type EditorState = {
  glyphs: Glyph[];
  selectedGlyphId: string | null;
  // Multi-selección: todos los glifos seleccionados (Ctrl+clic). selectedGlyphId
  // es el "primario" (el último clicado) y sobre él se editan vértices/curvas.
  selectedGlyphIds: string[];
  tool: Tool;
  // Vista del editor: 'edit' (lienzo) o 'gallery' (galería de letras).
  view: 'edit' | 'gallery';
  stroke: string;
  fill: string;
  strokeWidth: number;
  // Color dedicado del bote de pintura (herramienta Paint). Independiente del Stroke global,
  // para que elegir color no cambie el trazo de la pieza seleccionada.
  paintColor: string;
  gridEnabled: boolean;
  snapEnabled: boolean;
  gridSize: number;
  zoom: number;
  texture: TextureKey | null;
  vertexSize: number;
  fontName: string;
  standardSize: boolean;
  // Pincel: forma del trazo (redondo = polígono con muchos lados / cuadrado = 4 vértices)
  // y grueso (ancho del trazo en unidades de fuente).
  brushShape: 'round' | 'rect';
  brushThickness: number;
  // Guía personalizada ajustable (unidades de fuente). Se arrastra en el lienzo
  // (línea ámbar punteada) y se guarda con el proyecto JSON.
  customGuideUnits: number;
  customGuideVisible: boolean;
  setCustomGuide: (units: number) => void;
  setCustomGuideVisible: (visible: boolean) => void;
  // Filtro de la galería: nombre de fuente a mostrar (null = todas).
  galleryFontFilter: string | null;
  // Modo "solo": si está activo, el lienzo solo muestra ese glifo (al abrir una letra desde la galería).
  openGlyphIds: string[];
  undoStack: Glyph[][];
  redoStack: Glyph[][];
  setTool: (tool: Tool) => void;
  setView: (view: 'edit' | 'gallery') => void;
  setStroke: (stroke: string) => void;
  setFill: (fill: string) => void;
  setPaintColor: (paintColor: string) => void;
  setStrokeWidth: (strokeWidth: number) => void;
  setGridEnabled: (gridEnabled: boolean) => void;
  setSnapEnabled: (snapEnabled: boolean) => void;
  setGridSize: (gridSize: number) => void;
  setZoom: (zoom: number) => void;
  setTexture: (texture: TextureKey | null) => void;
  setVertexSize: (vertexSize: number) => void;
  setFontName: (name: string) => void;
  setStandardSize: (standardSize: boolean) => void;
  setGalleryFontFilter: (filter: string | null) => void;
  setOpenGlyphs: (ids: string[]) => void;
  toggleOpenGlyph: (id: string) => void;
  selectGlyph: (id: string, additive?: boolean) => void;
  addGlyph: (glyph: Glyph) => void;
  updateGlyph: (id: string, patch: Partial<Glyph>) => void;
  deleteGlyph: (id: string) => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  setBrushShape: (shape: 'round' | 'rect') => void;
  setBrushThickness: (thickness: number) => void;
  // Reemplaza todos los glifos (al abrir un archivo JSON guardado).
  loadFont: (glyphs: Glyph[], fontName?: string) => void;
  // Inserta glifos nuevos (pegar portapapeles) y los selecciona.
  pasteGlyphs: (glyphs: Glyph[]) => void;
  // Oculta/muestra un glifo en el lienzo (botón ojo de la lista Glyphs).
  toggleGlyphVisibility: (id: string) => void;
  // Escala SOLO el glifo indicado alrededor de su centro (tamaño independiente).
  scaleGlyph: (id: string, factor: number) => void;
  // Escala TODOS los glifos seleccionados a la vez (cada uno alrededor de su centro).
  scaleGlyphs: (ids: string[], factor: number) => void;
  // Apoya la(s) letra(s) seleccionada(s) en la línea base: las mueve verticalmente
  // para que su punto más bajo coincida con la Línea base del lienzo (y=0 de la fuente).
  alignToBaseline: (ids: string[]) => void;
  // Une varios glifos seleccionados en uno solo (cada pieza se conserva como un
  // contorno separado dentro del mismo glifo: útil para letras con partes sueltas).
  mergeGlyphs: (ids: string[]) => void;
  // Pinta el segmento `segIndex` del glifo con el color de trazo actual (Stroke).
  // Si el segmento ya tiene ese color, lo restaura al color por defecto (toggle).
  paintSegment: (glyphId: string, segIndex: number) => void;
  // Quita el color propio de todos los segmentos del glifo (vuelven al trazo base).
  clearSegmentColors: (glyphId: string) => void;
  // Pinta el contorno (zona) indicado con el fill y texture actuales del store.
  paintContour: (glyphId: string, contourIndex: number) => void;
  // Quita todos los rellenos por contorno (vuelven al fill/texture del glifo).
  clearContourFills: (glyphId: string) => void;
};

export const useEditorStore = create<EditorState>()((set, get) => ({
  glyphs: [
    {
      id: 'g1',
      name: 'A',
      points: [
        { x: 100, y: 300 },
        { x: 200, y: 100 },
        { x: 300, y: 300 },
        { x: 150, y: 200 },
        { x: 250, y: 200 },
      ],
      closed: false,
      stroke: '#22c55e',
      fill: '#1f2937',
      strokeWidth: 4,
      texture: null,
    },
  ],
  selectedGlyphId: 'g1',
  selectedGlyphIds: ['g1'],
  tool: 'select',
  view: 'edit',
  stroke: '#22c55e',
  fill: '#1f2937',
  strokeWidth: 4,
  paintColor: '#f59e0b',
  gridEnabled: true,
  snapEnabled: true,
  gridSize: 20,
  zoom: 1,
  texture: null,
  vertexSize: 6,
  fontName: 'MiFuente',
  standardSize: true,
  // Pincel: forma del trazo (redondo = polígono con muchos lados / cuadrado = 4 vértices)
  // y grueso (ancho del trazo en unidades de fuente).
  brushShape: 'round',
  brushThickness: 12,
  customGuideUnits: 540,
  customGuideVisible: false,
  galleryFontFilter: null,
  openGlyphIds: [],
  undoStack: [],
  redoStack: [],
  setTool: (tool) => set({ tool }),
  setView: (view) => set({ view }),
  setStroke: (stroke) => set((s) => ({
    stroke,
    glyphs: s.glyphs.map((g) => s.selectedGlyphIds.includes(g.id) ? { ...g, stroke } : g),
  })),
  setPaintColor: (paintColor) => set({ paintColor }),
  setFill: (fill) => set((s) => ({
    fill,
    glyphs: s.glyphs.map((g) => s.selectedGlyphIds.includes(g.id) ? { ...g, fill } : g),
  })),
  setStrokeWidth: (strokeWidth) => set((s) => ({
    strokeWidth,
    glyphs: s.glyphs.map((g) => s.selectedGlyphIds.includes(g.id) ? { ...g, strokeWidth } : g),
  })),
  setGridEnabled: (gridEnabled) => set({ gridEnabled }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setGridSize: (gridSize) => set((s) => {
    if (gridSize === s.gridSize) return s;
    const scale = gridSize / s.gridSize;
    const glyphs = s.glyphs.map((glyph) => ({
      ...glyph,
      points: glyph.points.map((point) => ({
        ...point,
        x: CANVAS_W / 2 + (point.x - CANVAS_W / 2) * scale,
        y: CANVAS_H / 2 + (point.y - CANVAS_H / 2) * scale,
        in: point.in ? { x: point.in.x * scale, y: point.in.y * scale } : undefined,
        out: point.out ? { x: point.out.x * scale, y: point.out.y * scale } : undefined,
      })),
    }));
    return {
      gridSize,
      glyphs,
      undoStack: [...s.undoStack, s.glyphs],
      redoStack: [],
    };
  }),
  setZoom: (zoom) => set({ zoom }),
  setTexture: (texture) => set((s) => ({
    texture,
    glyphs: s.glyphs.map((g) => s.selectedGlyphIds.includes(g.id) ? { ...g, texture } : g),
  })),
  setVertexSize: (vertexSize) => set({ vertexSize }),
  setBrushShape: (brushShape) => set({ brushShape }),
  setBrushThickness: (brushThickness) => set({ brushThickness: clamp(brushThickness, 1, 200) }),
  setFontName: (fontName) => set((s) => {
    const old = s.fontName.trim();
    const next = fontName.trim();
    if (!next) return { fontName };
    const glyphs = s.glyphs.map((g) => {
      const gf = (g.font || '').trim();
      if (!gf || gf === old) return { ...g, font: next };
      return g;
    });
    const galleryFontFilter = s.galleryFontFilter === old ? next : s.galleryFontFilter;
    return { fontName, glyphs, galleryFontFilter };
  }),
  setStandardSize: (standardSize) => set({ standardSize }),
  setCustomGuide: (customGuideUnits) => set({ customGuideUnits: clamp(customGuideUnits, 0, 1000) }),
  setCustomGuideVisible: (customGuideVisible) => set({ customGuideVisible }),
  setGalleryFontFilter: (galleryFontFilter) => set({ galleryFontFilter }),
  setOpenGlyphs: (openGlyphIds) => set({ openGlyphIds }),
  toggleOpenGlyph: (id) => set((s) => ({
    openGlyphIds: s.openGlyphIds.includes(id) ? s.openGlyphIds.filter((x) => x !== id) : [...s.openGlyphIds, id],
  })),
  selectGlyph: (id, additive) => set((s) => {
    if (additive) {
      const has = s.selectedGlyphIds.includes(id);
      const ids = has ? s.selectedGlyphIds.filter((x) => x !== id) : [...s.selectedGlyphIds, id];
      return { selectedGlyphIds: ids, selectedGlyphId: id };
    }
    return { selectedGlyphIds: [id], selectedGlyphId: id };
  }),
  addGlyph: (glyph) => set((s) => ({
    glyphs: [...s.glyphs, glyph],
    selectedGlyphIds: [glyph.id],
    selectedGlyphId: glyph.id,
    openGlyphIds: s.openGlyphIds.includes(glyph.id) ? s.openGlyphIds : [...s.openGlyphIds, glyph.id],
  })),
  updateGlyph: (id, patch) => set((s) => ({ glyphs: s.glyphs.map((g) => g.id === id ? { ...g, ...patch } : g) })),
  toggleGlyphVisibility: (id) => set((s) => ({
    glyphs: s.glyphs.map((g) => (g.id === id ? { ...g, hidden: !g.hidden } : g)),
  })),
  scaleGlyph: (id, factor) => set((s) => ({
    glyphs: s.glyphs.map((glyph) => {
      if (glyph.id !== id) return glyph;
      const mat = materializeGlyph(glyph, s.glyphs);
      const pts = mat.points;
      if (!pts.length) return glyph;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      return {
        ...glyph,
        points: pts.map((p) => ({
          ...p,
          x: cx + (p.x - cx) * factor,
          y: cy + (p.y - cy) * factor,
          in: p.in ? { x: p.in.x * factor, y: p.in.y * factor } : undefined,
          out: p.out ? { x: p.out.x * factor, y: p.out.y * factor } : undefined,
        })),
      };
    }),
  })),
  scaleGlyphs: (ids, factor) => set((s) => {
    const idSet = new Set(ids);
    return {
      glyphs: s.glyphs.map((glyph) => {
        if (!idSet.has(glyph.id)) return glyph;
        const mat = materializeGlyph(glyph, s.glyphs);
        const pts = mat.points;
        if (!pts.length) return glyph;
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        return {
          ...glyph,
          points: pts.map((p) => ({
            x: cx + (p.x - cx) * factor,
            y: cy + (p.y - cy) * factor,
            in: p.in ? { x: p.in.x * factor, y: p.in.y * factor } : undefined,
            out: p.out ? { x: p.out.x * factor, y: p.out.y * factor } : undefined,
            break: p.break,
            closePrev: p.closePrev,
            link: p.link,
            segStroke: p.segStroke,
          })),
        };
      }),
    };
  }),
  alignToBaseline: (ids) => set((s) => {
    const idSet = new Set(ids);
    return {
      glyphs: s.glyphs.map((glyph) => {
        if (!idSet.has(glyph.id)) return glyph;
        const mat = materializeGlyph(glyph, s.glyphs);
        const pts = mat.points;
        if (!pts.length) return glyph;
        const maxY = Math.max(...pts.map((p) => p.y));
        const dy = CANVAS_BASELINE_Y - maxY;
        if (!dy) return glyph;
        return { ...glyph, points: pts.map((p) => ({ ...p, y: p.y + dy })) };
      }),
    };
  }),
  mergeGlyphs: (ids) => set((s) => {
    const idSet = new Set(ids);
    const sel = s.glyphs.filter((g) => idSet.has(g.id));
    if (sel.length < 2) return s;
    const base = sel[0];
    const contours = sel.filter((c) => c.points.length > 0);
    if (contours.length < 2) return s;
    const clonePts = (pts: Point[]) => pts.map((p) => ({
      x: p.x,
      y: p.y,
      in: p.in ? { ...p.in } : undefined,
      out: p.out ? { ...p.out } : undefined,
      break: p.break,
      closePrev: p.closePrev,
      link: p.link ? { ...p.link } : undefined,
      segStroke: p.segStroke,
    }));
    const points: Point[] = [];
    const offsets = new Map<string, number>();
    contours.forEach((c, ci) => {
      offsets.set(c.id, points.length);
      const pts = clonePts(c.points);
      if (ci > 0) pts[0] = { ...pts[0], break: true, closePrev: contours[ci - 1].closed };
      points.push(...pts);
    });
    const mergedId = `g${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    // Soldaduras internas (entre glifos que se fusionan): apuntan al glifo unido
    // con el índice ajustado. Las que apuntan fuera se conservan (siguen existiendo).
    const remapped = points.map((p) => {
      if (!p.link) return p;
      if (idSet.has(p.link.glyphId)) {
        const off = offsets.get(p.link.glyphId);
        if (off !== undefined) return { ...p, link: { glyphId: mergedId, vertex: off + p.link.vertex } };
      }
      return p;
    });
    const merged: Glyph = {
      id: mergedId,
      name: base.name,
      points: remapped,
      closed: contours[contours.length - 1].closed,
      stroke: base.stroke,
      fill: base.fill,
      strokeWidth: base.strokeWidth,
      texture: base.texture,
      hidden: base.hidden,
      font: base.font,
      contourFills: base.contourFills ? base.contourFills.map((cf) => ({ ...cf })) : undefined,
    };
    // Los glifos que NO se fusionan y apuntaban a alguno de los fusionados se
    // re-mapean al glifo unido (misma soldadura, nueva referencia).
    const others = s.glyphs.filter((g) => !idSet.has(g.id)).map((g) => {
      if (!g.points.some((p) => p.link && idSet.has(p.link.glyphId))) return g;
      return {
        ...g,
        points: g.points.map((p) => {
          if (!p.link || !idSet.has(p.link.glyphId)) return p;
          const off = offsets.get(p.link.glyphId);
          if (off === undefined) return { ...p, link: undefined };
          return { ...p, link: { glyphId: mergedId, vertex: off + p.link.vertex } };
        }),
      };
    });
    return {
      glyphs: [...others, merged],
      selectedGlyphIds: [merged.id],
      selectedGlyphId: merged.id,
      openGlyphIds: [...s.openGlyphIds.filter((id) => !idSet.has(id)), merged.id],
      undoStack: [...s.undoStack, s.glyphs],
      redoStack: [],
    };
  }),
  paintSegment: (glyphId, segIndex) => set((s) => {
    const glyph = s.glyphs.find((g) => g.id === glyphId);
    if (!glyph || segIndex < 0 || segIndex >= glyph.points.length) return s;
    const color = s.paintColor;
    return {
      glyphs: s.glyphs.map((g) => g.id === glyphId ? {
        ...g,
        points: g.points.map((p, i) => i === segIndex ? { ...p, segStroke: p.segStroke === color ? undefined : color } : p),
      } : g),
      undoStack: [...s.undoStack, s.glyphs],
      redoStack: [],
    };
  }),
  clearSegmentColors: (glyphId) => set((s) => ({
    glyphs: s.glyphs.map((g) => g.id === glyphId ? {
      ...g,
      points: g.points.map((p) => (p.segStroke ? { ...p, segStroke: undefined } : p)),
    } : g),
    undoStack: [...s.undoStack, s.glyphs],
    redoStack: [],
  })),
  paintContour: (glyphId, contourIndex) => set((s) => {
    const glyph = s.glyphs.find((g) => g.id === glyphId);
    if (!glyph) return s;
    const fills = glyph.contourFills ? [...glyph.contourFills] : [];
    // Rellena huecos para que el array nunca tenga agujeros (JSON los guarda como null).
    while (fills.length <= contourIndex) fills.push({ fill: glyph.fill, texture: glyph.texture as TextureKey | null });
    fills[contourIndex] = { fill: s.fill, texture: s.texture };
    return {
      glyphs: s.glyphs.map((g) => g.id === glyphId ? { ...g, contourFills: fills } : g),
      undoStack: [...s.undoStack, s.glyphs],
      redoStack: [],
    };
  }),
  clearContourFills: (glyphId) => set((s) => ({
    glyphs: s.glyphs.map((g) => g.id === glyphId ? { ...g, contourFills: undefined } : g),
    undoStack: [...s.undoStack, s.glyphs],
    redoStack: [],
  })),
  deleteGlyph: (id) => set((s) => {
    const ids = s.selectedGlyphIds.filter((x) => x !== id);
    const primary = s.selectedGlyphId && ids.includes(s.selectedGlyphId) ? s.selectedGlyphId : (ids[0] ?? null);
    // Al eliminar un glifo, las soldaduras que apuntaban a él se despegan
    // (materializan su posición actual) para no dejar referencias rotas.
    const glyphs = s.glyphs.filter((g) => g.id !== id).map((g) => {
      if (!g.points.some((p) => p.link && p.link.glyphId === id)) return g;
      return { ...g, points: g.points.map((p) => (p.link && p.link.glyphId === id ? { ...p, link: undefined } : p)) };
    });
    return {
      glyphs,
      selectedGlyphIds: ids,
      selectedGlyphId: primary,
      openGlyphIds: s.openGlyphIds.filter((x) => x !== id),
    };
  }),
  pushHistory: () => set((s) => ({
    undoStack: [...s.undoStack, s.glyphs],
    redoStack: [],
  })),
  undo: () => set((s) => {
    if (s.undoStack.length === 0) return s;
    const prev = s.undoStack[s.undoStack.length - 1];
    const existing = new Set(prev.map((g) => g.id));
    const ids = s.selectedGlyphIds.filter((id) => existing.has(id));
    return {
      glyphs: prev,
      selectedGlyphId: s.selectedGlyphId && ids.includes(s.selectedGlyphId) ? s.selectedGlyphId : (ids[0] ?? prev[0]?.id ?? null),
      selectedGlyphIds: ids.length ? ids : (prev[0] ? [prev[0].id] : []),
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, s.glyphs],
    };
  }),
  redo: () => set((s) => {
    if (s.redoStack.length === 0) return s;
    const next = s.redoStack[s.redoStack.length - 1];
    const existing = new Set(next.map((g) => g.id));
    const ids = s.selectedGlyphIds.filter((id) => existing.has(id));
    return {
      glyphs: next,
      selectedGlyphId: s.selectedGlyphId && ids.includes(s.selectedGlyphId) ? s.selectedGlyphId : (ids[0] ?? next[0]?.id ?? null),
      selectedGlyphIds: ids.length ? ids : (next[0] ? [next[0].id] : []),
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, s.glyphs],
    };
  }),
  loadFont: (glyphs, fontName) => set((s) => ({
    glyphs,
    selectedGlyphIds: glyphs.length ? [glyphs[0].id] : [],
    selectedGlyphId: glyphs.length ? glyphs[0].id : null,
    fontName: fontName ?? s.fontName,
    openGlyphIds: glyphs.length ? [glyphs[0].id] : [],
    undoStack: [...s.undoStack, s.glyphs],
    redoStack: [],
  })),
  pasteGlyphs: (glyphs) => set((s) => {
    if (!glyphs.length) return s;
    const ids = glyphs.map((g) => g.id);
    return {
      glyphs: [...s.glyphs, ...glyphs],
      selectedGlyphIds: ids,
      selectedGlyphId: ids[0] ?? s.selectedGlyphId,
      openGlyphIds: [...new Set([...s.openGlyphIds, ...ids])],
      undoStack: [...s.undoStack, s.glyphs],
      redoStack: [],
    };
  }),
}));

// -------------------- Utils --------------------
const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);
const slug = (s: string) => (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'fuente');
const DEFAULT_GRID_SIZE = 20;
const clonePoint = (p: Point): Point => ({
  x: p.x,
  y: p.y,
  in: p.in ? { ...p.in } : undefined,
  out: p.out ? { ...p.out } : undefined,
  break: p.break,
  closePrev: p.closePrev,
  link: p.link ? { ...p.link } : undefined,
  segStroke: p.segStroke,
});

// Portapapeles del editor: copia/corta/pega glifos completos (con curvas y manijas).
let clipboard: Glyph[] | null = null;

const cloneGlyph = (g: Glyph): Glyph => ({
  ...g,
  points: g.points.map(clonePoint),
  contourFills: g.contourFills ? g.contourFills.map((cf) => ({ ...cf })) : undefined,
});

// Resuelve un glifo: los puntos soldados (link) toman la posición ACTUAL del
// vértice objetivo. Devuelve una copia con las posiciones resueltas (para
// render, galería y export). Si no hay links, devuelve el mismo glifo.
const resolveGlyph = (g: Glyph, glyphs: Glyph[]): Glyph => {
  if (!g.points.some((p) => p.link)) return g;
  const map = new Map(glyphs.map((x) => [x.id, x]));
  return {
    ...g,
    points: g.points.map((p) => {
      if (!p.link) return p;
      const target = map.get(p.link.glyphId);
      const tv = target && target.points[p.link.vertex];
      return tv ? { ...p, x: tv.x, y: tv.y } : p;
    }),
  };
};

// Materializa los puntos soldados de un glifo: fija la posición resuelta y quita
// el link (a partir de ahí el punto es libre). Se usa al arrastrar/mover/escalar
// el propio glifo soldado (se "despega" del vértice objetivo).
const materializeGlyph = (g: Glyph, glyphs: Glyph[]): Glyph => {
  if (!g.points.some((p) => p.link)) return g;
  const resolved = resolveGlyph(g, glyphs);
  return {
    ...resolved,
    points: resolved.points.map((p) => (p.link ? { ...p, link: undefined } : p)),
  };
};

// Busca el vértice más cercano entre TODOS los glifos visibles (para la
// herramienta Connect).
const findNearestVertexAcross = (glyphs: Glyph[], p: Point, threshold = 18): { glyphId: string; vertex: number } | null => {
  let best: { glyphId: string; vertex: number } | null = null;
  let bestD = threshold;
  glyphs.forEach((g) => {
    if (g.hidden) return;
    g.points.forEach((pt, i) => {
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      if (d < bestD) { bestD = d; best = { glyphId: g.id, vertex: i }; }
    });
  });
  return best;
};

// Borra un punto de un glifo con seguridad: conserva los contornos (flags
// break/closePrev), re-mapea las soldaduras de OTROS glifos que apunten a este
// punto y materializa las que apuntaban exactamente al punto borrado.
const eraseGlyphPoint = (glyphId: string, index: number) => {
  const s = useEditorStore.getState();
  const glyph = s.glyphs.find((g) => g.id === glyphId);
  if (!glyph || index < 0 || index >= glyph.points.length) return;
  const nextPts = glyph.points.filter((_, i) => i !== index);
  if (nextPts.length && glyph.points[index].break) {
    const nb = Math.min(index, nextPts.length - 1);
    nextPts[nb] = { ...nextPts[nb], break: true, closePrev: glyph.points[index].closePrev };
  }
  if (nextPts.length) {
    const rest = s.glyphs.map((g) => {
      if (g.id === glyphId) return { ...g, points: nextPts };
      let changed = false;
      const pts = g.points.map((p) => {
        if (!p.link || p.link.glyphId !== glyphId) return p;
        if (p.link.vertex === index) { changed = true; return { ...p, link: undefined }; }
        if (p.link.vertex > index) { changed = true; return { ...p, link: { ...p.link, vertex: p.link.vertex - 1 } }; }
        return p;
      });
      return changed ? { ...g, points: pts } : g;
    });
    useEditorStore.setState({ glyphs: rest });
    return;
  }
  const rest = s.glyphs.filter((g) => g.id !== glyphId).map((g) => {
    if (!g.points.some((p) => p.link && p.link.glyphId === glyphId)) return g;
    return { ...g, points: g.points.map((p) => (p.link && p.link.glyphId === glyphId ? { ...p, link: undefined } : p)) };
  });
  const ids = s.selectedGlyphIds.filter((x) => x !== glyphId);
  const primary = s.selectedGlyphId && ids.includes(s.selectedGlyphId) ? s.selectedGlyphId : (ids[0] ?? null);
  useEditorStore.setState({
    glyphs: rest,
    selectedGlyphIds: ids,
    selectedGlyphId: primary,
    openGlyphIds: s.openGlyphIds.filter((x) => x !== glyphId),
  });
};

const copySelectedGlyphs = () => {
  const s = useEditorStore.getState();
  const selected = s.glyphs.filter((g) => s.selectedGlyphIds.includes(g.id));
  if (selected.length) clipboard = selected.map(cloneGlyph);
};

const cutSelectedGlyphs = () => {
  const s = useEditorStore.getState();
  const selected = s.glyphs.filter((g) => s.selectedGlyphIds.includes(g.id));
  if (!selected.length) return;
  clipboard = selected.map(cloneGlyph);
  s.pushHistory();
  selected.forEach((g) => s.deleteGlyph(g.id));
};

const pasteClipboardGlyphs = () => {
  if (!clipboard || !clipboard.length) return;
  const s = useEditorStore.getState();
  const off = s.gridSize || 20;
  const now = Date.now();
  const pasted = clipboard.map((g, i) => {
    const id = `g${now}${i}${Math.random().toString(36).slice(2, 6)}`;
    const base = cloneGlyph(g);
    return {
      ...base,
      id,
      points: base.points.map((p) => ({ ...p, x: p.x + off, y: p.y + off })),
    };
  });
  s.pasteGlyphs(pasted);
};

const mergeSelectedGlyphs = () => {
  const s = useEditorStore.getState();
  if (s.selectedGlyphIds.length < 2) return;
  s.mergeGlyphs(s.selectedGlyphIds);
};

const lerpPoint = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

// Divide los puntos de un glifo en contornos. Un punto con flag `break` inicia un
// contorno nuevo (piezas sueltas unidas con "Unir"). El cierre de cada contorno
// (salvo el último) lo indica el `closePrev` del punto de corte que abre el siguiente.
const splitContours = (points: Point[], closed: boolean): { idx: number[]; closed: boolean }[] => {
  const contours: { idx: number[]; closed: boolean }[] = [];
  let cur: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i].break && cur.length) {
      contours.push({ idx: cur, closed: false });
      cur = [i];
    } else {
      cur.push(i);
    }
  }
  if (cur.length) contours.push({ idx: cur, closed });
  for (let c = 0; c < contours.length - 1; c++) {
    const nextStart = contours[c + 1].idx[0];
    contours[c].closed = !!points[nextStart].closePrev;
  }
  return contours;
};

// Construye el path SVG: cada segmento con manijas en AMBOS extremos es una curva
// cúbica (C); con una sola manija, cuadrática (Q); sin manijas, línea recta (L).
const buildPath = (points: Point[], closed: boolean): string => {
  const contours = splitContours(points, closed);
  if (!contours.length) return '';
  let d = '';
  contours.forEach(({ idx, closed: cClosed }) => {
    if (!idx.length) return;
    const first = points[idx[0]];
    if (d) d += ' ';
    d += `M ${first.x} ${first.y}`;
    const segCount = cClosed ? idx.length : idx.length - 1;
    for (let k = 0; k < segCount; k++) {
      const start = points[idx[k]];
      const end = points[idx[(k + 1) % idx.length]];
      if (start.out && end.in) {
        d += ` C ${start.x + start.out.x} ${start.y + start.out.y} ${end.x + end.in.x} ${end.y + end.in.y} ${end.x} ${end.y}`;
      } else if (start.out) {
        d += ` Q ${start.x + start.out.x} ${start.y + start.out.y} ${end.x} ${end.y}`;
      } else if (end.in) {
        d += ` Q ${end.x + end.in.x} ${end.y + end.in.y} ${end.x} ${end.y}`;
      } else {
        d += ` L ${end.x} ${end.y}`;
      }
    }
    if (cClosed) d += ' Z';
  });
  return d;
};

// Construye el path SVG de UN solo segmento (el que sale del punto `seg`).
const buildSegmentPath = (points: Point[], seg: number, closed: boolean): string => {
  const contours = splitContours(points, closed);
  for (const { idx, closed: cClosed } of contours) {
    const pos = idx.indexOf(seg);
    if (pos < 0) continue;
    const segCount = cClosed ? idx.length : idx.length - 1;
    if (pos >= segCount) return '';
    const start = points[seg];
    const end = points[idx[(pos + 1) % idx.length]];
    let d = `M ${start.x} ${start.y}`;
    if (start.out && end.in) {
      d += ` C ${start.x + start.out.x} ${start.y + start.out.y} ${end.x + end.in.x} ${end.y + end.in.y} ${end.x} ${end.y}`;
    } else if (start.out) {
      d += ` Q ${start.x + start.out.x} ${start.y + start.out.y} ${end.x} ${end.y}`;
    } else if (end.in) {
      d += ` Q ${end.x + end.in.x} ${end.y + end.in.y} ${end.x} ${end.y}`;
    } else {
      d += ` L ${end.x} ${end.y}`;
    }
    return d;
  }
  return '';
};

// Construye el path SVG de UN solo contorno (identificado por su índice en splitContours).
const buildContourPath = (points: Point[], contourIndex: number, closed: boolean): string => {
  const contours = splitContours(points, closed);
  const c = contours[contourIndex];
  if (!c || !c.idx.length) return '';
  let d = `M ${points[c.idx[0]].x} ${points[c.idx[0]].y}`;
  const segCount = c.closed ? c.idx.length : c.idx.length - 1;
  for (let k = 0; k < segCount; k++) {
    const start = points[c.idx[k]];
    const end = points[c.idx[(k + 1) % c.idx.length]];
    if (start.out && end.in) {
      d += ` C ${start.x + start.out.x} ${start.y + start.out.y} ${end.x + end.in.x} ${end.y + end.in.y} ${end.x} ${end.y}`;
    } else if (start.out) {
      d += ` Q ${start.x + start.out.x} ${start.y + start.out.y} ${end.x} ${end.y}`;
    } else if (end.in) {
      d += ` Q ${end.x + end.in.x} ${end.y + end.in.y} ${end.x} ${end.y}`;
    } else {
      d += ` L ${end.x} ${end.y}`;
    }
  }
  if (c.closed) d += ' Z';
  return d;
};

// Detecta en qué contorno cae un punto (hit-test con Path2D).
// Devuelve el índice del contorno o -1 si no cae en ninguno.
const findContourAtPoint = (g: Glyph, pt: Point): number => {
  if (typeof document === 'undefined') return -1;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return -1;
  const contours = splitContours(g.points, g.closed);
  // even-odd: recorrer de fuera hacia dentro (último contorno = exterior)
  let hit = -1;
  for (let i = 0; i < contours.length; i++) {
    const d = buildContourPath(g.points, i, g.closed);
    if (!d) continue;
    const p2d = new Path2D(d);
    if (ctx.isPointInPath(p2d, pt.x, pt.y)) {
      hit = i;
    }
  }
  return hit;
};

// Cuenta los contornos con relleno propio de un glifo.
const countContourFills = (g: Glyph): number => {
  if (!g.contourFills) return 0;
  return g.contourFills.filter((cf) => cf !== undefined).length;
};

// Cuenta los segmentos con color propio de un glifo.
const countColoredSegments = (g: Glyph): number => {
  let n = 0;
  g.points.forEach((p, i) => {
    if (!p.segStroke) return;
    if (!g.closed && i === g.points.length - 1) return;
    n++;
  });
  return n;
};

// Busca el segmento más cercano en TODOS los glifos visibles excepto `excludeId`.
const findNearestSegmentAcross = (glyphs: Glyph[], p: Point, excludeId?: string | null): { glyphId: string; seg: number } | null => {
  let best: { glyphId: string; seg: number } | null = null;
  let bestD = 14;
  glyphs.forEach((g) => {
    if (g.hidden || g.id === excludeId) return;
    const r = findNearestSegment(g.points, p, g.closed, bestD);
    if (r.index >= 0) { bestD = r.distance; best = { glyphId: g.id, seg: r.index }; }
  });
  return best;
};

// Bounding box de los puntos de un glifo (para centrar la vista previa en la galería).
const getGlyphBBox = (points: Point[]) => {
  if (!points.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  points.forEach((p) => {
    const xs = [p.x];
    const ys = [p.y];
    if (p.out) { xs.push(p.x + p.out.x); ys.push(p.y + p.out.y); }
    if (p.in) { xs.push(p.x + p.in.x); ys.push(p.y + p.in.y); }
    xs.forEach((x) => { if (x < minX) minX = x; if (x > maxX) maxX = x; });
    ys.forEach((y) => { if (y < minY) minY = y; if (y > maxY) maxY = y; });
  });
  return { minX, minY, width: maxX - minX, height: maxY - minY };
};

// Devuelve los extremos del segmento `seg` (i -> i+1). Para paths abiertos el
// último segmento válido es n-2 -> n-1.
const getSegment = (points: Point[], seg: number, closed: boolean) => {
  const n = points.length;
  if (n === 0) return { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, startIndex: 0, endIndex: 0 };
  if (n < 2) return { start: points[0], end: points[0], startIndex: 0, endIndex: 0 };
  const segCount = closed ? n : n - 1;
  const s = clamp(seg, 0, segCount - 1);
  const endIndex = closed ? (s + 1) % n : s + 1;
  return { start: points[s], end: points[endIndex], startIndex: s, endIndex };
};

const findNearestVertex = (points: Point[], p: Point, threshold = 12): number => {
  let best = -1;
  let bestD = threshold;
  points.forEach((pt, i) => {
    const d = Math.hypot(pt.x - p.x, pt.y - p.y);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
};

// Punto de la curva Bézier del segmento en `t` (cúbica si hay dos manijas,
// cuadrática si solo hay una).
const bezierPoint = (start: Point, c1: Offset | null, c2: Offset | null, end: Point, t: number) => {
  const mt = 1 - t;
  if (c1 && c2) {
    const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    return { x: a * start.x + b * c1.x + c * c2.x + d * end.x, y: a * start.y + b * c1.y + c * c2.y + d * end.y };
  }
  const c = (c1 || c2) as Offset;
  const a = mt * mt, b = 2 * mt * t, d = t * t;
  return { x: a * start.x + b * c.x + d * end.x, y: a * start.y + b * c.y + d * end.y };
};

// Distancia del punto `p` al TRAZO REAL del segmento: si el segmento es curvo
// (tiene manijas out/in) se muestrea la Bézier; si es recto, proyección exacta.
const segmentDistanceToPoint = (start: Point, end: Point, p: Point): number => {
  const c1 = start.out ? { x: start.x + start.out.x, y: start.y + start.out.y } : null;
  const c2 = end.in ? { x: end.x + end.in.x, y: end.y + end.in.y } : null;
  if (!c1 && !c2) {
    const dx = end.x - start.x, dy = end.y - start.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : clamp(((p.x - start.x) * dx + (p.y - start.y) * dy) / len2, 0, 1);
    return Math.hypot(p.x - (start.x + t * dx), p.y - (start.y + t * dy));
  }
  const N = 24;
  let best = Infinity;
  let prev = start;
  for (let k = 1; k <= N; k++) {
    const q = bezierPoint(start, c1, c2, end, k / N);
    const dx = q.x - prev.x, dy = q.y - prev.y;
    const len2 = dx * dx + dy * dy;
    const s = len2 === 0 ? 0 : clamp(((p.x - prev.x) * dx + (p.y - prev.y) * dy) / len2, 0, 1);
    const d = Math.hypot(p.x - (prev.x + s * dx), p.y - (prev.y + s * dy));
    if (d < best) best = d;
    prev = q;
  }
  return best;
};

// Pares [inicio, fin] de los segmentos que SÍ se dibujan (respeta los contornos
// separados por `break`; un path abierto no cierra el último).
const drawnSegments = (points: Point[], closed: boolean): [number, number][] => {
  const res: [number, number][] = [];
  splitContours(points, closed).forEach(({ idx, closed: cClosed }) => {
    const segCount = cClosed ? idx.length : idx.length - 1;
    for (let k = 0; k < segCount; k++) res.push([idx[k], idx[(k + 1) % idx.length]]);
  });
  return res;
};

const findNearestSegment = (points: Point[], p: Point, closed: boolean, threshold = 16) => {
  if (points.length < 2) return { index: -1, distance: Infinity };
  let bestIndex = -1;
  let bestDist = threshold;
  for (const [si, ei] of drawnSegments(points, closed)) {
    const start = points[si];
    const end = points[ei];
    const d = segmentDistanceToPoint(start, end, p);
    if (d < bestDist) { bestDist = d; bestIndex = si; }
  }
  return { index: bestIndex, distance: bestDist };
};

// Aplica la curva al segmento `seg` según la posición del ratón: cuanto más se
// aleja el ratón de la línea del segmento, más se "abre" la curva (las dos
// manijas se separan perpendicularmente); al acercarlo, se "cierra".
const applyCurveDrag = (points: Point[], seg: number, mouse: Point, closed: boolean): Point[] => {
  const n = points.length;
  const next = points.map(clonePoint);
  const segCount = closed ? n : n - 1;
  if (segCount < 1) return next;
  const s = clamp(seg, 0, segCount - 1);
  const start = next[s];
  const end = next[(s + 1) % n];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const perp = (mouse.x - start.x) * nx + (mouse.y - start.y) * ny;
  const h = perp * (4 / 3); // compensación para que la curva llegue hasta el ratón
  start.out = { x: ux * len / 3 + nx * h, y: uy * len / 3 + ny * h };
  end.in = { x: -ux * len / 3 + nx * h, y: -uy * len / 3 + ny * h };
  return next;
};

// Arrastrar una manija: la mueve libremente. Si el otro extremo del segmento no
// tiene manija, se crea una espejada para que la curva se mantenga suave.
const moveHandle = (points: Point[], ref: HandleRef, mouse: Point, closed: boolean): Point[] => {
  const n = points.length;
  const next = points.map(clonePoint);
  const v = next[ref.vertex];
  if (!v) return next;
  const off = { x: mouse.x - v.x, y: mouse.y - v.y };
  if (ref.kind === 'out') v.out = off; else v.in = off;

  if (ref.kind === 'out') {
    const eIdx = closed ? (ref.vertex + 1) % n : ref.vertex + 1;
    const end = next[eIdx];
    if (end && !end.in) {
      const midX = (v.x + end.x) / 2;
      const midY = (v.y + end.y) / 2;
      end.in = { x: 2 * midX - mouse.x - end.x, y: 2 * midY - mouse.y - end.y };
    }
  } else {
    const sIdx = closed ? (ref.vertex - 1 + n) % n : ref.vertex - 1;
    const start = next[sIdx];
    if (start && !start.out) {
      const midX = (start.x + v.x) / 2;
      const midY = (start.y + v.y) / 2;
      start.out = { x: 2 * midX - mouse.x - start.x, y: 2 * midY - mouse.y - start.y };
    }
  }
  return next;
};

const insertPointOnNearestSegment = (points: Point[], point: Point, closed: boolean): Point[] => {
  if (points.length < 2) return [...points.map(clonePoint), point];

  let nearestIndex = -1;
  let nearestDistance = Infinity;
  let ratio = 0;
  const segmentCount = closed ? points.length : points.length - 1;

  for (let i = 0; i < segmentCount; i++) {
    const start = points[i];
    const end = points[(i + 1) % points.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0
      ? 0
      : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
    const projected = { x: start.x + t * dx, y: start.y + t * dy };
    const distance = Math.hypot(point.x - projected.x, point.y - projected.y);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = i;
      ratio = t;
    }
  }

  if (nearestIndex < 0 || nearestDistance > 20) return [...points.map(clonePoint), point];

  const pts = points.map(clonePoint);
  const start = pts[nearestIndex];
  const end = pts[(nearestIndex + 1) % pts.length];

  let newPt: Point = { x: point.x, y: point.y };
  // Si el segmento era curvo, dividimos la curva (de Casteljau) conservando la forma.
  if (start.out && end.in) {
    const c1 = { x: start.x + start.out.x, y: start.y + start.out.y };
    const c2 = { x: end.x + end.in.x, y: end.y + end.in.y };
    const q0 = lerpPoint(start, c1, ratio);
    const q1 = lerpPoint(c1, c2, ratio);
    const q2 = lerpPoint(c2, end, ratio);
    const r0 = lerpPoint(q0, q1, ratio);
    const r1 = lerpPoint(q1, q2, ratio);
    const s = lerpPoint(r0, r1, ratio);
    newPt = {
      x: s.x,
      y: s.y,
      in: { x: r0.x - s.x, y: r0.y - s.y },
      out: { x: r1.x - s.x, y: r1.y - s.y },
    };
    start.out = { x: q0.x - start.x, y: q0.y - start.y };
    end.in = { x: end.x - q2.x, y: end.y - q2.y };
  }

  return [...pts.slice(0, nearestIndex + 1), newPt, ...pts.slice(nearestIndex + 1)];
};

const handleToPoint = (e: ReactPointerEvent<SVGSVGElement>): Point => {
  const svg = e.currentTarget;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const pt = new DOMPoint(e.clientX, e.clientY);
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
};

// Genera los puntos del CONTORNO del trazo del pincel (un "tubo" vacío): sólamente
// los vértices y segmentos de los lados del trazo, NUNCA un polígono relleno.
// El tubo se construye como la UNIÓN de cápsulas rectangulares (una por cada
// segmento de la línea guía) con semicírculos (redondo) o esquinas (cuadrado) en
// cada vértice del centro. Así el ancho es SIEMPRE constante (= thickness),
// incluso al girar: los lados son paralelos al segmento de centro y las tapas
// son arcos de radio r perpendicular al movimiento.
//  - centerline: puntos del centro del trazo (la línea guía que sigue el ratón).
//  - thickness: ancho del tubo (distancia entre el lado izquierdo y el derecho).
//  - shape: 'round' -> las tapas son arcos (curvas, con varios vértices);
//           'rect' -> las tapas son solo las esquinas (1 vértice por esquina).
// El interior del tubo queda vacío (fill = none): solo se dibujan los lados.
const buildBrushOutline = (centerline: Point[], thickness: number, shape: 'round' | 'rect'): Point[] => {
  const t = Math.max(1, thickness);
  const r = t / 2;
  const n = centerline.length;
  if (n === 0) return [];
  // Un solo punto: la tapa de inicio (un círculo vacío o un cuadrado vacío).
  if (n === 1) {
    const c = centerline[0];
    if (shape === 'round') {
      const pts: Point[] = [];
      const sides = 16;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
      }
      return pts;
    }
    return [
      { x: c.x - r, y: c.y - r },
      { x: c.x + r, y: c.y - r },
      { x: c.x + r, y: c.y + r },
      { x: c.x - r, y: c.y + r },
    ];
  }
  // Dirección del segmento en cada vértice (para calcular perpendiculares correctos).
  // Para vértices intermedios, usamos la bisección del ángulo entre el segmento
  // entrante y el saliente, para mantener ancho constante en las esquinas.
  // También calculamos la distancia de inglete (miter) para esquinas agudas.
  const dirs = centerline.map((_, i) => {
    let ux: number, uy: number;
    let miter = 1; // factor de inglete (1 = distancia r, >1 = más lejos para esquinas agudas)
    if (i === 0) {
      const dx = centerline[1].x - centerline[0].x;
      const dy = centerline[1].y - centerline[0].y;
      const len = Math.hypot(dx, dy) || 1;
      ux = dx / len; uy = dy / len;
    } else if (i === n - 1) {
      const dx = centerline[n - 1].x - centerline[n - 2].x;
      const dy = centerline[n - 1].y - centerline[n - 2].y;
      const len = Math.hypot(dx, dy) || 1;
      ux = dx / len; uy = dy / len;
    } else {
      // Segmento entrante (i-1 -> i)
      const dx1 = centerline[i].x - centerline[i - 1].x;
      const dy1 = centerline[i].y - centerline[i - 1].y;
      const len1 = Math.hypot(dx1, dy1) || 1;
      const ux1 = dx1 / len1;
      const uy1 = dy1 / len1;
      // Segmento saliente (i -> i+1)
      const dx2 = centerline[i + 1].x - centerline[i].x;
      const dy2 = centerline[i + 1].y - centerline[i].y;
      const len2 = Math.hypot(dx2, dy2) || 1;
      const ux2 = dx2 / len2;
      const uy2 = dy2 / len2;
      // Coseno del ángulo interior entre segmentos
      const cosTheta = ux1 * ux2 + uy1 * uy2;
      // Factor de inglete: 1 / sin(θ/2) = sqrt(2 / (1 - cosθ))
      // Limitar a 10x para evitar picos excesivos en ángulos muy agudos (miter limit)
      const denom = 1 - cosTheta;
      if (denom > 1e-6) {
        miter = Math.min(10, Math.sqrt(2 / denom));
      }
      // Bisección del ángulo: normalizar(u1 + u2)
      const bx = ux1 + ux2;
      const by = uy1 + uy2;
      const blen = Math.hypot(bx, by);
      if (blen > 1e-6) {
        ux = bx / blen; uy = by / blen;
      } else {
        // Giro de 180°: usar perpendicular al entrante (cualquiera sirve)
        ux = -uy1; uy = ux1;
        miter = 1;
      }
    }
    return { ux, uy, miter };
  });
  // Para cada vértice del centro, la dirección del segmento que SALE de él (hacia
  // el siguiente). El primer punto usa la dirección del primer segmento; el
  // último usa la del último segmento; los intermedios usan la del segmento que
  // sale (i -> i+1), para que las tapas se alineen con el trazo.
  const outDir = centerline.map((_, i) => {
    if (i === n - 1) return dirs[n - 1];
    return dirs[i];
  });
  // Para cada vértice del centro, la dirección del segmento que LLEGA a él (desde
  // el anterior). El primer punto usa la del primer segmento; el último usa la del
  // último segmento; los intermedios usan la del segmento que llega (i-1 -> i).
  const inDir = centerline.map((_, i) => {
    if (i === 0) return dirs[0];
    return dirs[i];
  });

  const capVerts = 8; // vértices de cada tapa curva (semicircunferencia)
  const outline: Point[] = [];

  // 1) Tapa de INICI: de right[0] (lado derecho del primer segmento) hasta
  //    left[0] (lado izquierdo) por el FONDO (opuesto al movimiento).
  //    right[0] = centro[0] + perpendicular(inDir[0]) * r
  //    left[0]  = centro[0] - perpendicular(inDir[0]) * r
  const perpIn = { x: -inDir[0].uy, y: inDir[0].ux };
  const rightStart = { x: centerline[0].x + perpIn.x * r, y: centerline[0].y + perpIn.y * r };
  const leftStart = { x: centerline[0].x - perpIn.x * r, y: centerline[0].y - perpIn.y * r };
  outline.push({ ...rightStart });
  if (shape === 'round') {
    // Arco de 180° desde rightStart hasta leftStart, por el fondo.
    for (let i = 1; i <= capVerts; i++) {
      const th = (-90 - (i / (capVerts + 1)) * 180) * Math.PI / 180;
      const vx = Math.cos(th) * inDir[0].ux - Math.sin(th) * inDir[0].uy;
      const vy = Math.sin(th) * inDir[0].ux + Math.cos(th) * inDir[0].uy;
      outline.push({ x: centerline[0].x + vx * r, y: centerline[0].y + vy * r });
    }
  } else {
    // Cuadrado: solo la esquina del fondo-derecho y fondo-izquierdo.
    // (rightStart ya está añadido; leftStart se añade al final de la tapa).
  }
  outline.push({ ...leftStart });

  // 2) Rail IZQUIERDO: de left[0] hasta left[n-1], siguiendo cada segmento.
  //    left[i] = centro[i] - perpendicular(outDir[i]) * r * miter
  //    En vértices intermedios, miter > 1 extiende el vértice para mantener
  //    el ancho constante en esquinas agudas (join tipo "miter").
  for (let i = 1; i < n; i++) {
    const perp = { x: -outDir[i].uy, y: outDir[i].ux };
    const m = dirs[i].miter ?? 1;
    outline.push({ x: centerline[i].x - perp.x * r * m, y: centerline[i].y - perp.y * r * m });
  }

  // 3) Tapa de FIN: de left[n-1] hasta right[n-1] por el FRENTE.
  const perpOut = { x: -outDir[n - 1].uy, y: outDir[n - 1].ux };
  const leftEnd = { x: centerline[n - 1].x - perpOut.x * r, y: centerline[n - 1].y - perpOut.y * r };
  const rightEnd = { x: centerline[n - 1].x + perpOut.x * r, y: centerline[n - 1].y + perpOut.y * r };
  if (shape === 'round') {
    for (let i = 1; i <= capVerts; i++) {
      const th = (90 - (i / (capVerts + 1)) * 180) * Math.PI / 180;
      const vx = Math.cos(th) * outDir[n - 1].ux - Math.sin(th) * outDir[n - 1].uy;
      const vy = Math.sin(th) * outDir[n - 1].ux + Math.cos(th) * outDir[n - 1].uy;
      outline.push({ x: centerline[n - 1].x + vx * r, y: centerline[n - 1].y + vy * r });
    }
  } else {
    // Cuadrado: esquina del frente-izquierdo (leftEnd ya está) y frente-derecho.
  }
  outline.push({ ...rightEnd });

  // 4) Rail DERECHO: de right[n-1] hasta right[1] (al revés), cerrando al rightStart.
  for (let i = n - 2; i >= 1; i--) {
    const perp = { x: -outDir[i].uy, y: outDir[i].ux };
    const m = dirs[i].miter ?? 1;
    outline.push({ x: centerline[i].x + perp.x * r * m, y: centerline[i].y + perp.y * r * m });
  }

  return outline;
};

// -------------------- Constants --------------------
const tools: { id: Tool; icon: ReactNode; labelKey: string }[] = [
  { id: 'select', icon: <MousePointer2 className="w-4 h-4" />, labelKey: 'editorFuentes.tools.select' },
  { id: 'hand', icon: <Hand className="w-4 h-4" />, labelKey: 'editorFuentes.tools.hand' },
  { id: 'scale', icon: <Maximize2 className="w-4 h-4" />, labelKey: 'editorFuentes.tools.scale' },
  { id: 'pen', icon: <PenLine className="w-4 h-4" />, labelKey: 'editorFuentes.tools.pen' },
  { id: 'line', icon: <Minus className="w-4 h-4" />, labelKey: 'editorFuentes.tools.line' },
  { id: 'rect', icon: <Square className="w-4 h-4" />, labelKey: 'editorFuentes.tools.rect' },
  { id: 'circle', icon: <Circle className="w-4 h-4" />, labelKey: 'editorFuentes.tools.circle' },
  { id: 'curve', icon: <Spline className="w-4 h-4" />, labelKey: 'editorFuentes.tools.curve' },
  { id: 'connect', icon: <Waypoints className="w-4 h-4" />, labelKey: 'editorFuentes.tools.connect' },
  { id: 'erase', icon: <Eraser className="w-4 h-4" />, labelKey: 'editorFuentes.tools.erase' },
  { id: 'paint', icon: <PaintBucket className="w-4 h-4" />, labelKey: 'editorFuentes.tools.paintSegment' },
  { id: 'fillzone', icon: <LayoutGrid className="w-4 h-4" />, labelKey: 'editorFuentes.tools.fillZone' },
  { id: 'brush', icon: <Pencil className="w-4 h-4" />, labelKey: 'editorFuentes.tools.brush' },
];

const textures: { id: TextureKey | null; labelKey: string }[] = [
  { id: null, labelKey: 'editorFuentes.textures.solid' },
  { id: 'dots', labelKey: 'editorFuentes.textures.dots' },
  { id: 'lines', labelKey: 'editorFuentes.textures.lines' },
  { id: 'checker', labelKey: 'editorFuentes.textures.checker' },
];

// -------------------- Components --------------------
function Toolbar() {
  const { t } = useI18n();
  const store = useEditorStore();
  const [showExport, setShowExport] = useState(false);
  const [showFontStudio, setShowFontStudio] = useState(false);

  // ---- Servidor API de Texturas (simple_api.py, puerto 8000) ----
  const [textureServerStatus, setTextureServerStatus] = useState<{ running: boolean; checking: boolean }>({ running: false, checking: false });
  const [isStartingTextureServer, setIsStartingTextureServer] = useState(false);

  const checkTextureServer = async () => {
    setTextureServerStatus((prev) => ({ ...prev, checking: true }));
    try {
      if (isElectron()) {
        const s = await getServerStatus();
        setTextureServerStatus({ running: !!s.textureApi?.running, checking: false });
      } else {
        const res = await fetch('http://localhost:8000/health', { signal: AbortSignal.timeout(2000) }).catch(() => null);
        setTextureServerStatus({ running: res ? res.ok : false, checking: false });
      }
    } catch {
      setTextureServerStatus({ running: false, checking: false });
    }
  };

  useEffect(() => {
    checkTextureServer();
    const interval = setInterval(checkTextureServer, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleTextureServer = async () => {
    if (!isElectron()) {
      alert(t('editorFuentes.textureApiHint'));
      return;
    }
    setIsStartingTextureServer(true);
    try {
      if (textureServerStatus.running) {
        await stopTextureApi();
        setTextureServerStatus({ running: false, checking: false });
      } else {
        const res = await startTextureApi();
        if (!res.success) throw new Error(res.error || t('editorFuentes.serverStartFailed'));
        setTextureServerStatus({ running: true, checking: false });
      }
    } catch (e: any) {
      alert(t('editorFuentes.serverApiError') + (e.message || t('editorFuentes.errorUnknown')));
      checkTextureServer();
    } finally {
      setIsStartingTextureServer(false);
    }
  };

  // ---- Google Fonts: cargar fuente + importar glifo de una letra ----
  const [gfontName, setGFontName] = useState('');
  const [gfontChar, setGFontChar] = useState('');
  const [gfontStatus, setGFontStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [importing, setImporting] = useState(false);

  // Carga la fuente de Google Fonts (inyecta el <link> de fonts.googleapis.com,
  // igual que el editor HTML) para que quede disponible como fuente en el lienzo.
  const loadGFont = () => {
    const family = gfontName.trim();
    if (!family) { setGFontStatus({ msg: t('editorFuentes.gfontNamePrompt'), ok: false }); return; }
    const href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;700&display=swap`;
    const id = 'zeus-gfont-' + family.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }
    setGFontStatus({ msg: t('editorFuentes.gfontStatusLoaded', { family }), ok: true });
  };

  // Descarga el contorno vectorial real de una letra desde Google Fonts (vía la
  // API proxy /api/gfonts-glyph) y lo inserta como glifo nuevo seleccionado.
  const importGlyph = async () => {
    const family = gfontName.trim();
    if (!family) { setGFontStatus({ msg: t('editorFuentes.gfontNameFirst'), ok: false }); return; }
    const ch = gfontChar.trim().charAt(0);
    if (!ch) { setGFontStatus({ msg: t('editorFuentes.gfontLetterFirst'), ok: false }); return; }
    setImporting(true);
    setGFontStatus({ msg: t('editorFuentes.gfontStatusLoading', { ch, family }), ok: true });
    try {
      const res = await fetch(`/api/gfonts-glyph?family=${encodeURIComponent(family)}&char=${encodeURIComponent(ch)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || t('editorFuentes.gfontError'));
      const glyph = {
        id: `g${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
        name: data.name || ch,
        points: Array.isArray(data.points) ? data.points : [],
        closed: !!data.closed,
        stroke: store.stroke,
        fill: store.fill,
        strokeWidth: store.strokeWidth,
        texture: store.texture,
        font: store.fontName,
      };
      store.addGlyph(glyph);
      setGFontStatus({ msg: t('editorFuentes.gfontStatusImported', { ch, family, points: data.pointCount ?? glyph.points.length }), ok: true });
    } catch (e) {
      setGFontStatus({ msg: e instanceof Error ? e.message : t('editorFuentes.gfontError'), ok: false });
    } finally {
      setImporting(false);
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);

  const newFont = () => {
    if (store.glyphs.length === 0) return;
    if (!window.confirm(t('editorFuentes.newFontConfirm'))) return;
    store.loadFont([], 'MiFuente');
    store.setStroke('#22c55e');
    store.setFill('#1f2937');
    store.setStrokeWidth(4);
    store.setPaintColor('#f59e0b');
    store.setTexture(null);
    store.setBrushShape('round');
    store.setBrushThickness(12);
    store.setVertexSize(6);
    store.setStandardSize(true);
    store.setCustomGuide(540);
    store.setCustomGuideVisible(true);
  };

  const saveJSON = () => {
    const data = JSON.stringify({ fontName: store.fontName, font: store.glyphs, vertexSize: store.vertexSize, standardSize: store.standardSize, paintColor: store.paintColor, customGuide: useEditorStore.getState().customGuideUnits }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'font.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const openJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const arr = Array.isArray(parsed) ? parsed : parsed?.font;
        if (!Array.isArray(arr)) throw new Error(t('editorFuentes.jsonNoGlyphs'));
        const fileFontName = typeof parsed?.fontName === 'string' && parsed.fontName.trim() ? parsed.fontName.trim() : 'MiFuente';
        const fontSet = new Set<string>();
        arr.forEach((gg) => { if (gg && typeof gg.font === 'string' && gg.font.trim()) fontSet.add(gg.font.trim()); });
        const allSameFont = fontSet.size <= 1;
        const glyphs: Glyph[] = arr
          .filter((g) => g && Array.isArray(g.points))
          .map((g) => ({
            id: typeof g.id === 'string' && g.id ? g.id : `g${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
            name: typeof g.name === 'string' ? g.name : 'G',
            points: g.points.map((p: { x?: unknown; y?: unknown; in?: { x?: unknown; y?: unknown }; out?: { x?: unknown; y?: unknown }; break?: unknown; closePrev?: unknown; link?: { glyphId?: unknown; vertex?: unknown }; segStroke?: unknown }) => ({
              x: Number(p.x) || 0,
              y: Number(p.y) || 0,
              in: p.in ? { x: Number(p.in.x) || 0, y: Number(p.in.y) || 0 } : undefined,
              out: p.out ? { x: Number(p.out.x) || 0, y: Number(p.out.y) || 0 } : undefined,
              ...(p.break ? { break: true } : {}),
              ...(p.closePrev ? { closePrev: true } : {}),
              ...(p.link && typeof p.link.glyphId === 'string' && typeof p.link.vertex === 'number'
                ? { link: { glyphId: p.link.glyphId, vertex: Math.max(0, Math.floor(p.link.vertex)) } }
                : {}),
              ...(typeof p.segStroke === 'string' && p.segStroke ? { segStroke: p.segStroke } : {}),
            })),
            closed: !!g.closed,
            stroke: typeof g.stroke === 'string' ? g.stroke : '#22c55e',
            fill: typeof g.fill === 'string' ? g.fill : '#1f2937',
            strokeWidth: Number(g.strokeWidth) || 4,
            texture: typeof g.texture === 'string' ? (g.texture as TextureKey) : null,
            hidden: !!g.hidden,
            font: allSameFont ? fileFontName : (typeof g.font === 'string' && g.font ? g.font : fileFontName),
            ...(Array.isArray(g.contourFills) ? { contourFills: g.contourFills.map((cf: { fill?: unknown; texture?: unknown } | null) => cf ? ({ fill: typeof cf.fill === 'string' ? cf.fill : '#1f2937', texture: typeof cf.texture === 'string' ? (cf.texture as TextureKey) : null }) : ({ fill: '#1f2937', texture: null })) } : {}),
          }));
        if (!glyphs.length) throw new Error(t('editorFuentes.jsonNoValidGlyphs'));
        store.loadFont(glyphs, fileFontName);
        if (typeof parsed.vertexSize === 'number' && Number.isFinite(parsed.vertexSize)) {
          store.setVertexSize(clamp(Math.round(parsed.vertexSize), 2, 20));
        }
        store.setStandardSize(typeof parsed.standardSize === 'boolean' ? parsed.standardSize : true);
        if (typeof parsed.paintColor === 'string' && parsed.paintColor) {
          store.setPaintColor(parsed.paintColor);
        }
        if (typeof parsed.customGuide === 'number' && Number.isFinite(parsed.customGuide)) {
          store.setCustomGuide(clamp(Math.round(parsed.customGuide), 0, 1000));
        }
      } catch (err) {
        alert(`${t('editorFuentes.jsonOpenError')}: ${err instanceof Error ? err.message : t('editorFuentes.jsonInvalidFormat')}`);
      }
    };
    reader.readAsText(file);
  };

  // Exporta la fuente DEL EDITOR con colores COLR v1 + efectos opcionales.
  // Usa buildOpentypeFont(glyphs) para generar la TTF desde las letras diseñadas,
  // luego /api/add-font-colors para añadir CPAL + COLR v1. Nunca usa una fuente preexistente.
  const exportTTFWithEffects = async (opts: { effectFile?: File; effectColor?: string; effectName?: string }) => {
    try {
      const gs = store.glyphs;
      const fn = store.fontName;
      const ss = store.standardSize;
      const font = await buildOpentypeFont(gs, fn, ss);
      const buffer = font.toArrayBuffer();

      // Recoger colores de cada glyph: fill por contorno + stroke
      const colorsMap: Record<string, { contours: string[]; fill?: string; stroke?: string }> = {};
      gs.forEach((rawG: Glyph) => {
        const g = resolveGlyph(rawG, gs);
        const contours = splitContours(g.points, g.closed);
        const contourColors = contours.map((_, ci) => {
          const cf = g.contourFills?.[ci];
          return cf ? cf.fill : g.fill;
        });
        colorsMap[g.name] = {
          contours: contourColors,
          fill: g.fill,
          stroke: g.stroke,
        };
      });

      const ttfBlob = new Blob([buffer], { type: 'font/ttf' });
      const formData = new FormData();
      formData.append('font_file', ttfBlob, `${slug(fn)}-base.ttf`);
      formData.append('colors', JSON.stringify(colorsMap));

      if (opts?.effectFile) {
        formData.append('effect_file', opts.effectFile, opts.effectName || 'effect.svg');
        if (opts.effectColor) formData.append('effect_color', opts.effectColor);
      }

      const res = await fetch('/api/add-font-colors', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: t('editorFuentes.errorUnknown') }));
        throw new Error(err.message || err.detail || t('editorFuentes.errorProcessing'));
      }

      const coloredBuffer = await res.arrayBuffer();
      const coloredBlob = new Blob([coloredBuffer], { type: 'font/ttf' });
      const url = URL.createObjectURL(coloredBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = slug(fn) + '.ttf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exportando TTF con colores:', err);
      alert(t('editorFuentes.errorExportColors') + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="bg-gray-800/80 border-b border-green-900/50 shadow-sm">
      {/* Fila 1: herramientas */}
      <div className="flex items-center gap-1 px-3 py-2 overflow-x-auto">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => store.setTool(tool.id)}
            title={t(tool.labelKey)}
            className={cn(
              'p-2 rounded-lg transition-colors shrink-0',
              store.tool === tool.id ? 'bg-green-600 text-white' : 'text-gray-300 hover:bg-gray-700'
            )}
          >
            {tool.icon}
          </button>
        ))}
        <div className="w-px h-6 bg-gray-700 mx-1 shrink-0" />
        <button onClick={() => store.undo()} title={t('editorFuentes.toolbar.undo')} className="p-2 rounded-lg text-gray-300 hover:bg-gray-700 shrink-0">
          <Undo2 className="w-4 h-4" />
        </button>
        <button onClick={() => store.redo()} title={t('editorFuentes.toolbar.redo')} className="p-2 rounded-lg text-gray-300 hover:bg-gray-700 shrink-0">
          <Undo2 className="w-4 h-4 rotate-180" />
        </button>
        <div className="w-px h-6 bg-gray-700 mx-1 shrink-0" />
        <button onClick={copySelectedGlyphs} title={t('editorFuentes.copy')} className="p-2 rounded-lg text-gray-300 hover:bg-gray-700 shrink-0">
          <Copy className="w-4 h-4" />
        </button>
        <button onClick={cutSelectedGlyphs} title={t('editorFuentes.cut')} className="p-2 rounded-lg text-gray-300 hover:bg-gray-700 shrink-0">
          <Scissors className="w-4 h-4" />
        </button>
        <button onClick={pasteClipboardGlyphs} title={t('editorFuentes.paste')} className="p-2 rounded-lg text-gray-300 hover:bg-gray-700 shrink-0">
          <Clipboard className="w-4 h-4" />
        </button>
        <button
          onClick={mergeSelectedGlyphs}
          disabled={store.selectedGlyphIds.length < 2}
          title={t('editorFuentes.join')}
          className={cn(
            'p-2 rounded-lg transition-colors shrink-0',
            store.selectedGlyphIds.length >= 2 ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 cursor-not-allowed'
          )}
        >
          <Combine className="w-4 h-4" />
        </button>
        <div className="w-px h-6 bg-gray-700 mx-1 shrink-0" />
        <button
          onClick={() => store.setView(store.view === 'gallery' ? 'edit' : 'gallery')}
          title={store.view === 'gallery' ? t('editorFuentes.viewEditor') : t('editorFuentes.viewGallery')}
          className={cn(
            'p-2 rounded-lg transition-colors shrink-0',
            store.view === 'gallery' ? 'bg-green-600 text-white' : 'text-gray-300 hover:bg-gray-700'
          )}
        >
          {store.view === 'gallery' ? <Pencil className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
        </button>
      </div>

      {/* Fila 2: opciones */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-700/50 flex-wrap">
        <label className="text-xs text-gray-400">{t('editorFuentes.toolbar.stroke')}</label>
        <input
          type="color"
          value={store.stroke}
          onChange={(e) => store.setStroke(e.target.value)}
          className="w-6 h-6 bg-transparent border border-gray-600 rounded cursor-pointer"
        />
        <label className="text-xs text-gray-400 ml-2">{t('editorFuentes.toolbar.fill')}</label>
        <input
          type="color"
          value={store.fill}
          onChange={(e) => store.setFill(e.target.value)}
          className="w-6 h-6 bg-transparent border border-gray-600 rounded cursor-pointer"
        />
        <label className="text-xs text-gray-400 ml-2">{t('editorFuentes.toolbar.width')}</label>
        <input
          type="number"
          min="1"
          max="20"
          value={store.strokeWidth}
          onChange={(e) => store.setStrokeWidth(clamp(parseInt(e.target.value) || 1, 1, 20))}
          className="w-14 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
        />
        {store.tool === 'paint' && (
          <>
            <label className="text-xs text-amber-400 ml-2">{t('editorFuentes.toolbar.paint')}</label>
            <input
              type="color"
              value={store.paintColor}
              onChange={(e) => store.setPaintColor(e.target.value)}
              className="w-6 h-6 bg-transparent border border-amber-500 rounded cursor-pointer"
              title={t('editorFuentes.paintColorTitle')}
            />
          </>
        )}
        {store.tool === 'brush' && (
          <>
            <div className="w-px h-6 bg-gray-700 mx-1" />
            <label className="text-xs text-gray-400 ml-1">{t('editorFuentes.form')}</label>
            <button
              onClick={() => store.setBrushShape('round')}
              title={t('editorFuentes.brushRound')}
              className={cn(
                'p-1.5 rounded-lg shrink-0 border',
                store.brushShape === 'round' ? 'bg-green-600 text-white border-green-500' : 'text-gray-300 hover:bg-gray-700 border-transparent'
              )}
            >
              <Circle className="w-4 h-4" />
            </button>
            <button
              onClick={() => store.setBrushShape('rect')}
              title={t('editorFuentes.brushSquare')}
              className={cn(
                'p-1.5 rounded-lg shrink-0 border',
                store.brushShape === 'rect' ? 'bg-green-600 text-white border-green-500' : 'text-gray-300 hover:bg-gray-700 border-transparent'
              )}
            >
              <Square className="w-4 h-4" />
            </button>
            <label className="text-xs text-gray-400 ml-1">{t('editorFuentes.thickness')}</label>
            <Slider
              min={2}
              max={120}
              step={1}
              value={[store.brushThickness]}
              onValueChange={([v]) => store.setBrushThickness(v || 12)}
              className="w-28"
            />
            <span className="text-xs text-gray-400 w-8 text-right">{t('editorFuentes.units', { n: store.brushThickness })}</span>
          </>
        )}
        <div className="w-px h-6 bg-gray-700 mx-1" />
        <select
          value={store.texture ?? ''}
          onChange={(e) => store.setTexture(e.target.value as TextureKey | null)}
          className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
        >
          {textures.map((tex) => (
            <option key={tex.id ?? 'none'} value={tex.id ?? ''}>{t(tex.labelKey)}</option>
          ))}
        </select>
        <div className="w-px h-6 bg-gray-700 mx-1" />
        <button
          onClick={() => store.setGridEnabled(!store.gridEnabled)}
          title={t('editorFuentes.grid.toggleGrid')}
          className={cn('p-2 rounded-lg shrink-0', store.gridEnabled ? 'bg-green-600 text-white' : 'text-gray-300 hover:bg-gray-700')}
        >
          <Grid3X3 className="w-4 h-4" />
        </button>
        <button
          onClick={() => store.setSnapEnabled(!store.snapEnabled)}
          title={t('editorFuentes.grid.toggleSnap')}
          className={cn('p-2 rounded-lg shrink-0', store.snapEnabled ? 'bg-green-600 text-white' : 'text-gray-300 hover:bg-gray-700')}
        >
          <Magnet className="w-4 h-4" />
        </button>
        <label className="text-xs text-gray-400 ml-1">{t('editorFuentes.grid.grid')}</label>
        <input
          type="number"
          min="4"
          max="200"
          step="1"
          value={store.gridSize}
          onChange={(e) => store.setGridSize(clamp(parseInt(e.target.value) || 4, 4, 200))}
          className="w-14 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
          title={t('editorFuentes.grid.gridSize')}
        />
        <button onClick={() => store.setZoom(store.zoom * 1.2)} title={t('editorFuentes.grid.zoomIn')} className="p-2 text-gray-300 hover:bg-gray-700 rounded-lg shrink-0">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button onClick={() => store.setZoom(store.zoom / 1.2)} title={t('editorFuentes.grid.zoomOut')} className="p-2 text-gray-300 hover:bg-gray-700 rounded-lg shrink-0">
          <ZoomOut className="w-4 h-4" />
        </button>
        <div className="flex-1" />
        <button onClick={newFont} title={t('editorFuentes.newFontTitle')} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" /> {t('editorFuentes.newFont')}
        </button>
        <button onClick={saveJSON} title={t('editorFuentes.saveTitle')} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg flex items-center gap-2 text-sm">
          <Save className="w-4 h-4" /> {t('editorFuentes.save')}
        </button>
        <button onClick={() => fileRef.current?.click()} title={t('editorFuentes.openTitle')} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg flex items-center gap-2 text-sm">
          <FolderOpen className="w-4 h-4" /> {t('editorFuentes.open')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) openJSON(f);
            e.target.value = '';
          }}
        />
        <button onClick={() => setShowExport(true)} className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2 text-sm">
          <Download className="w-4 h-4" /> {t('editorFuentes.exportBtn')}
        </button>
        <button onClick={() => setShowFontStudio(true)} className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-2 text-sm">
          <Type className="w-4 h-4" /> {t('fontStudio.title')}
        </button>
        <button
          onClick={handleToggleTextureServer}
          disabled={isStartingTextureServer}
          className={cn(
            "px-2.5 py-2 rounded-lg flex items-center gap-2 text-sm font-medium border transition-all",
            textureServerStatus.running
              ? "bg-green-950/60 border-green-600/80 text-green-300 hover:bg-green-900/60"
              : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white"
          )}
          title={textureServerStatus.running ? t('editorFuentes.apiActive') : t('editorFuentes.apiInactive')}
        >
          <div className={cn("w-2.5 h-2.5 rounded-full", textureServerStatus.running ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]" : isStartingTextureServer ? "bg-amber-400 animate-pulse" : "bg-red-400")} />
          <Server className="w-4 h-4" />
          <span>{isStartingTextureServer ? t('editorFuentes.apiStarting') : textureServerStatus.running ? t('editorFuentes.apiOn') : t('editorFuentes.apiStart')}</span>
        </button>
        <div className="w-px h-6 bg-gray-700 mx-1" />
        <div className="flex items-center gap-1.5 bg-blue-950/40 border border-blue-800/60 rounded-lg px-2 py-1.5">
          <Type className="w-3.5 h-3.5 text-blue-300 shrink-0" />
          <input
            value={gfontName}
            onChange={(e) => setGFontName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') loadGFont(); }}
            placeholder={t('editorFuentes.gfontPlaceholder')}
            className="w-32 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-500"
            title={t('editorFuentes.gfontTitle')}
          />
          <button
            onClick={loadGFont}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold shrink-0"
            title={t('editorFuentes.gfontLoadTitle')}
          >
            {t('editorFuentes.gfontLoad')}
          </button>
          <input
            value={gfontChar}
            onChange={(e) => setGFontChar(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') importGlyph(); }}
            placeholder={t('editorFuentes.gfontLetter')}
            maxLength={2}
            className="w-14 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-500 text-center"
            title={t('editorFuentes.gfontLetterTitle')}
          />
          <button
            onClick={importGlyph}
            disabled={importing}
            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-wait text-white rounded text-xs font-semibold shrink-0"
            title={t('editorFuentes.gfontImportTitle')}
          >
            {importing ? t('editorFuentes.gfontImporting') : t('editorFuentes.gfontImport')}
          </button>
          <button
            onClick={() => window.open('https://fonts.google.com', '_blank')}
            className="p-1.5 text-blue-300 hover:bg-blue-800/50 rounded shrink-0"
            title={t('editorFuentes.gfontOpen')}
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          {gfontStatus && (
            <span className={cn('text-[10px] max-w-52 truncate', gfontStatus.ok ? 'text-green-400' : 'text-red-400')} title={gfontStatus.msg}>
              {gfontStatus.msg}
            </span>
          )}
        </div>
      </div>

      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      <FontStudioModal isOpen={showFontStudio} onClose={() => setShowFontStudio(false)} onExportTTF={exportTTFWithEffects} />
    </div>
  );
}

// -------------------- Export a fuente real (TTF / SVG font / preview) --------------------
// Medida estándar de la fuente: em de 1000 unidades (UPM), ascender 800, descender -200.
// Las letras se dibujan 1:1 en el lienzo (línea base en y=1000) y se exportan apoyadas
// en la línea base (y=0), conservando su tamaño relativo.
const FONT_UNITS = 1000;         // unidades por em (estándar de la industria)
const FONT_ASCENDER = 800;       // 0.8 em por encima de la línea base
const FONT_DESCENDER = -200;     // 0.2 em por debajo de la línea base (j, p, q, g, y)
const toFontY = (svgY: number) => FONT_UNITS - svgY;

// Lienzo del editor: coordenadas 1:1 con las unidades de la fuente (1000 UPM).
// La Y del lienzo es la Y de la fuente invertida (toFontY = 1000 - y):
//   - Línea base (y=0 de la fuente)  -> CANVAS_BASELINE_Y = 1000
//   - Ascender  (800)                -> 200
//   - Cap height (540)               -> 460  (tope de las mayúsculas)
//   - x-height  (400)                -> 600
//   - Descender (-200)               -> 1200
// Así, lo que dibujas apoyado en las guías se exporta EXACTAMENTE con ese tamaño.
// El lienzo es ancho (1600) y alto (1500) para que sobre espacio por arriba del
// ascender (200 px), por abajo del descender (300 px) y a los lados al agrandar
// o subir la letra.
const CANVAS_W = 1600;
const CANVAS_H = 1500;
const CANVAS_BASELINE_Y = FONT_UNITS; // 1000

// Guías tipográficas (unidades de fuente -> Y del lienzo = 1000 - unidades)
const GUIDE_ASCENDER_Y = FONT_UNITS - 800;   // 200
const GUIDE_CAP_HEIGHT_Y = FONT_UNITS - 540; // 460
const GUIDE_X_HEIGHT_Y = FONT_UNITS - 400;   // 600
const GUIDE_DESCENDER_Y = FONT_UNITS + 200;  // 1200
// Guía personalizada ajustable (unidades de fuente; por defecto coincide con el
// cap height 540). Se arrastra en el lienzo (línea ámbar punteada) y se guarda
// con el proyecto JSON.
const GUIDE_CUSTOM_DEFAULT_UNITS = 540;

// Nombre "A" -> código 65. Si el nombre es "L2", usa la primera letra.
const glyphUnicode = (g: Glyph): number | undefined => {
  const m = g.name.match(/[A-Za-z0-9]/);
  return m ? m[0].charCodeAt(0) : undefined;
};

const glyphAdvance = (g: Glyph): number => {
  if (!g.points.length) return 400;
  const xs = g.points.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return Math.max(300, Math.round(maxX - minX + 160));
};

// Genera el atributo d (coordenadas de fuente, y invertida) para SVG font.
const buildFontPathData = (g: Glyph): string => {
  const contours = splitContours(g.points, g.closed);
  if (!contours.length) return '';
  let d = '';
  contours.forEach(({ idx, closed: cClosed }) => {
    if (!idx.length) return;
    const first = g.points[idx[0]];
    if (d) d += ' ';
    d += 'M ' + first.x + ' ' + toFontY(first.y);
    const segCount = cClosed ? idx.length : idx.length - 1;
    for (let k = 0; k < segCount; k++) {
      const s = g.points[idx[k]];
      const e = g.points[idx[(k + 1) % idx.length]];
      const ex = e.x;
      const ey = toFontY(e.y);
      if (s.out && e.in) {
        d += ' C ' + (s.x + s.out.x) + ' ' + toFontY(s.y + s.out.y) + ' ' + (e.x + e.in.x) + ' ' + toFontY(e.y + e.in.y) + ' ' + ex + ' ' + ey;
      } else if (s.out) {
        d += ' Q ' + (s.x + s.out.x) + ' ' + toFontY(s.y + s.out.y) + ' ' + ex + ' ' + ey;
      } else if (e.in) {
        d += ' Q ' + (e.x + e.in.x) + ' ' + toFontY(e.y + e.in.y) + ' ' + ex + ' ' + ey;
      } else {
        d += ' L ' + ex + ' ' + ey;
      }
    }
    if (cClosed) d += ' Z';
  });
  return d;
};

// -------------------- Ajuste al em (Medida estándar) --------------------
// El em es la medida estándar de la fuente: 1000 unidades por em (UPM).
// NO todas las letras miden lo mismo: en una fuente real la "W" es más grande que la
// "i", las mayúsculas son más altas que las minúsculas y las letras con descendentes
// (j, p, q, g, y) bajan de la línea base. Lo estándar es el MARCO (el em), no el tamaño
// de cada letra.
// Al exportar con "Medida estándar" activada, cada letra conserva su tamaño relativo
// tal como la dibujaste (unas más grandes, otras más pequeñas), se apoya en la línea
// base y solo se reduce si se sale del em (más alta que 1000 unidades). La proporción
// se conserva (escala uniforme) y se centra con margen lateral simétrico.
const SIDE_BEARING = 80;     // margen lateral simétrico en unidades de fuente
const normalizeGlyph = (g: Glyph): Glyph => {
  if (!g.points.length) return g;
  const bbox = getGlyphBBox(g.points);
  if (!bbox || bbox.height <= 0) return g;
  // Máximo alto dentro del em: ascender (800) - descender (-200) = 1000 unidades.
  // El lienzo es 1:1 (línea base en y=1000), así que una letra dibujada apoyada en la
  // guía "Línea base" se exporta con su tamaño real; solo se reduce si se sale del em.
  const maxHeight = FONT_ASCENDER - FONT_DESCENDER;
  const factor = bbox.height > maxHeight ? maxHeight / bbox.height : 1;
  const cx = bbox.minX + bbox.width / 2;
  const cy = bbox.minY + bbox.height / 2;
  const scaled = g.points.map((p) => ({
    x: cx + (p.x - cx) * factor,
    y: cy + (p.y - cy) * factor,
    in: p.in ? { x: p.in.x * factor, y: p.in.y * factor } : undefined,
    out: p.out ? { x: p.out.x * factor, y: p.out.y * factor } : undefined,
    break: p.break,
    closePrev: p.closePrev,
    link: p.link,
    segStroke: p.segStroke,
  }));
  const xs = scaled.map((p) => p.x);
  const ys = scaled.map((p) => p.y);
  const dx = SIDE_BEARING - Math.min(...xs);
  const dy = FONT_UNITS - Math.max(...ys); // la parte baja de la letra queda en la línea base (y=0)
  return { ...g, points: scaled.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
};

// Construye la fuente OpenType (TTF) con opentype.js (import dinámico).
// IMPORTANTE: opentype.js solo indexa bien los glifos si se pasan en el array
// `glyphs` del constructor. Antes se usaba font.glyphs.push() que guardaba el
// glifo bajo una clave no numérica y toArrayBuffer() fallaba con
// "Cannot read properties of undefined (reading 'unicode')".
const buildOpentypeFont = async (glyphs: Glyph[], familyName = 'MiFuente', standardSize = false): Promise<import("opentype.js").Font> => {
  const opentype = await import('opentype.js');
  glyphs = glyphs.map((g) => resolveGlyph(g, glyphs));
  if (standardSize) glyphs = glyphs.map(normalizeGlyph);
  const glyphObjs: import("opentype.js").Glyph[] = [];
  glyphObjs.push(new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 400, path: new opentype.Path() }));
  glyphObjs.push(new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 300, path: new opentype.Path() }));
  glyphs.forEach((g) => {
    const unicode = glyphUnicode(g);
    const path = new opentype.Path();
    const n = g.points.length;
    if (n) {
      const contours = splitContours(g.points, g.closed);
      contours.forEach(({ idx, closed: cClosed }) => {
        if (!idx.length) return;
        const first = g.points[idx[0]];
        path.moveTo(first.x, toFontY(first.y));
        const segCount = cClosed ? idx.length : idx.length - 1;
        for (let k = 0; k < segCount; k++) {
          const s = g.points[idx[k]];
          const e = g.points[idx[(k + 1) % idx.length]];
          const ex = e.x;
          const ey = toFontY(e.y);
          if (s.out && e.in) {
            path.curveTo(s.x + s.out.x, toFontY(s.y + s.out.y), e.x + e.in.x, toFontY(e.y + e.in.y), ex, ey);
          } else if (s.out) {
            path.quadraticCurveTo(s.x + s.out.x, toFontY(s.y + s.out.y), ex, ey);
          } else if (e.in) {
            path.quadraticCurveTo(e.x + e.in.x, toFontY(e.y + e.in.y), ex, ey);
          } else {
            path.lineTo(ex, ey);
          }
        }
        if (cClosed) path.close();
      });
    }
    glyphObjs.push(new opentype.Glyph({ name: g.name, unicode, advanceWidth: glyphAdvance(g), path }));
  });
  return new opentype.Font({
    familyName,
    styleName: 'Regular',
    unitsPerEm: FONT_UNITS,
    ascender: FONT_ASCENDER,
    descender: FONT_DESCENDER,
    glyphs: glyphObjs,
  });
};

function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const glyphs = useEditorStore((s) => s.glyphs);
  const vertexSize = useEditorStore((s) => s.vertexSize);
  const fontName = useEditorStore((s) => s.fontName);
  const standardSize = useEditorStore((s) => s.standardSize);
  const setStandardSize = useEditorStore((s) => s.setStandardSize);

  const exportJSON = () => {
    const data = JSON.stringify({ fontName, font: glyphs, vertexSize, standardSize }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'font.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSVG = () => {
    const width = 800;
    const height = 800;
    let patternId = 0;
    const patterns: string[] = [];
    const groups = glyphs.map((rawG, i) => {
      const g = resolveGlyph(rawG, glyphs);
      const px = (i * 180) % width;
      const py = Math.floor((i * 180) / width) * 180;
      const stroke = g.stroke;
      const contours = splitContours(g.points, g.closed);
      const parts: string[] = [];
      contours.forEach((_, ci) => {
        const cf = g.contourFills?.[ci];
        const tex = cf ? cf.texture : g.texture;
        const fillC = cf ? cf.fill : g.fill;
        const contourD = buildContourPath(g.points, ci, g.closed);
        if (tex) {
          const pid = 'zeus-tex-' + patternId++;
          patterns.push(
            '<pattern id="' + pid + '" patternUnits="userSpaceOnUse" width="10" height="10">' +
            (tex === 'dots' ? '<circle cx="2" cy="2" r="1.5" fill="' + fillC + '"/>' :
              tex === 'lines' ? '<line x1="0" y1="0" x2="10" y2="10" stroke="' + fillC + '" stroke-width="1"/>' :
              '<rect width="5" height="5" fill="' + fillC + '"/><rect x="5" y="5" width="5" height="5" fill="' + fillC + '"/>') +
            '</pattern>'
          );
          parts.push('<path d="' + contourD + '" fill="url(#' + pid + ')" stroke="' + stroke + '" stroke-width="' + g.strokeWidth + '" stroke-linejoin="round" stroke-linecap="round"/>');
        } else {
          parts.push('<path d="' + contourD + '" fill="' + fillC + '" stroke="' + stroke + '" stroke-width="' + g.strokeWidth + '" stroke-linejoin="round" stroke-linecap="round"/>');
        }
      });
      g.points.forEach((p, si) => {
        if (!p.segStroke) return;
        const dSeg = buildSegmentPath(g.points, si, g.closed);
        if (!dSeg) return;
        parts.push('<path d="' + dSeg + '" fill="none" stroke="' + p.segStroke + '" stroke-width="' + g.strokeWidth + '" stroke-linejoin="round" stroke-linecap="round"/>');
      });
      return '<g transform="translate(' + px + ',' + py + ')">' + parts.join('') + '</g>';
    }).join('');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"><defs>' + patterns.join('') + '</defs><rect width="100%" height="100%" fill="#111"/>' + groups + '</svg>';
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'font.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSS = () => {
    const glyphCSS = glyphs.map((g) => {
      let css = '.glyph-' + g.name.toLowerCase() + '{stroke:' + g.stroke + ';fill:' + g.fill + ';stroke-width:' + g.strokeWidth + ';}' + String.fromCharCode(10);
      splitContours(g.points, g.closed).forEach((_, ci) => {
        const cf = g.contourFills?.[ci];
        if (cf) css += '.glyph-' + g.name.toLowerCase() + ' .zone-' + ci + '{fill:' + cf.fill + ';}' + String.fromCharCode(10);
      });
      g.points.forEach((p, i) => {
        if (!p.segStroke) return;
        if (!g.closed && i === g.points.length - 1) return;
        css += '.glyph-' + g.name.toLowerCase() + ' .seg-' + i + '{stroke:' + p.segStroke + ';}' + String.fromCharCode(10);
      });
      return css;
    }).join(String.fromCharCode(10));
    const blob = new Blob([glyphCSS], { type: 'text/css' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'font.css';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Fuente instalable (.ttf) con colores COLR v1 embebidos.
  // Genera la TTF base con opentype.js, recoge los colores de cada glyph
  // (fill, contourFills, stroke) y los envía a la API de Python que añade
  // CPAL + COLR v1. El resultado es una TTF instalable con colores reales.
  // Exporta la fuente DEL EDITOR (glyphs) con colores COLR v1 + efectos opcionales.
  // Este es el único flujo de exportación TTF: siempre usa buildOpentypeFont(glyphs)
  // para generar la fuente desde las letras diseñadas, nunca una fuente preexistente.
  const exportTTF = async (opts?: { effectFile?: File; effectColor?: string; effectName?: string }) => {
    try {
      const font = await buildOpentypeFont(glyphs, fontName, standardSize);
      const buffer = font.toArrayBuffer();

      // Recoger colores de cada glyph: fill por contorno + stroke
      const colorsMap: Record<string, { contours: string[]; fill?: string; stroke?: string }> = {};
      glyphs.forEach((rawG) => {
        const g = resolveGlyph(rawG, glyphs);
        const contours = splitContours(g.points, g.closed);
        const contourColors = contours.map((_, ci) => {
          const cf = g.contourFills?.[ci];
          return cf ? cf.fill : g.fill;
        });
        colorsMap[g.name] = {
          contours: contourColors,
          fill: g.fill,
          stroke: g.stroke,
        };
      });

      // Enviar a la API para añadir COLR v1 + CPAL
      const ttfBlob = new Blob([buffer], { type: 'font/ttf' });
      const formData = new FormData();
      formData.append('font_file', ttfBlob, `${slug(fontName)}-base.ttf`);
      formData.append('colors', JSON.stringify(colorsMap));

      // Efecto opcional (glow, outline, grunge) desde Font Studio
      if (opts?.effectFile) {
        formData.append('effect_file', opts.effectFile, opts.effectName || 'effect.svg');
        if (opts.effectColor) formData.append('effect_color', opts.effectColor);
      }

      const res = await fetch('/api/add-font-colors', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: t('editorFuentes.errorUnknown') }));
        throw new Error(err.message || err.detail || t('editorFuentes.errorProcessing'));
      }

      const coloredBuffer = await res.arrayBuffer();
      const coloredBlob = new Blob([coloredBuffer], { type: 'font/ttf' });
      const url = URL.createObjectURL(coloredBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = slug(fontName) + '.ttf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exportando TTF con colores:', err);
      alert(t('editorFuentes.errorExportColors') + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Página HTML standalone con la fuente embebida (base64) para probarla en el navegador.
  const exportHTMLPreview = async () => {
    const font = await buildOpentypeFont(glyphs, fontName, standardSize);
    const buffer = font.toArrayBuffer();
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    // Galería con los colores reales del editor (rellenos por zona, texturas y trazos por segmento).
    const gallery = glyphs.map((rawG) => {
      const g = resolveGlyph(rawG, glyphs);
      const stroke = g.stroke;
      let inner = '';
      splitContours(g.points, g.closed).forEach((_, ci) => {
        const cf = g.contourFills?.[ci];
        const fillC = cf ? cf.fill : g.fill;
        const dC = buildContourPath(g.points, ci, g.closed);
        inner += '<path d="' + dC + '" fill="' + fillC + '" stroke="' + stroke + '" stroke-width="' + g.strokeWidth + '" stroke-linejoin="round" stroke-linecap="round"/>';
      });
      g.points.forEach((p, si) => {
        if (!p.segStroke) return;
        const dSeg = buildSegmentPath(g.points, si, g.closed);
        if (!dSeg) return;
        inner += '<path d="' + dSeg + '" fill="none" stroke="' + p.segStroke + '" stroke-width="' + g.strokeWidth + '" stroke-linejoin="round" stroke-linecap="round"/>';
      });
      return '<div class="cell"><div class="name">' + g.name + '</div><svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet">' + inner + '</svg></div>';
    }).join('');
    const html = '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>' + t('editorFuentes.previewTitle') + ' ' + fontName + '</title><style>' +
      "@font-face{font-family:'" + fontName + "';src:url(data:font/ttf;base64," + b64 + ") format('truetype');}" +
      'body{font-family:MiFuente,serif;font-size:48px;background:#111;color:#eee;padding:40px;}' +
      'textarea{font-family:MiFuente,serif;font-size:48px;width:100%;min-height:220px;background:#1a1a1a;color:#eee;border:1px solid #444;border-radius:8px;padding:12px;}' +
      'h2{font-family:sans-serif;color:#999;font-size:16px;}' +
      '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:28px;}' +
      '.cell{background:#161616;border:1px solid #333;border-radius:10px;padding:10px;display:flex;flex-direction:column;align-items:center;gap:6px;}' +
      '.cell svg{width:100%;height:auto;background:#0c0c0c;border-radius:6px;}' +
      '.name{font-family:sans-serif;font-size:12px;color:#7dd3fc;font-weight:bold;}</style></head><body>' +
      '<h2>' + t('editorFuentes.previewColors') + '</h2>' +
      '<div class="grid">' + gallery + '</div>' +
      '<h2>' + t('editorFuentes.previewType', { name: fontName }) + '</h2>' +
      '<textarea spellcheck="false">ABCDEFGHIJKLMNOPQRSTUVWXYZ' + String.fromCharCode(10) + 'abcdefghijklmnopqrstuvwxyz' + String.fromCharCode(10) + '0123456789</textarea>' +
      '</body></html>';
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = slug(fontName) + '-preview.html';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Fuente SVG clásica (compatible con algunos navegadores y herramientas de diseño).
  const exportSVGFont = () => {
    const glyphsSvg = glyphs.map((rawG) => {
      const resolved = resolveGlyph(rawG, glyphs);
      const g = standardSize ? normalizeGlyph(resolved) : resolved;
      const unicode = glyphUnicode(g);
      if (unicode === undefined) return '';
      return '<glyph unicode="&#x' + unicode.toString(16) + ';" glyph-name="' + g.name + '" horiz-adv-x="' + glyphAdvance(g) + '" d="' + buildFontPathData(g) + '"/>';
    }).join('');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><defs><font id="' + slug(fontName) + '" horiz-adv-x="600"><font-face font-family="' + fontName + '" units-per-em="' + FONT_UNITS + '" ascent="' + FONT_ASCENDER + '" descent="' + FONT_DESCENDER + '"/><missing-glyph horiz-adv-x="400"/><glyph unicode=" " horiz-adv-x="300"/>' + glyphsSvg + '</font></defs></svg>';
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = slug(fontName) + '.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-gray-800 border border-green-900/50 rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-gray-100 mb-4">{t('editorFuentes.export.exportFont')}</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none bg-gray-900/60 border border-green-900/50 rounded-lg px-3 py-2">
            <input
              type="checkbox"
              checked={standardSize}
              onChange={(e) => setStandardSize(e.target.checked)}
              className="accent-green-500 w-4 h-4"
            />
            <span>{t('editorFuentes.measureStandard')} <span className="text-gray-500">{t('editorFuentes.measureHint')}</span></span>
          </label>
          <button onClick={() => exportTTF()} className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg">{t('editorFuentes.export.exportTtf')}</button>
          <button onClick={exportHTMLPreview} className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg">{t('editorFuentes.export.exportHtml')}</button>
          <button onClick={exportSVGFont} className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg">{t('editorFuentes.export.exportSvgFont')}</button>
          <div className="border-t border-gray-700 pt-3 space-y-3">
            <button onClick={exportJSON} className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg">{t('editorFuentes.export.exportJson')}</button>
            <button onClick={exportSVG} className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg">{t('editorFuentes.export.exportSvg')}</button>
            <button onClick={exportCSS} className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg">{t('editorFuentes.export.exportCss')}</button>
          </div>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            {t('editorFuentes.ttfInfo1')}<b className="text-gray-300">{t('editorFuentes.ttf')}</b>{t('editorFuentes.ttfInfo2')}<b className="text-green-400">{t('editorFuentes.colrV1')}</b>{t('editorFuentes.ttfInfo3')}<b className="text-gray-300">{fontName}</b>{t('editorFuentes.ttfInfo4')}
          </p>
          <button onClick={onClose} className="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-lg">{t('editorFuentes.export.close')}</button>
        </div>
      </div>
    </div>
  );
}

function GlyphManager() {
  const { t } = useI18n();
  const glyphs = useEditorStore((s) => s.glyphs);
  const selectedGlyphIds = useEditorStore((s) => s.selectedGlyphIds);
  const selectGlyph = useEditorStore((s) => s.selectGlyph);
  const addGlyph = useEditorStore((s) => s.addGlyph);
  const deleteGlyph = useEditorStore((s) => s.deleteGlyph);
  const toggleGlyphVisibility = useEditorStore((s) => s.toggleGlyphVisibility);

  const handleAdd = () => {
    const id = `g${Date.now()}`;
    addGlyph({
      id,
      name: String.fromCharCode(65 + glyphs.length).toUpperCase(),
      // Cuadrado por defecto apoyado en la línea base (y=1000), 300x300 unidades.
      points: [
        { x: 350, y: 700 },
        { x: 650, y: 700 },
        { x: 650, y: 1000 },
        { x: 350, y: 1000 },
      ],
      closed: true,
      stroke: '#22c55e',
      fill: '#1f2937',
      strokeWidth: 4,
      texture: null,
      font: useEditorStore.getState().fontName,
    });
  };

  return (
    <div className="flex flex-col gap-2 p-4 bg-gray-800/80 border-r border-green-900/50 min-w-[180px]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase">{t('editorFuentes.glyphs.glyphs')}</span>
        <button onClick={handleAdd} className="p-1 rounded hover:bg-gray-700" title={t('editorFuentes.glyphs.addGlyph')}>
          <Plus className="w-4 h-4 text-green-500" />
        </button>
      </div>
      <div className="text-[10px] text-gray-500 -mt-1">{t('editorFuentes.multiSelect')}</div>
      <div className="flex flex-col gap-1 overflow-y-auto max-h-60">
        {glyphs.map((g) => {
          const isSelected = selectedGlyphIds.includes(g.id);
          return (
            <div
              key={g.id}
              className={cn(
                'group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer',
                isSelected ? 'bg-green-900/50 text-white' : 'text-gray-300 hover:bg-gray-700'
              )}
              onClick={(e) => selectGlyph(g.id, e.ctrlKey || e.metaKey)}
            >
              <span className={cn('font-bold', g.hidden && 'line-through text-gray-500')}>{g.name}</span>
              <span className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGlyphVisibility(g.id);
                  }}
                  className={g.hidden ? 'text-gray-500 hover:text-green-500' : 'text-green-500 hover:text-green-400'}
                  title={g.hidden ? t('editorFuentes.showInCanvas') : t('editorFuentes.hideInCanvas')}
                >
                  {g.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteGlyph(g.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-green-500"
                  title={t('editorFuentes.glyphs.delete')}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Manija amarilla arrastrable: punto visible pequeño + zona de agarre invisible
// grande. El radio del punto y de la zona de agarre siguen el campo "Vertex Size"
// del panel Properties (con un mínimo razonable para poder agarrarla).
function HandleGrip({
  x,
  y,
  active,
  onDragStart,
  color = '#fbbf24',
}: {
  x: number;
  y: number;
  active: boolean;
  onDragStart: () => void;
  color?: string;
}) {
  const vertexSize = useEditorStore((s) => s.vertexSize);
  const dotR = Math.max(2, vertexSize * 0.8);
  const gripR = Math.max(10, vertexSize * 2.2);
  const dot = (
    <circle cx={x} cy={y} r={dotR} fill={color} stroke="#111" strokeWidth={1.5} className="pointer-events-none" />
  );
  if (!active) return dot;
  return (
    <>
      {dot}
      <circle
        cx={x}
        cy={y}
        r={gripR}
        fill="transparent"
        stroke="none"
        pointerEvents="all"
        className="cursor-grab active:cursor-grabbing"
        onPointerDown={(e: ReactPointerEvent<SVGCircleElement>) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // La captura es opcional; el arrastre sigue funcionando por bubbling.
          }
          onDragStart();
        }}
        onClick={(e) => e.stopPropagation()}
      />
    </>
  );
}

function EditorCanvas() {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedVertices, setSelectedVertices] = useState<Set<number>>(new Set());
  const [primaryVertex, setPrimaryVertex] = useState<number | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [dragVertices, setDragVertices] = useState<Set<number> | null>(null);
  const [dragHandle, setDragHandle] = useState<HandleRef | null>(null);
  const [curveAdjust, setCurveAdjust] = useState<{ seg: number } | null>(null);
  // Línea independiente en curso (herramienta Line): glyphId = la nueva línea,
  // targetId = el glifo al que se conecta.
  const [lineDraft, setLineDraft] = useState<{ glyphId: string; targetId: string } | null>(null);
  // Herramienta Rect: esquina inicial + posición actual del ratón (se crea al soltar).
  const [rectDraft, setRectDraft] = useState<{ x0: number; y0: number } | null>(null);
  const [rectMouse, setRectMouse] = useState<Point | null>(null);
  // Herramienta Círculo: centro inicial + posición actual del ratón (se crea al soltar).
  const [circleDraft, setCircleDraft] = useState<{ x0: number; y0: number } | null>(null);
  const [circleMouse, setCircleMouse] = useState<Point | null>(null);
  // Herramienta Pincel: dibuja un "tubo vacío" (solo los lados del trazo, interior
// vacío). Los vértices se FIXAN solo al pinchar (pointer down) y al soltar
// (pointer up): mientras se mueve el ratón sin soltar, el trazo lo sigue en dos
// líneas (preview) pero no se crean vértices. Al volver a pinchar, se fijan los
// próximos vértices (el del principio y el del final del segmento anterior).
// `fixedPoints` son los vértices ya fijados; `currentPoint` es el extremo del
// segmento en curso (preview, no fijo).
const [brushDraft, setBrushDraft] = useState<{
  draftGlyphId: string;
  connected: boolean;
  fixedPoints: Point[];
  currentPoint: Point | null;
} | null>(null);
const [brushMouse, setBrushMouse] = useState<Point | null>(null);
  // Herramienta Mano: arrastra todos los glifos seleccionados. Guarda la posición
  // inicial del puntero y una copia de los puntos para calcular el desplazamiento.
  const [handDrag, setHandDrag] = useState<{ startX: number; startY: number; glyphs: { id: string; points: Point[] }[] } | null>(null);
  // Herramienta Scale: arrastra para redimensionar SOLO el glifo seleccionado.
  const [scaleDrag, setScaleDrag] = useState<{ startX: number; startY: number; diag: number; entries: { id: string; points: Point[] }[] } | null>(null);
  // Herramienta Paint: segmento bajo el cursor (resaltado al pasar el ratón).
  const [paintHover, setPaintHover] = useState<{ glyphId: string; seg: number } | null>(null);
  const [fillzoneHover, setFillzoneHover] = useState<{ glyphId: string; contour: number } | null>(null);
  // Guía personalizada: true mientras se arrastra la línea ámbar del lienzo.
  const [guideDrag, setGuideDrag] = useState(false);
  // Marquee selection (rectángulo de selección múltiple): start point + current point
  const [marquee, setMarquee] = useState<{ start: Point; current: Point } | null>(null);

  const glyphs = useEditorStore((s) => s.glyphs);
  const selectedGlyphId = useEditorStore((s) => s.selectedGlyphId);
  const selectedGlyphIds = useEditorStore((s) => s.selectedGlyphIds);
  const tool = useEditorStore((s) => s.tool);
  const gridEnabled = useEditorStore((s) => s.gridEnabled);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const gridSize = useEditorStore((s) => s.gridSize);
  const zoom = useEditorStore((s) => s.zoom);
  const stroke = useEditorStore((s) => s.stroke);
  const fill = useEditorStore((s) => s.fill);
  const strokeWidth = useEditorStore((s) => s.strokeWidth);
  const texture = useEditorStore((s) => s.texture);
  const vertexSize = useEditorStore((s) => s.vertexSize);
  const customGuideUnits = useEditorStore((s) => s.customGuideUnits);
  const customGuideVisible = useEditorStore((s) => s.customGuideVisible);
  const setCustomGuide = useEditorStore((s) => s.setCustomGuide);
  const setCustomGuideVisible = useEditorStore((s) => s.setCustomGuideVisible);
  const brushShape = useEditorStore((s) => s.brushShape);
  const brushThickness = useEditorStore((s) => s.brushThickness);
  const setBrushShape = useEditorStore((s) => s.setBrushShape);
  const setBrushThickness = useEditorStore((s) => s.setBrushThickness);
  const openGlyphIds = useEditorStore((s) => s.openGlyphIds);
  const setOpenGlyphs = useEditorStore((s) => s.setOpenGlyphs);
  const updateGlyph = useEditorStore((s) => s.updateGlyph);
  const addGlyph = useEditorStore((s) => s.addGlyph);
  const selectGlyph = useEditorStore((s) => s.selectGlyph);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const paintSegment = useEditorStore((s) => s.paintSegment);
  const paintContour = useEditorStore((s) => s.paintContour);
  // Herramienta Connect: vértice ancla del primer clic + posición actual del ratón.
  const [connectDraft, setConnectDraft] = useState<{ anchorGlyphId: string; anchorVertex: number } | null>(null);
  const [connectMouse, setConnectMouse] = useState<Point | null>(null);
  useEffect(() => {
    if (tool !== 'connect') {
      setConnectDraft(null);
      setConnectMouse(null);
    }
  }, [tool]);
  useEffect(() => {
    if (tool !== 'paint') setPaintHover(null);
  }, [tool]);
  useEffect(() => {
    if (tool !== 'fillzone') setFillzoneHover(null);
  }, [tool]);
  useEffect(() => {
    if (tool !== 'fillzone') setFillzoneHover(null);
  }, [tool]);
  useEffect(() => {
    if (tool !== 'rect') {
      setRectDraft(null);
      setRectMouse(null);
      return;
    }
    const onKeyRect = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setRectDraft(null);
        setRectMouse(null);
      }
    };
    window.addEventListener('keydown', onKeyRect);
    return () => window.removeEventListener('keydown', onKeyRect);
  }, [tool]);
  useEffect(() => {
    if (tool !== 'circle') {
      setCircleDraft(null);
      setCircleMouse(null);
      return;
    }
    const onKeyCircle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCircleDraft(null);
        setCircleMouse(null);
      }
    };
    window.addEventListener('keydown', onKeyCircle);
    return () => window.removeEventListener('keydown', onKeyCircle);
  }, [tool]);

  useEffect(() => {
    if (tool !== 'connect' || !connectDraft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setConnectDraft(null);
        setConnectMouse(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, connectDraft]);

  useEffect(() => {
    if (tool !== 'brush') {
      setBrushDraft(null);
      setBrushMouse(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBrushDraft(null);
        setBrushMouse(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool]);

  const selectedGlyph = glyphs.find((g) => g.id === selectedGlyphId) ?? null;
  // Glifos visibles en el lienzo (los ocultados con el ojo no se renderizan).
  const visibleGlyphs = glyphs.filter((g) => !g.hidden);
  // Modo "solo": al venir de la galería, solo se muestra el glifo elegido en el lienzo.
  // Lienzo: solo se muestran las letras "abiertas" (galería) + la que se está editando.
  const openIds = new Set(openGlyphIds);
  const displayGlyphs = glyphs.filter((g) => !g.hidden && (openIds.has(g.id) || g.id === selectedGlyphId));

  const snapPoint = useCallback((p: Point): Point => {
    if (!snapEnabled) return p;
    return { x: Math.round(p.x / gridSize) * gridSize, y: Math.round(p.y / gridSize) * gridSize };
  }, [gridSize, snapEnabled]);

  // Convierte un evento de puntero a coordenadas del lienzo (usa el <svg> real,
  // así que también sirve para los manejadores de la guía personalizada).
  const svgPointFromEvent = (e: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY);
    const t = pt.matrixTransform(ctm.inverse());
    return { x: t.x, y: t.y };
  };

  const handlePointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!selectedGlyph || selectedGlyph.hidden) return;
    const pt = snapPoint(handleToPoint(e));
    const raw = handleToPoint(e);
    const n = selectedGlyph.points.length;

    // Herramienta Mano: mover todos los glifos seleccionados a la vez.
    if (tool === 'hand') {
      pushHistory();
      setSelectedVertices(new Set());
      setPrimaryVertex(null);
      setSelectedSegment(null);
      const targets = glyphs.filter((g) => selectedGlyphIds.includes(g.id) && !g.hidden);
      setHandDrag({
        startX: raw.x,
        startY: raw.y,
        glyphs: targets.map((g) => ({ id: g.id, points: materializeGlyph(g, glyphs).points.map(clonePoint) })),
      });
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    // Herramienta Scale: arrastra para redimensionar TODOS los glifos seleccionados
    // a la vez (cada uno alrededor de su propio centro, escala uniforme).
    if (tool === 'scale') {
      const targets = glyphs.filter((g) => selectedGlyphIds.includes(g.id) && !g.hidden);
      if (!targets.length) return;
      pushHistory();
      setSelectedVertices(new Set());
      setPrimaryVertex(null);
      setSelectedSegment(null);
      const allPts = targets.flatMap((g) => g.points);
      if (!allPts.length) return;
      const xs = allPts.map((p) => p.x);
      const ys = allPts.map((p) => p.y);
      const diag = Math.max(1, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
      setScaleDrag({
        startX: raw.x,
        startY: raw.y,
        diag,
        entries: targets.map((g) => ({ id: g.id, points: materializeGlyph(g, glyphs).points.map(clonePoint) })),
      });
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    // Herramienta Rect: primer clic fija una esquina; al soltar se crea el rectángulo.
    if (tool === 'rect') {
      setRectDraft({ x0: pt.x, y0: pt.y });
      setRectMouse(null);
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    // Herramienta Círculo: primer clic fija el centro; al soltar se crea el círculo.
    if (tool === 'circle') {
      setCircleDraft({ x0: pt.x, y0: pt.y });
      setCircleMouse(null);
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    // Herramienta Pincel: el primer clic inicia un contorno nuevo (un "tubo" vacío:
    // solo los lados del trazo, sin relleno). Si el clic cae cerca de un vértice de
    // un glifo visible, el primer punto se cementa a ese vértice (magnetismo) y el
    // contorno se abre en el glifo al que pertenece; si no, se crea un glifo
    // independiente. Cada clic posterior FIJA un nuevo vértice (el del principio y
    // el del final del segmento anterior); mientras se mueve el ratón sin soltar,
    // el trazo lo sigue en dos líneas (preview) pero no se crean vértices.
    if (tool === 'brush') {
      const startPt = snapPoint(raw);

      // Ya hay un contorno en curso: el clic FIJA el vértice actual (extremo del
      // preview). Si el usuario pinchó sin haber movido el ratón, se fija la
      // propia posición del clic (si está lejos del último vértice fijo).
      if (brushDraft) {
        const lastFixed = brushDraft.fixedPoints[brushDraft.fixedPoints.length - 1];
        const ptToFix = brushDraft.currentPoint || startPt;
        const d = Math.hypot(ptToFix.x - lastFixed.x, ptToFix.y - lastFixed.y);
        if (d > 0.5) {
          const fixed = [...brushDraft.fixedPoints, { ...ptToFix }];
          const outline = buildBrushOutline(fixed, brushThickness, brushShape);
          updateGlyph(brushDraft.draftGlyphId, { points: outline, closed: true });
          setBrushDraft({ ...brushDraft, fixedPoints: fixed, currentPoint: null });
        }
        setBrushMouse(null);
        svgRef.current?.setPointerCapture(e.pointerId);
        return;
      }

      // Primer clic: glifo nuevo con solo la tapa de inicio (un punto fijo).
      // Magnetismo: buscar el vértice más cercano en TODOS los glifos visibles.
      const across = findNearestVertexAcross(glyphs, startPt, 22);
      let firstCenter: Point;
      let connected = false;
      if (across) {
        const targetGlyph = glyphs.find((g) => g.id === across.glyphId);
        const targetV = targetGlyph && targetGlyph.points[across.vertex];
        if (targetV) {
          firstCenter = { ...targetV };
          connected = true;
        } else {
          firstCenter = { ...startPt };
        }
      } else {
        firstCenter = { ...startPt };
      }
      const outline = buildBrushOutline([firstCenter], brushThickness, brushShape);
      const id = `g${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      const brushGlyph: Glyph = {
        id,
        name: `P${glyphs.length + 1}`,
        points: outline,
        closed: true,
        stroke,
        fill,
        strokeWidth,
        texture: null,
        font: useEditorStore.getState().fontName,
      };
      pushHistory();
      addGlyph(brushGlyph);
      selectGlyph(id, false);
      if (connected) {
        const acrossG = glyphs.find((g) => g.id === across!.glyphId);
        if (acrossG) setOpenGlyphs([...new Set([...openGlyphIds, acrossG.id])]);
      }
      setBrushDraft({ draftGlyphId: id, connected, fixedPoints: [firstCenter], currentPoint: null });
      setBrushMouse(null);
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    // Segundo clic de la herramienta Line: fija el extremo de la línea en curso.
    if (tool === 'line' && lineDraft) {
      const target = glyphs.find((g) => g.id === lineDraft.targetId);
      const draftGlyph = glyphs.find((g) => g.id === lineDraft.glyphId);
      if (target && draftGlyph && draftGlyph.points.length >= 2) {
        const endPt = snapPoint(raw);
        const nearest = findNearestVertex(target.points, endPt, 22);
        const finalPt = nearest >= 0 ? target.points[nearest] : endPt;
        const updated: Glyph = {
          ...draftGlyph,
          points: [{ ...draftGlyph.points[0] }, { ...finalPt }],
        };
        pushHistory();
        updateGlyph(draftGlyph.id, { points: updated.points });
        selectGlyph(draftGlyph.id, false);
      }
      setLineDraft(null);
      return;
    }

    // Primer clic de la herramienta Line: si cae fuera del glifo, crea una línea
    // independiente que se conecta al objeto; si cae sobre el glifo, inserta punto.
    if (tool === 'line') {
      const onGlyph = findNearestVertex(selectedGlyph.points, raw, 14) >= 0 ||
        findNearestSegment(selectedGlyph.points, raw, selectedGlyph.closed, 14).index >= 0;
      if (!onGlyph && selectedGlyph.points.length > 0) {
        const startPt = snapPoint(raw);
        const nearest = findNearestVertex(selectedGlyph.points, startPt, 22);
        const finalStart = nearest >= 0 ? selectedGlyph.points[nearest] : startPt;
        const id = `g${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
        const lineGlyph: Glyph = {
          id,
          name: `L${glyphs.length + 1}`,
          points: [
            { x: finalStart.x, y: finalStart.y },
            { x: finalStart.x + gridSize, y: finalStart.y + gridSize },
          ],
          closed: false,
          stroke,
          fill,
          strokeWidth,
          texture: null,
          font: useEditorStore.getState().fontName,
        };
        addGlyph(lineGlyph);
        setLineDraft({ glyphId: id, targetId: selectedGlyph.id });
        svgRef.current?.setPointerCapture(e.pointerId);
        return;
      }
      // Clic sobre el glifo: inserta un punto en el path (como Pen).
      if (onGlyph) {
        pushHistory();
        const next = insertPointOnNearestSegment(selectedGlyph.points, pt, selectedGlyph.closed);
        updateGlyph(selectedGlyph.id, { points: next });
        const newVertex = findNearestVertex(next, pt);
        setSelectedVertices(new Set([newVertex]));
        setPrimaryVertex(newVertex);
        setSelectedSegment(null);
        return;
      }
    }

    // Herramienta Curve: tocar un vértice curva el segmento a su derecha; tocar un
    // segmento lo curva directamente. El arrastre abre/cierra la curva.
    if (tool === 'curve') {
      const vi = findNearestVertex(selectedGlyph.points, raw, 14);
      if (vi >= 0) {
        pushHistory();
        const seg = selectedGlyph.closed ? vi : Math.min(vi, n - 2);
        const next = applyCurveDrag(selectedGlyph.points, seg, raw, selectedGlyph.closed);
        updateGlyph(selectedGlyph.id, { points: next });
        setSelectedVertices(new Set());
        setPrimaryVertex(null);
        setSelectedSegment(seg);
        setCurveAdjust({ seg });
        svgRef.current?.setPointerCapture(e.pointerId);
        return;
      }
      const si = findNearestSegment(selectedGlyph.points, raw, selectedGlyph.closed, 16).index;
      if (si >= 0) {
        pushHistory();
        const next = applyCurveDrag(selectedGlyph.points, si, raw, selectedGlyph.closed);
        updateGlyph(selectedGlyph.id, { points: next });
        setSelectedVertices(new Set());
        setPrimaryVertex(null);
        setSelectedSegment(si);
        setCurveAdjust({ seg: si });
        svgRef.current?.setPointerCapture(e.pointerId);
        return;
      }
    }

    // Herramienta Erase: borra el vértice (o el extremo del segmento) más cercano.
    if (tool === 'erase') {
      const vi = findNearestVertex(selectedGlyph.points, raw, 18);
      let toRemove = vi;
      if (vi < 0) {
        const si = findNearestSegment(selectedGlyph.points, raw, selectedGlyph.closed, 16).index;
        if (si >= 0) {
          const seg = getSegment(selectedGlyph.points, si, selectedGlyph.closed);
          const dStart = Math.hypot(seg.start.x - raw.x, seg.start.y - raw.y);
          const dEnd = Math.hypot(seg.end.x - raw.x, seg.end.y - raw.y);
          toRemove = dStart <= dEnd ? seg.startIndex : seg.endIndex;
        }
      }
      if (toRemove >= 0) {
        pushHistory();
        eraseGlyphPoint(selectedGlyph.id, toRemove);
        setSelectedVertices(new Set());
        setPrimaryVertex(null);
        setSelectedSegment(null);
      }
      return;
    }

    // Herramienta Connect: pincha un vértice y luego otro -> crea un segmento
    // soldado a ambos (se mueve con los vértices).
    if (tool === 'connect') {
      if (!connectDraft) {
        const hit = findNearestVertexAcross(glyphs, raw, 18);
        if (hit) setConnectDraft({ anchorGlyphId: hit.glyphId, anchorVertex: hit.vertex });
        setConnectMouse(null);
        return;
      }
      const hit = findNearestVertexAcross(glyphs, raw, 18);
      const same = hit && hit.glyphId === connectDraft.anchorGlyphId && hit.vertex === connectDraft.anchorVertex;
      if (hit && !same) {
        pushHistory();
        const anchorGlyph = glyphs.find((g) => g.id === connectDraft.anchorGlyphId);
        const anchorV = anchorGlyph && anchorGlyph.points[connectDraft.anchorVertex];
        const targetGlyph = glyphs.find((g) => g.id === hit.glyphId);
        const targetV = targetGlyph && targetGlyph.points[hit.vertex];
        if (anchorV && targetV) {
          const id = `g${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
          const lineGlyph: Glyph = {
            id,
            name: `L${glyphs.length + 1}`,
            points: [
              { x: anchorV.x, y: anchorV.y, link: { glyphId: connectDraft.anchorGlyphId, vertex: connectDraft.anchorVertex } },
              { x: targetV.x, y: targetV.y, link: { glyphId: hit.glyphId, vertex: hit.vertex } },
            ],
            closed: false,
            stroke,
            fill,
            strokeWidth,
            texture: null,
            font: useEditorStore.getState().fontName,
          };
          addGlyph(lineGlyph);
          setOpenGlyphs([...new Set([...useEditorStore.getState().openGlyphIds, connectDraft.anchorGlyphId])]);
        }
      }
      setConnectDraft(null);
      setConnectMouse(null);
      return;
    }

    // Herramienta Fill Zone: pinta el contorno (zona) bajo el clic con el fill y texture actuales.
    if (tool === 'fillzone') {
      const sel = selectedGlyph && !selectedGlyph.hidden ? selectedGlyph : null;
      const candidates = sel ? [sel, ...glyphs.filter((g) => g.id !== sel.id && !g.hidden)] : glyphs.filter((g) => !g.hidden);
      for (const g of candidates) {
        const resolved = resolveGlyph(g, glyphs);
        const ci = findContourAtPoint(resolved, raw);
        if (ci >= 0) {
          pushHistory();
          paintContour(g.id, ci);
          setFillzoneHover(null);
          return;
        }
      }
      setFillzoneHover(null);
      return;
    }

    // Herramienta Paint: pinta el segmento bajo el clic con el color de Stroke actual.
    // Si el segmento ya tiene ese color, lo restaura al trazo base (toggle).
    if (tool === 'paint') {
      const sel = selectedGlyph && !selectedGlyph.hidden ? selectedGlyph : null;
      if (sel) {
        const si = findNearestSegment(sel.points, raw, sel.closed, 14).index;
        if (si >= 0) {
          paintSegment(sel.id, si);
          setSelectedSegment(si);
          setSelectedVertices(new Set());
          setPrimaryVertex(null);
          setPaintHover(null);
          return;
        }
      }
      const hit = findNearestSegmentAcross(glyphs, raw, sel ? sel.id : null);
      if (hit) paintSegment(hit.glyphId, hit.seg);
      setPaintHover(null);
      return;
    }

    // Herramienta Select: arrastrar vértices (Ctrl+clic para multi-selección) o marquee (clic en espacio vacío).
    if (tool === 'select') {
      const vi = findNearestVertex(selectedGlyph.points, raw, 14);
      const isCtrl = e.ctrlKey || e.metaKey;
      if (vi >= 0) {
        pushHistory();
        const p0 = selectedGlyph.points[vi];
        if (p0.link) {
          const resolved = resolveGlyph(selectedGlyph, glyphs);
          updateGlyph(selectedGlyph.id, {
            points: selectedGlyph.points.map((p, i) => (i === vi ? { ...resolved.points[vi], link: undefined } : p)),
          });
        }
        if (isCtrl) {
          setSelectedVertices((prev) => {
            const next = new Set(prev);
            if (next.has(vi)) next.delete(vi); else next.add(vi);
            return next;
          });
          setPrimaryVertex(vi);
        } else {
          setSelectedVertices(new Set([vi]));
          setPrimaryVertex(vi);
        }
        setSelectedSegment(null);
        setDragVertices(new Set(selectedVertices.size > 1 && selectedVertices.has(vi) ? selectedVertices : [vi]));
        svgRef.current?.setPointerCapture(e.pointerId);
        return;
      }
      // Clic en un segmento -> lo selecciona (y muestra sus dos manijas amarillas).
      const si = findNearestSegment(selectedGlyph.points, raw, selectedGlyph.closed, 12).index;
      if (si >= 0) {
        setSelectedSegment(si);
        setSelectedVertices(new Set());
        setPrimaryVertex(null);
        return;
      }
      // Clic en espacio vacío -> iniciar marquee (rectángulo de selección).
      if (!isCtrl) {
        setSelectedVertices(new Set());
        setPrimaryVertex(null);
      }
      setSelectedSegment(null);
      setMarquee({ start: raw, current: raw });
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    // Pen: insertar un punto (en un segmento curvo se divide la curva conservando la forma).
    if (tool === 'pen') {
      pushHistory();
      const next = insertPointOnNearestSegment(selectedGlyph.points, pt, selectedGlyph.closed);
      updateGlyph(selectedGlyph.id, { points: next });
      const newVertex = findNearestVertex(next, pt);
      setSelectedVertices(new Set([newVertex]));
      setPrimaryVertex(newVertex);
      setSelectedSegment(null);
      return;
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const raw = handleToPoint(e);
    const snap = snapPoint(raw);

    // Herramienta Fill Zone: resalta el contorno bajo el cursor.
    if (tool === 'fillzone' && (dragVertices === null || dragVertices.size === 0) && dragHandle === null) {
      const sel = selectedGlyph && !selectedGlyph.hidden ? selectedGlyph : null;
      const candidates = sel ? [sel, ...glyphs.filter((g) => g.id !== sel.id && !g.hidden)] : glyphs.filter((g) => !g.hidden);
      for (const g of candidates) {
        const resolved = resolveGlyph(g, glyphs);
        const ci = findContourAtPoint(resolved, raw);
        if (ci >= 0) { setFillzoneHover({ glyphId: g.id, contour: ci }); return; }
      }
      setFillzoneHover(null);
      return;
    }

    // Herramienta Paint: resalta el segmento bajo el cursor (sin arrastre).
    if (tool === 'paint' && (dragVertices === null || dragVertices.size === 0) && dragHandle === null) {
      const sel = selectedGlyph && !selectedGlyph.hidden ? selectedGlyph : null;
      if (sel) {
        const si = findNearestSegment(sel.points, raw, sel.closed, 14).index;
        if (si >= 0) { setPaintHover({ glyphId: sel.id, seg: si }); return; }
      }
      const hit = findNearestSegmentAcross(glyphs, raw, sel ? sel.id : null);
      setPaintHover(hit);
      return;
    }

    // Arrastre de vértices (prioridad máxima, cualquier herramienta que lo inició).
    if (dragVertices !== null && dragVertices.size > 0 && selectedGlyph) {
      const next = selectedGlyph.points.map(clonePoint);
      const n = next.length;
      // Despegar cualquier punto soldado en la selección
      dragVertices.forEach((vi) => {
        if (next[vi] && next[vi].link) {
          next[vi] = { ...next[vi], link: undefined };
        }
      });
      // Usar el vértice principal como referencia para el desplazamiento
      const primaryVi = primaryVertex ?? Array.from(dragVertices)[0];
      const dx = snap.x - next[primaryVi].x;
      const dy = snap.y - next[primaryVi].y;
      // Mover todos los vértices seleccionados (solo la posición; las manijas in/out
      // son offsets RELATIVOS y se mueven solas con el vértice — NO tocarlas).
      dragVertices.forEach((vi) => {
        next[vi].x += dx;
        next[vi].y += dy;
      });
      // Si un vértice seleccionado está conectado a uno NO seleccionado por un
      // segmento curvo, el vértice no seleccionado NO se mueve, así que su manija
      // (in/out) que apunta al seleccionado SÍ debe ajustarse para que el segmento
      // se mueva rígido: la manija del vértice fijo debe seguir al vértice móvil.
      dragVertices.forEach((vi) => {
        // Vértice anterior (su 'out' apunta hacia este vértice seleccionado)
        const prevIdx = selectedGlyph.closed ? (vi - 1 + n) % n : vi - 1;
        if (prevIdx >= 0 && prevIdx < n && !dragVertices.has(prevIdx)) {
          if (next[prevIdx].out) {
            next[prevIdx].out = { x: next[prevIdx].out.x + dx, y: next[prevIdx].out.y + dy };
          }
        }
        // Vértice siguiente (su 'in' viene de este vértice seleccionado)
        const nextIdx = selectedGlyph.closed ? (vi + 1) % n : vi + 1;
        if (nextIdx < n && !dragVertices.has(nextIdx)) {
          if (next[nextIdx].in) {
            next[nextIdx].in = { x: next[nextIdx].in.x + dx, y: next[nextIdx].in.y + dy };
          }
        }
      });
      updateGlyph(selectedGlyph.id, { points: next });
      return;
    }

    // Arrastre de manija (también funciona con la herramienta Curve activa).
    if (dragHandle !== null && selectedGlyph) {
      const next = moveHandle(selectedGlyph.points, dragHandle, raw, selectedGlyph.closed);
      updateGlyph(selectedGlyph.id, { points: next });
      return;
    }

    // Marquee selection: actualizar rectángulo mientras se arrastra (solo en herramienta select).
    if (tool === 'select' && marquee) {
      setMarquee({ ...marquee, current: raw });
      return;
    }

    // Vista previa de la herramienta Connect: guarda la posición del ratón para
    // dibujar la línea discontinua hacia el vértice candidato.
    if (tool === 'connect' && connectDraft) {
      setConnectMouse(raw);
      return;
    }

    // Pincel: mientras se mueve el ratón SIN soltar, el trazo lo sigue en dos líneas
    // (preview) pero NO se crean vértices: solo se actualiza el `currentPoint`
    // (extremo del segmento en curso). Los vértices se fijan al volver a pinchar.
    if (tool === 'brush' && brushDraft) {
      const lastFixed = brushDraft.fixedPoints[brushDraft.fixedPoints.length - 1];
      const dx = raw.x - lastFixed.x;
      const dy = raw.y - lastFixed.y;
      const dist = Math.hypot(dx, dy);
      // Preview: desde el último punto fijo hasta la posición del ratón.
      if (dist > 0.5) {
        const nextPoint = { x: raw.x, y: raw.y };
        const outline = buildBrushOutline([...brushDraft.fixedPoints, nextPoint], brushThickness, brushShape);
        updateGlyph(brushDraft.draftGlyphId, { points: outline, closed: true });
        setBrushDraft({ ...brushDraft, currentPoint: nextPoint });
      } else {
        // Casi encima del punto fijo: muestra solo la tapa de inicio.
        const outline = buildBrushOutline(brushDraft.fixedPoints, brushThickness, brushShape);
        updateGlyph(brushDraft.draftGlyphId, { points: outline, closed: true });
        setBrushDraft({ ...brushDraft, currentPoint: null });
      }
      setBrushMouse({ x: raw.x, y: raw.y });
      return;
    }

    // Herramienta Mano: mover todos los glifos seleccionados.
    if (tool === 'hand' && handDrag) {
      const dx = raw.x - handDrag.startX;
      const dy = raw.y - handDrag.startY;
      const applied = (snapEnabled ? Math.round(dx / gridSize) * gridSize : dx);
      const appliedY = (snapEnabled ? Math.round(dy / gridSize) * gridSize : dy);
      handDrag.glyphs.forEach((entry) => {
        updateGlyph(entry.id, {
          points: entry.points.map((p) => ({ ...p, x: p.x + applied, y: p.y + appliedY })),
        });
      });
      return;
    }

    // Herramienta Scale: el desplazamiento horizontal del ratón define el factor.
    // Izquierda = más pequeño, derecha = más grande (escala uniforme, sin deformar).
    if (tool === 'scale' && scaleDrag) {
      const f = clamp(1 + (raw.x - scaleDrag.startX) / scaleDrag.diag, 0.05, 20);
      scaleDrag.entries.forEach((entry) => {
        if (!entry.points.length) return;
        const exs = entry.points.map((p) => p.x);
        const eys = entry.points.map((p) => p.y);
        const cx = (Math.min(...exs) + Math.max(...exs)) / 2;
        const cy = (Math.min(...eys) + Math.max(...eys)) / 2;
        updateGlyph(entry.id, {
          points: entry.points.map((p) => ({
            ...p,
            x: cx + (p.x - cx) * f,
            y: cy + (p.y - cy) * f,
            in: p.in ? { x: p.in.x * f, y: p.in.y * f } : undefined,
            out: p.out ? { x: p.out.x * f, y: p.out.y * f } : undefined,
          })),
        });
      });
      return;
    }

    // Herramienta Rect: preview mientras se arrastra (se crea al soltar).
    if (tool === 'rect' && rectDraft) {
      setRectMouse(snap);
      return;
    }

    // Herramienta Círculo: preview mientras se arrastra (se crea al soltar).
    if (tool === 'circle' && circleDraft) {
      setCircleMouse(snap);
      return;
    }

    // Herramienta Curve: mientras se arrastra, abre/cierra la curva del segmento.
    if (tool === 'curve' && curveAdjust && selectedGlyph) {
      const next = applyCurveDrag(selectedGlyph.points, curveAdjust.seg, raw, selectedGlyph.closed);
      updateGlyph(selectedGlyph.id, { points: next });
      return;
    }

    // Preview de la línea en curso (herramienta Line): el extremo se pega al vértice
    // más cercano del objeto si pasas cerca.
    if (tool === 'line' && lineDraft) {
      const draftGlyph = glyphs.find((g) => g.id === lineDraft.glyphId);
      const target = glyphs.find((g) => g.id === lineDraft.targetId);
      if (draftGlyph && target) {
        const nearest = findNearestVertex(target.points, snap, 22);
        const endPt = nearest >= 0 ? target.points[nearest] : snap;
        updateGlyph(draftGlyph.id, {
          points: [{ ...draftGlyph.points[0] }, { ...endPt }],
        });
      }
      return;
    }
  };

  const handlePointerUp = () => {
    // Herramienta Rect: al soltar se crea el rectángulo (si tiene tamaño mínimo).
    if (tool === 'rect' && rectDraft && rectMouse) {
      const dx = rectMouse.x - rectDraft.x0;
      const dy = rectMouse.y - rectDraft.y0;
      if (Math.abs(dx) >= Math.max(4, gridSize / 2) && Math.abs(dy) >= Math.max(4, gridSize / 2)) {
        pushHistory();
        const id = `g${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
        const minX = Math.min(rectDraft.x0, rectMouse.x);
        const maxX = Math.max(rectDraft.x0, rectMouse.x);
        const minY = Math.min(rectDraft.y0, rectMouse.y);
        const maxY = Math.max(rectDraft.y0, rectMouse.y);
        const rectGlyph: Glyph = {
          id,
          name: `R${glyphs.length + 1}`,
          points: [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY },
          ],
          closed: true,
          stroke,
          fill,
          strokeWidth,
          texture: null,
          font: useEditorStore.getState().fontName,
        };
        addGlyph(rectGlyph);
        selectGlyph(id, false);
        setOpenGlyphs([...new Set([...openGlyphIds, id])]);
      }
      setRectDraft(null);
      setRectMouse(null);
    }
    // Herramienta Círculo: al soltar se crea el círculo (si tiene radio mínimo).
    if (tool === 'circle' && circleDraft && circleMouse) {
      const dx = circleMouse.x - circleDraft.x0;
      const dy = circleMouse.y - circleDraft.y0;
      const r = Math.max(Math.abs(dx), Math.abs(dy));
      if (r >= Math.max(4, gridSize / 2)) {
        pushHistory();
        const id = `g${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
        const N = 24;
        const pts: Point[] = [];
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2;
          pts.push({ x: circleDraft.x0 + Math.cos(a) * r, y: circleDraft.y0 + Math.sin(a) * r });
        }
        const circleGlyph: Glyph = {
          id,
          name: `C${glyphs.length + 1}`,
          points: pts,
          closed: true,
          stroke,
          fill,
          strokeWidth,
          texture: null,
          font: useEditorStore.getState().fontName,
        };
        addGlyph(circleGlyph);
        selectGlyph(id, false);
        setOpenGlyphs([...new Set([...openGlyphIds, id])]);
      }
      setCircleDraft(null);
      setCircleMouse(null);
    }
    // Finalizar marquee: seleccionar vértices dentro del rectángulo.
    if (tool === 'select' && marquee) {
      const { start, current } = marquee;
      const minX = Math.min(start.x, current.x);
      const maxX = Math.max(start.x, current.x);
      const minY = Math.min(start.y, current.y);
      const maxY = Math.max(start.y, current.y);
      const inside: number[] = [];
      selectedGlyph?.points.forEach((p, i) => {
        if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
          inside.push(i);
        }
      });
      if (inside.length > 0) {
        const isCtrl = false; // Marquee siempre añade/reemplaza, no es toggle individual
        setSelectedVertices(new Set(inside));
        setPrimaryVertex(inside[inside.length - 1]);
      }
      setMarquee(null);
    }
    setDragVertices(null);
    setDragHandle(null);
    setCurveAdjust(null);
    setHandDrag(null);
    setScaleDrag(null);
    // El pincel NO se limpia al soltar: el contorno en curso (preview) se
    // conserva para que el siguiente clic fije el punto actual y continúe el
    // trazo. Se limpia al cambiar de herramienta (useEffect) o al volver a
    // pinchar en el mismo glifo (se fija el punto actual).
    setBrushMouse(null);
  };

  const handleDoubleClick = () => {
    if (tool === 'rect' || tool === 'circle') return;
    if (tool === 'connect') {
      setConnectDraft(null);
      setConnectMouse(null);
      return;
    }
    if (!selectedGlyph || selectedGlyph.points.length < 2) return;
    pushHistory();
    updateGlyph(selectedGlyph.id, { closed: !selectedGlyph.closed });
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-950 overflow-auto scrollbar-thin-transparent">
      {openGlyphIds.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 px-4 py-2 bg-gray-950/85 backdrop-blur border-b border-green-900/50">
          <span className="px-2 py-1 rounded-md bg-black/60 text-[10px] text-gray-300 border border-green-900/50">
            {t('editorFuentes.canvasShowing', { shown: displayGlyphs.length, total: visibleGlyphs.length })}
          </span>
          {openGlyphIds.length < visibleGlyphs.length && (
            <button
              onClick={() => setOpenGlyphs(visibleGlyphs.map((g) => g.id))}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs shadow"
              title={t('editorFuentes.showAllTitle')}
            >
              <Eye className="w-3.5 h-3.5" /> {t('editorFuentes.showAll', { count: visibleGlyphs.length })}
            </button>
          )}
          {selectedGlyphIds.length > 0 && (
            <button
              onClick={() => setOpenGlyphs(selectedGlyphIds)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs shadow"
              title={t('editorFuentes.showSelTitle')}
            >
              {t('editorFuentes.showSel', { count: selectedGlyphIds.length })}
            </button>
          )}
        </div>
      )}
      <div className="flex-1 p-4">
        <div className="relative w-full h-full">
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          preserveAspectRatio="xMidYMid meet"
          className={cn('bg-gray-900 border border-green-900/50 select-none', tool === 'scale' && 'cursor-ew-resize', (tool === 'connect' || tool === 'paint' || tool === 'rect' || tool === 'circle' || tool === 'fillzone' || tool === 'brush') && 'cursor-crosshair')}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center', touchAction: 'none' }}
        >
          <defs>
            <pattern id="smallGrid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
              <path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="#2d2d2d" strokeWidth="0.5" />
            </pattern>
            <pattern id="grid" width={gridSize * 5} height={gridSize * 5} patternUnits="userSpaceOnUse">
              <rect width={gridSize * 5} height={gridSize * 5} fill="url(#smallGrid)" />
              <path d={`M ${gridSize * 5} 0 L 0 0 0 ${gridSize * 5}`} fill="none" stroke="#444" strokeWidth="1" />
            </pattern>
            {displayGlyphs.flatMap((g) => {
              const contours = splitContours(g.points, g.closed);
              const items: ReactNode[] = [];
              for (let ci = 0; ci < contours.length; ci++) {
                const cf = g.contourFills?.[ci];
                const tex = cf ? cf.texture : g.texture;
                const fillC = cf ? cf.fill : g.fill;
                if (!tex) continue;
                items.push(
                  <pattern key={`${g.id}-${ci}`} id={`texture-${g.id}-${ci}`} patternUnits="userSpaceOnUse" width="10" height="10">
                    {tex === 'dots' && <circle cx="2" cy="2" r="1.5" fill={fillC} />}
                    {tex === 'lines' && <line x1="0" y1="0" x2="10" y2="10" stroke={fillC} strokeWidth="1" />}
                    {tex === 'checker' && (
                      <>
                        <rect width="5" height="5" fill={fillC} />
                        <rect x="5" y="5" width="5" height="5" fill={fillC} />
                      </>
                    )}
                  </pattern>
                );
              }
              return items;
            })}
          </defs>

          {gridEnabled && <rect width={CANVAS_W} height={CANVAS_H} fill="url(#grid)" />}

          {/* Guías tipográficas del em (1000 UPM) calibradas 1:1 con las unidades de
              la fuente. Y del lienzo = 1000 - unidades de la fuente:
              ascender 800 -> y=200 · cap height 540 -> y=460 · x-height 400 -> y=600
              línea base 0 -> y=1000 · descender -200 -> y=1200.
              Lo que dibujes apoyado en estas guías sale EXACTAMENTE con ese tamaño
              en el TTF (sin redimensionar). */}
          <g className="pointer-events-none">
            {/* Perímetro del em y zona útil (ascender -> descender) */}
            <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="none" stroke="#22c55e" strokeOpacity={0.3} strokeWidth={1} />
            <rect x={0} y={GUIDE_ASCENDER_Y} width={CANVAS_W} height={GUIDE_DESCENDER_Y - GUIDE_ASCENDER_Y} fill="#22c55e" fillOpacity={0.05} />

            {/* Em top 1000 */}
            <line x1={0} y1={1} x2={CANVAS_W} y2={1} stroke="#22c55e" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="4 8" />
            <text x={8} y={22} fill="#4ade80" fontSize={13} fontWeight={600} stroke="#0b1220" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">Em top 1000</text>

            {/* Ascender 800 */}
            <line x1={0} y1={GUIDE_ASCENDER_Y} x2={CANVAS_W} y2={GUIDE_ASCENDER_Y} stroke="#22c55e" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="10 6" />
            <text x={8} y={GUIDE_ASCENDER_Y + 18} fill="#4ade80" fontSize={13} fontWeight={600} stroke="#0b1220" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">Ascender 800</text>

            {/* Cap height 540 — tope de las mayúsculas */}
            <line x1={0} y1={GUIDE_CAP_HEIGHT_Y} x2={CANVAS_W} y2={GUIDE_CAP_HEIGHT_Y} stroke="#4ade80" strokeOpacity={0.8} strokeWidth={2} strokeDasharray="12 6" />
            <text x={8} y={GUIDE_CAP_HEIGHT_Y + 18} fill="#4ade80" fontSize={13} fontWeight={700} stroke="#0b1220" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">{t('editorFuentes.metrics.capHeight')} 540</text>

            {/* x-height 400 */}
            <line x1={0} y1={GUIDE_X_HEIGHT_Y} x2={CANVAS_W} y2={GUIDE_X_HEIGHT_Y} stroke="#22c55e" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="6 8" />
            <text x={8} y={GUIDE_X_HEIGHT_Y + 18} fill="#4ade80" fontSize={13} fontWeight={600} stroke="#0b1220" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">{t('editorFuentes.metrics.xHeight')} 400</text>

            {/* Línea base (y=0) — la más destacada */}
            <line x1={0} y1={CANVAS_BASELINE_Y} x2={CANVAS_W} y2={CANVAS_BASELINE_Y} stroke="#4ade80" strokeOpacity={0.95} strokeWidth={2.5} />
            <text x={8} y={CANVAS_BASELINE_Y + 18} fill="#4ade80" fontSize={13} fontWeight={800} stroke="#0b1220" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">Línea base (y=0)</text>

            {/* Descender -200 */}
            <line x1={0} y1={GUIDE_DESCENDER_Y} x2={CANVAS_W} y2={GUIDE_DESCENDER_Y} stroke="#22c55e" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="10 6" />
            <text x={8} y={GUIDE_DESCENDER_Y + 18} fill="#4ade80" fontSize={13} fontWeight={600} stroke="#0b1220" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">Descender -200</text>
          </g>

{/* Guía personalizada ajustable: arrástrala en el lienzo (ámbar punteada).
              Su valor (unidades de fuente) se guarda con el proyecto JSON. */}
            {customGuideVisible && (
              <g
                className="cursor-ns-resize"
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setGuideDrag(true);
                  svgRef.current?.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (!guideDrag) return;
                  const p = svgPointFromEvent(e);
                  setCustomGuide(clamp(Math.round(FONT_UNITS - p.y), 0, 1000));
                }}
                onPointerUp={() => setGuideDrag(false)}
                onPointerCancel={() => setGuideDrag(false)}
              >
                <line x1={0} y1={FONT_UNITS - customGuideUnits} x2={CANVAS_W} y2={FONT_UNITS - customGuideUnits} stroke="#fbbf24" strokeOpacity={guideDrag ? 1 : 0.85} strokeWidth={guideDrag ? 3 : 2} strokeDasharray="3 5" />
                {/* Línea de captura invisible y ancha: hace fácil agarrar la guía. */}
                <line x1={0} y1={FONT_UNITS - customGuideUnits} x2={CANVAS_W} y2={FONT_UNITS - customGuideUnits} stroke="transparent" strokeWidth={26} style={{ pointerEvents: 'stroke' }} />
                <circle cx={CANVAS_W - 150} cy={FONT_UNITS - customGuideUnits} r={5} fill="#fbbf24" stroke="#0b1220" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
                <text x={CANVAS_W - 300} y={Math.max(16, FONT_UNITS - customGuideUnits - 10)} fill="#fbbf24" fontSize={13} fontWeight={700} stroke="#0b1220" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
                  Guía {customGuideUnits} uds
                </text>
              </g>
            )}

          {displayGlyphs.map((rawG) => {
            const g = resolveGlyph(rawG, glyphs);
            const contours = splitContours(g.points, g.closed);
            const selected = selectedGlyphIds.includes(g.id);
            const isPrimary = g.id === selectedGlyphId;
            const isBrushDraft = brushDraft && g.id === brushDraft.draftGlyphId;
            const n = g.points.length;
            return (
              <g key={g.id}>
                {contours.map((c, ci) => {
                  const contourD = buildContourPath(g.points, ci, g.closed);
                  const cf = g.contourFills?.[ci];
                  const contourFill = cf ? cf.fill : g.fill;
                  const contourTexture = cf ? cf.texture : g.texture;
                  const showFill = selected;
                  const fillVal = showFill ? (contourTexture ? `url(#texture-${g.id}-${ci})` : contourFill) : 'none';
                  return (
                    <path
                      key={`ct-${ci}`}
                      d={contourD}
                      fill={isBrushDraft ? 'none' : fillVal}
                      stroke={isBrushDraft ? '#fbbf24' : g.stroke}
                      strokeWidth={isBrushDraft ? brushThickness : g.strokeWidth}
                      strokeDasharray={isBrushDraft ? '3 3' : undefined}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      className="pointer-events-none"
                    />
                  );
                })}

                {/* Segmentos con color propio (herramienta Paint): se dibujan encima del trazo base. */}
                {g.points.map((p, i) => {
                  if (!p.segStroke) return null;
                  const dSeg = buildSegmentPath(g.points, i, g.closed);
                  if (!dSeg) return null;
                  return (
                    <path
                      key={`segcol-${i}`}
                      d={dSeg}
                      fill="none"
                      stroke={p.segStroke}
                      strokeWidth={g.strokeWidth}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      className="pointer-events-none"
                    />
                  );
                })}

                {/* Vértices: visibles en todos los seleccionados, arrastrables solo en el primario.
                    Los puntos soldados internamente (mismo glifo, tras Unir) coinciden con su
                    vértice objetivo: NO se dibujan para que el clic llegue al vértice real y la
                    línea unida se mueva con él. Los soldados externos solo se dibujan en el
                    glifo primario (para poder agarrarlos y despegarlos). */}
                {selected && g.points.map((p, i) => {
                  if (p.link && (p.link.glyphId === g.id || !isPrimary)) return null;
                  const isSelected = selectedVertices.has(i);
                  return (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={Math.max(2, vertexSize * (gridSize / DEFAULT_GRID_SIZE))}
                      fill={isSelected && isPrimary ? '#4ade80' : '#111'}
                      stroke={isPrimary ? '#22c55e' : '#4ade80'}
                      strokeWidth={Math.max(1, (vertexSize / 3) * (gridSize / DEFAULT_GRID_SIZE))}
                      className={cn('cursor-move', (tool !== 'select' || !isPrimary) && 'pointer-events-none')}
                      onPointerDown={tool === 'select' && isPrimary ? (e) => {
                        e.stopPropagation();
                        svgRef.current?.setPointerCapture(e.pointerId);
                        if (p.link) {
                          const resolved = resolveGlyph(g, glyphs);
                          updateGlyph(g.id, {
                            points: g.points.map((q, qi) => (qi === i ? { ...resolved.points[i], link: undefined } : q)),
                          });
                        }
                        const isCtrl = e.ctrlKey || e.metaKey;
                        if (isCtrl) {
                          setSelectedVertices((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i); else next.add(i);
                            return next;
                          });
                          setPrimaryVertex(i);
                        } else {
                          setSelectedVertices(new Set([i]));
                          setPrimaryVertex(i);
                        }
                        setSelectedSegment(null);
                        const verticesToDrag = isCtrl && selectedVertices.has(i) ? selectedVertices : new Set([i]);
                        setDragVertices(verticesToDrag);
                      } : undefined}
                      onClick={tool === 'select' && isPrimary ? (e) => e.stopPropagation() : undefined}
                    />
                  );
                })}

                {/* Manijas del vértice principal (solo las reales, solo primario) */}
                {isPrimary && primaryVertex !== null && g.points[primaryVertex] && (() => {
                  const v = g.points[primaryVertex];
                  return (
                    <>
                      {v.out && (
                        <>
                          <line x1={v.x} y1={v.y} x2={v.x + v.out.x} y2={v.y + v.out.y} stroke="#fbbf24" strokeWidth={1.5} className="pointer-events-none" />
                          <HandleGrip
                            x={v.x + v.out.x}
                            y={v.y + v.out.y}
                            active={tool === 'select' || tool === 'curve'}
                            onDragStart={() => {
                              pushHistory();
                              setDragHandle({ vertex: primaryVertex, kind: 'out' });
                            }}
                          />
                        </>
                      )}
                      {v.in && (
                        <>
                          <line x1={v.x} y1={v.y} x2={v.x + v.in.x} y2={v.y + v.in.y} stroke="#fbbf24" strokeWidth={1.5} className="pointer-events-none" />
                          <HandleGrip
                            x={v.x + v.in.x}
                            y={v.y + v.in.y}
                            active={tool === 'select' || tool === 'curve'}
                            onDragStart={() => {
                              pushHistory();
                              setDragHandle({ vertex: primaryVertex, kind: 'in' });
                            }}
                          />
                        </>
                      )}
                    </>
                  );
                })()}

                {/* Segmento seleccionado: resaltado + DOS manijas (una a cada lado) */}
                {isPrimary && selectedSegment !== null && (() => {
                  const { start, end, startIndex, endIndex } = getSegment(g.points, selectedSegment, g.closed);
                  const hasCurve = !!(start.out || end.in);
                  const h1 = start.out
                    ? { x: start.x + start.out.x, y: start.y + start.out.y }
                    : lerpPoint(start, end, 1 / 3);
                  const h2 = end.in
                    ? { x: end.x + end.in.x, y: end.y + end.in.y }
                    : lerpPoint(start, end, 2 / 3);
                  return (
                    <>
                      <path
                        d={buildPath([start, end], false)}
                        fill="none"
                        stroke="#4ade80"
                        strokeWidth={2}
                        strokeDasharray={hasCurve ? undefined : '4 4'}
                        className="pointer-events-none"
                      />
                      <line x1={start.x} y1={start.y} x2={h1.x} y2={h1.y} stroke="#fbbf24" strokeWidth={1.5} className="pointer-events-none" />
                      <line x1={end.x} y1={end.y} x2={h2.x} y2={h2.y} stroke="#fbbf24" strokeWidth={1.5} className="pointer-events-none" />
                      <HandleGrip
                        x={h1.x}
                        y={h1.y}
                        active={tool === 'select' || tool === 'curve'}
                        onDragStart={() => {
                          pushHistory();
                          setSelectedSegment(startIndex);
                          setDragHandle({ vertex: startIndex, kind: 'out' });
                        }}
                      />
                      <HandleGrip
                        x={h2.x}
                        y={h2.y}
                        active={tool === 'select' || tool === 'curve'}
                        onDragStart={() => {
                          pushHistory();
                          setSelectedSegment(g.closed ? (endIndex - 1 + g.points.length) % g.points.length : endIndex - 1);
                          setDragHandle({ vertex: endIndex, kind: 'in' });
                        }}
                      />
                    </>
                  );
                })()}
              </g>
            );
          })}

          {/* Herramienta Paint: resaltado del segmento bajo el cursor */}
          {paintHover && (() => {
            const gg = glyphs.find((x) => x.id === paintHover.glyphId);
            const rg = gg ? resolveGlyph(gg, glyphs) : null;
            const dHov = rg ? buildSegmentPath(rg.points, paintHover.seg, rg.closed) : '';
            if (!dHov) return null;
            return (
              <path d={dHov} fill="none" stroke="#4ade80" strokeWidth={(rg?.strokeWidth ?? 4) + 3} strokeOpacity={0.45} strokeDasharray="6 4" strokeLinecap="round" className="pointer-events-none" />
            );
          })()}
          {/* Herramienta Fill Zone: resaltado del contorno bajo el cursor */}
          {fillzoneHover && (() => {
            const gg = glyphs.find((x) => x.id === fillzoneHover.glyphId);
            const rg = gg ? resolveGlyph(gg, glyphs) : null;
            if (!rg) return null;
            const dHov = buildContourPath(rg.points, fillzoneHover.contour, rg.closed);
            if (!dHov) return null;
            return (
              <path d={dHov} fill="#4ade80" fillOpacity={0.25} stroke="#4ade80" strokeWidth={(rg.strokeWidth ?? 4) + 2} strokeOpacity={0.6} strokeDasharray="6 4" className="pointer-events-none" />
            );
          })()}
          {/* Herramienta Fill Zone: resaltado del contorno bajo el cursor */}
          {fillzoneHover && (() => {
            const gg = glyphs.find((x) => x.id === fillzoneHover.glyphId);
            const rg = gg ? resolveGlyph(gg, glyphs) : null;
            if (!rg) return null;
            const dHov = buildContourPath(rg.points, fillzoneHover.contour, rg.closed);
            if (!dHov) return null;
            return (
              <path d={dHov} fill="#4ade80" fillOpacity={0.25} stroke="#4ade80" strokeWidth={(rg.strokeWidth ?? 4) + 2} strokeOpacity={0.6} strokeDasharray="6 4" className="pointer-events-none" />
            );
          })()}
          {/* Herramienta Connect: ancla resaltada + línea discontinua hacia el ratón */}
          {tool === 'connect' && connectDraft && (() => {
            const ag = glyphs.find((g) => g.id === connectDraft.anchorGlyphId);
            const av = ag ? resolveGlyph(ag, glyphs).points[connectDraft.anchorVertex] : null;
            if (!av) return null;
            const hit = connectMouse ? findNearestVertexAcross(glyphs, connectMouse, 18) : null;
            const hv = hit ? glyphs.find((g) => g.id === hit.glyphId)?.points[hit.vertex] : null;
            return (
              <g className="pointer-events-none">
                <circle cx={av.x} cy={av.y} r={Math.max(10, vertexSize * 2)} fill="none" stroke="#22c55e" strokeWidth={2} strokeDasharray="4 3" />
                {connectMouse && (
                  <>
                    <line x1={av.x} y1={av.y} x2={connectMouse.x} y2={connectMouse.y} stroke="#22c55e" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.8} />
                    {hv && (
                      <>
                        <circle cx={hv.x} cy={hv.y} r={Math.max(8, vertexSize * 1.6)} fill="none" stroke="#4ade80" strokeWidth={2} />
                        <circle cx={hv.x} cy={hv.y} r={2.5} fill="#4ade80" />
                      </>
                    )}
                  </>
                )}
              </g>
            );
          })()}
          {/* Herramienta Rect: preview del rectángulo en curso */}
          {tool === 'rect' && rectDraft && rectMouse && (
            <rect
              x={Math.min(rectDraft.x0, rectMouse.x)}
              y={Math.min(rectDraft.y0, rectMouse.y)}
              width={Math.abs(rectMouse.x - rectDraft.x0)}
              height={Math.abs(rectMouse.y - rectDraft.y0)}
              fill="none"
              stroke="#22c55e"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              className="pointer-events-none"
            />
          )}
          {/* Herramienta Círculo: preview del círculo en curso */}
          {tool === 'circle' && circleDraft && circleMouse && (
            <circle
              cx={circleDraft.x0}
              cy={circleDraft.y0}
              r={Math.max(Math.abs(circleMouse.x - circleDraft.x0), Math.abs(circleMouse.y - circleDraft.y0))}
              fill="none"
              stroke="#22c55e"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              className="pointer-events-none"
            />
          )}
          {/* Marquee selection: rectángulo discontinuo mientras se arrastra en herramienta Select */}
          {tool === 'select' && marquee && (
            <rect
              x={Math.min(marquee.start.x, marquee.current.x)}
              y={Math.min(marquee.start.y, marquee.current.y)}
              width={Math.abs(marquee.current.x - marquee.start.x)}
              height={Math.abs(marquee.current.y - marquee.start.y)}
              fill="rgba(34, 197, 94, 0.1)"
              stroke="#22c55e"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              className="pointer-events-none"
            />
          )}
        </svg>
        </div>
      </div>
    </div>
  );
}

function PropertiesPanel() {
  const { t } = useI18n();
  const glyphs = useEditorStore((s) => s.glyphs);
  const selectedGlyphId = useEditorStore((s) => s.selectedGlyphId);
  const selectedGlyphIds = useEditorStore((s) => s.selectedGlyphIds);
  const vertexSize = useEditorStore((s) => s.vertexSize);
  const setVertexSize = useEditorStore((s) => s.setVertexSize);
  const updateGlyph = useEditorStore((s) => s.updateGlyph);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const scaleGlyphs = useEditorStore((s) => s.scaleGlyphs);
  const alignToBaseline = useEditorStore((s) => s.alignToBaseline);
  const clearSegmentColors = useEditorStore((s) => s.clearSegmentColors);
  const clearContourFills = useEditorStore((s) => s.clearContourFills);
  const customGuideUnits = useEditorStore((s) => s.customGuideUnits);
  const customGuideVisible = useEditorStore((s) => s.customGuideVisible);
  const setCustomGuide = useEditorStore((s) => s.setCustomGuide);
  const setCustomGuideVisible = useEditorStore((s) => s.setCustomGuideVisible);
  const brushShape = useEditorStore((s) => s.brushShape);
  const brushThickness = useEditorStore((s) => s.brushThickness);
  const setBrushShape = useEditorStore((s) => s.setBrushShape);
  const setBrushThickness = useEditorStore((s) => s.setBrushThickness);
  const tool = useEditorStore((s) => s.tool);
  const g = glyphs.find((x) => x.id === selectedGlyphId);
  // Escala del glifo actual en % (100 = tamaño original). Se reajusta al cambiar
  // de glifo para que el campo muestre el tamaño relativo al original.
  const [scalePct, setScalePct] = useState(100);
  useEffect(() => { setScalePct(100); }, [g && g.id]);
  if (!g) return null;

  const handleNameChange = (name: string) => {
    pushHistory();
    updateGlyph(g.id, { name });
  };

  const curvedSegments = g.points.reduce((acc, p, i) => {
    if (!g.closed && i === g.points.length - 1) return acc;
    const end = g.points[(i + 1) % g.points.length];
    return acc + (p.out || end.in ? 1 : 0);
  }, 0);

  return (
    <div className="w-60 p-4 bg-gray-800/80 border-l border-green-900/50">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('editorFuentes.props.properties')}</h3>
      <div className="text-xs text-gray-500 mb-3">
        {selectedGlyphIds.length > 1
          ? t('editorFuentes.selCount', { n: selectedGlyphIds.length })
          : t('editorFuentes.selCountOne')}
      </div>
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('editorFuentes.props.glyphName')}</label>
          <input
            type="text"
            value={g.name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            {t('editorFuentes.pointsCurved', { points: g.points.length, curved: curvedSegments })}
          </label>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('editorFuentes.props.closedPath')}</label>
          <button
            onClick={() => {
              pushHistory();
              updateGlyph(g.id, { closed: !g.closed });
            }}
            className={cn('w-full px-3 py-1.5 rounded text-sm', g.closed ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300')}
          >
            {g.closed ? t('editorFuentes.props.yes') : t('editorFuentes.props.no')}
          </button>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('editorFuentes.props.curves')}</label>
          <button
            onClick={() => {
              pushHistory();
              updateGlyph(g.id, { points: g.points.map((p) => ({
                x: p.x,
                y: p.y,
                ...(p.break ? { break: true } : {}),
                ...(p.closePrev ? { closePrev: true } : {}),
                ...(p.segStroke ? { segStroke: p.segStroke } : {}),
              })) });
            }}
            className="w-full px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-300"
          >
            {t('editorFuentes.clearCurves')}
          </button>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            {t('editorFuentes.segColors', { n: countColoredSegments(g) })}
          </label>
          <button
            onClick={() => { if (!countColoredSegments(g)) return; pushHistory(); clearSegmentColors(g.id); }}
            disabled={!countColoredSegments(g)}
            className={cn('w-full px-3 py-1.5 rounded text-sm', countColoredSegments(g) ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-800 text-gray-600 cursor-not-allowed')}
          >
            {t('editorFuentes.clearSegColors')}
          </button>
          <p className="text-[10px] text-gray-500 mt-1">{t('editorFuentes.paintHelp')}</p>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            {t('editorFuentes.zoneFills', { n: countContourFills(g) })}
          </label>
          <button
            onClick={() => { if (!countContourFills(g)) return; pushHistory(); clearContourFills(g.id); }}
            disabled={!countContourFills(g)}
            className={cn('w-full px-3 py-1.5 rounded text-sm', countContourFills(g) ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-800 text-gray-600 cursor-not-allowed')}
          >
            {t('editorFuentes.clearZoneFills')}
          </button>
          <p className="text-[10px] text-gray-500 mt-1">{t('editorFuentes.fillZoneHelp')}</p>
        </div>
        <div>
          
          <label className="block text-xs text-gray-400 mb-1">
            {t('editorFuentes.vertexSize', { size: vertexSize })}
          </label>
          <div className="flex items-center gap-2">
            <Slider
              min={2}
              max={20}
              step={1}
              value={[vertexSize]}
              onValueChange={([v]) => setVertexSize(clamp(v || 6, 2, 20))}
              className="flex-1"
            />
            <input
              type="number"
              min="2"
              max="20"
              value={vertexSize}
              onChange={(e) => setVertexSize(clamp(parseInt(e.target.value) || 6, 2, 20))}
              className="w-14 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
            />
          </div>
          <p className="text-[10px] text-gray-500 mt-1">{t('editorFuentes.vertexSizeHelp')}</p>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            {t('editorFuentes.glyphScale', { pct: scalePct })}
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { pushHistory(); scaleGlyphs(selectedGlyphIds, 0.8); setScalePct(Math.max(10, Math.round(scalePct * 0.8))); }}
              className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm"
              title={t('editorFuentes.scaleDown')}
            >−</button>
            <Slider
              min={10}
              max={300}
              step={1}
              value={[scalePct]}
              onPointerDown={() => pushHistory()}
              onValueChange={([v]) => {
                const val = clamp(v || 100, 10, 300);
                scaleGlyphs(selectedGlyphIds, val / scalePct);
                setScalePct(val);
              }}
              className="flex-1"
            />
            <button
              onClick={() => { pushHistory(); scaleGlyphs(selectedGlyphIds, 1.25); setScalePct(Math.min(300, Math.round(scalePct * 1.25))); }}
              className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm"
              title={t('editorFuentes.scaleUp')}
            >+</button>
          </div>
          <input
            type="number"
            min="10"
            max="300"
            value={scalePct}
            onFocus={() => pushHistory()}
            onChange={(e) => {
              const v = clamp(parseInt(e.target.value) || 100, 10, 300);
              scaleGlyphs(selectedGlyphIds, v / scalePct);
              setScalePct(v);
            }}
            className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
          />
          <p className="text-[10px] text-gray-500 mt-1">{t('editorFuentes.scaleHelp')}</p>
          <button
            onClick={() => { pushHistory(); alignToBaseline(selectedGlyphIds); }}
            disabled={!selectedGlyphIds.length}
            className="w-full mt-2 px-3 py-1.5 rounded bg-green-700 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm"
            title={t('editorFuentes.baselineTitle')}
          >
            {t('editorFuentes.baseline')}
          </button>
        </div>
        <div>
          <label className="flex items-center gap-2 text-xs text-gray-400 mb-1 cursor-pointer">
            <input
              type="checkbox"
              checked={customGuideVisible}
              onChange={(e) => setCustomGuideVisible(e.target.checked)}
              className="accent-amber-500"
            />
            {t('editorFuentes.customGuide', { units: customGuideUnits })}
          </label>
          <Slider
            min={0}
            max={1000}
            step={1}
            value={[customGuideUnits]}
            onValueChange={([v]) => setCustomGuide(clamp(v || 540, 0, 1000))}
            className="w-full"
            disabled={!customGuideVisible}
          />
          <div className="flex items-center gap-2 mt-1">
            <input
              type="number"
              min="0"
              max="1000"
              value={customGuideUnits}
              onChange={(e) => setCustomGuide(clamp(parseInt(e.target.value) || 540, 0, 1000))}
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
              disabled={!customGuideVisible}
            />
            <button
              onClick={() => setCustomGuide(GUIDE_CUSTOM_DEFAULT_UNITS)}
              className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm"
              title={t('editorFuentes.guideResetTitle')}
              disabled={!customGuideVisible}
            >{t('editorFuentes.reset')}</button>
          </div>
        </div>
       
      </div>
    </div>
  );
}

// Galería de letras: cada glifo se muestra en su propio contenedor con una vista
// previa SVG (ajustada a su bounding box) y su nombre en la esquina. Al pinchar
// una letra se selecciona y se abre en el editor en el lienzo.
function GlyphGallery() {
  const { t } = useI18n();
  const glyphs = useEditorStore((s) => s.glyphs);
  const fontName = useEditorStore((s) => s.fontName);
  const galleryFontFilter = useEditorStore((s) => s.galleryFontFilter);
  const setGalleryFontFilter = useEditorStore((s) => s.setGalleryFontFilter);
  const selectedGlyphIds = useEditorStore((s) => s.selectedGlyphIds);
  const selectGlyph = useEditorStore((s) => s.selectGlyph);
  const setOpenGlyphs = useEditorStore((s) => s.setOpenGlyphs);
  const toggleOpenGlyph = useEditorStore((s) => s.toggleOpenGlyph);
  const setView = useEditorStore((s) => s.setView);

  const allFonts = Array.from(new Set(glyphs.map((g) => (g.font || fontName).trim()).filter(Boolean)));
  const visible = galleryFontFilter ? glyphs.filter((g) => (g.font || fontName) === galleryFontFilter) : glyphs;

  const openInEditor = (id: string, additive: boolean) => {
    selectGlyph(id, additive);
    if (additive) {
      // Ctrl+clic: abre/cierra esta letra sin tocar las ya abiertas (varias a la vez).
      toggleOpenGlyph(id);
    } else {
      // Clic normal: abre SOLO esta letra en el lienzo.
      setOpenGlyphs([id]);
    }
    setView('edit');
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-gray-100">
              {t('editorFuentes.galleryTitle', { count: visible.length })}
              <span className="ml-2 text-xs font-normal text-gray-400">{t('editorFuentes.fontLabel')} <b className="text-green-400">{fontName}</b></span>
            </h2>
            {allFonts.length > 1 && (
              <select
                value={galleryFontFilter ?? ''}
                onChange={(e) => setGalleryFontFilter(e.target.value || null)}
                className="bg-gray-800 border border-green-900/50 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-green-500"
              >
                <option value="">{t('editorFuentes.allFonts')}</option>
                {allFonts.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            )}
          </div>
          <button
            onClick={() => setView('edit')}
            className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm"
          >
            {t('editorFuentes.viewEditor')}
          </button>
        </div>
        {visible.length === 0 ? (
          <div className="text-center text-gray-500 py-20">
            {glyphs.length === 0 ? t('editorFuentes.galleryEmpty') : t('editorFuentes.galleryEmptyFilter')}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {visible.map((rawG) => {
              const g = resolveGlyph(rawG, glyphs);
              const bbox = getGlyphBBox(g.points);
              const pad = 24;
              const vb = bbox
                ? `${bbox.minX - pad} ${bbox.minY - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`
                : `0 0 ${CANVAS_W} ${CANVAS_H}`;
              const contours = splitContours(g.points, g.closed);
              const isSelected = selectedGlyphIds.includes(g.id);
              return (
                <button
                  key={g.id}
                  onClick={(e) => openInEditor(g.id, e.ctrlKey || e.metaKey)}
                  title={t('editorFuentes.openGlyphTitle', { name: g.name })}
                  className={cn(
                    'group relative aspect-square rounded-xl border bg-gray-800/60 overflow-hidden transition-all text-left',
                    isSelected ? 'border-green-500 ring-2 ring-green-500/40' : 'border-green-900/50 hover:border-green-500/60',
                    g.hidden && 'opacity-40'
                  )}
                >
                  <svg viewBox={vb} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
                    <defs>
                      {contours.map((_, ci) => {
                        const cf = g.contourFills?.[ci];
                        const tex = cf ? cf.texture : g.texture;
                        const fillC = cf ? cf.fill : g.fill;
                        if (!tex) return null;
                        return (
                          <pattern key={ci} id={`gal-tex-${g.id}-${ci}`} patternUnits="userSpaceOnUse" width="10" height="10">
                            {tex === 'dots' && <circle cx="2" cy="2" r="1.5" fill={fillC} />}
                            {tex === 'lines' && <line x1="0" y1="0" x2="10" y2="10" stroke={fillC} strokeWidth="1" />}
                            {tex === 'checker' && (
                              <>
                                <rect width="5" height="5" fill={fillC} />
                                <rect x="5" y="5" width="5" height="5" fill={fillC} />
                              </>
                            )}
                          </pattern>
                        );
                      })}
                    </defs>
                    {contours.map((_, ci) => {
                      const contourD = buildContourPath(g.points, ci, g.closed);
                      const cf = g.contourFills?.[ci];
                      const contourFill = cf ? cf.fill : g.fill;
                      const contourTexture = cf ? cf.texture : g.texture;
                      return (
                        <path
                          key={`ct-${ci}`}
                          d={contourD}
                          fill={contourTexture ? `url(#gal-tex-${g.id}-${ci})` : contourFill}
                          stroke={g.stroke}
                          strokeWidth={Math.max(1, g.strokeWidth)}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      );
                    })}
                    {g.points.map((p, i) => {
                      if (!p.segStroke) return null;
                      const dSeg = buildSegmentPath(g.points, i, g.closed);
                      if (!dSeg) return null;
                      return <path key={`seg-${i}`} d={dSeg} fill="none" stroke={p.segStroke} strokeWidth={Math.max(1, g.strokeWidth)} strokeLinejoin="round" strokeLinecap="round" />;
                    })}
                  </svg>
                  <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-green-400 text-[10px] font-bold tracking-wide">
                    {g.name}
                  </span>
                  <span className="absolute top-1 left-1 max-w-[60%] truncate px-1.5 py-0.5 rounded bg-black/70 text-gray-300 text-[9px] tracking-wide" title={(g.font || fontName)}>
                    {(g.font || fontName)}
                  </span>
                  {g.hidden && (
                    <span className="absolute bottom-1 left-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-black/70 text-gray-500 text-[10px]">
                      <EyeOff className="w-3 h-3" /> {t('editorFuentes.hidden')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function HomePage() {
  const { t } = useI18n();
  const view = useEditorStore((s) => s.view);
  const fontName = useEditorStore((s) => s.fontName);
  const setFontName = useEditorStore((s) => s.setFontName);
  const [fontDraft, setFontDraft] = useState(fontName);
  useEffect(() => { setFontDraft(fontName); }, [fontName]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape: desde la galería vuelve al editor.
      if (e.key === 'Escape') {
        if (useEditorStore.getState().view === 'gallery') useEditorStore.getState().setView('edit');
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k !== 'c' && k !== 'x' && k !== 'v') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      e.preventDefault();
      if (k === 'c') copySelectedGlyphs();
      else if (k === 'x') cutSelectedGlyphs();
      else if (k === 'v') pasteClipboardGlyphs();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="h-full bg-gray-950 text-gray-100 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-green-900/50">
        <h1 className="text-lg font-bold tracking-tight">
          <span className="text-green-500">{t('editorFuentes.svg.edit')}</span> Zeus Font
        </h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{t('editorFuentes.fontLabel')}</span>
          <input
            value={fontDraft}
            onChange={(e) => setFontDraft(e.target.value)}
            onBlur={() => setFontName(fontDraft)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder={t('editorFuentes.fontNamePlaceholder')}
            className="bg-gray-800 border border-green-900/50 rounded px-2 py-1 text-sm text-gray-100 focus:outline-none focus:border-green-500 w-44"
          />
        </div>
        <span className="text-xs text-gray-500">{t('editorFuentes.svg.svgFontEditor')}</span>
      </div>
      <Toolbar />
      {view === 'gallery' ? (
        <GlyphGallery />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <GlyphManager />
          <EditorCanvas />
          <PropertiesPanel />
        </div>
      )}
    </div>
  );
}

export default HomePage;
