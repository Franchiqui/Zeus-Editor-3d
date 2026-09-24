# Editores 3D - Zeus Media Studio

## Editor 3D Principal

El **Editor 3D** es el módulo central de la aplicación que permite crear, editar y visualizar objetos tridimensionales con tres modos de creación:

1. **Vistas (Views)**: Creación de figuras 3D a partir de vistas ortogonales
2. **Texto a 3D**: Conversión de texto a modelos tridimensionales
3. **Torno (Lathe)**: Creación de objetos simétricos mediante perfil de torno

---

## Estructura del Componente

```typescript
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import DrawingCanvas from '@/components/drawing-canvas';
import EditorCanvas from '@/components/editor-canvas';
import Viewer3D from '@/components/viewer-3d';
import type { ObjectTransform } from '@/components/viewer-3d';
import { IDENTITY_TRANSFORM } from '@/components/viewer-3d';
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
  type LatheTextureProjection,
  type TextureFinish,
} from '@/lib/geometry';
import { buildViewsMesh } from '@/lib/views-mesh';
import {
  buildTextMesh,
  buildTextPlaneMesh,
  FONT_OPTIONS,
  isNearWhite,
  type FontOption,
} from '@/lib/text-voxel';
import { buildSmoothTextMesh } from '@/lib/text-outline';
import { Modal } from '@/components/ui/modal';
import {
  isElectron,
  getLocalPaths,
  listDirectory,
  readProject,
  saveProject,
} from '@/lib/electron-fs';
import {
  Boxes,
  RefreshCw,
  AlertCircle,
  Info,
  Download,
  Type,
  PenTool,
  Plus,
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
  Copy,
  ClipboardPaste,
} from 'lucide-react';

const EditorCanvasComponent = EditorCanvas as unknown as ComponentType<any>;
```

---

## Tipos de Datos

### Modo de Edición

```typescript
type Mode = 'views' | 'text' | 'lathe';
```

### Clip del Editor

```typescript
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
  textMode: 'voxel' | 'plane' | 'smooth';
  useFontColor: boolean;
  baseColor: string;
  figureColor: string;
  texture: string | null;
  textureProjection: LatheTextureProjection;
  textureFinish: TextureFinish;
  textureRelief: number;
  editedVertices: Vertex3D[] | null;
  latheProfile: Polygon;
  latheTexture: string | null;
  latheOpacity: number;
  latheSegments: number;
  latheClamp: boolean;
  latheFigureColor: string;
};
```

### Objeto Escena

```typescript
type SceneObject = {
  id: string;
  transform: ObjectTransform;
};
```

### Opciones de Fuente

```typescript
type FontOption = {
  label: string;
  css: string;
  google: boolean;
};
```

### Proyección de Textura

```typescript
type LatheTextureProjection = 'cylindrical' | 'planar' | 'spherical';

type TextureFinish = 'glossy' | 'semi-matte' | 'matte';
```

### Etiquetas de Vistas

```typescript
const VIEW_LABELS: Record<keyof Views, { label: string; axisLabel: string }> = {
  front: { label: 'Frente', axisLabel: 'X·Y' },
  side: { label: 'Costado', axisLabel: 'Z·Y' },
  top: { label: 'Superior', axisLabel: 'X·Z' },
};
```

---

## Variables de Estado Principales

### Variables de Vistas

```typescript
const [views, setViews] = useState<Views>(DEFAULT_VIEWS);
const [editedVertices, setEditedVertices] = useState<Vertex3D[] | null>(null);
const [resolution, setResolution] = useState(32);

const [meshStyle, setMeshStyle] = useState<
  'fusionada' | 'suave' | 'voxeles'
>('suave');

const [editingView, setEditingView] = useState<keyof Views | null>(null);
const [editingLathe, setEditingLathe] = useState(false);
const [editorGridResolution, setEditorGridResolution] = useState(32);
const [editorCanvasZoom, setEditorCanvasZoom] = useState(1);
```

### Variables de Modo

```typescript
const [mode, setMode] = useState<Mode>('views');
```

### Variables de Texto

```typescript
const [editorClipboard, setEditorClipboard] = useState<EditorClipboard | null>(null);
const [text, setText] = useState('HOLA');
const [fontCss, setFontCss] = useState(FONT_OPTIONS[0].css);
const [textDepth, setTextDepth] = useState(6);
const [hollowText, setHollowText] = useState(false);
const [greedyMesh, setGreedyMesh] = useState(true);
const [textRes, setTextRes] = useState(24);

const [textMode, setTextMode] = useState<'voxel' | 'plane' | 'smooth'(
  'voxel'
);
```

