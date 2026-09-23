# Documentación técnica — Zeus Editor 3D

> Aplicación de escritorio creada con **Zeus IA** (`www.zeus-ia.com`).
> Combina un motor de modelado 3D voxel/figura con un editor de animación,
> un sistema de plugins extensible, importación/exportación de modelos 3D.

---

## 1. Visión general

Zeus Editor 3D es una aplicación **Electron + Next.js 16** que permite:

- **Modelado 3D** en 5 modos de pestaña (vistas 2D, malla, texto, lathe/extrude).
- **Escena 3D** con múltiples objetos, cada uno con su propia malla, textura y transformada.
- **Animación** mediante el *Editor de movimiento*: pistas de transformada y pistas de parámetros de plugins.
- **Plugins** integrados que deforman o mejoran las mallas (equivalente a los modificadores de 3ds Max).
- **Import/Export** de modelos 3D (OBJ, STL, PLY, GLB) y de imágenes/sonido/video.
- **IA integrada**: puente con ComfyUI, Flux (generación de imágenes), separación de audio con Demucs, extracción de fuentes, y más.
- **7 idiomas** con el sistema de traducción `zustan` persistente.

---

## 2. Arquitectura técnica

### 2.1 Pilas tecnológicas

| Capa | Tecnologías |
|---|---|
| **Runtime nativo** | Electron 30 (main.js, IPC, diálogos, procesos hijos) |
| **Framework web** | Next.js 16 (App Router, SSR/Turbopack) |
| **UI Reactiva** | React 18, Zustand (stores), Tailwind CSS 3, Radix UI, dnd-kit |
| **3D** | Three.js 0.186, three-csg-ts (booleanas), react-three/fiber, drei |
| **Modelado** | Three.js (cálculo), algoritmos propios en `lib/` (voxel, suavizado Taubin, decimado, loft) |
| **Video/Audio** | FFmpeg (transcode, enhance), Demucs (separación de stems), mediabunny (reproductor rápido) |
| **IA** | ComfyUI (local), Flux bridge (imágenes), Ollama (chat de texto) |
| **Base de datos** | PocketBase (servidor local, puerto 8236, para presets/imágenes) |
| **Testing** | Jest + Testing Library, smoke tests (`smoke-plugins.test.js`) |

### 2.2 Patrón de arquitectura

```
┌─────────────────────────────────────────────────────┐
│  Electron Main (electron/main.js)                   │
│  ─ File system, diálogos, IPC, procesos hijos       │
├─────────────────────────────────────────────────────┤
│  Next.js Renderer (app/)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Editor3D     │  │ Viewer3D     │  │ Sidebar   │ │
│  │ (editor)     │◄┘(props/shared)│  │ (UI)      │ │
│  └──────────────┘                └───────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ MotionEditor │  │ PluginsModal │  │ KeyEditor │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
└─────────────────────────────────────────────────────┘
│  lib/ — motor de cálculo (pure TS, sin React)        │
└─────────────────────────────────────────────────────┘
```

### 2.3 Puente Electron ↔ Renderer

- **`lib/electron-fs.ts`** declara `window.electronAPI` (tipado global) con métodos como `fsReadProject`, `fsSaveProject`, `selectFolder`, `transcodeVideo`, `htmlToMp4`, etc.
- **`electron/main.js`** implementa el `ipcMain.handle` para cada método, incluyendo:
  - Gestión de ventanas (minimizar, maximizar, cerrar)
  - Diálogos de carpeta/archivo
  - Operaciones de archivo (`fs.*`)
  - Proyectos `.zeus` (guardar/leer con `JSON.stringify` + `structuredClone` para meshes)
  - Procesos hijos: `comfyuiProcess`, `fluxBridgeProcess`, `demucsProcess`, `textureApiProcess`, `pbProcess`
  - Transcodificación de video con FFmpeg
  - Separación de audio con Demucs (Python)
  - Renderizado HTML→MP4 con `mediabunny`
  - Captura de pantalla/overlay
