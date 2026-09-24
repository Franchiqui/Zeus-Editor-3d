export interface Point {
  id: string;
  x: number;
  y: number;
  gridX: number;
  gridY: number;
}

export interface GridConfig {
  spacing: number;
  dotSize: number;
  dotColor: string;
  backgroundColor: string;
  width: number;
  height: number;
}

export interface CanvasState {
  grid: GridConfig;
  points: Point[];
  selectedPoints: string[];
  zoom: number;
  pan: { x: number; y: number };
  isPanning: boolean;
}

// ============================================================
// Stroke & Path Types
// ============================================================

export type StrokeType = 'line' | 'curve' | 'freehand';

export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface Stroke {
  id: string;
  type: StrokeType;
  points: StrokePoint[];
  startPointId: string;
  endPointId: string;
  color: string;
  fillColor: string | null;
  strokeWidth: number;
  opacity: number;
  isClosed: boolean;
  transform?: Transform;
}

export interface CurveControl {
  handleIn: Point;
  handleOut: Point;
  point: Point;
}

export interface BezierCurve {
  id: string;
  controls: CurveControl[];
  isSmooth: boolean;
}

// ============================================================
// Fill & Color Types
// ============================================================

export type FillType = 'solid' | 'gradient' | 'none';

export interface SolidFill {
  type: 'solid';
  color: string;
  opacity: number;
}

export interface GradientStop {
  offset: number;
  color: string;
  opacity: number;
}

export interface GradientFill {
  type: 'gradient';
  gradientType: 'linear' | 'radial';
  angle: number;
  stops: GradientStop[];
  opacity: number;
}

export interface NoneFill {
  type: 'none';
  opacity: number;
}

export type Fill = SolidFill | GradientFill | NoneFill;

export interface StrokeStyle {
  color: string;
  width: number;
  opacity: number;
  dashArray?: number[];
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
}

// ============================================================
// Selection & Tool Types
// ============================================================

export type ToolType = 
  | 'select'
  | 'point'
  | 'line'
  | 'curve'
  | 'freehand'
  | 'eraser'
  | 'pan'
  | 'zoom'
  | 'rectangle'
  | 'fill';

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionState {
  type: 'single' | 'multiple' | 'rectangle';
  selectedStrokeIds: string[];
  selectedPointIds: string[];
  selectionRect: SelectionRect | null;
  clipboard: ClipboardData | null;
}

export interface ClipboardData {
  strokes: Stroke[];
  points: Point[];
}

// ============================================================
// Transform Types
// ============================================================

export interface Transform {
  scaleX: number;
  scaleY: number;
  rotation: number;
  translateX: number;
  translateY: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

// ============================================================
// History & Undo Types
// ============================================================

export interface HistoryAction {
  type: 'add' | 'remove' | 'modify' | 'transform' | 'fill';
  timestamp: number;
  data: any;
}

export interface HistoryState {
  past: HistoryAction[];
  future: HistoryAction[];
  maxHistory: number;
}

// ============================================================
// Icon & Database Types
// ============================================================

export interface Icon {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  canvasState: CanvasState;
  strokes: Stroke[];
  fills: Fill[];
  thumbnailUrl: string;
  pngDataUrl: string;
  tags: string[];
  width: number;
  height: number;
  isPublic: boolean;
}

export interface IconCreateInput {
  title: string;
  description?: string;
  canvasState: CanvasState;
  strokes: Stroke[];
  fills: Fill[];
  tags?: string[];
  width: number;
  height: number;
}

export interface IconUpdateInput extends Partial<IconCreateInput> {
  id: string;
}

// ============================================================
// API Response Types
// ============================================================

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}

// ============================================================
// PocketBase Specific Types
// ============================================================

export interface PocketBaseRecord {
  id: string;
  created: string;
  updated: string;
  collectionId: string;
  collectionName: string;
}

export interface IconRecord extends PocketBaseRecord {
  title: string;
  description: string;
  canvas_state: string; // JSON stringified
  strokes: string; // JSON stringified
  fills: string; // JSON stringified
  thumbnail: string; // file id
  png_file: string; // file id
  tags: string[];
  width: number;
  height: number;
  is_public: boolean;
  user_id: string;
}