### Variables de Textura

```typescript
const [texture, setTexture] = useState<string | null>(null);
const textureInputRef = useRef<HTMLInputElement | null>(null);
const [textureFileName, setTextureFileName] = useState('');
const [textureProjection, setTextureProjection] =
  useState<LatheTextureProjection>('cylindrical');
const [textureFinish, setTextureFinish] = useState<TextureFinish>('semi-matte');
const [textureRelief, setTextureRelief] = useState(0.25);
```

### Variables de Color

```typescript
const [useFontColor, setUseFontColor] = useState(true);
const [baseColor, setBaseColor] = useState('#e8e8e8');

const [figureColor, setFigureColor] = useState('#121ca7');
const [latheFigureColor, setLatheFigureColor] = useState('#121ca7');
```

### Variables de Torno

```typescript
const [latheProfile, setLatheProfile] = useState<Polygon>(DEFAULT_LATHE_PROFILE);
const [latheTexture, setLatheTexture] = useState<string | null>(null);
const [latheTextureFileName, setLatheTextureFileName] = useState('');
const [latheOpacity, setLatheOpacity] = useState(1);
const [latheSegments, setLatheSegments] = useState(32);
const [latheClamp, setLatheClamp] = useState(true);
```

### Variables de Historial

```typescript
const [history, setHistory] = useState<Array<{
  views: Views;
  editedVertices: Vertex3D[] | null;
  text: string;
  fontCss: string;
  textDepth: number;
  hollowText: boolean;
  greedyMesh: boolean;
  textRes: number;
  textOpacity: number;
  textMode: 'voxel' | 'plane' | 'smooth';
  useFontColor: boolean;
  baseColor: string;
  figureColor: string;
  texture: string | null;
}>>>([]);
const [historyIndex, setHistoryIndex] = useState(-1);
const [isUndoRedo, setIsUndoRedo] = useState(false);
```

### Variables de Fuentes

```typescript
const [customFonts, setCustomFonts] = useState<FontOption[]>([]);
const [customFontName, setCustomFontName] = useState('');
const [importing, setImporting] = useState(false);
const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(
  null
);

const localFontInputRef = useRef<HTMLInputElement | null>(null);
const [localFontFileName, setLocalFontFileName] = useState('');
const [localFontLoading, setLocalFontLoading] = useState(false);
const [localFontMsg, setLocalFontMsg] = useState<{ ok: boolean; text: string } | null>(
  null
);
```

### Variables de Guardado

```typescript
const [saveModalOpen, setSaveModalOpen] = useState(false);
const [objectName, setObjectName] = useState('');
const [savingObject, setSavingObject] = useState(false);
const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(
  null
);
const [loadModalOpen, setLoadModalOpen] = useState(false);
const [savedObjects, setSavedObjects] = useState<
  Array<{ name: string; path: string; size?: number }>
>([]);
const [loadingObjects, setLoadingObjects] = useState(false);
const [loadMsg, setLoadMsg] = useState<{ ok: boolean; text: string } | null>(
  null
);
```

---

## Funciones Principales

### Manejo de Historial

```typescript
// Restaurar estilo de malla
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
```

### Importar Fuente de Google Fonts

```typescript
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
```

### Abrir Catálogo de Google Fonts

```typescript
const openGoogleFonts = useCallback(() => {
  window.open('https://fonts.google.com', '_blank', 'noopener,noreferrer');
}, []);
```

### Manejar Archivo de Fuente Local

```typescript
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
      file.name.replace(/\.[^.]*$/, '').replace(/[^\w\s-]/g, '').trim() ||
      'Fuente local';
    const familyName = `LocalFont-${baseName.replace(/\s+/g, '')}`;

    // ... (código completo de carga de fuente local)
  } catch {
    setLocalFontMsg({ ok: false, text: 'Error al cargar la fuente' });
  } finally {
    setLocalFontLoading(false);
  }
}, []);
```

### Abrir Selector de Fuente Local

```typescript
const openLocalFontPicker = useCallback(() => {
  const input = localFontInputRef.current;
  if (input) {
    input.click();
  }
}, [localFontInputRef]);
```

### Manejar Archivo de Textura