- **`electron/preload.js`** expone `contextBridge` para todos los métodos.

---

## 3. Estructura del proyecto

```
zeus-editor-3d/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout, providers, i18n
│   ├── page.tsx                  # Página principal (shell de editors)
│   └── edit-3d/page.tsx          # Wrapper del Editor3D
├── electron/
│   ├── main.js                   # ~2000 líneas: IPC, procesos, zoom, menús
│   └── preload.js
├── components/
│   ├── editor/
│   │   ├── Editor3D.tsx          # ~9800 líneas: el núcleo del editor 3D
│   │   ├── MotionEditor.tsx      # Editor de animación (timeline)
│   │   ├── PluginsModal.tsx      # Modal de plugins con UI generada
│   │   ├── BooleanCSGModal.tsx   # Operaciones booleanas (unir, restar, intersección)
│   │   ├── keyframe-editor.tsx   # Editor de fotogramas de cámara
│   │   ├── viewer-panel.tsx      # Panel de vistas 2D/3D
│   │   └── MeshEditor.tsx        # Edición de vértices/mallas
│   ├── viewer-3d.tsx             # ~8700 líneas: motor 3D con Three.js
│   ├── MeshEditor.tsx            # Widget de edición de mallas
│   ├── drawging-canvas.tsx       # Canvas 2D para bocetos
│   ├── LightingModal.tsx         # Configuración de luces
│   ├── fx-config-editor.tsx      # Efectos de post-procesado
│   ├── texture-browser-modal.tsx # Navegador de texturas
│   ├── object-3d-preview.tsx     # Preview 3D interactivo
│   ├── ChatContext.tsx           # Chat con IA (Ollama/Claude)
│   ├── ChatHistorySidebar.tsx
│   ├── Providers.tsx
│   └── ui/                       # Componentes de Radix UI + Tailwind
├── lib/                          # Motor de cálculo puro (sin React)
│   ├── geometry.ts               # Tipos: Mesh, Vertex3D, ObjectTransform, SceneData...
│   ├── animation.ts              # Sistema de animación (tracks, keyframes, easing)
│   ├── mesh-export.ts            # Exportadores: OBJ, STL, PLY, GLB, mergeMeshes
│   ├── mesh-import.ts            # Importadores: OBJ, FBX, GLB, imágenes (heightmap)
│   ├── plugins/                  # Sistema de plugins
│   │   ├── index.ts              # Registro de plugins integrados
│   │   ├── types.ts              # Contrato ZeusPlugin, tipos de parámetros
│   │   ├── registry.ts           # Map reactivo con suscriptores
│   │   └── builtin/
│   │       ├── deformadores.ts   # Bend, Twist, Taper, Noise (4 plugins)
│   │       ├── utilidades.ts     # Smooth (Taubin), Decimate
│   │       ├── doblar.ts         # Bend (eje individual, 3 ejes)
│   │       ├── fragmentar.ts     # Explosión/fragmentación
│   │       └── disolver.ts       # Efecto de desintegración (faceOpacities)
│   ├── shapes.ts                 # Figuras primitivas (cubo, esfera, cilindro...)
│   ├── loft-mesh.ts              # Generación de mallas loft
│   ├── csg-mesh.ts               # Booleanas CSG con three-csg-ts
│   ├── greedy-mesh.ts            # Optimización de caras (greedy meshing)
│   ├── mesh-smooth.ts            # Suavizado Taubin
│   ├── obj3d-thumbnails.ts       # Miniaturas y decimado
│   ├── text-voxel.ts             # Voxelización de texto
│   ├── text-outline.ts           # Contorno de texto
│   ├── mesh-to-views.ts          # Proyecciones 2D (frontal, perfil, cenital)
│   ├── polygon-tools.ts          # Herramientas de polígono (área, offset)
│   ├── collections.ts            # Utilities varias
│   ├── i18n.ts                   # Store de i18n con zustand + persistencia
│   ├── i18n/translations.ts      # ~25.800 líneas: 7 idiomas, claves anidadas
│   ├── electron-fs.ts            # API tipada de window.electronAPI
│   ├── llm.ts                    # Mensajes OpenAI/Ollama para chat
│   ├── store.ts                  # Stores globales de zustand
│   └── userTracking.ts           # Tracking anónimo de uso
├── types/                        # Tipos globales TypeScript
├── docs/
│   └── PLUGINS.md                # Guía de creación de plugins
├── public/                       # Assets estáticos
├── smoke-plugins.test.js         # Smoke tests de plugins
└── scripts/
    └── prepare-electron-env.js   # Prepara .env antes del build
```

