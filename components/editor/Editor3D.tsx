'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { ComponentType, Key } from 'react';
import * as THREE from 'three';
import DrawingCanvas from '@/components/drawing-canvas';
import EditorCanvas from '@/components/editor-canvas';
import Viewer3D from '@/components/viewer-3d';
import { ViewerPanel } from '@/components/editor/viewer-panel';
import { KeyframeEditor } from '@/components/editor/keyframe-editor';
import type { LightConfig } from '@/components/viewer-3d';
import type { FxConfig } from '@/components/viewer-3d';
import type { AnimationTrack, Keyframe } from '@/lib/animation';
import LightingModal from '@/components/LightingModal';
import TextureBrowserModal from '@/components/texture-browser-modal';
import BooleanCSGModal from './BooleanCSGModal';
import { performCSGOperation, type BooleanOperationType } from '@/lib/csg-mesh';
import { toast } from 'sonner';
import MeshEditor from './MeshEditor';
import { buildLoftMesh } from '@/lib/loft-mesh';
import type { ObjectTransform, Camera3D } from '@/components/viewer-3d';
import {
  IDENTITY_TRANSFORM,
  isIdentityTransform,
} from '@/components/viewer-3d';
import { meshInputToViews, fitSectionToViews } from '@/lib/mesh-to-views';
import { SHAPES } from '@/lib/shapes';
import {
  scalePolygonUniform,
  scalePolygonUniformUnbounded,
  setPolygonVertexCount,
  rotatePolygonInPlace,
} from '@/lib/polygon-tools';
import {
  Views,
  Polygon,
  reconstructVoxels,
  voxelsToBoxMesh,
  meshToTriangles,
  DEFAULT_VIEWS,
  HIGH_FIDELITY_RES,
  Vertex3D,
  buildLatheMesh,
   pointInPolygon,
   polygonArea,
  type LatheTextureProjection,
  type TextureFinish,
  type Mesh,
} from '@/lib/geometry';
import { buildViewsMesh, buildExtrudeMesh, buildExtrudeMeshes, polylineToPolygon } from '@/lib/views-mesh';
import { sanitizePolylinesByCanvas, newPolylineId } from '@/lib/polylines';
import type { PolylinesByCanvas, Polyline } from '@/lib/polylines';
import {
  buildTextMesh,
  buildTextPlaneMesh,
  FONT_OPTIONS,
  isNearWhite,
  type FontOption,
} from '@/lib/text-voxel';
import { buildSmoothTextMesh } from '@/lib/text-outline';
import { exportSTL, exportOBJ, exportPLY, exportGLB } from '@/lib/mesh-export';
import { importModelFile, getFormatFromExtension, IMPORT_FORMATS, normalizeAndCenterMeshes } from '@/lib/mesh-import';
import { Modal } from '@/components/ui/modal';
import { Slider } from '@/components/ui/slider';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import Object3DPreview, {
  Object3DThumbnail,
} from '@/components/object-3d-preview';
import {
  isElectron,
  getLocalPaths,
  listDirectory,
  readProject,
  saveProject,
} from '@/lib/electron-fs';
import {
  Boxes,
  BoxSelect,
  RefreshCw,
  AlertCircle,
  Info,
  Download,
  Type,
  PenTool,
  Plus,
  Minus,
  ExternalLink,
  Loader2,
  Check,
  FolderOpen,
  Palette,
  Layers,
  Grid3x3,
  Spline,
  Box,
  Save,
  Undo2,
  Redo2,
  Image as ImageIcon,
  X,
  RotateCw,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  Copy,
  ClipboardPaste,
  Trash2,
  Scissors,
  Expand,
   Sun,
   Camera,
} from 'lucide-react';

const EditorCanvasComponent = EditorCanvas as unknown as ComponentType<any>;

type Mode = 'views' | 'mesh' | 'text' | 'lathe' | 'extrude';
type EditorClipboard = {
  mode: Mode;
  views: Views;
  resolution: number;
  meshStyle: 'fusionada' | 'suave' | 'voxeles';
  text: string;
  fontCss: string;
  textDepth: number;
  hollowText: boolean;
  greedyMesh: boolean;
  textRes: number;
  textOpacity: number;
  /** Opacidad de la figura construida en la pestaña Vistas (1 = sólida) */
  viewsOpacity: number;
  /** Profundidad de extrusión en la pestaña Extruir (eje Z, hacia -Z) */
  extrudeDepth: number;
  /** IDs de polilíneas cerradas marcadas como agujeros en Extruir */
  extrudeHoles: string[];
  textMode: 'voxel' | 'plane' | 'smooth';
  useFontColor: boolean;
  baseColor: string;
  figureColor: string;
  texture: string | null;
  textureProjection: LatheTextureProjection;
   textureFinish: TextureFinish;
   textureRelief: number;
   textureRepeat: number;
   editedVertices: Vertex3D[] | null;
  meshSilhouette: Polygon;
  meshSections: Array<{ id: number; polygon: Polygon; y: number }>;
  meshSilhouetteView: 'front' | 'side' | 'both';
  meshSideView: Polygon;
  /** Opacidad de la figura construida en la pestaña Mallas (1 = sólida) */
  meshOpacity: number;
  latheProfile: Polygon;
  latheTexture: string | null;
  latheOpacity: number;
  latheSegments: number;
  latheClamp: boolean;
  latheFigureColor: string;
  /** Instantánea de la malla triangulada: con ella se pega en otras pestañas */
  mesh: Mesh;
  /** La malla se veía con normales suaves (no facetadas) */
  smooth: boolean;
  /** Polilíneas libres de los lienzos 2D, por lienzo (solo 2D) */
  polylines: PolylinesByCanvas;
};

/**
 * Configuración COMPLETA del panel congelada con un objeto: todas sus
 * plantillas 2D, colores, textos, texturas y polilíneas. Es lo que le
 * pertenece a cada objeto de la escena (viaja dentro de SceneObject) y
 * lo que se aplica al panel al seleccionarlo, pegarlo o cargarlo.
 */
 type ObjectConfig = Omit<EditorClipboard, 'mode' | 'mesh' | 'smooth'>;

type MultiObjectClipboard = {
  objects: SceneObject[];
};

type SceneObject = {
  id: string;
  name: string;
  transform: ObjectTransform;
  /**
   * Pestaña donde se debe mostrar este objeto. Si no se especifica,
   * se muestra en todas las pestañas (comportamiento anterior).
   */
  mode?: Mode;
  /**
   * Instantánea de malla del objeto congelado: la que llevaba al
   * pegarse/copiarse. Sirve para reconstruirlo igual en cualquier
   * pestaña (cada visor la monta como copia independiente).
   */
  mesh?: Mesh;
  /** La malla original se veía con normales suaves (no facetadas) */
  smooth?: boolean;
  /** Proyección con la que se mapea su textura */
  textureProjection?: LatheTextureProjection;
  /**
   * Configuración completa del panel congelada con el objeto. Ausente
   * en los objetos de archivos antiguos y del modal «Objeto 3D»: esos
   * solo se ven (su malla congelada), sin recuperar sus plantillas.
   */
   config?: ObjectConfig;
   /** Si el objeto está oculto en la escena (no se dibuja en el visor 3D) */
   hidden?: boolean;
   /** Si el objeto está congelado: se muestra en gris y no responde a interacciones */
   frozen?: boolean;
 };

/**
 * Figura representativa de un objeto guardado (.zeus): la del dueño de
 * la configuración guardada (o la del primer objeto con malla que traiga
 * el archivo). null si el archivo no trae ninguna figura. La usan tanto
 * el modal "Objeto 3D" (crear y vista previa) como su miniatura.
 */
function extractObj3dMesh(data: unknown): {
  name?: string;
  mesh: Mesh;
  smooth?: boolean;
  textureProjection?: LatheTextureProjection;
} | null {
  if (!data || typeof data !== 'object') return null;
  const project = data as {
     sceneObjects?: Array<{
      id?: string;
      name?: string;
      mesh?: Mesh;
      smooth?: boolean;
      textureProjection?: LatheTextureProjection;
    }>;
    configObjectId?: unknown;
  };
  const objs = Array.isArray(project.sceneObjects) ? project.sceneObjects : [];
  const owner =
    typeof project.configObjectId === 'string'
      ? objs.find((o) => o?.id === project.configObjectId)
      : undefined;
  const source =
    owner?.mesh ??
    objs.find((o) => o?.mesh && o.mesh.vertices.length > 0)?.mesh;
  if (!source || source.vertices.length === 0) return null;
  return {
    name: owner?.name,
    mesh: source,
    smooth: owner?.smooth,
    textureProjection: owner?.textureProjection,
  };
}

// Foto completa del editor para deshacer/rehacer: la configuración de la
// pestaña Y la escena (objetos con sus instantáneas de malla, selección
// y dueño de la configuración). Así la herramienta deshace cualquier
// cambio: texturas y acabados, mover/girar/escalar, crear, pegar,
// eliminar…
type HistoryState = {
  views: Views;
  editedVertices: Vertex3D[] | null;
  text: string;
  fontCss: string;
  textDepth: number;
  hollowText: boolean;
  greedyMesh: boolean;
  textRes: number;
  textOpacity: number;
  /** Opacidad de la figura construida en la pestaña Vistas (1 = sólida) */
  viewsOpacity: number;
  /** Profundidad de extrusión en la pestaña Extruir (eje Z, hacia -Z) */
  extrudeDepth: number;
  /** IDs de polilíneas cerradas marcadas como agujeros en Extruir */
  extrudeHoles: string[];
  textMode: 'voxel' | 'plane' | 'smooth';
  useFontColor: boolean;
  baseColor: string;
  figureColor: string;
  texture: string | null;
  latheTexture: string | null;
  textureProjection: LatheTextureProjection;
   textureFinish: TextureFinish;
   textureRelief: number;
   textureRepeat: number;
   resolution: number;
  meshStyle: 'fusionada' | 'suave' | 'voxeles';
  meshSilhouette: Polygon;
  meshSections: Array<{ id: number; polygon: Polygon; y: number }>;
  meshSilhouetteView: 'front' | 'side' | 'both';
  meshSideView: Polygon;
  /** Opacidad de la figura construida en la pestaña Mallas (1 = sólida) */
  meshOpacity: number;
  latheProfile: Polygon;
  latheOpacity: number;
  latheSegments: number;
  latheClamp: boolean;
  latheFigureColor: string;
  sceneObjects: SceneObject[];
  selectedObjectId: string | null;
  configObjectId: string | null;
  /** Polilíneas libres de los lienzos 2D, por lienzo (solo 2D) */
  polylines: PolylinesByCanvas;
};

const VIEW_LABELS: Record<keyof Views, { label: string; axisLabel: string }> = {
  front: { label: 'Frente', axisLabel: 'X·Y' },
  side: { label: 'Costado', axisLabel: 'Z·Y' },
  top: { label: 'Superior', axisLabel: 'X·Z' },
};

const NO_FOLDER_3D_MSG =
  'Configura primero la carpeta de Objetos 3D en Archivos → Configurar Carpetas Multimedia';
const DEFAULT_LATHE_PROFILE: Polygon = [
  { x: 0.3, y: -0.6 },
  { x: 0.8, y: -0.6 },
  { x: 0.8, y: 0.6 },
  { x: 0.3, y: 0.6 },
];

// La silueta por defecto llega hasta arriba del lienzo (y=0) y hasta
// abajo (y=1): el dibujo ocupa toda la altura del lienzo.
const DEFAULT_MESH_SILHOUETTE: Polygon = [
  { x: 0.35, y: 0 },
  { x: 0.65, y: 0 },
  { x: 0.75, y: 0.5 },
  { x: 0.6, y: 1 },
  { x: 0.4, y: 1 },
  { x: 0.25, y: 0.5 },
];

// El costado (Z·Y) por defecto también ocupa toda la altura del lienzo
const DEFAULT_MESH_SIDE_VIEW: Polygon = [
  { x: 0.3, y: 0 },
  { x: 0.7, y: 0 },
  { x: 0.75, y: 0.5 },
  { x: 0.6, y: 1 },
  { x: 0.4, y: 1 },
  { x: 0.25, y: 0.5 },
];

// Las líneas rojas (plantillas) por defecto coinciden con los extremos
// del dibujo: una arriba del todo (y=0), otra en media (y=0.5) y otra
// abajo del todo (y=1). Además, cada una se estira al ancho de la
// silueta (X) y del costado (Z) que les toca a su altura.
const DEFAULT_MESH_SECTIONS: Array<{
  id: number;
  polygon: Polygon;
  y: number;
}> = [
  {
    id: 1,
    y: 0,
    polygon: [
      { x: 0.3, y: 0.3 },
      { x: 0.7, y: 0.3 },
      { x: 0.7, y: 0.7 },
      { x: 0.3, y: 0.7 },
    ],
  },
  {
    id: 2,
    y: 0.5,
    polygon: [
      { x: 0.2, y: 0.5 },
      { x: 0.5, y: 0.2 },
      { x: 0.8, y: 0.5 },
      { x: 0.5, y: 0.8 },
    ],
  },
  {
    id: 3,
    y: 1,
    polygon: [
      { x: 0.35, y: 0.35 },
      { x: 0.65, y: 0.35 },
      { x: 0.65, y: 0.65 },
      { x: 0.35, y: 0.65 },
    ],
  },
].map((s) => ({
  ...s,
  polygon: fitSectionToViews(
    s.polygon,
    s.y,
    DEFAULT_MESH_SILHOUETTE,
    DEFAULT_MESH_SIDE_VIEW
  ),
}));

// Formas de un clic (círculo, cuadrado, …) tal cual salen de sus botones:
// sirven para detectar cuándo se inserta una en una plantilla y ajustarla
// al ancho de la silueta y del costado que le toca a su altura.
const PRESET_SHAPES: Polygon[] = SHAPES.map((s) => s.build());

// Configuración del panel con la que nace un objeto nuevo: la que
// «Nuevo objeto» aplica al crearlo, para dibujarlo desde la plantilla
// por defecto. Usarla SIEMPRE vía structuredClone: los DEFAULT_* son
// objetos compartidos a nivel de módulo.
const DEFAULT_OBJECT_CONFIG: ObjectConfig = {
  views: structuredClone(DEFAULT_VIEWS),
  resolution: 32,
  meshStyle: 'suave',
  text: 'HOLA',
  fontCss: "'Textura', sans-serif",
  textDepth: 48,
  hollowText: false,
  greedyMesh: true,
  textRes: 24,
  textOpacity: 1,
  viewsOpacity: 1,
  extrudeDepth: 0.5,
  /** IDs de polilíneas cerradas marcadas como agujeros en Extruir */
  extrudeHoles: [],
  textMode: 'voxel',
  useFontColor: true,
  baseColor: '#e8e8e8',
  figureColor: '#121ca7',
  texture: null,
  textureProjection: 'cylindrical',
   textureFinish: 'semi-matte',
   textureRelief: 0.25,
   textureRepeat: 1,
   editedVertices: null,
  meshSilhouette: structuredClone(DEFAULT_MESH_SILHOUETTE),
  meshSections: structuredClone(DEFAULT_MESH_SECTIONS),
  meshSilhouetteView: 'both',
  meshSideView: structuredClone(DEFAULT_MESH_SIDE_VIEW),
  meshOpacity: 1,
  latheProfile: structuredClone(DEFAULT_LATHE_PROFILE),
  latheTexture: null,
  latheOpacity: 1,
  latheSegments: 32,
  latheClamp: true,
  latheFigureColor: '#121ca7',
  polylines: {},
};

/**
 * Sanea la configuración de un objeto leída de un archivo .zeus: campo a
 * campo, con los valores por defecto como fallback (igual que hace
 * loadObject con los campos sueltos del proyecto). null si no trae nada.
 */
function sanitizeObjectConfig(raw: unknown): ObjectConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const d = DEFAULT_OBJECT_CONFIG;
  const poly = (v: unknown, fallback: Polygon): Polygon =>
    Array.isArray(v) && v.length >= 3
      ? (structuredClone(v) as Polygon)
      : structuredClone(fallback);
  const oneOf = <T extends string>(
    v: unknown,
    list: readonly T[],
    fallback: T
  ): T =>
    (typeof v === 'string' && (list as readonly string[]).includes(v)
      ? v
      : fallback) as T;
  return {
    views:
      c.views && typeof c.views === 'object' && !Array.isArray(c.views)
        ? (structuredClone(c.views) as Views)
        : structuredClone(d.views),
    resolution: typeof c.resolution === 'number' ? c.resolution : d.resolution,
    meshStyle: oneOf(
      c.meshStyle,
      ['fusionada', 'suave', 'voxeles'] as const,
      d.meshStyle
    ),
    text: typeof c.text === 'string' ? c.text : d.text,
    fontCss: typeof c.fontCss === 'string' ? c.fontCss : d.fontCss,
    textDepth: typeof c.textDepth === 'number' ? c.textDepth : d.textDepth,
    hollowText: typeof c.hollowText === 'boolean' ? c.hollowText : d.hollowText,
    greedyMesh: typeof c.greedyMesh === 'boolean' ? c.greedyMesh : d.greedyMesh,
    textRes: typeof c.textRes === 'number' ? c.textRes : d.textRes,
    textOpacity:
      typeof c.textOpacity === 'number' ? c.textOpacity : d.textOpacity,
    viewsOpacity:
      typeof c.viewsOpacity === 'number' ? c.viewsOpacity : d.viewsOpacity,
    extrudeDepth:
      typeof c.extrudeDepth === 'number' ? c.extrudeDepth : d.extrudeDepth,
    extrudeHoles: Array.isArray(c.extrudeHoles) ? c.extrudeHoles : d.extrudeHoles,
    textMode: oneOf(
      c.textMode,
      ['voxel', 'plane', 'smooth'] as const,
      d.textMode
    ),
    useFontColor:
      typeof c.useFontColor === 'boolean' ? c.useFontColor : d.useFontColor,
    baseColor: typeof c.baseColor === 'string' ? c.baseColor : d.baseColor,
    figureColor:
      typeof c.figureColor === 'string' ? c.figureColor : d.figureColor,
    texture: typeof c.texture === 'string' ? c.texture : null,
    textureProjection: oneOf(
      c.textureProjection,
      ['cylindrical', 'planar', 'spherical'] as const,
      d.textureProjection
    ),
    textureFinish: oneOf(
      c.textureFinish,
       ['matte', 'semi-matte', 'glossy', 'metallic'] as const,
      d.textureFinish
    ),
     textureRelief:
       typeof c.textureRelief === 'number' ? c.textureRelief : d.textureRelief,
     textureRepeat:
       typeof c.textureRepeat === 'number' ? c.textureRepeat : d.textureRepeat,
     editedVertices:
      Array.isArray(c.editedVertices) && c.editedVertices.length > 0
        ? (structuredClone(c.editedVertices) as Vertex3D[])
        : null,
    meshSilhouette: poly(c.meshSilhouette, d.meshSilhouette),
    meshSections: Array.isArray(c.meshSections)
      ? (structuredClone(c.meshSections) as ObjectConfig['meshSections'])
      : structuredClone(d.meshSections),
    meshSilhouetteView: oneOf(
      c.meshSilhouetteView,
      ['front', 'side', 'both'] as const,
      d.meshSilhouetteView
    ),
    meshSideView: poly(c.meshSideView, d.meshSideView),
    meshOpacity:
      typeof c.meshOpacity === 'number' ? c.meshOpacity : d.meshOpacity,
    latheProfile: poly(c.latheProfile, d.latheProfile),
    latheTexture: typeof c.latheTexture === 'string' ? c.latheTexture : null,
    latheOpacity:
      typeof c.latheOpacity === 'number' ? c.latheOpacity : d.latheOpacity,
    latheSegments:
      typeof c.latheSegments === 'number' ? c.latheSegments : d.latheSegments,
    latheClamp: typeof c.latheClamp === 'boolean' ? c.latheClamp : d.latheClamp,
    latheFigureColor:
      typeof c.latheFigureColor === 'string'
        ? c.latheFigureColor
        : d.latheFigureColor,
    polylines: sanitizePolylinesByCanvas(c.polylines),
  };
}

/** Configuración de objeto a partir del portapapeles de objeto completo. */
function objectConfigFromClipboard(clip: EditorClipboard): ObjectConfig {
  const clone = structuredClone(clip) as Record<string, unknown>;
  delete clone.mode;
  delete clone.mesh;
  delete clone.smooth;
  return clone as ObjectConfig;
}

const isPresetShape = (poly: Polygon): boolean => {
  if (poly.length < 3) return false;
  return PRESET_SHAPES.some(
    (preset) =>
      preset.length === poly.length &&
      preset.every(
        (p, i) =>
          Math.abs(p.x - poly[i].x) < 1e-9 && Math.abs(p.y - poly[i].y) < 1e-9
      )
  );
};

/** Caja completa (0..1 en ambos ejes): la vista que no limita cuando la
 *  silueta se aplica solo al Frente o solo al Costado. */
const FULL_BOX_VIEW: Polygon = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/**
 * Simplifica un contorno usando el algoritmo Douglas-Peucker.
 * Elimina vértices que están dentro de `epsilon` píxeles de la
 * línea recta entre sus vecinos, manteniendo las curvas y esquinas.
 */
