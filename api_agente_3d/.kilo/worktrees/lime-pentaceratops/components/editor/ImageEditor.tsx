'use client';

import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, Key, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ImageEditState, BezierAnchor } from '@/types';

// Construye el `d` de un <path> SVG a partir de anclas Bézier (coords en píxeles).
// El segmento A→B usa el mango de salida de A (hOut) y el de entrada de B (hIn).
// Si `close`, une la última ancla con la primera y cierra el subpath.
function bezierPathD(anchors: BezierAnchor[], close: boolean): string {
  if (anchors.length === 0) return '';
  const n = anchors.length;
  let d = `M ${anchors[0].x} ${anchors[0].y}`;
  const segCount = close ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % n];
    d += ` C ${a.hOutX} ${a.hOutY}, ${b.hInX} ${b.hInY}, ${b.x} ${b.y}`;
  }
  if (close) d += ' Z';
  return d;
}

// Igual que bezierPathD pero desplazando cada coordenada (dx,dy). Útil para
// `clip-path: path()`, cuyas coords son locales al border-box del <img> (hay
// que restar `canvasMargin` a las coords del espacio del contenedor).
function bezierPathDShifted(anchors: BezierAnchor[], close: boolean, dx: number, dy: number): string {
  if (anchors.length === 0) return '';
  const n = anchors.length;
  const X = (v: number) => v + dx;
  const Y = (v: number) => v + dy;
  let d = `M ${X(anchors[0].x)} ${Y(anchors[0].y)}`;
  const segCount = close ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % n];
    d += ` C ${X(a.hOutX)} ${Y(a.hOutY)}, ${X(b.hInX)} ${Y(b.hInY)}, ${X(b.x)} ${Y(b.y)}`;
  }
  if (close) d += ' Z';
  return d;
}