---

## 4. Modos de edición (pestañas)

El editor tiene **6 modos** (`Mode = 'scene' | 'views' | 'mesh' | 'text' | 'lathe' | 'extrude'`):

| Modo | Descripción | Herramientas principales |
|---|---|---|
| **Escena** (`'scene'`) | Espacio de trabajo neutral. Seleccionar, mover, rotar, escalar objetos. Crear/eliminar objetos. Agrupar. Acceso al Editor de movimiento. | Gizmo XYZ, duplicado, booleanas CSG, grupos, animación |
| **Vistas** (`'views'`) | Dibujo 2D en 3 planos (frontal, perfil, cenital) para crear figuras por vistas. | Canvas 2D, polilíneas con curvas Bézier, biselado, grosor |
| **Malla** (`'mesh'`) | Edición directa de vértices y caras. | Selección de vértices/cara, extrusión, subdivisión, borrado |
| **Texto** (`'text'`) | Generación de mallas 3D a partir de texto con fuentes. | Fuente, profundidad, espejo, contorno |
| **Lathe** (`'lathe'`) | Revolución de un perfil 2D alrededor de un eje. | Perfil 2D, segmentos, clamp, figura |
| **Extrude** (`'extrude'`) | Extrusión de perfiles 2D con profundidad. | Vistas frontal/side/top, grosor, biselado |

### 4.1 Sistema de objetos de escena

**`SceneObject`** (`components/editor/Editor3D.tsx:256`):

```typescript
type SceneObject = {
  id: string;              // UUID
  name: string;            // Nombre editable
  transform: ObjectTransform;  // { px, py, pz, rx, ry, rz, sx, sy, sz }
  kind?: 'figure' | 'camera';  // 'camera' → cámara-objeto con keyframes
  mesh?: Mesh;             // Instantánea de malla congelada
  smooth?: boolean;
  textureProjection?: TextureFinish;
  config?: ObjectConfig;    // Configuración del panel congelada
  hidden?: boolean;
  frozen?: boolean;
};
```

- El **propietario** (`configObjectId`) es el objeto cuya pestaña está activa. Su figura se construye en vivo.
- Los demás objetos se muestran como **duplicados** en el visor 3D (instancia con `userData.sceneObjectDuplicate = true`).
- Las transformadas de los objetos se resuelven combinando su `transform` estático con los valores evaluados de las pistas de animación.

### 4.2 Operaciones booleanas CSG

El `BooleanCSGModal` permite:
- **Unir** (Union): combina dos objetos en uno.
- **Restar** (Subtract): quita la forma de un objeto del otro.
- **Intersección**: conserva solo la intersección.

Implementado con `three-csg-ts` sobre las mallas voxel/trianguladas.

---

## 5. Sistema de plugins

### 5.1 Arquitectura

```
lib/plugins/
├── types.ts          → Contrato: ZeusPlugin, PluginParam, PluginParams
├── registry.ts       → Map reactivo con useSyncExternalStore
├── index.ts          → Registro de plugins integrados (auto-ejecución)
└── builtin/
    ├── deformadores.ts → Bend, Twist, Taper, Noise (categoría: 'deformadores')
    ├── utilidades.ts   → Smooth, Decimate (categoría: 'utilidades')
    ├── doblar.ts       → Bend por eje (categoría: 'deformadores')
    ├── fragmentar.ts   → Fragmentar/explotar (categoría: 'deformadores')
    └── disolver.ts     → Disolución/desintegración (categoría: 'efectos')
```