// ============================================================
// UI State Types
// ============================================================

export interface UIState {
  activeTool: ToolType;
  strokeStyle: StrokeStyle;
  fillStyle: Fill;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSnapThreshold: number;
  zoomLevel: number;
  panOffset: { x: number; y: number };
  isDrawing: boolean;
  isDragging: boolean;
  showPropertiesPanel: boolean;
  showLayersPanel: boolean;
  showColorPicker: boolean;
}

export interface ToolbarConfig {
  tools: ToolType[];
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  disabled?: boolean;
}

// ============================================================
// Event & Handler Types
// ============================================================

export interface CanvasMouseEvent {
  originalEvent: MouseEvent;
  canvasX: number;
  canvasY: number;
  gridX: number;
  gridY: number;
  isShiftKey: boolean;
  isCtrlKey: boolean;
  isAltKey: boolean;
}

export interface CanvasKeyboardEvent {
  originalEvent: KeyboardEvent;
  key: string;
  isCtrlKey: boolean;
  isShiftKey: boolean;
  isAltKey: boolean;
}

export type CanvasEventHandler = 
  | { type: 'mousedown'; handler: (event: CanvasMouseEvent) => void }
  | { type: 'mousemove'; handler: (event: CanvasMouseEvent) => void }
  | { type: 'mouseup'; handler: (event: CanvasMouseEvent) => void }
  | { type: 'keydown'; handler: (event: CanvasKeyboardEvent) => void }
  | { type: 'keyup'; handler: (event: CanvasKeyboardEvent) => void }
  | { type: 'wheel'; handler: (event: CanvasMouseEvent & { deltaY: number }) => void };

// ============================================================
// Export & Import Types
// ============================================================

export interface ExportOptions {
  format: 'png' | 'svg' | 'json';
  width: number;
  height: number;
  backgroundColor: string | null;
  scale: number;
  quality: number;
}

export interface ImportResult {
  success: boolean;
  icon: Icon | null;
  errors: string[];
}

// ============================================================
// Keyboard Shortcut Types
// ============================================================

export interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  action: string;
  description: string;
  handler: () => void;
}

export interface ShortcutMap {
  [key: string]: KeyboardShortcut;
}

// ============================================================
// Layer Types
// ============================================================

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  strokes: string[]; // stroke ids
  order: number;
}

export type BlendMode = 
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion';

// ============================================================
// Magnetism & Snapping Types
// ============================================================

export interface MagnetismConfig {
  enabled: boolean;
  threshold: number;
  snapToGrid: boolean;
  snapToPoints: boolean;
  snapToGuides: boolean;
}

export interface GuideLine {
  id: string;
  orientation: 'horizontal' | 'vertical';
  position: number;
  visible: boolean;
}

// ============================================================
// Performance & Optimization Types
// ============================================================

export interface PerformanceConfig {
  enableVirtualization: boolean;
  maxPointsPerStroke: number;
  maxStrokes: number;
  debounceDelay: number;
  throttleDelay: number;
  renderQuality: 'low' | 'medium' | 'high';
  useWebGL: boolean;
}

export interface RenderStats {
  fps: number;
  drawCalls: number;
  pointsRendered: number;
  strokesRendered: number;
  memoryUsage: number;
}

// ============================================================
// Theme & Styling Types
// ============================================================

export interface ThemeColors {
  background: string;
  surface: string;
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  textSecondary: string;
  border: string;
  error: string;
  success: string;
  warning: string;
}

export interface Theme {
  name: string;
  isDark: boolean;
  colors: ThemeColors;
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
  shadows: Record<string, string>;
  typography: {
    fontFamily: string;
    fontSize: Record<string, string>;
    fontWeight: Record<string, number>;
  };
}

// ============================================================
// Zustand Store Types
// ============================================================