// Traza un trazado Bézier CERRADO en un ctx (moveTo + bezierCurveTo por segmento
// A→B usando a.hOut y b.hIn, cierra con closePath). ox/oy = desplazamiento (p.ej.
// -tx/-ty al recortar a un sub-canvas). Para anclas degeneradas queda poligonal.
function traceBezierClosed(ctx: CanvasRenderingContext2D, anchors: BezierAnchor[], ox = 0, oy = 0): void {
  const n = anchors.length;
  if (n === 0) return;
  ctx.moveTo(anchors[0].x + ox, anchors[0].y + oy);
  for (let i = 0; i < n; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % n];
    ctx.bezierCurveTo(a.hOutX + ox, a.hOutY + oy, b.hInX + ox, b.hInY + oy, b.x + ox, b.y + oy);
  }
  ctx.closePath();
}
import {
  Sun,
  Contrast,
  Droplets,
  Palette,
  Sparkles as BlurIcon,
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Save,
  X,
  Undo,
  Redo,
  Download,
  Maximize,
  Minimize,
  Eye,
  Settings,
  Image as ImageIcon,
  Check,
  Loader2,
  Trash2,
  Calendar,
  Clock,
  FolderOpen,
  Plus,
  HardDrive,
  Crop,
  MousePointer2,
  Scissors,
  Copy,
  Clipboard,
  Sparkles,
  Wand2,
  Paintbrush,
  Pipette,
  PaintBucket,
  ChevronLeft,
  Folder,
  FileImage,
  Square,
  Circle,
  Minus,
  Shapes,
  Zap,
  Search,
  ZoomIn,
  ZoomOut,
  Hand,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import pb from '@/lib/pocketbase';
import { Modal } from '@/components/ui/modal';
import FileUploader from '@/components/ui/file-uploader';
import { cn, cleanDisplayFileName } from '@/lib/utils';
import { EditorFileNameBar } from '@/components/ui/EditorFileNameBar';
import { useAIEditorBridgeOptional } from '@/components/AIEditorBridgeContext';
import { useI18n } from '@/lib/i18n';

import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import {
  getLocalPaths, getMediaUrl, listDirectory, readProject, saveProject, writeFile, readFile, ensureDir, getFilePath, copyFile,
  startComfyUI, startFluxBridge, stopComfyUI, stopFluxBridge, getServerStatus, isElectron
} from '@/lib/electron-fs';

// Tipos extendidos
type ExtendedImageEditState = {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  blur: number;
  sepia: number;
  grayscale: number;
  invert: number;
  opacity: number;
  intensity: number; // 0-100: fuerza global del filtro (mezcla con el original)
};

type RotationStartData = {
  centerX: number;
  centerY: number;
  startAngle: number;
  initialRotation: number;
};

type OverlayLayer = {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  rotation?: number;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const normalizeRect = (rect: Rect): Rect => {
  const normalizedWidth = Math.abs(rect.width);
  const normalizedHeight = Math.abs(rect.height);
  return {
    x: rect.width >= 0 ? rect.x : rect.x + rect.width,
    y: rect.height >= 0 ? rect.y : rect.y + rect.height,
    width: normalizedWidth,
    height: normalizedHeight,
  };
};

// Estilo CSS para recortar un <img> a la selección activa. Las coords de la
// selección (rect/cropRect, freePoints) están en el espacio del contenedor (px),
// donde el <img> base está desplazado `canvasMargin`. clip-path/mask actúan en el
// border-box del <img>, así que se resta canvasMargin. Devuelve null si no hay
// selección terminada (los ajustes van a toda la imagen).
type AdjustSelection = { kind: 'none' | 'rect' | 'circle' | 'freehand' | 'mask'; rect?: Rect; anchors?: BezierAnchor[]; mask?: string };
function selectionClipStyle(sel: AdjustSelection, canvasMargin: number, dims: { width: number; height: number }): React.CSSProperties | null {
  if (!sel || sel.kind === 'none') return null;
  const cm = canvasMargin;
  if (sel.kind === 'rect' && sel.rect) {
    const r = normalizeRect(sel.rect);
    const imgRight = cm + dims.width;
    const imgBottom = cm + dims.height;
    const top = r.y - cm;
    const left = r.x - cm;
    const right = imgRight - (r.x + r.width);
    const bottom = imgBottom - (r.y + r.height);
    return { clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px)` };
  }
  if (sel.kind === 'circle' && sel.rect) {
    const r = normalizeRect(sel.rect);
    const rx = r.width / 2;
    const ry = r.height / 2;
    const cx = r.x + rx - cm;
    const cy = r.y + ry - cm;
    return { clipPath: `ellipse(${rx}px ${ry}px at ${cx}px ${cy}px)` };
  }
  if (sel.kind === 'freehand' && sel.anchors && sel.anchors.length >= 3) {
    return { clipPath: `path("${bezierPathDShifted(sel.anchors, true, -cm, -cm)}")` };
  }
  if (sel.kind === 'mask' && sel.mask) {
    // La máscara (varita/pincel) está a resolución natural == dims; el <img> se
    // muestra a `dims`, así que 100% 100% la encaja 1:1 sobre el border-box.
    return {
      WebkitMaskImage: `url(${sel.mask})`,
      maskImage: `url(${sel.mask})`,
      WebkitMaskSize: '100% 100%',
      maskSize: '100% 100%',
      WebkitMaskPosition: '0 0',
      maskPosition: '0 0',
      WebkitMaskRepeat: 'no-repeat',
      maskRepeat: 'no-repeat',
    } as React.CSSProperties;
  }
  return null;
}

const intersectRect = (a: Rect, b: Rect): Rect | null => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const width = x2 - x1;
  const height = y2 - y1;
  if (width <= 0 || height <= 0) return null;
  return { x: x1, y: y1, width, height };
};

// Estado de ajustes neutro (sin cambios). Repositorio único para reset/bake.
const NEUTRAL_EDIT_STATE = { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0, opacity: 100, intensity: 0 };

// ¿tiene el editState algún ajuste no neutro? (para saber si hay algo que hornear)
function hasNonNeutralAdjust(s: any): boolean {
  if (!s) return false;
  return (s.brightness || 0) !== 0 || (s.contrast || 0) !== 0 || (s.saturation || 0) !== 0 ||
    (s.hue || 0) !== 0 || (s.blur || 0) !== 0 || (s.sepia || 0) !== 0 || (s.grayscale || 0) !== 0 ||
    (s.invert || 0) !== 0 || (s.opacity ?? 100) !== 100 || (s.intensity || 0) !== 0;
}

// Convolución 3x3 de nitidez (sharpen) sobre TODOS los píxeles de un ctx.
// Replica el feConvolveMatrix del SVG `zint-*`: kernel `0 -k 0 / -k (1+4k) -k / 0 -k 0`
// con k = (intensity/100)^1.4 * 5. Bordes: réplica de borde (vecino = propio).
// El canvas `ctx` ya trae la imagen filtrada (sin la nitidez, que ctx.filter no sabe).
function applySharpenConvolution(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number): void {
  const k = Math.pow(intensity / 100, 1.4) * 5;
  const center = 1 + 4 * k;
  const src = ctx.getImageData(0, 0, w, h);
  const s = src.data;
  const out = new Uint8ClampedArray(s.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = x > 0 ? i - 4 : i;
      const r = x < w - 1 ? i + 4 : i;
      const u = y > 0 ? i - row : i;
      const d = y < h - 1 ? i + row : i;
      out[i] = s[i] * center - k * (s[l] + s[r] + s[u] + s[d]);
      out[i + 1] = s[i + 1] * center - k * (s[l + 1] + s[r + 1] + s[u + 1] + s[d + 1]);
      out[i + 2] = s[i + 2] * center - k * (s[l + 2] + s[r + 2] + s[u + 2] + s[d + 2]);
      out[i + 3] = s[i + 3];
    }
  }
  ctx.putImageData(new ImageData(out, w, h), 0, 0);
}

const PRESET_FILTERS = [
  { labelKey: 'editorHTML.image.toolbar.presetOriginal', filter: 'none' },
  { labelKey: 'editorHTML.image.toolbar.presetVintage', filter: 'sepia(50%) contrast(110%) brightness(90%)' },
  { labelKey: 'editorHTML.image.toolbar.presetDrama', filter: 'contrast(150%) brightness(80%) saturate(120%)' },
  { labelKey: 'editorHTML.image.toolbar.presetNoir', filter: 'grayscale(100%) contrast(120%)' },
  { labelKey: 'editorHTML.image.toolbar.presetWarm', filter: 'sepia(30%) saturate(140%) hue-rotate(-10deg)' },
  { labelKey: 'editorHTML.image.toolbar.presetCool', filter: 'hue-rotate(180deg) saturate(110%) brightness(110%)' },
  { labelKey: 'editorHTML.image.toolbar.presetInverted', filter: 'invert(100%)' },
  { labelKey: 'editorHTML.image.toolbar.presetVibrant', filter: 'saturate(200%) brightness(110%)' }
];

type ImageEditorProps = {
  imageUrl: string;
  initialEditState?: ImageEditState;
  onSave: (editState: ImageEditState) => void;
  onCancel: () => void;
};

const SaveImageProjectForm = ({ onSave, onClose, isSaving, initialFiles = [] }: { onSave: (title: string, files: File[]) => void, onClose: () => void, isSaving: boolean, initialFiles?: File[] }) => {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [manualFiles, setManualFiles] = useState<File[]>(initialFiles);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      (window as any).electronAPI?.refreshFocus?.();
    }, 300);
    return () => clearTimeout(t);
  }, []);

  const addFilesToList = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setManualFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setManualFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6 p-6 text-white max-h-[80vh] overflow-y-auto custom-scrollbar">
      <div className="space-y-3">
        <Label className="text-xs font-bold uppercase text-gray-500 tracking-widest">{t('editorHTML.image.toolbar.projectName')}</Label>
        <div className="relative">
          <input
            ref={titleInputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('editorHTML.image.toolbar.examplePrompt')}
            className="w-full bg-gray-900 border border-gray-800 p-4 pr-12 rounded-2xl text-white text-lg outline-none focus:ring-2 focus:ring-green-500 shadow-inner"
            autoFocus
          />
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if ((window as any).electronAPI?.refreshFocus) {
                (window as any).electronAPI.refreshFocus();
              }
              setTimeout(() => { titleInputRef.current?.focus(); titleInputRef.current?.click(); }, 250);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            title="Activar campo"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M5.25 3.75A2.25 2.25 0 0 1 7.5 1.5h5a2.25 2.25 0 0 1 2.25 2.25v.75h.75A2.25 2.25 0 0 1 18 6.75v9a2.25 2.25 0 0 1-2.25 2.25h-11.5A2.25 2.25 0 0 1 2.25 15.75v-9a2.25 2.25 0 0 1 2.25-2.25h.75v-.75Z" />
              <path fillRule="evenodd" d="M5.25 7.5a.75.75 0 0 1 .75-.75h8a.75.75 0 0 1 0 1.5h-8a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4 bg-purple-500/5 border-2 border-dashed border-purple-500/20 rounded-2xl">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-black text-purple-400 uppercase tracking-[0.2em] flex items-center gap-2">
            <ImageIcon className="w-3 h-3" /> {t('editorHTML.image.toolbar.filesToPack')}
          </label>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="text-[9px] bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg font-black uppercase tracking-widest transition-all"
          >
            {t('editorHTML.image.toolbar.addImage')}
          </button>
          <input type="file" ref={fileInputRef} onChange={addFilesToList} multiple accept="image/*" className="hidden" />
        </div>

        {manualFiles.length > 0 ? (
          <div className="space-y-2">
            {manualFiles.map((f, i) => (
              <div key={i} className="flex items-center justify-between bg-gray-950 p-2 rounded-xl border border-gray-800 group">
                <div className="flex items-center gap-3 truncate">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                    <ImageIcon className="w-4 h-4 text-purple-400" />
                  </div>
                  <span className="text-xs font-bold text-gray-300 truncate">{f.name}</span>
                </div>
                <button onClick={() => removeFile(i)} className="p-2 text-gray-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center py-4 text-[10px] text-gray-600 uppercase font-bold italic">No hay archivos seleccionados</p>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <Button variant="ghost" onClick={onClose} className="font-bold uppercase text-[10px] tracking-widest">Cancelar</Button>
        <Button 
          onClick={() => onSave(title, manualFiles)} 
          disabled={isSaving || !title.trim()} 
          className="bg-green-600 hover:bg-green-700 h-12 px-8 font-black uppercase tracking-[0.2em] shadow-lg shadow-green-900/20"
        >
          {isSaving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Save className="w-5 h-5 mr-2" />}
          Crear Proyecto Local
        </Button>
      </div>
    </div>
  );
};

// Dibuja la imagen base aplicando la rotación/volteo de la pestaña (rotation/
// flipH/flipV), que de lo contrario sólo existen como preview CSS (transform del
// <img>) y se pierden al compositear a canvas (merge/export). Rota/voltea
// alrededor del centro de la imagen en coords del canvas completo
// (canvasMargin + W/2, canvasMargin + H/2), igual que el transform-origin del
// <img>. El filtro global (si lo hay) lo fija el llamador en ctx.filter antes de
// llamar; el save/restore lo preserva durante el drawImage.
// NOTA: para rotaciones de 90°/270° en imágenes no cuadradas la base rotada puede
// sobresalir del área (W×H) y quedar recortada por el canvas; es lo que el layout
// permite (lo mismo que ocurre en el preview CSS, que overflow:visible). Volteos y
// 180° conservan el bounding box y quedan exactos.
function drawBaseWithTransform(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  W: number,
  H: number,
  cm: number,
  rotation: number,
  flipH: boolean,
  flipV: boolean,
) {
  const cx = cm + W / 2;
  const cy = cm + H / 2;
  ctx.save();
  ctx.translate(cx, cy);
  if (rotation) ctx.rotate((rotation * Math.PI) / 180);
  if (flipH || flipV) ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(img, -W / 2, -H / 2, W, H);
  ctx.restore();
}

export default function ImageEditor({ imageUrl: initialImageUrl, initialEditState, onSave, onCancel }: ImageEditorProps) {
  const { t } = useI18n();
  const [tabs, setTabs] = useState<any[]>([
    { 
      id: 'tab-1', url: initialImageUrl, name: 'Imagen 1',
      editState: initialEditState || { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0, opacity: 100, intensity: 0 },
      rotation: 0, flipH: false, flipV: false, overlays: [],
      history: [], historyIndex: -1
    }
  ]);
  const [activeTabId, setActiveTabId] = useState('tab-1');
  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId) || tabs[0], [tabs, activeTabId]);

  const updateActiveTab = (updates: any) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, ...updates } : t));
  };

  const resolveImageUrl = useCallback((url: string) => {
    if (!url) return '';
    if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('http')) {
      return url;
    }
    // Si es una ruta relativa de PocketBase (suele empezar por /api/files/)
    if (url.startsWith('/api/')) {
      const baseUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL || process.env.NEXT_PUBLIC_PB_URL || 'http://127.0.0.1:8090';
      return baseUrl + url;
    }
    // URLs locales (ej. /flux-xxx.png) se dejan tal cual para que el navegador las resuelva contra el origen
    return url;
  }, []);

  const imageUrl = activeTab.url;
  const resolvedImageUrl = useMemo(() => resolveImageUrl(imageUrl), [imageUrl, resolveImageUrl]);
  const editState = activeTab.editState;
  const rotation = activeTab.rotation;
  const flipH = activeTab.flipH;
  const flipV = activeTab.flipV;
  const overlays = activeTab.overlays;
  // Ref con la transformación de la imagen base (rotation/flipH/flipV). Se lee
  // desde mergeSelectedOverlayIntoBase (useCallback con deps limitadas) para
  // aplicar la rotación/volteo al compositear sin closure stale.
  const baseTransformRef = useRef({ rotation, flipH, flipV });
  baseTransformRef.current = { rotation, flipH, flipV };
  const history = activeTab.history;
  const historyIndex = activeTab.historyIndex;

  const [zoom, setZoom] = useState(100);
  const [showSavedMessage, setShowSavedMessage] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [borderRadius, setBorderRadius] = useState(0);
  const [borderWidth, setBorderWidth] = useState(0);
  const [borderColor, setBorderColor] = useState('#ffffff');

  async function loadFullProjectLocal(project: any) {
    setIsLoadingProjects(true);
    try {
      const projectPath = project.path;
      const data = await readProject(projectPath);
      if (!data) throw new Error('No se pudo leer el archivo de configuración .zeus');

      const assetsFolderPath = `${projectPath}${projectPath.includes('\\') ? '\\' : '/'}assets`;
      const assets = await listDirectory(assetsFolderPath);
      const availableAssets = assets || [];

      const findAssetByName = (originalUrlOrPath: string) => {
        if (!originalUrlOrPath || typeof originalUrlOrPath !== 'string') return null;
        const fileName = originalUrlOrPath.split(/[/\\]/).pop()?.split('?')[0];
        if (!fileName) return null;
        const found = availableAssets.find((a: any) => a.name === fileName);
        return found ? getMediaUrl(found.path) : null;
      };

      const projectData = data.file || data;
      if (projectData.tabs) {
        // Re-mapear URLs de los activos locales en las pestañas
        const updatedTabs = projectData.tabs.map((tab: any) => ({
          ...tab,
          url: findAssetByName(tab.url) || tab.url,
          overlays: (tab.overlays || []).map((ov: any) => ({
            ...ov,
            url: findAssetByName(ov.url) || ov.url
          }))
        }));
        setTabs(updatedTabs);
        setActiveTabId(projectData.activeTabId);
      } else if (projectData.editState) {
        updateActiveTab({ 
          editState: projectData.editState, 
          url: findAssetByName(projectData.imageUrl) || projectData.imageUrl || imageUrl 
        });
      }
    } catch (e) {
      console.error('Error loadFullProjectLocal:', e);
      alert('Error al cargar el proyecto local');
    } finally {
      setIsLoadingProjects(false);
    }
  }

  useEffect(() => { 
    setMounted(true); 
    
    // Auto-cargar proyecto si hay un ID en la URL o parámetros locales
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('projectId');
    const isLocalProject = params.get('isLocalProject');
    const localProjectName = params.get('projectName');
    const localProjectPath = params.get('projectPath');

    if (isLocalProject === 'true' && localProjectPath) {
      console.log('📂 Auto-cargando proyecto de imagen local:', localProjectName);
      loadFullProjectLocal({ name: localProjectName, path: localProjectPath });
    } else if (projectId) {
      console.log('🔍 Detectado Proyecto ID:', projectId);
      pb.collection('proyectos').getOne(projectId, { requestKey: null }).then((record) => {
        loadProjectFromRecord(record);
      }).catch(e => {
        if (e.name !== 'ClientResponseError' || e.isAbort === false) {
          console.error('Error auto-cargando proyecto:', e);
        }
      });
    }
  }, []);

  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<'none' | 'crop_rect' | 'crop_free' | 'magic_wand' | 'brush_selection' | 'eyedropper' | 'paint_bucket' | 'shape' | 'paint_brush' | 'fill_brush' | 'smudge'>('none');
  const [shapeType, setShapeType] = useState<'rectangle' | 'circle' | 'line'>('rectangle');
  const [tolerance, setTolerance] = useState(30);
  const [brushSize, setBrushSize] = useState(50);
  const [smudgeStrength, setSmudgeStrength] = useState(60);
  const [selectedColor, setSelectedColor] = useState('#4ade80');
  const [selectionMask, setSelectionMask] = useState<string | null>(null);
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [freePoints, setFreePoints] = useState<BezierAnchor[]>([]);
  // Lazo Bézier (tipo Pluma): ancla en curso mientras se arrastra con el botón pulsado.
  const [freeDragAnchor, setFreeDragAnchor] = useState<BezierAnchor | null>(null);
  const [freeDragging, setFreeDragging] = useState(false);
  const freeDragAnchorRef = useRef<BezierAnchor | null>(null);
  const freeDraggingRef = useRef(false);
  // Lazo cerrado (Esc): el trazado se dibuja cerrado y no admite más vértices
  // hasta que se reinicia (Recortar/Copiar/Cancelar o un nuevo clic).
  const [freeClosed, setFreeClosed] = useState(false);
  // Figura → Línea: ahora es una Pluma Bézier (mismo comportamiento que el Lazo).
  // polygonPath guarda anclas Bézier; polyDragging/polyDragAnchor = ancla en arrastre.
  const [polygonPath, setPolygonPath] = useState<BezierAnchor[]>([]);
  const [polyDragAnchor, setPolyDragAnchor] = useState<BezierAnchor | null>(null);
  const [polyDragging, setPolyDragging] = useState(false);
  const polyDragAnchorRef = useRef<BezierAnchor | null>(null);
  const polyDraggingRef = useRef(false);
  const [polyClosed, setPolyClosed] = useState(false);
  const [copiedSelection, setCopiedSelection] = useState<{ url: string; width: number; height: number } | null>(null);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const hasActiveSelection = useMemo(() => {
    if (selectionMask) return true;
    if (cropRect.width > 0 && cropRect.height > 0) return true;
    if (polygonPath.length > 2) return true;
    if (freePoints.length > 1) return true;
    return false;
  }, [selectionMask, cropRect, polygonPath, freePoints]);

  // Selección "terminada" a la que limitar los ajustes (Ajustes Pro). Se despacha
  // por `activeTool` + los datos que ya existen (sin añadir estado). El usuario no
  // cambia de herramienta al abrir la pestaña Ajustes, así que coincide con lo
  // que se ve. kind='none' => los ajustes van a toda la imagen (comportamiento actual).
  const activeSelectionForAdjust = useMemo<{ kind: 'none' | 'rect' | 'circle' | 'freehand' | 'mask'; rect?: Rect; anchors?: BezierAnchor[]; mask?: string }>(() => {
    if (activeTool === 'crop_free') {
      return (freeClosed && freePoints.length >= 3) ? { kind: 'freehand', anchors: freePoints } : { kind: 'none' };
    }
    if (activeTool === 'crop_rect') {
      return (cropRect.width > 0 && cropRect.height > 0) ? { kind: 'rect', rect: cropRect } : { kind: 'none' };
    }
    if (activeTool === 'shape') {
      if (shapeType === 'rectangle' && cropRect.width > 0 && cropRect.height > 0) return { kind: 'rect', rect: cropRect };
      if (shapeType === 'circle' && cropRect.width > 0 && cropRect.height > 0) return { kind: 'circle', rect: cropRect };
      return { kind: 'none' };
    }
    if (activeTool === 'magic_wand' || activeTool === 'brush_selection') {
      return selectionMask ? { kind: 'mask', mask: selectionMask } : { kind: 'none' };
    }
    return { kind: 'none' };
  }, [activeTool, freeClosed, freePoints, cropRect, shapeType, selectionMask]);
  // Estado para edición con Flux/ComfyUI
  const [fluxPrompt, setFluxPrompt] = useState('');

  const [comfyStrength, setComfyStrength] = useState(0.8);
  const [comfySeed, setComfySeed] = useState(42);
  const [comfySteps, setComfySteps] = useState(20);
  const [comfyCfg, setComfyCfg] = useState(3.5);
  const [comfyUiUrl, setComfyUiUrl] = useState('http://127.0.0.1:8188');
  const [isEditingWithFlux, setIsEditingWithFlux] = useState(false);
  const [fluxProgress, setFluxProgress] = useState<{ current: number; total: number; percent: number } | null>(null);
  const [fluxEditorError, setFluxEditorError] = useState<string | null>(null);
  const [maskFile, setMaskFile] = useState<File | null>(null);
  const [maskPreviewUrl, setMaskPreviewUrl] = useState<string | null>(null);

  // Estados para control de servidores ComfyUI/Flux
  const [serverStatus, setServerStatus] = useState<{ comfyui: boolean; fluxBridge: boolean }>({ comfyui: false, fluxBridge: false });
  const [isStartingServers, setIsStartingServers] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  // Estados para zoom con lupa
  const [isZoomInMode, setIsZoomInMode] = useState(false);
  const [isZoomOutMode, setIsZoomOutMode] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const [zoomStart, setZoomStart] = useState({ x: 0, y: 0, zoom: 100 });

  // Estado para modo de movimiento con mano
  const [isHandMode, setIsHandMode] = useState(false);

  // Helper para verificar si está en cualquier modo de zoom
  const isZoomMode = isZoomInMode || isZoomOutMode;

  useEffect(() => {
    return () => {
      if (maskPreviewUrl) {
        URL.revokeObjectURL(maskPreviewUrl);
      }
    };
  }, [maskPreviewUrl]);

  const handleMaskFileSelection = (files: FileList | null) => {
    if (!files || files.length === 0) {
      if (maskPreviewUrl) {
        URL.revokeObjectURL(maskPreviewUrl);
        setMaskPreviewUrl(null);
      }
      setMaskFile(null);
      return;
    }

    const file = files[0];
    if (maskPreviewUrl) {
      URL.revokeObjectURL(maskPreviewUrl);
    }
    setMaskFile(file);
    setMaskPreviewUrl(URL.createObjectURL(file));
  };

  const clearMaskSelection = () => {
    if (maskPreviewUrl) {
      URL.revokeObjectURL(maskPreviewUrl);
      setMaskPreviewUrl(null);
    }
    setMaskFile(null);
  };

  const editImageWithFlux = async () => {
    if (!fluxPrompt.trim()) {
      setFluxEditorError('Escribe un prompt para la edición.');
      return;
    }

    setIsEditingWithFlux(true);
    setFluxEditorError(null);
    try {
      let mainFile: File | null = null;
      if (resolvedImageUrl) {
        if (imageUrl.startsWith('blob:')) {
          mainFile = fileCache.current.get(imageUrl) || null;
          if (!mainFile) throw new Error('La imagen temporal no está disponible.');
        } else {
          const resp = await fetch(resolvedImageUrl);
          if (!resp.ok) throw new Error('No se pudo descargar la imagen actual.');
          const blob = await resp.blob();
          const fileName = resolvedImageUrl.split('/').pop()?.split('?')[0] || 'current-image.png';
          mainFile = new File([blob], fileName, { type: blob.type || 'image/png' });
        }
      }

      const payload = new FormData();
      payload.append('prompt', fluxPrompt);
      
      if (mainFile) {
        // Modo edición: con imagen
        payload.append('image_file', mainFile);
        payload.append('strength', comfyStrength.toString());
        payload.append('seed', comfySeed.toString());
        payload.append('steps', comfySteps.toString());
        payload.append('cfg', comfyCfg.toString());
        payload.append('comfyui_url', comfyUiUrl);
        
        if (maskFile) {
          payload.append('mask_file', maskFile);
        }
        console.log('Modo edición - FormData keys:', Array.from(payload.keys()));
      } else {
        // Modo generación: sin imagen
        payload.append('width', '1024');
        payload.append('height', '1024');
        payload.append('steps', comfySteps.toString());
        console.log('Modo generación - FormData keys:', Array.from(payload.keys()));
        console.log('Prompt:', fluxPrompt);
        console.log('Steps:', comfySteps);
      }

      const response = await fetch('http://localhost:5081/flux/', {
        method: 'POST',
        body: payload
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('El servidor Flux no está disponible. Asegúrate de que el servidor esté corriendo en localhost:5081.');
        }
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || errorData?.error || 'Error editando la imagen con Flux.');
      }

      const responseData = await response.json();
      console.log('Respuesta inicial de la API Flux:', responseData);

      const jobId = responseData?.job_id;
      if (!jobId) {
        throw new Error(`La API no devolvió job_id. Respuesta: ${JSON.stringify(responseData)}`);
      }

      // Polling: esperar a que el job termine (máximo 600s)
      let fluxImageUrl: string | null = null;
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 2000)); // esperar 2s entre polls
        const statusRes = await fetch(`http://localhost:5081/flux/status/${jobId}`);
        if (!statusRes.ok) continue;
        const statusData = await statusRes.json();
        console.log(`[Flux Polling] ${jobId}:`, statusData.status, statusData.progress);
        if (statusData.progress) {
          setFluxProgress(statusData.progress);
        }
        if (statusData.status === 'completed') {
          fluxImageUrl = statusData?.image?.url || null;
          break;
        }
        if (statusData.status === 'error') {
          throw new Error(statusData.error || 'Error desconocido en el servidor Flux.');
        }
      }
      setFluxProgress(null);

      if (!fluxImageUrl) {
        throw new Error('Timeout esperando la imagen de ComfyUI. Inténtalo de nuevo.');
      }

      // Convertir ruta absoluta de Windows a media:// en Electron
      if (isElectron() && window.electronAPI?.getMediaUrl && /^[A-Za-z]:\\/.test(fluxImageUrl)) {
        fluxImageUrl = window.electronAPI.getMediaUrl(fluxImageUrl);
      }

      // Actualizar el editor con la imagen editada
      updateActiveTab({ url: fluxImageUrl });
      resetFilters();
      clearMaskSelection();

      // Eliminar el registro de imagen_generada de PocketBase
      try {
        const records = await pb.collection('imagen_generada').getFullList({
          sort: '-created',
          limit: 1
        });
        if (records.length > 0) {
          await pb.collection('imagen_generada').delete(records[0].id);
          console.log('Registro de imagen_generada eliminado de PocketBase');
        }
      } catch (deleteError) {
        console.warn('No se pudo eliminar el registro de imagen_generada:', deleteError);
      }

      alert('Imagen editada/generada con éxito con Flux.');
    } catch (e: any) {
      console.error(e);
      setFluxEditorError(e.message || 'Error al editar la imagen.');
    } finally {
      setIsEditingWithFlux(false);
    }
  };

  // Función para iniciar ComfyUI y Flux Bridge desde el editor
  const handleStartServers = async () => {
    if (!isElectron()) {
      setServerMessage('Solo disponible en la app de escritorio');
      return;
    }
    setIsStartingServers(true);
    setServerMessage(null);
    try {
      setServerMessage('Iniciando ComfyUI...');
      const comfyResult = await startComfyUI();
      if (!comfyResult.success) {
        throw new Error(comfyResult.error || 'No se pudo iniciar ComfyUI');
      }
      setServerMessage('ComfyUI listo. Iniciando Flux Bridge...');
      const bridgeResult = await startFluxBridge();
      if (!bridgeResult.success) {
        throw new Error(bridgeResult.error || 'No se pudo iniciar Flux Bridge');
      }
      setServerStatus({ comfyui: true, fluxBridge: true });
      setServerMessage('Servidores listos. Ya puedes generar imágenes.');
    } catch (e: any) {
      console.error(e);
      setServerMessage(e.message || 'Error iniciando servidores');
    } finally {
      setIsStartingServers(false);
    }
  };

  // Verificar estado de servidores periódicamente
  useEffect(() => {
    if (!isElectron()) return;
    const check = async () => {
      try {
        const status = await getServerStatus();
        setServerStatus({ comfyui: status.comfyui.running, fluxBridge: status.fluxBridge.running });
      } catch (e) {}
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [removeBgError, setRemoveBgError] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [canvasMargin, setCanvasMargin] = useState(0);
  const [cameraOffset, setCameraOffset] = useState({ x: 0, y: 0 });
  const [isPanMode, setIsPanMode] = useState(false);
  const [isPanningCanvas, setIsPanningCanvas] = useState(false);
  const panStateRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const exploreButtonRef = useRef<HTMLButtonElement | null>(null);
  const [welcomeCanvasWidth, setWelcomeCanvasWidth] = useState(360);

  const baseCanvasWidth = imageDimensions.width || welcomeCanvasWidth;
  const baseCanvasHeight = imageDimensions.height || 400;
  const computedCanvasWidth = baseCanvasWidth + canvasMargin * 2;
  const computedCanvasHeight = baseCanvasHeight + canvasMargin * 2;

  useLayoutEffect(() => {
    const button = exploreButtonRef.current;
    if (!button) return;
    const updateWidth = () => setWelcomeCanvasWidth(button.offsetWidth || 360);
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(button);
    return () => observer.disconnect();
  }, []);

  const [draggingOverlayId, setDraggingOverlayId] = useState<string | null>(null);
  const [resizingOverlayId, setResizingOverlayId] = useState<string | null>(null);
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [rotatingOverlayId, setRotatingOverlayId] = useState<string | null>(null);
  const [rotationStartData, setRotationStartData] = useState<RotationStartData | null>(null);

  const saveToHistory = useCallback(() => {
    // Snapshotea el estado ACTUAL de la pestaña activa leyéndolo DENTRO del
    // updater de setTabs. Así, cuando un caller hace updateActiveTab({...}) y
    // luego saveToHistory() en el mismo gesto, este updater ya ve el estado
    // NUEVO (React aplica los updaters en orden). Antes se leía del closure
    // (estado previo) y el historial quedaba desplazado → deshacer no funcionaba.
    setTabs(prev => prev.map(t => {
      if (t.id !== activeTabId) return t;
      const snapshot = {
        url: t.url,
        editState: { ...(t.editState || {}) },
        rotation: t.rotation, flipH: t.flipH, flipV: t.flipV,
        overlays: (t.overlays || []).map((o: any) => ({ ...o })),
      };
      const newHistory = t.history.slice(0, t.historyIndex + 1);
      newHistory.push(snapshot);
      const finalHistory = newHistory.length > 20 ? newHistory.slice(-20) : newHistory;
      return { ...t, history: finalHistory, historyIndex: finalHistory.length - 1 };
    }));
  }, [activeTabId]);

  const handleUndo = () => { if (historyIndex > 0) updateActiveTab({ historyIndex: historyIndex - 1, ...history[historyIndex - 1] }); };
  const handleRedo = () => { if (historyIndex < history.length - 1) updateActiveTab({ historyIndex: historyIndex + 1, ...history[historyIndex + 1] }); };

  // Captura el estado inicial de cada pestaña en su historial (punto de partida
  // para poder deshacer la primera acción). Sólo actúa si el historial está vacío.
  useEffect(() => {
    const t = tabs.find(x => x.id === activeTabId);
    if (t && t.historyIndex === -1) saveToHistory();
  }, [activeTabId, tabs, saveToHistory]);

  const addNewTab = () => {
    const newId = `tab-${Date.now()}`;
    setTabs(prev => [...prev, { id: newId, url: '', name: `Imagen ${prev.length + 1}`, editState: { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0, opacity: 100, intensity: 0 }, rotation: 0, flipH: false, flipV: false, overlays: [], history: [], historyIndex: -1 }]);
    setActiveTabId(newId);
  };

  const createNewCanvas = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0)'; // Transparente por defecto
      ctx.fillRect(0, 0, width, height);
    }
    const blankUrl = canvas.toDataURL();
    
    const newId = `tab-${Date.now()}`;
    setTabs(prev => [...prev, { 
      id: newId, 
      url: blankUrl, 
      name: `Nuevo ${width}x${height}`, 
      editState: { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0, opacity: 100, intensity: 0 }, 
      rotation: 0, flipH: false, flipV: false, overlays: [], 
      history: [], historyIndex: -1 
    }]);
    setActiveTabId(newId);
    setIsNewCanvasModalOpen(false);
  };

  const createCanvasFromClipboard = () => {
    if (!copiedSelection) return;
    
    const newId = `tab-${Date.now()}`;
    setTabs(prev => [...prev, { 
      id: newId, 
      url: copiedSelection.url, 
      name: `Copiado ${copiedSelection.width}x${copiedSelection.height}`, 
      editState: { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0, opacity: 100, intensity: 0 }, 
      rotation: 0, flipH: false, flipV: false, overlays: [], 
      history: [], historyIndex: -1 
    }]);
    setActiveTabId(newId);
    setIsNewCanvasModalOpen(false);
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); if (tabs.length === 1) return;
    const newTabs = tabs.filter(t => t.id !== id); setTabs(newTabs);
    if (activeTabId === id) setActiveTabId(newTabs[newTabs.length - 1].id);
  };

  const getFilterStyle = (s: any, id?: string) => {
    // Intensidad (-100..100, 0 = neutro): NITIDEZ real (sharpen) que remarca líneas
    // y rasgos. Se implementa con un filtro SVG de convolución (feConvolveMatrix,
    // kernel de sharpen) por id `zint-<id>`; aquí sólo añadimos la ref. url() cuando
    // intensity != 0. + = sharpen (intensifica), − = suaviza (blur), 0 = nada.
    const intensity = s.intensity ?? 0;
    const urlRef = id && intensity !== 0 ? ` url(#${id})` : '';
    return {
      filter: `brightness(${100 + (s.brightness || 0)}%) contrast(${100 + (s.contrast || 0)}%) saturate(${100 + (s.saturation || 0)}%) hue-rotate(${s.hue || 0}deg) blur(${s.blur || 0}px) sepia(${s.sepia || 0}%) grayscale(${s.grayscale || 0}%) invert(${s.invert || 0}%)${urlRef}`,
      opacity: (s.opacity ?? 100) / 100
    };
  };

  // Renderiza un <filter> SVG de nitidez (sharpen) para un id y valor de intensidad.
  // +intensity → feConvolveMatrix con kernel de sharpen (centro 1+4k, bordes −k);
  // −intensity → feGaussianBlur (suaviza); 0 → null (no se añade la ref url()).
  const renderIntensityFilter = (id: string, intensity: number) => {
    if (intensity > 0) {
      // Curva no lineal: suave a valores bajos, mucho más fuerte al 100%.
      // 100% → k=5 (centro 21); 50% → k≈1.9; 25% → k≈0.93.
      const k = Math.pow(intensity / 100, 1.4) * 5;
      const km = `0 ${-k} 0 ${-k} ${1 + 4 * k} ${-k} 0 ${-k} 0`;
      return (
        <filter id={id} key={id} colorInterpolationFilters="sRGB">
          <feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix={km} />
        </filter>
      );
    } else if (intensity < 0) {
      const std = (-intensity / 100) * 1.5;
      return (
        <filter id={id} key={id} colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={std} />
        </filter>
      );
    }
    return null;
  };

  // Filtros de intensidad necesarios: uno para la imagen base + uno por capa.
  const intensityDefs = [
    { id: 'zint-base', intensity: editState.intensity ?? 0 },
    ...overlays.map((ov: any) => ({ id: `zint-${ov.id}`, intensity: ov.editState?.intensity ?? 0 })),
  ];

  const currentEditState = useMemo(() => {
    if (selectedOverlayId) {
      const ov = overlays.find((o: any) => o.id === selectedOverlayId);
      return ov?.editState || { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0, opacity: 100, intensity: 0 };
    }
    return editState;
  }, [selectedOverlayId, overlays, editState]);

  const handleSliderChange = (key: keyof ExtendedImageEditState, value: number[]) => {
    const val = value[0];
    if (selectedOverlayId) {
      updateActiveTab({
        overlays: overlays.map((o: any) =>
          o.id === selectedOverlayId
            ? { ...o, editState: { ...(o.editState || { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0, opacity: 100, intensity: 0 }), [key]: val } }
            : o
        )
      });
    } else {
      updateActiveTab({ editState: { ...editState, [key]: val } });
    }
  };

  const resetFilters = () => {
    updateActiveTab({
      editState: { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0, opacity: 100, intensity: 0 },
      rotation: 0, flipH: false, flipV: false, overlays: []
    });
  };

  // "Guardar cambios": hornea (aplica destructivamente) los ajustes ACTUALES a la
  // imagen base. Si hay selección terminada (lazo/rect/círculo/varita/pincel), sólo
  // a esa zona; si no, a toda la imagen. Tras hornear, el editState vuelve a neutro
  // y la selección se quita → los ajustes quedan FIJOS en la zona y ya no se extienden
  // al desenfocar la selección. Incluye la nitidez (intensity>0) por convolución y el
  // desenfoque extra de intensity<0, para coincidir con el preview.
  const [isBaking, setIsBaking] = useState(false);
  const bakeAdjustments = async () => {
    if (selectedOverlayId) return; // los ajustes de capa se guardan aparte
    const img = imageRef.current;
    if (!img || !img.naturalWidth) return;
    if (!hasNonNeutralAdjust(editState)) return;
    setIsBaking(true);
    try {
      const W = img.naturalWidth, H = img.naturalHeight;
      const cm = canvasMargin;
      const intensity = editState.intensity ?? 0;
      // Filtro shorthand (la nitidez SVG no la hace ctx.filter):
      let filterStr = `brightness(${100 + (editState.brightness || 0)}%) contrast(${100 + (editState.contrast || 0)}%) saturate(${100 + (editState.saturation || 0)}%) hue-rotate(${editState.hue || 0}deg) blur(${editState.blur || 0}px) sepia(${editState.sepia || 0}%) grayscale(${editState.grayscale || 0}%) invert(${editState.invert || 0}%)`;
      if (intensity < 0) { // el SVG lo hace con feGaussianBlur std=(-int/100)*1.5
        filterStr += ` blur(${(-intensity / 100) * 1.5}px)`;
      }
      const opacity = (editState.opacity ?? 100) / 100;

      // 1) base sin filtro (resolución natural, sin márgenes)
      const out = document.createElement('canvas');
      out.width = W; out.height = H;
      const octx = out.getContext('2d')!;
      octx.filter = 'none'; octx.globalAlpha = 1;
      octx.drawImage(img, 0, 0);

      // 2) base filtrada (shorthands + blur de intensity<0) en un canvas temp
      const filtered = document.createElement('canvas');
      filtered.width = W; filtered.height = H;
      const fctx = filtered.getContext('2d')!;
      fctx.filter = filterStr;
      fctx.drawImage(img, 0, 0);
      fctx.filter = 'none';
      if (intensity > 0) applySharpenConvolution(fctx, W, H, intensity);

      // 3) composite la base filtrada recortada a la selección (o a toda la imagen)
      //    sobre la base sin filtro, con la opacidad del ajuste.
      const sel = activeSelectionForAdjust;
      if (sel.kind === 'mask' && sel.mask) {
        let mImg = new Image();
        mImg.src = sel.mask;
        await new Promise<void>((res, rej) => { mImg.onload = () => res(); mImg.onerror = rej; });
        const tmp = document.createElement('canvas');
        tmp.width = W; tmp.height = H;
        const tctx = tmp.getContext('2d')!;
        tctx.drawImage(filtered, 0, 0);
        tctx.globalCompositeOperation = 'destination-in';
        tctx.drawImage(mImg, 0, 0, W, H);
        octx.globalAlpha = opacity;
        octx.drawImage(tmp, 0, 0);
        octx.globalAlpha = 1;
      } else if (sel.kind === 'rect' || sel.kind === 'circle' || sel.kind === 'freehand') {
        octx.save();
        octx.beginPath();
        if (sel.kind === 'rect' && sel.rect) {
          const r = normalizeRect(sel.rect);
          octx.rect(r.x - cm, r.y - cm, r.width, r.height);
        } else if (sel.kind === 'circle' && sel.rect) {
          const r = normalizeRect(sel.rect);
          octx.ellipse(r.x + r.width / 2 - cm, r.y + r.height / 2 - cm, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
        } else if (sel.kind === 'freehand' && sel.anchors && sel.anchors.length >= 3) {
          traceBezierClosed(octx, sel.anchors, -cm, -cm);
        }
        octx.clip();
        octx.globalAlpha = opacity;
        octx.drawImage(filtered, 0, 0);
        octx.restore();
        octx.globalAlpha = 1;
      } else {
        octx.globalAlpha = opacity;
        octx.drawImage(filtered, 0, 0);
        octx.globalAlpha = 1;
      }

      const url = out.toDataURL('image/png');
      updateActiveTab({ url, editState: { ...NEUTRAL_EDIT_STATE } });
      // Quita la selección (ya horneada): al deseleccionar a mano no queda nada que extender.
      setSelectionMask(null);
      setCropRect({ x: 0, y: 0, width: 0, height: 0 });
      setFreePoints([]); setFreeClosed(false); setFreeDragging(false); setFreeDragAnchor(null);
      freeDraggingRef.current = false; freeDragAnchorRef.current = null;
      setPolygonPath([]); setPolyDragging(false); setPolyDragAnchor(null); setPolyClosed(false);
      saveToHistory();
    } catch (e) {
      console.error('[bakeAdjustments]', e);
    } finally {
      setIsBaking(false);
    }
  };

  const handleRemoveBackground = async () => {
    if (!resolvedImageUrl) {
      setRemoveBgError('Carga primero una imagen.');
      return;
    }
    setIsRemovingBg(true);
    setRemoveBgError(null);
    const previousBlob = imageUrl.startsWith('blob:') ? imageUrl : null;
    try {
      let uploadFile: File | null = null;
      if (imageUrl.startsWith('blob:')) {
        uploadFile = fileCache.current.get(imageUrl) || null;
        if (!uploadFile) throw new Error('El archivo cargado no está disponible para remover el fondo.');
      } else {
        const remoteResponse = await fetch(resolvedImageUrl);
        if (!remoteResponse.ok) throw new Error('No se pudo descargar la imagen actual');
        const remoteBlob = await remoteResponse.blob();
        const suggestedName = resolvedImageUrl.split('/').pop()?.split('?')[0] || `imagen-${Date.now()}`;
        uploadFile = new File([remoteBlob], suggestedName, { type: remoteBlob.type || 'image/png' });
      }
      const formData = new FormData();
      formData.append('image_file', uploadFile);
      const response = await fetch('/api/remove-bg', { method: 'POST', body: formData });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || 'No se pudo eliminar el fondo');
      }
      const blob = await response.blob();
      if (!blob || !blob.type.startsWith('image/')) {
        throw new Error('Respuesta inválida del servicio de fondo');
      }
      const url = URL.createObjectURL(blob);
      updateActiveTab({ url });
      resetFilters();
      setSelectionMask(null);
      setActiveTool('none');
      if (previousBlob) {
        URL.revokeObjectURL(previousBlob);
      }
    } catch (error) {
      console.error(error);
      setRemoveBgError(error instanceof Error ? error.message : 'Ocurrió un error eliminando el fondo');
    } finally {
      setIsRemovingBg(false);
    }
  };

  const applyMagicWand = async (startX: number, startY: number, mode: 'add' | 'subtract' | 'replace') => {
    if (!imageRef.current) return;
    const img = imageRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // El canvas de trabajo ahora incluye los márgenes
    canvas.width = computedCanvasWidth; 
    canvas.height = computedCanvasHeight; 
    ctx.drawImage(img, canvasMargin, canvasMargin);
    
    // startX y startY ya están en el sistema de coordenadas del canvas completo
    const x = Math.round(startX); 
    const y = Math.round(startY);
    
    // Asegurar que x e y estén dentro de los límites
    if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) return;

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const targetIdx = (y * canvas.width + x) * 4;
    const targetR = data[targetIdx], targetG = data[targetIdx+1], targetB = data[targetIdx+2];
    
    const maskCanvas = document.createElement('canvas'); 
    maskCanvas.width = canvas.width; 
    maskCanvas.height = canvas.height;
    const maskCtx = maskCanvas.getContext('2d')!;
    
    if ((mode === 'add' || mode === 'subtract') && selectionMask) {
      const oldMask = new Image(); 
      oldMask.src = selectionMask; 
      await new Promise(r => oldMask.onload = r);
      // Si la máscara anterior tenía diferente tamaño, escalarla o centrarla
      maskCtx.drawImage(oldMask, 0, 0, oldMask.width, oldMask.height, 0, 0, maskCanvas.width, maskCanvas.height);
    }
    
    const maskData = maskCtx.getImageData(0, 0, canvas.width, canvas.height);
    const stack = [[x, y]]; const seen = new Uint8Array(canvas.width * canvas.height);
    while (stack.length > 0) {
      const [currX, currY] = stack.pop()!; const seenIdx = currY * canvas.width + currX;
      if (seen[seenIdx]) continue; seen[seenIdx] = 1;
      const idx = (currY * canvas.width + currX) * 4;
      const diff = Math.sqrt(Math.pow(data[idx] - targetR, 2) + Math.pow(data[idx+1] - targetG, 2) + Math.pow(data[idx+2] - targetB, 2));
      if (diff <= tolerance) {
        if (mode === 'subtract') maskData.data[idx+3] = 0;
        else { maskData.data[idx]=59; maskData.data[idx+1]=130; maskData.data[idx+2]=246; maskData.data[idx+3]=180; }
        if (currX > 0) stack.push([currX - 1, currY]); if (currX < canvas.width - 1) stack.push([currX + 1, currY]);
        if (currY > 0) stack.push([currX, currY - 1]); if (currY < canvas.height - 1) stack.push([currX, currY + 1]);
      }
    }
    maskCtx.putImageData(maskData, 0, 0); setSelectionMask(maskCanvas.toDataURL());
  };

  const paintSelection = async (startX: number, startY: number, mode: 'add' | 'subtract') => {
    if (!imageRef.current) return;
    const img = imageRef.current;
    const canvas = document.createElement('canvas'); 
    
    // El canvas de trabajo ahora incluye los márgenes
    canvas.width = computedCanvasWidth; 
    canvas.height = computedCanvasHeight;
    const ctx = canvas.getContext('2d')!;
    
    if (selectionMask) { 
      const mImg = new Image(); 
      mImg.src = selectionMask; 
      await new Promise(r => mImg.onload = r); 
      // Dibujar la máscara existente (escalada si es necesario)
      ctx.drawImage(mImg, 0, 0, mImg.width, mImg.height, 0, 0, canvas.width, canvas.height); 
    }
    
    ctx.save(); 
    ctx.beginPath(); 
    // startX y startY ya están en el sistema de coordenadas del canvas completo
    ctx.arc(startX, startY, brushSize / 2, 0, Math.PI * 2);
    
    if (mode === 'subtract') { 
      ctx.globalCompositeOperation = 'destination-out'; 
      ctx.fill(); 
    } else { 
      ctx.fillStyle = 'rgba(59, 130, 246, 0.7)'; 
      ctx.fill(); 
    }
    ctx.restore(); 
    setSelectionMask(canvas.toDataURL());
  };

  const handleEyedropper = (startX: number, startY: number) => {
    if (!imageRef.current) return;
    const img = imageRef.current;
    const canvas = document.createElement('canvas'); 
    
    // El canvas de trabajo ahora incluye los márgenes
    canvas.width = computedCanvasWidth; 
    canvas.height = computedCanvasHeight;
    const ctx = canvas.getContext('2d')!; 
    
    // Dibujar la imagen actual desplazada por el margen
    ctx.drawImage(img, canvasMargin, canvasMargin);
    
    // startX y startY ya están en el sistema de coordenadas del canvas completo
    const x = Math.round(startX);
    const y = Math.round(startY);
    
    // Asegurar que x e y estén dentro de los límites
    if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) return;
    
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    const hex = "#" + ("000000" + ((pixel[0] << 16) | (pixel[1] << 8) | pixel[2]).toString(16)).slice(-6);
    setSelectedColor(hex);
  };

  const handlePaintBucket = async (startX: number, startY: number) => {
    if (!imageRef.current) return;
    
    // 1. Detectar qué tipo de selección tenemos disponible basándonos en los datos
    const isPolygon = polygonPath.length > 2;
    const isCircle = shapeType === 'circle' && cropRect.width > 0;
    const isRect = !isPolygon && !isCircle && cropRect.width > 0;

    const img = imageRef.current;
    const canvas = document.createElement('canvas'); 
    canvas.width = computedCanvasWidth; 
    canvas.height = computedCanvasHeight;
    const ctx = canvas.getContext('2d')!; 
    
    // 2. Dibujar imagen base
    ctx.drawImage(img, canvasMargin, canvasMargin);
    
    // 3. Crear canvas temporal para el relleno (flood fill)
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.drawImage(img, canvasMargin, canvasMargin);

    const x = Math.round(startX);
    const y = Math.round(startY);
    const pixelData = tempCtx.getImageData(x, y, 1, 1).data;
    const targetR = pixelData[0], targetG = pixelData[1], targetB = pixelData[2];
    const fillR = parseInt(selectedColor.slice(1,3), 16), fillG = parseInt(selectedColor.slice(3,5), 16), fillB = parseInt(selectedColor.slice(5,7), 16);
    
    if (!(targetR === fillR && targetG === fillG && targetB === fillB)) {
      const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const pixels = imageData.data;
      const stack = [[x, y]]; 
      const seen = new Uint8Array(tempCanvas.width * tempCanvas.height);
      
      while (stack.length > 0) {
        const [currX, currY] = stack.pop()!; 
        const sIdx = currY * tempCanvas.width + currX;
        if (seen[sIdx] || currX < 0 || currX >= tempCanvas.width || currY < 0 || currY >= tempCanvas.height) continue;
        seen[sIdx] = 1;
        
        const idx = (currY * tempCanvas.width + currX) * 4;
        if (Math.abs(pixels[idx] - targetR) <= 15 && Math.abs(pixels[idx+1] - targetG) <= 15 && Math.abs(pixels[idx+2] - targetB) <= 15) {
          pixels[idx] = fillR; pixels[idx+1] = fillG; pixels[idx+2] = fillB; pixels[idx+3] = 255;
          stack.push([currX - 1, currY], [currX + 1, currY], [currX, currY - 1], [currX, currY + 1]);
        }
      }
      tempCtx.putImageData(imageData, 0, 0);
    }

    // 4. Aplicar el recorte de la selección en el canvas principal y volcar el relleno
    ctx.save();
    ctx.beginPath();
    
    if (isPolygon) {
      traceBezierClosed(ctx, polygonPath);
      ctx.clip();
    } else if (isCircle) {
      ctx.ellipse(
        cropRect.x + cropRect.width / 2, 
        cropRect.y + cropRect.height / 2, 
        cropRect.width / 2, 
        cropRect.height / 2, 
        0, 0, Math.PI * 2
      );
      ctx.clip();
    } else if (isRect) {
      ctx.rect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
      ctx.clip();
    }
    
    // Solo se dibujará lo que esté dentro del recorte (clip)
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.restore();
    
    const newImageUrl = canvas.toDataURL();
    updateActiveTab({ url: newImageUrl });
    if (canvasMargin > 0) setCanvasMargin(0);
    saveToHistory();
  };

  const handlePaintBrush = (startX: number, startY: number) => {
    if (!imageRef.current) return;
    
    // Verificar si hay una capa seleccionada
    if (selectedOverlayId) {
      // Pintar sobre la capa seleccionada
      const overlay = overlays.find((ov: OverlayLayer) => ov.id === selectedOverlayId);
      if (overlay) {
        console.log('Pintando sobre capa:', selectedOverlayId);
        
        // Crear canvas para pintar sobre la capa
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas'); 
          canvas.width = img.width; 
          canvas.height = img.height;
          const ctx = canvas.getContext('2d')!; 
          
          // Dibujar la capa actual
          ctx.drawImage(img, 0, 0);
          
          // Convertir color hex a RGB
          const fillR = parseInt(selectedColor.slice(1,3), 16);
          const fillG = parseInt(selectedColor.slice(3,5), 16);
          const fillB = parseInt(selectedColor.slice(5,7), 16);
          
          // Calcular coordenadas relativas a la capa
          const layerX = startX - overlay.x;
          const layerY = startY - overlay.y;
          
          // Verificar si el clic está dentro de los límites de la capa
          if (layerX >= 0 && layerX <= overlay.width && layerY >= 0 && layerY <= overlay.height) {
            // Pintar el círculo
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.beginPath();
            ctx.arc(layerX, layerY, brushSize / 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${fillR}, ${fillG}, ${fillB}, 0.8)`;
            ctx.fill();
            ctx.restore();
            
            // Actualizar la capa con la pintura inmediatamente
            const paintedUrl = canvas.toDataURL();
            updateActiveTab({ 
              overlays: overlays.map((ov: OverlayLayer) => 
                ov.id === selectedOverlayId 
                  ? { ...ov, url: paintedUrl }
                  : ov
              )
            });
          }
        };
        img.src = overlay.url;
      }
    } else {
      // Sin capa seleccionada, pintar sobre imagen principal
      const img = imageRef.current;
      const canvas = document.createElement('canvas'); 
      
      // El canvas de trabajo ahora incluye los márgenes
      canvas.width = computedCanvasWidth; 
      canvas.height = computedCanvasHeight;
      const ctx = canvas.getContext('2d')!; 
      
      // Dibujar la imagen actual desplazada por el margen
      ctx.drawImage(img, canvasMargin, canvasMargin);
      
      // Convertir color hex a RGB
      const fillR = parseInt(selectedColor.slice(1,3), 16);
      const fillG = parseInt(selectedColor.slice(3,5), 16);
      const fillB = parseInt(selectedColor.slice(5,7), 16);
      
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath();
      // startX y startY ya están en el sistema de coordenadas del canvas completo
      ctx.arc(startX, startY, brushSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${fillR}, ${fillG}, ${fillB}, 0.8)`;
      ctx.fill();
      ctx.restore();
      
      // Actualizar la imagen principal inmediatamente
      const newImageUrl = canvas.toDataURL();
      updateActiveTab({ 
        url: newImageUrl,
        cropRect: cropRect,
        selectionMask: selectionMask,
        freePoints: freePoints,
        polygonPath: polygonPath
      });
      
      // Si había margen, ahora ha sido absorbido por la nueva imagen
      if (canvasMargin > 0) {
        setCanvasMargin(0);
      }
    }
  };

  const handleFillBrush = (startX: number, startY: number) => {
    // Similar a paint brush pero con relleno más denso
    handlePaintBrush(startX, startY);
  };

  // Dedo (smudge): arrastra el color difuminándolo. Mantiene un canvas de trabajo
  // persistente durante el trazo y un buffer circular con el color que "lleva el
  // dedo". En cada paso estampa el buffer sobre el trabajo (source-over con
  // alpha=fuerza) y vuelve a muestrear la región bajo el dedo al buffer
  // (source-over con alpha=fuerza) — así el color se mezcla y se arrastra.
  const handleSmudgeStart = (x: number, y: number) => {
    if (!imageRef.current) return;
    const img = imageRef.current;
    const r = Math.max(1, brushSize / 2);
    const size = Math.ceil(r * 2);
    const work = document.createElement('canvas');
    work.width = computedCanvasWidth; work.height = computedCanvasHeight;
    const wctx = work.getContext('2d')!;
    wctx.drawImage(img, canvasMargin, canvasMargin);
    smudgeWorkRef.current = work;
    const buf = document.createElement('canvas');
    buf.width = size; buf.height = size;
    const bctx = buf.getContext('2d')!;
    bctx.save();
    bctx.beginPath(); bctx.arc(r, r, r, 0, Math.PI * 2); bctx.clip();
    bctx.drawImage(work, x - r, y - r, size, size, 0, 0, size, size);
    bctx.restore();
    smudgeBufferRef.current = buf;
    smudgeLastPosRef.current = { x, y };
  };

  const handleSmudgeMove = (x: number, y: number) => {
    const work = smudgeWorkRef.current;
    const buf = smudgeBufferRef.current;
    const last = smudgeLastPosRef.current;
    if (!work || !buf || !last) return;
    const wctx = work.getContext('2d')!;
    const bctx = buf.getContext('2d')!;
    const r = buf.width / 2;
    const size = buf.width;
    const strength = Math.max(0.02, Math.min(1, smudgeStrength / 100));
    const dx = x - last.x, dy = y - last.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, r / 3);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      const px = last.x + (dx * i) / n;
      const py = last.y + (dy * i) / n;
      // Estampar el color que lleva el dedo sobre el trabajo
      wctx.save();
      wctx.globalAlpha = strength;
      wctx.beginPath(); wctx.arc(px, py, r, 0, Math.PI * 2); wctx.clip();
      wctx.drawImage(buf, px - r, py - r);
      wctx.restore();
      // Volver a muestrear la región bajo el dedo y mezclar con el color nuevo
      bctx.save();
      bctx.globalCompositeOperation = 'source-over';
      bctx.globalAlpha = strength;
      bctx.beginPath(); bctx.arc(r, r, r, 0, Math.PI * 2); bctx.clip();
      bctx.drawImage(work, px - r, py - r, size, size, 0, 0, size, size);
      bctx.restore();
    }
    smudgeLastPosRef.current = { x, y };
    updateActiveTab({ url: work.toDataURL() });
    if (canvasMargin > 0) setCanvasMargin(0);
  };

  const handleSmudgeEnd = () => {
    const work = smudgeWorkRef.current;
    if (work) updateActiveTab({ url: work.toDataURL() });
    smudgeWorkRef.current = null;
    smudgeBufferRef.current = null;
    smudgeLastPosRef.current = null;
  };

  const handleImageMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isHandle = target.classList.contains('layer-handle');
    const isRotateHandle = target.classList.contains('layer-rotate-handle');
    
    // Usar el contenedor del lienzo para las coordenadas totales
    const canvasContainer = document.getElementById('image-canvas-container');
    if (!canvasContainer) return;
    
    const rect = canvasContainer.getBoundingClientRect();
    const zoomScale = zoom / 100;
    
    // x e y ahora van de 0 a computedCanvasWidth/Height
    const x = (e.clientX - rect.left) / zoomScale;
    const y = (e.clientY - rect.top) / zoomScale;
    
    if (isRotateHandle) {
      const overlayId = target.parentElement?.getAttribute('data-id');
      const overlay = overlays.find((ov: OverlayLayer) => ov.id === overlayId);
      if (overlay && overlayId) {
        e.preventDefault(); e.stopPropagation();
        const centerX = overlay.x + overlay.width / 2;
        const centerY = overlay.y + overlay.height / 2;
        const startAngle = Math.atan2(y - centerY, x - centerX);
        setRotatingOverlayId(overlayId);
        setSelectedOverlayId(overlayId);
        setRotationStartData({ centerX, centerY, startAngle, initialRotation: overlay.rotation ?? 0 });
        return;
      }
    }
    if (isHandle) {
      const overlayId = target.parentElement?.getAttribute('data-id'), handleType = target.className.split(' ').find((c: string) => c.startsWith('handle-'));
      if (overlayId && handleType) { e.preventDefault(); e.stopPropagation(); setResizingOverlayId(overlayId); setSelectedOverlayId(overlayId); setActiveHandle(handleType); setStartPos({ x, y }); return; }
    }
    const clickedOverlay = [...overlays].reverse().find(ov => x >= ov.x && x <= ov.x + ov.width && y >= ov.y && y <= ov.y + ov.height);
    if (clickedOverlay && activeTool === 'none') { 
      e.preventDefault(); 
      e.stopPropagation(); 
      setDraggingOverlayId(clickedOverlay.id); 
      setSelectedOverlayId(clickedOverlay.id); 
      // Guardar el offset exacto dentro de la capa para un arrastre natural
      setStartPos({ x: x - clickedOverlay.x, y: y - clickedOverlay.y }); 
      return; 
    }
    if (activeTool === 'none') { setSelectedOverlayId(null); return; }
    if (activeTool === 'shape' && shapeType === 'line') {
      // Pluma Bézier (igual que el Lazo): clic = vértice; mantener + arrastrar =
      // curvar el segmento que entra. Si el trazado estaba cerrado (Esc), reinicia.
      if (polyClosed) { setPolygonPath([]); setPolyDragging(false); setPolyDragAnchor(null); setPolyClosed(false); }
      const a: BezierAnchor = { x, y, hInX: x, hInY: y, hOutX: x, hOutY: y };
      polyDragAnchorRef.current = a;
      polyDraggingRef.current = true;
      setPolyDragAnchor(a);
      setPolyDragging(true);
      return;
    }

    if (activeTool === 'crop_rect' || activeTool === 'shape') { 
      setIsDrawing(true); setStartPos({ x, y }); setCropRect({ x, y, width: 0, height: 0 }); 
    }
    else if (activeTool === 'crop_free') {
      // Herramienta Pluma: el clic fija un ancla (vértice). Si se mantiene pulsado y
      // se arrastra, se tira de un mango simétrico que curva el segmento que entra.
      // Un clic sin arrastrar deja el ancla degenerada (segmento recto).
      // Si el trazado estaba cerrado (Esc), un nuevo clic reinicia el trazado.
      if (freeClosed) { setFreePoints([]); setFreeClosed(false); }
      const a: BezierAnchor = { x, y, hInX: x, hInY: y, hOutX: x, hOutY: y };
      freeDragAnchorRef.current = a;
      freeDraggingRef.current = true;
      setFreeDragAnchor(a);
      setFreeDragging(true);
    }
    else if (activeTool === 'magic_wand') { let mode: 'add' | 'subtract' | 'replace' = e.ctrlKey ? 'add' : (e.altKey ? 'subtract' : 'replace'); if (mode === 'replace') setSelectionMask(null); applyMagicWand(x, y, mode); }
    else if (activeTool === 'brush_selection') { setIsDrawing(true); const mode = e.altKey ? 'subtract' : 'add'; if (!e.ctrlKey && !e.altKey) setSelectionMask(null); paintSelection(x, y, mode); }
    else if (activeTool === 'eyedropper') handleEyedropper(x, y);
    else if (activeTool === 'paint_bucket') handlePaintBucket(x, y);
    else if (activeTool === 'paint_brush') { setIsDrawing(true); handlePaintBrush(x, y); }
    else if (activeTool === 'fill_brush') { setIsDrawing(true); handleFillBrush(x, y); }
    else if (activeTool === 'smudge') { setIsDrawing(true); handleSmudgeStart(x, y); }
  };
  const handleZoomInModeToggle = () => {
    console.log('Botón de lupa clickeado!');
    const newZoomInMode = !isZoomInMode;
    setIsZoomInMode(newZoomInMode);
    setIsZoomOutMode(false); // Desactivar el otro modo
    
    if (newZoomInMode) {
      // Aumentar zoom inmediatamente al activar el modo lupa
      const immediateZoomIncrease = 50; // Aumentar 50% inmediatamente
      const newZoom = Math.min(500, zoom + immediateZoomIncrease);
      setZoom(newZoom);
      console.log('Zoom aumentado a:', newZoom);
    } else {
      setIsZooming(false);
    }
  };

  const handleZoomOutModeToggle = () => {
    console.log('Botón de lupa (reducir) clickeado!');
    const newZoomOutMode = !isZoomOutMode;
    setIsZoomOutMode(newZoomOutMode);
    setIsZoomInMode(false); // Desactivar el otro modo
    
    if (newZoomOutMode) {
      // Reducir zoom inmediatamente al activar el modo lupa
      const immediateZoomDecrease = 30; // Reducir 30% inmediatamente
      const newZoom = Math.max(10, zoom - immediateZoomDecrease);
      setZoom(newZoom);
      console.log('Zoom reducido a:', newZoom);
    } else {
      setIsZooming(false);
    }
  };

  const handleHandModeToggle = () => {
    console.log('Botón de mano clickeado!');
    const newHandMode = !isHandMode;
    setIsHandMode(newHandMode);
    
    // Desactivar otros modos
    setIsZoomInMode(false);
    setIsZoomOutMode(false);
    setIsZooming(false);
    
    if (newHandMode) {
      console.log('Modo mano activado');
    } else {
      console.log('Modo mano desactivado');
    }
  };

  const handleZoomStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isZoomMode) return;
    
    e.preventDefault();
    setIsZooming(true);
    
    // Usar el valor actual de zoom del estado
    setZoomStart({ 
      x: e.clientX, 
      y: e.clientY, 
      zoom: zoom 
    });
  };

  const handleZoomMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isZooming || !isZoomMode) return;
    
    const deltaX = e.clientX - zoomStart.x;
    const deltaY = e.clientY - zoomStart.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    let zoomChange = distance * 2; // Base de cambio
    
    if (isZoomInMode) {
      // Aumentar zoom
      const newZoom = Math.min(500, zoom + zoomChange);
      setZoom(newZoom);
    } else if (isZoomOutMode) {
      // Reducir zoom
      const newZoom = Math.max(10, zoom - zoomChange);
      setZoom(newZoom);
    }
    
    // Actualizar zoomStart para que el siguiente movimiento sea acumulativo
    setZoomStart(prev => ({
      ...prev,
      zoom: zoom
    }));
  };

  const handleZoomEnd = () => {
    if (isZooming) {
      setIsZooming(false);
      setIsZoomInMode(false);
      setIsZoomOutMode(false);
    }
  };

  useEffect(() => {
    if (activeTool !== 'none') {
      setIsZoomInMode(false);
      setIsZoomOutMode(false);
      setIsZooming(false);
    }
  }, [activeTool]);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isZoomMode && activeTool === 'none') {
      if (isZoomInMode) {
        const newZoom = Math.min(500, zoom + 30);
        setZoom(newZoom);
      } else if (isZoomOutMode) {
        const newZoom = Math.max(10, zoom - 20);
        setZoom(newZoom);
      }
      handleZoomStart(e);
      return;
    }

    if (isHandMode) {
      handleCanvasPanStart(e);
      return;
    }

    const panActivated = handleCanvasPanStart(e);
    if (panActivated) return;

    handleImageMouseDown(e);
  };

  const handleImageMouseMove = (e: React.MouseEvent) => {
    // Usar el contenedor del lienzo para las coordenadas totales
    const canvasContainer = document.getElementById('image-canvas-container');
    if (!canvasContainer) return;

    const rect = canvasContainer.getBoundingClientRect();
    const zoomScale = zoom / 100;

    const x = (e.clientX - rect.left) / zoomScale;
    const y = (e.clientY - rect.top) / zoomScale;

    // Las interacciones de capa (arrastrar/redimensionar/rotar) tienen PRIORIDAD y
    // deben funcionar aunque el pan esté auto-activo (imagen más grande que el
    // lienzo). Sin esto, `if (isPanMode) return` bloqueaba el move y la capa no se
    // movía aunque el cursor mostrara "move".
    if (rotatingOverlayId && rotationStartData) {
      const currentAngle = Math.atan2(y - rotationStartData.centerY, x - rotationStartData.centerX);
      const delta = currentAngle - rotationStartData.startAngle;
      const degrees = (delta * 180) / Math.PI;
      updateActiveTab({ overlays: overlays.map((ov: any) => {
        if (ov.id !== rotatingOverlayId) return ov;
        return { ...ov, rotation: (rotationStartData.initialRotation ?? 0) + degrees };
      }) });
      return;
    }
    if (resizingOverlayId && activeHandle) {
      updateActiveTab({ overlays: overlays.map((ov: any) => {
        if (ov.id !== resizingOverlayId) return ov;
        const dx = x - startPos.x, dy = y - startPos.y; let n = { ...ov };
        if (activeHandle === 'handle-se') { n.width = Math.max(20, ov.width + dx); n.height = Math.max(20, ov.height + dy); }
        else if (activeHandle === 'handle-sw') { n.width = Math.max(20, ov.width - dx); n.x = ov.x + dx; n.height = Math.max(20, ov.height + dy); }
        else if (activeHandle === 'handle-ne') { n.width = Math.max(20, ov.width + dx); n.height = Math.max(20, ov.height - dy); n.y = ov.y + dy; }
        else if (activeHandle === 'handle-nw') { n.width = Math.max(20, ov.width - dx); n.x = ov.x + dx; n.height = Math.max(20, ov.height - dy); n.y = ov.y + dy; }
        return n;
      })});
      setStartPos({ x, y }); return;
    }
    if (draggingOverlayId) { updateActiveTab({ overlays: overlays.map((ov: any) => ov.id === draggingOverlayId ? { ...ov, x: x - startPos.x, y: y - startPos.y } : ov) }); return; }

    // El pan automático sólo es relevante SIN herramienta activa (para desplazar el
    // lienzo). Con una herramienta de selección/pintura activa el pan ni siquiera
    // arranca (handleCanvasPanStart retorna false), así que NO debemos cortar aquí
    // o el rectángulo de selección quedaba bloqueado cuando la imagen estaba con
    // zoom (isPanMode=true) y no volvía hasta que se reducía el zoom.
    if (isPanMode && activeTool === 'none') return;

    setMousePos({ x, y });
    if (isDrawing) {
      if (activeTool === 'crop_rect' || activeTool === 'shape') setCropRect({ x: Math.min(x, startPos.x), y: Math.min(y, startPos.y), width: Math.abs(x - startPos.x), height: Math.abs(y - startPos.y) });
      else if (activeTool === 'brush_selection') paintSelection(x, y, e.altKey ? 'subtract' : 'add');
      else if (activeTool === 'paint_brush') handlePaintBrush(x, y);
      else if (activeTool === 'fill_brush') handleFillBrush(x, y);
      else if (activeTool === 'smudge') handleSmudgeMove(x, y);
    }
    // NOTA: el arrastre del mango del Lazo Bézier se gestiona con listeners de
    // window (useEffect sobre freeDragging) para que reciba eventos aunque el
    // cursor salga del contenedor.
  };

  const handleImageMouseUp = () => {
    // Las interacciones de capa deben liberarse SIEMPRE, también con el pan
    // auto-activo (si no, draggingOverlayId se quedaba colgado y la capa "no se
    // movía" en imágenes grandes).
    if (draggingOverlayId || resizingOverlayId || rotatingOverlayId) {
      setDraggingOverlayId(null);
      setResizingOverlayId(null);
      setActiveHandle(null);
      setRotatingOverlayId(null);
      setRotationStartData(null);
      saveToHistory();
      return;
    }

    // Mismo motivo que en mousemove: sólo cortar el reset de la selección cuando
    // el pan automático es relevante (sin herramienta). Si no, isDrawing quedaba
    // colgado en true cuando la imagen estaba con zoom y la selección se volvía
    // errática hasta que se reseteaba por otras acciones.
    if (isPanMode && activeTool === 'none') return;

    // NOTA: el commit del ancla del Lazo Bézier al soltar el botón se gestiona
    // con listeners de window (useEffect sobre freeDragging).

    // Dedo (smudge): commit final del trazo (el saveToHistory de abajo lo captura)
    if (activeTool === 'smudge') {
      handleSmudgeEnd();
    }

    // Si hay un canvas de pintura pendiente
    if (paintCanvasRef.current && (activeTool === 'paint_brush' || activeTool === 'fill_brush')) {
      // Si hay una capa seleccionada, pintar sobre ella
      if (selectedOverlayId) {
        // Crear una overlay temporal con la pintura (esto ya se maneja en handlePaintBrush)
        const paintOverlayId = `paint-temp-${Date.now()}`;
        const paintUrl = paintCanvasRef.current.toDataURL();
        
        // Agregar la overlay de pintura temporal
        updateActiveTab({ 
          overlays: [...overlays, { 
            id: paintOverlayId, 
            url: paintUrl, 
            x: 0, 
            y: 0, 
            width: imageRef.current!.naturalWidth, 
            height: imageRef.current!.naturalHeight, 
            opacity: 100, 
            rotation: 0 
          }]
        });
      } else {
        // Sin capa seleccionada, actualizar la imagen principal directamente
        if (imageRef.current) {
          const newImageUrl = paintCanvasRef.current.toDataURL();
          // Actualizar la imagen principal en el estado
          updateActiveTab({ 
            url: newImageUrl,
            cropRect: cropRect,
            selectionMask: selectionMask,
            freePoints: freePoints,
            polygonPath: polygonPath
          });
        }
      }
      
      // Limpiar la referencia
      paintCanvasRef.current = null;
    }
    
    setIsDrawing(false);
    setDraggingOverlayId(null);
    setResizingOverlayId(null);
    setActiveHandle(null);
    setRotatingOverlayId(null);
    setRotationStartData(null);
    saveToHistory();
  };

  // Lazo Bézier — bucle de arrastre del mango en window (mismo patrón que el
  // editor de vídeo: los listeners de window garantizan que el arrastre reciba
  // mousemove/mouseup aunque el cursor salga del contenedor o pase sobre la
  // imagen). Mueve los mangos simétricos del ancla en curso: hOut = D (cursor),
  // hIn = 2·ancla − D (espejo). La longitud del mango = grado de la curva.
  useEffect(() => {
    if (!freeDragging) return;
    const onMove = (event: MouseEvent) => {
      const container = document.getElementById('image-canvas-container');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const z = zoom / 100;
      const x = (event.clientX - rect.left) / z;
      const y = (event.clientY - rect.top) / z;
      const a = freeDragAnchorRef.current;
      if (!a) return;
      const next: BezierAnchor = { ...a, hOutX: x, hOutY: y, hInX: 2 * a.x - x, hInY: 2 * a.y - y };
      freeDragAnchorRef.current = next;
      setFreeDragAnchor(next);
    };
    const onUp = () => {
      const a = freeDragAnchorRef.current;
      if (a) {
        // Al soltar, sólo el mango de ENTRADA (hIn) conserva la curvatura arrastrada
        // (curvea el segmento que LLEGA a este vértice). El mango de SALIDA (hOut)
        // se degenera para que el siguiente segmento nazca recto salvo que se
        // vuelva a arrastrar al fijar el próximo vértice.
        const committed: BezierAnchor = { ...a, hOutX: a.x, hOutY: a.y };
        setFreePoints(prev => [...prev, committed]);
      }
      freeDragAnchorRef.current = null;
      freeDraggingRef.current = false;
      setFreeDragAnchor(null);
      setFreeDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [freeDragging, zoom]);

  // Lazo Bézier — atajos de teclado (igual que el editor de vídeo):
  //  · Esc → cerrar la selección (≥3 vértices: trazo cerrado y bloqueado;
  //    <3: se descarta). Si hay un arrastre en curso, lo cancela.
  //  · Z / Backspace → deshacer el último vértice (o cancelar el arrastre).
  useEffect(() => {
    if (activeTool !== 'crop_free') return;
    const cancelDrag = () => {
      freeDragAnchorRef.current = null;
      freeDraggingRef.current = false;
      setFreeDragAnchor(null);
      setFreeDragging(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (freeDraggingRef.current) { cancelDrag(); return; }
        setFreePoints(prev => {
          if (prev.length >= 3) { setFreeClosed(true); return prev; }
          setFreeClosed(false);
          return [];
        });
      } else if (e.key === 'Backspace' || e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (freeDraggingRef.current) { cancelDrag(); return; }
        setFreePoints(prev => prev.slice(0, -1));
        setFreeClosed(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool]);

  // Figura → Línea: bucle de arrastre del mango en window (mismo patrón que el Lazo).
  useEffect(() => {
    if (!polyDragging) return;
    const onMove = (event: MouseEvent) => {
      const container = document.getElementById('image-canvas-container');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const z = zoom / 100;
      const x = (event.clientX - rect.left) / z;
      const y = (event.clientY - rect.top) / z;
      const a = polyDragAnchorRef.current;
      if (!a) return;
      const next: BezierAnchor = { ...a, hOutX: x, hOutY: y, hInX: 2 * a.x - x, hInY: 2 * a.y - y };
      polyDragAnchorRef.current = next;
      setPolyDragAnchor(next);
    };
    const onUp = () => {
      const a = polyDragAnchorRef.current;
      if (a) {
        // Sólo el mango de ENTRADA conserva la curvatura; el de SALIDA se degenera.
        const committed: BezierAnchor = { ...a, hOutX: a.x, hOutY: a.y };
        setPolygonPath(prev => [...prev, committed]);
      }
      polyDragAnchorRef.current = null;
      polyDraggingRef.current = false;
      setPolyDragAnchor(null);
      setPolyDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [polyDragging, zoom]);

  // Figura → Línea: atajos Esc (cerrar) / Z (deshacer), igual que el Lazo.
  useEffect(() => {
    if (!(activeTool === 'shape' && shapeType === 'line')) return;
    const cancelDrag = () => {
      polyDragAnchorRef.current = null;
      polyDraggingRef.current = false;
      setPolyDragAnchor(null);
      setPolyDragging(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (polyDraggingRef.current) { cancelDrag(); return; }
        setPolygonPath(prev => {
          if (prev.length >= 3) { setPolyClosed(true); return prev; }
          setPolyClosed(false);
          return [];
        });
      } else if (e.key === 'Backspace' || e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (polyDraggingRef.current) { cancelDrag(); return; }
        setPolygonPath(prev => prev.slice(0, -1));
        setPolyClosed(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, shapeType]);

  const clampOffset = (value: number) => Math.max(-1200, Math.min(1200, value));
  const adjustCanvasMargin = (delta: number) => {
    setCanvasMargin((prev) => Math.max(0, Math.min(500, prev + delta)));
  };

  const handlePanModeToggle = () => {
    setIsPanMode((prev) => {
      if (prev) {
        setIsPanningCanvas(false);
        panStateRef.current = null;
      }
      return !prev;
    });
  };

  const handleCanvasPanStart = (e: React.MouseEvent<HTMLDivElement>) => {
    // Si hay una herramienta activa (que no sea la mano explícita), NO permitir pan automático
    if (activeTool !== 'none' && !isHandMode) return false;

    // Verificar si estamos pulsando en una capa o un tirador
    const target = e.target as HTMLElement;
    const isOverlayInteraction = target.closest('.layer-container') || 
                               target.classList.contains('layer-handle') || 
                               target.classList.contains('layer-rotate-handle');

    // Si es una interacción con una capa y no estamos en modo mano explícito, no panear
    if (isOverlayInteraction && !isHandMode) return false;

    // Verificar si la imagen con zoom es más grande que el contenedor
    const canvasElement = document.getElementById('image-canvas-container');
    const scrollContainer = canvasElement?.closest('.overflow-auto') as HTMLElement;
    
    console.log('Canvas element:', canvasElement);
    console.log('Scroll container:', scrollContainer);
    console.log('Image dimensions:', imageDimensions);
    console.log('Zoom:', zoom);
    console.log('Hand mode:', isHandMode);
    
    if (!canvasElement || !scrollContainer || imageDimensions.width === 0 || imageDimensions.height === 0) {
      console.log('Early return - no canvas, no scroll container or no dimensions');
      return false;
    }
    
    const containerRect = scrollContainer.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    
    const zoomedWidth = imageDimensions.width * (zoom / 100);
    const zoomedHeight = imageDimensions.height * (zoom / 100);
    
    console.log('Scroll container size:', containerWidth, 'x', containerHeight);
    console.log('Zoomed image size:', zoomedWidth, 'x', zoomedHeight);
    
    // Permitir pan si está en modo mano O si la imagen con zoom es más grande que el contenedor
    const shouldAllowPan = isHandMode || zoomedWidth > containerWidth || zoomedHeight > containerHeight;
    console.log('Should allow pan:', shouldAllowPan);
    
    if (!shouldAllowPan) return false;
    
    e.preventDefault();
    setIsPanningCanvas(true);
    
    // Guardar la posición inicial del scroll
    panStateRef.current = { 
      startX: e.clientX, 
      startY: e.clientY, 
      offsetX: scrollContainer.scrollLeft || 0, 
      offsetY: scrollContainer.scrollTop || 0 
    };
    
    return true;
  };

  useEffect(() => {
    if (!isPanningCanvas) return;
    const handleWindowMove = (event: MouseEvent) => {
      if (!panStateRef.current) return;
      const dx = event.clientX - panStateRef.current.startX;
      const dy = event.clientY - panStateRef.current.startY;
      
      // Encontrar el contenedor de scroll
      const scrollContainer = document.querySelector('.overflow-auto') as HTMLElement;
      if (scrollContainer) {
        scrollContainer.scrollLeft = panStateRef.current.offsetX - dx;
        scrollContainer.scrollTop = panStateRef.current.offsetY - dy;
      }
    };
    const handleWindowUp = () => {
      setIsPanningCanvas(false);
      panStateRef.current = null;
    };
    window.addEventListener('mousemove', handleWindowMove);
    window.addEventListener('mouseup', handleWindowUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMove);
      window.removeEventListener('mouseup', handleWindowUp);
    };
  }, [isPanningCanvas]);

  useEffect(() => {
    setCameraOffset({ x: 0, y: 0 });
    panStateRef.current = null;
    setImageDimensions({ width: 0, height: 0 });
  }, [activeTabId]);

  const [isPlaceholderMode, setIsPlaceholderMode] = useState(true);
  useEffect(() => {
    setIsPlaceholderMode(imageDimensions.width === 0 || imageDimensions.height === 0);
  }, [imageDimensions.width, imageDimensions.height]);

  useEffect(() => {
    setCanvasMargin(isPlaceholderMode ? 20 : 0);
  }, [isPlaceholderMode]);

  const deleteSelection = async () => {
    if (!imageRef.current || !selectionMask) return;
    const img = imageRef.current; const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
    const mImg = new Image(); mImg.src = selectionMask; await new Promise(r => mImg.onload = r);
    ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(mImg, 0, 0, canvas.width, canvas.height);
    updateActiveTab({ url: canvas.toDataURL() }); setSelectionMask(null); saveToHistory();
  };

  // Borra (recorta) de la imagen los píxeles de la selección ACTIVA, sea del tipo
  // que sea (varita/pincel=máscara, rectángulo, círculo, lazo o forma-línea). A
  // diferencia de deleteSelection (sólo máscara y sin recortar márgenes), ésta
  // construye una máscara binaria en el sistema de coords del canvas completo
  // (donde viven las coords de selección), la binariza (la varita pinta con alpha
  // 180 => destination-out sólo borraría ~70%) y la aplica recortando los márgenes
  // para mapear 1:1 a la imagen natural. Deja la selección vacía y guarda historial.
  const eraseSelection = async () => {
    if (!imageRef.current) return;
    const img = imageRef.current;
    const W = img.naturalWidth, H = img.naturalHeight;
    const cm = canvasMargin;
    // 1. Máscara de borrado en coords del canvas completo (las de las selecciones).
    const mask = document.createElement('canvas');
    mask.width = computedCanvasWidth; mask.height = computedCanvasHeight;
    const mctx = mask.getContext('2d')!;
    let drew = false;
    let fromMask = false;
    if (selectionMask) {
      const mImg = new Image(); mImg.src = selectionMask; await new Promise(r => mImg.onload = r);
      mctx.drawImage(mImg, 0, 0, mask.width, mask.height);
      drew = true; fromMask = true;
    } else if (activeTool === 'crop_free' && freeClosed && freePoints.length > 1) {
      mctx.fillStyle = '#fff';
      mctx.beginPath(); traceBezierClosed(mctx, freePoints); mctx.fill();
      drew = true;
    } else if (activeTool === 'shape' && shapeType === 'line' && polyClosed && polygonPath.length > 2) {
      mctx.fillStyle = '#fff';
      mctx.beginPath(); traceBezierClosed(mctx, polygonPath); mctx.fill();
      drew = true;
    } else if (cropRect.width > 0 && cropRect.height > 0 && (activeTool === 'crop_rect' || activeTool === 'shape')) {
      mctx.fillStyle = '#fff';
      if (activeTool === 'shape' && shapeType === 'circle') {
        mctx.beginPath();
        mctx.ellipse(cropRect.x + cropRect.width / 2, cropRect.y + cropRect.height / 2, cropRect.width / 2, cropRect.height / 2, 0, 0, Math.PI * 2);
        mctx.fill();
      } else {
        mctx.fillRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
      }
      drew = true;
    }
    if (!drew) return;
    // 2. Binarizar alpha de la máscara de varita/pincel para borrar del todo.
    if (fromMask) {
      const bd = mctx.getImageData(0, 0, mask.width, mask.height);
      for (let i = 3; i < bd.data.length; i += 4) bd.data[i] = bd.data[i] > 10 ? 255 : 0;
      mctx.putImageData(bd, 0, 0);
    }
    // 3. destination-out sobre la imagen natural, recortando los márgenes del mask.
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const octx = out.getContext('2d')!;
    octx.drawImage(img, 0, 0);
    octx.globalCompositeOperation = 'destination-out';
    octx.drawImage(mask, cm, cm, W, H, 0, 0, W, H);
    // 4. Guardar y vaciar la selección (mantiene la herramienta activa).
    updateActiveTab({ url: out.toDataURL() });
    setSelectionMask(null);
    setCropRect({ x: 0, y: 0, width: 0, height: 0 });
    setPolygonPath([]); setPolyDragging(false); setPolyDragAnchor(null); setPolyClosed(false);
    setFreePoints([]); setFreeDragging(false); setFreeDragAnchor(null);
    freeDraggingRef.current = false; freeDragAnchorRef.current = null;
    setFreeClosed(false);
    saveToHistory();
  };

  const invertSelection = async () => {
    if (!selectionMask || !imageRef.current) return;
    const img = imageRef.current; const mImg = new Image(); mImg.src = selectionMask; await new Promise(r => mImg.onload = r);
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'rgba(59, 130, 246, 0.7)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(mImg, 0, 0); setSelectionMask(canvas.toDataURL());
  };

  const selectShapeArea = async () => {
    if (!imageRef.current) return;
    const isPolygon = activeTool === 'shape' && shapeType === 'line';
    if (!isPolygon && cropRect.width < 1) return;
    if (isPolygon && polygonPath.length < 3) return;

    const canvas = document.createElement('canvas'); 
    // Usar el tamaño total del lienzo extendido
    canvas.width = computedCanvasWidth; 
    canvas.height = computedCanvasHeight;
    const ctx = canvas.getContext('2d')!; 
    
    ctx.fillStyle = 'rgba(59, 130, 246, 0.7)';
    if (isPolygon) {
      ctx.beginPath();
      // Las coordenadas ya están en el sistema del canvas total
      traceBezierClosed(ctx, polygonPath);
      ctx.fill();
    } else if (shapeType === 'rectangle') {
      ctx.fillRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
    } else if (shapeType === 'circle') {
      ctx.beginPath();
      ctx.ellipse(
        cropRect.x + cropRect.width / 2, 
        cropRect.y + cropRect.height / 2, 
        cropRect.width / 2, 
        cropRect.height / 2, 
        0, 0, Math.PI * 2
      );
      ctx.fill();
    }
    setSelectionMask(canvas.toDataURL());
  };

  const performCropOrCopy = async (action: 'crop' | 'copy' | 'layer') => {
    if (!imageRef.current) return;
    const img = imageRef.current;
    const baseScaleX = img.naturalWidth / img.clientWidth;
    const baseScaleY = img.naturalHeight / img.clientHeight;
    const createCompositeCanvas = async () => {
      const composite = document.createElement('canvas');
      // El canvas compuesto ahora incluye los márgenes
      composite.width = computedCanvasWidth;
      composite.height = computedCanvasHeight;
      const compCtx = composite.getContext('2d')!;
      
      // Dibujar la imagen base desplazada por el margen
      compCtx.drawImage(img, canvasMargin, canvasMargin);
      
      for (const overlay of overlays) {
        const overlayImg = await new Promise<HTMLImageElement>((resolve) => {
          const element = new Image();
          const ovUrl = resolveImageUrl(overlay.url);
          // media:// y http devuelven Access-Control-Allow-Origin: *; data:/blob:/mismo-origen no se ven afectados.
          element.crossOrigin = 'anonymous';
          element.onload = () => resolve(element);
          element.onerror = () => resolve(element);
          element.src = ovUrl;
        });
        if (!overlayImg.naturalWidth || !overlayImg.naturalHeight) continue;
        
        // Las coordenadas de las overlays ya son relativas al contenedor (incluyendo márgenes)
        compCtx.save();
        const centerX = overlay.x + overlay.width / 2;
        const centerY = overlay.y + overlay.height / 2;
        compCtx.translate(centerX, centerY);
        compCtx.rotate(((overlay.rotation ?? 0) * Math.PI) / 180);
        compCtx.drawImage(overlayImg, -overlay.width / 2, -overlay.height / 2, overlay.width, overlay.height);
        compCtx.restore();
      }
      return composite;
    };
    const compositeCanvas = await createCompositeCanvas();
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d')!;
    let tx = 0, ty = 0, tw = 0, th = 0;
    const isPolygon = activeTool === 'shape' && shapeType === 'line';
    
    if (activeTool === 'crop_rect' || activeTool === 'shape') { 
      if (isPolygon) {
        if (polygonPath.length < 3) return;
        const minX = Math.min(...polygonPath.map(p => p.x)), minY = Math.min(...polygonPath.map(p => p.y));
        const maxX = Math.max(...polygonPath.map(p => p.x)), maxY = Math.max(...polygonPath.map(p => p.y));
        tx = minX; ty = minY; tw = maxX - minX; th = maxY - minY;
      } else {
        tx = cropRect.x; ty = cropRect.y; tw = cropRect.width; th = cropRect.height; 
      }
    }
    else if (activeTool === 'crop_free') { tx = Math.min(...freePoints.map(p => p.x)); ty = Math.min(...freePoints.map(p => p.y)); tw = Math.max(...freePoints.map(p => p.x)) - tx; th = Math.max(...freePoints.map(p => p.y)) - ty; }
    else if ((activeTool === 'magic_wand' || activeTool === 'brush_selection') && selectionMask) {
      const mImg = new Image(); mImg.src = selectionMask; await new Promise(r => mImg.onload = r);
      const temp = document.createElement('canvas'); 
      temp.width = computedCanvasWidth; 
      temp.height = computedCanvasHeight;
      const tCtx = temp.getContext('2d')!; 
      tCtx.drawImage(mImg, 0, 0, mImg.width, mImg.height, 0, 0, temp.width, temp.height);
      const mData = tCtx.getImageData(0, 0, temp.width, temp.height).data;
      let minX = temp.width, minY = temp.height, maxX = 0, maxY = 0, has = false;
      for (let i = 3; i < mData.length; i += 4) { 
        if (mData[i] > 0) { 
          const px = (i/4) % temp.width, py = Math.floor((i/4) / temp.width); 
          minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); 
          has = true; 
        } 
      }
      if (!has) return; 
      tx = minX; ty = minY; tw = (maxX - minX); th = (maxY - minY);
    }
    
    if (tw < 1 || th < 1) return;
    canvas.width = tw; canvas.height = th;
    
    if (activeTool === 'crop_free') {
      // Trazo Bézier: el segmento A→B usa los mangos hOut de A y hIn de B.
      ctx.beginPath();
      const n = freePoints.length;
      ctx.moveTo(freePoints[0].x - tx, freePoints[0].y - ty);
      for (let i = 0; i < n; i++) {
        const a = freePoints[i], b = freePoints[(i + 1) % n];
        ctx.bezierCurveTo(a.hOutX - tx, a.hOutY - ty, b.hInX - tx, b.hInY - ty, b.x - tx, b.y - ty);
      }
      ctx.closePath(); ctx.clip();
    }
    else if (isPolygon) {
      ctx.beginPath();
      traceBezierClosed(ctx, polygonPath, -tx, -ty);
      ctx.clip();
    }
    else if (activeTool === 'shape' && shapeType === 'circle') {
      ctx.beginPath(); ctx.ellipse(canvas.width/2, canvas.height/2, canvas.width/2, canvas.height/2, 0, 0, Math.PI * 2); ctx.clip();
    }
    else if ((activeTool === 'magic_wand' || activeTool === 'brush_selection') && selectionMask) { 
      const mImg = new Image(); mImg.src = selectionMask; await new Promise(r => mImg.onload = r); 
      ctx.drawImage(mImg, tx, ty, tw, th, 0, 0, tw, th); 
      ctx.globalCompositeOperation = 'source-in'; 
    }
    
    ctx.drawImage(compositeCanvas, tx, ty, tw, th, 0, 0, tw, th);
    
    if (action === 'copy') {
      const selectionUrl = canvas.toDataURL();
      setCopiedSelection({ url: selectionUrl, width: tw, height: th });
      // Portapapeles vía Electron (sin permisos); fallback a navigator.clipboard.
      const ea = (window as any).electronAPI;
      let copiedToSystem = false;
      if (ea?.clipboardWriteImage) {
        try {
          const res = await ea.clipboardWriteImage(selectionUrl);
          if (res?.ok) copiedToSystem = true;
        } catch { /* fallback */ }
      }
      if (!copiedToSystem) {
        try {
          const blob = await new Promise<Blob | null>(r => canvas.toBlob(r));
          if (blob) await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
          copiedToSystem = true;
        } catch (e) {
          if (e instanceof Error && e.name === 'NotAllowedError') alert(t('editorHTML.image.toolbar.clipboardDenied'));
          else alert(t('editorHTML.image.toolbar.clipboardFail'));
        }
      }
      if (copiedToSystem) alert('Copiado!');
    }
    // Recortar y Crear capa ambas crean una capa (objeto) con la parte
    // seleccionada. La diferencia: Recortar ADEMÁS corta la selección de la base
    // (deja un agujero, conserva el resto de la imagen) — "elimina el que había";
    // Crear capa deja la base intacta — "sigue dejando la que estaba".
    // Antes Recortar reemplazaba toda la imagen por la selección (perdía el
    // resto), que era el comportamiento que NO se quería.
    else if (action === 'crop' || action === 'layer') {
      const newId = `layer-${Date.now()}`;
      const layerUrl = canvas.toDataURL();
      const newOverlays = [...overlays, {
        id: newId, url: layerUrl, x: tx, y: ty, width: tw, height: th,
        opacity: 100, rotation: 0,
        editState: { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0, opacity: 100, intensity: 0 }
      }];

      if (action === 'crop') {
        // Cortar la selección de la imagen base (destination-out). Se construye
        // una máscara en coords del canvas completo (con margen) y se aplica al
        // canvas natural recortando el margen, igual que eraseSelection.
        const mainImg = imageRef.current;
        if (mainImg) {
          const W = mainImg.naturalWidth, H = mainImg.naturalHeight;
          const mask = document.createElement('canvas');
          mask.width = computedCanvasWidth; mask.height = computedCanvasHeight;
          const mctx = mask.getContext('2d')!;
          mctx.fillStyle = '#fff';
          let fromMask = false;
          if (activeTool === 'crop_free' && freePoints.length > 1) {
            mctx.beginPath(); traceBezierClosed(mctx, freePoints); mctx.fill();
          } else if (isPolygon) {
            mctx.beginPath(); traceBezierClosed(mctx, polygonPath); mctx.fill();
          } else if (activeTool === 'shape' && shapeType === 'circle') {
            mctx.beginPath();
            mctx.ellipse(cropRect.x + cropRect.width / 2, cropRect.y + cropRect.height / 2, cropRect.width / 2, cropRect.height / 2, 0, 0, Math.PI * 2);
            mctx.fill();
          } else if ((activeTool === 'crop_rect' || activeTool === 'shape') && cropRect.width > 0 && cropRect.height > 0) {
            mctx.fillRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
          } else if ((activeTool === 'magic_wand' || activeTool === 'brush_selection') && selectionMask) {
            const mImg = new Image(); mImg.src = selectionMask; await new Promise(r => mImg.onload = r);
            mctx.drawImage(mImg, 0, 0); fromMask = true;
          }
          if (fromMask) {
            // La varita/pincel pintan con alpha parcial → binarizar para un corte
            // limpio (igual que eraseSelection).
            const bd = mctx.getImageData(0, 0, mask.width, mask.height);
            for (let i = 3; i < bd.data.length; i += 4) bd.data[i] = bd.data[i] > 10 ? 255 : 0;
            mctx.putImageData(bd, 0, 0);
          }
          const out = document.createElement('canvas'); out.width = W; out.height = H;
          const octx = out.getContext('2d')!;
          octx.drawImage(mainImg, 0, 0);
          octx.globalCompositeOperation = 'destination-out';
          octx.drawImage(mask, canvasMargin, canvasMargin, W, H, 0, 0, W, H);
          updateActiveTab({ url: out.toDataURL(), overlays: newOverlays });
        } else {
          updateActiveTab({ overlays: newOverlays });
        }
      } else {
        updateActiveTab({ overlays: newOverlays });
      }

      setSelectedOverlayId(newId);
      setActiveTool('none');
      setFreePoints([]); setFreeDragging(false); setFreeDragAnchor(null); freeDraggingRef.current = false; freeDragAnchorRef.current = null; setFreeClosed(false); setPolygonPath([]); setPolyDragging(false); setPolyDragAnchor(null); setPolyClosed(false);
      setCropRect({x:0,y:0,width:0,height:0});
      setSelectionMask(null);
      saveToHistory();
    }
  };

  const moveOverlay = (id: string, direction: 'up' | 'down') => {
    const idx = overlays.findIndex((o: any) => o.id === id);
    if (idx === -1) return;
    const newIdx = direction === 'up' ? idx + 1 : idx - 1;
    if (newIdx < 0 || newIdx >= overlays.length) return;
    const next = [...overlays];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    updateActiveTab({ overlays: next });
    saveToHistory();
  };

  const mergeSelectedOverlayIntoBase = useCallback(async () => {
    if (!selectedOverlayId || !imageRef.current) return;
    const overlay = overlays.find((o: any) => o.id === selectedOverlayId);
    if (!overlay) return;
    const img = imageRef.current;
    
    const canvas = document.createElement('canvas');
    // El canvas de trabajo ahora incluye los márgenes
    canvas.width = computedCanvasWidth;
    canvas.height = computedCanvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Dibujar la imagen base aplicando su rotación/volteo (rotation/flipH/flipV
    // de la pestaña). Sin esto el merge revertía el Rotar/Voltear: la base se
    // dibujaba en crudo y la transformación sólo era un preview CSS que se perdía.
    const bt = baseTransformRef.current;
    drawBaseWithTransform(ctx, img, img.naturalWidth, img.naturalHeight, canvasMargin, bt.rotation, bt.flipH, bt.flipV);

    // Dibujar el resto de capas en orden, EXCEPTO la seleccionada
    for (const other of overlays) {
      if (other.id === selectedOverlayId) continue;
      const otherImg = await new Promise<HTMLImageElement>((resolve) => {
        const element = new Image();
        const ovUrl = resolveImageUrl(other.url);
        if (ovUrl.startsWith('http')) element.crossOrigin = 'anonymous';
        element.onload = () => resolve(element);
        element.onerror = () => resolve(element);
        element.src = ovUrl;
      });
      if (!otherImg.naturalWidth || !otherImg.naturalHeight) continue;
      const otherFilter = getFilterStyle(other.editState || {}, `zint-${other.id}`);
      ctx.save();
      const combinedOpacity = ((other.opacity ?? 100) / 100) * (otherFilter.opacity ?? 1);
      ctx.globalAlpha = combinedOpacity;
      ctx.filter = otherFilter.filter;
      const centerX = other.x + other.width / 2;
      const centerY = other.y + other.height / 2;
      ctx.translate(centerX, centerY);
      ctx.rotate(((other.rotation ?? 0) * Math.PI) / 180);
      ctx.drawImage(otherImg, -other.width / 2, -other.height / 2, other.width, other.height);
      ctx.restore();
      ctx.filter = 'none';
    }
    
    // Ahora dibujar la capa seleccionada en su posición correcta
    const overlayImg = await new Promise<HTMLImageElement>((resolve) => {
      const element = new Image();
      const ovUrl = resolveImageUrl(overlay.url);
      if (ovUrl.startsWith('http')) element.crossOrigin = 'anonymous';
      element.onload = () => resolve(element);
      element.onerror = () => resolve(element);
      element.src = ovUrl;
    });
    if (overlayImg.naturalWidth && overlayImg.naturalHeight) {
      const overlayFilter = getFilterStyle(overlay.editState || {}, `zint-${overlay.id}`);
      ctx.save();
      const combinedOpacity = ((overlay.opacity ?? 100) / 100) * (overlayFilter.opacity ?? 1);
      ctx.globalAlpha = combinedOpacity;
      ctx.filter = overlayFilter.filter;
      const centerX = overlay.x + overlay.width / 2;
      const centerY = overlay.y + overlay.height / 2;
      ctx.translate(centerX, centerY);
      ctx.rotate(((overlay.rotation ?? 0) * Math.PI) / 180);
      ctx.drawImage(overlayImg, -overlay.width / 2, -overlay.height / 2, overlay.width, overlay.height);
      ctx.restore();
      ctx.filter = 'none';
    }
    
    const mergedUrl = canvas.toDataURL();
    updateActiveTab({
      url: mergedUrl,
      overlays: overlays.filter((o: any) => o.id !== selectedOverlayId),
      // La rotación/volteo de la base ya está horneada en los píxeles del merge;
      // la reseteamos para que el preview no la aplique dos veces por encima.
      rotation: 0,
      flipH: false,
      flipV: false
    });
    
    // Si había margen, ahora ha sido absorbido por la nueva imagen
    if (canvasMargin > 0) {
      setCanvasMargin(0);
    }
    
    setSelectedOverlayId(null);
    saveToHistory();
  }, [activeTabId, canvasMargin, computedCanvasHeight, computedCanvasWidth, overlays, resolveImageUrl, saveToHistory, selectedOverlayId, updateActiveTab, getFilterStyle]);

  // Coloca un overlay pegado CENTRADO sobre la imagen actual y escalado para caber
  // (sin pasar de su tamaño real). Antes se pegaba en (50,50) con el tamaño en píxeles
  // del canvas origen (incluidos márgenes transparentes): en otra pestaña desbordaba y
  // el centro visible era el margen transparente → parecía "medio transparente" aunque
  // la opacidad estuviera al 100%.
  const computePastePlacement = (natW: number, natH: number) => {
    const iw = imageDimensions.width || 800;
    const ih = imageDimensions.height || 600;
    const maxW = iw * 0.8;
    const maxH = ih * 0.8;
    const scale = Math.min(maxW / natW, maxH / natH, 1);
    const w = natW * scale;
    const h = natH * scale;
    const x = canvasMargin + (iw - w) / 2;
    const y = canvasMargin + (ih - h) / 2;
    return { x, y, width: w, height: h };
  };
  const defaultPasteEditState = { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0, opacity: 100, intensity: 0 };

  const pasteCopiedSelectionAsOverlay = useCallback(() => {
    if (!copiedSelection) return;
    const newId = `layer-${Date.now()}`;
    const place = computePastePlacement(copiedSelection.width, copiedSelection.height);
    updateActiveTab({
      overlays: [...overlays, {
        id: newId,
        url: copiedSelection.url,
        ...place,
        opacity: 100,
        rotation: 0,
        editState: { ...defaultPasteEditState }
      }]
    });
    setSelectedOverlayId(newId);
    saveToHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copiedSelection, overlays, saveToHistory, setSelectedOverlayId, updateActiveTab, imageDimensions, canvasMargin]);

  const handlePaste = async () => {
    const ea = (window as any).electronAPI;
    // 1) Portapapeles vía Electron (sin permisos).
    if (ea?.clipboardReadImage) {
      try {
        const res = await ea.clipboardReadImage();
        if (res?.error) { /* cae al fallback */ }
        else if (res?.empty) { alert('El portapapeles no tiene una imagen.'); return; }
        else if (res?.dataUrl) {
          const mImg = new Image();
          await new Promise<void>((resolve) => { mImg.onload = () => resolve(); mImg.onerror = () => resolve(); mImg.src = res.dataUrl; });
          const w = mImg.naturalWidth || 300, h = mImg.naturalHeight || 300;
          const newId = `layer-${Date.now()}`;
          const place = computePastePlacement(w, h);
          updateActiveTab({ overlays: [...overlays, { id: newId, url: res.dataUrl, ...place, opacity: 100, rotation: 0, editState: { ...defaultPasteEditState } }] });
          setSelectedOverlayId(newId);
          saveToHistory();
          return;
        }
      } catch { /* cae al fallback */ }
    }
    // 2) Fallback: navigator.clipboard (web).
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (type) {
          const blob = await item.getType(type);
          const mImg = new Image();
          await new Promise<void>((resolve) => { mImg.onload = () => resolve(); mImg.onerror = () => resolve(); mImg.src = URL.createObjectURL(blob); });
          const w = mImg.naturalWidth || 300, h = mImg.naturalHeight || 300;
          const newId = `layer-${Date.now()}`;
          const place = computePastePlacement(w, h);
          updateActiveTab({ overlays: [...overlays, { id: newId, url: URL.createObjectURL(blob), ...place, opacity: 100, rotation: 0, editState: { ...defaultPasteEditState } }] });
          setSelectedOverlayId(newId);
          saveToHistory();
          return;
        }
      }
      alert('El portapapeles no tiene una imagen.');
    } catch (e) {
      const msg = e instanceof Error && e.name === 'NotAllowedError'
        ? t('editorHTML.image.toolbar.clipboardReadDenied')
        : t('editorHTML.image.toolbar.pasteImageFail');
      alert(msg);
    }
  };

  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      // 1) Archivo pegado (ej. desde el explorador).
      const file = e.clipboardData?.files[0];
      if (file?.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        const mImg = new Image();
        mImg.onload = () => {
          const w = mImg.naturalWidth || 300, h = mImg.naturalHeight || 300;
          const newId = `layer-${Date.now()}`;
          const place = computePastePlacement(w, h);
          updateActiveTab({ overlays: [...overlays, { id: newId, url, ...place, opacity: 100, rotation: 0, editState: { ...defaultPasteEditState } }] });
          setSelectedOverlayId(newId);
          saveToHistory();
        };
        mImg.src = url;
        return;
      }
      // 2) Imagen del portapapeles (ej. captura de pantalla).
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it && it.type.startsWith('image/')) {
            const blob = it.getAsFile();
            if (blob) {
              const url = URL.createObjectURL(blob);
              const mImg = new Image();
              mImg.onload = () => {
                const w = mImg.naturalWidth || 300, h = mImg.naturalHeight || 300;
                const newId = `layer-${Date.now()}`;
                const place = computePastePlacement(w, h);
                updateActiveTab({ overlays: [...overlays, { id: newId, url, ...place, opacity: 100, rotation: 0, editState: { ...defaultPasteEditState } }] });
                setSelectedOverlayId(newId);
                saveToHistory();
              };
              mImg.src = url;
              return;
            }
          }
        }
      }
    };
    window.addEventListener('paste', handleGlobalPaste); return () => window.removeEventListener('paste', handleGlobalPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays, saveToHistory, imageDimensions, canvasMargin]);

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [savedProjects, setSavedProjects] = useState<any[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [loadType, setLoadType] = useState<'proyectos' | 'archivos' | 'local'>('archivos');
  const [pbLoadStep, setPbLoadStep] = useState<'collection' | 'record' | 'file' | 'local'>('collection');
  const [pbCollections, setPbCollections] = useState<{ id: string; name: string }[]>([]);
  const [selectedPbCollection, setSelectedPbCollection] = useState<string | null>(null);
  const [pbRecords, setPbRecords] = useState<{ recordId: string; recordName: string; files: { url: string; fileName: string }[] }[]>([]);
  const [selectedPbRecordFiles, setSelectedPbRecordFiles] = useState<{ url: string; fileName: string }[] | null>(null);
  const [localFolderFiles, setLocalFolderFiles] = useState<any[]>([]);
  const [pbLoading, setPbLoading] = useState(false);
  const [fileNotAllowedMessage, setFileNotAllowedMessage] = useState<string | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isNewCanvasModalOpen, setIsNewCanvasModalOpen] = useState(false);
  const [newCanvasWidth, setNewCanvasWidth] = useState(1920);
  const [newCanvasHeight, setNewCanvasHeight] = useState(1080);
  const [isExporting, setIsExporting] = useState(false);
  const [exportConfig, setExportConfig] = useState({ title: '', format: 'image/png' });

  const fileCache = useRef<Map<string, File>>(new Map());
  const paintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Dedo (smudge): canvas de trabajo persistente durante el trazo, buffer del
  // color que "lleva el dedo" y última posición para interpolar pasos.
  const smudgeWorkRef = useRef<HTMLCanvasElement | null>(null);
  const smudgeBufferRef = useRef<HTMLCanvasElement | null>(null);
  const smudgeLastPosRef = useRef<{ x: number; y: number } | null>(null);
  const exportTitleRef = useRef<HTMLInputElement | null>(null);

  const handleFilesSelected = (files: File[]) => { 
    if (files.length > 0) { 
      const file = files[0];
      const url = URL.createObjectURL(file);
      fileCache.current.set(url, file);
      updateActiveTab({ url: url }); 
      setIsUploaderOpen(false); 
      resetFilters(); 
    } 
  };

  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
  const isImageFileAllowed = (fileName: string) => IMAGE_EXT.includes((fileName.split('.').pop() || '').toLowerCase());

  const openLocalImageFolder = async () => {
    setPbLoading(true);
    setLoadType('local');
    setPbLoadStep('local');
    setLocalFolderFiles([]);
    setIsUploaderOpen(true);

    try {
      const paths = await getLocalPaths();
      const imageFolder = paths?.imagen;

      if (!imageFolder) {
        alert("t('editorHTML.image.toolbar.noImagesFolder')");
        setPbLoading(false);
        setIsUploaderOpen(false);
        return;
      }

      const files = await listDirectory(imageFolder, 'imagen');
      setLocalFolderFiles(files || []);
    } catch (error: any) {
      console.error("Error al cargar carpeta local:", error);
      alert(error.message || "Error al acceder a los archivos locales.");
      setIsUploaderOpen(false);
    } finally {
      setPbLoading(false);
    }
  };

  const openLocalProjectsFolder = async () => {
    setPbLoading(true);
    setLoadType('proyectos');
    setSavedProjects([]);
    setIsLoadModalOpen(true);
    
    try {
      const userId = pb.authStore.model?.id;
      if (!userId) {
        alert("t('editorHTML.image.toolbar.needAuth')");
        setPbLoading(false);
        setIsLoadModalOpen(false);
        return;
      }

      const paths = await getLocalPaths();
      const projectsFolder = paths?.proyectos_imagen;

      if (!projectsFolder) {
        alert("t('editorHTML.image.toolbar.noImageProjectsFolder')");
        setPbLoading(false);
        setIsLoadModalOpen(false);
        return;
      }

      const files = await listDirectory(projectsFolder, 'proyectos');
      const projects = (files || []).map((f: any) => ({
        id: f.path,
        titulo: f.name || f.fileName,
        path: f.path,
        isDirectory: f.isDirectory,
        isLocal: true
      }));
      setSavedProjects(projects);
    } catch (error: any) {
      console.error("Error al cargar proyectos locales:", error);
      alert(error.message || "Error al acceder a los proyectos locales.");
      setIsLoadModalOpen(false);
    } finally {
      setPbLoading(false);
    }
  };

  const handleOpenLocalProject = async (p: any) => {
    setPbLoading(true);
    try {
      let projectPath = p.path;
      if (p.isDirectory) {
        const files = await listDirectory(p.path, 'proyectos');
        const zeusFile = files.find((f: any) => f.name.endsWith('.zeus'));
        if (zeusFile) projectPath = zeusFile.path;
        else throw new Error("t('editorHTML.image.toolbar.noZeusFile')");
      }

      const projectData = await readProject(projectPath);
      if (!projectData) throw new Error("t('editorHTML.image.toolbar.readProjectFail')");

      const data = typeof projectData.file === 'string' ? JSON.parse(projectData.file) : projectData.file;
      if (data.tabs) {
        setTabs(data.tabs);
        setActiveTabId(data.activeTabId);
        setIsLoadModalOpen(false);
      } else if (projectData.editState) {
        updateActiveTab({ editState: projectData.editState, url: projectData.imageUrl || imageUrl });
        setIsLoadModalOpen(false);
      } else {
        throw new Error("t('editorHTML.image.toolbar.badProjectFormat')");
      }
    } catch (e: any) {
      alert(e.message || "t('editorHTML.image.toolbar.openProjectFail')");
    } finally {
      setPbLoading(false);
    }
  };

  const openLoadFromPocketBase = () => {
    setLoadType('archivos');
    setFileNotAllowedMessage(null);
    setPbLoadStep('collection');
    setSelectedPbCollection(null);
    setPbRecords([]);
    setSelectedPbRecordFiles(null);
    setPbLoading(true);
    setIsUploaderOpen(true);
    const fallback = [
      { id: 'imagen', name: 'imagen' },
      { id: 'video', name: 'video' },
      { id: 'documentos', name: 'documentos' },
    ];
    fetch('/api/collections')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(t('editorHTML.image.toolbar.apiUnavailable')))))
      .then((data) => {
        const items = Array.isArray(data?.items) ? data.items : [];
        if (items.length > 0) {
          setPbCollections(items.map((c: any) => ({ id: c.id || c.name, name: c.name })));
          return;
        }
        return Promise.reject(new Error('Sin colecciones'));
      })
      .catch(async () => {
        try {
          if (pb.authStore.isValid) {
            const all = await pb.collections.getFullList();
            const filtered = all.filter(
              (c: { type?: string; name?: string }) =>
                c.type === 'base' && !['users', 'proyectos', 'notificaciones', 'logs'].includes(c.name || '')
            );
            if (filtered.length > 0) {
              setPbCollections(filtered.map((c: { id: string; name: string }) => ({ id: c.id || c.name, name: c.name })));
              return;
            }
          }
        } catch {
          /* sigue al fallback */
        }
        setPbCollections(fallback);
      })
      .finally(() => setPbLoading(false));
  };

  const fetchPbRecordsForCollection = (collectionName: string) => {
    setPbLoading(true);
    setSelectedPbCollection(collectionName);
    pb.collection(collectionName)
      .getFullList({ sort: '-created' })
      .then((records: any[]) => {
        const out: { recordId: string; recordName: string; files: { url: string; fileName: string }[] }[] = [];
        for (const record of records) {
          const fileFields = Object.keys(record)
            .filter((k) => {
              const v = record[k];
              if (!v) return false;
              if (typeof v === 'string' && v.includes('.')) return true;
              if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') return true;
              return false;
            })
            .filter((k) => !['id', 'collectionId', 'collectionName', 'created', 'updated'].includes(k));
          const files: { url: string; fileName: string }[] = [];
          for (const fieldName of fileFields) {
            const fileValue = record[fieldName];
            const list = Array.isArray(fileValue) ? fileValue : [fileValue];
            for (const file of list) {
              if (typeof file !== 'string' || !file.includes('.')) continue;
              const ext = (file.split('.').pop() || '').toLowerCase();
              if (!IMAGE_EXT.includes(ext)) continue;
              files.push({ url: pb.files.getURL(record, file), fileName: file });
            }
          }
          if (files.length > 0) {
            out.push({
              recordId: record.id,
              recordName: record.titulo || record.name || record.id,
              files,
            });
          }
        }
        setPbRecords(out);
        setPbLoadStep('record');
      })
      .catch((e) => console.error(e))
      .finally(() => setPbLoading(false));
  };

  const selectPbRecordForFiles = (record: { recordId: string; recordName: string; files: { url: string; fileName: string }[] }) => {
    setSelectedPbRecordFiles(record.files);
    setPbLoadStep('file');
  };

  const addOneImageFromPb = (item: { url: string; fileName: string }) => {
    if (!isImageFileAllowed(item.fileName)) {
      setFileNotAllowedMessage('Archivo no permitido');
      return;
    }
    setFileNotAllowedMessage(null);
    const fileUrl = resolveImageUrl(item.url);
    updateActiveTab({ url: fileUrl });
    resetFilters();
    setIsUploaderOpen(false);
    setPbLoadStep('collection');
    setSelectedPbRecordFiles(null);
    setSelectedPbCollection(null);
  };

  const imageRef = useRef<HTMLImageElement>(null);
  const _fStyle = getFilterStyle(editState, 'zint-base');
  const filterStyle = { filter: _fStyle.filter, opacity: _fStyle.opacity, transform: `rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})` };
  // Recorte de los ajustes a la selección terminada (null => a toda la imagen).
  const adjustClip = selectionClipStyle(activeSelectionForAdjust, canvasMargin, imageDimensions);

  // --- Puente con el chat: permitir que el modelo "vea" la imagen actual ---
  const aiBridge = useAIEditorBridgeOptional();
  // Imagen compuesta (base + overlays + filtros) escalada, lista para enviar al modelo.
  const visionImageRef = useRef<string | null>(null);

  // Render compuesto (base + overlays + filtros) escalado a ~768px y guardado en visionImageRef.
  // Se recalcula con debounce para no disparar tokens de más ni bloquear la edición.
  useEffect(() => {
    if (!aiBridge) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const img = imageRef.current;
      if (!img || !img.naturalWidth) return;
      try {
        const maxDim = 768;
        const longest = Math.max(computedCanvasWidth, computedCanvasHeight || 1);
        const scale = Math.min(1, maxDim / longest);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(computedCanvasWidth * scale));
        canvas.height = Math.max(1, Math.round(computedCanvasHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(scale, scale);
        ctx.filter = _fStyle.filter;
        ctx.drawImage(img, canvasMargin, canvasMargin);
        ctx.filter = 'none';
        for (const ov of overlays || []) {
          try {
            const oImg = new Image();
            oImg.crossOrigin = 'anonymous';
            oImg.src = resolveImageUrl(ov.url);
            await new Promise<void>((res, rej) => { oImg.onload = () => res(); oImg.onerror = rej; });
            const ovFilter = getFilterStyle(ov.editState || {}, `zint-${ov.id}`);
            const ovOpacity = ((ov.opacity ?? 100) / 100) * (ovFilter.opacity ?? 1);
            ctx.save();
            ctx.globalAlpha = ovOpacity;
            ctx.filter = ovFilter.filter;
            const cx = ov.x + ov.width / 2;
            const cy = ov.y + ov.height / 2;
            ctx.translate(cx, cy);
            ctx.rotate(((ov.rotation ?? 0) * Math.PI) / 180);
            ctx.drawImage(oImg, -ov.width / 2, -ov.height / 2, ov.width, ov.height);
            ctx.restore();
            ctx.filter = 'none';
          } catch { /* overlay individual omitido si no carga */ }
        }
        const url = canvas.toDataURL('image/jpeg', 0.85);
        if (!cancelled) visionImageRef.current = url;
      } catch { /* canvas tainted o similar: el getter cae al fallback de activeTab.url */ }
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [aiBridge, computedCanvasWidth, computedCanvasHeight, canvasMargin, _fStyle, overlays, resolveImageUrl, getFilterStyle]);

  // Registrar en el puente del chat: imágenes (vista compuesta) + contenido (metadata).
  useEffect(() => {
    if (!aiBridge) return;
    const unregisterImages = aiBridge.registerDocumentImages(() => {
      const url = visionImageRef.current;
      if (url) return [url];
      const tabUrl = activeTab?.url;
      return tabUrl && tabUrl.startsWith('data:') ? [tabUrl] : null;
    });
    const unregisterContent = aiBridge.registerDocumentContent(() => {
      const parts: string[] = [];
      parts.push(`Imagen: ${activeTab?.name || '(sin nombre)'}`);
      const dims = imageDimensions && imageDimensions.width ? `${imageDimensions.width}×${imageDimensions.height}px` : '(dimensiones desconocidas)';
      parts.push(`Dimensiones: ${dims}`);
      const f: any = activeTab?.editState || {};
      const activeFilters: string[] = [];
      if (f.brightness) activeFilters.push(`brillo ${f.brightness}`);
      if (f.contrast) activeFilters.push(`contraste ${f.contrast}`);
      if (f.saturation) activeFilters.push(`saturación ${f.saturation}`);
      if (f.hue) activeFilters.push(`matiz ${f.hue}`);
      if (f.blur) activeFilters.push(`desenfoque ${f.blur}`);
      if (f.sepia) activeFilters.push(`sepia ${f.sepia}`);
      if (f.grayscale) activeFilters.push(`byn ${f.grayscale}`);
      if (f.invert) activeFilters.push(`invertir ${f.invert}`);
      parts.push(`Filtros: ${activeFilters.length ? activeFilters.join(', ') : t('editorHTML.image.toolbar.none')}`);
      parts.push(`${t('editorHTML.image.toolbar.rotationLabel', { r: rotation, fh: flipH ? t('editorHTML.image.toolbar.yes') : t('editorHTML.image.toolbar.no'), fv: flipV ? t('editorHTML.image.toolbar.yes') : t('editorHTML.image.toolbar.no') })}`);
      parts.push(`Overlays: ${overlays?.length ?? 0}`);
      return parts.join('\n');
    });
    return () => { unregisterImages(); unregisterContent(); };
  }, [aiBridge, activeTab, imageDimensions, rotation, flipH, flipV, overlays]);
  const handleImageLoad = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;
    setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  // Carga manual para data URIs (el navegador las carga sincrónicamente y onLoad a veces no se dispara)
  useEffect(() => {
    if (!resolvedImageUrl || !resolvedImageUrl.startsWith('data:')) return;
    const img = new Image();
    img.onload = () => {
      setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      console.error('[ImageEditor] Error cargando data URI');
    };
    img.src = resolvedImageUrl;
  }, [resolvedImageUrl]);

  // Activar automáticamente el modo pan cuando la imagen con zoom supera el tamaño del lienzo
  useEffect(() => {
    if (!mounted || imageDimensions.width === 0 || imageDimensions.height === 0) return;
    
    // Obtener dimensiones del contenedor del lienzo
    const canvasElement = document.getElementById('image-canvas-container');
    if (!canvasElement) return;
    
    const containerRect = canvasElement.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    
    // Calcular dimensiones de la imagen con zoom
    const zoomedWidth = imageDimensions.width * (zoom / 100);
    const zoomedHeight = imageDimensions.height * (zoom / 100);
    
    // Activar pan si la imagen con zoom es más grande que el contenedor
    const shouldActivatePan = zoomedWidth > containerWidth || zoomedHeight > containerHeight;
    
    if (shouldActivatePan !== isPanMode) {
      setIsPanMode(shouldActivatePan);
      if (!shouldActivatePan) {
        // Resetear offset cuando se desactiva el pan
        setCameraOffset({ x: 0, y: 0 });
        setIsPanningCanvas(false);
        panStateRef.current = null;
      }
    }
  }, [zoom, imageDimensions, mounted, isPanMode]);

  // Determinar si se debe mostrar cursor de pan basado en el tamaño de la imagen
  const shouldShowPanCursor = (() => {
    if (imageDimensions.width === 0 || imageDimensions.height === 0) return false;
    
    const canvasElement = document.getElementById('image-canvas-container');
    const scrollContainer = canvasElement?.closest('.overflow-auto') as HTMLElement;
    if (!canvasElement || !scrollContainer) return false;
    
    const containerRect = scrollContainer.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    
    const zoomedWidth = imageDimensions.width * (zoom / 100);
    const zoomedHeight = imageDimensions.height * (zoom / 100);
    
    return zoomedWidth > containerWidth || zoomedHeight > containerHeight;
  })();

  const canvasTransformStyle = {
    cursor: isZoomInMode ? 'zoom-in' : isZoomOutMode ? 'zoom-out' : isHandMode ? 'grab' : activeTool !== 'none' ? 'crosshair' : shouldShowPanCursor ? (isPanningCanvas ? 'grabbing' : 'grab') : 'default',
    width: computedCanvasWidth,
    height: computedCanvasHeight,
    transform: `scale(${zoom / 100})`,
    transformOrigin: 'center center',
    flexShrink: 0,
    transition: isPanningCanvas ? 'none' : 'transform 0.1s ease-out'
  } as React.CSSProperties;

  // Estilo para el contenedor que envuelve al canvas escalado para que el scroll reconozca el tamaño real
  const canvasWrapperStyle = {
    width: computedCanvasWidth * (zoom / 100),
    height: computedCanvasHeight * (zoom / 100),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '100px', // Margen de seguridad para poder panear cómodamente
    minWidth: '100%',
    minHeight: '100%'
  } as React.CSSProperties;

  const handleExportImage = async () => {
    if (!imageRef.current) return; 
    setIsExporting(true);
    try {
      const img = imageRef.current; 
      const canvas = document.createElement('canvas'); 
      const ctx = canvas.getContext('2d')!;
      
      // La exportación ahora respeta el tamaño total del lienzo (incluyendo márgenes)
      canvas.width = computedCanvasWidth;
      canvas.height = computedCanvasHeight;

      // Base: si hay selección terminada se dibuja SIN filtro y luego se le superpone
      // la base filtrada recortada a la selección (ajustes sólo en la zona). Sin
      // selección, la base filtrada completa (comportamiento anterior).
      const sel = activeSelectionForAdjust;
      if (sel.kind === 'none') {
        ctx.filter = filterStyle.filter;
        // Aplicar rotación/volteo de la base al exportar (mismo motivo que el
        // merge: sin esto el export revertía el Rotar/Voltear).
        drawBaseWithTransform(ctx, img, imageDimensions.width, imageDimensions.height, canvasMargin, rotation, flipH, flipV);
        ctx.filter = 'none';
      } else {
        // 1) base sin filtro
        ctx.filter = 'none';
        ctx.drawImage(img, canvasMargin, canvasMargin);
        // 2) base filtrada recortada a la selección
        if (sel.kind === 'mask' && sel.mask) {
          const tmp = document.createElement('canvas');
          tmp.width = computedCanvasWidth; tmp.height = computedCanvasHeight;
          const tctx = tmp.getContext('2d')!;
          tctx.filter = filterStyle.filter;
          tctx.drawImage(img, canvasMargin, canvasMargin);
          tctx.filter = 'none';
          tctx.globalCompositeOperation = 'destination-in';
          const mImg = new Image();
          mImg.src = sel.mask;
          await new Promise<void>((res, rej) => { mImg.onload = () => res(); mImg.onerror = rej; });
          tctx.drawImage(mImg, canvasMargin, canvasMargin, imageDimensions.width, imageDimensions.height);
          ctx.drawImage(tmp, 0, 0);
        } else {
          ctx.save();
          ctx.beginPath();
          if (sel.kind === 'rect' && sel.rect) {
            const r = normalizeRect(sel.rect);
            ctx.rect(r.x, r.y, r.width, r.height);
          } else if (sel.kind === 'circle' && sel.rect) {
            const r = normalizeRect(sel.rect);
            ctx.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
          } else if (sel.kind === 'freehand' && sel.anchors && sel.anchors.length >= 3) {
            traceBezierClosed(ctx, sel.anchors, 0, 0);
          }
          ctx.clip();
          ctx.filter = filterStyle.filter;
          ctx.drawImage(img, canvasMargin, canvasMargin);
          ctx.restore();
          ctx.filter = 'none';
        }
      }
      
      for (const ov of overlays) {
        const oImg = new Image();
        oImg.crossOrigin = 'anonymous';
        oImg.src = resolveImageUrl(ov.url);
        await new Promise(r => oImg.onload = r);
        
        const ovFilter = getFilterStyle(ov.editState || {}, `zint-${ov.id}`);
        const ovOpacity = ((ov.opacity ?? 100) / 100) * (ovFilter.opacity ?? 1);
        ctx.save();
        ctx.globalAlpha = ovOpacity;
        ctx.filter = ovFilter.filter;
        const centerX = ov.x + ov.width / 2;
        const centerY = ov.y + ov.height / 2;
        ctx.translate(centerX, centerY);
        ctx.rotate(((ov.rotation ?? 0) * Math.PI) / 180);
        ctx.drawImage(oImg, -ov.width / 2, -ov.height / 2, ov.width, ov.height);
        ctx.restore();
        ctx.filter = 'none';
      }

      const format = exportConfig.format; // 'image/png', 'image/jpeg', 'image/webp'
      const extension = format.split('/')[1];
      const fileName = `${exportConfig.title}.${extension}`;

      // Obtener la imagen en base64
      const base64Data = canvas.toDataURL(format, 0.9);
      const base64Content = base64Data.split(',')[1];
      const binaryString = atob(base64Content);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

      const paths = await getLocalPaths();
      const imageFolder = paths?.imagen;
      if (!imageFolder) throw new Error(t('editorHTML.image.toolbar.configureImagesPath'));

      const destPath = imageFolder.replace(/\\*$/, '') + '\\' + fileName;
      const ok = await writeFile(destPath, bytes);
      if (!ok) throw new Error('Error al exportar localmente');

      alert(`✅ IMAGEN EXPORTADA LOCALMENTE\n\nArchivo: ${fileName}`);
      setIsExportModalOpen(false);
    } catch (e: any) { 
      console.error(e); 
      alert(e.message || 'Error al exportar la imagen');
    } finally { 
      setIsExporting(false); 
    }
  };

  const saveProjectLocal = async (title: string, manualFiles: File[]) => {
    setIsSavingProject(true);
    try {
      const userId = pb.authStore.model?.id;
      if (!userId) throw new Error('Usuario no autenticado');

      const paths = await getLocalPaths();
      const rootPath = paths?.proyectos_imagen;
      if (!rootPath) throw new Error('Configura la ruta de proyectos de imagen primero.');

      const projectFolder = rootPath.replace(/\\*$/, '') + '\\' + title;
      await ensureDir(projectFolder);
      const assetsFolder = projectFolder + '\\assets';
      await ensureDir(assetsFolder);

      const projectData = {
        tabs,
        activeTabId,
        version: '1.0'
      };

      const zeusPath = projectFolder + '\\' + title + '.zeus';
      await saveProject(zeusPath, {
        titulo: title,
        tipo: 'edit_imagen',
        file: projectData
      });

      for (const file of manualFiles) {
        const sourcePath = getFilePath(file);
        const destPath = assetsFolder + '\\' + file.name;
        if (sourcePath) {
          await copyFile(sourcePath, destPath);
        } else {
          const buffer = new Uint8Array(await file.arrayBuffer());
          await writeFile(destPath, buffer);
        }
      }

      alert(`✅ PROYECTO CREADO CON ÉXITO\n\nUbicación: ${projectFolder}\nArchivos empaquetados: ${manualFiles.length}`);
      setIsSaveModalOpen(false);
    } catch (e: any) {
      console.error('Error guardando proyecto local:', e);
      alert(e.message || 'Error al guardar el proyecto');
    } finally {
      setIsSavingProject(false);
    }
  };

  const fetchProjectsFromPocketBase = async () => {
 
    setIsLoadingProjects(true); 
    try { 
      const records = await pb.collection('proyectos').getFullList({ 
        filter: "tipo = 'edit_imagen'",
        sort: '-created'
      }); 
      setSavedProjects(records); 
      setIsLoadModalOpen(true); 
    } catch (e) { 
      console.error(e); 
    } finally { 
      setIsLoadingProjects(false); 
    } 
  };
  const loadProjectFromRecord = (project: any) => { const data = typeof project.file === 'string' ? JSON.parse(project.file) : project.file; if (data.tabs) { setTabs(data.tabs); setActiveTabId(data.activeTabId); } setIsLoadModalOpen(false); };

  const applyPreset = (filterStr: string) => {
    const newState = { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, sepia: 0, grayscale: 0, invert: 0, opacity: 100, intensity: 0 };
    if (filterStr.includes('sepia(50%)')) newState.sepia = 50;
    if (filterStr.includes('grayscale(100%)')) newState.grayscale = 100;
    if (filterStr.includes('invert(100%)')) newState.invert = 100;
    if (filterStr.includes('contrast(150%)')) newState.contrast = 50;
    updateActiveTab({ editState: newState }); saveToHistory();
  };

  if (!mounted) return <div className="h-full w-full bg-gray-950 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-green-500" /></div>;

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white overflow-hidden shadow-2xl">
      <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
        <defs>
          {intensityDefs.map(d => renderIntensityFilter(d.id, d.intensity))}
        </defs>
      </svg>
      <style jsx>{`
        .layer-container { overflow: visible; }
        .layer-handle { width: 12px; height: 12px; background: #3b82f6; border: 2px solid white; border-radius: 50%; position: absolute; z-index: 100; display: none; }
        .layer-container:hover .layer-handle, .is-dragging .layer-handle { display: block; }
        .handle-nw { top: -6px; left: -6px; cursor: nw-resize; } .handle-ne { top: -6px; right: -6px; cursor: ne-resize; }
        .handle-sw { bottom: -6px; left: -6px; cursor: sw-resize; } .handle-se { bottom: -6px; right: -6px; cursor: se-resize; }
        .layer-rotate-handle { width: 14px; height: 14px; border: 2px solid #38bdf8; background: rgba(15, 23, 42, 0.9); border-radius: 50%; position: absolute; right: -12px; top: -12px; cursor: grab; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2); display: none; }
        .layer-container:hover .layer-rotate-handle, .is-dragging .layer-rotate-handle { display: block; }
        .layer-rotate-handle:hover { border-color: #22d3ee; background: #0f172a; }
        .transparency-grid { background-image: linear-gradient(45deg, #1a1a1a 25%, transparent 25%), linear-gradient(-45deg, #1a1a1a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1a1a 75%), linear-gradient(-45deg, transparent 75%, #1a1a1a 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0px; background-color: #111; }
        .filters-scroll::-webkit-scrollbar { height: 6px; } .filters-scroll::-webkit-scrollbar-track { background: transparent; } .filters-scroll::-webkit-scrollbar-thumb { background: rgba(34, 197, 94, 0.3); border-radius: 10px; }
        .ai-scrollbar::-webkit-scrollbar { width: 4px; }
        .ai-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .ai-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.18); border-radius: 999px; }
      `}</style>

      <div className="h-14 bg-gray-900 border-b border-gray-800 flex items-center px-4 shrink-0 gap-4">
        <div className="flex-1 min-w-0" />
        <div className="flex shrink-0 justify-center">
          <EditorFileNameBar
            items={[imageUrl?.split('/').pop() || imageUrl || t('editorHTML.image.toolbar.untitledImage')]}
            icon={<ImageIcon className="w-4 h-4" />}
            colorClass="text-blue-400"
            className="w-full max-w-md xl:max-w-xl"
          />
        </div>
        <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
          <div className={cn("border border-green-400 bg-gradient-to-b from-white/15 to-transparent shadow-[0_0_12px_rgba(34,197,94,0.3)] rounded flex items-center justify-center", historyIndex > 0 ? "cursor-pointer" : "opacity-30 cursor-not-allowed")} style={{ width: '32px', height: '32px' }} onClick={historyIndex > 0 ? handleUndo : undefined} title={t('editorHTML.image.toolbar.undo')}>
            <Undo className="text-green-400" style={{ width: '24px', height: '24px' }} />
          </div>
          <div className={cn("border border-green-400 bg-gradient-to-b from-white/15 to-transparent shadow-[0_0_12px_rgba(34,197,94,0.3)] rounded flex items-center justify-center", historyIndex < history.length - 1 ? "cursor-pointer" : "opacity-30 cursor-not-allowed")} style={{ width: '32px', height: '32px' }} onClick={historyIndex < history.length - 1 ? handleRedo : undefined} title={t('editorHTML.image.toolbar.redo')}>
            <Redo className="text-green-400" style={{ width: '24px', height: '24px' }} />
          </div>
          <div className="w-px h-6 bg-gray-800 mx-1" />
          <Button variant="ghost" size="sm" onClick={() => setIsExportModalOpen(true)} className="h-8 text-[10px] text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent shadow-[0_0_12px_rgba(34,197,94,0.3)]"><Download className="w-4 h-4 mr-2 text-green-400" /> {t('editorHTML.image.toolbar.export')}</Button>
          <Button variant="ghost" size="sm" onClick={() => setIsNewCanvasModalOpen(true)} className="h-8 text-[10px] text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent shadow-[0_0_12px_rgba(34,197,94,0.3)]"><FileImage className="w-4 h-4 mr-2 text-green-400" /> {t('editorHTML.image.toolbar.newTab')}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 text-[10px] text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent shadow-[0_0_12px_rgba(34,197,94,0.3)]">
                <Plus className="w-4 h-4 mr-2 text-green-400" /> {t('editorHTML.image.toolbar.load')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-gray-900 border-gray-800 text-white min-w-[180px]">
              <DropdownMenuItem onClick={() => openLocalProjectsFolder()} className="hover:bg-gray-800 cursor-pointer p-3">
                <ImageIcon className="w-4 h-4 mr-2 text-green-400" />
                {t('editorHTML.image.toolbar.localProjects')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openLocalImageFolder()} className="hover:bg-gray-800 cursor-pointer p-3">
                <FileImage className="w-4 h-4 mr-2 text-blue-400" />
                {t('editorHTML.image.toolbar.localImages')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-96 bg-gray-900 border-r border-gray-800 flex flex-col h-full overflow-hidden">
          <Tabs defaultValue="ai" className="flex-1 flex flex-col min-h-0">
            <TabsList className="bg-gray-950 p-1 m-4 mb-2 rounded-lg grid grid-cols-3 shrink-0">
              <TabsTrigger value="ai" className="text-[10px] uppercase font-bold text-gray-400 data-[state=active]:text-white">{t('editorHTML.image.tabs.flux')}</TabsTrigger>
              <TabsTrigger value="adjust" className="text-[10px] uppercase font-bold text-gray-400 data-[state=active]:text-yellow-400">{t('editorHTML.image.tabs.ajustes')}</TabsTrigger>
              <TabsTrigger value="transform" className="text-[10px] uppercase font-bold text-gray-400 data-[state=active]:text-yellow-400">{t('editorHTML.image.toolbar.transformTab')}</TabsTrigger>
            </TabsList>
            
            <TabsContent value="ai" className="flex-1 overflow-y-auto custom-scrollbar p-4 pt-2">
              <div className="space-y-4 pb-4">
                <div className="space-y-4 pt-2">
                  <div className="space-y-3 p-4 bg-gray-950 border border-gray-800 rounded-2xl shadow-inner">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] font-black uppercase text-gray-300 tracking-widest flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-gray-400" /> {t('editorHTML.image.toolbar.editImageWithFlux')}
                      </Label>
                      <span className="text-[8px] text-gray-500 uppercase tracking-[0.3em]">{t('editorHTML.image.toolbar.localComfyUIEdit')}</span>
                    </div>
                    {/* Estado y control de servidores */}
                    <div className="flex items-center gap-2 bg-gray-950/50 p-2 rounded-lg border border-gray-800">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${serverStatus.comfyui ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'}`} />
                        <span className="text-[9px] text-gray-400">ComfyUI</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${serverStatus.fluxBridge ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'}`} />
                        <span className="text-[9px] text-gray-400">Bridge</span>
                      </div>
                      <button
                        onClick={handleStartServers}
                        disabled={isStartingServers || (serverStatus.comfyui && serverStatus.fluxBridge)}
                        className="ml-auto text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-yellow-500/30"
                      >
                        {isStartingServers ? t('editorHTML.image.toolbar.startingServers') : serverStatus.comfyui && serverStatus.fluxBridge ? t('editorHTML.image.toolbar.serversReady') : t('editorHTML.image.toolbar.startServers')}
                      </button>
                    </div>
                    {serverMessage && (
                      <p className={`text-[9px] uppercase tracking-wider ${serverMessage.includes('listos') ? 'text-green-400' : serverMessage.includes(t('editorHTML.image.toolbar.error')) ? 'text-red-400' : 'text-yellow-300'}`}>
                        {serverMessage}
                      </p>
                    )}
                    <div className="space-y-2">
                      <Label className="text-[9px] uppercase text-gray-400">{t('editorHTML.image.toolbar.editPrompt')}</Label>
                      <textarea
                        value={fluxPrompt}
                        onChange={(e) => setFluxPrompt(e.target.value)}
                        placeholder={t('editorHTML.image.toolbar.editPromptPlaceholder')}
                        className="w-full bg-transparent border border-gray-800 rounded-lg p-3 text-xs text-white outline-none focus:ring-1 focus:ring-yellow-400 resize-none h-24 scrollbar-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label className="text-[9px] uppercase text-gray-400">{t('editorHTML.image.toolbar.comfyUI')}</Label>
                        <input
                          type="text"
                          value={comfyUiUrl}
                          onChange={(e) => setComfyUiUrl(e.target.value)}
                          className="w-full bg-transparent border border-gray-800 rounded-lg p-2 text-xs text-white outline-none focus:ring-1 focus:ring-yellow-400"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[9px] uppercase text-gray-400">{t('editorHTML.image.toolbar.strength')}</Label>
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={comfyStrength}
                          onChange={(e) => setComfyStrength(parseFloat(e.target.value) || 0)}
                          className="w-full bg-transparent border border-gray-800 rounded-lg p-2 text-xs text-white outline-none focus:ring-1 focus:ring-yellow-400"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[9px] uppercase text-gray-400">{t('editorHTML.image.toolbar.seed')}</Label>
                        <input
                          type="number"
                          min={0}
                          value={comfySeed}
                          onChange={(e) => setComfySeed(parseInt(e.target.value) || 0)}
                          className="w-full bg-transparent border border-gray-800 rounded-lg p-2 text-xs text-white outline-none focus:ring-1 focus:ring-yellow-400"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[9px] uppercase text-gray-400">{t('editorHTML.image.toolbar.steps')}</Label>
                        <input
                          type="number"
                          min={1}
                          value={comfySteps}
                          onChange={(e) => setComfySteps(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-full bg-transparent border border-gray-800 rounded-lg p-2 text-xs text-white outline-none focus:ring-1 focus:ring-yellow-400"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[9px] uppercase text-gray-400">{t('editorHTML.image.toolbar.cfg')}</Label>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={comfyCfg}
                          onChange={(e) => setComfyCfg(parseFloat(e.target.value) || 0)}
                          className="w-full bg-transparent border border-gray-800 rounded-lg p-2 text-xs text-white outline-none focus:ring-1 focus:ring-yellow-400"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[11px] uppercase text-gray-400">{t('editorHTML.image.toolbar.maskOptional')}</Label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleMaskFileSelection(e.target.files)}
                        className="text-[9px] text-gray-400"
                      />
                      {maskPreviewUrl && (
                        <div className="w-full max-w-xs rounded-lg overflow-hidden border border-gray-700">
                          <img src={maskPreviewUrl} alt="Máscara" className="w-full h-20 object-cover" />
                        </div>
                      )}
                    </div>
                    <div className="space-y-1 text-[10px] text-gray-400 uppercase tracking-[0.15em] leading-snug">
                      <p><span className="text-[11px] text-yellow-300">strength</span> · {t('editorHTML.image.toolbar.strengthHint')}</p>
                      <p><span className="text-[11px] text-yellow-300">steps</span> · {t('editorHTML.image.toolbar.stepsHint')}</p>
                      <p><span className="text-[11px] text-yellow-300">cfg</span> · {t('editorHTML.image.toolbar.cfgHint')}</p>
                      <p><span className="text-[11px] text-yellow-300">seed</span> · {t('editorHTML.image.toolbar.seedHint')}</p>
                      <p><span className="text-[11px] text-yellow-300">mask_file</span> · {t('editorHTML.image.toolbar.maskFileHint')}</p>
                    </div>
                    <div className="space-y-1 text-[10px] text-gray-400 uppercase tracking-[0.15em] leading-snug">
                      <p>{t('editorHTML.image.toolbar.maskInstructions')}</p>
                    </div>
                    {fluxEditorError && <p className="text-[9px] text-red-400 uppercase tracking-wider">{fluxEditorError}</p>}
                    <Button
                      onClick={editImageWithFlux}
                      disabled={isEditingWithFlux}
                      className="w-full h-12 bg-yellow-500 hover:bg-yellow-400 text-black font-black uppercase tracking-[0.2em] shadow-lg shadow-yellow-900/20"
                    >
                      {isEditingWithFlux ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Zap className="w-5 h-5 mr-2" />}
                      {isEditingWithFlux
                        ? (fluxProgress ? `${t('editorHTML.image.toolbar.editGenerating')} ${fluxProgress.current}/${fluxProgress.total}` : t('editorHTML.image.toolbar.editing'))
                        : t('editorHTML.image.toolbar.editGenerateImage')
                      }
                    </Button>
                    {isEditingWithFlux && fluxProgress && (
                      <div className="w-full bg-gray-800 rounded-full h-1.5 mt-2 overflow-hidden">
                        <div
                          className="bg-green-400 h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${fluxProgress.percent}%` }}
                        />
                      </div>
                    )}
                    <p className="text-[8px] text-gray-500 uppercase tracking-[0.3em] mt-1">/edit_with_comfyui_flux/ · puerto 5081</p>
                  </div>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="adjust" className="flex-1 p-4 space-y-6 overflow-visible">
              <div className="space-y-3">
                <Label className="text-[10px] font-black uppercase text-gray-500 tracking-widest flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" /> {t('editorHTML.image.toolbar.quickFilters')}</Label>
                <div className="flex gap-3 overflow-x-auto pb-4 filters-scroll">
                  {PRESET_FILTERS.map((preset) => (
                    <button key={preset.labelKey} onClick={() => applyPreset(preset.filter)} className="flex flex-col items-center gap-2 group shrink-0">
                      <div className="w-16 h-16 rounded-xl overflow-hidden border-2 border-transparent group-hover:border-green-400 transition-all bg-gray-800 relative">
                        {resolvedImageUrl ? <img src={resolvedImageUrl} className="w-full h-full object-cover" style={{ filter: preset.filter }} /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-6 h-6 text-gray-700" /></div>}
                      </div>
                      <span className="text-[9px] font-bold text-gray-500 group-hover:text-green-400 uppercase">{t(preset.labelKey)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-4 pt-4 border-t border-gray-800">
                <Label className="text-[10px] font-black uppercase text-gray-500 tracking-widest flex items-center gap-2"><Settings className="w-3.5 h-3.5" /> {t('editorHTML.image.toolbar.proAdjustments')}</Label>

                {/* Bloque 1: Básicos */}
                <div className="space-y-4 bg-gray-950/50 p-3 rounded-2xl border border-white/5 shadow-inner">
                  <div className="space-y-2"><Label className="text-[9px] uppercase text-gray-400 flex justify-between">{t('editorHTML.image.brightness')} <span>{currentEditState.brightness || 0}%</span></Label><Slider min={-100} max={100} step={1} value={[currentEditState.brightness || 0]} onValueChange={(v) => handleSliderChange('brightness', v)} /></div>
                  <div className="space-y-2"><Label className="text-[9px] uppercase text-gray-400 flex justify-between">{t('editorHTML.image.contrast')} <span>{currentEditState.contrast || 0}%</span></Label><Slider min={-100} max={100} step={1} value={[currentEditState.contrast || 0]} onValueChange={(v) => handleSliderChange('contrast', v)} /></div>
                  <div className="space-y-2"><Label className="text-[9px] uppercase text-gray-400 flex justify-between">{t('editorHTML.image.saturation')} <span>{currentEditState.saturation || 0}%</span></Label><Slider min={-100} max={100} step={1} value={[currentEditState.saturation || 0]} onValueChange={(v) => handleSliderChange('saturation', v)} /></div>
                  <div className="space-y-2"><Label className="text-[9px] uppercase text-gray-400 flex justify-between">{selectedOverlayId ? t('editorHTML.image.toolbar.layerIntensity') : t('editorHTML.image.intensity')} <span>{currentEditState.intensity || 0}%</span></Label><Slider min={-100} max={100} step={1} value={[currentEditState.intensity || 0]} onValueChange={(v) => handleSliderChange('intensity', v)} onValueCommit={() => saveToHistory()} /></div>
                </div>

                {/* Bloque 2: Color y Efectos */}
                <div className="space-y-4 bg-gray-950/50 p-3 rounded-2xl border border-white/5 shadow-inner">
                  <div className="space-y-2"><Label className="text-[9px] uppercase text-gray-400 flex justify-between">{t('editorHTML.image.grayscale')} <span>{currentEditState.grayscale || 0}%</span></Label><Slider min={0} max={100} step={1} value={[currentEditState.grayscale || 0]} onValueChange={(v) => handleSliderChange('grayscale', v)} /></div>
                  <div className="space-y-2"><Label className="text-[9px] uppercase text-gray-400 flex justify-between">{t('editorHTML.image.sepia')} <span>{currentEditState.sepia || 0}%</span></Label><Slider min={0} max={100} step={1} value={[currentEditState.sepia || 0]} onValueChange={(v) => handleSliderChange('sepia', v)} /></div>
                  <div className="space-y-2"><Label className="text-[9px] uppercase text-gray-400 flex justify-between">{t('editorHTML.image.hue')} <span>{currentEditState.hue || 0}°</span></Label><Slider min={-180} max={180} step={1} value={[currentEditState.hue || 0]} onValueChange={(v) => handleSliderChange('hue', v)} /></div>
                </div>

                {/* Bloque 3: Estilo */}
                <div className="space-y-4 bg-gray-950/50 p-3 rounded-2xl border border-white/5 shadow-inner">
                  <div className="space-y-2"><Label className="text-[9px] uppercase text-gray-400 flex justify-between">{t('editorHTML.image.blur')} <span>{currentEditState.blur || 0}px</span></Label><Slider min={0} max={20} step={0.5} value={[currentEditState.blur || 0]} onValueChange={(v) => handleSliderChange('blur', v)} /></div>
                  <div className="space-y-2">
                    <Label className="text-[9px] uppercase text-gray-400 flex justify-between">
                      {selectedOverlayId ? t('editorHTML.image.toolbar.layerOpacity') : t('editorHTML.image.opacity')} 
                      <span>{currentEditState.opacity || 100}%</span>
                    </Label>
                    <Slider 
                      min={0} max={100} step={1} 
                      value={[currentEditState.opacity || 100]} 
                      onValueChange={(v) => handleSliderChange('opacity', v)} 
                      onValueCommit={() => saveToHistory()}
                    />
                  </div>
                </div>
              </div>
              <Button variant="ghost" className="w-full h-9 text-[10px] font-medium text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent shadow-[0_0_12px_rgba(34,197,94,0.3)]" onClick={resetFilters}><RotateCcw className="w-3.5 h-3.5 mr-2 text-green-400" /> {t('editorHTML.image.toolbar.restoreAll')}</Button>
              {/* Guardar cambios: hornea los ajustes a la imagen (sólo a la selección
                  terminada si la hay). Fija los cambios para que al quitar la selección
                  no se extiendan a toda la imagen. Deshabilitado si no hay ajustes o
                  se está editando una capa. */}
              <Button
                variant="ghost"
                disabled={isBaking || !!selectedOverlayId || !hasNonNeutralAdjust(editState)}
                onClick={bakeAdjustments}
                className="w-full h-9 text-[10px] font-bold text-emerald-300 border border-emerald-500/60 bg-emerald-600/20 hover:bg-emerald-600/40 shadow-[0_0_12px_rgba(16,185,129,0.35)] disabled:opacity-40 disabled:cursor-not-allowed"
                title={selectedOverlayId ? t('editorHTML.image.toolbar.applyFromLayerPanel') : (activeSelectionForAdjust.kind !== 'none' ? t('editorHTML.image.toolbar.applyOnlySelection') : t('editorHTML.image.toolbar.applyToWholeImage'))}
              >
                <Check className="w-3.5 h-3.5 mr-2 text-emerald-400" /> {isBaking ? t('editorHTML.image.toolbar.saving') : t('editorHTML.image.toolbar.saveChanges')}
              </Button>
            </TabsContent>
            <TabsContent value="transform" className="flex-1 min-h-0 p-4 space-y-4 overflow-y-auto scrollbar-none">

              {/* 1. Rotar y voltear */}
              <div className="space-y-3 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-2xl">
                <Label className="text-[10px] font-black uppercase text-yellow-400 tracking-widest">{t('editorHTML.image.toolbar.rotateAndFlip')}</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="ghost" onClick={() => updateActiveTab({ rotation: rotation - 90 })} className="h-10 text-[9px] text-white border border-green-400/50 bg-gradient-to-b from-white/15 to-transparent"><RotateCcw className="w-4 h-4 mr-2" /> −90°</Button>
                  <Button variant="ghost" onClick={() => updateActiveTab({ rotation: rotation + 90 })} className="h-10 text-[9px] text-white border border-green-400/50 bg-gradient-to-b from-white/15 to-transparent"><RotateCw className="w-4 h-4 mr-2" /> +90°</Button>
                  <Button variant="ghost" onClick={() => updateActiveTab({ flipH: !flipH })} className={cn("h-10 text-[9px] text-white border bg-gradient-to-b from-white/15 to-transparent", flipH ? "border-green-400 text-green-300" : "border-green-400/50")}><FlipHorizontal className="w-4 h-4 mr-2" /> {t('editorHTML.image.toolbar.flipH')}</Button>
                  <Button variant="ghost" onClick={() => updateActiveTab({ flipV: !flipV })} className={cn("h-10 text-[9px] text-white border bg-gradient-to-b from-white/15 to-transparent", flipV ? "border-green-400 text-green-300" : "border-green-400/50")}><FlipVertical className="w-4 h-4 mr-2" /> {t('editorHTML.image.toolbar.flipV')}</Button>
                </div>
                <Button variant="ghost" onClick={() => updateActiveTab({ rotation: 0, flipH: false, flipV: false })} className="w-full h-8 text-[9px] uppercase font-black text-gray-300 border border-gray-700">{t('editorHTML.image.toolbar.reset')}</Button>
                <p className="text-[9px] text-gray-500 text-center">Rotación: {rotation}° · H: {flipH ? 'sí' : 'no'} · V: {flipV ? 'sí' : 'no'}</p>
              </div>

              <div className="space-y-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
                <Label className="text-[10px] font-black uppercase text-blue-400 tracking-widest">{t('editorHTML.image.toolbar.borderAndRounding')}</Label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[9px] font-bold text-gray-300">{t('editorHTML.image.toolbar.roundness')}</Label>
                    <span className="text-[9px] text-gray-400">{borderRadius}px</span>
                  </div>
                  <Slider min={0} max={200} step={1} value={[borderRadius]} onValueChange={(v) => setBorderRadius(v[0])} />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[9px] font-bold text-gray-300">{t('editorHTML.image.toolbar.borderWidth')}</Label>
                    <span className="text-[9px] text-gray-400">{borderWidth}px</span>
                  </div>
                  <Slider min={0} max={100} step={1} value={[borderWidth]} onValueChange={(v) => setBorderWidth(v[0])} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-[9px] font-bold text-gray-300">{t('editorHTML.image.toolbar.borderColor')}</Label>
                  <input type="color" value={borderColor} onChange={(e) => setBorderColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border border-gray-600 bg-transparent" />
                </div>
              </div>

              {/* 2. Seleccionar */}
              <div className="space-y-3 p-3 bg-gray-950/40 border border-white/5 rounded-2xl">
                <Label className="text-[10px] font-black uppercase text-gray-400 tracking-widest">{t('editorHTML.image.toolbar.select')}</Label>
                <div className="grid grid-cols-5 gap-1.5">
                  <div onClick={() => { setActiveTool('crop_rect'); setSelectionMask(null); setPolygonPath([]); setPolyDragging(false); setPolyDragAnchor(null); setPolyClosed(false); setShapeType('rectangle'); }} title={t('editorHTML.image.toolbar.rectTool')} className={cn("flex flex-col items-center justify-center gap-1 py-2 rounded-lg cursor-pointer border", activeTool === 'crop_rect' ? "border-green-400 bg-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.4)]" : "border-yellow-400/40 bg-gradient-to-b from-white/10 to-transparent hover:from-white/15")}>
                    <Crop className={cn("w-5 h-5", activeTool === 'crop_rect' ? "text-green-400" : "text-gray-400")} />
                    <span className={cn("text-[8px] font-bold uppercase", activeTool === 'crop_rect' ? "text-green-300" : "text-gray-500")}>{t('editorHTML.image.toolbar.rectangle')}</span>
                  </div>
                  <div onClick={() => { setActiveTool('crop_free'); setSelectionMask(null); setPolygonPath([]); setPolyDragging(false); setPolyDragAnchor(null); setPolyClosed(false); setFreePoints([]); setFreeClosed(false); }} title={t('editorHTML.image.toolbar.lassoHint')} className={cn("flex flex-col items-center justify-center gap-1 py-2 rounded-lg cursor-pointer border", activeTool === 'crop_free' ? "border-green-400 bg-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.4)]" : "border-yellow-400/40 bg-gradient-to-b from-white/10 to-transparent hover:from-white/15")}>
                    <Scissors className={cn("w-5 h-5", activeTool === 'crop_free' ? "text-green-400" : "text-gray-400")} />
                    <span className={cn("text-[8px] font-bold uppercase", activeTool === 'crop_free' ? "text-green-300" : "text-gray-500")}>{t('editorHTML.image.toolbar.lasso')}</span>
                  </div>
                  <div onClick={() => { setActiveTool('magic_wand'); setSelectionMask(null); setPolygonPath([]); setPolyDragging(false); setPolyDragAnchor(null); setPolyClosed(false); }} title={t('editorHTML.image.toolbar.magicWand')} className={cn("flex flex-col items-center justify-center gap-1 py-2 rounded-lg cursor-pointer border", activeTool === 'magic_wand' ? "border-green-400 bg-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.4)]" : "border-yellow-400/40 bg-gradient-to-b from-white/10 to-transparent hover:from-white/15")}>
                    <Wand2 className={cn("w-5 h-5", activeTool === 'magic_wand' ? "text-green-400" : "text-gray-400")} />
                    <span className={cn("text-[8px] font-bold uppercase", activeTool === 'magic_wand' ? "text-green-300" : "text-gray-500")}>{t('editorHTML.image.toolbar.wand')}</span>
                  </div>
                  <div onClick={() => { setActiveTool('brush_selection'); setSelectionMask(null); setPolygonPath([]); setPolyDragging(false); setPolyDragAnchor(null); setPolyClosed(false); }} title={t('editorHTML.image.toolbar.wandBrush')} className={cn("flex flex-col items-center justify-center gap-1 py-2 rounded-lg cursor-pointer border", activeTool === 'brush_selection' ? "border-green-400 bg-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.4)]" : "border-yellow-400/40 bg-gradient-to-b from-white/10 to-transparent hover:from-white/15")}>
                    <Paintbrush className={cn("w-5 h-5", activeTool === 'brush_selection' ? "text-green-400" : "text-gray-400")} />
                    <span className={cn("text-[8px] font-bold uppercase", activeTool === 'brush_selection' ? "text-green-300" : "text-gray-500")}>{t('editorHTML.image.toolbar.brushSel')}</span>
                  </div>
                  <div onClick={() => {
                      if (activeTool === 'shape') { setActiveTool('none'); setPolygonPath([]); setPolyDragging(false); setPolyDragAnchor(null); setPolyClosed(false); }
                      else { setActiveTool('shape'); setSelectionMask(null); setCropRect({x:0,y:0,width:0,height:0}); setPolygonPath([]); setPolyDragging(false); setPolyDragAnchor(null); setPolyClosed(false); }
                    }}
                    title="Figura"
                    className={cn("flex flex-col items-center justify-center gap-1 py-2 rounded-lg cursor-pointer border", activeTool === 'shape' ? "border-green-400 bg-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.4)]" : "border-yellow-400/40 bg-gradient-to-b from-white/10 to-transparent hover:from-white/15")}>
                    <Shapes className={cn("w-5 h-5", activeTool === 'shape' ? "text-green-400" : "text-gray-400")} />
                    <span className={cn("text-[8px] font-bold uppercase", activeTool === 'shape' ? "text-green-300" : "text-gray-500")}>{t('editorHTML.image.toolbar.shape')}</span>
                  </div>
                </div>

                {/* Subpanel Figura: tipo de forma + acciones */}
                {activeTool === 'shape' && (
                  <div className="space-y-3 p-3 bg-green-500/5 border border-green-500/20 rounded-xl animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-[9px] font-black uppercase text-green-400">{t('editorHTML.image.toolbar.shapeType')}</Label>
                      <div className="flex gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => { setShapeType('rectangle'); setPolygonPath([]); setPolyDragging(false); setPolyDragAnchor(null); setPolyClosed(false); }} className={cn("h-9 w-9 p-0", shapeType === 'rectangle' ? "bg-green-500/20 text-green-400 border border-green-500/50" : "text-gray-500")}>
                          <Square className="w-5 h-5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setShapeType('circle'); setPolygonPath([]); setPolyDragging(false); setPolyDragAnchor(null); setPolyClosed(false); }} className={cn("h-9 w-9 p-0", shapeType === 'circle' ? "bg-green-500/20 text-green-400 border border-green-500/50" : "text-gray-500")}>
                          <Circle className="w-5 h-5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setShapeType('line'); setPolygonPath([]); setPolyDragging(false); setPolyDragAnchor(null); setPolyClosed(false); }} className={cn("h-9 w-9 p-0", shapeType === 'line' ? "bg-green-500/20 text-green-400 border border-green-500/50" : "text-gray-500")}>
                          <Minus className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-white/5">
                      <Button variant="ghost" onClick={() => performCropOrCopy('crop')} className="h-10 text-[9px] uppercase font-black text-white border border-green-400/50 bg-gradient-to-b from-white/15 to-transparent" title={t('editorHTML.image.toolbar.cropShape')}><Scissors className="w-4 h-4 mr-1" />{t('editorHTML.image.toolbar.crop')}</Button>
                      <Button variant="ghost" onClick={selectShapeArea} className="h-10 text-[9px] uppercase font-black text-white border border-green-400/50 bg-gradient-to-b from-white/15 to-transparent" title={t('editorHTML.image.toolbar.shapeToSelection')}><Square className="w-4 h-4 mr-1" />{t('editorHTML.image.toolbar.selection')}</Button>
                      <Button variant="ghost" onClick={() => performCropOrCopy('layer')} className="h-10 text-[9px] uppercase font-black text-white border border-green-400/50 bg-gradient-to-b from-white/15 to-transparent" title={t('editorHTML.image.toolbar.layerFromShape')}><Clipboard className="w-4 h-4 mr-1" />{t('editorHTML.image.toolbar.layer')}</Button>
                    </div>
                  </div>
                )}

                {/* Pista de modificadores para varita / pincel de selección */}
                {(activeTool === 'magic_wand' || activeTool === 'brush_selection') && (
                  <p className="text-[9px] text-gray-500 leading-tight">{t('editorHTML.image.toolbar.modifiers')}: <span className="text-gray-400">Ctrl</span> = {t('editorHTML.image.toolbar.addToSelection')} · <span className="text-gray-400">Alt</span> = {t('editorHTML.image.toolbar.removeFromSelection')}</p>
                )}

                {/* Pista del lazo Bézier (tipo Pluma) */}
                {activeTool === 'crop_free' && (
                  <p className="text-[9px] text-gray-500 leading-tight">{t('editorHTML.image.toolbar.clickToFixVertices')} <span className="text-gray-400">clic</span> · <span className="text-gray-400">{t('editorHTML.image.toolbar.dragToCurve')}</span> al fijar un vértice ({t('editorHTML.image.toolbar.moreCurvature')}). <span className="text-gray-400">Esc</span> {t('editorHTML.image.toolbar.closeSelection')} · <span className="text-gray-400">Z</span> {t('editorHTML.image.toolbar.undoLastVertex')}. {t('editorHTML.image.toolbar.thenUse')} {t('editorHTML.image.toolbar.cropCreateLayerCopy')}.</p>
                )}

                {/* Pista de Figura → Línea (Pluma Bézier, igual que el Lazo) */}
                {activeTool === 'shape' && shapeType === 'line' && (
                  <p className="text-[9px] text-gray-500 leading-tight">{t('editorHTML.image.toolbar.clickToFixVertices')} <span className="text-gray-400">clic</span> · <span className="text-gray-400">{t('editorHTML.image.toolbar.dragToCurve')}</span> para curvar el segmento. <span className="text-gray-400">Esc</span> cierra la figura · <span className="text-gray-400">Z</span> {t('editorHTML.image.toolbar.undoLastVertex')}. {t('editorHTML.image.toolbar.cropSelection')} / {t('editorHTML.image.toolbar.selection')} / {t('editorHTML.image.toolbar.layer')}.</p>
                )}

                {/* Acciones para herramientas de selección (no figura) */}
                {activeTool !== 'none' && activeTool !== 'shape' && (
                  <div className="space-y-2 pt-1 animate-in fade-in slide-in-from-top-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Button onClick={() => performCropOrCopy('crop')} className="bg-green-600 text-white h-10 text-[9px] uppercase font-black">{t('editorHTML.image.toolbar.cropSelection')}</Button>
                      <Button onClick={() => performCropOrCopy('layer')} className="bg-green-600 text-white h-10 text-[9px] uppercase font-black shadow-[0_0_15px_rgba(34,197,94,0.3)]">{t('editorHTML.image.toolbar.createLayer')}</Button>
                    </div>
                    <Button
                      onClick={invertSelection}
                      disabled={!selectionMask}
                      variant="ghost"
                      className={cn(
                        "w-full h-10 text-[9px] uppercase font-black",
                        selectionMask ? "text-white border border-blue-400 bg-blue-500/10 hover:border-blue-300" : "text-gray-600 border border-gray-800 cursor-not-allowed"
                      )}
                    >
                      {t('editorHTML.image.toolbar.invertSelection')}
                    </Button>
                    {hasActiveSelection && (
                      <Button variant="ghost" onClick={() => performCropOrCopy('copy')} className="w-full text-[9px] uppercase font-black border border-blue-400 text-white">
                        {t('editorHTML.image.toolbar.copySelection')}
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => { setActiveTool('none'); setSelectionMask(null); setCropRect({x:0,y:0,width:0,height:0}); setPolygonPath([]); setPolyDragging(false); setPolyDragAnchor(null); setPolyClosed(false); setFreePoints([]); setFreeDragging(false); setFreeDragAnchor(null); freeDraggingRef.current = false; freeDragAnchorRef.current = null; setFreeClosed(false); }} className="w-full text-gray-500 text-[9px] uppercase border border-gray-800">{t('editorHTML.image.toolbar.cancel')}</Button>
                  </div>
                )}

                {/* Borrar selección: RECORTA de la imagen los píxeles de la selección
                    activa (varita/pincel/rect/círculo/lazo/forma-línea) y vacía la
                    selección. Visible siempre que haya selección. Se puede deshacer. */}
                {hasActiveSelection && (
                  <Button
                    variant="ghost"
                    onClick={eraseSelection}
                    className="w-full h-10 text-[9px] uppercase font-black text-white border border-red-400 bg-red-500/10 hover:border-red-300"
                  >
                    <Trash2 className="w-4 h-4 mr-1" /> {t('editorHTML.image.toolbar.eraseSelection')}
                  </Button>
                )}

                {/* Pegar: siempre visible (no depende de la herramienta activa) */}
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <Button variant="ghost" onClick={handlePaste} className="w-full text-[9px] uppercase font-black text-white border border-gray-600">
                    {t('editorHTML.image.toolbar.pasteFromClipboard')}
                  </Button>
                  {copiedSelection && (
                    <Button variant="ghost" onClick={pasteCopiedSelectionAsOverlay} className="w-full text-[9px] uppercase font-black border border-green-400 text-white">
                      {t('editorHTML.image.toolbar.pasteCopiedSelection')}
                    </Button>
                  )}
                  <p className="text-[9px] text-gray-500 leading-tight">{t('editorHTML.image.toolbar.pasteInstructions')}</p>
                </div>
              </div>

              {/* 3. Pintar */}
              <div className="space-y-3 p-3 bg-gray-950/40 border border-white/5 rounded-2xl">
                <Label className="text-[10px] font-black uppercase text-gray-400 tracking-widest">{t('editorHTML.image.toolbar.paint')}</Label>
                <div className="flex items-center gap-2 p-3 bg-gray-950/50 rounded-xl border border-white/5">
                  <input type="color" value={selectedColor} onChange={(e) => setSelectedColor(e.target.value)} className="w-9 h-9 rounded cursor-pointer bg-transparent border-none shrink-0" />
                  <div className="flex-1 text-[10px] font-mono text-gray-400 uppercase">{selectedColor}</div>
                  <div className="flex gap-1.5">
                    <div onClick={() => { setActiveTool('paint_brush'); }} title={t('editorHTML.image.toolbar.paintBrush')} className={cn("border border-white/10 bg-gradient-to-b from-white/15 to-transparent rounded cursor-pointer flex items-center justify-center", activeTool === 'paint_brush' && "border-green-400 text-green-400")} style={{ width: '34px', height: '34px' }}>
                      <Paintbrush style={{ width: '20px', height: '20px' }} />
                    </div>
                    <div onClick={() => { setActiveTool('fill_brush'); }} title={t('editorHTML.image.toolbar.fillBrush')} className={cn("border border-white/10 bg-gradient-to-b from-white/15 to-transparent rounded cursor-pointer flex items-center justify-center", activeTool === 'fill_brush' && "border-green-400 text-green-400")} style={{ width: '34px', height: '34px' }}>
                      <Paintbrush style={{ width: '20px', height: '20px' }} />
                    </div>
                    <div onClick={() => { setActiveTool('paint_bucket'); }} title={t('editorHTML.image.toolbar.paintBucket')} className={cn("border border-white/10 bg-gradient-to-b from-white/15 to-transparent rounded cursor-pointer flex items-center justify-center", activeTool === 'paint_bucket' && "border-green-400 text-green-400")} style={{ width: '34px', height: '34px' }}>
                      <PaintBucket style={{ width: '20px', height: '20px' }} />
                    </div>
                    <div onClick={() => { setActiveTool('eyedropper'); }} title={t('editorHTML.image.toolbar.eyedropper')} className={cn("border border-white/10 bg-gradient-to-b from-white/15 to-transparent rounded cursor-pointer flex items-center justify-center", activeTool === 'eyedropper' && "border-green-400 text-green-400")} style={{ width: '34px', height: '34px' }}>
                      <Pipette style={{ width: '20px', height: '20px' }} />
                    </div>
                    <div onClick={() => { setActiveTool('smudge'); }} title={t('editorHTML.image.toolbar.smudgeToolLabel')} className={cn("border border-white/10 bg-gradient-to-b from-white/15 to-transparent rounded cursor-pointer flex items-center justify-center", activeTool === 'smudge' && "border-green-400 text-green-400")} style={{ width: '34px', height: '34px' }}>
                      <Hand style={{ width: '20px', height: '20px' }} />
                    </div>
                  </div>
                </div>

                {/* Tamaño del pincel para herramientas de pintura */}
                {(activeTool === 'paint_brush' || activeTool === 'fill_brush' || activeTool === 'brush_selection' || activeTool === 'smudge') && (
                  <div className="space-y-2 p-3 bg-gray-950/50 rounded-xl border border-white/5">
                    <Label className="text-[9px] uppercase text-gray-400">{t('editorHTML.image.toolbar.brushSize')}: {brushSize}px</Label>
                    <Slider
                      value={[brushSize]}
                      onValueChange={(value) => setBrushSize(value[0])}
                      max={100}
                      min={1}
                      step={1}
                      className="w-full"
                    />
                    {activeTool === 'smudge' && (
                      <>
                        <Label className="text-[9px] uppercase text-gray-400 pt-1">{t('editorHTML.image.toolbar.smudgeStrength')}: {smudgeStrength}%</Label>
                        <Slider
                          value={[smudgeStrength]}
                          onValueChange={(value) => setSmudgeStrength(value[0])}
                          max={100}
                          min={5}
                          step={1}
                          className="w-full"
                        />
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* 4. Capas */}
              <div className="space-y-3 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-2xl">
                <Label className="text-[10px] font-black uppercase text-yellow-400 tracking-widest flex items-center justify-between">
                  {t('editorHTML.image.toolbar.projectLayers')}
                  <span className="text-[9px] bg-yellow-500/20 px-2 py-0.5 rounded text-yellow-300">{overlays.length}</span>
                </Label>

                {overlays.length > 0 ? (
                  <div className="space-y-1 max-h-[180px] overflow-y-auto pr-1 custom-scrollbar">
                    {overlays.map((ov: any, idx: number) => (
                      <div
                        key={ov.id}
                        onClick={() => setSelectedOverlayId(ov.id)}
                        className={cn(
                          "flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-all border",
                          selectedOverlayId === ov.id ? "bg-yellow-500/20 border-yellow-500/50" : "bg-gray-950/50 border-transparent hover:bg-gray-800"
                        )}
                      >
                        <div className="w-10 h-10 bg-black rounded-lg overflow-hidden border border-white/5 shrink-0">
                          <img src={ov.url} className="w-full h-full object-contain" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black text-gray-200 truncate">{t('editorHTML.image.toolbar.layer')} {idx + 1}</p>
                          <p className="text-[8px] text-gray-500 uppercase font-bold tracking-tighter">{ov.width.toFixed(0)}x{ov.height.toFixed(0)}px</p>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); moveOverlay(ov.id, 'up'); }} className="h-6 w-6 text-gray-300 hover:bg-white/10 hover:text-white"><ArrowUp className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); moveOverlay(ov.id, 'down'); }} className="h-6 w-6 text-gray-300 hover:bg-white/10 hover:text-white"><ArrowDown className="w-3 h-3" /></Button>
                        </div>
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); updateActiveTab({ overlays: overlays.filter((o: any) => o.id !== ov.id) }); if (selectedOverlayId === ov.id) setSelectedOverlayId(null); saveToHistory(); }} className="h-7 w-7 text-red-500 hover:bg-red-500/10 opacity-40 hover:opacity-100">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )).reverse()}
                  </div>
                ) : (
                  <p className="text-center py-4 text-[9px] text-gray-600 uppercase font-black italic border border-dashed border-gray-800 rounded-xl">{t('editorHTML.image.toolbar.noLayersCreated')}</p>
                )}

                {selectedOverlayId && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2">
                    <div className="space-y-2 bg-yellow-500/5 p-3 rounded-xl border border-yellow-500/20">
                      <Label className="text-[9px] uppercase text-gray-400 flex justify-between"><span>{t('editorHTML.image.toolbar.opacity')}</span><span>{overlays.find((o: any) => o.id === selectedOverlayId)?.opacity ?? 100}%</span></Label>
                      <Slider
                        min={0} max={100} step={1}
                        value={[overlays.find((o: any) => o.id === selectedOverlayId)?.opacity ?? 50]}
                        onValueChange={(v) => updateActiveTab({ overlays: overlays.map((o: any) => o.id === selectedOverlayId ? { ...o, opacity: v[0] } : o) })}
                        onValueCommit={() => saveToHistory()}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      onClick={mergeSelectedOverlayIntoBase}
                      className="w-full text-[9px] uppercase font-black border border-blue-400 text-white"
                    >
                      {t('editorHTML.image.toolbar.mergeSelectedLayer')}
                    </Button>
                  </div>
                )}
              </div>

              {/* 5. Fondo y lienzo */}
              <div className="space-y-3 p-3 bg-gray-950/40 border border-white/5 rounded-2xl">
                <Label className="text-[10px] font-black uppercase text-gray-400 tracking-widest flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" /> {t('editorHTML.image.toolbar.removeBackground')}</Label>
                <p className="text-[10px] text-gray-400 leading-tight">{t('editorHTML.image.toolbar.removeBackgroundDescription')}</p>
                <Button
                  onClick={handleRemoveBackground}
                  disabled={isRemovingBg}
                  className="w-full h-11 text-[10px] font-black uppercase tracking-[0.2em] bg-gradient-to-r from-green-600 to-green-500 shadow-lg shadow-green-900/30"
                >
                  {isRemovingBg ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2 text-white" />}
                  {isRemovingBg ? t('editorHTML.image.toolbar.processing') : t('editorHTML.image.toolbar.removeBackgroundButton')}
                </Button>
                {removeBgError && <p className="text-[10px] text-red-400 font-medium">{removeBgError}</p>}

                <div className="pt-3 border-t border-white/5 space-y-2">
                  <Label className="text-[10px] font-black uppercase text-gray-400 tracking-widest">{t('editorHTML.image.toolbar.extendedCanvas')}</Label>
                  <p className="text-[10px] text-gray-400 leading-tight">{t('editorHTML.image.toolbar.extendedCanvasDescription')}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm" onClick={() => adjustCanvasMargin(-20)} className="text-[10px] font-black uppercase tracking-[0.3em] text-white border border-gray-700">−20px</Button>
                    <Button variant="ghost" size="sm" onClick={() => adjustCanvasMargin(20)} className="text-[10px] font-black uppercase tracking-[0.3em] text-white border border-gray-700">+20px</Button>
                  </div>
                  <p className="text-[9px] text-gray-500">{t('editorHTML.image.toolbar.margin')}: {canvasMargin}px · {t('editorHTML.image.toolbar.offset')}: ({cameraOffset.x.toFixed(0)}, {cameraOffset.y.toFixed(0)})</p>
                </div>
              </div>
            </TabsContent>
          </Tabs>
          <div className="p-4 pb-12 border-t border-gray-800 bg-gray-900 shrink-0">
            <button
              type="button"
              onClick={() => setIsSaveModalOpen(true)}
              className="w-full h-12 rounded-xl text-[11px] font-black uppercase tracking-[0.2em] text-white border-2 border-yellow-400 bg-gray-900 bg-gradient-to-b from-white/15 to-gray-800 hover:from-white/25 hover:to-gray-700 transition-all shadow-[0_0_20px_rgba(234,179,8,0.2)] inline-flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" /> {t('editorHTML.image.toolbar.saveProject')}
            </button>
          </div>
          </div>
        <div className="flex-1 bg-black relative flex flex-col overflow-hidden">
          <div className="bg-gray-900/50 backdrop-blur-md border-b border-gray-800 px-4 h-11 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0 z-20">
            {tabs.map((tab) => (
              <div key={tab.id} onClick={() => setActiveTabId(tab.id)} className={cn("group relative flex items-center gap-2 px-4 h-8 min-w-[130px] max-w-[200px] rounded-lg border transition-all cursor-pointer", activeTabId === tab.id ? "bg-gradient-to-b from-white/15 to-green-500/10 border-green-400 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)]" : "bg-gradient-to-b from-white/5 to-transparent border-yellow-400/40 text-yellow-500/70 hover:border-yellow-400")}>
                <ImageIcon className={cn("w-3.5 h-3.5", activeTabId === tab.id ? "text-green-400" : "text-yellow-500/50")} />
                <span className="text-[10px] font-black uppercase tracking-tighter truncate flex-1">{tab.url ? tab.name : t('editorHTML.image.toolbar.empty')}</span>
                {tabs.length > 1 && <button onClick={(e) => closeTab(tab.id, e)} className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-500/20 rounded transition-all text-gray-500 hover:text-red-400"><X className="w-3 h-3" /></button>}
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={addNewTab} disabled={tabs.length >= 5} className="h-8 w-8 text-yellow-400 border border-yellow-400/50 bg-gradient-to-b from-white/10 to-transparent hover:border-green-400 hover:text-green-400 transition-all"><Plus className="w-4 h-4" /></Button>
          </div>

          <div className="flex-1 relative overflow-hidden">
            {/* Botones fijos fuera del contenedor de scroll */}
            <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-gray-900/80 backdrop-blur-md p-1 rounded-lg border border-gray-700 shadow-xl">
              <Button size="icon" variant="ghost" onClick={() => setZoom(Math.max(10, zoom - 10))} className="h-8 w-8 text-white hover:text-red-400"><Minimize className="w-4 h-4" /></Button>
              <span className="text-[11px] font-black font-mono min-w-[45px] text-center text-yellow-400 drop-shadow-[0_0_5px_rgba(234,179,8,0.5)]">{zoom}%</span>
              <Button size="icon" variant="ghost" onClick={() => setZoom(Math.min(300, zoom + 10))} className="h-8 w-8 text-white hover:text-green-400"><Maximize className="w-4 h-4" /></Button>
              <Button 
                size="icon" 
                variant="ghost" 
                onClick={handleZoomInModeToggle}
                className={cn(
                  'h-8 w-8',
                  isZoomInMode ? 'text-blue-400 bg-blue-400/20' : 'text-white hover:text-blue-400'
                )}
                title={t('editorHTML.image.toolbar.zoomInTooltip')}
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button 
                size="icon" 
                variant="ghost" 
                onClick={handleZoomOutModeToggle}
                className={cn(
                  'h-8 w-8',
                  isZoomOutMode ? 'text-orange-400 bg-orange-400/20' : 'text-white hover:text-orange-400'
                )}
                title={t('editorHTML.image.toolbar.zoomOutTooltip')}
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button 
                size="icon" 
                variant="ghost" 
                onClick={handleHandModeToggle}
                className={cn(
                  'h-8 w-8',
                  isHandMode ? 'text-green-400 bg-green-400/20' : 'text-white hover:text-green-400'
                )}
                title={t('editorHTML.image.toolbar.handModeTooltip')}
              >
                <Hand className="w-4 h-4" />
              </Button>
            </div>
            
            <div 
              className="w-full h-full overflow-auto scrollbar-none"
            >
              <div style={canvasWrapperStyle}>
                <div
                  id="image-canvas-container"
                  className="relative shadow-2xl flex items-center justify-center transparency-grid rounded-lg"
                  style={canvasTransformStyle}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={(e) => {
                    handleImageMouseMove(e);
                    if (isZooming && isZoomMode) {
                      handleZoomMove(e);
                    }
                  }}
                  onMouseUp={(e) => {
                    handleImageMouseUp();
                    if (isZooming && isZoomMode) {
                      handleZoomEnd();
                    }
                  }}
                >
                  {resolvedImageUrl ? (
                    <div className="relative inline-block" style={{ width: computedCanvasWidth, height: computedCanvasHeight }}>
                      <img ref={imageRef} src={resolvedImageUrl} alt="Edit" className="max-w-none object-contain shadow-2xl pointer-events-none select-none absolute" style={{...(adjustClip ? { filter: 'none', opacity: 1, transform: filterStyle.transform, borderRadius: `${borderRadius}px`, border: `${borderWidth}px solid ${borderColor}` } : { ...filterStyle, borderRadius: `${borderRadius}px`, border: `${borderWidth}px solid ${borderColor}` }), left: canvasMargin, top: canvasMargin, width: imageDimensions.width, height: imageDimensions.height }} crossOrigin="anonymous" onLoad={handleImageLoad} />
                      {/* Overlay filtrado recortado a la selección: con selección terminada,
                          el <img> base va sin filtro y este lleva los ajustes sólo en la zona. */}
                      {adjustClip && (
                        <img
                          src={resolvedImageUrl}
                          alt=""
                          aria-hidden
                           className="max-w-none object-contain shadow-2xl pointer-events-none select-none absolute"
                           style={{ filter: filterStyle.filter, opacity: filterStyle.opacity, transform: filterStyle.transform, left: canvasMargin, top: canvasMargin, width: imageDimensions.width, height: imageDimensions.height, borderRadius: `${borderRadius}px`, border: `${borderWidth}px solid ${borderColor}`, ...adjustClip }}
                          crossOrigin="anonymous"
                        />
                      )}
                       {overlays.map((ov: any, idx: number) => {
                         const isSelected = selectedOverlayId === ov.id || draggingOverlayId === ov.id || resizingOverlayId === ov.id;
                         const ovFilter = getFilterStyle(ov.editState || {}, `zint-${ov.id}`);
                         return (
                           <div 
                             key={ov.id} 
                             data-id={ov.id} 
                             className={cn(
                               "layer-container absolute border-2 transition-opacity",
                               isSelected ? "border-blue-500 z-50 is-dragging" : "border-transparent hover:border-blue-500/50"
                             )} 
                             style={{ 
                               left: ov.x, 
                               top: ov.y, 
                               width: ov.width, 
                               height: ov.height, 
                               cursor: activeTool === 'none' ? 'move' : 'default',
                               opacity: ((ov.opacity ?? 100) / 100) * (ovFilter.opacity ?? 1),
                               transform: `rotate(${ov.rotation ?? 0}deg)`,
                               transformOrigin: 'center center',
                               zIndex: isSelected ? 50 : idx + 1
                             }}
                           >
                            <img 
                              src={resolveImageUrl(ov.url)} 
                              className="w-full h-full object-fill pointer-events-none" 
                              style={{ filter: ovFilter.filter }}
                            />
                            <div className="layer-handle handle-nw" style={{ display: isSelected ? 'block' : undefined }}></div>
                            <div className="layer-handle handle-ne" style={{ display: isSelected ? 'block' : undefined }}></div>
                            <div className="layer-handle handle-sw" style={{ display: isSelected ? 'block' : undefined }}></div>
                            <div className="layer-handle handle-se" style={{ display: isSelected ? 'block' : undefined }}></div>
                            <div className="layer-rotate-handle" style={{ display: isSelected ? 'block' : undefined }}></div>
                          </div>
                        );
                      })}                      {(activeTool === 'magic_wand' || activeTool === 'brush_selection') && selectionMask && <img src={selectionMask} className="absolute inset-0 w-full h-full object-contain pointer-events-none z-40 mix-blend-screen opacity-80" style={{ left: 0, top: 0 }} />}
                      <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible z-50" style={{ left: 0, top: 0 }}>
                        {activeTool === 'brush_selection' && <circle cx={mousePos.x} cy={mousePos.y} r={brushSize / 2} fill="rgba(34, 197, 94, 0.2)" stroke="#22c55e" strokeWidth="1" strokeDasharray="4" />}
                        {activeTool === 'smudge' && <circle cx={mousePos.x} cy={mousePos.y} r={brushSize / 2} fill="rgba(34, 197, 94, 0.15)" stroke="#22c55e" strokeWidth="1" strokeDasharray="3" />}
                        
                        {/* Guías de Selección: Solo dibujar la que corresponda a la herramienta o datos activos */}
                        {(activeTool === 'crop_rect' || (activeTool === 'shape' && shapeType === 'rectangle')) && cropRect.width > 0 && (
                          <rect x={cropRect.x} y={cropRect.y} width={cropRect.width} height={cropRect.height} fill="rgba(59, 130, 246, 0.2)" stroke="#3b82f6" strokeWidth="2" strokeDasharray="4" />
                        )}
                        
                        {activeTool === 'crop_free' && (freePoints.length > 0 || freeDragging) && (() => {
                          const renderAnchors = freeDragging && freeDragAnchor ? [...freePoints, freeDragAnchor] : freePoints;
                          const last = freePoints.length > 0 ? freePoints[freePoints.length - 1] : null;
                          return (
                            <>
                              <path
                                d={bezierPathD(renderAnchors, freeClosed && !freeDragging)}
                                fill={freeClosed ? "rgba(59, 130, 246, 0.18)" : "rgba(59, 130, 246, 0.1)"}
                                stroke="#3b82f6"
                                strokeWidth="2"
                                strokeDasharray={freeClosed ? undefined : "4"}
                              />
                              {/* Línea goma al cursor cuando no se está arrastrando ni cerrado */}
                              {!freeDragging && !freeClosed && last && (
                                <line x1={last.x} y1={last.y} x2={mousePos.x} y2={mousePos.y} stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4" opacity={0.6} />
                              )}
                              {/* Mangos del ancla en arrastre */}
                              {freeDragging && freeDragAnchor && (
                                <>
                                  <line x1={freeDragAnchor.x} y1={freeDragAnchor.y} x2={freeDragAnchor.hOutX} y2={freeDragAnchor.hOutY} stroke="#3b82f6" strokeWidth="1" opacity={0.9} />
                                  <line x1={freeDragAnchor.x} y1={freeDragAnchor.y} x2={freeDragAnchor.hInX} y2={freeDragAnchor.hInY} stroke="#3b82f6" strokeWidth="1" opacity={0.9} />
                                  <circle cx={freeDragAnchor.hOutX} cy={freeDragAnchor.hOutY} r={4} fill="#3b82f6" />
                                  <circle cx={freeDragAnchor.hInX} cy={freeDragAnchor.hInY} r={4} fill="#3b82f6" />
                                  <circle cx={freeDragAnchor.x} cy={freeDragAnchor.y} r={5} fill="#fff" stroke="#3b82f6" strokeWidth="2" />
                                </>
                              )}
                              {/* Vértices fijados */}
                              {freePoints.map((a, i) => (
                                <circle key={i} cx={a.x} cy={a.y} r={3} fill="#fff" stroke="#3b82f6" strokeWidth="1.5" />
                              ))}
                            </>
                          );
                        })()}

                        {((activeTool === 'shape' && shapeType === 'circle') || (activeTool === 'paint_bucket' && shapeType === 'circle' && cropRect.width > 0)) && cropRect.width > 0 && (
                          <ellipse 
                            cx={cropRect.x + cropRect.width / 2} 
                            cy={cropRect.y + cropRect.height / 2} 
                            rx={cropRect.width / 2} 
                            ry={cropRect.height / 2} 
                            fill="rgba(59, 130, 246, 0.2)" 
                            stroke="#3b82f6" 
                            strokeWidth="2" 
                            strokeDasharray="4" 
                          />
                        )}

                        {(activeTool === 'shape' && shapeType === 'line' || (activeTool === 'paint_bucket' && shapeType === 'line' && polygonPath.length > 0)) && polygonPath.length > 0 && (() => {
                          const renderAnchors = polyDragging && polyDragAnchor ? [...polygonPath, polyDragAnchor] : polygonPath;
                          const last = polygonPath.length > 0 ? polygonPath[polygonPath.length - 1] : null;
                          return (
                            <>
                              <path
                                d={bezierPathD(renderAnchors, polyClosed && !polyDragging)}
                                fill={polyClosed ? "rgba(59, 130, 246, 0.18)" : "rgba(59, 130, 246, 0.1)"}
                                stroke="#3b82f6"
                                strokeWidth="2"
                                strokeDasharray={polyClosed ? undefined : "4"}
                              />
                              {/* Línea goma al cursor cuando no se está arrastrando ni cerrado */}
                              {!polyDragging && !polyClosed && last && activeTool === 'shape' && (
                                <line x1={last.x} y1={last.y} x2={mousePos.x} y2={mousePos.y} stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4" opacity={0.6} />
                              )}
                              {/* Mangos del ancla en arrastre */}
                              {polyDragging && polyDragAnchor && (
                                <>
                                  <line x1={polyDragAnchor.x} y1={polyDragAnchor.y} x2={polyDragAnchor.hOutX} y2={polyDragAnchor.hOutY} stroke="#3b82f6" strokeWidth="1" opacity={0.9} />
                                  <line x1={polyDragAnchor.x} y1={polyDragAnchor.y} x2={polyDragAnchor.hInX} y2={polyDragAnchor.hInY} stroke="#3b82f6" strokeWidth="1" opacity={0.9} />
                                  <circle cx={polyDragAnchor.hOutX} cy={polyDragAnchor.hOutY} r={4} fill="#3b82f6" />
                                  <circle cx={polyDragAnchor.hInX} cy={polyDragAnchor.hInY} r={4} fill="#3b82f6" />
                                  <circle cx={polyDragAnchor.x} cy={polyDragAnchor.y} r={5} fill="#fff" stroke="#3b82f6" strokeWidth="2" />
                                </>
                              )}
                              {/* Vértices fijados */}
                              {polygonPath.map((a, i) => (
                                <circle key={i} cx={a.x} cy={a.y} r={3} fill="#fff" stroke="#3b82f6" strokeWidth="1.5" />
                              ))}
                            </>
                          );
                        })()}
                      </svg>
                    </div>
                  ) : (
                <div className="flex flex-col items-center justify-center space-y-8 animate-in fade-in zoom-in duration-500">
                  <div className="relative">
                    {/* Anillo de brillo exterior */}
                    <div className="absolute -inset-4 bg-blue-500/20 rounded-full blur-2xl animate-pulse" />
                    
                    {/* Círculo principal con borde neón */}
                    <div className="relative p-12 bg-gray-900/80 rounded-full border-2 border-dashed border-blue-500/50 shadow-[0_0_30px_rgba(59,130,246,0.2)] flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-blue-500/10 to-green-500/10" />
                      <ImageIcon className="w-24 h-24 text-blue-400 drop-shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
                    </div>

                    {/* Mini iconos decorativos */}
                    <div className="absolute -top-2 -right-2 p-2 bg-gray-800 rounded-lg border border-gray-700 shadow-xl rotate-12">
                      <Plus className="w-4 h-4 text-green-400" />
                    </div>
                    <div className="absolute -bottom-2 -left-2 p-2 bg-gray-800 rounded-lg border border-gray-700 shadow-xl -rotate-12">
                      <Clipboard className="w-4 h-4 text-yellow-400" />
                    </div>
                  </div>

                  <div className="text-center space-y-2 relative">
                    <h3 className="text-2xl font-black uppercase tracking-[0.3em] bg-gradient-to-r from-blue-400 to-green-400 bg-clip-text text-transparent drop-shadow-sm">
                      {t('editorHTML.image.toolbar.emptyCanvas')}
                    </h3>
                    <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest max-w-[250px] mx-auto leading-relaxed">
                      {t('editorHTML.image.toolbar.emptyCanvasDescription')}
                    </p>
                  </div>

                  <Button 
                    ref={exploreButtonRef}
                    onClick={openLocalImageFolder} 
                    className="group relative px-10 h-12 bg-transparent overflow-hidden rounded-xl transition-all"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-green-600 opacity-80 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute inset-0 shadow-[inset_0_0_20px_rgba(255,255,255,0.2)]" />
                    <div className="relative flex items-center gap-3 text-white font-black uppercase text-xs tracking-widest">
                      <HardDrive className="w-4 h-4" />
                      {t('editorHTML.image.toolbar.exploreLocalFiles')}
                    </div>
                  </Button>
                </div>
              )}
            </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal isOpen={isSaveModalOpen} onClose={() => setIsSaveModalOpen(false)} title={t('editorHTML.image.toolbar.saveProjectModal')} size="md">
        <SaveImageProjectForm 
          onSave={saveProjectLocal} 
          onClose={() => setIsSaveModalOpen(false)} 
          isSaving={isSavingProject} 
          initialFiles={Array.from(fileCache.current.values())}
        />
      </Modal>
      <Modal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} title={t('editorHTML.image.toolbar.exportImageModal')} size="md">
        <div className="p-6 space-y-4 text-white">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-gray-500">{t('editorHTML.image.toolbar.fileName')}</label>
            <div className="relative">
              <input
                ref={exportTitleRef}
                value={exportConfig.title}
                onChange={e => setExportConfig({...exportConfig, title: e.target.value})}
                className="w-full bg-gray-900 border border-gray-800 p-3 rounded-lg text-white outline-none focus:ring-2 focus:ring-green-500"
                placeholder={t('editorHTML.image.toolbar.fileNamePlaceholder')}
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-gray-500">{t('editorHTML.image.toolbar.imageFormat')}</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'PNG', value: 'image/png' },
                { label: 'JPG', value: 'image/jpeg' },
                { label: 'WEBP', value: 'image/webp' }
              ].map((f) => (
                <button
                  key={f.value}
                  onClick={() => setExportConfig({...exportConfig, format: f.value})}
                  className={cn(
                    "py-3 rounded-lg border text-[10px] font-black tracking-widest transition-all",
                    exportConfig.format === f.value 
                      ? "bg-green-600 border-green-500 text-white shadow-[0_0_15px_rgba(34,197,94,0.3)]" 
                      : "bg-gray-900 border-gray-800 text-gray-500 hover:border-gray-700"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4">
            <Button 
              onClick={handleExportImage} 
              disabled={isExporting || !exportConfig.title.trim()} 
              className="w-full bg-green-600 hover:bg-green-700 h-14 font-black uppercase tracking-[0.2em] shadow-xl"
            >
              {isExporting ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Download className="w-5 h-5 mr-2" />}
              {t('editorHTML.image.toolbar.exportToLocalFolder')}
            </Button>
            <p className="text-[9px] text-center text-gray-500 mt-4 uppercase tracking-tighter">
              {t('editorHTML.image.toolbar.exportDescription')}
            </p>
          </div>
        </div>
      </Modal>
      
      {/* Modal de Carga Unificado */}
      <Modal 
        isOpen={isLoadModalOpen || isUploaderOpen} 
        onClose={() => { 
          setIsLoadModalOpen(false); 
          setIsUploaderOpen(false);
          setPbLoadStep('collection');
          setSelectedPbRecordFiles(null);
          setSelectedPbCollection(null);
          setFileNotAllowedMessage(null);
        }} 
        title={
          loadType === 'proyectos' ? t('editorHTML.image.toolbar.loadLocalProject') : 
          loadType === 'local' ? t('editorHTML.image.toolbar.localImages') :
          pbLoadStep === 'collection' ? t('editorHTML.image.toolbar.selectCollection') : 
          pbLoadStep === 'record' ? t('editorHTML.image.toolbar.selectRecord') : t('editorHTML.image.toolbar.selectFile')
        } 
        size="lg"
      >
        <div 
          className="p-4 space-y-3 max-h-[60vh] overflow-y-auto scrollbar-modal-images" 
        >
          {fileNotAllowedMessage && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">{fileNotAllowedMessage}</div>
          )}

          {/* Navegación para PocketBase */}
          {loadType === 'archivos' && pbLoadStep === 'record' && (
            <button type="button" onClick={() => { setPbLoadStep('collection'); setSelectedPbCollection(null); setPbRecords([]); }} className="flex items-center gap-2 text-gray-400 hover:text-white mb-2">
              <ChevronLeft className="w-4 h-4" /> Volver a colecciones
            </button>
          )}
          {loadType === 'archivos' && pbLoadStep === 'file' && (
            <button type="button" onClick={() => { setPbLoadStep('record'); setSelectedPbRecordFiles(null); }} className="flex items-center gap-2 text-gray-400 hover:text-white mb-2">
              <ChevronLeft className="w-4 h-4" /> Volver a registros
            </button>
          )}

          {/* Renderizado de Proyectos Locales */}
          {loadType === 'proyectos' && (
            <div className="space-y-4">
              {pbLoading && savedProjects.length === 0 && <p className="text-center py-10 text-gray-500 italic flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t('editorHTML.image.toolbar.scanningProjects')}</p>}
              {!pbLoading && savedProjects.length === 0 && <p className="text-center py-10 text-gray-500 italic">{t('editorHTML.image.toolbar.noLocalProjects')}</p>}
              <div className="grid grid-cols-1 gap-2">
                {savedProjects.map((p, i) => (
                  <div key={i} onClick={() => handleOpenLocalProject(p)} className="flex items-center justify-between p-4 bg-gray-800 rounded-xl hover:bg-gray-700 cursor-pointer group transition-all border border-transparent hover:border-green-500/30">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="p-2 bg-green-500/20 rounded-lg group-hover:bg-green-500/40 transition-colors">
                        <ImageIcon className="w-5 h-5 text-green-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-white text-sm truncate">{p.titulo}</h4>
                        <p className="text-[10px] text-gray-500 truncate">{p.path}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="px-3 py-1 bg-green-600 text-white rounded-lg text-[10px] font-black uppercase">{t('editorHTML.image.toolbar.open')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Renderizado de Imágenes Locales */}
          {loadType === 'local' && (
            <div className="space-y-4">
              {pbLoading && localFolderFiles.length === 0 && <p className="text-center py-10 text-gray-500 italic flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Escaneando carpeta...</p>}
              {!pbLoading && localFolderFiles.length === 0 && <p className="text-center py-10 text-gray-500 italic">{t('editorHTML.image.toolbar.noImagesFound')}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {localFolderFiles.map((f, i) => (
                  <div key={i} onClick={() => { updateActiveTab({ url: `${getMediaUrl(f.path)}` }); setIsUploaderOpen(false); resetFilters(); }} className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-xl hover:bg-blue-600/20 cursor-pointer group border border-gray-700/50 hover:border-blue-500/30 transition-all">
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-950 shrink-0 border border-white/5">
                      <img src={`${getMediaUrl(f.path)}`} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs font-bold text-gray-200 truncate group-hover:text-white">{cleanDisplayFileName(f.name || f.fileName)}</h4>
                      <p className="text-[9px] text-gray-500 truncate uppercase">{f.path.split('.').pop()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Renderizado de PocketBase */}
          {loadType === 'archivos' && pbLoadStep === 'collection' && (
            <div className="grid grid-cols-1 gap-2">
              {pbCollections.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-4 bg-gray-800 rounded-xl hover:bg-gray-700 cursor-pointer" onClick={() => fetchPbRecordsForCollection(c.name)}>
                  <Folder className="w-5 h-5 text-amber-500" /><span className="font-medium text-white">{c.name}</span>
                </div>
              ))}
            </div>
          )}
          {loadType === 'archivos' && pbLoadStep === 'record' && (
            <div className="grid grid-cols-1 gap-2">
              {pbRecords.map((r) => (
                <div key={r.recordId} className="flex items-center gap-3 p-4 bg-gray-800 rounded-xl hover:bg-gray-700 cursor-pointer" onClick={() => selectPbRecordForFiles(r)}>
                  <FileImage className="w-5 h-5 text-purple-400" />
                  <div><span className="font-medium text-white">{r.recordName}</span><p className="text-[10px] text-gray-500">{r.files.length} archivo(s)</p></div>
                </div>
              ))}
            </div>
          )}
          {loadType === 'archivos' && pbLoadStep === 'file' && selectedPbRecordFiles && (
            <div className="grid grid-cols-1 gap-2">
              {selectedPbRecordFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-3 p-4 bg-gray-800 rounded-xl hover:bg-gray-700 cursor-pointer" onClick={() => addOneImageFromPb(f)}>
                  <FileImage className="w-5 h-5 text-purple-400" /><span className="font-medium text-white truncate">{cleanDisplayFileName(f.fileName)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <Modal isOpen={isNewCanvasModalOpen} onClose={() => setIsNewCanvasModalOpen(false)} title="{t('editorHTML.image.toolbar.newCanvas')}" size="sm">
        <div className="p-6 space-y-4 text-white">
          {copiedSelection && (
            <div className="pb-4 border-b border-gray-800">
              <Button 
                onClick={createCanvasFromClipboard}
                className="w-full bg-blue-600 hover:bg-blue-700 h-14 font-black uppercase tracking-[0.1em] shadow-xl flex items-center justify-center gap-2"
              >
                <Clipboard className="w-5 h-5" />
                Desde el portapapeles ({copiedSelection.width}x{copiedSelection.height})
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-gray-500">{t('editorHTML.image.toolbar.canvasWidthPx')}</label>
              <input
                type="number"
                value={newCanvasWidth}
                onChange={e => setNewCanvasWidth(parseInt(e.target.value) || 0)}
                className="w-full bg-gray-900 border border-gray-800 p-3 rounded-lg text-white outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-gray-500">{t('editorHTML.image.toolbar.canvasHeightPx')}</label>
              <input
                type="number"
                value={newCanvasHeight}
                onChange={e => setNewCanvasHeight(parseInt(e.target.value) || 0)}
                className="w-full bg-gray-900 border border-gray-800 p-3 rounded-lg text-white outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          <div className="pt-4">
            <Button 
              onClick={() => createNewCanvas(newCanvasWidth, newCanvasHeight)} 
              className="w-full bg-green-600 hover:bg-green-700 h-14 font-black uppercase tracking-[0.2em] shadow-xl"
            >
              Crear Lienzo
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