### 5.2 Contrato `ZeusPlugin`

```typescript
export type ZeusPlugin = {
  id: string;                          // Estable, kebab-case
  nombre: string;                      // Nombre visible
  categoria: PluginCategoria;          // 'deformadores' | 'utilidades' | (string)
  descripcion: string;                 // Una línea
  params: PluginParam[];               // UI generada automáticamente
  aplicar: (mesh: Mesh, params: PluginParams) => Mesh;  // NO muta la entrada
};
```

### 5.3 Tipos de parámetros (`PluginParam`)

| Tipo | Campos | Descripción |
|---|---|---|
| `slider` | `id, etiqueta, min, max, paso?, valor, unidad?, descripcion?` | Número con rango y paso |
| `select` | `id, etiqueta, opciones[], valor` | Lista desplegable de opciones |
| `check` | `id, etiqueta, descripcion?, valor` | Casilla on/off |

### 5.4 Reglas de oro

1. **No mutar la malla de entrada** — siempre devolver una copia (`{ ...mesh, vertices: [...] }`).
2. **Parámetro `descripcion`** — texto de ayuda opcional.
3. **Regla de oro nº 4** — si el efecto no cambia nada (ej. ángulo 0), devolver la misma malla (referencia idéntica).
4. **Determinismo** — los plugins que usan ruido usan hashes deterministas (no `Math.random`), con semilla configurable.

### 5.5 Plugins integrados

| Plugin | Categoría | Parámetros | Descripción |
|---|---|---|---|
| **Doblar** | deformadores | Ángulo (-360° a 360°), Eje (X/Y/Z) | Curva la figura en un arco |
| **Torsión** | deformadores | Ángulo (-720° a 720°), Eje | Giro progresivo alrededor del eje |
| **Afilado** | deformadores | Escala base (1-300%), Escala cima, Eje | Escalado progresivo (taper) |
| **Ruido** | deformadores | Amplitud, Tamaño onda, Semilla, 3 ejes | Deformación con ondas senoidales |
| **Doblar eje** | deformadores | Ángulo, Eje, Descripción | Variante de doblar con 3 ejes independientes |
| **Fragmentar** | deformadores | Distancia, Dispersión, Dirección, Eje, Semilla, Invertir | Explosión de triángulos |
| **Disolver** | efectos | Progreso, Eje, Sentido, Ruido, Semilla, Invertir | Efecto de desintegración (faceOpacities) |
| **Suavizar** | utilidades | Iteraciones (1-10) | Suavizado Taubin (sin encoger) |
| **Decimar** | utilidades | Caras destino (100-20000) | Reduce caras conservando importancia |

### 5.6 Añadir un plugin nuevo

1. Crear `lib/plugins/builtin/mi-plugin.ts` exportando un objeto `ZeusPlugin`.
2. Importarlo en `lib/plugins/index.ts` y añadirlo al array de `registrarPluginsIntegrados()`.
3. El modal Plugins lo muestra automáticamente; la UI de parámetros se genera desde `params`.

Ver `docs/PLUGINS.md` para la guía paso a paso con ejemplos.

---

## 6. Sistema de animación

### 6.1 Tipos (`lib/animation.ts`)

```typescript
// Track de transformada de objeto (segundos, no milisegundos)
export interface TransformTrack {
  id: string;
  objectId: string;          // Objeto principal
  name: string;              // 'Transformación' o 'Grupo'
  duration: number;          // Segundos
  looping: boolean;
  keyframes: TransformKeyframe[];
  objectIds?: string[];      // Miembros del grupo (tracks de grupo)
}

export interface TransformKeyframe {
  time: number;
  values: Partial<Record<TransformProperty, number>>;  // Solo las que cambian
  easing: EasingFunction;  // 8 funciones: linear, ease-in/out, spring...
}

// Track de parámetro de plugin
export interface PluginParamTrack {
  id: string;
  objectId: string;
  pluginId: string;
  paramId: string;
  duration: number;
  looping: boolean;
  keyframes: PluginParamKeyframe[];
}
```