```typescript
const handleTextureFile = useCallback(async (file: File) => {
  if (!file) return;
  setTextureFileName(file.name);
  setTexture(null); // Reset texture URL

  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const slice = bytes.subarray(i, i + chunk);
      for (let j = 0; j < slice.length; j++) {
        binary += String.fromCharCode(slice[j]);
      }
    }
    const base64 = btoa(binary);
    setTexture(`data:image/png;base64,${base64}`);
    setImportMsg({ ok: true, text: `Imagen cargada: ${file.name}` });
  } catch {
    setImportMsg({ ok: false, text: 'Error al cargar la imagen' });
  }
}, []);
```

### Abrir Selector de Textura

```typescript
const openTexturePicker = useCallback(() => {
  const input = textureInputRef.current;
  if (input) {
    input.click();
  }
}, [textureInputRef]);
```

### Guardar Objeto 3D

```typescript
const saveObject = useCallback(async () => {
  if (!objectName.trim()) {
    setSaveMsg({ ok: false, text: 'El nombre del objeto es requerido' });
    return;
  }

  setSavingObject(true);
  setSaveMsg(null);

  try {
    const paths = getLocalPaths();
    const objectsPath = paths.objects3D || paths.assets3D;
    if (!objectsPath) {
      setSaveMsg({ ok: false, text: 'Configura primero la carpeta de Objetos 3D' });
      return;
    }

    const fileName = `${objectName.replace(/[^a-zA-Z0-9_-]/g, '-')}.zeus`;
    const filePath = `${objectsPath}/${fileName}`;

    const data = {
      mode,
      views,
      editedVertices,
      text,
      fontCss,
      textDepth,
      hollowText,
      greedyMesh,
      textRes,
      textOpacity,
      textMode,
      useFontColor,
      baseColor,
      figureColor,
      texture,
      textureProjection,
      textureFinish,
      textureRelief,
      latheProfile,
      latheTexture,
      latheOpacity,
      latheSegments,
      latheClamp,
      latheFigureColor,
      resolution,
      meshStyle,
    };

    await saveProject(filePath, data);
    setSaveMsg({ ok: true, text: `Objeto guardado en ${filePath}` });
    setSaveModalOpen(false);
  } catch (error) {
    setSaveMsg({ ok: false, text: 'Error al guardar el objeto' });
  } finally {
    setSavingObject(false);
  }
}, [
  mode,
  views,
  editedVertices,
  text,
  fontCss,
  textDepth,
  hollowText,
  greedyMesh,
  textRes,
  textOpacity,
  textMode,
  useFontColor,
  baseColor,
  figureColor,
  texture,
  textureProjection,
  textureFinish,
  textureRelief,
  latheProfile,
  latheTexture,
  latheOpacity,
  latheSegments,
  latheClamp,
  latheFigureColor,
  resolution,
  meshStyle,
  objectName,
]);
```

### Cargar Objeto 3D

```typescript
const loadObject = useCallback(async (file: File) => {
  setLoadMsg(null);
  setLoadingObjects(true);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const data = JSON.parse(atob(arrayBuffer.toString()));

    setViews(data.views);
    setEditedVertices(data.editedVertices);
    setText(data.text);
    setFontCss(data.fontCss);
    setTextDepth(data.textDepth);
    setHollowText(data.hollowText);
    setGreedyMesh(data.greedyMesh);
    setTextRes(data.textRes);
    setTextOpacity(data.textOpacity);
    setTextMode(data.textMode);
    setUseFontColor(data.useFontColor);
    setBaseColor(data.baseColor);
    setFigureColor(data.figureColor);
    setTexture(data.texture);
    setTextureFileName(data.textureFileName || '');
    setTextureProjection(data.textureProjection);
    setTextureFinish(data.textureFinish);
    setTextureRelief(data.textureRelief);
    setLatheProfile(data.latheProfile);
    setLatheTexture(data.latheTexture);
    setLatheTextureFileName(data.latheTextureFileName || '');
    setLatheOpacity(data.latheOpacity);
    setLatheSegments(data.latheSegments);
    setLatheClamp(data.latheClamp);
    setLatheFigureColor(data.latheFigureColor);
    setResolution(data.resolution);
    setMeshStyle(data.meshStyle);

    setLoadMsg({ ok: true, text: `Objeto cargado: ${file.name}` });
    setLoadModalOpen(false);
  } catch {
    setLoadMsg({ ok: false, text: 'Error al cargar el objeto' });
  } finally {
    setLoadingObjects(false);
  }
}, []);
```

### Manejar Transformación de Objeto

```typescript
const handleObjectTransform = useCallback((transform: ObjectTransform) => {
  setSceneObjects((prev) =>
    prev.map((obj) =>
      obj.id === selectedObjectId ? { ...obj, transform } : obj
    )
  );
}, [selectedObjectId]);
```