function douglasPeuckerContour(
  pts: { x: number; y: number }[],
  epsilon: number
): { x: number; y: number }[] {
  if (pts.length <= 2) return pts;

  let maxDist = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxDist) {
      maxDist = d;
      idx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeuckerContour(pts.slice(0, idx + 1), epsilon);
    const right = douglasPeuckerContour(pts.slice(idx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [pts[0], pts[pts.length - 1]];
}

function perpDist(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return (
    Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) /
    len
  );
}

/**
 * Controles de cada plantilla 2D: escalar sin deformar (mismo factor en
 * X e Y, centrado, sin salirse del lienzo), girar en su propio plano y
 * sumar/restar vértices sin cambiar la forma.
 */
function SectionTools({
  polygon,
  onChange,
  sectionY,
  onMoveY,
}: {
  polygon: Polygon;
  onChange: (poly: Polygon) => void;
  /** Altura Y actual de la plantilla (0 arriba, 1 abajo). Si viene junto
      a onMoveY, se muestran los botones de subir/bajar en esta fila. */
  sectionY?: number;
  onMoveY?: (delta: number) => void;
}) {
  // El campo de vértices se confirma al pulsar Enter o al salir del
  // campo, para que escribir un número de dos cifras no vaya aplicando
  // cada dígito.
  const [vertexText, setVertexText] = useState<string | null>(null);
  const shown = vertexText ?? String(polygon.length);
  const commitVertices = () => {
    if (vertexText === null) return;
    const v = Math.floor(Number(vertexText));
    setVertexText(null);
    if (Number.isFinite(v) && v >= 3 && v <= 128 && v !== polygon.length) {
      onChange(setPolygonVertexCount(polygon, v));
    }
  };
  const btn =
    'flex items-center justify-center w-5 h-5 rounded bg-white/5 border border-white/10 text-foreground hover:bg-white/15 transition-colors';
  return (
    <div className="flex items-center gap-3 text-[10px]">
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">Escala</span>
        <button
          type="button"
          className={btn}
          title="Hacer la plantilla un 5% más pequeña, sin deformarla"
          onClick={() => onChange(scalePolygonUniform(polygon, 0.95))}
        >
          <Minus className="w-3 h-3" />
        </button>
        <button
          type="button"
          className={btn}
          title="Hacer la plantilla un 5% más grande, sin deformarla"
          onClick={() => onChange(scalePolygonUniform(polygon, 1.05))}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">Girar</span>
        <button
          type="button"
          className={btn}
          title="Girar la plantilla 15° a la izquierda (gira sobre sí misma)"
          onClick={() => onChange(rotatePolygonInPlace(polygon, -Math.PI / 12))}
        >
          <RotateCcw className="w-3 h-3" />
        </button>
        <button
          type="button"
          className={btn}
          title="Girar la plantilla 15° a la derecha (gira sobre sí misma)"
          onClick={() => onChange(rotatePolygonInPlace(polygon, Math.PI / 12))}
        >
          <RotateCw className="w-3 h-3" />
        </button>
      </div>
      {typeof sectionY === 'number' && onMoveY && (
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Altura</span>
          <span className="font-mono text-[10px] text-green-400">
            Y = {sectionY.toFixed(2)}
          </span>
          {/* Ojo: en el lienzo y=0 es arriba, así que subir es RESTAR a la Y */}
          <button
            type="button"
            className={btn}
            title="Subir la plantilla (altura Y)"
            disabled={sectionY <= 0}
            onClick={() => onMoveY(-0.05)}
          >
            <ChevronUp className="w-3 h-3" />
          </button>
          <button
            type="button"
            className={btn}
            title="Bajar la plantilla (altura Y)"
            disabled={sectionY >= 1}
            onClick={() => onMoveY(0.05)}
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      )}
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">Vértices</span>
        <button
          type="button"
          className={btn}
          title="Quitar el vértice que menos cambia la forma"
          onClick={() =>
            onChange(setPolygonVertexCount(polygon, polygon.length - 1))
          }
        >
          <Minus className="w-3 h-3" />
        </button>
        <input
          type="number"
          min={3}
          max={128}
          value={shown}
          onChange={(e) => setVertexText(e.target.value)}
          onBlur={commitVertices}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitVertices();
          }}
          title="Número de vértices: súmale o réstale sin cambiar la forma (Enter para aplicar)"
          className="w-11 px-1 py-0.5 rounded bg-black/60 border border-white/10 text-foreground font-mono"
        />
        <button
          type="button"
          className={btn}
          title="Añadir un vértice en la arista más larga, sin cambiar la forma"
          onClick={() =>
            onChange(setPolygonVertexCount(polygon, polygon.length + 1))
          }
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const [views, setViews] = useState<Views>(DEFAULT_VIEWS);
  const [editedVertices, setEditedVertices] = useState<Vertex3D[] | null>(null);
  const [resolution, setResolution] = useState(32);
  const [importDetailLevel, setImportDetailLevel] = useState(50);
  const pngImportInputRef = useRef<HTMLInputElement | null>(null);
  const [templateImage, setTemplateImage] = useState<string | null>(null);
  const [templateOpacity, setTemplateOpacity] = useState(0.5);
  const [templateScale, setTemplateScale] = useState(1);
  const templateInputRef = useRef<HTMLInputElement | null>(null);

  const [meshStyle, setMeshStyle] = useState<'fusionada' | 'suave' | 'voxeles'>(
    'suave'
  );

  const [editingView, setEditingView] = useState<
    'front' | 'top' | 'side' | '3d' | null
  >(null);
  const [editingLathe, setEditingLathe] = useState(false);
  const [editingTextPanel, setEditingTextPanel] = useState<
    'front' | 'top' | 'side' | '3d' | null
  >(null);
  const [editingLathePanel, setEditingLathePanel] = useState<
    'front' | 'top' | 'side' | '3d' | null
  >(null);
  const [editingMeshPanel, setEditingMeshPanel] = useState<
    'front' | 'top' | 'side' | '3d' | null
  >(null);
  const [editorGridResolution, setEditorGridResolution] = useState(32);
  const [editorCanvasZoom, setEditorCanvasZoom] = useState(1);
  const [editingLatheProfile, setEditingLatheProfile] = useState(false);
  const [editingMeshProfile, setEditingMeshProfile] = useState<
    null | 'silhouette' | string
  >(null);
  const [editingMesh, setEditingMesh] = useState(false);

  const [mode, setMode] = useState<Mode>('views');
  const [editorClipboard, setEditorClipboard] =
    useState<EditorClipboard | null>(null);
  // Portapapeles de formas 2D: Copiar con un lienzo abierto a pantalla
  // completa (una plantilla sola, la silueta o el costado) guarda aquí su
  // polígono, y Pegar lo vuelca en otro lienzo que se abra igual.
   const [polygonClipboard, setPolygonClipboard] = useState<Polygon | null>(
     null
   );
   const [multiObjectClipboard, setMultiObjectClipboard] =
     useState<MultiObjectClipboard | null>(null);
  const [text, setText] = useState('HOLA');
  const [fontCss, setFontCss] = useState("'Textura', sans-serif");
  const [textDepth, setTextDepth] = useState(48);
  const [hollowText, setHollowText] = useState(false);
  const [greedyMesh, setGreedyMesh] = useState(true);
  const [textRes, setTextRes] = useState(144);

  const [showGizmo, setShowGizmo] = useState(false);
  const [fontVersion, setFontVersion] = useState(0);
  const [textOpacity, setTextOpacity] = useState(0.85);
  // Transparencia de la figura de la pestaña Vistas (1 = opaca del todo).
  // Mando aparte de los lienzos: afecta al objeto 3D completo.
  const [viewsOpacity, setViewsOpacity] = useState(1);
  // Profundidad de extrusión (eje Z, hacia -Z) en la pestaña Extruir.
  const [extrudeDepth, setExtrudeDepth] = useState(0.5);
  // IDs de polilíneas cerradas marcadas como agujeros (sustraídos) en Extruir.
  const [extrudeHoles, setExtrudeHoles] = useState<string[]>([]);
  // Escala uniforme de la figura 2D en Extruir (slider del toolbar).
  const [resizeScale, setResizeScale] = useState(1);
  const resizeBaseRef = useRef<Polygon | null>(null);
  const [lightConfig, setLightConfig] = useState<LightConfig | null>(null);
  const [isLightingModalOpen, setIsLightingModalOpen] = useState(false);
  // Muestra/oculta los ayudantes visuales de luz (cono, aro, bola amarilla, círculo)
  const [showLightHelpers, setShowLightHelpers] = useState(true);
  // Muestra/oculta el plano de suelo bajo el objeto
  const [showGround, setShowGround] = useState(false);
  // Muestra/oculta la rejilla del suelo
  const [showGrid, setShowGrid] = useState(true);
  // Estado de efectos visuales (brillo, chispas, fuego)
  const [fxConfig, setFxConfig] = useState<FxConfig>({
    glow: false,
    glowColor: '#5fd4ff',
    glowIntensity: 1.4,
    sparks: false,
    sparksCount: 140,
    sparksSize: 0.035,
    fire: false,
    fireCount: 160,
    fireSize: 0.11,
    fireIntensity: 1,
    rain: false,
    rainCount: 320,
    rainSpeed: 2,
    smoke: false,
    smokeCount: 120,
    smokeSize: 0.11,
    smokeColor: '#444a52',
    smokeRiseSpeed: 1,
    glowObjects: false,
  });

  const [texture, setTexture] = useState<string | null>(null);
  const textureInputRef = useRef<HTMLInputElement | null>(null);
  const [textureFileName, setTextureFileName] = useState('');
  const [textureProjection, setTextureProjection] =
    useState<LatheTextureProjection>('planar');
  // Pieza amarilla de la ayuda de proyección: el marco editable de la
  // textura. Compartida por todas las pestañas, así que se coloca en
  // una y sirve en todas.
  const [textureHelper, setTextureHelper] = useState(false);
  const [textureHelperTransform, setTextureHelperTransform] =
    useState<ObjectTransform>(IDENTITY_TRANSFORM);
  // ¿La pieza se ha movido del reposo? Su colocación sigue aplicándose
  // aunque se esconda con la casilla, así que el botón de restablecer
  // tiene que seguir a la vista mientras esté movida.
  const textureHelperDirty = !isIdentityTransform(textureHelperTransform);
   const [textureFinish, setTextureFinish] = useState<TextureFinish>('glossy');
   const [textureRelief, setTextureRelief] = useState(0.25);
   const [textureRepeat, setTextureRepeat] = useState(1);
  const [textureBrowserOpen, setTextureBrowserOpen] = useState(false);

  const [showTextureModal, setShowTextureModal] = useState(false);
  const [cameraViewMode, setCameraViewMode] = useState(false);
  const [showCameraPath, setShowCameraPath] = useState(true);
  const [exportMp4Trigger, setExportMp4Trigger] = useState(0);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportResult, setExportResult] = useState<{ success: boolean; outputPath?: string; error?: string } | null>(null);
  const [isRecordingCameraPath, setIsRecordingCameraPath] = useState(false);
  const [cameraPathKeyframes, setCameraPathKeyframes] = useState<Array<{time: number; camera: Camera3D}>>([]);
  const [textureSelectTarget, setTextureSelectTarget] = useState<'ground' | 'skybox' | 'object' | null>(null);
  const [groundTexture, setGroundTexture] = useState<string | null>(null);
  const [groundTextureFileName, setGroundTextureFileName] = useState('');
  const [groundTextureFinish, setGroundTextureFinish] = useState<TextureFinish>('semi-matte');
  const [groundTextureRepeat, setGroundTextureRepeat] = useState(4);
  const [objectTextureFinish, setObjectTextureFinish] = useState<TextureFinish>('semi-matte');
  const [skyboxImage, setSkyboxImage] = useState<string | null>(null);
  const [skyboxImageFileName, setSkyboxImageFileName] = useState('');
  const [selectedObjectTexture, setSelectedObjectTexture] = useState<string | null>(null);
  const [selectedObjectTextureFileName, setSelectedObjectTextureFileName] = useState('');

  const [textMode, setTextMode] = useState<'voxel' | 'plane' | 'smooth'>(
    'smooth'
  );
  const [editingViewProfile, setEditingViewProfile] = useState<
    'front' | 'side' | 'top' | null
  >(null);

  const [useFontColor, setUseFontColor] = useState(true);
  const [baseColor, setBaseColor] = useState('#e8e8e8');

  const [figureColor, setFigureColor] = useState('#121ca7');
  const [latheFigureColor, setLatheFigureColor] = useState('#121ca7');

  const [latheProfile, setLatheProfile] = useState<Polygon>(
    DEFAULT_LATHE_PROFILE
  );
  const [latheTexture, setLatheTexture] = useState<string | null>(null);
  const [latheTextureFileName, setLatheTextureFileName] = useState('');
  const [latheOpacity, setLatheOpacity] = useState(1);
  const [latheSegments, setLatheSegments] = useState(32);
  const [latheClamp, setLatheClamp] = useState(true);

  const [meshSilhouette, setMeshSilhouette] = useState<Polygon>(
    DEFAULT_MESH_SILHOUETTE
  );
  // Transparencia de la figura de la pestaña Mallas (1 = opaca del todo).
  // Mando aparte de las plantillas: afecta al objeto 3D completo.
  const [meshOpacity, setMeshOpacity] = useState(1);
  // Igual que la silueta: el costado por defecto ocupa toda la altura
  // del lienzo (de y=0 arriba a y=1 abajo).
  const [meshSideView, setMeshSideView] = useState<Polygon>(
    structuredClone(DEFAULT_MESH_SIDE_VIEW)
  );
  const [editingMeshSide, setEditingMeshSide] = useState(false);
  const [meshSections, setMeshSections] = useState<
    Array<{ id: number; polygon: Polygon; y: number }>
  >(DEFAULT_MESH_SECTIONS);
  const [meshSilhouetteView, setMeshSilhouetteView] = useState<
    'front' | 'side' | 'both'
  >('both');
  // Polilíneas libres de los lienzos 2D, por lienzo ('views:front',
  // 'mesh:silhouette', 'mesh:section:<id>', 'lathe:profile'…): líneas
  // abiertas dibujadas con la herramienta Línea del lienzo grande. Solo
  // viven en el lienzo 2D: no se ven en el visor 3D ni afectan a la malla.
  const [polylines, setPolylines] = useState<PolylinesByCanvas>({});
  const getPolylines = useCallback(
    (key: string) => polylines[key] ?? [],
    [polylines]
  );
  const updatePolylines = useCallback((key: string, lines: Polyline[]) => {
    setPolylines((prev) => {
      // Sin líneas se quita la clave: el mapa no guarda lienzos vacíos
      if (lines.length === 0) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: lines };
    });
  }, []);

  // Vistas que se aplican de verdad al objeto: con "Frente" el costado no
  // limita, con "Costado" la silueta no limita, con "Ambas" limitan las dos.
  // Se usan tanto para construir el objeto como para ajustar las plantillas
  // al ancho que les toca, así lo que se ve en el lienzo es lo que sale.
  const appliedMeshSilhouette =
    meshSilhouetteView === 'side' ? FULL_BOX_VIEW : meshSilhouette;
  const appliedMeshSideView =
    meshSilhouetteView === 'front' ? FULL_BOX_VIEW : meshSideView;

  const addMeshSection = useCallback(() => {
    setMeshSections((prev) => {
      const nextId =
        prev.length > 0 ? Math.max(...prev.map((s) => s.id)) + 1 : 1;
      // Si no hay plantillas, empezamos en 0.5. Si las hay, la nueva va por debajo
      // de la que tenga la y más baja (la de más abajo).
      const minY = prev.length > 0 ? Math.min(...prev.map((s) => s.y)) : 0.5;
      const nextY = Number(Math.max(0.05, minY - 0.15).toFixed(2));
      return [
        ...prev,
        {
          id: nextId,
          y: nextY,
          // La plantilla nueva se estira al ancho de la silueta (X) y del
          // costado (Z) que corresponden a su altura.
          polygon: fitSectionToViews(
            [
              { x: 0.3, y: 0.3 },
              { x: 0.7, y: 0.3 },
              { x: 0.7, y: 0.7 },
              { x: 0.3, y: 0.7 },
            ],
            nextY,
            appliedMeshSilhouette,
            appliedMeshSideView
          ),
        },
      ];
    });
  }, [appliedMeshSilhouette, appliedMeshSideView]);

  const removeMeshSection = useCallback((id: number) => {
    setMeshSections((prev) => prev.filter((s) => s.id !== id));
    // Sus polilíneas libres desaparecen con la plantilla
    setPolylines((prev) => {
      const key = `mesh:section:${id}`;
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  /**
   * Actualiza el polígono de una plantilla. Si el nuevo polígono es una
   * forma de las de un clic (círculo, cuadrado, …) se estira al ancho de
   * la silueta (X) y del costado (Z) que le tocan a la altura de esa
   * plantilla; el resto de ediciones (arrastrar vértices, dibujar a mano)
   * se guardan tal cual.
   */
  const updateMeshSectionPolygon = useCallback(
    (id: number, poly: Polygon) => {
      setMeshSections((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          const polygon = isPresetShape(poly)
            ? fitSectionToViews(
                poly,
                s.y,
                appliedMeshSilhouette,
                appliedMeshSideView
              )
            : poly;
          return { ...s, polygon };
        })
      );
    },
    [appliedMeshSilhouette, appliedMeshSideView]
  );

  const replaceMeshSectionPolygon = useCallback((id: number, poly: Polygon) => {
    setMeshSections((prev) =>
      prev.map((s) =>
        s.id !== id ? s : { ...s, polygon: structuredClone(poly) }
      )
    );
  }, []);

  /**
   * Sube o baja una plantilla (su altura Y) con los botones de su cabecera.
   * La forma no se toca, pero el polígono se reajusta al ancho de la
   * silueta y del costado que le toca en la nueva altura, igual que al
   * escribir la Y a mano en la vista ampliada.
   */
  const moveMeshSectionY = useCallback(
    (id: number, delta: number) => {
      setMeshSections((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          const y = Math.min(1, Math.max(0, Number((s.y + delta).toFixed(2))));
          return {
            ...s,
            y,
            polygon: fitSectionToViews(
              s.polygon,
              y,
              appliedMeshSilhouette,
              appliedMeshSideView
            ),
          };
        })
      );
    },
    [appliedMeshSilhouette, appliedMeshSideView]
  );

  /**
   * Lienzo 2D abierto a pantalla completa (una plantilla sola, la silueta
   * o el costado). Con uno abierto, los botones Copiar/Pegar trabajan con
   * SU forma en vez de con el objeto 3D: Copiar guarda el polígono y Pegar
   * vuelca en él el último polígono copiado, así una plantilla se puede
   * copiar y pegar en otra (o en la silueta/costado) sin cerrar nada.
   */
  const fullScreenCanvas = useMemo(() => {
    if (mode !== 'mesh' || editingMeshProfile === null) return null;
    if (editingMeshProfile === 'silhouette') {
      return {
        name: 'la Silueta',
        polygon:
          meshSilhouette && meshSilhouette.length > 0
            ? meshSilhouette
            : DEFAULT_MESH_SILHOUETTE,
        apply: (poly: Polygon) => {
          setMeshSilhouette(structuredClone(poly));
          setEditedVertices(null);
        },
      };
    }
    if (editingMeshProfile === 'side') {
      return {
        name: 'el Costado',
        polygon: meshSideView,
        apply: (poly: Polygon) => {
          setMeshSideView(structuredClone(poly));
          setEditedVertices(null);
        },
      };
    }
    const section = meshSections.find(
      (s) => s.id.toString() === editingMeshProfile
    );
    if (!section) return null;
    return {
      name: `la Plantilla ${meshSections.indexOf(section) + 1}`,
      polygon: section.polygon,
      apply: (poly: Polygon) => {
        replaceMeshSectionPolygon(section.id, poly);
        setEditedVertices(null);
      },
    };
  }, [
    mode,
    editingMeshProfile,
    meshSilhouette,
    meshSideView,
    meshSections,
    replaceMeshSectionPolygon,
  ]);

  useEffect(() => {
    if (!meshSilhouette || meshSilhouette.length === 0) {
      setMeshSilhouette(structuredClone(DEFAULT_MESH_SILHOUETTE));
    }
    if (!meshSections || meshSections.length === 0) {
      setMeshSections(structuredClone(DEFAULT_MESH_SECTIONS));
    }
  }, []);

  const [customFonts, setCustomFonts] = useState<FontOption[]>([]);
  const [customFontName, setCustomFontName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const localFontInputRef = useRef<HTMLInputElement | null>(null);
  const [localFontFileName, setLocalFontFileName] = useState('');
  const [localFontLoading, setLocalFontLoading] = useState(false);
  const [localFontMsg, setLocalFontMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [objectName, setObjectName] = useState('');
  const [savingObject, setSavingObject] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  // Modal "Objeto 3D": objetos guardados (.zeus) de dos sitios —
  // public/Obj-3D (al pinchar se CREA en la escena) y la carpeta local
  // de Objetos 3D donde guarda el botón Guardar (al pinchar se CARGA
  // en el editor, como hacía el antiguo botón Cargar).
  const [obj3dModalOpen, setObj3dModalOpen] = useState(false);
  const [obj3dFiles, setObj3dFiles] = useState<
    Array<{
      name: string;
      /** De dónde viene el archivo */
      source: 'public' | 'local';
      /** Ruta absoluta (solo archivos de la carpeta local) */
      path?: string;
      size?: number;
      outline?: number[][] | null;
      /** Figura leída para la miniatura: undefined = leyendo, null = sin figura */
      mesh?: Mesh | null;
    }>
  >([]);
  const [obj3dLoading, setObj3dLoading] = useState(false);
  const [obj3dCreating, setObj3dCreating] = useState(false);
  const [obj3dMsg, setObj3dMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  // Objeto bajo el ratón en el modal (su figura se ve girando en la
  // vista previa 3D, como en el explorador de texturas)
  const [obj3dPreview, setObj3dPreview] = useState<{
    name: string;
    mesh: Mesh;
  } | null>(null);
  // Figuras ya leídas del modal Objeto 3D (clave "origen/nombre"), para
  // no releer el archivo al volver a pasar el ratón por él
  const obj3dMeshCacheRef = useRef<Map<string, Mesh>>(new Map());

  // Input oculto para seleccionar un archivo .zeus desde el navegador
  const obj3dFileInputRef = useRef<HTMLInputElement | null>(null);

  // Input oculto para importar modelos 3D (.obj, .glb, etc.)
  const modelFileInputRef = useRef<HTMLInputElement | null>(null);

  const [modelImportMsg, setModelImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // La escena: objetos con sus transformaciones e instantáneas de
  // malla, el objeto seleccionado y el dueño de la configuración. Se
  // declaran aquí arriba porque el historial de deshacer/rehacer los
  // fotografía en cada paso.
  const [sceneObjects, setSceneObjects] = useState<SceneObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
   const [selectionMode, setSelectionMode] = useState(false);
   const [faceSelectMode, setFaceSelectMode] = useState(false);
   const [faceSelectionTool, setFaceSelectionTool] = useState<'rectangle' | 'circle' | 'polygon'>('rectangle');
   const [selectedFaceIds, setSelectedFaceIds] = useState<number[]>([]);
   const [viewRefreshTick, setViewRefreshTick] = useState(0);
  // Objeto dueño de la configuración actual: su figura es la malla que
  // el editor construye ahora. Los demás son copias congeladas (pegadas
  // o dejadas atrás al crear/seleccionar) con su propia instantánea.
  const [configObjectId, setConfigObjectId] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isUndoRedo, setIsUndoRedo] = useState(false);
  const [activeView, setActiveView] = useState<'front' | 'top' | 'side' | '3d'>(
    'front'
  );
  const [viewports, setViewports] = useState({
    front: { zoom: 1, offsetX: 0, offsetY: 0, gridResolution: 32 },
    top: { zoom: 1, offsetX: 0, offsetY: 0, gridResolution: 32 },
    side: { zoom: 1, offsetX: 0, offsetY: 0, gridResolution: 32 },
  });
  const [camera3D, setCamera3D] = useState({
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    rotationX: 0,
    rotationY: 0,
  });

  const [panelCameras, setPanelCameras] = useState({
    front: { zoom: 1, offsetX: 0, offsetY: 0, rotationX: 0, rotationY: 0 },
    top: {
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      rotationX: Math.PI / 2,
      rotationY: 0,
    },
    side: {
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      rotationX: 0,
      rotationY: Math.PI / 2,
    },
    '3d': {
      zoom: 1.2,
      offsetX: 0,
      offsetY: 0,
      rotationX: Math.PI / 6,
      rotationY: -Math.PI / 4,
    },
    });

   const [animationTracks, setAnimationTracks] = useState<AnimationTrack[]>([]);
   const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
   const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0.1);
    const [showKeyframeEditor, setShowKeyframeEditor] = useState(false);

    useEffect(() => {
      if (cameraViewMode && animationTracks.length > 0) {
        setShowKeyframeEditor(true);
      }
    }, [cameraViewMode, animationTracks.length]);
    const animationStartTimeRef = useRef<number | null>(null);
   const animIdRef = useRef<number | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
   const noopRef = useRef(() => {});

    useEffect(() => {
      if (!playing || animationTracks.length === 0) {
        animationStartTimeRef.current = null;
        return;
      }
      const maxDuration = Math.max(...animationTracks.map((t) => t.duration)) / 1000;
      animationStartTimeRef.current = performance.now();

      const animate = () => {
        if (animationStartTimeRef.current === null) return;
        const elapsed = (performance.now() - animationStartTimeRef.current) / 1000;
        let t = elapsed;
        if (t >= maxDuration) {
          if (animationTracks.every((track) => !track.looping)) {
            setPlaying(false);
            animationStartTimeRef.current = null;
            return;
          } else {
            t = ((t % maxDuration) + maxDuration) % maxDuration;
          }
        }
        setCurrentTime(Math.max(t, 0.1));
        animIdRef.current = requestAnimationFrame(animate);
      };
      animIdRef.current = requestAnimationFrame(animate);

      return () => {
        if (animIdRef.current !== null) {
          cancelAnimationFrame(animIdRef.current);
          animIdRef.current = null;
        }
        animationStartTimeRef.current = null;
      };
    }, [playing, animationTracks]);

   useEffect(() => {
    if (mode === 'text') {
      setPanelCameras((prev) => ({
        front: { ...prev.front, zoom: 2.5 },
        top: { ...prev.top, zoom: 2.5 },
        side: { ...prev.side, zoom: 2.5 },
        '3d': { ...prev['3d'], zoom: 3 },
      }));
    } else {
      setPanelCameras((prev) => ({
        front: { ...prev.front, zoom: 1 },
        top: { ...prev.top, zoom: 1 },
        side: { ...prev.side, zoom: 1 },
        '3d': { ...prev['3d'], zoom: 1.2 },
      }));
    }
  }, [mode]);
  useEffect(() => {
    setViews(DEFAULT_VIEWS);
  }, []);

  // Cargar la plantilla de Botella-Cafe.zeus como perfil de torno por defecto
  useEffect(() => {
    const loadDefaultLatheProfile = async () => {
      try {
        let data: any = null;
        if (typeof window !== 'undefined' && (window as any).electronAPI) {
          data = await readProject('public/Obj-3D/Botella-Cafe.zeus');
        } else {
          const res = await fetch('/Obj-3D/Botella-Cafe.zeus');
          if (res.ok) data = await res.json();
        }
        if (
          data?.type === 'editor3d' &&
          Array.isArray(data.latheProfile) &&
          data.latheProfile.length >= 3
        ) {
          setLatheProfile(data.latheProfile);
        }
      } catch {
        // Silencioso: si no se puede cargar, se usa el perfil por defecto
      }
    };
    loadDefaultLatheProfile();
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.fonts) {
      document.fonts.ready.then(() => setFontVersion((v) => v + 1));
    } else {
      setFontVersion((v) => v + 1);
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.fonts) {
      document.fonts.ready.then(() => setFontVersion((v) => v + 1));
    } else {
      setFontVersion((v) => v + 1);
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    let cancelled = false;

    const load = async () => {
      try {
        await document.fonts.load(`700 100px ${fontCss}`);
      } catch {
        // Si falla, se rasteriza con el fallback del sistema
      }
      if (!cancelled) setFontVersion((v) => v + 1);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [fontCss]);

  useEffect(() => {
    if (isUndoRedo) return;

    // Foto completa del editor en este momento: configuración de la
    // pestaña + escena. Los objetos van por referencia: nunca se mutan
    // in place (todas las actualizaciones crean arrays/objetos nuevos),
    // así que restaurar esta foto es seguro y no gasta memoria extra.
    const capture = (): HistoryState => ({
      views,
      editedVertices,
      text,
      fontCss,
      textDepth,
      hollowText,
      greedyMesh,
      textRes,
      textOpacity,
      viewsOpacity,
      extrudeDepth,
      extrudeHoles,
      textMode,
      useFontColor,
      baseColor,
      figureColor,
      texture,
      latheTexture,
      textureProjection,
      textureFinish,
      textureRelief,
      textureRepeat,
      resolution,
      meshStyle,
      meshSilhouette,
      meshSections,
      meshSilhouetteView,
      meshSideView,
      meshOpacity,
      latheProfile,
      latheOpacity,
      latheSegments,
      latheClamp,
      latheFigureColor,
      sceneObjects,
      selectedObjectId,
      configObjectId,
      polylines,
    });

    if (history.length === 0 && historyIndex === -1) {
      setHistory([capture()]);
      setHistoryIndex(0);
    }

    const timer = setTimeout(() => {
      const currentState = capture();

      const lastState = history[historyIndex];
      if (lastState) {
        const same = (a: unknown, b: unknown) =>
          JSON.stringify(a) === JSON.stringify(b);
        // La escena se compara por referencia: sus actualizaciones son
        // inmutables, así que mismo array ⇒ mismo contenido. Comparar
        // las mallas valor a valor sería muy costoso.
        const sceneSame =
          lastState.sceneObjects === currentState.sceneObjects &&
          lastState.selectedObjectId === currentState.selectedObjectId &&
          lastState.configObjectId === currentState.configObjectId;
        const isSame =
          sceneSame &&
          same(lastState.views, currentState.views) &&
          same(lastState.editedVertices, currentState.editedVertices) &&
          lastState.text === currentState.text &&
          lastState.fontCss === currentState.fontCss &&
          lastState.textDepth === currentState.textDepth &&
          lastState.hollowText === currentState.hollowText &&
          lastState.greedyMesh === currentState.greedyMesh &&
          lastState.textRes === currentState.textRes &&
          lastState.textOpacity === currentState.textOpacity &&
          lastState.viewsOpacity === currentState.viewsOpacity &&
          lastState.extrudeDepth === currentState.extrudeDepth &&
          same(lastState.extrudeHoles ?? [], currentState.extrudeHoles ?? []) &&
          lastState.textMode === currentState.textMode &&
          lastState.useFontColor === currentState.useFontColor &&
          lastState.baseColor === currentState.baseColor &&
          lastState.figureColor === currentState.figureColor &&
          lastState.texture === currentState.texture &&
          lastState.latheTexture === currentState.latheTexture &&
          lastState.textureProjection === currentState.textureProjection &&
          lastState.textureFinish === currentState.textureFinish &&
          lastState.textureRelief === currentState.textureRelief &&
          lastState.resolution === currentState.resolution &&
          lastState.meshStyle === currentState.meshStyle &&
          same(lastState.meshSilhouette, currentState.meshSilhouette) &&
          same(lastState.meshSections, currentState.meshSections) &&
          lastState.meshSilhouetteView === currentState.meshSilhouetteView &&
          same(lastState.meshSideView, currentState.meshSideView) &&
          lastState.meshOpacity === currentState.meshOpacity &&
          same(lastState.latheProfile, currentState.latheProfile) &&
          lastState.latheOpacity === currentState.latheOpacity &&
          lastState.latheSegments === currentState.latheSegments &&
          lastState.latheClamp === currentState.latheClamp &&
          lastState.latheFigureColor === currentState.latheFigureColor &&
          same(lastState.polylines, currentState.polylines);

        if (isSame) return;
      }

      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(currentState);

      while (newHistory.length > 50) {
        newHistory.shift();
      }

      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }, 500);

    return () => clearTimeout(timer);
  }, [
    views,
    editedVertices,
    text,
    fontCss,
    textDepth,
    hollowText,
    greedyMesh,
    textRes,
    textOpacity,
    viewsOpacity,
    extrudeDepth,
    extrudeHoles,
    textMode,
    useFontColor,
    baseColor,
    figureColor,
    texture,
    latheTexture,
    textureProjection,
     textureFinish,
     textureRelief,
     textureRepeat,
     resolution,
    meshStyle,
    meshSilhouette,
    meshSections,
    meshSilhouetteView,
    meshSideView,
    meshOpacity,
    latheProfile,
    latheOpacity,
    latheSegments,
    latheClamp,
    latheFigureColor,
    sceneObjects,
    selectedObjectId,
    configObjectId,
    polylines,
    history,
    historyIndex,
    isUndoRedo,
  ]);

  // Restaura una foto del historial: configuración de la pestaña Y
  // escena completa (objetos con sus instantáneas, selección y dueño
  // de la configuración). Deshacer/rehacer vuelven a dejar el editor
  // exactamente como estaba en ese momento.
  const applyHistoryState = useCallback((state: HistoryState) => {
    setViews(state.views);
    setEditedVertices(state.editedVertices);
    setText(state.text);
    setFontCss(state.fontCss);
    setTextDepth(state.textDepth);
    setHollowText(state.hollowText);
    setGreedyMesh(state.greedyMesh);
    setTextRes(state.textRes);
    setTextOpacity(state.textOpacity);
    setViewsOpacity(state.viewsOpacity);
    setExtrudeDepth(state.extrudeDepth);
    setExtrudeHoles(state.extrudeHoles ?? []);
    setTextMode(state.textMode);
    setBaseColor(state.baseColor);
    setFigureColor(state.figureColor);
    setTexture(state.texture);
    setTextureFileName(state.texture ? 'textura-cargada' : '');
    setLatheTexture(state.latheTexture);
    setLatheTextureFileName(state.latheTexture ? 'textura-cargada' : '');
    setTextureProjection(state.textureProjection);
    setTextureFinish(state.textureFinish);
    setTextureRelief(state.textureRelief);
    setResolution(state.resolution);
    setMeshStyle(state.meshStyle);
    setMeshSilhouette(state.meshSilhouette);
    setMeshSections(state.meshSections);
    setMeshSilhouetteView(state.meshSilhouetteView);
    setMeshSideView(state.meshSideView);
    setMeshOpacity(state.meshOpacity);
    setLatheProfile(state.latheProfile);
    setLatheOpacity(state.latheOpacity);
    setLatheSegments(state.latheSegments);
    setLatheClamp(state.latheClamp);
    setLatheFigureColor(state.latheFigureColor);
    setSceneObjects(state.sceneObjects);
    setSelectedObjectId(state.selectedObjectId);
    setConfigObjectId(state.configObjectId);
    // Fotos antiguas sin polilíneas: se restauran como lienzo vacío
    setPolylines(state.polylines ?? {});
  }, []);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;

    setIsUndoRedo(true);
    const prevState = history[historyIndex - 1];
    if (prevState) {
      applyHistoryState(prevState);
      setHistoryIndex(historyIndex - 1);
    }
    setTimeout(() => setIsUndoRedo(false), 50);
  }, [history, historyIndex, applyHistoryState]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;

    setIsUndoRedo(true);
    const nextState = history[historyIndex + 1];
    if (nextState) {
      applyHistoryState(nextState);
      setHistoryIndex(historyIndex + 1);
    }
    setTimeout(() => setIsUndoRedo(false), 50);
  }, [history, historyIndex, applyHistoryState]);

  // Viewport control functions
  const panView = useCallback((view: keyof Views, dx: number, dy: number) => {
    setViewports((prev) => {
      const vp = { ...prev[view] };
      vp.offsetX += (dx * 0.1) / vp.zoom;
      vp.offsetY += (dy * 0.1) / vp.zoom;
      return { ...prev, [view]: vp };
    });
  }, []);

  const zoomView = useCallback((view: keyof Views, factor: number) => {
    setViewports((prev) => {
      const vp = { ...prev[view] };
      vp.zoom *= factor;
      return { ...prev, [view]: vp };
    });
  }, []);

  const orbit3D = useCallback(
    (
      panel: 'front' | 'top' | 'side' | '3d',
      axis: 'left' | 'up',
      degrees: number
    ) => {
      setPanelCameras((prev) => {
        const newState = { ...prev };
        const cam = { ...newState[panel] };
        if (axis === 'left') {
          cam.rotationY += degrees * (Math.PI / 180);
        } else {
          cam.rotationX += degrees * (Math.PI / 180);
        }
        newState[panel] = cam;
        return newState;
      });
    },
    []
  );

  const pan3D = useCallback(
    (panel: 'front' | 'top' | 'side' | '3d', dx: number, dy: number) => {
      setPanelCameras((prev) => {
        const newState = { ...prev };
        const cam = { ...newState[panel] };

        if (panel === 'front') {
          cam.offsetX -= dx;
          cam.offsetY += dy;
        } else if (panel === 'top') {
          // Top view: camera looks down -Y. Moving target +Z makes object appear UP on screen.
          // ▼ (Adelante, dy=+5): want object to move DOWN on screen → target must move -Z → offsetY -= dy
          // ▲ (Atrás, dy=-5): want object to move UP on screen → target must move +Z → offsetY -= dy
          cam.offsetX -= dx;
          cam.offsetY += dy;
        } else if (panel === 'side') {
          // Side view: invertir dx para que ◀ = adelante, ▶ = atrás
          cam.offsetX -= dx;
          cam.offsetY += dy;
        } else {
          // 3D free view: invert only dy (up/down reversed)
          cam.offsetX -= dx;
          cam.offsetY += dy;
        }

        newState[panel] = cam;
        return newState;
      });
    },
    []
  );

  const zoom3D = useCallback(
    (panel: 'front' | 'top' | 'side' | '3d', factor: number) => {
      setPanelCameras((prev) => {
        const newState = { ...prev };
        const cam = { ...newState[panel] };
        cam.zoom *= factor;
        newState[panel] = cam;
        return newState;
      });
    },
    []
  );

  /**
   * Callback que recibe el Viewer3D cuando el usuario mueve la cámara con el
   * ratón (OrbitControls). Sincroniza panelCameras con la posición real de la
   * cámara para que los botones ▲▼◀▶ siempre partan desde donde está ahora.
   */
  const handleCameraChange = useCallback(
    (panel: 'front' | 'top' | 'side' | '3d', cam: Camera3D) => {
      setPanelCameras((prev) => ({
        ...prev,
        [panel]: cam,
      }));
    },
    []
  );

  const handleCameraMoveForRecording = useCallback(
    (cam: Camera3D) => {
      if (!isRecordingCameraPath) return;
      const now = Date.now();
      const elapsed = (now - recordingStartTimeRef.current) / 1000;
      setCameraPathKeyframes((prev) => {
        if (prev.length > 0) {
          const last = prev[prev.length - 1];
          if (elapsed - last.time < 0.016) return prev;
        }
        return [...prev, { time: elapsed, camera: cam }];
      });
    },
    [isRecordingCameraPath]
  );

  const startCameraPathRecording = useCallback(() => {
    setCameraPathKeyframes([]);
    recordingStartTimeRef.current = Date.now();
    setIsRecordingCameraPath(true);
  }, []);

  const moveCameraByArrowKey = useCallback(
    (direction: 'left' | 'right' | 'forward' | 'backward') => {
      const cam = panelCameras['3d'];
      if (!cam) return;
      const step = 0.1;
      const rotationY = cam.rotationY;
      const forward = new THREE.Vector3(
        Math.sin(rotationY),
        0,
        Math.cos(rotationY)
      ).normalize();
      const right = new THREE.Vector3(
        Math.sin(rotationY + Math.PI / 2),
        0,
        Math.cos(rotationY + Math.PI / 2)
      ).normalize();
      let delta = new THREE.Vector3();
      if (direction === 'left') delta = right.clone().multiplyScalar(-step);
      else if (direction === 'right') delta = right.clone().multiplyScalar(step);
      else if (direction === 'forward') delta = forward.clone().multiplyScalar(-step);
      else if (direction === 'backward') delta = forward.clone().multiplyScalar(step);
      const newCam = {
        ...cam,
        offsetX: cam.offsetX + delta.x,
        offsetY: cam.offsetY + delta.y,
      };
      setPanelCameras((prev) => ({
        ...prev,
        '3d': newCam,
      }));
      if (isRecordingCameraPath) {
        handleCameraMoveForRecording(newCam);
      }
    },
    [panelCameras, isRecordingCameraPath, handleCameraMoveForRecording]
  );

  useEffect(() => {
    if (!isRecordingCameraPath) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (e.key === 'ArrowLeft') moveCameraByArrowKey('left');
      else if (e.key === 'ArrowRight') moveCameraByArrowKey('right');
      else if (e.key === 'ArrowUp') moveCameraByArrowKey('forward');
      else if (e.key === 'ArrowDown') moveCameraByArrowKey('backward');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecordingCameraPath, moveCameraByArrowKey]);

  const stopCameraPathRecording = useCallback(() => {
    setIsRecordingCameraPath(false);
    const duration = cameraPathKeyframes.length > 0
      ? cameraPathKeyframes[cameraPathKeyframes.length - 1].time
      : 3;
    if (cameraPathKeyframes.length < 2) return;
    const keyframes = cameraPathKeyframes.map((kf) => ({
      time: kf.time,
      properties: {
        zoom: kf.camera.zoom,
        offsetX: kf.camera.offsetX,
        offsetY: kf.camera.offsetY,
        rotationX: kf.camera.rotationX,
        rotationY: kf.camera.rotationY,
      },
    }));
       const newTrack: AnimationTrack = {
       id: `camerapath_${Date.now()}`,
       name: 'Recorrido de cámara',
       objectId: null,
        duration: duration * 1000,
       looping: false,
       keyframes: cameraPathKeyframes.map((kf) => ({
          time: kf.time * 1000,
         values: {
           zoom: kf.camera.zoom,
           offsetX: kf.camera.offsetX,
           offsetY: kf.camera.offsetY,
           rotationX: kf.camera.rotationX,
           rotationY: kf.camera.rotationY,
         },
         easing: 'ease-in-out' as any,
       })),
     };
     setAnimationTracks((prev) => [...prev, newTrack]);
     setSelectedTrackId(newTrack.id);
   }, [cameraPathKeyframes]);

   const handleCameraGizmoMove = useCallback(
     (keyframes: Keyframe[]) => {
       setAnimationTracks((prev) =>
         prev.map((track) => {
           if (track.objectId !== null) return track;
           return { ...track, keyframes };
         })
       );
     },
     []
   );

   const ensureStylesheet = useCallback((url: string, key: string) => {
    return new Promise<void>((resolve) => {
      if (document.querySelector(`link[data-gfont="${key}"]`)) return resolve();
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.dataset.gfont = key;
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.appendChild(link);
    });
  }, []);

  const importFont = useCallback(async () => {
    const raw = customFontName.trim().replace(/['"]/g, '');
    if (!raw || importing) return;

    const preset = FONT_OPTIONS.find(
      (f) => f.label.toLowerCase() === raw.toLowerCase()
    );
    if (preset) {
      setFontCss(preset.css);
      setEditedVertices(null);
      setImportMsg({ ok: true, text: `"${raw}" ya estaba en la lista` });
      return;
    }

    const family = raw.split(/\s+/).filter(Boolean).join('+');
    const cssName = `'${raw}', sans-serif`;

    setImporting(true);
    setImportMsg(null);

    try {
      await ensureStylesheet(
        `https://fonts.googleapis.com/css2?family=${family}:wght@400;700&display=swap`,
        `${family}-w`
      );
      let faces = await document.fonts.load(`700 100px ${cssName}`);

      if (faces.length === 0) {
        await ensureStylesheet(
          `https://fonts.googleapis.com/css2?family=${family}&display=swap`,
          family
        );
        faces = await document.fonts.load(`700 100px ${cssName}`);
      }

      if (faces.length === 0) {
        throw new Error('font-not-found');
      }

      setCustomFonts((prev) =>
        prev.some((f) => f.label.toLowerCase() === raw.toLowerCase())
          ? prev
          : [...prev, { label: raw, css: cssName, google: true }]
      );
      setFontCss(cssName);
      setEditedVertices(null);
      setImportMsg({ ok: true, text: `"${raw}" importada y seleccionada` });
    } catch {
      setImportMsg({
        ok: false,
        text: 'No se encontró esa fuente en Google Fonts',
      });
    } finally {
      setImporting(false);
    }
  }, [customFontName, importing, ensureStylesheet]);

  const openGoogleFonts = useCallback(() => {
    window.open('https://fonts.google.com', '_blank', 'noopener,noreferrer');
  }, []);

  const handleLocalFontFile = useCallback(async (file: File) => {
    if (!file) return;
    setLocalFontLoading(true);
    setLocalFontMsg(null);

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        const slice = bytes.subarray(i, i + chunk);
        for (let j = 0; j < slice.length; j++) {
          binary += String.fromCharCode(slice[j]);
        }
      }
      const base64 = btoa(binary);

      const ext = file.name.replace(/^.*\./, '').toLowerCase();
      const baseName =
        file.name
          .replace(/\.[^.]*$/, '')
          .replace(/[^\w\s-]/g, '')
          .trim() || 'Fuente local';
      const familyName = `LocalFont-${baseName.replace(/\s+/g, '')}`;

      const styleId = `local-font-${familyName}`;
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `@font-face {
  font-family: '${familyName}';
  src: url(data:font/${ext};base64,${base64}) format('truetype');
}`;
        document.head.appendChild(style);
      }

      const cssName = `'${familyName}', sans-serif`;
      await document.fonts.load(`700 100px ${cssName}`);
      if (!document.fonts.check(`700 100px ${cssName}`)) {
        throw new Error('font-load-failed');
      }

      setCustomFonts((prev) =>
        prev.some((f) => f.label === baseName)
          ? prev
          : [...prev, { label: baseName, css: cssName }]
      );
      setFontCss(cssName);
      setEditedVertices(null);
      setLocalFontMsg({
        ok: true,
        text: `"${baseName}" cargada desde tu dispositivo`,
      });
    } catch {
      setLocalFontMsg({
        ok: false,
        text: 'No se pudo cargar la fuente (formato no soportado)',
      });
    } finally {
      setLocalFontLoading(false);
    }
  }, []);

  const openLocalFontPicker = useCallback(() => {
    localFontInputRef.current?.click();
  }, []);

  const handleTextureFile = useCallback(
    async (file: File) => {
      if (!file) return;
      try {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          const slice = bytes.subarray(i, i + chunk);
          for (let j = 0; j < slice.length; j++) {
            binary += String.fromCharCode(slice[j]);
          }
        }
        const base64 = btoa(binary);
        const dataUrl = `data:image/${file.type};base64,${base64}`;

        if (mode === 'lathe') {
          setLatheTexture(dataUrl);
          setLatheTextureFileName(file.name);
        } else {
          setTexture(dataUrl);
          setTextureFileName(file.name);
        }
        setEditedVertices(null);
      } catch (error) {
        console.error('Error al cargar la textura:', error);
      }
    },
    [mode]
  );

  const openTexturePicker = useCallback(() => {
    textureInputRef.current?.click();
  }, []);

  const handleTextureSelect = useCallback(
    (dataUrl: string, fileName: string) => {
      if (mode === 'lathe') {
        setLatheTexture(dataUrl);
        setLatheTextureFileName(fileName);
      } else {
        setTexture(dataUrl);
        setTextureFileName(fileName);
      }
      setEditedVertices(null);
    },
    [mode]
  );

  const clearTexture = useCallback(() => {
    if (mode === 'lathe') {
      setLatheTexture(null);
      setLatheTextureFileName('');
    } else {
      setTexture(null);
      setTextureFileName('');
    }
    setEditedVertices(null);
  }, [mode]);

  /**
   * Importa una imagen PNG y la convierte en un polígono de contorno.
   * El nivel de detalle (0-100) controla el tamaño de rasterización:
   * - 0% -> 64px máximo (pocos vértices)
   * - 50% -> 256px
   * - 100% -> tamaño original (máx 1024px)
   * El polígono resultante se escala y centra en el espacio 0..1.
   */
  const importPngToPolygon = useCallback(
    async (file: File): Promise<{ outer: Polygon[]; inner: Polygon[] }> => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const level = Math.max(0, Math.min(100, importDetailLevel));
            const origMaxDim = Math.max(img.width, img.height);
            const rasterMaxDim =
              level <= 0
                ? 64
                : level >= 100
                  ? Math.min(origMaxDim, 1024)
                  : Math.round(
                      64 + (level / 100) * (Math.min(origMaxDim, 1024) - 64)
                    );
            const scale = origMaxDim > 0 ? rasterMaxDim / origMaxDim : 1;
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve({ outer: [], inner: [] });
            ctx.drawImage(img, 0, 0, w, h);
            const imageData = ctx.getImageData(0, 0, w, h);
            const filled = new Uint8Array(w * h);
            for (let i = 0; i < w * h; i++) {
              if (imageData.data[i * 4 + 3] > 128) {
                filled[i] = 1;
              }
            }

            const isFilled = (x: number, y: number) => {
              if (x < 0 || x >= w || y < 0 || y >= h) return false;
              return filled[y * w + x] === 1;
            };

            const dirs8: [number, number][] = [
              [0, -1],  // N
              [1, -1],  // NE
              [1, 0],   // E
              [1, 1],   // SE
              [0, 1],   // S
              [-1, 1],  // SW
              [-1, 0],  // W
              [-1, -1], // NW
            ];

            const visited = new Uint8Array(w * h);

            const floodFill = (startX: number, startY: number) => {
              const queue: [number, number][] = [[startX, startY]];
              visited[startY * w + startX] = 1;
              while (queue.length > 0) {
                const [cx, cy] = queue.pop()!;
                for (const [dx, dy] of dirs8) {
                  const nx = cx + dx;
                  const ny = cy + dy;
                  if (
                    nx >= 0 &&
                    nx < w &&
                    ny >= 0 &&
                    ny < h &&
                    filled[ny * w + nx] === 1 &&
                    visited[ny * w + nx] === 0
                  ) {
                    visited[ny * w + nx] = 1;
                    queue.push([nx, ny]);
                  }
                }
              }
            };

            const traceContour = (startX: number, startY: number) => {
              const trace: { x: number; y: number }[] = [];
              let x = startX;
              let y = startY;
              let backtrack = 6;

              do {
                trace.push({ x, y });
                let found = false;
                for (let i = 1; i <= 8; i++) {
                  const d = (backtrack + i) % 8;
                  const nx = x + dirs8[d][0];
                  const ny = y + dirs8[d][1];
                  if (isFilled(nx, ny)) {
                    backtrack = (d + 4) % 8;
                    x = nx;
                    y = ny;
                    found = true;
                    break;
                  }
                }
                if (!found) break;
              } while (x !== startX || y !== startY);

              return trace;
            };

            const simplifyContour = (trace: { x: number; y: number }[]): { x: number; y: number }[] => {
              if (trace.length <= 2) return trace;

              const maxPoints = Math.max(
                32,
                Math.round((importDetailLevel / 100) * 512)
              );
              const step = Math.max(1, Math.floor(trace.length / maxPoints));
              const sampled: { x: number; y: number }[] = [];
              for (let i = 0; i < trace.length; i += step) {
                sampled.push(trace[i]);
              }
              if (
                sampled[sampled.length - 1].x !== trace[trace.length - 1].x ||
                sampled[sampled.length - 1].y !== trace[trace.length - 1].y
              ) {
                sampled.push(trace[trace.length - 1]);
              }

              const epsilon = Math.max(
                0.3,
                2.5 - (importDetailLevel / 100) * 2.2
              );
              return douglasPeuckerContour(sampled, epsilon);
            };

            const isPointInPolygon = (
              px: number,
              py: number,
              poly: Polygon
            ): boolean => {
              let inside = false;
              for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                if (
                  (poly[i].y > py) !== (poly[j].y > py) &&
                  px <
                    ((poly[j].x - poly[i].x) * (py - poly[i].y)) /
                      (poly[j].y - poly[i].y) +
                    poly[i].x
                ) {
                  inside = !inside;
                }
              }
              return inside;
            };

            const rawContours: Polygon[] = [];
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                if (
                  filled[y * w + x] === 1 &&
                  visited[y * w + x] === 0
                ) {
                  const trace = traceContour(x, y);
                  floodFill(x, y);
                  if (trace.length > 2) {
                    const simplified = simplifyContour(trace);
                    const maxDim = Math.max(w, h);
                    const rawPoly: Polygon = simplified.map((p) => ({
                      x: p.x / maxDim,
                      y: p.y / maxDim,
                    }));
                    rawContours.push(rawPoly);
                  }
                }
              }
            }

            if (rawContours.length === 0) {
              resolve({ outer: [], inner: [] });
              return;
            }

            // Centrar todos los contornos juntos
            let minX = Infinity,
              minY = Infinity,
              maxX = -Infinity,
              maxY = -Infinity;
            for (const poly of rawContours) {
              for (const p of poly) {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
              }
            }
            const cx2 = (minX + maxX) / 2;
            const cy2 = (minY + maxY) / 2;
            const centeredContours = rawContours.map((poly) =>
              poly.map((p) => ({
                x: p.x - cx2 + 0.5,
                y: p.y - cy2 + 0.5,
              }))
            );

            // Clasificar contornos como outer/inner usando even-odd rule
            // Usar el centroide de cada contorno como punto de prueba
            // (no el primer vértice que está en el borde y es inestable)
            const outer: Polygon[] = [];
            const inner: Polygon[] = [];
            for (let i = 0; i < centeredContours.length; i++) {
              const poly = centeredContours[i];
              const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
              const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
              let nestingDepth = 0;
              for (let j = 0; j < centeredContours.length; j++) {
                if (i === j) continue;
                if (isPointInPolygon(cx, cy, centeredContours[j])) {
                  nestingDepth++;
                }
              }
              if (nestingDepth % 2 === 0) {
                outer.push(poly);
              } else {
                inner.push(poly);
              }
            }

            resolve({ outer, inner });
          };
          img.onerror = () => resolve({ outer: [], inner: [] });
          img.src = e.target?.result as string;
        };
        reader.onerror = () => resolve({ outer: [], inner: [] });
        reader.readAsDataURL(file);
      });
    },
    [importDetailLevel]
  );

   const handlePngImport = useCallback(
     async (file: File) => {
       if (!file || !file.type.startsWith('image/')) return;
        const { outer, inner } = await importPngToPolygon(file);
        if (outer.length === 0) return;

        // El polígono principal es el contorno exterior más grande
        outer.sort((a, b) => polygonArea(b) - polygonArea(a));
        const mainPoly = outer[0];
        const otherOuter = outer.slice(1);

       setEditedVertices(null);
       setExtrudeHoles([]);

       if (mode === 'views') {
         const key = editingViewProfile ?? 'front';
         setViews((prev) => ({ ...prev, [key]: mainPoly }));
        } else if (mode === 'extrude') {
          setViews((prev) => ({ ...prev, front: mainPoly }));

          // Agujeros interiores que están dentro del polígono principal
          const mainHoles = inner.filter((holePoly) => {
            const testPt = holePoly[0];
            return pointInPolygon(testPt, mainPoly);
          });

          // Otros contornos exteriores → objetos 3D separados
          const otherOuterLines = otherOuter.map((poly) => ({
            id: newPolylineId(),
            points: poly,
          }));

          // Combinar todo en una sola actualización: holes + shapes extras
          const newHoles = mainHoles.map((holePoly) => ({
            id: newPolylineId(),
            points: holePoly,
          }));
          setPolylines((prev) => ({
            ...prev,
            'views:front': [
              ...(prev['views:front'] ?? []),
              ...newHoles,
              ...otherOuterLines,
            ],
          }));
          setExtrudeHoles(
            Array.from(new Set([...newHoles.map((l) => l.id)]))
          );
        } else if (mode === 'lathe') {
         setLatheProfile(mainPoly);
       } else if (mode === 'mesh') {
         if (editingMeshProfile === 'silhouette') {
           setMeshSilhouette(mainPoly);
         } else if (editingMeshProfile === 'side') {
           setMeshSideView(mainPoly);
         } else if (
           editingMeshProfile &&
           typeof editingMeshProfile === 'string'
         ) {
           setMeshSections((prev) =>
             prev.map((s) =>
               s.id.toString() === editingMeshProfile
                 ? { ...s, polygon: mainPoly }
                 : s
             )
           );
         }
       }
     },
      [mode, editingViewProfile, editingMeshProfile, importPngToPolygon]
   );

  const allFonts = useMemo(
    () => [...FONT_OPTIONS, ...customFonts],
    [customFonts]
  );

  const baseMesh = useMemo<Mesh>(() => {
    if (mode === 'text') {
      if (textMode === 'plane') {
        const result = buildTextPlaneMesh({
          text,
          fontFamily: fontCss,
          resolution: textRes,
          baseColor,
          useFontColor,
        });

        if (texture) {
          result.texture = texture;
          result.textureColor = '#ffffff';
          result.textureRelief = textureRelief;
          result.textureFinish = textureFinish;
          result.faceColors = undefined;
        } else {
          result.textureFinish = textureFinish;
        }
        return result;
      }

      const m =
        textMode === 'smooth'
          ? buildSmoothTextMesh({
              text,
              fontFamily: fontCss,
              resolution: textRes,
              depth: textDepth,
              baseColor,
              useFontColor,
              opacity: textOpacity,
            })
          : buildTextMesh({
              text,
              fontFamily: fontCss,
              resolution: textRes,
              depth: textDepth,
              hollow: hollowText,
              greedy: greedyMesh,
            });

      if (texture) {
        m.texture = texture;
        m.textureColor = '#ffffff';
        m.textureRelief = textureRelief;
        m.textureFinish = textureFinish;
        m.faceColors = undefined;
      } else {
        m.textureFinish = textureFinish;
        if (m.faceColors && m.faceColors.length > 0) {
          const hasRealColor = m.faceColors.some(
            (c) => c !== null && !isNearWhite(c)
          );
          if (!useFontColor || !hasRealColor) {
            m.faceColors = m.faceColors.map(() => baseColor);
          }
        }
      }
      console.log('🔍 MESH TEXTO:', {
        textMode,
        tieneTextura: !!m.texture,
        opacity: m.opacity,
        textOpacity,
        faceColors: m.faceColors?.length,
        faceOpacities: m.faceOpacities?.length,
        primeraFaceOpacity: m.faceOpacities?.[0],
        ultimaFaceOpacity: m.faceOpacities?.[m.faceOpacities.length - 1],
      });

      return m;
    }

    if (mode === 'lathe') {
      if (latheProfile.length < 3) {
        return { vertices: [], faces: [] as number[][] };
      }

      const mesh = buildLatheMesh(
        latheProfile,
        latheSegments,
        latheClamp,
        textureProjection
      );
      mesh.opacity = latheOpacity;
      if (latheTexture) {
        mesh.texture = latheTexture;
        mesh.textureColor = '#ffffff';
        mesh.textureRelief = textureRelief;
        mesh.textureFinish = textureFinish;
      } else {
        if (mesh.faces) {
          mesh.faceColors = mesh.faces.map(() => latheFigureColor);
        }
      }
      return mesh;
    }

    if (mode === 'mesh') {
      if (meshSilhouette.length < 3 || meshSections.length < 2) {
        return { vertices: [], faces: [] as number[][] };
      }

      const meshViews = meshInputToViews(
        appliedMeshSilhouette,
        meshSections,
        appliedMeshSideView
      );

      const sections = meshSections
        .filter((s) => s.polygon.length >= 3)
        .map((s) => ({ y: 1 - s.y, polygon: s.polygon }));

      const allHaveShapes =
        meshViews.front.length >= 3 &&
        meshViews.side.length >= 3 &&
        meshViews.top.length >= 3;
      if (!allHaveShapes) {
        return { vertices: [], faces: [] as number[][] };
      }

      let m: Mesh;
      if (meshStyle === 'suave') {
        m = buildViewsMesh(meshViews, {
          levels: Math.min(120, Math.max(48, resolution + 16)), // Aumentado para mejor detalle en curvas
          samples: Math.min(128, Math.max(48, resolution * 3)),
          sections,
        });
      } else {
        const res =
          meshStyle === 'fusionada'
            ? Math.max(HIGH_FIDELITY_RES, resolution)
            : resolution;
        const solid = reconstructVoxels(meshViews, res, sections);
        m = voxelsToBoxMesh(
          solid.voxels,
          res,
          meshStyle === 'fusionada',
          solid.yModel
        );
      }

      // Transparencia del objeto 3D (mando aparte de las plantillas).
      m.opacity = meshOpacity;

      if (texture) {
        m = {
          ...m,
          texture,
          textureColor: '#ffffff',
          textureRelief,
          textureRepeat,
          textureFinish,
        };
      } else if (m.faces) {
        m.faceColors = m.faces.map(() => figureColor);
      }
      return m;
    }

    const allHaveShapes =
      mode === 'extrude'
        ? views.front.length >= 3
        : views.front.length >= 3 &&
          views.side.length >= 3 &&
          views.top.length >= 3;

    if (!allHaveShapes) {
      return { vertices: [], faces: [] as number[][] };
    }

     let mesh;
    if (mode === 'extrude') {
      // Recolecta el polígono principal más las polilíneas cerradas
      // dibujadas con la herramienta Línea: todas se extruyen juntas.
      const frontPolylines = getPolylines('views:front');
      const shapes: Polygon[] = [views.front];
      const holes: Polygon[] = [];
      for (const line of frontPolylines) {
        const poly = polylineToPolygon(line);
        if (!poly) continue;
        // Si está marcada como agujero, resta del prisma principal
        if (extrudeHoles.includes(line.id)) {
          holes.push(poly);
        } else {
          shapes.push(poly);
        }
      }
      mesh = buildExtrudeMeshes(shapes, extrudeDepth, holes);
    } else if (meshStyle === 'suave') {
      mesh = buildViewsMesh(views, {
        levels: Math.min(72, Math.max(24, resolution + 8)),
        samples: Math.min(128, Math.max(48, resolution * 3)),
      });
    } else {
      const res =
        meshStyle === 'fusionada'
          ? Math.max(HIGH_FIDELITY_RES, resolution)
          : resolution;
      const solid = reconstructVoxels(views, res);
      mesh = voxelsToBoxMesh(
        solid.voxels,
        res,
        meshStyle === 'fusionada',
        solid.yModel
      );
    }

    if ((mode === 'views' || mode === 'extrude') && mesh.faces) {
      // Transparencia del objeto de la pestaña Vistas (mando aparte de
      // los lienzos de dibujo).
      mesh = { ...mesh, opacity: viewsOpacity };
      if (texture) {
        mesh = {
          ...mesh,
          texture: texture,
          textureColor: '#ffffff',
          textureRelief: textureRelief,
          textureRepeat: textureRepeat,
          textureFinish: textureFinish,
        };
      } else {
        mesh = {
          ...mesh,
          faceColors: mesh.faces.map(() => figureColor),
        };
      }
    }

    return mesh;
  }, [
    mode,
    text,
    fontCss,
    textRes,
    textDepth,
    hollowText,
     greedyMesh,
    views,
    polylines,
    resolution,
    meshStyle,
    fontVersion,
    useFontColor,
    baseColor,
    textMode,
    textOpacity,
    viewsOpacity,
    extrudeDepth,
    extrudeHoles,
    figureColor,
    texture,
     textureProjection,
     textureRelief,
     textureRepeat,
     textureFinish,
    latheProfile,
    latheSegments,
    latheClamp,
    latheFigureColor,
    latheTexture,
    latheOpacity,
    meshSilhouette,
    meshSections,
    meshSilhouetteView,
    meshSideView,
    meshOpacity,
  ]);

  const mesh = useMemo(() => {
    if (editedVertices && editedVertices.length === baseMesh.vertices.length) {
      return {
        ...baseMesh,
        vertices: editedVertices,
      };
    }
    return baseMesh;
  }, [baseMesh, editedVertices]);

  const triMesh = useMemo(() => meshToTriangles(mesh), [mesh]);
  // Objeto pendiente de eliminar: al pulsar el botón se guarda aquí y el
  // diálogo pide confirmación antes de quitarlo de la escena.
  const [objectToDelete, setObjectToDelete] = useState<string | null>(null);
  // Modal para operaciones booleanas (sustraer, unir, intersecar)
  const [booleanModalOpen, setBooleanModalOpen] = useState<boolean>(false);
  const [booleanPreview, setBooleanPreview] = useState<boolean>(false);
  const [booleanToolObjectId, setBooleanToolObjectId] = useState<string | null>(null);
  const [booleanPreviewLive, setBooleanPreviewLive] = useState<boolean>(false);
  const [pendingBooleanOp, setPendingBooleanOp] = useState<{
    baseObjectId: string;
    toolObjectId: string;
    operation: BooleanOperationType;
    deleteToolObject: boolean;
  } | null>(null);
  const [booleanPreviewTick, setBooleanPreviewTick] = useState(0);

  const smoothShadingValue =
    ((mode === 'views' || mode === 'mesh' || mode === 'extrude') &&
      meshStyle === 'suave') ||
    (mode === 'text' && textMode === 'smooth') ||
    (mode === 'lathe' && meshStyle === 'suave');

  // El objeto seleccionado puede ser una copia pegada/congelada (no el
  // dueño de la configuración). En ese caso la pieza que se muestra y se
  // edita en el visor es SU instantánea, no la malla de la
  // configuración: así no se convierte en la figura de la pestaña al
  // tocar cualquier control.
  const selectedSceneObject = sceneObjects.find(
    (object) => object.id === selectedObjectId
  );
  const frozenSelected =
    selectedSceneObject &&
    selectedSceneObject.id !== configObjectId &&
    selectedSceneObject.mesh &&
    selectedSceneObject.mesh.vertices.length > 0
      ? selectedSceneObject
      : null;
  const frozenSelectedId = frozenSelected?.id ?? null;
  const viewerMesh = frozenSelected ? frozenSelected.mesh! : triMesh;
  const viewerSmooth = frozenSelected
    ? (frozenSelected.smooth ?? false)
    : smoothShadingValue;
  const viewerProjection = frozenSelected
    ? (frozenSelected.textureProjection ?? 'planar')
    : textureProjection;

  const visibleSceneObjects = useMemo(() => sceneObjects, [sceneObjects]);

  const updateView = useCallback(
    (key: keyof Views) => (poly: Polygon) => {
      setViews((prev) => ({ ...prev, [key]: poly }));
      setEditedVertices(null);
    },
    []
  );

  const handleVerticesChange = useCallback((verts: Vertex3D[]) => {
    setEditedVertices(verts);
  }, []);

  const openSaveModal = useCallback(() => {
    setObjectName(
      mode === 'text' ? text.trim().slice(0, 30) || 'texto-3d' : 'figura-3d'
    );
    setSaveMsg(null);
    setSaveModalOpen(true);
  }, [mode, text]);

  // Captura la configuración COMPLETA del panel (todas las plantillas,
  // colores, textos, texturas y polilíneas): es lo que se congela con
  // cada objeto al dejar de ser el dueño y lo que se guarda en su
  // archivo .zeus.
  const capturePanelConfig = useCallback(
    (): ObjectConfig => ({
      views: structuredClone(views),
      resolution,
      meshStyle,
      text,
      fontCss,
      textDepth,
      hollowText,
      greedyMesh,
      textRes,
      textOpacity,
      viewsOpacity,
      extrudeDepth,
      extrudeHoles,
      textMode,
      useFontColor,
      baseColor,
      figureColor,
      texture,
      textureProjection,
      textureFinish,
      textureRelief,
      textureRepeat,
      editedVertices: editedVertices ? structuredClone(editedVertices) : null,
      meshSilhouette: structuredClone(meshSilhouette),
      meshSections: structuredClone(meshSections),
      meshSilhouetteView,
      meshSideView: structuredClone(meshSideView),
      meshOpacity,
      latheProfile: structuredClone(latheProfile),
      latheTexture,
      latheOpacity,
      latheSegments,
      latheClamp,
      latheFigureColor,
      polylines: structuredClone(polylines),
    }),
    [
      views,
      resolution,
      meshStyle,
      text,
      fontCss,
      textDepth,
      hollowText,
      greedyMesh,
      textRes,
      textOpacity,
      viewsOpacity,
      extrudeDepth,
      extrudeHoles,
      textMode,
      useFontColor,
      baseColor,
      figureColor,
      texture,
      textureProjection,
      textureFinish,
      textureRelief,
      editedVertices,
      meshSilhouette,
      meshSections,
      meshSilhouetteView,
      meshSideView,
      meshOpacity,
      latheProfile,
      latheTexture,
      latheOpacity,
      latheSegments,
      latheClamp,
      latheFigureColor,
      polylines,
    ]
  );

  // Aplica al panel la configuración completa de un objeto: al
  // seleccionarlo en la vista 3D, al pegar, al eliminar al dueño, al
  // crear un objeto nuevo (defaults) y al cargar un archivo v3.
  // Los nombres de archivo de las texturas son cosméticos: se derivan.
  const applyObjectConfig = useCallback((config: ObjectConfig) => {
    setViews(structuredClone(config.views));
    setResolution(config.resolution);
    setMeshStyle(config.meshStyle);
    setText(config.text);
    setFontCss(config.fontCss);
    setTextDepth(config.textDepth);
    setHollowText(config.hollowText);
    setGreedyMesh(config.greedyMesh);
    setTextRes(config.textRes);
    setTextOpacity(config.textOpacity);
    setViewsOpacity(config.viewsOpacity);
    setExtrudeDepth(config.extrudeDepth);
    setExtrudeHoles(config.extrudeHoles ?? []);
    setTextMode(config.textMode);
    setUseFontColor(config.useFontColor);
    setBaseColor(config.baseColor);
    setFigureColor(config.figureColor);
    setTexture(config.texture);
    setTextureFileName(config.texture ? 'textura-objeto' : '');
     setTextureProjection(config.textureProjection);
     setTextureFinish(config.textureFinish);
     setTextureRelief(config.textureRelief);
     setTextureRepeat(config.textureRepeat ?? 1);
    setEditedVertices(
      config.editedVertices ? structuredClone(config.editedVertices) : null
    );
    setMeshSilhouette(structuredClone(config.meshSilhouette));
    setMeshSections(structuredClone(config.meshSections));
    setMeshSilhouetteView(config.meshSilhouetteView);
    setMeshSideView(structuredClone(config.meshSideView));
    setMeshOpacity(config.meshOpacity);
    setLatheProfile(structuredClone(config.latheProfile));
    setLatheTexture(config.latheTexture);
    setLatheTextureFileName(config.latheTexture ? 'textura-objeto' : '');
    setLatheOpacity(config.latheOpacity);
    setLatheSegments(config.latheSegments);
    setLatheClamp(config.latheClamp);
    setLatheFigureColor(config.latheFigureColor);
    setPolylines(structuredClone(config.polylines ?? {}));
  }, []);

  const saveObject = useCallback(async () => {
    if (savingObject) return;
    const name =
      objectName
        .trim()
        .replace(/[\\/:*?"<>|]/g, '')
        .slice(0, 60) || 'objeto-3d';

    // Lo que se guarda es el proyecto DEL DUEÑO de la configuración. Si
    // ahora mismo hay una copia pegada seleccionada, los controles de
    // textura muestran los ajustes de ESA copia: los del dueño están
    // guardados en su instantánea y de ahí se sacan.
    const frozenSaving = frozenSelectedId !== null;
    const ownerObject = configObjectId
      ? sceneObjects.find((o) => o.id === configObjectId)
      : undefined;
    const ownerMesh = ownerObject?.mesh;
    const ownerTexture = frozenSaving
      ? (ownerMesh?.texture ?? null)
      : mode === 'lathe'
        ? latheTexture
        : texture;
    const ownerProjection = frozenSaving
      ? (ownerObject?.textureProjection ?? textureProjection)
      : textureProjection;
    const ownerFinish = frozenSaving
      ? (ownerMesh?.textureFinish ?? 'semi-matte')
      : textureFinish;
    const ownerRelief = frozenSaving
      ? typeof ownerMesh?.textureRelief === 'number'
        ? ownerMesh.textureRelief
        : 0.25
      : textureRelief;

    const projectData = {
      type: 'editor3d',
      version: 3,
      mode,
      views,
      resolution,
      meshStyle,
      text,
      fontCss,
      textDepth,
      hollowText,
      greedyMesh,
      textRes,
      textOpacity,
      viewsOpacity,
      extrudeDepth,
      extrudeHoles,
      textMode,
      useFontColor,
      baseColor,
      figureColor,
      texture,
      textureProjection,
      textureFinish,
      textureRelief,
      textureRepeat,
      editedVertices,
      latheProfile,
      latheTexture: mode === 'lathe' ? ownerTexture : latheTexture,
      latheOpacity,
      latheSegments,
      latheClamp,
      latheFigureColor,
      // Cada objeto se guarda CON su figura (su instantánea de malla):
      // al reabrir el archivo cada pieza vuelve a ser ella misma, venga
      // de esta pestaña o de otra. El dueño se guarda con la figura que
      // construye el editor ahora, pero con SU textura — no la que
      // muestre el panel si hay una copia seleccionada — y con su
      // configuración FRESCA (la almacenada solo se actualiza al
      // congelar; sin esto se perderían las ediciones posteriores).
      sceneObjects: sceneObjects.map((object) => {
        if (object.id !== configObjectId) return object;
        const ownerConfig = capturePanelConfig();
        // Con una copia seleccionada, el panel muestra la textura de ESA
        // copia (sincronizada al seleccionarla): la del dueño es la suya
        // propia, guardada en su instantánea.
        if (frozenSaving) {
          if (mode === 'lathe') {
            ownerConfig.latheTexture = ownerTexture;
          } else {
            ownerConfig.texture = ownerTexture;
          }
          ownerConfig.textureProjection = ownerProjection;
          ownerConfig.textureFinish = ownerFinish;
          ownerConfig.textureRelief = ownerRelief;
        }
        return {
          ...object,
          mesh: {
            ...structuredClone(triMesh),
            texture: ownerTexture ?? undefined,
            textureColor: ownerTexture ? '#ffffff' : undefined,
            textureRelief: ownerRelief,
            textureFinish: ownerFinish,
          },
          smooth: smoothShadingValue,
          textureProjection: ownerProjection,
          config: ownerConfig,
        };
      }),
      configObjectId,
      selectedObjectId,
      editorGridResolution,
      editorCanvasZoom,
      meshSilhouette,
      meshSections,
      meshSilhouetteView,
      meshSideView,
       meshOpacity,
       // Configuración de luces y suelo: viajan con el proyecto para
       // volver al reabrirlo
       lightConfig,
       showGround,
       showLightHelpers,
       panelCameras,
       showGrid,
        fxConfig,
        groundTexture,
        groundTextureFinish,
        groundTextureRepeat,
        objectTextureFinish,
        skyboxImage,
        animationTracks,
        cameraViewMode,
       // Polilíneas libres de los lienzos 2D (solo 2D): viajan con el
       // proyecto para volver al reabrirlo
       polylines,
    };
    setSavingObject(true);
    try {
      if (!isElectron()) {
        // Navegador: descargar el .zeus en lugar de guardarlo en disco
        const blob = new Blob([JSON.stringify(projectData, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}.zeus`;
        a.click();
        URL.revokeObjectURL(url);
        setSaveMsg({ ok: true, text: `Descargado como ${name}.zeus` });
      } else {
        const paths = await getLocalPaths();
        const folder = paths?.objetos_3d;
        if (!folder) {
          setSaveMsg({ ok: false, text: NO_FOLDER_3D_MSG });
          return;
        }
        const ok = await saveProject(`${folder}/${name}.zeus`, projectData);
        if (!ok) throw new Error('No se pudo escribir el archivo');
        setSaveMsg({ ok: true, text: `Guardado como ${name}.zeus` });
      }
    } catch (e: unknown) {
      setSaveMsg({
        ok: false,
        text: e instanceof Error ? e.message : 'Error al guardar',
      });
    } finally {
      setSavingObject(false);
    }
  }, [
    savingObject,
    objectName,
    mode,
    views,
    resolution,
    meshStyle,
    text,
    fontCss,
    textDepth,
    hollowText,
    greedyMesh,
    textRes,
    textOpacity,
    viewsOpacity,
    extrudeDepth,
    extrudeHoles,
    textMode,
    useFontColor,
    baseColor,
    figureColor,
    texture,
    textureProjection,
      textureFinish,
      textureRelief,
      textureRepeat,
      editedVertices,
    meshSilhouette,
    meshSections,
    meshSilhouetteView,
    meshSideView,
    meshOpacity,
    latheProfile,
    latheTexture,
    latheOpacity,
    latheSegments,
    latheClamp,
    latheFigureColor,
    polylines,
    sceneObjects,
    selectedObjectId,
    configObjectId,
    frozenSelectedId,
     triMesh,
     smoothShadingValue,
     capturePanelConfig,
     groundTexture,
     groundTextureFinish,
     skyboxImage,
     animationTracks,
     cameraViewMode,
   ]);

  // Carga en el editor el objeto de la carpeta local pinchado en el
  // modal "Objeto 3D" (antes abría su propio modal con el botón Cargar).
  const loadObject = useCallback(
    async (file: { name: string; path?: string; data?: any }) => {
      if (!file.path && file.data === undefined) {
        setObj3dMsg({
          ok: false,
          text: `"${file.name}" no tiene ruta de archivo`,
        });
        return;
      }
      try {
        const data =
          file.data ?? (file.path ? await readProject(file.path) : null);
        if (!data || data.type !== 'editor3d') {
          setObj3dMsg({
            ok: false,
            text: `"${file.name}" no es un objeto 3D guardado desde este editor`,
          });
          return;
        }
        setMode(
          ['views', 'extrude', 'text', 'lathe'].includes(data.mode)
            ? data.mode
            : 'views'
        );
        setViews(
          data.views && typeof data.views === 'object'
            ? data.views
            : DEFAULT_VIEWS
        );
        setResolution(
          typeof data.resolution === 'number' ? data.resolution : 32
        );
        setMeshStyle(
          ['fusionada', 'suave', 'voxeles'].includes(data.meshStyle)
            ? data.meshStyle
            : 'suave'
        );
        setText(typeof data.text === 'string' ? data.text : 'HOLA');
        if (typeof data.fontCss === 'string') setFontCss(data.fontCss);
        if (typeof data.textDepth === 'number') setTextDepth(data.textDepth);
        setHollowText(!!data.hollowText);
        setGreedyMesh(data.greedyMesh !== false);
        if (typeof data.textRes === 'number') setTextRes(data.textRes);
        if (typeof data.textOpacity === 'number')
          setTextOpacity(data.textOpacity);
        if (typeof data.viewsOpacity === 'number')
          setViewsOpacity(data.viewsOpacity);
        if (typeof data.extrudeDepth === 'number')
          setExtrudeDepth(data.extrudeDepth);
        if (Array.isArray(data.extrudeHoles))
          setExtrudeHoles(data.extrudeHoles);
        if (['voxel', 'plane', 'smooth'].includes(data.textMode))
          setTextMode(data.textMode);
        setUseFontColor(data.useFontColor !== false);
        if (typeof data.baseColor === 'string') setBaseColor(data.baseColor);
        if (typeof data.figureColor === 'string')
          setFigureColor(data.figureColor);
        if (typeof data.texture === 'string') {
          setTexture(data.texture);
          setTextureFileName('textura-cargada');
        } else {
          setTexture(null);
          setTextureFileName('');
        }
        if (
          ['cylindrical', 'planar', 'spherical'].includes(
            data.textureProjection
          )
        ) {
          setTextureProjection(data.textureProjection);
        }
        if (['matte', 'semi-matte', 'glossy', 'metallic'].includes(data.textureFinish)) {
          setTextureFinish(data.textureFinish);
        }
         if (typeof data.textureRelief === 'number')
           setTextureRelief(data.textureRelief);
         if (typeof data.textureRepeat === 'number')
           setTextureRepeat(data.textureRepeat);
        if (Array.isArray(data.latheProfile) && data.latheProfile.length >= 3) {
          setLatheProfile(data.latheProfile);
        }
        if (typeof data.latheTexture === 'string') {
          setLatheTexture(data.latheTexture);
          setLatheTextureFileName('textura-cargada');
        } else {
          setLatheTexture(null);
          setLatheTextureFileName('');
        }
        if (typeof data.latheOpacity === 'number')
          setLatheOpacity(data.latheOpacity);
        if (typeof data.meshOpacity === 'number')
          setMeshOpacity(data.meshOpacity);
        if (typeof data.latheSegments === 'number')
          setLatheSegments(data.latheSegments);
        if (typeof data.latheClamp === 'boolean')
          setLatheClamp(data.latheClamp);
        if (typeof data.latheFigureColor === 'string')
          setLatheFigureColor(data.latheFigureColor);
        setEditedVertices(
          Array.isArray(data.editedVertices) && data.editedVertices.length > 0
            ? data.editedVertices
            : null
        );
        if (Array.isArray(data.sceneObjects) && data.sceneObjects.length > 0) {
          setSceneObjects(
            data.sceneObjects.map((obj: Partial<SceneObject>, i: number) => ({
              ...obj,
              name: obj.name ?? `Objeto ${i + 1}`,
            }))
          );
          const loadedSelected =
            typeof data.selectedObjectId === 'string'
              ? data.selectedObjectId
              : (data.sceneObjects[0]?.id ?? null);
          setSelectedObjectId(loadedSelected);
          // El dueño de la configuración del proyecto cargado es el que
          // lo era al guardar (archivos antiguos sin dueño guardado: el
          // objeto activo, como siempre). Los demás se reconstruyen con
          // su propia figura guardada.
          setConfigObjectId(
            typeof data.configObjectId === 'string' &&
              data.sceneObjects.some(
                (o: { id?: string }) => o.id === data.configObjectId
              )
              ? data.configObjectId
              : loadedSelected
          );
          // Los controles de textura muestran los ajustes del objeto que
          // estaba seleccionado al guardar (los suyos guardados en su
          // figura), no los del dueño.
          const loadedMode = ['views', 'extrude', 'text', 'lathe'].includes(
            data.mode
          )
            ? data.mode
            : 'views';
          const selectedLoaded = data.sceneObjects.find(
            (o: { id?: string }) => o.id === loadedSelected
          );
          // Archivos v3: el objeto seleccionado trae su configuración
          // completa congelada → el panel la toma entera (plantillas de
          // todas las pestañas, colores, texturas, polilíneas) y los
          // ajustes sueltos de abajo ya van incluidos. Sin config del
          // seleccionado se prueba con la del dueño (el panel al guardar
          // era el suyo); archivos viejos → camino de siempre.
          const ownerLoaded =
            typeof data.configObjectId === 'string'
              ? data.sceneObjects.find(
                  (o: { id?: string }) => o.id === data.configObjectId
                )
              : undefined;
          const loadedConfig =
            sanitizeObjectConfig(selectedLoaded?.config) ??
            sanitizeObjectConfig(ownerLoaded?.config);
          if (loadedConfig) {
            applyObjectConfig(loadedConfig);
          } else {
            const selectedLoadedMesh = selectedLoaded?.mesh;
            if (selectedLoadedMesh && selectedLoadedMesh.vertices.length > 0) {
              const selectedTexture = selectedLoadedMesh.texture ?? null;
              if (loadedMode === 'lathe') {
                setLatheTexture(selectedTexture);
                setLatheTextureFileName(
                  selectedTexture ? 'textura-objeto' : ''
                );
              } else {
                setTexture(selectedTexture);
                setTextureFileName(selectedTexture ? 'textura-objeto' : '');
              }
              setTextureProjection(
                selectedLoaded?.textureProjection ?? 'planar'
              );
              setTextureFinish(
                selectedLoadedMesh.textureFinish ?? 'semi-matte'
              );
              setTextureRelief(
                typeof selectedLoadedMesh.textureRelief === 'number'
                  ? selectedLoadedMesh.textureRelief
                  : 0.25
              );
            }
          }
        } else {
          setSceneObjects([]);
          setSelectedObjectId(null);
          setConfigObjectId(null);
        }
        if (typeof data.editorGridResolution === 'number')
          setEditorGridResolution(data.editorGridResolution);
         if (typeof data.editorCanvasZoom === 'number')
           setEditorCanvasZoom(data.editorCanvasZoom);
         // Restaurar configuración de luces y suelo si existen
         if (data.lightConfig) {
           setLightConfig(data.lightConfig);
         }
         if (typeof data.showGround === 'boolean') {
           setShowGround(data.showGround);
         }
          if (typeof data.showLightHelpers === 'boolean') {
            setShowLightHelpers(data.showLightHelpers);
          }
          if (typeof data.showGrid === 'boolean') {
            setShowGrid(data.showGrid);
          }
          if (data.panelCameras && typeof data.panelCameras === 'object') {
            setPanelCameras((prev) => ({ ...prev, ...data.panelCameras }));
          }
          if (data.fxConfig && typeof data.fxConfig === 'object') {
           setFxConfig(data.fxConfig);
          }
          if (typeof data.groundTexture === 'string') {
            setGroundTexture(data.groundTexture);
          }
           if (typeof data.groundTextureFinish === 'string') {
             setGroundTextureFinish(data.groundTextureFinish as TextureFinish);
           }
           if (typeof data.groundTextureRepeat === 'number') {
             setGroundTextureRepeat(data.groundTextureRepeat);
           }
          if (typeof data.objectTextureFinish === 'string') {
            setObjectTextureFinish(data.objectTextureFinish as TextureFinish);
          }
          if (typeof data.skyboxImage === 'string') {
            setSkyboxImage(data.skyboxImage);
          }
          if (Array.isArray(data.animationTracks)) {
            setAnimationTracks(data.animationTracks);
          }
          if (typeof data.cameraViewMode === 'boolean') {
            setCameraViewMode(data.cameraViewMode);
          }
         // Polilíneas libres de los lienzos 2D: los archivos antiguos no
         // las traen y quedan como lienzos vacíos
        setPolylines(sanitizePolylinesByCanvas(data.polylines));
        setEditingView(null);
        setObj3dModalOpen(false);
      } catch (e: unknown) {
        setObj3dMsg({
          ok: false,
          text: e instanceof Error ? e.message : 'Error al cargar',
        });
      }
    },
    [applyObjectConfig]
  );

  // Navegador: carga en el editor un archivo .zeus seleccionado desde el
  // dispositivo (File API), sin necesidad de Electron
  const handleObj3dFileSelect = useCallback(
    async (file: File) => {
      if (obj3dCreating) return;
      setObj3dCreating(true);
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await loadObject({ name: file.name, data });
      } catch (e: unknown) {
        setObj3dMsg({
          ok: false,
          text: e instanceof Error ? e.message : 'Error al cargar',
        });
      } finally {
        setObj3dCreating(false);
      }
    },
    [loadObject, obj3dCreating]
  );

  // Importa un modelo 3D (.obj, .glb, .gltf, .stl, .ply) desde el navegador
  const handleModelFileSelect = useCallback(
    async (file: File) => {
      setModelImportMsg(null);
      // Límite de tamaño de archivo: 500 MB
      if (file.size > 500 * 1024 * 1024) {
        setModelImportMsg({ ok: false, text: 'El archivo es demasiado grande (máx. 500 MB)' });
        return;
      }
      const format = getFormatFromExtension(file.name);
      if (!format) {
        setModelImportMsg({ ok: false, text: 'Formato no soportado' });
        return;
      }
      try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await importModelFile(format, arrayBuffer);
        if (!result) {
          setModelImportMsg({ ok: false, text: 'No se pudieron extraer vértices del modelo' });
          return;
        }
        const { meshes } = result;
        // Contamos el total de vértices entre todas las piezas
        let totalVertices = 0;
        for (const m of meshes) {
          if (m.vertices.length === 0) {
            setModelImportMsg({ ok: false, text: 'El modelo no contiene vértices' });
            return;
          }
          totalVertices += m.vertices.length;
        }
        if (totalVertices > 10000000) {
          setModelImportMsg({ ok: false, text: `Demasiados vértices (${totalVertices}). Máximo 10.000,000.` });
          return;
        }
        // Normalizamos y centramos todas las piezas juntas
        normalizeAndCenterMeshes(meshes);
        const baseId = `object-${Date.now()}`;
        // Creamos un objeto escena por pieza, con identificadores únicos
        setSceneObjects((objects) => [
          ...objects,
          ...meshes.map((mesh, i) => ({
            id: i === 0 ? baseId : `${baseId}-${i}`,
            name: `Pieza ${i + 1}`,
            transform: { px: 0, py: 0, pz: 0, sx: 1, sy: 1, sz: 1, rx: 0, ry: 0, rz: 0 },
            mesh: structuredClone(mesh),
            smooth: true,
          })),
        ]);
        // Seleccionamos la primera pieza
        setSelectedObjectId(baseId);
        setModelImportMsg({ ok: true, text: `Importado: ${meshes.length} pieza(s), ${totalVertices} vértices` });
      } catch (e: unknown) {
        setModelImportMsg({
          ok: false,
          text: e instanceof Error ? e.message : 'Error al importar el modelo',
        });
      }
    },
    []
  );

  // Abre el modal "Objeto 3D": lista los .zeus de public/Obj-3D y los de la
  // carpeta local donde guarda el botón Guardar (la carpeta local solo
  // existe en la app de escritorio).
  const openObj3dModal = useCallback(async () => {
    setObj3dMsg(null);
    setObj3dFiles([]);
    setObj3dPreview(null);
    setObj3dModalOpen(true);
    setObj3dLoading(true);
    try {
      // public/Obj-3D (se crea en la escena al pinchar)
      try {
        const res = await fetch('/api/objetos-3d', { cache: 'no-store' });
        const data = await res.json();
        const files: Array<{
          name: string;
          source: 'public' | 'local';
          path?: string;
        }> = (Array.isArray(data.files) ? data.files : []).map(
          (f: { name: string }) => ({ name: f.name, source: 'public' as const })
        );

        // Carpeta local de Objetos 3D (se carga en el editor al pinchar)
        if (isElectron()) {
          try {
            const paths = await getLocalPaths();
            const folder = paths?.objetos_3d;
            if (folder) {
              const localFiles = await listDirectory(folder);
              for (const f of localFiles || []) {
                if (
                  f &&
                  !f.isDirectory &&
                  /\.zeus$/i.test(f.name || '') &&
                  !files.some((x) => x.source === 'local' && x.name === f.name)
                ) {
                  files.push({
                    name: f.name,
                    source: 'local',
                    path: f.path,
                  });
                }
              }
            }
          } catch {
            // Sin carpeta local la sección se queda vacía
          }
        }
        setObj3dFiles(files);

        // Miniaturas: se lee la figura de cada archivo (una sola vez,
        // cacheada) y su tarjeta la dibuja congelada, como las miniaturas
        // de texturas del explorador. Cada tarjeta se rellena en cuanto
        // le toca, así la lista se ve desde el primer momento.
        for (const f of files) {
          const cacheKey = `${f.source}/${f.name}`;
          let mesh = obj3dMeshCacheRef.current.get(cacheKey) ?? null;
          if (!mesh) {
            try {
              const fileData =
                f.source === 'local' && f.path
                  ? await readProject(f.path)
                  : await (
                      await fetch(`/Obj-3D/${encodeURIComponent(f.name)}`, {
                        cache: 'no-store',
                      })
                    ).json();
              if (fileData) {
                const source = extractObj3dMesh(fileData);
                if (source) {
                  mesh = source.mesh;
                  obj3dMeshCacheRef.current.set(cacheKey, mesh);
                }
              }
            } catch {
              // Sin miniatura si el archivo no se puede leer: la tarjeta
              // sigue funcionando igual para crear el objeto
            }
          }
          setObj3dFiles((prev) =>
            prev.map((x) =>
              x.source === f.source && x.name === f.name
                ? { ...x, mesh: mesh ?? null }
                : x
            )
          );
        }
      } catch {
        setObj3dMsg({
          ok: false,
          text: 'No se pudo leer la carpeta public/Obj-3D',
        });
      }
    } finally {
      setObj3dLoading(false);
    }
  }, []);

  // Crea en la escena actual el objeto guardado pinchado en el modal: la
  // figura guardada entra como objeto nuevo de ESTA pestaña (igual que
  // pegar desde otra pestaña), sin tocar la configuración del editor.
  const createObj3dFromFile = useCallback(
    async (file: { name: string }) => {
      if (obj3dCreating) return;
      setObj3dCreating(true);
      try {
        const res = await fetch(`/Obj-3D/${encodeURIComponent(file.name)}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('No se pudo leer el archivo');
        const data = await res.json();
        if (!data || data.type !== 'editor3d') {
          throw new Error(
            `"${file.name}" no es un objeto 3D guardado desde este editor`
          );
        }
        // Figura a crear: la del dueño de la configuración guardada (o la
        // primera con malla que traiga el archivo).
        const source = extractObj3dMesh(data);
        if (!source) {
          throw new Error(`"${file.name}" no trae ninguna figura guardada`);
        }
        const current = sceneObjects.find(
          (object) => object.id === selectedObjectId
        );
        const newId = `object-${Date.now()}`;
        setSceneObjects((objects) => [
          ...objects,
          {
            id: newId,
            name: `Copia de ${source.name ?? 'objeto'}`,
            mode, // Solo visible en esta pestaña
            transform: {
              ...(current?.transform ?? IDENTITY_TRANSFORM),
              px: (current?.transform.px ?? 0) + 1.5,
            },
            mesh: structuredClone(source.mesh),
            smooth: source.smooth,
            textureProjection: source.textureProjection,
          },
        ]);
        setObj3dModalOpen(false);
      } catch (e: unknown) {
        setObj3dMsg({
          ok: false,
          text: e instanceof Error ? e.message : 'Error al crear el objeto',
        });
      } finally {
        setObj3dCreating(false);
      }
    },
    [obj3dCreating, mode, sceneObjects, selectedObjectId]
  );

  // Pasa el ratón por una tarjeta del modal: su figura se lee (una vez,
  // cacheada) y se ve girando en la vista previa 3D de arriba. Vale para
  // los archivos de public/Obj-3D y para los de la carpeta local.
  const loadObj3dPreview = useCallback(
    async (file: {
      name: string;
      source: 'public' | 'local';
      path?: string;
    }) => {
      const cacheKey = `${file.source}/${file.name}`;
      const cached = obj3dMeshCacheRef.current.get(cacheKey);
      if (cached) {
        setObj3dPreview({ name: file.name, mesh: cached });
        return;
      }
      try {
        const data =
          file.source === 'local' && file.path
            ? await readProject(file.path)
            : await (
                await fetch(`/Obj-3D/${encodeURIComponent(file.name)}`, {
                  cache: 'no-store',
                })
              ).json();
        if (!data) return;
        const source = extractObj3dMesh(data);
        if (!source) return;
        obj3dMeshCacheRef.current.set(cacheKey, source.mesh);
        setObj3dPreview({ name: file.name, mesh: source.mesh });
      } catch {
        // Sin vista previa si el archivo no se puede leer: la tarjeta
        // sigue funcionando igual para crear el objeto
      }
    },
    []
  );

  const resetModel = useCallback(() => {
    // Las polilíneas libres de los lienzos 2D también se reinician
    setPolylines({});
    if (mode === 'text') {
      setEditedVertices(null);
      setEditingTextPanel(null);
    } else if (mode === 'lathe') {
      setEditedVertices(null);
      setEditingLathePanel(null);
    } else if (mode === 'mesh') {
      setMeshSilhouette(structuredClone(DEFAULT_MESH_SILHOUETTE));
      setMeshSections(structuredClone(DEFAULT_MESH_SECTIONS));
      setMeshSideView(structuredClone(DEFAULT_MESH_SIDE_VIEW));
      setMeshOpacity(1);
      setEditedVertices(null);
      setEditingMesh(false);
      setEditingMeshSide(false);
    } else {
      setViews(DEFAULT_VIEWS);
      setViewsOpacity(1);
      setExtrudeDepth(0.5);
      setExtrudeHoles([]);
      setEditedVertices(null);
      setEditingView(null);
    }
  }, [mode]);

  // Exporta el objeto actual a un formato de archivo común. Se exporta
  // la misma malla triangulada que ve el visor 3D.
  const exportModel = useCallback(
    (format: 'stl' | 'obj' | 'ply' | 'glb') => {
      if (triMesh.vertices.length === 0) return;
      const name = 'modelo-3d';
      if (format === 'stl') exportSTL(triMesh, name);
      else if (format === 'obj') exportOBJ(triMesh, name);
      else if (format === 'ply') exportPLY(triMesh, name);
      else exportGLB(triMesh, name);
    },
    [triMesh]
  );

  const canBuild =
    mode === 'text'
      ? text.trim().length > 0
      : mode === 'lathe'
        ? latheProfile.length >= 3
        : mode === 'mesh'
          ? meshSilhouette.length >= 3 && meshSections.length > 0
          : mode === 'extrude'
            ? views.front.length >= 3
            : views.front.length >= 3 &&
              views.side.length >= 3 &&
              views.top.length >= 3;

  // Ajustes de textura con una copia seleccionada: se aplican a SU
  // figura (su instantánea), no a la configuración del dueño. Solo se
  // copian los ajustes que cambien de verdad mientras la copia está
  // seleccionada — al seleccionarla no se le toca nada (los estados
  // traen SUS ajustes, ver syncTextureStateToSelection).
  const textureAdjustPrevRef = useRef({
    selectedId: frozenSelectedId,
    texture,
    latheTexture,
    textureRelief,
    textureRepeat,
    textureFinish,
    textureProjection,
  });
  useEffect(() => {
    const prev = textureAdjustPrevRef.current;
    const selectionChanged = prev.selectedId !== frozenSelectedId;
    const changed =
      prev.texture !== texture ||
      prev.latheTexture !== latheTexture ||
      prev.textureRelief !== textureRelief ||
      prev.textureRepeat !== textureRepeat ||
      prev.textureFinish !== textureFinish ||
      prev.textureProjection !== textureProjection;
    textureAdjustPrevRef.current = {
      selectedId: frozenSelectedId,
      texture,
      latheTexture,
      textureRelief,
      textureRepeat,
      textureFinish,
      textureProjection,
    };
    // Durante un deshacer/rehacer no se copia nada: la foto restaurada
    // ya trae la textura correcta en la instantánea del objeto, y
    // reescribirla aquí crearía un array nuevo que ensuciaría el
    // historial (rompería el rehacer).
    if (!changed || !frozenSelectedId || isUndoRedo) return;
    // Acaba de cambiar la selección: los estados de textura traen los
    // ajustes del recién seleccionado, no un cambio del usuario. Copiar
    // ahora sería reescribir en su instantánea lo que ya tiene.
    if (selectionChanged) return;
    // La textura que manda en la pestaña actual
    const appliedTexture = mode === 'lathe' ? latheTexture : texture;
    setSceneObjects((current) =>
      current.map((object) => {
        if (object.id !== frozenSelectedId || !object.mesh) return object;
        return {
          ...object,
          textureProjection,
          mesh: {
            ...object.mesh,
            texture: appliedTexture ?? undefined,
            textureColor: '#ffffff',
            textureRelief,
            textureRepeat,
            textureFinish,
          },
        };
      })
    );
  }, [
    mode,
    texture,
     latheTexture,
     textureRelief,
     textureRepeat,
     textureFinish,
    textureProjection,
    frozenSelectedId,
    isUndoRedo,
  ]);

  const copyCurrentObject = useCallback(() => {
    // Con un lienzo 2D abierto a pantalla completa, Copiar trabaja con
    // ese lienzo: guarda su forma para pegarla luego en otro lienzo.
    if (fullScreenCanvas) {
      setPolygonClipboard(structuredClone(fullScreenCanvas.polygon));
      return;
    }
    // Si hay objetos multiseleccionados, copiar todos ellos
    if (selectedObjectIds.length > 1) {
      const objsToCopy = sceneObjects.filter((obj) =>
        selectedObjectIds.includes(obj.id)
      );
      if (objsToCopy.length > 0) {
        setMultiObjectClipboard({
          objects: structuredClone(objsToCopy),
        });
        return;
      }
    }
    setEditorClipboard({
      mode,
      ...capturePanelConfig(),
      // Instantánea de la malla triangulada tal como se ve ahora: es lo
      // que permite pegar el objeto en OTRA pestaña sin perder su forma.
      mesh: structuredClone(triMesh),
      smooth: smoothShadingValue,
    });
    setMultiObjectClipboard(null);
  }, [mode, capturePanelConfig, triMesh, smoothShadingValue, fullScreenCanvas, selectedObjectIds, sceneObjects]);

  // Solo el dueño de la configuración se congela con la malla actual,
  // porque su figura ES la que el editor está construyendo. Las copias
  // pegadas no se tocan: su figura es su propia instantánea y no se
  // sobrescribe con la configuración de otro. Junto a la malla se
  // congela también su configuración completa: al volver a
  // seleccionarlo, el panel recuperará sus plantillas y ajustes.
   const freezeObjectSnapshot = useCallback(
     (objectId: string) => {
       setSceneObjects((current) =>
         current.map((object) =>
           object.id === objectId
             ? {
                 ...object,
                 mesh: structuredClone(triMesh),
                 smooth: smoothShadingValue,
                 textureProjection,
                 config: capturePanelConfig(),
               }
             : object
         )
       );
     },
     [triMesh, smoothShadingValue, textureProjection, capturePanelConfig]
   );

   // Apply the current texture to ALL selected objects in the scene
   const applyTextureToSelectedObjects = useCallback(() => {
     if (selectedObjectIds.length === 0) return;
     const textureUrl = mode === 'lathe' ? latheTexture : texture;
     setSceneObjects((current) =>
       current.map((object) => {
         if (!selectedObjectIds.includes(object.id)) return object;
         const mesh = object.mesh;
         if (!mesh || mesh.vertices.length === 0) return object;
         const newMesh = structuredClone(mesh);
          newMesh.texture = textureUrl ?? undefined;
          newMesh.textureColor = '#ffffff';
          newMesh.textureRepeat = textureRepeat;
         // Note: textureRelief, textureFinish, and textureProjection are
         // panel-level settings and are saved to the object's mesh only
         // when the object is frozen (freezeObjectSnapshot).
         return {
           ...object,
           mesh: newMesh,
         };
       })
     );
    }, [selectedObjectIds, mode, latheTexture, texture, textureRepeat]);

    // Apply texture (URL + repeat) state changes to all selected objects in real-time
    const textureApplySkipRef = useRef(false);
    useEffect(() => {
      if (textureApplySkipRef.current) {
        textureApplySkipRef.current = false;
        return;
      }
      applyTextureToSelectedObjects();
      setViewRefreshTick((t) => t + 1);
    }, [texture, latheTexture, textureRepeat, applyTextureToSelectedObjects]);

  // Al cambiar de objeto activo, los controles de textura pasan a
  // mostrar los ajustes del recién seleccionado: los que tiene
  // guardados en su instantánea (su textura, acabado, relieve y
  // proyección), no los que quedaran en pantalla del anterior. Sin
  // instantánea (dueño recién creado o objetos de proyectos cargados)
  // no se toca nada: lo que hay en pantalla ya es lo suyo.
   const syncTextureStateToSelection = useCallback(
     (id: string | null) => {
       if (!id) return;
       textureApplySkipRef.current = true;
       const object = sceneObjects.find((o) => o.id === id);
      const mesh = object?.mesh;
      if (!mesh || mesh.vertices.length === 0) return;
      const objectTexture = mesh.texture ?? null;
      if (mode === 'lathe') {
        setLatheTexture(objectTexture);
        setLatheTextureFileName(objectTexture ? 'textura-objeto' : '');
      } else {
        setTexture(objectTexture);
        setTextureFileName(objectTexture ? 'textura-objeto' : '');
      }
      setTextureProjection(object?.textureProjection ?? 'planar');
      setTextureFinish(mesh.textureFinish ?? 'semi-matte');
      setTextureRelief(mesh.textureRelief ?? 0.25);
      setTextureRepeat(mesh.textureRepeat ?? 1);
    },
    [mode, sceneObjects]
  );

   const toggleObjectHidden = useCallback(
     (id: string) => {
       setSceneObjects((current) =>
         current.map((object) =>
           object.id === id ? { ...object, hidden: !object.hidden } : object
         )
       );
       setViewRefreshTick((t) => t + 1);
     },
     []
   );

   const toggleObjectFrozen = useCallback(
     (id: string) => {
       setSceneObjects((current) =>
         current.map((object) =>
           object.id === id ? { ...object, frozen: !object.frozen } : object
         )
       );
       setViewRefreshTick((t) => t + 1);
     },
     []
   );

  const handleObjectSelect = useCallback(
    (id: string | null) => {
      // Clic sobre el objeto que ya estaba seleccionado: no cambia
      // nada. (Sin esto, re-congelaría al dueño con la configuración
      // que hay en pantalla ahora, que puede traer la textura de una
      // copia ajustada hace un momento.)
      if (id === selectedObjectId) return;

      // Verificar que el objeto sea visible en la pestaña actual
      if (id) {
        const obj = sceneObjects.find((o) => o.id === id);
        if (obj && obj.mode && obj.mode !== mode) {
          // El objeto no es visible en esta pestaña, no seleccionarlo
          return;
        }
        // Los objetos pegados entre pestañas (tienen mode pero no config)
        // son copias congeladas: no deben convertirse en el objeto activo
        // principal, solo deben moverse como duplicados en la escena.
        if (
          obj &&
          obj.mode &&
          !obj.config &&
          obj.id !== configObjectId
        ) {
          return;
        }
      }

      // Al salir del dueño de la configuración, se congela su figura y
      // su configuración.
      if (configObjectId && id !== configObjectId) {
        freezeObjectSnapshot(configObjectId);
      }
      // Si el objeto trae su configuración completa (congelada al dejar
      // de ser dueño, pegada o cargada de un archivo v3), pasa a ser el
      // nuevo dueño y el panel muestra SUS plantillas, colores y
      // texturas: abrir el lienzo 2D es abrir el suyo. Sin configuración
      // (objetos del modal «Objeto 3D», archivos antiguos) se queda
      // como antes: se ve su figura congelada en el visor y el panel
      // conserva la configuración del dueño.
      const nextObject = id ? sceneObjects.find((o) => o.id === id) : undefined;
      if (nextObject?.config) {
        applyObjectConfig(structuredClone(nextObject.config));
        setConfigObjectId(id);
        setSelectedObjectId(id);
        // Si el nuevo objeto activo no está en la multiselección actual, limpiar
        if (id && !selectedObjectIds.includes(id)) {
          setSelectedObjectIds([]);
        }
        return;
      }
      setSelectedObjectId(id);
      // Si el nuevo objeto activo no está en la multiselección actual, limpiar
      if (id && !selectedObjectIds.includes(id)) {
        setSelectedObjectIds([]);
      }
      syncTextureStateToSelection(id);
    },
    [
      selectedObjectId,
      configObjectId,
      freezeObjectSnapshot,
      applyObjectConfig,
      syncTextureStateToSelection,
      sceneObjects,
      mode,
      selectedObjectIds,
    ]
    );

  const handleMultiObjectTransform = useCallback(
    (transforms: { id: string; transform: ObjectTransform }[]) => {
      setSceneObjects((prev) =>
        prev.map((obj) => {
          const update = transforms.find((t) => t.id === obj.id);
          if (update) {
            return {
              ...obj,
              transform: update.transform,
            };
          }
          return obj;
        })
      );
    },
    []
  );

  const pasteCurrentObject = useCallback(() => {
    // Con un lienzo 2D abierto a pantalla completa, Pegar vuelca en él la
    // forma del último Copiar hecho con un lienzo abierto, sin tocar la
    // escena ni la configuración del objeto.
    if (fullScreenCanvas) {
      if (!polygonClipboard) return;
      fullScreenCanvas.apply(polygonClipboard);
      return;
    }
      if (!editorClipboard && !multiObjectClipboard) return;
      // Pegar múltiples objetos previamente copiados
      if (multiObjectClipboard) {
        const current = sceneObjects.find(
          (object) => object.id === selectedObjectId
        );
        const baseTransform = current?.transform ?? IDENTITY_TRANSFORM;
        // Find the center of the copied objects to compute relative offsets
        const copiedObjects = multiObjectClipboard.objects;
        const centerX = copiedObjects.reduce((sum, obj) => sum + obj.transform.px, 0) / copiedObjects.length;
        const centerY = copiedObjects.reduce((sum, obj) => sum + obj.transform.py, 0) / copiedObjects.length;
        const centerZ = copiedObjects.reduce((sum, obj) => sum + obj.transform.pz, 0) / copiedObjects.length;
        // Offset the whole group from the active object's position, preserving relative composition
        const offsetX = 1.5;
        const offsetY = 1.5;
        const offsetZ = 0;
        const pastedObjects: SceneObject[] = copiedObjects.map((obj, i) => ({
          ...structuredClone(obj),
          id: `object-${Date.now()}-${i}`,
          name: `Copia de ${obj.name ?? 'objeto'}`,
          transform: {
            ...obj.transform,
            px: baseTransform.px + (obj.transform.px - centerX) + offsetX,
            py: baseTransform.py + (obj.transform.py - centerY) + offsetY,
            pz: baseTransform.pz + (obj.transform.pz - centerZ) + offsetZ,
          },
            mode: undefined,
            mesh: obj.mesh,
            smooth: obj.smooth,
            textureProjection: obj.textureProjection,
            config: obj.config,
          })
        );
        setSceneObjects((objects) => [...objects, ...pastedObjects]);
        const firstNewId = pastedObjects[0]?.id;
        setSelectedObjectId(firstNewId ?? null);
        setSelectedObjectIds(pastedObjects.map((o) => o.id));
        return;
      }
      // At this point editorClipboard is guaranteed non-null
      const cb = editorClipboard!;
     // Pegar en OTRA pestaña: el objeto copiado entra en la escena tal
    // como era, montado sobre su instantánea de malla. La configuración
    // de ESTA pestaña no se toca y el objeto activo sigue siendo el
    // mismo; la copia queda al lado, como las de "pegar" normal.
    if (cb.mode !== mode) {
      if (!cb.mesh || cb.mesh.vertices.length === 0)
        return;
      const current = sceneObjects.find(
        (object) => object.id === selectedObjectId
      );
      setSceneObjects((objects) => [
        ...objects,
        {
          id: `object-${Date.now()}`,
          name: `Objeto ${sceneObjects.length + 1}`,
          mode: mode, // Solo visible en esta pestaña
          transform: {
            ...(current?.transform ?? IDENTITY_TRANSFORM),
            px: (current?.transform.px ?? 0) + 1.5,
          },
          mesh: structuredClone(cb.mesh),
          smooth: cb.smooth,
          textureProjection: cb.textureProjection,
          // Su configuración viaja con él: al seleccionarlo en su
          // pestaña, el panel recuperará sus plantillas y ajustes.
          config: objectConfigFromClipboard(cb),
        },
      ]);
      return;
    }
    const selected = sceneObjects.find(
      (object) => object.id === selectedObjectId
    );
     const duplicateId = `object-${Date.now()}`;
    // El dueño de la configuración sale del foco: se congela con la
    // figura que tiene ahora. El objeto nuevo nace de la configuración
    // copiada, así que su instantánea es la malla copiada.
    if (configObjectId && configObjectId !== duplicateId) {
      freezeObjectSnapshot(configObjectId);
    }
    // Configuración completa del objeto pegado: viaja con él (al
    // seleccionarlo de nuevo, el panel la recuperará) y se aplica al
    // panel porque la copia pasa a ser el nuevo dueño.
    const pastedConfig = objectConfigFromClipboard(cb);
    const baseTransform = selected?.transform ?? IDENTITY_TRANSFORM;
    setSceneObjects((current) => [
      ...current,
      {
        id: duplicateId,
        name: `Copia de ${selected?.name ?? 'objeto'}`,
        transform: { ...baseTransform, px: baseTransform.px + 1.5 },
         mesh: structuredClone(cb.mesh),
         smooth: cb.smooth,
         textureProjection: cb.textureProjection,
        config: pastedConfig,
      },
    ]);
    setSelectedObjectId(duplicateId);
    setConfigObjectId(duplicateId);
    applyObjectConfig(pastedConfig);
  }, [
    editorClipboard,
    multiObjectClipboard,
    mode,
    sceneObjects,
    selectedObjectId,
    configObjectId,
    applyObjectConfig,
    fullScreenCanvas,
    polygonClipboard,
    smoothShadingValue,
    textureProjection,
    triMesh,
    capturePanelConfig,
    freezeObjectSnapshot,
  ]);

  const createNewObject = useCallback(() => {
    const current = sceneObjects.find(
      (object) => object.id === selectedObjectId
    );
    const id = `object-${Date.now()}`;
    // El dueño de la configuración se congela con su figura y su
    // configuración actuales; el objeto nuevo nace con la plantilla por
    // defecto (NO como copia del objeto que estaba activo).
    if (configObjectId) freezeObjectSnapshot(configObjectId);
    setSceneObjects((objects) => [
      ...objects,
      {
        id,
        name: `Objeto ${sceneObjects.length + 1}`,
        transform: {
          ...(current?.transform ?? IDENTITY_TRANSFORM),
          px: (current?.transform.px ?? 0) + 1.5,
        },
      },
    ]);
    setSelectedObjectId(id);
    setConfigObjectId(id);

    // La pieza nueva arranca con la plantilla por defecto en el mismo
    // instante: el visor la muestra ya con esa forma — sumada al objeto
    // anterior — y se va actualizando mientras se dibuja.
    applyObjectConfig(structuredClone(DEFAULT_OBJECT_CONFIG));

    // Cerrar cualquier lienzo/panel abierto y llevar al usuario a los
    // lienzos 2D de esta pestaña para crear el objeto nuevo.
    setEditingView(null);
    setEditingTextPanel(null);
    setEditingLathePanel(null);
    setEditingMeshPanel(null);
    setEditingMesh(false);
    setEditingMeshProfile(null);
    setEditingMeshSide(false);
    setEditingLathe(false);
    setEditingLatheProfile(false);
    setEditingViewProfile(null);
    if (mode === 'views' || mode === 'extrude') {
      setEditingViewProfile('front');
    } else if (mode === 'mesh') {
      setEditingMesh(true);
    } else if (mode === 'lathe') {
      setEditingLatheProfile(true);
    }
    // En la pestaña Texto no hay lienzo 2D: queda el texto por defecto.
  }, [
    sceneObjects,
    selectedObjectId,
    configObjectId,
    freezeObjectSnapshot,
    applyObjectConfig,
    mode,
  ]);

   const handleObjectTransform = useCallback(
     (transform: ObjectTransform) => {
       if (!selectedObjectId) return;
       setSceneObjects((current) =>
         current.map((object) =>
           object.id === selectedObjectId ? { ...object, transform } : object
         )
       );
     },
     [selectedObjectId]
   );

   const handleObjectNameChange = useCallback(
     (id: string, name: string) => {
       setSceneObjects((current) =>
         current.map((object) =>
           object.id === id ? { ...object, name } : object
         )
       );
     },
     []
   );

  // Eliminar el objeto confirmado en el diálogo. Si el que se va es el
  // dueño de la configuración: el que queda pasa a ser el nuevo dueño
  // cuando trae su configuración (y el panel la muestra); si no, la
  // configuración del panel se queda huérfana, sin dueño. La selección
  // pasa al objeto que queda en su sitio de la lista.
  const confirmDeleteObject = useCallback(() => {
    if (!objectToDelete) return;
    const index = sceneObjects.findIndex(
      (object) => object.id === objectToDelete
    );
    if (index < 0 || sceneObjects.length <= 1) {
      setObjectToDelete(null);
      return;
    }
    const remaining = sceneObjects.filter(
      (object) => object.id !== objectToDelete
    );
    const nextId = remaining[Math.min(index, remaining.length - 1)].id;
    const nextObject = remaining.find((object) => object.id === nextId);
    // ¿El que se va era el dueño y el siguiente trae configuración?
    // Entonces el panel pasa a ser el suyo (como al seleccionarlo).
    const configApplied =
      configObjectId === objectToDelete && !!nextObject?.config;
    if (configObjectId === objectToDelete) {
      if (configApplied) {
        applyObjectConfig(structuredClone(nextObject!.config!));
        setConfigObjectId(nextId);
      } else {
        setConfigObjectId(null);
      }
    }
    setSelectedObjectId(nextId);
    setSceneObjects(remaining);
    if (!configApplied) syncTextureStateToSelection(nextId);
    setObjectToDelete(null);
  }, [
    objectToDelete,
    sceneObjects,
    configObjectId,
    applyObjectConfig,
    syncTextureStateToSelection,
  ]);

  // Ejecuta la operación booleana (sustracción, unión o intersección) entre dos objetos
  const handleApplyBoolean = useCallback(
    ({
      baseObjectId,
      toolObjectId,
      operation,
      deleteToolObject,
    }: {
      baseObjectId: string;
      toolObjectId: string;
      operation: BooleanOperationType;
      deleteToolObject: boolean;
    }) => {
      const baseObj = sceneObjects.find((o) => o.id === baseObjectId);
      const toolObj = sceneObjects.find((o) => o.id === toolObjectId);

      if (!baseObj || !toolObj) {
        toast.error('No se encontraron los objetos seleccionados.');
        return false;
      }

      // Obtener la malla del objeto base
      const baseMesh =
        baseObj.mesh && baseObj.mesh.vertices.length > 0
          ? baseObj.mesh
          : baseObj.id === configObjectId
            ? triMesh
            : null;

      // Obtener la malla del objeto cortador / herramienta
      const toolMesh =
        toolObj.mesh && toolObj.mesh.vertices.length > 0
          ? toolObj.mesh
          : toolObj.id === configObjectId
            ? triMesh
            : null;

      if (!baseMesh || !baseMesh.vertices.length) {
        toast.error('El objeto base no tiene una geometría 3D válida.');
        return false;
      }

      if (!toolMesh || !toolMesh.vertices.length) {
        toast.error('El objeto cortador no tiene una geometría 3D válida.');
        return false;
      }

      const res = performCSGOperation(
        baseMesh,
        baseObj.transform,
        toolMesh,
        toolObj.transform,
        operation
      );

      if (!res.success || !res.resultMesh) {
        toast.error(res.error || 'Error al calcular la operación booleana.');
        return false;
      }

      // Si el objeto base era el dueño de la configuración, lo desvinculamos
      // para que el visor muestre permanentemente su nueva malla recortada
      if (configObjectId === baseObjectId) {
        setConfigObjectId(null);
      }
      if (deleteToolObject && configObjectId === toolObjectId) {
        setConfigObjectId(null);
      }

      setSceneObjects((current) => {
        let updated = current.map((obj) => {
          if (obj.id === baseObjectId) {
            return {
              ...obj,
              mesh: res.resultMesh,
              smooth: false,
            };
          }
          return obj;
        });

        if (deleteToolObject) {
          updated = updated.filter((obj) => obj.id !== toolObjectId);
        }

        return updated;
      });

      setSelectedObjectId(baseObjectId);

      const opLabels = {
        subtract: '¡Forma sustraída con éxito!',
        union: '¡Objetos unidos con éxito!',
        intersect: '¡Intersección calculada con éxito!',
      };
      toast.success(opLabels[operation]);
      return true;
    },
    [sceneObjects, configObjectId, triMesh]
  );

  const isEditingCanvas =
    (editingView !== null && (mode === 'views' || mode === 'extrude')) ||
    (editingLathe && mode === 'lathe') ||
    (editingTextPanel !== null && mode === 'text') ||
    (editingLathePanel !== null && mode === 'lathe') ||
    (editingLatheProfile && mode === 'lathe') ||
    (editingViewProfile !== null && (mode === 'views' || mode === 'extrude')) ||
    (editingMeshPanel !== null && mode === 'mesh') ||
    (editingMesh && mode === 'mesh') ||
    (editingMeshProfile !== null && mode === 'mesh') ||
    (editingMeshSide && mode === 'mesh');


  return (
    <div className="h-full flex flex-col overflow-hidden bg-[hsl(224_55%_6%)] text-foreground">
      <header className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-gradient-to-r from-[hsl(224_50%_8%)] via-[hsl(224_50%_10%)] to-[hsl(224_50%_8%)]">
        <div className="flex items-center gap-3">
          <img
            src="/Nuevo-Logo.png"
            alt="Logo"
            className="w-12 h-12 rounded-lg object-cover shadow-lg"
          />
          <div>
            <img
              src="/Zeus_Editor_3D.png"
              alt="Zeus Editor 3D"
              className="h-6 object-contain"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Dropdown: Nuevo objeto, Eliminar objeto, Sustraer forma, Objeto 3D, Guardar, Luces */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title="Más acciones"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white/5 hover:bg-white/10 text-foreground border border-white/10 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Acciones
                <ChevronDown className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="bg-gray-900 border-gray-800 text-white min-w-[200px]"
            >
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  createNewObject();
                }}
                className="hover:bg-gray-800 cursor-pointer p-2 flex flex-col items-start gap-0.5"
              >
                <span className="text-sm font-bold flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  Nuevo objeto
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  selectedObjectId && setObjectToDelete(selectedObjectId);
                }}
                disabled={!selectedObjectId || sceneObjects.length <= 1}
                className="hover:bg-gray-800 cursor-pointer p-2 flex flex-col items-start gap-0.5 disabled:opacity-40"
              >
                <span className="text-sm font-bold flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  Eliminar objeto
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setBooleanModalOpen(true);
                }}
                disabled={visibleSceneObjects.length < 2}
                className="hover:bg-gray-800 cursor-pointer p-2 flex flex-col items-start gap-0.5 disabled:opacity-40"
                title={
                  visibleSceneObjects.length < 2
                    ? 'Necesitas al menos 2 objetos en la escena para sustraer una forma'
                    : 'Sustraerle a un objeto la forma de otro'
                }
              >
                <span className="text-sm font-bold flex items-center gap-1.5">
                  <Scissors className="w-3.5 h-3.5 text-amber-400" />
                  Sustraer forma
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  openObj3dModal();
                }}
                className="hover:bg-gray-800 cursor-pointer p-2 flex flex-col items-start gap-0.5"
              >
                <span className="text-sm font-bold flex items-center gap-1.5">
                  <Box className="w-3.5 h-3.5" />
                  Objeto 3D
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  openSaveModal();
                }}
                className="hover:bg-gray-800 cursor-pointer p-2 flex flex-col items-start gap-0.5"
              >
                <span className="text-sm font-bold flex items-center gap-1.5">
                  <Save className="w-3.5 h-3.5" />
                  Guardar
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setIsLightingModalOpen(true);
                }}
                className="hover:bg-gray-800 cursor-pointer p-2 flex flex-col items-start gap-0.5"
              >
                <span className="text-sm font-bold flex items-center gap-1.5">
                  <Sun className="w-3.5 h-3.5" />
                 {lightConfig
                     ? `Luces (${lightConfig.spotlights.filter((s) => s.enabled).length})`
                     : 'Luces'}
                 </span>
               </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setShowGround(!showGround);
                  }}
                  className="hover:bg-gray-800 cursor-pointer p-2 flex flex-col items-start gap-0.5"
                >
                  <span className="text-sm font-bold flex items-center gap-1.5">
                    <Grid3x3 className={`w-3.5 h-3.5 ${showGround ? 'text-green-400' : ''}`} />
                    {showGround ? 'Ocultar suelo' : 'Mostrar suelo'}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setTextureSelectTarget('ground');
                    setShowTextureModal(true);
                  }}
                  className="hover:bg-gray-800 cursor-pointer p-2 flex flex-col items-start gap-0.5"
                >
                   <span className="text-sm font-bold flex items-center gap-1.5">
                     <ImageIcon className="w-3.5 h-3.5" />
                     Textura del suelo
                   </span>
                   {groundTexture && (
                     <div className="flex items-center gap-1 mt-0.5" onClick={(e) => e.stopPropagation()}>
                       <img src={groundTexture} alt="Suelo" className="w-6 h-6 object-cover rounded border border-white/20" />
                       <input
                         type="number"
                         min={1}
                         max={100}
                         value={groundTextureRepeat}
                         onChange={(e) => setGroundTextureRepeat(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                         className="w-14 px-1 py-0.5 text-xs bg-black/40 border border-white/10 rounded text-foreground"
                       />
                     </div>
                   )}
                 </DropdownMenuItem>
                 {groundTexture && (
                   <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      const finishes = ['matte', 'semi-matte', 'glossy', 'metallic', 'mirror'];
                      const idx = finishes.indexOf(groundTextureFinish);
                      setGroundTextureFinish(finishes[(idx + 1) % finishes.length] as TextureFinish);
                    }}
                     className="hover:bg-gray-800 cursor-pointer p-2 flex flex-col items-start gap-0.5"
                   >
                   <span className="text-sm font-bold flex items-center gap-1.5">
                     <Palette className="w-3.5 h-3.5" />
                       Acabado: {groundTextureFinish === 'matte' ? 'Mate' : groundTextureFinish === 'semi-matte' ? 'Semimate' : groundTextureFinish === 'metallic' ? 'Brillo metalizado' : groundTextureFinish === 'glossy' ? 'Espejo' : groundTextureFinish === 'mirror' ? 'Espejo Suelo' : 'Brillo'}
                    </span>
                    </DropdownMenuItem>
                  )}
                  {groundTexture && (
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setGroundTexture(null);
                        setGroundTextureFileName('');
                      }}
                      className="hover:bg-gray-800 cursor-pointer p-2 flex items-center text-red-300"
                    >
                      <X className="w-3.5 h-3.5 mr-1.5" />
                      Quitar textura
                    </DropdownMenuItem>
                  )}
                 <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setTextureSelectTarget('skybox');
                    setShowTextureModal(true);
                  }}
                  className="hover:bg-gray-800 cursor-pointer p-2 flex flex-col items-start gap-0.5"
                >
                  <span className="text-sm font-bold flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5" />
                    Fondo (cielo)
                  </span>
                  {skyboxImage && (
                    <img src={skyboxImage} alt="Cielo" className="w-6 h-6 object-cover rounded border border-white/20 mt-0.5" />
                  )}
                </DropdownMenuItem>
                {skyboxImage && (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setSkyboxImage(null);
                      setSkyboxImageFileName('');
                    }}
                    className="hover:bg-gray-800 cursor-pointer p-2 flex items-center text-red-300"
                  >
                    <X className="w-3.5 h-3.5 mr-1.5" />
                    Quitar texturas
                  </DropdownMenuItem>
                )}
             </DropdownMenuContent>
           </DropdownMenu>
           <button
             onClick={() => setCameraViewMode(!cameraViewMode)}
             className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors ${
               cameraViewMode
                 ? 'bg-blue-500/20 text-blue-300 border-blue-500/30 hover:bg-blue-500/30'
                 : 'bg-white/5 text-muted-foreground hover:text-foreground border-white/10 hover:bg-white/10'
             }`}
             title={cameraViewMode ? 'Salir de la vista de cámara' : 'Entrar en vista de cámara'}
           >
             <Camera className="w-3.5 h-3.5" />
             <span>Vista cámara</span>
           </button>
            <button
             onClick={copyCurrentObject}
             className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground border border-white/10 transition-colors"
             title={
               fullScreenCanvas
                 ? `Copiar la forma de ${fullScreenCanvas.name} para pegarla en otro lienzo abierto a pantalla completa`
                 : selectedObjectIds.length > 1
                   ? `Copiar ${selectedObjectIds.length} objetos seleccionados`
                   : 'Copiar la configuración del objeto actual'
             }
          >
            <Copy className="w-3.5 h-3.5" />
            Copiar
          </button>
          <button
            onClick={pasteCurrentObject}
              disabled={
                fullScreenCanvas
                  ? !polygonClipboard
                  : !editorClipboard && !multiObjectClipboard
              }
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground border border-white/10 transition-colors disabled:opacity-30 disabled:hover:bg-white/5"
             title={
               fullScreenCanvas
                 ? polygonClipboard
                   ? `Pegar en ${fullScreenCanvas.name} la forma copiada`
                   : 'Copia antes una forma: abre una plantilla (o la silueta/costado) a pantalla completa y pulsa Copiar'
                 : multiObjectClipboard
                   ? `Pegar ${multiObjectClipboard.objects.length} objetos copiados`
                   : editorClipboard && editorClipboard.mode !== mode
                     ? 'Pegar el objeto copiado en esta pestaña (entra como objeto nuevo)'
                     : 'Pegar como otra configuración del mismo tipo'
             }
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            Pegar
          </button>
           {sceneObjects.length > 1 && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Objeto activo</span>
                 <select
                   value={selectedObjectIds.includes(selectedObjectId ?? '') ? (selectedObjectId ?? '') : ''}
                   onChange={(e) => handleObjectSelect(e.target.value || null)}
                  className="bg-gray-900 border border-white/10 rounded-md px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-green-500"
                >
                   {sceneObjects.map((object, index) => (
                     <option key={object.id} value={object.id}>
                       {object.name || `Objeto ${index + 1}`}
                     </option>
                   ))}
                </select>
              </label>
            )}
            {sceneObjects.length > 1 && (
             <DropdownMenu>
               <DropdownMenuTrigger asChild>
                 <button
                   title="Seleccionar múltiples objetos"
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    selectedObjectIds.length > 0
                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/25'
                      : 'bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10 border border-white/10'
                  }`}
                >
                  <BoxSelect className="w-3.5 h-3.5" />
                  Multi ({selectedObjectIds.length})
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-gray-900 border-gray-800 text-white min-w-[200px] max-h-[300px] overflow-y-auto [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-600/50 hover:[&::-webkit-scrollbar-thumb]:bg-gray-500/50">
                {sceneObjects.map((object, index) => {
                  const checked = selectedObjectIds.includes(object.id);
                  const color = object.hidden
                    ? 'text-red-400'
                    : object.frozen
                      ? 'text-gray-400'
                      : 'text-foreground';
                  return (
                      <DropdownMenuCheckboxItem
                       key={object.id}
                       checked={checked}
                       onCheckedChange={(v) => {
                          if (v) {
                            setSelectedObjectIds((prev) => [...prev, object.id]);
                            // Set this object as the active one for the name input
                            setSelectedObjectId(object.id);
                          } else {
                            setSelectedObjectIds((prev) => {
                              const next = prev.filter((id) => id !== object.id);
                              // If we're removing the active object, pick another from the remaining
                              if (selectedObjectId === object.id && next.length > 0) {
                                setSelectedObjectId(next[0]);
                              } else if (next.length === 0) {
                                setSelectedObjectId(null);
                              }
                              return next;
                            });
                          }
                        }}
                       className={`hover:bg-gray-800 cursor-pointer text-xs ${object.hidden ? 'opacity-60' : ''}`}
                     >
                       <span className="flex items-center gap-1.5">
                         <span className={`w-2 h-2 rounded-full ${object.hidden ? 'bg-red-400' : object.frozen ? 'bg-gray-400' : 'bg-green-400'}`} />
                         <span className={color}>
                           {object.name || `Objeto ${index + 1}`}
                         </span>
                       </span>
                       <button
                         onClick={(e) => {
                           e.stopPropagation();
                           toggleObjectHidden(object.id);
                         }}
                         title={object.hidden ? 'Mostrar objeto' : 'Ocultar objeto'}
                         className="ml-auto px-1 py-0.5 rounded text-[10px] hover:bg-gray-700"
                       >
                         {object.hidden ? '🟢' : '🔴'}
                       </button>
                       <button
                         onClick={(e) => {
                           e.stopPropagation();
                           toggleObjectFrozen(object.id);
                         }}
                         title={object.frozen ? 'Descongelar objeto' : 'Congelar objeto'}
                         className="ml-auto px-1 py-0.5 rounded text-[10px] hover:bg-gray-700"
                       >
                         {object.frozen ? '🔓' : '🔒'}
                       </button>
                     </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
         {lightConfig && lightConfig.spotlights.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sun className="w-3.5 h-3.5" />
              <span>Foco activo</span>
              <select
                value={0}
                onChange={() => {}}
                className="bg-gray-900 border border-white/10 rounded-md px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-green-500"
              >
                {lightConfig.spotlights.filter((s) => s.enabled).map((_, index) => (
                  <option key={index} value={index}>
                    Foco {index + 1}
                  </option>
                ))}
              </select>
            </label>
          )}
          {lightConfig && lightConfig.spotlights.length > 0 && (
            <button
              onClick={() => setShowLightHelpers(!showLightHelpers)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                showLightHelpers
                  ? 'bg-white/10 text-foreground border-white/20 hover:bg-white/15'
                  : 'bg-white/5 text-muted-foreground hover:text-foreground border-white/10 hover:bg-white/10'
              }`}
              title={showLightHelpers ? 'Ocultar ayudantes de luz' : 'Mostrar ayudantes de luz'}
            >
              <Sun className="w-3.5 h-3.5" />
              <span>Aro foco</span>
             </button>
           )}
            {(mode === 'views' || mode === 'mesh' || mode === 'extrude') && (
            <>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mr-2">
                <span>Resolución</span>
                <Slider
                  min={8}
                  max={120}
                  value={[resolution]}
                  onValueChange={([v]) => {
                    setResolution(v);
                    setEditedVertices(null);
                  }}
                  className="w-20"
                />
                <span className="font-mono w-6 text-green-400">
                  {resolution}
                </span>
              </div>
              <div
                className="flex items-center rounded-md border border-white/10 overflow-hidden mr-2"
                title="Estilo de malla con el que se reconstruye el objeto"
              >
                {(
                  [
                    {
                      key: 'suave',
                      label: 'Suave',
                      icon: Spline,
                      title:
                        'Malla editable construida por cortes a partir de las plantillas: las curvas salen exactas y redondas, cubierta por la rejilla de la malla',
                    },
                    {
                      key: 'fusionada',
                      label: 'Fusionada',
                      icon: Grid3x3,
                      title:
                        'Vóxeles reconstruidos a alta resolución (96³) con las caras coplanares fusionadas: superficie pareja e igual por todos lados',
                    },
                    {
                      key: 'voxeles',
                      label: 'Vóxeles',
                      icon: Box,
                      title:
                        'Vóxeles vistos vóxel a vóxel a la resolución del slider',
                    },
                  ] as const
                ).map(({ key, label, icon: Icon, title }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setMeshStyle(key);
                      setEditedVertices(null);
                    }}
                    className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      meshStyle === key
                        ? 'bg-green-500/25 text-green-300'
                        : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                    }`}
                    title={title}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </>
           )}

           <DropdownMenu>
             <DropdownMenuTrigger asChild>
               <button
                 disabled={mesh.vertices.length === 0}
                 title="Exportar/Importar el objeto 3D (STL, OBJ, PLY, GLB, GLTF)"
                 className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white/5 hover:bg-white/10 text-foreground border border-white/10 disabled:opacity-40 transition-colors"
               >
                 <Download className="w-3.5 h-3.5" />
                 Export/Import
                 <ChevronDown className="w-3 h-3" />
               </button>
             </DropdownMenuTrigger>
             <DropdownMenuContent
               align="end"
               className="bg-gray-900 border-gray-800 text-white min-w-[240px]"
             >
               <DropdownMenuItem
                 className="cursor-default p-2 flex flex-col items-start gap-0.5"
               >
                 <span className="text-xs font-semibold text-gray-400">Exportar</span>
               </DropdownMenuItem>
               {(
                 [
                   {
                     key: 'stl',
                     label: 'STL',
                     desc: 'Impresión 3D (estereolitografía)',
                   },
                   {
                     key: 'obj',
                     label: 'OBJ',
                     desc: 'Wavefront: lo abre casi todo',
                   },
                   {
                     key: 'ply',
                     label: 'PLY',
                     desc: 'Polígonos con color por cara',
                   },
                   {
                     key: 'glb',
                     label: 'GLB',
                     desc: 'glTF binario para web y visores 3D',
                   },
                 ] as const
               ).map(({ key, label, desc }) => (
                 <DropdownMenuItem
                   key={key}
                   onClick={() => exportModel(key)}
                   className="hover:bg-gray-800 cursor-pointer p-3 flex flex-col items-start gap-0.5"
                 >
                   <span className="text-sm font-bold">{label}</span>
                   <span className="text-xs text-gray-400">{desc}</span>
                 </DropdownMenuItem>
               ))}
               <DropdownMenuSeparator className="bg-gray-700" />
               <DropdownMenuItem
                 className="cursor-default p-2 flex flex-col items-start gap-0.5"
               >
                 <span className="text-xs font-semibold text-gray-400">Importar</span>
               </DropdownMenuItem>
               {IMPORT_FORMATS.map(({ ext, label, desc, format }) => (
                 <DropdownMenuItem
                   key={format}
                   onSelect={(e) => {
                     e.preventDefault();
                     modelFileInputRef.current?.click();
                   }}
                   className="hover:bg-gray-800 cursor-pointer p-3 flex flex-col items-start gap-0.5"
                 >
                   <span className="text-sm font-bold">{label}</span>
                   <span className="text-xs text-gray-400">{desc}</span>
                 </DropdownMenuItem>
               ))}
               <input
                 ref={modelFileInputRef}
                 type="file"
                 accept={IMPORT_FORMATS.map((f) => f.ext).join(',')}
                 className="hidden"
                 onChange={(e) => {
                   const file = e.target.files?.[0];
                   if (file) handleModelFileSelect(file);
                   e.target.value = '';
                 }}
               />
               {modelImportMsg && (
                 <DropdownMenuItem
                   className="cursor-default p-2 flex flex-col items-start gap-0.5"
                 >
                   <span className={`text-xs ${modelImportMsg.ok ? 'text-green-300' : 'text-red-300'}`}>
                     {modelImportMsg.text}
                   </span>
                 </DropdownMenuItem>
               )}
             </DropdownMenuContent>
           </DropdownMenu>

          <button
            onClick={resetModel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white/5 hover:bg-white/10 text-foreground border border-white/10 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reset
          </button>
          <button
            onClick={undo}
            disabled={historyIndex <= 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white/5 hover:bg-white/10 text-foreground border border-white/10 disabled:opacity-40 transition-colors"
            title="Deshacer (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
            Deshacer
          </button>

          <button
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white/5 hover:bg-white/10 text-foreground border border-white/10 disabled:opacity-40 transition-colors"
            title="Rehacer (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
            Rehacer
          </button>
        </div>
      </header>

      <main className="flex-1 flex min-h-0">
        <div className="w-[380px] shrink-0 flex flex-col border-r border-white/5 bg-[hsl(224_50%_7%)]">
          <div className="px-3 pt-3">
            <div className="flex p-1 rounded-lg bg-black/40 border border-white/5">
              <button
                onClick={() => {
                  setMode('views');
                  setEditedVertices(null);
                  setEditingView(null);
                  setEditingTextPanel(null);
                  setEditingLathePanel(null);
                  setEditingMeshPanel(null);
                  setEditingMesh(false);
                  // Al entrar en la pestaña, la pieza principal es la
                  // figura de esa pestaña (el dueño de la
                  // configuración); la copia pegada que pudiera estar
                  // seleccionada se queda como copia al lado.
                  if (configObjectId) {
                    setSelectedObjectId(configObjectId);
                    syncTextureStateToSelection(configObjectId);
                  } else if (selectedObjectId) {
                    setSelectedObjectId(null);
                  }
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === 'views'
                    ? 'bg-green-500/20 text-green-300'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                
                Vistas
              </button>
              <button
                onClick={() => {
                  setMode('mesh');
                  setEditedVertices(null);
                  setEditingView(null);
                  setEditingTextPanel(null);
                  setEditingLathePanel(null);
                  setEditingMeshPanel(null);
                  setEditingMesh(false);
                  // Al entrar en la pestaña, la pieza principal es la
                  // figura de esa pestaña (el dueño de la
                  // configuración); la copia pegada que pudiera estar
                  // seleccionada se queda como copia al lado.
                  if (configObjectId) {
                    setSelectedObjectId(configObjectId);
                    syncTextureStateToSelection(configObjectId);
                  } else if (selectedObjectId) {
                    setSelectedObjectId(null);
                  }
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === 'mesh'
                    ? 'bg-green-500/20 text-green-300'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                
                Mallas
              </button>
              <button
                onClick={() => {
                  setMode('text');
                  setEditedVertices(null);
                  setEditingView(null);
                  setEditingTextPanel(null);
                  setEditingLathePanel(null);
                  setEditingMeshPanel(null);
                  setEditingMesh(false);
                  // Al entrar en la pestaña, la pieza principal es la
                  // figura de esa pestaña (el dueño de la
                  // configuración); la copia pegada que pudiera estar
                  // seleccionada se queda como copia al lado.
                  if (configObjectId) {
                    setSelectedObjectId(configObjectId);
                    syncTextureStateToSelection(configObjectId);
                  } else if (selectedObjectId) {
                    setSelectedObjectId(null);
                  }
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === 'text'
                    ? 'bg-green-500/20 text-green-300'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                
                Texto
              </button>
              <button
                onClick={() => {
                  setMode('lathe');
                  setEditedVertices(null);
                  setEditingView(null);
                  setEditingLathe(false);
                  setEditingTextPanel(null);
                  setEditingLathePanel(null);
                  setEditingMeshPanel(null);
                  setEditingMesh(false);
                  // Al entrar en la pestaña, la pieza principal es la
                  // figura de esa pestaña (el dueño de la
                  // configuración); la copia pegada que pudiera estar
                  // seleccionada se queda como copia al lado.
                  if (configObjectId) {
                    setSelectedObjectId(configObjectId);
                    syncTextureStateToSelection(configObjectId);
                  } else if (selectedObjectId) {
                    setSelectedObjectId(null);
                  }
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === 'lathe'
                    ? 'bg-green-500/20 text-green-300'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                
                Torno
              </button>
              <button
                onClick={() => {
                  setMode('extrude');
                  setEditedVertices(null);
                  setEditingView(null);
                  setEditingViewProfile(null);
                  setEditingTextPanel(null);
                  setEditingLathePanel(null);
                  setEditingMeshPanel(null);
                  setEditingMesh(false);
                  // Al entrar en la pestaña, la pieza principal es la
                  // figura de esa pestaña (el dueño de la
                  // configuración); la copia pegada que pudiera estar
                  // seleccionada se queda como copia al lado.
                  if (configObjectId) {
                    setSelectedObjectId(configObjectId);
                    syncTextureStateToSelection(configObjectId);
                  } else if (selectedObjectId) {
                    setSelectedObjectId(null);
                  }
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  mode === 'extrude'
                    ? 'bg-green-500/20 text-green-300'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                
                Extruir
              </button>
            </div>
          </div>

          <div className="px-3 py-2 border-t border-white/5">
            <button
              onClick={() => setShowKeyframeEditor(!showKeyframeEditor)}
              className="w-full flex items-center gap-1 text-xs font-semibold text-green-300 hover:text-green-200"
            >
              <span className="transform transition-transform">{showKeyframeEditor ? '▼' : '▶'}</span>
              Editor de animación
            </button>
            {showKeyframeEditor && (
              <div className="pt-1">
                <KeyframeEditor
                  tracks={animationTracks}
                  setTracks={setAnimationTracks}
                  selectedTrackId={selectedTrackId}
                  setSelectedTrackId={setSelectedTrackId}
                  playing={playing}
                  setPlaying={setPlaying}
                  currentTime={currentTime}
                  setCurrentTime={setCurrentTime}
                  sceneObjects={visibleSceneObjects}
                  panelCameras={panelCameras}
                   isRecordingCameraPath={isRecordingCameraPath}
                   onStartCameraRecording={startCameraPathRecording}
                   onStopCameraRecording={stopCameraPathRecording}
                    showCameraPath={showCameraPath}
                   onShowCameraPathChange={setShowCameraPath}
                   onExportMp4={() => {
                     setExportProgress(null);
                     setExportResult(null);
                     setExportMp4Trigger((t) => t + 1);
                   }}
                   exportProgress={exportProgress}
                   exportResult={exportResult}
                 />
              </div>
            )}
          </div>

          {mode === 'views' || mode === 'extrude' ? (
            <>
              <div className="px-3 py-2 border-b border-white/5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <span className="w-1 h-3 rounded-full bg-green-500" />
                  Lienzos de dibujo
                </h2>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5 flex items-center gap-1">
                  <Info className="w-2.5 h-2.5" />
                  Clic añade (en arista, inserta ahí) · Arrastra vértices ·
                  Doble clic elimina · Mantén pulsado para curvar · Lápiz =
                  editar en grande
                </p>
              </div>

              {mode === 'extrude' ? (
                   <div className="flex-1 overflow-y-auto grid grid-rows-[320px_auto] gap-3 p-3 min-h-0 custom-scrollbar">
                   <DrawingCanvas
                     label="Frente"
                     axisLabel="X·Y"
                     polygon={views.front}
                     onChange={updateView('front')}
                     resolution={resolution}
                     onEdit={() => setEditingViewProfile('front')}
                     polylines={getPolylines('views:front')}
                   />
                   <div className="flex flex-col gap-3">
                     <div className="flex flex-col gap-1.5">
                     <label className="text-[10px] text-muted-foreground/80 flex items-center justify-between">
                       <span>Profundidad de extrusión</span>
                       <span className="font-mono text-[10px] text-green-400">
                         {extrudeDepth.toFixed(2)}
                       </span>
                     </label>
                     <Slider
                       min={0.1}
                       max={3}
                       step={0.1}
                       value={[extrudeDepth]}
                       onValueChange={([v]) => {
                         setExtrudeDepth(v);
                         setEditedVertices(null);
                       }}
                       className="w-full"
                     />
                     <p className="text-[10px] text-muted-foreground/60 flex items-start gap-1">
                       <Info className="w-2.5 h-2.5 shrink-0 mt-0.5" />
                       La figura se extruye hacia atrás desde el lienzo Frente
                       una distancia de {extrudeDepth.toFixed(2)} unidades.
                     </p>
                   </div>
                   
                   <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const frontPolylines = getPolylines('views:front');
                          const closedInside = frontPolylines.filter((line) => {
                            if (line.points.length < 3) return false;
                            if (extrudeHoles.includes(line.id)) return false;
                            const closed =
                              line.points.length > 2 &&
                              Math.hypot(
                                line.points[0].x - line.points[line.points.length - 1].x,
                                line.points[0].y - line.points[line.points.length - 1].y
                              ) < 1e-6;
                            if (!closed) return false;
                            // Comprobar si el centroide está dentro del polígono principal
                            const cx =
                              line.points.reduce((s, p) => s + p.x, 0) / line.points.length;
                            const cy =
                              line.points.reduce((s, p) => s + p.y, 0) / line.points.length;
                            return pointInPolygon({ x: cx, y: cy }, views.front);
                          });
                          if (closedInside.length === 0) {
                            if (extrudeHoles.length > 0) {
                              setExtrudeHoles([]);
                            }
                            return;
                          }
                          setExtrudeHoles((prev) =>
                            Array.from(
                              new Set([...prev, ...closedInside.map((l) => l.id)])
                            )
                          );
                        }}
                        className="flex-1 px-3 py-1.5 text-[10px] font-medium rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 transition-colors flex items-center justify-center gap-1"
                        title="Sustraer forma dibujada dentro del objeto"
                      >
                        <Scissors className="w-3 h-3" />
                        Sustraer
                      </button>

                      {/* Slider de redimensionamiento uniforme */}
                      <div className="flex items-center gap-2">
                        <Expand className="w-3 h-3 text-blue-300" />
                        <Slider
                          min={0.1}
                          max={2}
                          step={0.05}
                          value={[resizeScale]}
                          onValueChange={([v]) => {
                            if (resizeBaseRef.current === null) {
                              resizeBaseRef.current = [...views.front];
                            }
                            const scaled = scalePolygonUniformUnbounded(resizeBaseRef.current, v);
                            updateView('front')(scaled);
                            setResizeScale(v);
                          }}
                          onValueCommit={([v]) => {
                            resizeBaseRef.current = null;
                            setResizeScale(1);
                          }}
                          className="w-24"
                        />
                        <span className="font-mono text-[10px] text-green-400 w-10 text-right">
                          {Math.round(resizeScale * 100)}%
                        </span>
                      </div>
                     </div>
                    </div>
                  </div>
              ) : (
                <div className="flex-1 overflow-y-auto grid grid-rows-[320px_320px_320px] gap-2 p-3 min-h-0 custom-scrollbar">
                  <DrawingCanvas
                    label="Frente"
                    axisLabel="X·Y"
                    polygon={views.front}
                    onChange={updateView('front')}
                    resolution={resolution}
                    onEdit={() => setEditingViewProfile('front')}
                    polylines={getPolylines('views:front')}
                  />
                  <DrawingCanvas
                    label="Costado"
                    axisLabel="Z·Y"
                    polygon={views.side}
                    onChange={updateView('side')}
                    resolution={resolution}
                    onEdit={() => setEditingViewProfile('side')}
                    polylines={getPolylines('views:side')}
                  />
                  <DrawingCanvas
                    label="Superior"
                    axisLabel="X·Z"
                    polygon={views.top}
                    onChange={updateView('top')}
                    resolution={resolution}
                    onEdit={() => setEditingViewProfile('top')}
                    polylines={getPolylines('views:top')}
                  />
                </div>
              )}

              <div className="border-t border-white/5 px-3 py-3 space-y-3 bg-[hsl(224_50%_6%)]">
                <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
                  <Palette className="w-3.5 h-3.5 text-green-400" />
                  Apariencia de la figura
                </h3>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-muted-foreground/80 flex items-center justify-between">
                    <span>Color de la figura</span>
                    <span className="font-mono text-[10px] text-green-400">
                      {figureColor}
                    </span>
                  </label>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-black/40 border border-white/10">
                    <input
                      type="color"
                      value={figureColor}
                      onChange={(e) => {
                        setFigureColor(e.target.value);
                        setEditedVertices(null);
                      }}
                      title="Color de la figura 3D"
                      className="w-8 h-8 rounded cursor-pointer bg-transparent border border-white/10 p-0.5"
                    />
                    <button
                      onClick={() => {
                        setFigureColor('#121ca7');
                        setEditedVertices(null);
                      }}
                      className="text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
                      title="Restablecer color por defecto"
                    >
                      Restablecer
                    </button>
                    <input
                      type="text"
                      value={textureFileName}
                      readOnly
                      placeholder="Ninguna textura seleccionada"
                      className="flex-1 min-w-0 px-3 py-2 rounded-md text-sm bg-black/40 border border-white/10 text-foreground placeholder:text-muted-foreground/40 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap"
                      onClick={openTexturePicker}
                    />
                    <button
                      onClick={() => setTextureBrowserOpen(true)}
                      title="Explorar texturas de la carpeta local"
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-green-500/20 hover:bg-green-500/30 text-green-200 border border-green-500/30 transition-colors"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      Explorar
                    </button>
                    {texture && (
                      <button
                        onClick={clearTexture}
                        title="Eliminar textura"
                        className="shrink-0 flex items-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    ref={textureInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleTextureFile(file);
                      }
                      e.target.value = '';
                    }}
                  />
                   <p className="text-[10px] text-muted-foreground/60 flex items-start gap-1">
                     <Info className="w-2.5 h-2.5 shrink-0 mt-0.5" />
                     La textura se aplica sobre el color de la figura. Formatos:
                     JPG, PNG, WebP, SVG.
                   </p>
                   {texture && (
                     <div className="mt-1 rounded-md border border-white/10 overflow-hidden w-16 h-16 bg-black/40">
                       <img
                         src={texture}
                         alt="Textura cargada"
                         className="w-full h-full object-cover"
                       />
                     </div>
                   )}
                    {texture && (
                      <div className="flex items-center gap-2 mt-1">
                        <label className="text-[10px] text-muted-foreground/80">
                          Repetición:
                        </label>
                        <input
                          type="number"
                          min={0.1}
                          max={10}
                          step={0.1}
                          value={textureRepeat}
                          onChange={(e) => setTextureRepeat(Math.max(0.1, Math.min(10, parseFloat(e.target.value) || 1)))}
                          className="w-16 px-1 py-0.5 text-xs bg-black/40 border border-white/10 rounded text-foreground focus:outline-none focus:border-green-500"
                        />
                      </div>
                    )}
                   <label className="text-[10px] text-muted-foreground/80 mt-1">
                     Proyección de la textura
                   </label>
                  <select
                    value={textureProjection}
                    onChange={(event) =>
                      setTextureProjection(
                        event.target.value as LatheTextureProjection
                      )
                    }
                    className="w-full px-3 py-2 rounded-md text-xs bg-black/40 border border-white/10 text-foreground"
                  >
                    <option value="cylindrical">Envolvente cilíndrica</option>
                    <option value="planar">Plana</option>
                    <option value="spherical">Esférica</option>
                  </select>
                  <label className="flex items-center gap-1.5 mt-1 cursor-pointer text-[10px] text-muted-foreground/80">
                    <input
                      type="checkbox"
                      checked={textureHelper}
                      onChange={(e) => setTextureHelper(e.target.checked)}
                      className="accent-yellow-400"
                    />
                    Ayuda de textura
                    {(textureHelper || textureHelperDirty) && (
                      <button
                        type="button"
                        onClick={() =>
                          setTextureHelperTransform(IDENTITY_TRANSFORM)
                        }
                        className="ml-auto px-1.5 py-0.5 rounded border border-white/10 bg-black/40 hover:bg-white/10"
                        title="Restablecer la pieza"
                      >
                        ↺
                      </button>
                    )}
                  </label>
                  <label className="text-[10px] text-muted-foreground/80 mt-1">
                    Acabado de la textura
                  </label>
                  <select
                    value={textureFinish}
                    onChange={(event) =>
                      setTextureFinish(event.target.value as TextureFinish)
                    }
                    className="w-full px-3 py-2 rounded-md text-xs bg-black/40 border border-white/10 text-foreground"
                  >
                     <option value="metallic">Brillo metalizado</option>
                     <option value="semi-matte">Semimate</option>
                     <option value="matte">Mate</option>
                     <option value="glossy">Espejo</option>
                     <option value="mirror">Espejo Suelo</option>
                  </select>
                  <label className="text-[10px] text-muted-foreground/80 mt-1 flex items-center justify-between">
                    <span>Relieve de la textura</span>
                    <span className="font-mono text-green-400">
                      {Math.round(textureRelief * 100)}%
                    </span>
                  </label>
                  <Slider
                    min={0}
                    max={1}
                    step={0.01}
                    value={[textureRelief]}
                    onValueChange={([v]) => setTextureRelief(v)}
                    className="w-full mb-3"
                  />
                </div>

                {/* Transparencia del objeto 3D: mando aparte de los
                    lienzos de dibujo, afecta a la figura completa */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-muted-foreground/80 flex items-center justify-between">
                    <span>Transparencia del objeto</span>
                    <span className="font-mono text-[10px] text-green-400">
                      {Math.round((1 - viewsOpacity) * 100)}%
                    </span>
                  </label>
                  <Slider
                    min={0}
                    max={95}
                    step={1}
                    value={[Math.round((1 - viewsOpacity) * 100)]}
                    onValueChange={([v]) => setViewsOpacity(1 - v / 100)}
                  />
                  <p className="text-[10px] text-muted-foreground/60 flex items-start gap-1">
                    <Info className="w-2.5 h-2.5 shrink-0 mt-0.5" />A 0% la
                    figura es sólida; a 95% casi invisible. Sirve para ver la
                    escena a través del objeto.
                  </p>
                </div>
              </div>
            </>
          ) : mode === 'text' ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="px-3 py-2 border-b border-white/5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <span className="w-1 h-3 rounded-full bg-green-500" />
                  Texto a 3D
                </h2>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5 flex items-center gap-1">
                  <Info className="w-2.5 h-2.5" />
                  Escribe un texto y elige la fuente
                </p>
              </div>

              <div className="flex-1 flex flex-col gap-4 p-3 overflow-y-auto custom-scrollbar">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Texto
                  </label>
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setEditedVertices(null);
                    }}
                    placeholder="Escribe algo..."
                    className="w-full px-3 py-2 rounded-md text-sm bg-black/40 border border-white/10 focus:border-green-500/50 focus:ring-1 focus:ring-green-500/30 outline-none text-foreground placeholder:text-muted-foreground/40"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Fuente
                  </label>
                  <select
                    value={fontCss}
                    onChange={(e) => {
                      setFontCss(e.target.value);
                      setEditedVertices(null);
                    }}
                    className="w-full px-3 py-2 rounded-md text-sm bg-black/40 border border-white/10 focus:border-green-500/50 focus:ring-1 focus:ring-green-500/30 outline-none text-foreground cursor-pointer"
                    style={{ fontFamily: fontCss }}
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option
                        key={f.label}
                        value={f.css}
                        style={{ fontFamily: f.css }}
                      >
                        {f.label}
                      </option>
                    ))}
                    {customFonts.length > 0 && (
                      <optgroup label="Importadas">
                        {customFonts.map((f) => (
                          <option
                            key={f.label}
                            value={f.css}
                            style={{ fontFamily: f.css }}
                          >
                            {f.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Importar fuente de Google Fonts
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={customFontName}
                      onChange={(e) => {
                        setCustomFontName(e.target.value);
                        setImportMsg(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') importFont();
                      }}
                      placeholder="Ej: Press Start 2P"
                      className="flex-1 min-w-0 px-3 py-2 rounded-md text-sm bg-black/40 border border-white/10 focus:border-green-500/50 focus:ring-1 focus:ring-green-500/30 outline-none text-foreground placeholder:text-muted-foreground/40"
                    />
                    <button
                      onClick={importFont}
                      disabled={!customFontName.trim() || importing}
                      title="Importar esta fuente"
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-green-500/20 hover:bg-green-500/30 text-green-200 border border-green-500/30 disabled:opacity-40 transition-colors"
                    >
                      {importing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                      Importar
                    </button>
                  </div>
                  <button
                    onClick={openGoogleFonts}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-white/5 hover:bg-white/10 text-foreground border border-white/10 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Abrir catálogo de Google Fonts
                  </button>
                  {importMsg && (
                    <p
                      className={`text-[10px] flex items-center gap-1 ${
                        importMsg.ok ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {importMsg.ok ? (
                        <Check className="w-3 h-3 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3 h-3 shrink-0" />
                      )}
                      {importMsg.text}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Cargar fuente del almacenamiento
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={localFontFileName}
                      readOnly
                      placeholder="Ningún archivo seleccionado"
                      className="flex-1 min-w-0 px-3 py-2 rounded-md text-sm bg-black/40 border border-white/10 text-foreground placeholder:text-muted-foreground/40 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap"
                      onClick={openLocalFontPicker}
                    />
                    <button
                      onClick={openLocalFontPicker}
                      disabled={localFontLoading}
                      title="Explorar archivos del dispositivo"
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-green-500/20 hover:bg-green-500/30 text-green-200 border border-green-500/30 disabled:opacity-40 transition-colors"
                    >
                      {localFontLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FolderOpen className="w-3.5 h-3.5" />
                      )}
                      Explorar
                    </button>
                  </div>
                  <input
                    ref={localFontInputRef}
                    type="file"
                    accept=".ttf,.otf,.woff,.woff2"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setLocalFontFileName(file.name);
                        handleLocalFontFile(file);
                      }
                      e.target.value = '';
                    }}
                  />
                  {localFontMsg && (
                    <p
                      className={`text-[10px] flex items-center gap-1 ${
                        localFontMsg.ok ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {localFontMsg.ok ? (
                        <Check className="w-3 h-3 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3 h-3 shrink-0" />
                      )}
                      {localFontMsg.text}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center justify-between">
                    <span>
                      {textMode === 'plane' ? 'Nitidez' : 'Resolución'}
                    </span>
                    <span className="font-mono text-green-400">{textRes}</span>
                  </label>
                  <Slider
                    min={12}
                    max={144}
                    value={[textRes]}
                    onValueChange={([v]) => {
                      setTextRes(v);
                      setEditedVertices(null);
                    }}
                  />
                </div>

                {textMode !== 'plane' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center justify-between">
                      <span>Profundidad</span>
                      <span className="font-mono text-green-400">
                        {textDepth}
                      </span>
                    </label>
                    <Slider
                      min={1}
                      max={48}
                      value={[textDepth]}
                      onValueChange={([v]) => {
                        setTextDepth(v);
                        setEditedVertices(null);
                      }}
                    />
                  </div>
                )}

                {textMode === 'smooth' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center justify-between">
                      <span>Opacidad del costado</span>
                      <span className="font-mono text-green-400">
                        {Math.round(textOpacity * 100)}%
                      </span>
                    </label>
                    <Slider
                      min={5}
                      max={100}
                      step={1}
                      value={[Math.round(textOpacity * 100)]}
                      onValueChange={([v]) => {
                        setTextOpacity(v / 100);
                        setEditedVertices(null);
                      }}
                    />
                  </div>
                )}

                {textMode === 'voxel' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 px-3 py-2 rounded-md bg-black/40 border border-white/10 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={hollowText}
                        onChange={(e) => {
                          setHollowText(e.target.checked);
                          setEditedVertices(null);
                        }}
                        className="w-3.5 h-3.5 accent-green-500 cursor-pointer"
                      />
                      <span className="text-xs text-foreground">
                        Letras huecas (solo contorno)
                      </span>
                    </label>
                    <p className="text-[10px] text-muted-foreground/60 flex items-start gap-1">
                      <Info className="w-2.5 h-2.5 shrink-0 mt-0.5" />
                      Solo el borde del trazo: muchos menos vóxeles, vértices y
                      caras. Notable sobre todo en resoluciones altas.
                    </p>
                  </div>
                )}

                {textMode === 'voxel' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 px-3 py-2 rounded-md bg-black/40 border border-white/10 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={greedyMesh}
                        onChange={(e) => {
                          setGreedyMesh(e.target.checked);
                          setEditedVertices(null);
                        }}
                        className="w-3.5 h-3.5 accent-green-500 cursor-pointer"
                      />
                      <span className="text-xs text-foreground">
                        Malla optimizada (sin divisiones internas)
                      </span>
                    </label>
                    <p className="text-[10px] text-muted-foreground/60 flex items-start gap-1">
                      <Info className="w-2.5 h-2.5 shrink-0 mt-0.5" />
                      La letra sigue sólida: las caras planas se fusionan en
                      rectángulos grandes y el interior no genera vértices ni
                      aristas. Muchísimos menos vértices y caras.
                    </p>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Modo de salida
                  </label>
                  <div className="flex p-1 rounded-lg bg-black/40 border border-white/5">
                    <button
                      onClick={() => {
                        setTextMode('voxel');
                        setEditedVertices(null);
                      }}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        textMode === 'voxel'
                          ? 'bg-green-500/20 text-green-300'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      title="Rasteriza el texto a una rejilla y extruye cada celda: curvas y diagonales con escalones de vóxeles"
                    >
                      <Boxes className="w-3.5 h-3.5" />
                      Vóxeles 3D
                    </button>
                    <button
                      onClick={() => {
                        setTextMode('smooth');
                        setEditedVertices(null);
                      }}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        textMode === 'smooth'
                          ? 'bg-green-500/20 text-green-300'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      title="Igual que el estilo Suave de las figuras: traza el contorno real de la letra y lo extruye, con curvas y diagonales lisas, sin escalones"
                    >
                      <Spline className="w-3.5 h-3.5" />
                      Suave
                    </button>
                    <button
                      onClick={() => {
                        setTextMode('plane');
                        setEditedVertices(null);
                      }}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        textMode === 'plane'
                          ? 'bg-green-500/20 text-green-300'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      Vista plana
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60">
                    {textMode === 'plane'
                      ? 'Copia el color exacto del texto tal como se ve en pantalla (textura píxel a píxel).'
                      : textMode === 'smooth'
                        ? 'Extruye el contorno real de la letra: curvas y diagonales lisas, sin escalones, con color por cara.'
                        : hollowText
                          ? 'Extruye solo el contorno: letras huecas, malla mucho más ligera.'
                          : 'Extruye el texto en vóxeles 3D con color por cara.'}
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Color
                  </label>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-black/40 border border-white/10">
                    <input
                      type="color"
                      value={baseColor}
                      onChange={(e) => {
                        setBaseColor(e.target.value);
                        setEditedVertices(null);
                      }}
                      title="Color base del texto"
                      className="w-8 h-8 rounded cursor-pointer bg-transparent border border-white/10 p-0.5"
                    />
                    <span className="text-xs font-mono text-muted-foreground">
                      {baseColor}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 ml-auto">
                      fuentes sin color
                    </span>
                  </div>
                  <label className="flex items-center gap-2 px-3 py-2 rounded-md bg-black/40 border border-white/10 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={useFontColor}
                      onChange={(e) => {
                        setUseFontColor(e.target.checked);
                        setEditedVertices(null);
                      }}
                      className="w-3.5 h-3.5 accent-green-500 cursor-pointer"
                    />
                    <span className="text-xs text-foreground">
                      Usar color propio de la fuente
                    </span>
                  </label>
                  <p className="text-[10px] text-muted-foreground/60 flex items-start gap-1">
                    <Palette className="w-2.5 h-2.5 shrink-0 mt-0.5" />
                    Si la fuente trae color o textura (emojis, fuentes de
                    color), el modelo reproduce esos colores exactos.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
                    <ImageIcon className="w-3.5 h-3.5 text-green-400" />
                    Textura (imagen)
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={textureFileName}
                      readOnly
                      placeholder="Ninguna textura seleccionada"
                      className="flex-1 min-w-0 px-3 py-2 rounded-md text-sm bg-black/40 border border-white/10 text-foreground placeholder:text-muted-foreground/40 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap"
                      onClick={() => setTextureBrowserOpen(true)}
                    />
                    <button
                      onClick={() => setTextureBrowserOpen(true)}
                      title="Seleccionar imagen como textura"
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-green-500/20 hover:bg-green-500/30 text-green-200 border border-green-500/30 transition-colors"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      Explorar
                    </button>
                    {texture && (
                      <button
                        onClick={clearTexture}
                        title="Eliminar textura"
                        className="shrink-0 flex items-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    ref={textureInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleTextureFile(file);
                      }
                      e.target.value = '';
                    }}
                  />
                  <p className="text-[10px] text-muted-foreground/60 flex items-start gap-1">
                    <Info className="w-2.5 h-2.5 shrink-0 mt-0.5" />
                    La textura se aplica sobre el texto. Formatos: JPG, PNG,
                    WebP, SVG.
                  </p>
                  {texture && (
                    <div className="mt-1 rounded-md border border-white/10 overflow-hidden w-16 h-16 bg-black/40">
                      <img
                        src={texture}
                        alt="Textura cargada"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <label className="text-[10px] text-muted-foreground/80 mt-1">
                    Proyección de la textura
                  </label>
                  <select
                    value={textureProjection}
                    onChange={(event) =>
                      setTextureProjection(
                        event.target.value as LatheTextureProjection
                      )
                    }
                    className="w-full px-3 py-2 rounded-md text-xs bg-black/40 border border-white/10 text-foreground"
                  >
                    <option value="cylindrical">Envolvente cilíndrica</option>
                    <option value="planar">Plana</option>
                    <option value="spherical">Esférica</option>
                  </select>
                  <label className="flex items-center gap-1.5 mt-1 cursor-pointer text-[10px] text-muted-foreground/80">
                    <input
                      type="checkbox"
                      checked={textureHelper}
                      onChange={(e) => setTextureHelper(e.target.checked)}
                      className="accent-yellow-400"
                    />
                    Ayuda de textura
                    {(textureHelper || textureHelperDirty) && (
                      <button
                        type="button"
                        onClick={() =>
                          setTextureHelperTransform(IDENTITY_TRANSFORM)
                        }
                        className="ml-auto px-1.5 py-0.5 rounded border border-white/10 bg-black/40 hover:bg-white/10"
                        title="Restablecer la pieza"
                      >
                        ↺
                      </button>
                    )}
                  </label>
                  <label className="text-[10px] text-muted-foreground/80 mt-1">
                    Acabado de la textura
                  </label>
                  <select
                    value={textureFinish}
                    onChange={(event) =>
                      setTextureFinish(event.target.value as TextureFinish)
                    }
                    className="w-full px-3 py-2 rounded-md text-xs bg-black/40 border border-white/10 text-foreground"
                  >
                     <option value="metallic">Brillo metalizado</option>
                     <option value="semi-matte">Semimate</option>
                     <option value="matte">Mate</option>
                     <option value="glossy">Espejo</option>
                     <option value="mirror">Espejo Suelo</option>
                  </select>
                  <label className="text-[10px] text-muted-foreground/80 mt-1 flex items-center justify-between">
                    <span>Relieve de la textura</span>
                    <span className="font-mono text-green-400">
                      {Math.round(textureRelief * 100)}%
                    </span>
                  </label>
                  <Slider
                    min={0}
                    max={1}
                    step={0.01}
                    value={[textureRelief]}
                    onValueChange={([v]) => setTextureRelief(v)}
                    className="w-full"
                  />
                </div>

                <div className="mt-1 flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Vista previa
                  </label>
                  <div className="rounded-lg border border-white/10 bg-black/40 p-3 flex items-center justify-center min-h-[80px] overflow-hidden">
                    <span
                      className="text-2xl whitespace-nowrap"
                      style={{ fontFamily: fontCss, color: baseColor }}
                    >
                      {text || '...'}
                    </span>
                  </div>
                </div>

                <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1 mt-auto pt-2 border-t border-white/5">
                  <Info className="w-2.5 h-2.5 shrink-0" />
                  {textMode === 'plane'
                    ? 'La vista plana reproduce el color exacto del texto renderizado. Puedes rotarla y exportar STL.'
                    : textMode === 'smooth'
                      ? 'Malla suave: el texto se extruye siguiendo el contorno real de la letra, con curvas lisas como las figuras en estilo Suave. "Opacidad del costado" vuelve translúcido solo el contorno extruido; la letra queda sólida. Editable y exportable a STL.'
                      : hollowText
                        ? 'Letras huecas: solo el contorno del texto se convierte en vóxeles 3D. Malla ligera, ideal para exportar STL.'
                        : 'El texto se convierte en vóxeles 3D, igual que la figura. Puedes editar vértices, rotar y exportar STL.'}
                </p>
              </div>
            </div>
          ) : mode === 'mesh' ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto custom-scrollbar">
              <div className="px-3 py-2 border-b border-white/5 shrink-0">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <span className="w-1 h-3 rounded-full bg-green-500" />
                  Mallas por silueta y plantillas 2D
                </h2>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5 flex items-center gap-1">
                  <Info className="w-2.5 h-2.5" />
                  Dibuja la silueta en X·Y y los cortes horizontales en X·Z
                </p>
              </div>

              <div className="p-3 space-y-4">
                <div className="h-56">
                  <DrawingCanvas
                    label="Silueta"
                    axisLabel="X·Y"
                    polygon={
                      meshSilhouette && meshSilhouette.length > 0
                        ? meshSilhouette
                        : DEFAULT_MESH_SILHOUETTE
                    }
                    onChange={setMeshSilhouette}
                    resolution={resolution}
                    showAxis={true}
                    axisVertical={true}
                    onEdit={() => setEditingMesh(true)}
                    onMaximize={() => setEditingMeshProfile('silhouette')}
                    guideLines={meshSections.map((s) => s.y)}
                    polylines={getPolylines('mesh:silhouette')}
                  />
                </div>
                <div className="h-56">
                  <DrawingCanvas
                    label="Costado"
                    axisLabel="Z·Y"
                    polygon={meshSideView}
                    onChange={setMeshSideView}
                    resolution={resolution}
                    showAxis={true}
                    axisVertical={true}
                    onEdit={() => setEditingMeshSide(true)}
                    onMaximize={() => setEditingMeshProfile('side')}
                    guideLines={meshSections.map((s) => s.y)}
                    polylines={getPolylines('mesh:side')}
                  />
                </div>
                {/* ▼ Selector de vista de la silueta ▼ */}
                <div className="flex items-center gap-2 pt-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Aplicar silueta en:
                  </span>
                  <div className="flex items-center rounded-md border border-white/10 overflow-hidden">
                    {(
                      [
                        { key: 'front', label: 'Frente' },
                        { key: 'side', label: 'Costado' },
                        { key: 'both', label: 'Ambas' },
                      ] as const
                    ).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setMeshSilhouetteView(key)}
                        className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${
                          meshSilhouetteView === key
                            ? 'bg-green-500/25 text-green-300'
                            : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-white/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      Plantillas 2D ({meshSections.length})
                    </h3>
                    <button
                      onClick={addMeshSection}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 text-[11px] font-medium border border-green-500/30 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Añadir plantilla
                    </button>
                  </div>

                  {meshSections.map((section, index) => (
                    <div
                      key={section.id}
                      className="rounded-lg border border-white/10 bg-black/20 p-2.5 space-y-2"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">
                            Plantilla {index + 1}
                          </span>
                          <span className="font-mono text-[10px] text-green-400">
                            Y = {section.y.toFixed(2)}
                          </span>
                          {/* Altura de la plantilla: subir o bajar sin tocar la forma.
                                Ojo: en el lienzo y=0 es arriba, así que subir
                                es RESTAR a la Y. */}
                          <span className="flex items-center gap-0.5">
                            <button
                              type="button"
                              className="flex items-center justify-center w-5 h-5 rounded bg-white/5 border border-white/10 text-foreground hover:bg-white/15 transition-colors disabled:opacity-30 disabled:hover:bg-white/5"
                              title="Subir la plantilla (altura Y)"
                              disabled={section.y <= 0}
                              onClick={() =>
                                moveMeshSectionY(section.id, -0.05)
                              }
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              className="flex items-center justify-center w-5 h-5 rounded bg-white/5 border border-white/10 text-foreground hover:bg-white/15 transition-colors disabled:opacity-30 disabled:hover:bg-white/5"
                              title="Bajar la plantilla (altura Y)"
                              disabled={section.y >= 1}
                              onClick={() => moveMeshSectionY(section.id, 0.05)}
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          </span>
                        </div>
                        {meshSections.length > 1 && (
                          <button
                            onClick={() => removeMeshSection(section.id)}
                            className="p-1 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                            title="Eliminar plantilla"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <SectionTools
                        polygon={section.polygon}
                        onChange={(poly) =>
                          updateMeshSectionPolygon(section.id, poly)
                        }
                      />
                      <div className="h-60">
                        <DrawingCanvas
                          label={`Plantilla ${index + 1}`}
                          axisLabel="X·Z"
                          polygon={section.polygon}
                          onChange={(poly) => {
                            updateMeshSectionPolygon(section.id, poly);
                          }}
                          resolution={resolution}
                          showHeader={false}
                          onEdit={() => setEditingMesh(true)}
                          onMaximize={() =>
                            setEditingMeshProfile(section.id.toString())
                          }
                          polylines={getPolylines(`mesh:section:${section.id}`)}
                        />
                      </div>
                    </div>
                  ))}
                  {/* ▼▼▼ BLOQUE DE APARIENCIA - VA AQUÍ, DENTRO DE LA MITAD DERECHA ▼▼▼ */}
                  <div className="mt-2 pt-3 border-t border-white/10 space-y-3">
                    <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
                      <Palette className="w-3.5 h-3.5 text-green-400" />
                      Apariencia de la figura
                    </h3>

                    {/* Color de la figura */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-muted-foreground/80 flex items-center justify-between">
                        <span>Color de la figura</span>
                        <span className="font-mono text-[10px] text-green-400">
                          {figureColor}
                        </span>
                      </label>
                      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-black/40 border border-white/10">
                        <input
                          type="color"
                          value={figureColor}
                          onChange={(e) => {
                            setFigureColor(e.target.value);
                            setEditedVertices(null);
                          }}
                          className="w-8 h-8 rounded cursor-pointer bg-transparent border border-white/10 p-0.5"
                        />
                        <button
                          onClick={() => {
                            setFigureColor('#121ca7');
                            setEditedVertices(null);
                          }}
                          className="text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
                        >
                          Restablecer
                        </button>
                      </div>
                    </div>

                    {/* Transparencia del objeto 3D: mando aparte de las
                        plantillas, afecta a la figura completa */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center justify-between">
                        <span>Transparencia del objeto 3D</span>
                        <span className="font-mono text-green-400">
                          {Math.round((1 - meshOpacity) * 100)}%
                        </span>
                      </label>
                      <Slider
                        min={0}
                        max={95}
                        step={1}
                        value={[Math.round((1 - meshOpacity) * 100)]}
                        onValueChange={([v]) => {
                          setMeshOpacity(1 - v / 100);
                          setEditedVertices(null);
                        }}
                      />
                      <p className="text-[10px] text-muted-foreground/60 flex items-start gap-1">
                        <Info className="w-2.5 h-2.5 shrink-0 mt-0.5" />A 0% la
                        figura es sólida; a 95% casi invisible. Sirve para ver
                        el interior o las plantillas a través del objeto.
                      </p>
                    </div>

                    {/* Textura */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-muted-foreground/80">
                        Textura (imagen)
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={textureFileName}
                          readOnly
                          placeholder="Ninguna textura seleccionada"
                          className="flex-1 min-w-0 px-3 py-2 rounded-md text-sm bg-black/40 border border-white/10 text-foreground placeholder:text-muted-foreground/40 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap"
                          onClick={openTexturePicker}
                        />
                        <button
                          onClick={() => setTextureBrowserOpen(true)}
                          title="Explorar texturas de la carpeta local"
                          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-green-500/20 hover:bg-green-500/30 text-green-200 border border-green-500/30 transition-colors"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                          Explorar
                        </button>
                        {texture && (
                          <button
                            onClick={clearTexture}
                            title="Eliminar textura"
                            className="shrink-0 flex items-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <input
                        ref={textureInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleTextureFile(file);
                          e.target.value = '';
                        }}
                      />
                      <p className="text-[10px] text-muted-foreground/60 flex items-start gap-1">
                        <Info className="w-2.5 h-2.5 shrink-0 mt-0.5" />
                        La textura se aplica sobre el color de la figura.
                        Formatos: JPG, PNG, WebP, SVG.
                      </p>
                      {texture && (
                        <div className="mt-1 rounded-md border border-white/10 overflow-hidden w-16 h-16 bg-black/40">
                          <img
                            src={texture}
                            alt="Textura cargada"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}

                      <label className="text-[10px] text-muted-foreground/80 mt-1">
                        Proyección de la textura
                      </label>
                      <select
                        value={textureProjection}
                        onChange={(event) =>
                          setTextureProjection(
                            event.target.value as LatheTextureProjection
                          )
                        }
                        className="w-full px-3 py-2 rounded-md text-xs bg-black/40 border border-white/10 text-foreground"
                      >
                        <option value="cylindrical">
                          Envolvente cilíndrica
                        </option>
                        <option value="planar">Plana</option>
                        <option value="spherical">Esférica</option>
                      </select>
                      <label className="flex items-center gap-1.5 mt-1 cursor-pointer text-[10px] text-muted-foreground/80">
                        <input
                          type="checkbox"
                          checked={textureHelper}
                          onChange={(e) => setTextureHelper(e.target.checked)}
                          className="accent-yellow-400"
                        />
                        Ayuda de textura
                        {(textureHelper || textureHelperDirty) && (
                          <button
                            type="button"
                            onClick={() =>
                              setTextureHelperTransform(IDENTITY_TRANSFORM)
                            }
                            className="ml-auto px-1.5 py-0.5 rounded border border-white/10 bg-black/40 hover:bg-white/10"
                            title="Restablecer la pieza"
                          >
                            ↺
                          </button>
                        )}
                      </label>

                      <label className="text-[10px] text-muted-foreground/80 mt-1">
                        Acabado de la textura
                      </label>
                      <select
                        value={textureFinish}
                        onChange={(event) =>
                          setTextureFinish(event.target.value as TextureFinish)
                        }
                        className="w-full px-3 py-2 rounded-md text-xs bg-black/40 border border-white/10 text-foreground"
                      >
                     <option value="metallic">Brillo metalizado</option>
                     <option value="semi-matte">Semimate</option>
                     <option value="matte">Mate</option>
                     <option value="glossy">Espejo</option>
                     <option value="mirror">Espejo Suelo</option>
                   </select>

                      <label className="text-[10px] text-muted-foreground/80 mt-1 flex items-center justify-between">
                        <span>Relieve de la textura</span>
                        <span className="font-mono text-green-400">
                          {Math.round(textureRelief * 100)}%
                        </span>
                      </label>
                      <Slider
                        min={0}
                        max={1}
                        step={0.01}
                        value={[textureRelief]}
                        onValueChange={([v]) => setTextureRelief(v)}
                        className="w-full mb-3"
                      />
                    </div>
                  </div>
                  {/* ▲▲▲ FIN DEL BLOQUE DE APARIENCIA ▲▲▲ */}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-white/5 shrink-0">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <span className="w-1 h-3 rounded-full bg-green-500" />
                  Perfil del torno
                </h2>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5 flex items-center gap-1">
                  <Info className="w-2.5 h-2.5" />
                  Dibuja el perfil a la derecha del eje (línea central)
                </p>
                <div className="flex items-center rounded-md border border-white/10 overflow-hidden mt-2">
                  {(
                    [
                      { key: 'suave', label: 'Suave', icon: Spline },
                      { key: 'fusionada', label: 'Fusionada', icon: Grid3x3 },
                      { key: 'voxeles', label: 'Vóxeles', icon: Box },
                    ] as const
                  ).map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      onClick={() => setMeshStyle(key)}
                      className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium transition-colors ${
                        meshStyle === key
                          ? 'bg-green-500/25 text-green-300'
                          : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                      }`}
                      title={`Usar malla ${label.toLowerCase()} en el torno`}
                    >
                      <Icon className="w-3 h-3" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-none h-56 p-3 flex">
                <DrawingCanvas
                  label="Perfil"
                  axisLabel="X·Y"
                  polygon={latheProfile}
                  onChange={setLatheProfile}
                  resolution={resolution}
                  showAxis={true}
                  axisVertical={true}
                  polylines={getPolylines('lathe:profile')}
                  onEdit={() => {
                    console.log('EDIT PERFIL pulsado');
                    setEditingLatheProfile(true);
                  }}
                />
              </div>

              <div className="px-3 py-2 border-t border-white/5 space-y-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center justify-between">
                    <span>Segmentos de rotación</span>
                    <span className="font-mono text-green-400">
                      {latheSegments}
                    </span>
                  </label>
                  <Slider
                    min={8}
                    max={128}
                    value={[latheSegments]}
                    onValueChange={([v]) => setLatheSegments(v)}
                    className="w-full"
                  />
                  <p className="text-[10px] text-muted-foreground/60">
                    Más segmentos = más suave, pero más pesado
                  </p>
                </div>

                <div className="border-t border-white/5 pt-3 space-y-3">
                  <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-2">
                    <Palette className="w-3.5 h-3.5 text-green-400" />
                    Apariencia de la figura
                  </h3>

                   <div className="flex flex-col gap-1.5">
                     <label className="text-[10px] text-muted-foreground/80 flex items-center justify-between">
                       <span>Color de la figura</span>
                       <span className="font-mono text-[10px] text-green-400">
                         {latheFigureColor}
                       </span>
                     </label>
                     <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-black/40 border border-white/10">
                       <input
                         type="color"
                         value={latheFigureColor}
                         onChange={(e) => {
                           setLatheFigureColor(e.target.value);
                           setEditedVertices(null);
                         }}
                         className="w-8 h-8 rounded cursor-pointer bg-transparent border border-white/10 p-0.5"
                       />
                       <button
                         onClick={() => {
                           setLatheFigureColor('#121ca7');
                           setEditedVertices(null);
                         }}
                         className="text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
                       >
                         Restablecer
                       </button>
                       <input
                         type="text"
                         value={latheTextureFileName}
                         readOnly
                         placeholder="Ninguna textura seleccionada"
                         className="flex-1 min-w-0 px-3 py-2 rounded-md text-sm bg-black/40 border border-white/10 text-foreground placeholder:text-muted-foreground/40 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap"
                         onClick={openTexturePicker}
                       />
                       <button
                         onClick={() => setTextureBrowserOpen(true)}
                         title="Explorar texturas de la carpeta local"
                         className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-green-500/20 hover:bg-green-500/30 text-green-200 border border-green-500/30 transition-colors"
                       >
                         <ImageIcon className="w-3.5 h-3.5" />
                         Explorar
                       </button>
                       {latheTexture && (
                         <button
                           onClick={clearTexture}
                           title="Quitar textura"
                           className="shrink-0 flex items-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30 transition-colors"
                         >
                           <X className="w-3.5 h-3.5" />
                         </button>
                       )}
                    </div>
                    <input
                      ref={textureInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleTextureFile(file);
                        e.target.value = '';
                      }}
                    />
                    {latheTexture && (
                      <div className="mt-1 rounded-md border border-white/10 overflow-hidden w-16 h-16 bg-black/40">
                        <img
                          src={latheTexture}
                          alt="Textura cargada"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <label className="text-[10px] text-muted-foreground/80 mt-1">
                      Proyección de la textura
                    </label>
                    <select
                      value={textureProjection}
                      onChange={(event) =>
                        setTextureProjection(
                          event.target.value as LatheTextureProjection
                        )
                      }
                      className="w-full px-3 py-2 rounded-md text-xs bg-black/40 border border-white/10 text-foreground"
                    >
                      <option value="cylindrical">Envolvente cilíndrica</option>
                      <option value="planar">Plana</option>
                      <option value="spherical">Esférica</option>
                    </select>
                    <label className="flex items-center gap-1.5 mt-1 cursor-pointer text-[10px] text-muted-foreground/80">
                      <input
                        type="checkbox"
                        checked={textureHelper}
                        onChange={(e) => setTextureHelper(e.target.checked)}
                        className="accent-yellow-400"
                      />
                      Ayuda de textura
                      {(textureHelper || textureHelperDirty) && (
                        <button
                          type="button"
                          onClick={() =>
                            setTextureHelperTransform(IDENTITY_TRANSFORM)
                          }
                          className="ml-auto px-1.5 py-0.5 rounded border border-white/10 bg-black/40 hover:bg-white/10"
                          title="Restablecer la pieza"
                        >
                          ↺
                        </button>
                      )}
                    </label>
                    <label className="text-[10px] text-muted-foreground/80 mt-1">
                      Acabado de la textura
                    </label>
                    <select
                      value={textureFinish}
                      onChange={(event) =>
                        setTextureFinish(event.target.value as TextureFinish)
                      }
                      className="w-full px-3 py-2 rounded-md text-xs bg-black/40 border border-white/10 text-foreground"
                    >
                      <option value="glossy">Brillo metalizado</option>
                      <option value="semi-matte">Semimate</option>
                      <option value="matte">Mate</option>
                      <option value="mirror">Espejo</option>
                    </select>
                    <label className="text-[10px] text-muted-foreground/80 mt-1 flex items-center justify-between">
                      <span>Relieve de la textura</span>
                      <span className="font-mono text-green-400">
                        {Math.round(textureRelief * 100)}%
                      </span>
                    </label>
                    <Slider
                      min={0}
                      max={1}
                      step={0.01}
                      value={[textureRelief]}
                      onValueChange={([v]) => setTextureRelief(v)}
                      className="w-full"
                    />
                    <label className="text-[10px] text-muted-foreground/80 mt-1 flex items-center justify-between">
                      <span>Opacidad del torno</span>
                      <span className="font-mono text-green-400">
                        {Math.round(latheOpacity * 100)}%
                      </span>
                    </label>
                    <Slider
                      min={0}
                      max={1}
                      step={0.01}
                      value={[latheOpacity]}
                      onValueChange={([v]) => setLatheOpacity(v)}
                      className="w-full"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 px-3 py-2 rounded-md bg-black/40 border border-white/10 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={latheClamp}
                    onChange={(e) => setLatheClamp(e.target.checked)}
                    className="w-3.5 h-3.5 accent-green-500 cursor-pointer"
                  />
                  <span className="text-xs text-foreground">
                    Cerrar extremos (tapas)
                  </span>
                </label>
              </div>

              <div className="mt-auto px-3 py-2 border-t border-white/5">
                <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                  <Info className="w-2.5 h-2.5 shrink-0" />
                  El perfil rota alrededor del eje vertical para crear un objeto
                  3D simétrico.
                  {!latheClamp && ' Sin tapas, los extremos quedan abiertos.'}
                   </p>
                 </div>
                 </>
             )}
         </div>

         <div className="flex-1 flex flex-col min-w-0 min-h-0">
           {cameraViewMode && (
             <div className="flex items-center gap-2 px-2 py-1.5 bg-black/60 backdrop-blur-sm border-b border-white/5 shrink-0">
               <button
                 onClick={() => setPlaying(!playing)}
                 className={`p-1 rounded text-xs ${
                   playing
                     ? 'bg-green-500/20 text-green-300'
                     : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300'
                 }`}
                 title={playing ? 'Pausar' : 'Reproducir'}
               >
                 {playing ? '⏸' : '▶'}
               </button>
               <button
                 onClick={() => { setPlaying(false); setCurrentTime(0.1); }}
                 className="p-1 rounded text-xs bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground"
                 title="Detener"
               >
                 ⏹
               </button>
               <input
                 type="range"
                 min={0.01}
                 max={Math.max(...(animationTracks.length > 0 ? animationTracks.map((t) => t.duration) : [3000])) / 1000}
                 step={0.01}
                 value={currentTime}
                 onChange={(e) => setCurrentTime(Math.max(parseFloat(e.target.value) || 0.1, 0.01))}
                 className="flex-1 h-1"
               />
               <span className="w-16 text-right text-foreground text-xs font-mono">
                 {currentTime.toFixed(1)}s / {Math.max(...(animationTracks.length > 0 ? animationTracks.map((t) => t.duration) : [3000])) / 1000}s
               </span>
             </div>
           )}
           <div
            className={`relative flex-1 ${isEditingCanvas ? 'grid grid-cols-1 grid-rows-1' : 'grid grid-cols-2 grid-rows-2'} gap-1.5 p-1.5 min-w-0 min-h-0`}
          >
            {mode === 'lathe' && editingLatheProfile ? (
              <EditorCanvasComponent
                label="Perfil del torno"
                axisLabel="X·Y"
                polygon={latheProfile}
                onChange={(poly: Polygon) => {
                  setLatheProfile(poly);
                  setEditedVertices(null);
                }}
                resolution={editorGridResolution}
                onClose={() => setEditingLatheProfile(false)}
                enableScale={true}
                gridResolution={editorGridResolution}
                onGridResolutionChange={setEditorGridResolution}
                canvasZoom={editorCanvasZoom}
                onCanvasZoomChange={setEditorCanvasZoom}
                polylines={getPolylines('lathe:profile')}
                onPolylinesChange={(lines: Polyline[]) =>
                  updatePolylines('lathe:profile', lines)
                }
                templateImage={templateImage}
                templateOpacity={templateOpacity}
                templateScale={templateScale}
              />
            ) : editingViewProfile &&
              (mode === 'views' || mode === 'extrude') ? (
              <EditorCanvasComponent
                label={
                  editingViewProfile === 'front'
                    ? 'Frente'
                    : editingViewProfile === 'side'
                      ? 'Costado'
                      : 'Superior'
                }
                axisLabel={
                  editingViewProfile === 'front'
                    ? 'X·Y'
                    : editingViewProfile === 'side'
                      ? 'Z·Y'
                      : 'X·Z'
                }
                polygon={views[editingViewProfile]}
                onChange={(poly: Polygon) => {
                  setViews((prev) => ({ ...prev, [editingViewProfile]: poly }));
                  setEditedVertices(null);
                }}
                resolution={editorGridResolution}
                onClose={() => setEditingViewProfile(null)}
                gridResolution={editorGridResolution}
                onGridResolutionChange={setEditorGridResolution}
                canvasZoom={editorCanvasZoom}
                onCanvasZoomChange={setEditorCanvasZoom}
                polylines={getPolylines(`views:${editingViewProfile}`)}
                onPolylinesChange={(lines: Polyline[]) =>
                  updatePolylines(`views:${editingViewProfile}`, lines)
                }
                templateImage={templateImage}
                templateOpacity={templateOpacity}
                templateScale={templateScale}
              />
            ) : mode === 'views' || mode === 'extrude' ? (
              <>
                {(!editingView || editingView === 'front') && (
        <ViewerPanel
          viewName="front"
          label="Frente · X·Y"
          editingState={editingView === 'front'}
          onSetEditing={(v: boolean) => setEditingView(v ? 'front' : null)}
          onActiveView={() => setActiveView('front')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}

                {(!editingView || editingView === 'top') && (
        <ViewerPanel
          viewName="top"
          label="Superior · X·Z"
          editingState={editingView === 'top'}
          onSetEditing={(v: boolean) => setEditingView(v ? 'top' : null)}
          onActiveView={() => setActiveView('top')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}

                {(!editingView || editingView === 'side') && (
        <ViewerPanel
          viewName="side"
          label="Costado · Z·Y"
          editingState={editingView === 'side'}
          onSetEditing={(v: boolean) => setEditingView(v ? 'side' : null)}
          onActiveView={() => setActiveView('side')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}

                {(!editingView || editingView === '3d') && (
        <ViewerPanel
          viewName="3d"
          label={isRecordingCameraPath ? '3D ●' : '3D'}
          editingState={editingView === '3d'}
          onSetEditing={(v: boolean) => setEditingView(v ? '3d' : null)}
          onActiveView={() => setActiveView('3d')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}
              </>
            ) : mode === 'text' ? (
              <>
                {(!editingTextPanel || editingTextPanel === 'front') && (
        <ViewerPanel
          viewName="front"
          label="Frente"
          editingState={editingTextPanel === 'front'}
          onSetEditing={(v: boolean) => setEditingTextPanel(v ? 'front' : null)}
          onActiveView={() => setActiveView('front')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}

                {(!editingTextPanel || editingTextPanel === 'top') && (
        <ViewerPanel
          viewName="top"
          label="Superior"
          editingState={editingTextPanel === 'top'}
          onSetEditing={(v: boolean) => setEditingTextPanel(v ? 'top' : null)}
          onActiveView={() => setActiveView('top')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}

                {(!editingTextPanel || editingTextPanel === 'side') && (
        <ViewerPanel
          viewName="side"
          label="Costado"
          editingState={editingTextPanel === 'side'}
          onSetEditing={(v: boolean) => setEditingTextPanel(v ? 'side' : null)}
          onActiveView={() => setActiveView('side')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}

                {(!editingTextPanel || editingTextPanel === '3d') && (
        <ViewerPanel
          viewName="3d"
          label={isRecordingCameraPath ? '3D Libre ●' : '3D Libre'}
          editingState={editingTextPanel === '3d'}
          onSetEditing={(v: boolean) => setEditingTextPanel(v ? '3d' : null)}
          onActiveView={() => setActiveView('3d')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}
              </>
            ) : mode === 'lathe' ? (
              <>
                {(!editingLathePanel || editingLathePanel === 'front') && (
        <ViewerPanel
          viewName="front"
          label="Frente"
          editingState={editingLathePanel === 'front'}
          onSetEditing={(v: boolean) => setEditingLathePanel(v ? 'front' : null)}
          onActiveView={() => setActiveView('front')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}

                {(!editingLathePanel || editingLathePanel === 'top') && (
        <ViewerPanel
          viewName="top"
          label="Superior"
          editingState={editingLathePanel === 'top'}
          onSetEditing={(v: boolean) => setEditingLathePanel(v ? 'top' : null)}
          onActiveView={() => setActiveView('top')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}

                {(!editingLathePanel || editingLathePanel === 'side') && (
        <ViewerPanel
          viewName="side"
          label="Costado"
          editingState={editingLathePanel === 'side'}
          onSetEditing={(v: boolean) => setEditingLathePanel(v ? 'side' : null)}
          onActiveView={() => setActiveView('side')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}

                {(!editingLathePanel || editingLathePanel === '3d') && (
        <ViewerPanel
          viewName="3d"
          label={isRecordingCameraPath ? '3D Libre ●' : '3D Libre'}
          editingState={editingLathePanel === '3d'}
          onSetEditing={(v: boolean) => setEditingLathePanel(v ? '3d' : null)}
          onActiveView={() => setActiveView('3d')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}
              </>
            ) : mode === 'mesh' && editingMeshProfile ? (
              /* Un solo panel maximizado */
              editingMeshProfile === 'silhouette' ? (
                <div className="w-full h-full min-h-0">
                  <EditorCanvasComponent
                    label="Silueta"
                    axisLabel="X·Y"
                    polygon={
                      meshSilhouette && meshSilhouette.length > 0
                        ? meshSilhouette
                        : DEFAULT_MESH_SILHOUETTE
                    }
                    onChange={(poly: Polygon) => {
                      setMeshSilhouette(poly);
                      setEditedVertices(null);
                    }}
                    resolution={editorGridResolution}
                    onClose={() => setEditingMeshProfile(null)}
                    enableScale={false}
                    gridResolution={editorGridResolution}
                    onGridResolutionChange={setEditorGridResolution}
                    canvasZoom={editorCanvasZoom}
                    onCanvasZoomChange={setEditorCanvasZoom}
                    guideLines={meshSections.map((s) => s.y)}
                    polylines={getPolylines('mesh:silhouette')}
                    onPolylinesChange={(lines: Polyline[]) =>
                      updatePolylines('mesh:silhouette', lines)
                    }
                    templateImage={templateImage}
                    templateOpacity={templateOpacity}
                    templateScale={templateScale}
                  />
                </div>
              ) : editingMeshProfile === 'side' ? (
                <div className="w-full h-full min-h-0">
                  <EditorCanvasComponent
                    label="Costado"
                    axisLabel="Z·Y"
                    polygon={meshSideView}
                    onChange={(poly: Polygon) => {
                      setMeshSideView(poly);
                      setEditedVertices(null);
                    }}
                    resolution={editorGridResolution}
                    onClose={() => setEditingMeshProfile(null)}
                    enableScale={false}
                    gridResolution={editorGridResolution}
                    onGridResolutionChange={setEditorGridResolution}
                    canvasZoom={editorCanvasZoom}
                    onCanvasZoomChange={setEditorCanvasZoom}
                    guideLines={meshSections.map((s) => s.y)}
                    polylines={getPolylines('mesh:side')}
                    onPolylinesChange={(lines: Polyline[]) =>
                      updatePolylines('mesh:side', lines)
                    }
                    templateImage={templateImage}
                    templateOpacity={templateOpacity}
                    templateScale={templateScale}
                  />
                </div>
              ) : (
                /* Es una plantilla: buscamos por id */
                (() => {
                  const section = meshSections.find(
                    (s) => s.id.toString() === editingMeshProfile
                  );
                  if (!section) return null;
                  return (
                    <div className="w-full h-full min-h-0 flex flex-col">
                      <div className="shrink-0 px-4 pt-3 flex items-center justify-center">
                        <SectionTools
                          polygon={section.polygon}
                          sectionY={section.y}
                          onMoveY={(delta) =>
                            moveMeshSectionY(section.id, delta)
                          }
                          onChange={(poly) => {
                            updateMeshSectionPolygon(section.id, poly);
                            setEditedVertices(null);
                          }}
                        />
                      </div>
                      <EditorCanvasComponent
                        label={`Plantilla ${meshSections.indexOf(section) + 1}`}
                        axisLabel="X·Z"
                        polygon={section.polygon}
                        onChange={(poly: Polygon) => {
                          updateMeshSectionPolygon(section.id, poly);
                          setEditedVertices(null);
                        }}
                        resolution={editorGridResolution}
                        onClose={() => setEditingMeshProfile(null)}
                        enableScale={false}
                        gridResolution={editorGridResolution}
                        onGridResolutionChange={setEditorGridResolution}
                        canvasZoom={editorCanvasZoom}
                        onCanvasZoomChange={setEditorCanvasZoom}
                        polylines={getPolylines(`mesh:section:${section.id}`)}
                        onPolylinesChange={(lines: Polyline[]) =>
                          updatePolylines(`mesh:section:${section.id}`, lines)
                        }
                        templateImage={templateImage}
                        templateOpacity={templateOpacity}
                        templateScale={templateScale}
                      />
                    </div>
                  );
                })()
              )
            ) : mode === 'mesh' && editingMesh ? (
              <div className="flex gap-2 w-full h-full min-h-0">
                {/* Mitad izquierda: la silueta */}
                <div className="flex-1 min-w-0 min-h-0 h-full flex flex-col">
                  <EditorCanvasComponent
                    label="Silueta"
                    compact
                    axisLabel="X·Y"
                    polygon={
                      meshSilhouette && meshSilhouette.length > 0
                        ? meshSilhouette
                        : DEFAULT_MESH_SILHOUETTE
                    }
                    onChange={(poly: Polygon) => {
                      setMeshSilhouette(poly);
                      setEditedVertices(null);
                    }}
                    resolution={editorGridResolution}
                    onClose={() => setEditingMesh(false)}
                    enableScale={false}
                    gridResolution={editorGridResolution}
                    onGridResolutionChange={setEditorGridResolution}
                    canvasZoom={editorCanvasZoom}
                    onCanvasZoomChange={setEditorCanvasZoom}
                    guideLines={meshSections.map((s) => s.y)}
                    polylines={getPolylines('mesh:silhouette')}
                    onPolylinesChange={(lines: Polyline[]) =>
                      updatePolylines('mesh:silhouette', lines)
                    }
                    templateImage={templateImage}
                    templateOpacity={templateOpacity}
                    templateScale={templateScale}
                  />
                </div>
                {/* Mitad izquierda 2: el costado */}
                <div className="flex-1 min-w-0 min-h-0 h-full flex flex-col">
                  <EditorCanvasComponent
                    label="Costado"
                    compact
                    axisLabel="Z·Y"
                    polygon={meshSideView}
                    onChange={(poly: Polygon) => {
                      setMeshSideView(poly);
                      setEditedVertices(null);
                    }}
                    resolution={editorGridResolution}
                    onClose={() => setEditingMesh(false)}
                    enableScale={false}
                    gridResolution={editorGridResolution}
                    onGridResolutionChange={setEditorGridResolution}
                    canvasZoom={editorCanvasZoom}
                    onCanvasZoomChange={setEditorCanvasZoom}
                    guideLines={meshSections.map((s) => s.y)}
                    polylines={getPolylines('mesh:side')}
                    onPolylinesChange={(lines: Polyline[]) =>
                      updatePolylines('mesh:side', lines)
                    }
                    templateImage={templateImage}
                    templateOpacity={templateOpacity}
                    templateScale={templateScale}
                  />
                </div>

                {/* Mitad derecha: las plantillas apiladas */}
                <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2 overflow-y-auto p-3 bg-black/20 rounded-lg border border-white/10 custom-scrollbar">
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      Plantillas horizontales 2D ({meshSections.length})
                    </h3>
                    <button
                      onClick={addMeshSection}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 text-xs font-medium border border-green-500/30 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Añadir plantilla
                    </button>
                  </div>
                  {meshSections.length === 0 ? (
                    <div className="p-6 text-center rounded-lg bg-black/30 border border-dashed border-white/10 text-muted-foreground/60 text-xs space-y-2">
                      <p>No hay plantillas creadas.</p>
                      <button
                        onClick={addMeshSection}
                        className="px-3 py-1.5 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 text-xs font-medium border border-green-500/30 transition-colors"
                      >
                        Crear primera plantilla 2D
                      </button>
                    </div>
                  ) : (
                    meshSections.map((section, index) => (
                      <div
                        key={section.id}
                        className="rounded-lg border border-white/10 bg-black/30 p-2.5 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-foreground">
                              Plantilla {index + 1}
                            </span>
                            <span className="text-[10px] font-mono text-green-300 bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/20">
                              Y = {section.y.toFixed(2)} ·{' '}
                              {section.polygon.length} vértices
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <span>Altura Y:</span>
                              <input
                                type="number"
                                min={0}
                                max={1}
                                step={0.05}
                                value={section.y}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setMeshSections((prev) =>
                                    prev.map((s) =>
                                      s.id === section.id
                                        ? {
                                            ...s,
                                            y: val,
                                            // Al mover la altura, la plantilla se
                                            // reajusta al ancho de la silueta y del
                                            // costado que le toca en la nueva y.
                                            polygon: fitSectionToViews(
                                              s.polygon,
                                              val,
                                              appliedMeshSilhouette,
                                              appliedMeshSideView
                                            ),
                                          }
                                        : s
                                    )
                                  );
                                }}
                                className="w-14 px-1.5 py-0.5 rounded bg-black/60 border border-white/10 text-[10px] text-foreground font-mono"
                              />
                              <button
                                type="button"
                                className="flex items-center justify-center w-5 h-5 rounded bg-white/5 border border-white/10 text-foreground hover:bg-white/15 transition-colors disabled:opacity-30 disabled:hover:bg-white/5"
                                title="Subir la plantilla (altura Y)"
                                disabled={section.y <= 0}
                                onClick={() =>
                                  moveMeshSectionY(section.id, -0.05)
                                }
                              >
                                <ChevronUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                className="flex items-center justify-center w-5 h-5 rounded bg-white/5 border border-white/10 text-foreground hover:bg-white/15 transition-colors disabled:opacity-30 disabled:hover:bg-white/5"
                                title="Bajar la plantilla (altura Y)"
                                disabled={section.y >= 1}
                                onClick={() =>
                                  moveMeshSectionY(section.id, 0.05)
                                }
                              >
                                <ChevronDown className="w-3 h-3" />
                              </button>
                            </label>
                            {meshSections.length > 1 && (
                              <button
                                onClick={() => removeMeshSection(section.id)}
                                className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Eliminar plantilla"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <SectionTools
                          polygon={section.polygon}
                          onChange={(poly) =>
                            updateMeshSectionPolygon(section.id, poly)
                          }
                        />
                        {(() => {
                          // Calcular altura generosa basada en el número de vértices y el rango del polígono
                          const minY = Math.min(
                            ...section.polygon.map((p) => p.y)
                          );
                          const maxY = Math.max(
                            ...section.polygon.map((p) => p.y)
                          );
                          const polygonHeight = maxY - minY;
                          const vertexCount = section.polygon.length;

                          // Altura base más generosa: 280px mínimo, hasta 450px máximo
                          // Aumentamos según la altura del polígono y el número de vértices
                          const baseHeight = 280;
                          const heightMultiplier =
                            1 + polygonHeight * 2 + (vertexCount > 4 ? 0.2 : 0);
                          const containerHeight = Math.min(
                            450,
                            Math.max(280, baseHeight * heightMultiplier)
                          );

                          return (
                            <div style={{ height: `${containerHeight}px` }}>
                              <DrawingCanvas
                                label={`Plantilla ${index + 1}`}
                                axisLabel="X·Z"
                                polygon={section.polygon}
                                onChange={(poly) => {
                                  updateMeshSectionPolygon(section.id, poly);
                                }}
                                onMaximize={() =>
                                  setEditingMeshProfile(section.id.toString())
                                }
                                resolution={resolution}
                                showHeader={true}
                                polylines={getPolylines(
                                  `mesh:section:${section.id}`
                                )}
                              />
                            </div>
                          );
                        })()}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : mode === 'mesh' ? (
              <>
                {(!editingMeshPanel || editingMeshPanel === 'front') && (
        <ViewerPanel
          viewName="front"
          label="Frente · X·Y"
          editingState={editingMeshPanel === 'front'}
          onSetEditing={(v: boolean) => setEditingMeshPanel(v ? 'front' : null)}
          onActiveView={() => setActiveView('front')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}

                {(!editingMeshPanel || editingMeshPanel === 'top') && (
        <ViewerPanel
          viewName="top"
          label="Superior · X·Z"
          editingState={editingMeshPanel === 'top'}
          onSetEditing={(v: boolean) => setEditingMeshPanel(v ? 'top' : null)}
          onActiveView={() => setActiveView('top')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}

                {(!editingMeshPanel || editingMeshPanel === 'side') && (
        <ViewerPanel
          viewName="side"
          label="Costado · Z·Y"
          editingState={editingMeshPanel === 'side'}
          onSetEditing={(v: boolean) => setEditingMeshPanel(v ? 'side' : null)}
          onActiveView={() => setActiveView('side')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}

                {(!editingMeshPanel || editingMeshPanel === '3d') && (
        <ViewerPanel
          viewName="3d"
          label={isRecordingCameraPath ? '3D Libre ●' : '3D Libre'}
          editingState={editingMeshPanel === '3d'}
          onSetEditing={(v: boolean) => setEditingMeshPanel(v ? '3d' : null)}
          onActiveView={() => setActiveView('3d')}
          activeView={activeView}
          viewerMesh={viewerMesh}
          visibleSceneObjects={visibleSceneObjects}
          configObjectId={configObjectId}
          triMesh={triMesh}
          smoothShadingValue={smoothShadingValue}
          textureProjection={textureProjection}
          selectedObjectId={selectedObjectId}
          sceneObjects={sceneObjects}
          handleObjectSelect={handleObjectSelect}
             onMultiObjectTransform={handleMultiObjectTransform}
              objectName={sceneObjects.find((o) => o.id === selectedObjectId)?.name}
              onObjectNameChange={(name) => handleObjectNameChange(selectedObjectId!, name)}
          selectedObjectIds={selectedObjectIds}
          onSelectionChange={setSelectedObjectIds}
          selectionMode={selectionMode}
          onSelectionModeChange={setSelectionMode}
          faceSelectMode={faceSelectMode}
          faceSelectionTool={faceSelectionTool}
          selectedFaceIds={selectedFaceIds}
          onFaceSelectionChange={setSelectedFaceIds}
          onFaceSelectionModeChange={setFaceSelectMode}
          onFaceSelectionToolChange={setFaceSelectionTool}
          showGizmo={showGizmo}
          handleObjectTransform={handleObjectTransform}
          handleVerticesChange={handleVerticesChange}
          showLatheAxis={mode === 'lathe' as never}

          viewerProjection={viewerProjection}
          textureRepeat={textureRepeat}
          textureHelper={textureHelper}
          textureHelperTransform={textureHelperTransform}
          setTextureHelperTransform={setTextureHelperTransform}
          lightConfig={lightConfig}
          showLightHelpers={showLightHelpers}
          showGround={showGround}
           groundTexture={groundTexture}
             groundTextureFinish={groundTextureFinish}
             groundTextureRepeat={groundTextureRepeat}
             objectTextureFinish={objectTextureFinish}
          skyboxImage={skyboxImage}
          booleanToolObjectId={booleanPreview ? booleanToolObjectId : undefined}
          forceUpdate={booleanPreviewLive ? booleanPreviewTick + viewRefreshTick : viewRefreshTick || undefined}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          fxConfig={fxConfig}
          setFxConfig={setFxConfig}
          setLightConfig={setLightConfig}
          panelCameras={panelCameras}
           handleCameraChange={handleCameraChange}
            onCameraMove={isRecordingCameraPath ? handleCameraMoveForRecording : undefined}
             showCameraPathGizmo={showGround || isRecordingCameraPath}
             onCameraGizmoMove={handleCameraGizmoMove}
             showCameraPath={showCameraPath}
             exportMp4Trigger={exportMp4Trigger}
             onExportProgress={setExportProgress}
             onExportComplete={setExportResult}
            cameraViewMode={cameraViewMode}
           animationTracks={animationTracks}
            animationTime={playing ? currentTime : 0.1}
           onAnimationComplete={() => {}}
           viewerSmooth={viewerSmooth}
          pan3D={pan3D}
          zoom3D={zoom3D}
          orbit3D={orbit3D}
        />
      )}
              </>
            ) : null}
          </div>

          {/* Botones flotantes de preview boolean: aparecen sobre los viewports */}
          {booleanPreviewLive && pendingBooleanOp && (
            <div className="absolute top-4 right-4 z-50 flex items-center gap-2 bg-gray-900/90 rounded-lg border border-amber-500/30 px-3 py-2 shadow-lg">
              <span className="text-xs text-amber-300">Corte en preview — mueve el cortador para ajustar</span>
              <button
                onClick={async () => {
                  if (pendingBooleanOp) {
                    await handleApplyBoolean({
                      baseObjectId: pendingBooleanOp.baseObjectId,
                      toolObjectId: pendingBooleanOp.toolObjectId,
                      operation: pendingBooleanOp.operation,
                      deleteToolObject: pendingBooleanOp.deleteToolObject,
                    });
                  }
                  setBooleanPreviewLive(false);
                  setPendingBooleanOp(null);
                  setBooleanPreview(false);
                  setBooleanToolObjectId(null);
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black"
              >
                <Scissors className="w-3.5 h-3.5" />
                Confirmar corte
              </button>
              <button
                onClick={() => {
                  setBooleanPreviewLive(false);
                  setPendingBooleanOp(null);
                  setBooleanPreview(false);
                  setBooleanToolObjectId(null);
                }}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/5 border border-white/10"
              >
                Cancelar preview
              </button>
            </div>
          )}

          {/* Herramientas de la columna derecha: importar PNG y plantilla */}
          {(mode === 'views' ||
            mode === 'mesh' ||
            mode === 'lathe' ||
            mode === 'extrude') && (
            <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-t border-white/5 bg-[hsl(224_50%_6%)]">
              <input
                ref={pngImportInputRef}
                type="file"
                accept="image/png,image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handlePngImport(file);
                  e.target.value = '';
                }}
                className="hidden"
              />
              <button
                onClick={() => pngImportInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-green-500/15 hover:bg-green-500/25 text-green-200 border border-green-500/30 transition-colors"
                title="Importar contorno desde PNG al lienzo activo"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Importar PNG
              </button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Detalle:</span>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[importDetailLevel]}
                  onValueChange={([v]) => setImportDetailLevel(v)}
                  className="w-28"
                />
                <span className="font-mono text-xs text-green-400 w-8">
                  {importDetailLevel}%
                </span>
              </div>
              <span className="text-xs text-muted-foreground/60">
                {importDetailLevel < 30
                  ? 'Pocos vértices'
                  : importDetailLevel > 80
                    ? 'Muchos vértices'
                    : 'Calidad media'}
              </span>

              {/* Plantilla de referencia */}
              <div className="w-px h-5 bg-white/10"></div>
              <input
                ref={templateInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      setTemplateImage(ev.target?.result as string);
                    };
                    reader.readAsDataURL(file);
                  }
                  e.target.value = '';
                }}
                className="hidden"
              />
              <button
                onClick={() => templateInputRef.current?.click()}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-white/5 hover:bg-white/10 text-foreground border border-white/10 transition-colors"
                title="Cargar imagen de referencia/plantilla"
              >
                <ImageIcon className="w-3 h-3" />
                {templateImage ? 'Cambiar' : 'Plantilla'}
              </button>
              {templateImage && (
                <>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Opac:</span>
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      value={[Math.round(templateOpacity * 100)]}
                      onValueChange={([v]) => setTemplateOpacity(v / 100)}
                      className="w-14"
                    />
                    <span className="font-mono text-xs text-green-400 w-7">
                      {Math.round(templateOpacity * 100)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Tama:</span>
                    <Slider
                      min={10}
                      max={300}
                      step={1}
                      value={[Math.round(templateScale * 100)]}
                      onValueChange={([v]) => setTemplateScale(v / 100)}
                      className="w-14"
                    />
                    <span className="font-mono text-xs text-green-400 w-7">
                      {Math.round(templateScale * 100)}%
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setTemplateImage(null);
                      setTemplateOpacity(0.5);
                      setTemplateScale(1);
                    }}
                    className="px-2 py-1 rounded-md text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 transition-colors"
                    title="Quitar plantilla"
                  >
                    Quitar
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </main>

      {!canBuild && mode !== 'views' && mode !== 'extrude' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-lg bg-red-950/80 border border-red-800/50 text-red-200 text-xs backdrop-blur-sm shadow-lg z-50">
          <AlertCircle className="w-3.5 h-3.5" />
          {mode === 'text'
            ? 'Escribe un texto para generarlo en 3D'
            : mode === 'lathe'
              ? 'Dibuja al menos 3 puntos en el perfil del torno'
              : 'Agrega plantillas y dibuja una silueta para generar la malla'}
        </div>
      )}

      <Modal
        isOpen={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title="Guardar objeto 3D"
        description="Se guarda en la carpeta de Objetos 3D (Archivos → Configurar Carpetas Multimedia)."
        size="md"
      >
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
              <Box className="w-4 h-4 text-green-400" />
              Nombre del objeto
            </label>
            <input
              type="text"
              value={objectName}
              onChange={(e) => setObjectName(e.target.value)}
              placeholder={
                mode === 'text'
                  ? 'texto-3d'
                  : mode === 'mesh'
                    ? 'malla-3d'
                    : mode === 'extrude'
                      ? 'extrusion-3d'
                      : 'figura-3d'
              }
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
            />
            <p className="text-[11px] text-muted-foreground">
              {mode === 'text'
                ? 'Guarda el texto 3D con su fuente, profundidad, color y modo (vóxeles, suave o vista plana).'
                : mode === 'mesh'
                  ? 'Guarda la malla 3D con sus plantillas y silueta.'
                  : mode === 'extrude'
                    ? 'Guarda la figura extruida con su perfil frontal, profundidad y estilo de malla.'
                    : 'Guarda la figura con sus tres vistas dibujadas, resolución y estilo de malla.'}
            </p>
          </div>

          {saveMsg && (
            <div
              className={`rounded-lg px-4 py-2 text-sm border ${
                saveMsg.ok
                  ? 'bg-green-500/20 border-green-500/50 text-green-300'
                  : 'bg-red-500/20 border-red-500/50 text-red-300'
              }`}
            >
              {saveMsg.text}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              onClick={() => setSaveModalOpen(false)}
              className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 text-sm font-bold transition-colors"
            >
              Cerrar
            </button>
            <button
              onClick={saveObject}
              disabled={savingObject}
              className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg text-white text-sm font-bold transition-all flex items-center gap-2"
            >
              {savingObject ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Guardar
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={obj3dModalOpen}
        onClose={() => setObj3dModalOpen(false)}
        title="Objeto 3D"
        description="Los de tu carpeta de Objetos 3D se cargan en el editor; los de public/Obj-3D se crean en la escena actual."
        size="md"
        bodyClassName="modal-scrollbar"
      >
        <div className="space-y-3 py-4">
          {obj3dMsg && (
            <div
              className={`rounded-lg px-4 py-2 text-sm border ${
                obj3dMsg.ok
                  ? 'bg-green-500/20 border-green-500/50 text-green-300'
                  : 'bg-red-500/20 border-red-500/50 text-red-300'
              }`}
            >
              {obj3dMsg.text}
            </div>
          )}

          {!isElectron() && (
            <div className="space-y-2">
              <button
                onClick={() => obj3dFileInputRef.current?.click()}
                disabled={obj3dCreating}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-white/5 hover:bg-white/10 text-foreground border border-white/10 transition-colors disabled:opacity-50"
              >
                <FolderOpen className="w-4 h-4" />
                Seleccionar archivo .zeus
              </button>
              <input
                ref={obj3dFileInputRef}
                type="file"
                accept=".zeus,application/json,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleObj3dFileSelect(file);
                  e.target.value = '';
                }}
              />
            </div>
          )}

          {obj3dLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Leyendo las carpetas…
            </div>
          ) : obj3dFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No hay objetos guardados todavía (.zeus)
            </p>
          ) : (
            <>
              {/* Vista previa 3D: al pasar el ratón por un objeto se ve
                  su figura girando, como en el explorador de texturas */}
              <div className="flex flex-col items-center gap-1 mb-3">
                <div className="w-40">
                  <Object3DPreview mesh={obj3dPreview?.mesh ?? null} />
                </div>
                <p className="text-[10px] text-muted-foreground/70 text-center">
                  {obj3dPreview ? (
                    <span className="text-green-400/80 font-mono">
                      {obj3dPreview.name}
                    </span>
                  ) : (
                    'Pasa el ratón por un objeto para verlo girando'
                  )}
                </p>
              </div>

              {/* Miniaturas: la figura de cada archivo dibujada en 3D,
                  como las miniaturas de texturas. La carpeta local solo
                  existe en la app de escritorio. */}
              <div className="max-h-72 overflow-y-auto pr-1 modal-scrollbar space-y-3">
                {obj3dFiles.some((f) => f.source === 'local') && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <h4 className="text-xs font-bold text-foreground">
                        Tu carpeta de Objetos 3D
                      </h4>
                      <span className="text-[10px] text-muted-foreground/70">
                        al pinchar se carga en el editor
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {obj3dFiles
                        .filter((f) => f.source === 'local')
                        .map((f) => (
                          <button
                            key={`local-${f.name}`}
                            onClick={() => loadObject(f)}
                            onMouseEnter={() => loadObj3dPreview(f)}
                            disabled={obj3dCreating}
                            className="group relative aspect-square rounded-md overflow-hidden border border-white/10 bg-black/20 hover:border-green-500/50 transition-all disabled:opacity-50"
                            title={`Cargar "${f.name.replace(/\.zeus$/i, '')}" en el editor`}
                          >
                            <Object3DThumbnail mesh={f.mesh} />
                            {obj3dCreating && (
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                <Loader2 className="w-5 h-5 animate-spin text-green-400" />
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 p-1 bg-gradient-to-t from-black/80 to-transparent">
                              <span className="text-[9px] text-white truncate block">
                                {f.name.replace(/\.zeus$/i, '')}
                              </span>
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {obj3dFiles.some((f) => f.source === 'public') && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <h4 className="text-xs font-bold text-foreground">
                        public/Obj-3D
                      </h4>
                      <span className="text-[10px] text-muted-foreground/70">
                        al pinchar se crea en la escena
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {obj3dFiles
                        .filter((f) => f.source === 'public')
                        .map((f) => (
                          <button
                            key={`public-${f.name}`}
                            onClick={() => createObj3dFromFile(f)}
                            onMouseEnter={() => loadObj3dPreview(f)}
                            disabled={obj3dCreating}
                            className="group relative aspect-square rounded-md overflow-hidden border border-white/10 bg-black/20 hover:border-green-500/50 transition-all disabled:opacity-50"
                            title={`Crear "${f.name.replace(/\.zeus$/i, '')}" en la escena`}
                          >
                            <Object3DThumbnail mesh={f.mesh} />
                            {obj3dCreating && (
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                <Loader2 className="w-5 h-5 animate-spin text-green-400" />
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 p-1 bg-gradient-to-t from-black/80 to-transparent">
                              <span className="text-[9px] text-white truncate block">
                                {f.name.replace(/\.zeus$/i, '')}
                              </span>
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end">
            <button
              onClick={() => setObj3dModalOpen(false)}
              className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 text-sm font-bold transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      </Modal>
      <TextureBrowserModal
        isOpen={textureBrowserOpen}
        onClose={() => setTextureBrowserOpen(false)}
        onSelectTexture={handleTextureSelect}
        mode={mode}
      />
       <LightingModal
         isOpen={isLightingModalOpen}
         onClose={() => setIsLightingModalOpen(false)}
         lightConfig={lightConfig}
         onSave={setLightConfig}
       />
      <input
        ref={textureInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleTextureFile(file);
          e.target.value = '';
        }}
      />
      {objectToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setObjectToDelete(null)}
        >
          <div
            className="bg-[hsl(224_50%_10%)] border border-red-500/30 rounded-xl p-6 max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-red-500/15 flex items-center justify-center border border-red-500/30">
                <Trash2 className="w-4 h-4 text-red-400" />
              </div>
              <h3 className="text-base font-bold text-foreground">
                Eliminar objeto
              </h3>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              ¿Seguro que quieres eliminar{' '}
              <strong className="text-foreground">
                Objeto{' '}
                {sceneObjects.findIndex((o) => o.id === objectToDelete) + 1}
              </strong>
              ? Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setObjectToDelete(null)}
                className="px-4 py-2 rounded-md text-sm font-medium bg-white/5 hover:bg-white/10 text-muted-foreground border border-white/10 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteObject}
                className="px-4 py-2 rounded-md text-sm font-bold bg-red-500 hover:bg-red-600 text-white transition-colors"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
        <BooleanCSGModal
          isOpen={booleanModalOpen}
          onClose={() => { setBooleanModalOpen(false); setBooleanPreview(false); setBooleanToolObjectId(null); }}
          sceneObjects={visibleSceneObjects}
          selectedObjectId={selectedObjectId}
          onApply={handleApplyBoolean}
          previewMode={booleanPreview}
          setPreviewMode={setBooleanPreview}
          onToolChange={setBooleanToolObjectId}
   onEnterPreview={(params) => {
   setPendingBooleanOp(params);
   setBooleanPreviewLive(true);
   setBooleanPreview(true);
   setBooleanToolObjectId(params.toolObjectId);
   setBooleanPreviewTick(Date.now());
   setBooleanModalOpen(false);
   }}
 />
       <TextureBrowserModal
        isOpen={showTextureModal}
        onClose={() => {
          setShowTextureModal(false);
          setTextureSelectTarget(null);
        }}
         onSelectTexture={(dataUrl, fileName) => {
           if (textureSelectTarget === 'ground') {
             setGroundTexture(dataUrl);
             setGroundTextureFileName(fileName);
           } else if (textureSelectTarget === 'object') {
             setSelectedObjectTexture(dataUrl);
             setSelectedObjectTextureFileName(fileName);
           } else {
             setSkyboxImage(dataUrl);
             setSkyboxImageFileName(fileName);
           }
         }}
        mode={mode}
      />
    </div>
  );
}
export function PanelButtons({
  onPan,
  onZoom,
  onEdit,
  onRotateLeft,
  onRotateRight,
  showRotate = false,
  isEditing = false,
  viewName,
}: {
  onPan: (dx: number, dy: number) => void;
  onZoom: (factor: number) => void;
  onEdit?: () => void;
  onRotateLeft?: () => void;
  onRotateRight?: () => void;
  showRotate?: boolean;
  isEditing?: boolean;
  viewName?: 'front' | 'top' | 'side' | '3d';
}) {
  const btn =
    'w-5 h-5 flex items-center justify-center text-[10px] rounded bg-white/5 hover:bg-white/15 border border-white/10 text-white transition-colors';
  const editBtn = isEditing
    ? 'w-5 h-5 flex items-center justify-center text-[10px] rounded bg-green-500/25 hover:bg-green-500/35 border border-green-500/50 text-green-300 transition-colors'
    : 'w-5 h-5 flex items-center justify-center text-[10px] rounded bg-white/5 hover:bg-white/15 border border-white/10 text-white transition-colors';
  const stop = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation();
    fn();
  };

  // Etiquetas de movimiento según la vista
  const isTop = viewName === 'top';
  const isFront = viewName === 'front';
  const isSide = viewName === 'side';
  const isTopOrFront = isTop || isFront;

  const upTitle = isTop ? 'Arriba' : isTopOrFront ? 'Arriba' : isSide ? 'Arriba' : 'Arriba';
  const downTitle = isTop ? 'Abajo' : isTopOrFront ? 'Abajo' : isSide ? 'Abajo' : 'Abajo';
  const leftTitle = isTop ? 'Izquierda' : isSide ? 'Izquierda' : 'Izquierda';
  const rightTitle = isTop ? 'Derecha' : isSide ? 'Derecha' : 'Derecha';

  // onPan deltas for each button (dx, dy)
  // Top view: ▶=Derecha(+X), ◀=Izquierda(-X), ▲=Arriba(-Z), ▼=Abajo(+Z)
  // Front/Side: ▲/▼=Y (adelante/atrás), ◀/▶=X (izq/der)
  const upPan = () => onPan(0, -5); // ▲ igual en todas las vistas
  const downPan = () => onPan(0, 5); // ▼ igual en todas las vistas
  const leftPan = isTop ? () => onPan(-5, 0) : () => onPan(5, 0);
  const rightPan = isTop ? () => onPan(5, 0) : () => onPan(-5, 0);

  return (
    <div className="flex items-center gap-0.5">
      <button
        className={btn}
        onClick={(e) => stop(e, () => onPan(0, -5))}
        title={upTitle}
      >
        ▲
      </button>
      <button
        className={btn}
        onClick={(e) => stop(e, () => onPan(0, 5))}
        title={downTitle}
      >
        ▼
      </button>
      <button
        className={btn}
        onClick={(e) => stop(e, () => onPan(-5, 0))}
        title={leftTitle}
      >
        ◀
      </button>
      <button
        className={btn}
        onClick={(e) => stop(e, () => onPan(5, 0))}
        title={rightTitle}
      >
        ▶
      </button>
      <button
        className={btn}
        onClick={(e) => stop(e, () => onZoom(1.15))}
        title="Acercar"
      >
        ＋
      </button>
      <button
        className={btn}
        onClick={(e) => stop(e, () => onZoom(1 / 1.15))}
        title="Alejar"
      >
        −
      </button>
      {showRotate && (
        <>
          <button
            className={btn}
            onClick={(e) => stop(e, () => onRotateLeft?.())}
            title="Rotar izq"
          >
            ↺
          </button>
          <button
            className={btn}
            onClick={(e) => stop(e, () => onRotateRight?.())}
            title="Rotar der"
          >
            ↻
          </button>
        </>
      )}
      {onEdit && (
        <button
          className={editBtn}
          onClick={(e) => stop(e, () => onEdit())}
          title={isEditing ? 'Cerrar vista expandida' : 'Editar en grande'}
        >
          ◻️
        </button>
      )}
    </div>
  );
}