### 6.2 MotionEditor (`components/editor/MotionEditor.tsx`)

- **Panel izquierdo**: lista de objetos, grupos, selector de plugin/param.
- **Timeline central**: regla de tiempo, filas de tracks con diamantes de keyframes.
- **Inspector inferior**: valores del keyframe seleccionado (propiedades X/Y/Z/Rotación/Escala o plugin).
- **Controles**: play/pause/stop, seek, loop, auto-key, duración.

### 6.3 Reproducción en el visor 3D (`viewer-3d.tsx`)

La función `applyMotionOverride(time)` se ejecuta en el bucle `requestAnimationFrame`:

1. **Objeto seleccionado**: evalúa su `TransformTrack` y aplica la transformada.
2. **Duplicados**: objetos con track, con matriz relativa al seleccionado.
3. **Miembros de grupo**: objetos listados en `track.objectIds` que reciben la misma transformada.
4. **Tracks de plugin**: evalúa parámetros y aplica el plugin a la malla base congelada.

### 6.4 Auto-key

Cuando `autoKeyRef.current` es verdadero y el usuario arrastra un gizmo:
- Se crea o actualiza un `TransformTrack` con los valores diferenciales.
- Los valores base son el último keyframe evaluado o la transformada estática.

### 6.5 Grupos de animación

- **Seleccionar grupo**: en el panel izquierdo del MotionEditor, hacer clic en un grupo resalta todas sus caras.
- **Fusionar como objeto único**: crea un `TransformTrack` con `objectIds` que controla todos los miembros con un único set de keyframes.
- **Desvincular**: el botón `Unlink` en la fila del track convierte la pista de grupo en pistas individuales (preservando los keyframes).

---

## 7. Sistema de grupos de objetos

### 7.1 Estados de selección en Editor3D

| Estado | Descripción |
|---|---|
| `selectedObjectId` | Objeto activo (para el gizmo, inspector, etc.) |
| `selectedObjectIds` | Selección múltiple (Shift+Click) |
| `groups: SceneObjectGroup[]` | Grupos definidos por el usuario |
| `showGroupsPanel` | Si el panel de grupos está visible |

### 7.2 `SceneObjectGroup`

```typescript
type SceneObjectGroup = {
  id: string;
  name: string;
  objectIds: string[];   // IDs de los objetos miembro
  locked?: boolean;      // Si está bloqueado (no se puede mover individualmente)
};
```

### 7.3 Operaciones con grupos

- **Crear grupo**: `selectGroup` o `createGroupFromSelection`.
- **Seleccionar grupo**: resalta todos los objetos del grupo en el visor.
- **Mover grupo**: el gizmo afecta a todos los miembros (transformada compuesta).
- **Editar miembros**: Shift+Click para añadir/quitar objetos del grupo.
- **Eliminar grupo**: deselecciona el grupo pero conserva los objetos.

### 7.4 Integración con el MotionEditor

El MotionEditor recibe `groups` como prop y muestra un apartado "Grupos de objetos":
- Los botones de grupo se resaltan cuando están activos.
- Al seleccionar un grupo, el botón "Fusionar como objeto único" aparece.
- Al fusionar, se crea un track de grupo que anima todos los objetos simultáneamente.

---

## 8. Importación y exportación

### 8.1 Formatos soportados