### Manejar Cambios de Vértices

```typescript
const handleVerticesChange = useCallback((vertices: Vertex3D[]) => {
  setEditedVertices(vertices);
}, []);
```

### Actualizar Vista

```typescript
const updateView = useCallback(
  (view: keyof Views) => (newPolygon: Polygon) => {
    setViews((prev) => ({
      ...prev,
      [view]: newPolygon,
    }));
  },
  []
);
```

---

## Modos de Edición

### 1. Modo Vistas (Views)

El modo principal para crear figuras 3D mediante vistas ortogonales.

**Variables:**
- `views`: Vistas ortogonales (frente, costado, superior)
- `meshStyle`: Estilo de malla ('fusionada', 'suave', 'voxeles')
- `resolution`: Resolución de las vistas (default: 32)
- `editingView`: Vista actualmente siendo editada
- `editingLathe`: Estado de edición de torno

**Componentes:**
- `DrawingCanvas`: Para dibujar las vistas ortogonales
- `Viewer3D`: Para visualizar el modelo 3D resultante

**Estilos de Malla:**
- **Fusionada**: Las caras planas se fusionan en rectángulos grandes
- **Suave**: Curvas y diagonales lisas, sin escalones
- **Vóxeles**: Rasterizado en rejilla con escalones visibles

### 2. Modo Texto a 3D

Convierte texto en modelos tridimensionales con varias opciones de renderizado.

**Variables:**
- `text`: Texto a convertir
- `fontCss`: Fuente CSS seleccionada
- `textDepth`: Profundidad del texto (1-48)
- `hollowText`: Letras huecas (solo contorno)
- `greedyMesh`: Malla optimizada sin divisiones internas
- `textRes`: Resolución del texto (12-144)
- `textOpacity`: Opacidad del costado (solo en modo suave)
- `textMode`: Modo de salida ('voxel', 'plane', 'smooth')

**Modos de Salida de Texto:**
- **Vóxeles 3D**: Rasteriza el texto a una rejilla y extruye cada celda
- **Suave**: Extruye el contorno real de la letra con curvas lisas
- **Vista plana**: Copia el color exacto del texto tal como se ve en pantalla

**Opciones de Textura:**
- `texture`: Imagen aplicada como textura
- `textureProjection`: Proyección ('cylindrical', 'planar', 'spherical')
- `textureFinish`: Acabado ('glossy', 'semi-matte', 'matte')
- `textureRelief`: Relieve de la textura (0-100%)

### 3. Modo Torno (Lathe)

Crea objetos 3D simétricos rotando un perfil alrededor del eje vertical.

**Variables:**
- `latheProfile`: Perfil del torno (Polygon)
- `latheTexture`: Textura aplicada al objeto
- `latheOpacity`: Opacidad del torno (0-1)
- `latheSegments`: Segmentos de rotación (8-128)
- `latheClamp`: Cerrar extremos con tapas
- `latheFigureColor`: Color de la figura

**Componentes:**
- `DrawingCanvas`: Para dibujar el perfil del torno
- `Viewer3D`: Para visualizar el modelo 3D resultante

**Opciones de Malla:**
- **Suave**: Contorno real con curvas lisas
- **Fusionada**: Caras planas fusionadas
- **Vóxeles**: Rasterizado en rejilla

---

## Gestión de Fuentes

### Fuentes de Google Fonts

```typescript
const FONT_OPTIONS: FontOption[] = [
  // Lista de fuentes preconfiguradas
];
```

**Funciones:**
- `importFont()`: Importa una fuente desde Google Fonts por nombre
- `openGoogleFonts()`: Abre el catálogo de Google Fonts en nueva pestaña
- `ensureStylesheet()`: Asegura que el CSS de la fuente esté cargado

### Fuentes Locales

```typescript
// Soporta: .ttf, .otf, .woff, .woff2
// Funciones:
// - openLocalFontPicker(): Abre selector de archivos locales
// - handleLocalFontFile(): Carga fuente desde archivo local
// - localFontInputRef: Referencia al input de archivo oculto
```

**Flujo de carga:**
1. Usuario selecciona archivo de fuente
2. Se convierte a base64
3. Se carga en el sistema de fuentes del navegador
4. Se añade a la lista de fuentes disponibles

---

## Gestión de Texturas

### Carga de Texturas