export interface CanvasStore {
  canvas: CanvasState;
  strokes: Stroke[];
  fills: Fill[];
  selection: SelectionState;
  history: HistoryState;
  ui: UIState;
  theme: Theme;
  performance: PerformanceConfig;
  
  // Actions
  setCanvas: (canvas: Partial<CanvasState>) => void;
  addStroke: (stroke: Stroke) => void;
  removeStroke: (id: string) => void;
  updateStroke: (id: string, stroke: Partial<Stroke>) => void;
  addPoint: (point: Point) => void;
  removePoint: (id: string) => void;
  updatePoint: (id: string, point: Partial<Point>) => void;
  setSelection: (selection: Partial<SelectionState>) => void;
  undo: () => void;
  redo: () => void;
  setUI: (ui: Partial<UIState>) => void;
  setTheme: (theme: Theme) => void;
  setPerformance: (config: Partial<PerformanceConfig>) => void;
  reset: () => void;
}

export interface IconStore {
  icons: Icon[];
  currentIcon: Icon | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchIcons: () => Promise<void>;
  fetchIcon: (id: string) => Promise<void>;
  createIcon: (input: IconCreateInput) => Promise<Icon>;
  updateIcon: (input: IconUpdateInput) => Promise<Icon>;
  deleteIcon: (id: string) => Promise<void>;
  saveCurrentIcon: () => Promise<void>;
  setCurrentIcon: (icon: Icon | null) => void;
  clearError: () => void;
}

// ============================================================
// Utility Types
// ============================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type Nullable<T> = T | null;

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type RequiredFields<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

export type ValueOf<T> = T[keyof T];

export type AsyncReturnType<T extends (...args: any) => Promise<any>> = 
  T extends (...args: any) => Promise<infer R> ? R : any;

// ============================================================
// Constants
// ============================================================

export const DEFAULT_GRID_CONFIG: GridConfig = {
  spacing: 20,
  dotSize: 2,
  dotColor: '#ffffff',
  backgroundColor: '#1a1a2e',
  width: 800,
  height: 600,
};

export const DEFAULT_STROKE_STYLE: StrokeStyle = {
  color: '#ffffff',
  width: 2,
  opacity: 1,
  lineCap: 'round',
  lineJoin: 'round',
};

export const DEFAULT_FILL: Fill = {
  type: 'none',
  opacity: 1,
};

export const DEFAULT_CANVAS_STATE: CanvasState = {
  grid: DEFAULT_GRID_CONFIG,
  points: [],
  selectedPoints: [],
  zoom: 1,
  pan: { x: 0, y: 0 },
  isPanning: false,
};

export const TOOL_TYPES: ToolType[] = [
  'select',
  'point',
  'line',
  'curve',
  'freehand',
  'eraser',
  'pan',
  'zoom',
  'rectangle',
  'fill',
];

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
];

export const KEYBOARD_SHORTCUTS: ShortcutMap = {
  'ctrl+z': {
    key: 'z',
    ctrlKey: true,
    action: 'undo',
    description: 'Deshacer',
    handler: () => {},
  },
  'ctrl+y': {
    key: 'y',
    ctrlKey: true,
    action: 'redo',
    description: 'Rehacer',
    handler: () => {},
  },
  'ctrl+c': {
    key: 'c',
    ctrlKey: true,
    action: 'copy',
    description: 'Copiar',
    handler: () => {},
  },
  'ctrl+v': {
    key: 'v',
    ctrlKey: true,
    action: 'paste',
    description: 'Pegar',
    handler: () => {},
  },
  'ctrl+x': {
    key: 'x',
    ctrlKey: true,
    action: 'cut',
    description: 'Cortar',
    handler: () => {},
  },
  'ctrl+s': {
    key: 's',
    ctrlKey: true,
    action: 'save',
    description: 'Guardar',
    handler: () => {},
  },
  'delete': {
    key: 'Delete',
    action: 'delete',
    description: 'Eliminar selección',
    handler: () => {},
  },
  'escape': {
    key: 'Escape',
    action: 'deselect',
    description: 'Deseleccionar',
    handler: () => {},
  },
};