| Formato | Importar | Exportar | Librería |
|---|---|---|---|
| **OBJ** | Sí (vértices, caras, colores) | Sí (con .mtl si hay colores) | `three/examples/jsm/OBJLoader` |
| **FBX** | Sí | No | `three/examples` |
| **GLB/GLTF** | Sí | Sí (binario glTF 2.0) | `three/examples/jsm/GLTFLoader`, exportador personalizado |
| **STL** | No | Sí (ASCII) | Exportador propio |
| **PLY** | No | Sí (ASCII, con colores por cara) | Exportador propio |
| **Imagen (PNG/JPG)** | Sí (heightmap para relieve) | Sí (captura de viewport) | Canvas 2D + WebGL readPixels |
| **SVG** | Sí (perfil 2D) | Parcial | SVG Path parsing |

### 8.2 Exportación multi-objeto

Desde la pestaña **Escena**, el botón de exportación:
1. Recolecta todos los objetos visibles (`!hidden && mesh.vertices.length > 0`).
2. Aplica cada objeto's transformada (escala → rotación → traslación) a sus vértices vía `mergeMeshes()`.
3. Concatenates vértices, caras, colores y UVs con indices remapeados.
4. Exporta el mesh combinado como un único archivo.

**Importante**: `mergeMeshes()` está en `lib/mesh-export.ts` y usa `THREE.Matrix4` para la transformación. La textura y los colores de cara se preservan. Las UV coordinates se concatenan pero pueden requerir ajustes manuales si los objetos tienen texturas distintas.

### 8.3 Proyectos `.zeus`

- **Formato**: JSON con versiones (`version: 3`).
- **Guardado**: `saveProject()` en `electron/main.js` escribe el proyecto como JSON comprimido.
- **Carga**: `fsReadProject()` valida y reconstruye el estado:
  - Filtra tracks de animación inválidos (objeto inexistente).
  - Filtra tracks de plugin (plugin no registrado → descartado).
  - Restaura texturas (data URLs preservadas).
- **Histórico**: undo/redo con `history` (hasta 100 estados), comparación por referencia para eficiencia.

---

## 9. Internacionalización (i18n)

### 9.1 Arquitectura

- **Store**: `lib/i18n.ts` usa `zustan` + `persist` (clave `zeus-i18n` en localStorage).
- **Traducciones**: `lib/i18n/translations.ts` — ~25.800 líneas, 7 idiomas.
- **Hook**: `useI18n()` devuelve `{ locale, setLocale, t }`.
- **Outside React**: `getT()` para usar `t()` en stores/zustand.

### 9.2 Idiomas soportados

| Código | Nombre | Traductor |
|---|---|---|
| `es` | Español | Base (idioma por defecto) |
| `en` | English | Inglés |
| `fr` | Français | Francés |
| `de` | Deutsch | Alemán |
| `it` | Italiano | Italiano |
| `zh` | 中文 | Chino |
| `hi` | हिन्दी | Hindi |

### 9.3 Sistema de claves

- Claves anidadas con notación de puntos: `t('editor3D.motion.play')`.
- Interpolación: `t('editor3D.motion.addTransformTracks', { count: 3 })` → "Añadir 3 pistas de transformación".
- Variables con `{nombre}`.
- Fallback: si la clave no existe en el locale actual, usa el español; si no existe en español, devuelve la clave.

### 9.4 Estructura de claves (`translations.ts`)

```
es: {
  editor3D: {               # Todas las claves del editor 3D
    loading, title, actions, newObject, newProject, ...
    plugins: { menuTitle, desc, catDeformadores, ... }
    motion: { menuTitle, play, pause, addTransformTrack, ... }
    objectGroups: "Grupos de objetos"   # Nueva key añadida
    ...
  }
  ui: { dialog, confirm, cancel, ... }   # Componentes genéricos
  ...
}
```

---

## 11. Tipos de datos clave

### 11.1 `Mesh` (`lib/geometry.ts`)