```typescript
// Soporta: JPG, PNG, WebP, SVG
// Funciones:
// - openTexturePicker(): Abre selector de archivos de imagen
// - handleTextureFile(): Carga imagen como textura
// - textureInputRef: Referencia al input de archivo oculto
```

**Propiedades de Textura:**
- `textureFileName`: Nombre del archivo
- `texture`: URL base64 de la imagen
- `textureProjection`: Cómo se proyecta la textura en el modelo
- `textureFinish`: Acabado de la textura
- `textureRelief`: Cuánto se eleva la textura del modelo

---

## Persistencia de Datos

### Guardado

```typescript
// Funciones:
// - saveObject(): Guarda el objeto actual en .zeus
// - saveModalOpen: Modal de guardado
// - objectName: Nombre del objeto
// - savingObject: Estado de guardado
// - saveMsg: Mensaje de resultado del guardado
```

### Carga

```typescript
// Funciones:
// - loadObject(): Carga objeto desde archivo .zeus
// - loadModalOpen: Modal de carga
// - savedObjects: Lista de objetos guardados
// - loadingObjects: Estado de carga
// - loadMsg: Mensaje de resultado de la carga
```

**Formato de archivo .zeus:**
```json
{
  "mode": "views" | "text" | "lathe",
  "views": { "front": [...], "side": [...], "top": [...] },
  "editedVertices": [...],
  "text": "texto",
  "fontCss": "font-family",
  "textDepth": 6,
  "hollowText": false,
  "greedyMesh": true,
  "textRes": 24,
  "textOpacity": 1,
  "textMode": "voxel",
  "useFontColor": true,
  "baseColor": "#e8e8e8",
  "figureColor": "#121ca7",
  "texture": "data:image/png;base64,...",
  "textureProjection": "cylindrical",
  "textureFinish": "semi-matte",
  "textureRelief": 0.25,
  "latheProfile": [...],
  "latheTexture": null,
  "latheOpacity": 1,
  "latheSegments": 32,
  "latheClamp": true,
  "latheFigureColor": "#121ca7",
  "resolution": 32,
  "meshStyle": "suave"
}
```

---

## Historial

```typescript
// Historial de cambios con undo/redo
// - history: Array de estados anteriores
// - historyIndex: Índice del estado actual en el historial
// - isUndoRedo: Estado de operación de historial
// - undo(): Deshacer último cambio
// - redo(): Rehacer cambio deshacer
```

**Lógica del historial:**
- Se guarda automáticamente cada 500ms
- Máximo 50 estados en el historial
- Detección de cambios idénticos para evitar duplicados
- Incluye todas las propiedades del objeto actual

---

## Componentes Internos

### EditorCanvasComponent

```typescript
const EditorCanvasComponent = EditorCanvas as unknown as ComponentType<any>;
```

Componente reutilizable para edición de vistas y perfiles de torno.

### Viewer3D

```typescript
import Viewer3D from '@/components/viewer-3d';
```

Visualizador 3D que muestra el modelo resultante con controles de transformación.

### DrawingCanvas

```typescript
import DrawingCanvas from '@/components/drawing-canvas';
```

Componente para dibujar vistas ortogonales y perfiles de torno.

---

## Constantes y Utilidades

```typescript
const DEFAULT_LATHE_PROFILE: Polygon = [
  { x: 0.3, y: -0.6 },
  { x: 0.8, y: -0.6 },
  { x: 0.8, y: 0.6 },
  { x: 0.3, y: 0.6 },
];

const DEFAULT_VIEWS: Views = {
  front: [...],
  side: [...],
  top: [...],
};

const HIGH_FIDELITY_RES = 64;
```

---

## Características Principales

1. **Creación 3D Multi-modo**: Vistas, texto y torno
2. **Múltiples Estilos de Malla**: Fusionada, suave, vóxeles
3. **Gestión de Fuentes**: Google Fonts y locales
4. **Texturas con Proyección**: Varias proyecciones y acabados
5. **Historial Completo**: Undo/redo con detección de cambios
6. **Persistencia**: Guardado y carga de objetos .zeus
7. **Edición de Vértices**: Modificación directa del modelo
8. **Transformación 3D**: Rotación, escala, posición
9. **Exportación a STL**: Preparación para impresión 3D
10. **Interfaz en Español**: Todo el UI en español

---

## Notas Técnicas

- Usa React 18 con hooks
- Componentes funcionales con `useClient`
- Librerías: Three.js para renderizado 3D, React Three Fiber
- Electron para funcionalidad de sistema de archivos
- CSS-in-JS para estilos
- Lucide React para iconos
- Tailwind CSS para UI
