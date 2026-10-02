export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  storageUsed: number;
  storageLimit: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MediaFile {
  id: string;
  userId: string;
  filename: string;
  originalFilename: string;
  fileType: MediaFileType;
  mimeType: string;
  size: number;
  url: string;
  thumbnailUrl?: string;
  duration?: number; // For audio/video in seconds
  width?: number; // For images/video
  height?: number; // For images/video
  metadata: MediaMetadata;
  tags: string[];
  isFavorite: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type MediaFileType = 'image' | 'video' | 'audio' | 'document' | 'other';

export interface MediaMetadata {
  title?: string;
  description?: string;
  artist?: string;
  album?: string;
  year?: number;
  genre?: string;
  cameraMake?: string;
  cameraModel?: string;
  exposureTime?: string;
  fNumber?: number;
  iso?: number;
  focalLength?: number;
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
  };
  customTags: Record<string, string>;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string;
  coverMediaId?: string;
  items: ProjectItem[];
  isPublic: boolean;
  shareLink?: string;
  viewCount: number;
  settings: ProjectSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectItem {
  id: string;
  mediaFileId: string;
  position: number;
  caption?: string;
  startTime?: number; // For video/audio clips
  endTime?: number; // For video/audio clips
}

export interface ProjectSettings {
  layout: 'grid' | 'carousel' | 'slideshow';
  autoplay: boolean;
  transitionSpeed: number;
  showCaptions: boolean;
}

export interface Gallery extends Omit<Project, 'items'> {
  items: GalleryItem[];
}

export interface GalleryItem {
  id: string;
  mediaFileId: string;
  position: number;
}

// Dashboard types
export interface DashboardWidget {
  id: string;
  type: DashboardWidgetType;
  position: WidgetPosition;
  size: WidgetSize;
  data?: Record<string, unknown>;
}

export type DashboardWidgetType = 
  | 'recent-files'
  | 'active-projects'
  | 'storage-usage'
  | 'suggestions'
  | 'quick-actions'
  | 'activity-feed';

export interface WidgetPosition {
  x: number;
  y: number;
}

export interface WidgetSize {
  width: number;
  height: number;
}

// Editor types
export type EditorType = 'image' | 'video' | 'audio' | 'document';

export interface ImageEditState {
  brightness: number; // -100 to 100
  contrast: number; // -100 to 100
  saturation: number; // -100 to 100
  hue: number; // -180 to 180
  blur: number; // 0 to 100
  crop?: CropRegion;
}

export interface CropRegion {
  x: number; // percentage
  y: number; // percentage
  width: number; // percentage
  height: number; // percentage
}

export interface VideoCropState {
  enabled: boolean; // si se aplica al exportar
  aspect: string | null; // preset "16:9","9:16","1:1","4:3","3:2","21:9","5:4" o null=libre
  x: number; // % (0-100) del área de vídeo
  y: number; // % (0-100)
  width: number; // % (0-100)
  height: number; // % (0-100)
}

export interface SelectionPoint {
  x: number; // % (0-100) del área de vídeo
  y: number; // % (0-100)
}

// Ancla de un path Bézier (herramienta Pluma del trazo libre). Los mangos hIn/hOut
// son los puntos de control del segmento que entra/sale de la ancla. Si coinciden
// con la ancla, el segmento es recto (sin curvatura).
export interface BezierAnchor {
  x: number;  // posición de la ancla (% 0-100)
  y: number;
  hInX: number;  // mango de entrada (control del segmento que termina aquí)
  hInY: number;
  hOutX: number; // mango de salida (control del segmento que arranca aquí)
  hOutY: number;
}

export interface SelectionShape {
  type: 'rect' | 'circle' | 'freehand' | 'wand';
  // rect/circle: bounding box en % (0-100) del área de vídeo
  x: number;
  y: number;
  width: number;
  height: number;
  // freehand: lista de paths Bézier cerrados (% 0-100). Rect/circle: [].
  // Cada path es un subpath; la máscara resulta de la unión de todos ellos.
  paths: BezierAnchor[][];
  // Seguimiento de objeto (sólo rect/circle): keyframes de la caja a lo largo del tiempo.
  keyframes?: SelectionKeyframe[];
  // Silueta cambiante por frame (lazo por puntos). Cuando existe, tiene PRIORIDAD
  // sobre transformPaths: los paths de cada frame son los del lazo DEFORMADO (no la
  // caja). Lista ordenada por time (absoluto del timeline). Sin tracking de caja.
  motionPaths?: MotionPathFrame[];
  // Silueta cambiante por frame (SAM2). Cuando existe, el recorte usa la máscara
  // raster (PNG alpha, res nativa) de cada frame en vez del path. Lista ordenada
  // por time (absoluto del timeline). Mutuamente excluyente con motionPaths.
  motionMasks?: MotionMaskFrame[];
}

// Un frame de silueta deformada (lazo por puntos): los paths Bézier del lazo tal
// como quedan en ese instante del timeline (% 0-100). Se interpola linealmente
// entre frames circundantes (igual que los keyframes de caja).
export interface MotionPathFrame {
  time: number;              // segundos absolutos del timeline
  paths: BezierAnchor[][];   // paths del lazo DEFORMADOS a este frame
}

// Un frame de máscara raster (SAM2): PNG con alpha (res nativa del vídeo, blanco
// = keep). El recorte se hace por composite destination-in contra esta imagen.
export interface MotionMaskFrame {
  time: number;              // segundos absolutos del timeline
  url: string;               // media:// o dataURL del PNG alpha
}

export interface SelectionKeyframe {
  time: number; // segundos absolutos del timeline
  x: number; y: number; width: number; height: number; // % (0-100)
}

export interface VideoSelectionState {
  enabled: boolean; // ¿aplicar máscara a los efectos?
  shape: SelectionShape;
  scope: 'inside' | 'outside'; // aplicar efectos dentro o fuera de la selección
  track: boolean; // seguir objeto: la caja se anima por keyframes (rect/circle)
  timeEnabled: boolean; // ¿limitar los efectos a un rango de tiempo?
  timeStart: number; // segundos (inclusive)
  timeEnd: number;   // segundos (inclusive)
  fadeIn?: number;   // segundos de fundido de entrada al inicio del rango (default 0)
  fadeOut?: number;  // segundos de fundido de salida al final del rango (default 0)
  // BORRADOR de seguimiento (transient, no se persiste): caja arrastrada con seguimiento
  // ON que aún NO se ha fijado como keyframe. Se muestra en el tiempo actual hasta que se
  // pulsa "Fijar keyframe aquí" (la confirma) o se cambia de tiempo (se descarta). Así el
  // arrastre NO crea keyframes automáticamente: sólo el botón los fija.
  draftBox?: { x: number; y: number; width: number; height: number } | null;
}

// Capa de pintura sobre el vídeo (pestaña Efectos): brocha/bote/gotero/borrador. La
// pintura es una capa raster única (dataURL PNG con alpha, `mask`) a resolución nativa
// del vídeo, compositeada encima del vídeo con la opacidad. Si `timeEnabled` está OFF,
// la capa dura **todo el vídeo**; si está ON, sólo se ve en `[timeStart, timeEnd]`.
// No hay keyframes de pintura: lo que pintas es la capa, sin más.
//
// Seguimiento de selección (opcional): si al pintar hay selección activa con scope
// 'inside', el commit fija `baseBox` = caja de la selección al pintar (%, 0-100). Al
// compositear, la máscara se transforma de baseBox→caja actual de la selección
// (`effectiveSelectionShape` al tiempo t, que interpola entre los KEYFRAMES DE LA
// SELECCIÓN). Así la pintura va "pegada" a la selección: se mueve y escala
// progresivamente entre los keyframes de selección (cuanto más juntos, más perfecto el
// seguimiento), y en cada keyframe de selección sale exacta (respeta su ubicación y
// su área/diámetro). Sin selección → capa libre full-frame (baseBox null).
export interface VideoPaintState {
  enabled: boolean;
  mask?: string;        // dataURL PNG (con alpha) del canvas de pintura a resolución nativa
  color: string;        // hex — color de pintura actual (brocha y bote)
  brushSize: number;    // diámetro del pincel en px (espacio nativo del vídeo)
  opacity: number;      // 0-100 — opacidad de la capa al compositear
  timeEnabled: boolean; // ¿limitar la pintura a un rango de tiempo? (default true)
  timeStart: number;    // segundos (inclusive)
  timeEnd: number;      // segundos (inclusive)
  fadeIn?: number;      // segundos de fundido de entrada al inicio del rango (default 0)
  fadeOut?: number;     // segundos de fundido de salida al final del rango (default 0)
  // Caja de selección (%, 0-100) al pintar, para el seguimiento. null = capa libre.
  baseBox?: { x: number; y: number; width: number; height: number } | null;
  // Modo "rellenar todo menos la selección": rellena el área del vídeo con `color`
  // excepto la región de la selección (dentro si scope 'inside' → pinta el fondo y deja
  // limpia la selección; fuera si scope 'outside' → pinta la selección). El agujero se
  // calcula EN CADA FRAME desde la selección (effectiveSelectionShape), así que sigue
  // al objeto sin deformarse (no usa mask ni baseBox). Botón "Aplicar relleno".
  inverseFill?: boolean;
}

export interface AudioEditState {
  volume: number; // -50 to +50 dB
  fadeInDuration: number; // seconds
  fadeOutDuration: number; // seconds
  trimStart?: number; // seconds
  trimEnd?: number; // seconds
  playbackRate?: number;
  timeline?: TimelineState;
}

export interface VideoEditState {
  trimStart?: number; // seconds
  trimEnd?: number; // seconds
  brightness?: number; // -100 to 100
  contrast?: number; // -100 to 100
  saturation?: number; // -100 to 100
  hue?: number; // -180 to 180
  blur?: number; // 0 to 20
  intensity?: number; // -100 to 100, 0 = neutro. + = nitidez (sharpen), - = suavizado (blur)
  timeline?: TimelineState;
  textClips?: TextClip[];
  objectClips?: ObjectClip[];
  videoOverlay?: VideoOverlay | null; // vídeo superpuesto a pantalla completa
  playerZoom?: number; // 50-400, default 100
  crop?: VideoCropState; // recorte espacial / zona de exportación
  selection?: VideoSelectionState; // máscara de efectos (dentro/fuera de la selección)
  paint?: VideoPaintState | null; // capa de pintura sobre el vídeo (brocha/bote/gotero)
}

export interface VideoOverlay {
  id: string;
  src: string; // URL playable (media://, blob:, data:, http) del vídeo superpuesto
  sourceDuration: number; // duración del vídeo fuente (s)
  opacity: number; // 0-100
  zoom: number; // 1 = contain-fit; >1 = ampliar centrado
  seekOffset: number; // punto de entrada (s) de la barra de seek; in-point del export
}

export interface TextClip {
  id: string;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor: string;
  backgroundOpacity?: number;
  backgroundBlur?: number;
  borderRadius?: number;
  borderWidth?: number;
  borderColor?: string;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffset?: number;
  isBold?: boolean;
  isItalic?: boolean;
  isUnderline?: boolean;
  position: { x: number; y: number };
  startTime: number;
  duration: number;
  opacity: number;
  textAlign: 'left' | 'center' | 'right';
  rotation?: number; // grados (0-360). 90/270 => texto vertical. Gira sobre el centro del bloque.
  fadeInDuration?: number;
  fadeOutDuration?: number;
  keyframes?: TextKeyframe[]; // ausente/vacío => usa position/fontSize/opacity estáticos
}

export interface TextKeyframe {
  id: string;
  time: number; // segundos LOCALES desde el inicio del clip (0..duration)
  x: number; // 0-100 (% del área de vídeo)
  y: number; // 0-100
  fontSize: number; // px (8-120)
  opacity: number; // 0-100
}

export interface ObjectKeyframe {
  id: string;
  time: number; // segundos LOCALES desde el inicio del clip (0..duration)
  x: number; // 0-100 (% del área de vídeo)
  y: number; // 0-100
  width: number; // 0-100
  height?: number; // 0-100 (opcional: si ausente, se deduce del aspecto de la imagen)
  opacity: number; // 0-100
  corners?: { x: number; y: number }[]; // 4 vértices relativos al centro (-50..50)
}

export interface ObjectClip {
  id: string;
  name: string;
  assetId?: string;
  src: string;
  mediaType: 'png' | 'gif' | 'video';
  position: { x: number; y: number };
  width: number; // percentage of player width
  height?: number; // percentage of player height (opcional: si ausente, se deduce del aspecto de la imagen)
  startTime: number;
  duration: number;
  opacity: number; // 0-100
  fadeInDuration?: number;
  fadeOutDuration?: number;
  isDeformable?: boolean; // true = usa ObjectOverlay con esquinas deformables, false = usa ObjectOverlay-2 normal
  corners?: { x: number; y: number }[]; // vértices relativos al centro (-50..50)
   keyframes?: ObjectKeyframe[]; // ausente/vacío => usa position/width/opacity estáticos
   visible?: boolean; // false => el objeto se oculta en el preview y en la exportación
   /** Espejo horizontal: voltea la imagen del objeto de izquierda a derecha. */
   mirrored?: boolean;
   /** Reproducción sincronizada con el timeline (solo objetos vídeo): el vídeo se
    *  comporta como un clip normal — avanza con el playhead, pausa al pausar el
    *  timeline y NO hace bucle (si el clip dura más que el vídeo, se congela en el
    *  último frame). Ausente/false = bucle continuo (comportamiento original). */
   syncToTimeline?: boolean;
}

export interface TimelineState {
  duration: number; // total duration in seconds
  currentTime: number; // current playback position in seconds
  zoom: number; // zoom level (pixels per second)
  tracks: TimelineTrack[];
  bookmarks?: { time: number; color: 'red' | 'yellow' }[]; // marcas del usuario en la regla
}

export interface TimelineTrack {
  id: string;
  type: TrackType;
  name: string;
  clips: TimelineClip[];
  isMuted?: boolean;
  isLocked?: boolean;
  volume?: number; // 0-1 for audio tracks
}

export type TrackType = 'video' | 'audio' | 'text' | 'image';

export type TransitionType = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'zoom-in' | 'zoom-out' | 'blur' | 'dissolve';

export interface TimelineClip {
  overlayTint: any;
  id: string;
  trackId: string;
  mediaFileId?: string;
  type: TrackType;
  linkedGroupId?: string;
  overlayKind?: 'effect' | 'object';
  startTime: number; // position on timeline in seconds
  duration: number; // duration on timeline in seconds
  sourceStartTime?: number; // where to start in source media
  sourceDuration?: number; // how much of source media to use
  /** Clip bloqueado (candado individual): no se puede mover, borrar ni ajustar. */
  locked?: boolean;
  /** Clip oculto (botón ojo): no se dibuja en el preview ni en el export. */
  hidden?: boolean;
  
  // Text-specific properties
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  position?: { x: number; y: number };
  textAlign?: 'left' | 'center' | 'right';
  backgroundOpacity?: number;
  backgroundBlur?: number;
  borderRadius?: number;
  borderWidth?: number;
  borderColor?: string;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffset?: number;
  isBold?: boolean;
  isItalic?: boolean;
  isUnderline?: boolean;
  
  // Common properties
  volume?: number; // 0-1
  opacity?: number; // 0-1
  playbackRate?: number;
  /** Reproducir el clip al revés (el final pasa a ser el principio). Audio silenciado. */
  reversed?: boolean;
  /** Espejo horizontal: voltea la imagen del clip de izquierda a derecha. */
  mirrored?: boolean;
  fadeInDuration?: number;
  fadeOutDuration?: number;
  /** Nombre para mostrar (ej. nombre del archivo en reproducción) */
  label?: string;
  
  // Visual properties
  thumbnailUrl?: string;
  backgroundColor?: string; // background color for text clips

  // Transition properties
  transitionIn?: {
    type: TransitionType;
    duration: number;
  };
  transitionOut?: {
    type: TransitionType;
    duration: number;
  };

  // Effects properties
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hue?: number;
  blur?: number;

  /** Zonas de velocidad dentro del clip (sin cortar): estirar/encoger regiones */
  speedZones?: Array<{
    startLocal: number;   // inicio en tiempo del clip (s)
    endLocal: number;     // fin en tiempo del clip (s)
    newDuration: number;  // nueva duración en timeline (s)
  }>;
}

export interface TextEditState {
  content: string;
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  wordWrap?: boolean;
}

// Effects and filters
export interface MediaEffect {
  id: string;
  name: string;
  category: EffectCategory;
  type: EffectType;
  intensityRange: [number, number]; // min, max
}

export type EffectCategory = 
  | 'vintage'
  | 'modern'
  | 'cinematic'
  | 'energetic'
  | 'artistic'
  | 'black-white';

export type EffectType = 'image' | 'audio' | 'video';

// Export and sharing
export interface ExportPreset {
  id: string;
  name: string;
  description?: string;
  format: 'jpg' | 'png' | 'webp';
  quality: number; // 0-100
  width?: number;
  height?: number;
  maintainAspectRatio: boolean;
}

export interface ExportSettings {
  presetId?: string;
  format: 'jpg' | 'png' | 'webp';
  quality: number;
  width?: number;
  height?: number;
  maintainAspectRatio: boolean;
  includeMetadata: boolean;
}

// Rhythm configuration for MIDI keyboard
export interface RhythmConfig {
  id: string; // "Tiktac_0", "Tiktac_1", etc.
  filePath: string; // Ubicación del archivo
  velocity: number; // Velocidad (0.25 - 2.0)
  volume: number; // Volumen (0 - 1)
}

export interface RhythmConfigFile {
  rhythms: RhythmConfig[];
  lastUpdated: string;
}

// Re-exportar los tipos de tutoriales y modelos de IA (definidos en index-2) para
// que se puedan importar como `@/types`. index-2 también define `User` y
// `TimelineClip` que COLISIONAN con los de arriba (shapes distintos), así que se
// excluyen deliberadamente: `@/types` sigue exponiendo los `User`/`TimelineClip`
// de este archivo (los que usa el editor de vídeo).
export type {
  AIModelProvider,
  AIModelType,
  AIModelConfig,
  AIModelConnection,
  TutorialStatus,
  Tutorial,
  TutorialStep,
  TutorialSettings,
  TutorialMetadata,
  TutorialRecord,
  AIModelRecord,
  DatabaseRecord,
  APIResponse,
  APIError,
  APIPagination,
  EditorState,
  EditorTool,
  UserPreferences,
  ModalConfig,
  RecordingState,
  RecordingAction,
  ExportConfig,
  ExportProgress,
  TutorialStore,
  AIModelStore,
  EditorStore,
  DeepPartial,
  Nullable,
  AsyncReturnType,
  ThemeColors,
} from './index-2';

export {
  DEFAULT_TUTORIAL_SETTINGS,
  DEFAULT_AI_MODEL_CONFIG,
  SUPPORTED_RESOLUTIONS,
  SUPPORTED_FORMATS,
  SUPPORTED_LANGUAGES,
  DARK_THEME,
  LIGHT_THEME,
} from './index-2';