```typescript
type Vertex3D = { x: number; y: number; z: number };
type Face = [number, number, number, number] | [number, number, number];

type Mesh = {
  vertices: Vertex3D[];
  faces: number[][];                    // Índices a vertices
  faceColors?: (string | null)[];      // Color hex por cara
  faceOpacities?: number[];            // 0..1 por cara
  faceTextures?: (string | null)[];    // Textura por cara
  texture?: string;                    // Data URL (modo textura plana)
  textureColor?: string;               // Color de tinte
  textureRelief?: number;              // Intensidad relieve
  textureRepeat?: number;              // Repetición
  textureFinish?: TextureFinish;       // 'flat' | 'smooth' | ...
  textureHelper?: boolean;             // Si la guía de textura es visible
  textureHelperTransform?: ObjectTransform;
};
```

### 11.2 `ObjectTransform`

12 propiedades: `px, py, pz` (posición), `rx, ry, rz` (rotación en radianes), `sx, sy, sz` (escala).

### 11.3 `EasingFunction`

8 tipos: `linear`, `ease-in`, `ease-out`, `ease-in-out`, `ease-in-cubic`, `ease-out-cubic`, `ease-in-out-cubic`, `spring`.

---

## 12. Convenciones de código

### 12.1 TypeScript

- **`lib/`**: código puro (sin React). Importa desde `@/lib/...`.
- **`components/`**: componentes React. Importa desde `@/`.
- **Types**: todos los exports usan `explicit type imports` (`import type { ... }`).
- **Strict mode**: `tsc --noEmit` debe pasar sin errores.

### 12.2 Patrones de código

- **Inmutabilidad**: siempre crear nuevas instancias (spread operator). Nunca mutar directamente.
- **Regla de oro nº 4**: si un efecto no cambia nada, devolver la misma referencia de la malla.
- **Determinismo**: usar hashes deterministas (no `Math.random`) con semilla configurable para reproducibilidad.
- **Validación defensiva**: los plugins validan parámetros con funciones helper (`num`, `str`, `bool`).

### 12.3 Tests

```bash
npm test                    # Jest
node smoke-plugins.test.js  # Smoke tests de plugins (vertices, NaN, deforma, no muta)
npx tsc --noEmit           # Type check
npx next build             # Build completo
```

---

## 13. Scripts de desarrollo

| Comando | Descripción |
|---|---|
| `npm run dev` | Next.js (puerto 3009) + Next.js PB (3006) + Zeus bridge |
| `npm run electron:dev` | Electron + Next.js + PocketBase + bridge (entorno completo) |
| `npm run build` | `next build --webpack` |
| `npm run electron:build` | Build completo + empaquetado |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run test` | Jest |
| `npm run analyze` | Bundle analyzer |

### 13.1 Puertos

| Servicio | Puerto |
|---|---|
| Next.js (main) | 3002 (dev) / 3009 (standalone) |
| Next.js (PocketBase) | 3006 |
| PocketBase | 8236 |
| ComfyUI | 8188 |
| Flux Bridge | 5050 |
| Texture API | 8090 |

---

## 14. Solución de problemas comunes

### El visor 3D no muestra objetos
- Verificar que los objetos no estén `hidden` (checkbox en el panel de Escena).
- Verificar que la malla tenga vértices (`mesh.vertices.length > 0`).

### La animación no se reproduce
- El objeto seleccionado debe tener un `TransformTrack`.
- Verificar que el playhead no esté fuera de la duración del track.
- En grupos: verificar que el grupo esté fusionado ("Fusionar como objeto único").

### La exportación solo incluye un objeto
- Asegurarse de estar en la pestaña **Escena**.
- Los objetos deben ser visibles (no `hidden`).
- Los objetos deben tener malla (`mesh.vertices.length > 0`).

### El plugin no aparece en el modal
- Verificar que el plugin esté registrado en `lib/plugins/index.ts`.
- El plugin debe tener `id`, `aplicar` y `params` válidos.

### Error de tipo TS2353 en plugins
- Si un slider tiene `descripcion`, asegurarse de que el tipo `slider` en `types.ts` la incluya.
- Ver `lib/plugins/types.ts` para el contrato exacto.
