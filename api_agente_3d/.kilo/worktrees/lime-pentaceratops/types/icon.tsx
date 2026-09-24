'use client';


// ============================================================================
// Main Icon Definition (PocketBase record)
// ============================================================================
// Main Icon Definition (PocketBase record)
// ============================================================================
// Main Icon Definition (PocketBase record)
// ============================================================================
// Core Icon Types
// ============================================================================

/**
 * Represents a complete icon definition as stored in the database.
 * Mirrors the PocketBase 'icons' collection schema.
 */

/**
 * Supported icon licenses.
 */
export type IconLicense = 'CC0' | 'CC-BY' | 'CC-BY-SA' | 'MIT' | 'Apache-2.0' | 'Proprietary' | 'Custom';

export interface IconLicenseInfo {
  type: IconLicense;
  customText?: string;
  url?: string;
}

/**
 * Export format identifiers.
 */
export type ExportFormat = 'svg' | 'png' | 'ico' | 'icns' | 'webp' | 'json';

export interface ExportPreset {
  name: string;
  format: ExportFormat;
  width: number;
  height: number;
  quality?: number; // 0-100 for lossy formats
  scale?: number; // Multiplier for SVG/vector
  includeMetadata?: boolean;
}

// ============================================================================
// Layer System
// ============================================================================

export interface IconLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0-1
  blendMode: BlendMode;
  order: number; // z-index / stacking order
  objects: IconObject[];
  mask?: IconMask;
  effects: LayerEffect[];
  metadata?: Record<string, unknown>;
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
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface IconMask {
  enabled: boolean;
  type: 'alpha' | 'luminance' | 'vector';
  objects: IconObject[]; // Mask shape objects
}

// ============================================================================
// Icon Objects (Shapes & Paths)
// ============================================================================

export type IconObject =
  | PathObject
  | RectangleObject
  | EllipseObject
  | PolygonObject
  | StarObject
  | LineObject
  | TextObject
  | GroupObject
  | BooleanOperationObject;

export interface BaseIconObject {
  id: string;
  type: IconObjectType;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  transform: Transform;
  fill: FillProperties;
  stroke: StrokeProperties;
  effects: ObjectEffect[];
  metadata?: Record<string, unknown>;
}

export type IconObjectType =
  | 'path'
  | 'rectangle'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'text'
  | 'group'
  | 'boolean-operation';

export interface Transform {
  translateX: number;
  translateY: number;
  rotate: number; // degrees
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  originX: number; // 0-1 relative
  originY: number; // 0-1 relative
}

export interface FillProperties {
  enabled: boolean;
  type: FillType;
  color: string; // hex or rgba
  gradient?: GradientDefinition;
  pattern?: PatternDefinition;
  opacity: number;
}

export type FillType = 'solid' | 'gradient' | 'pattern' | 'none';

export interface StrokeProperties {
  enabled: boolean;
  color: string;
  width: number;
  opacity: number;
  cap: StrokeCap;
  join: StrokeJoin;
  miterLimit: number;
  dashArray: number[];
  dashOffset: number;
  gradient?: GradientDefinition;
  alignment: 'center' | 'inner' | 'outer';
}

export type StrokeCap = 'butt' | 'round' | 'square';
export type StrokeJoin = 'miter' | 'round' | 'bevel';

export interface GradientDefinition {
  id: string;
  type: 'linear' | 'radial' | 'angular';
  stops: GradientStop[];
  transform?: Partial<Transform>;
  // Linear gradient
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  // Radial/Angular gradient
  cx?: number;
  cy?: number;
  r?: number;
  fx?: number;
  fy?: number;
}

export interface GradientStop {
  offset: number; // 0-1
  color: string;
  opacity: number;
}

export interface PatternDefinition {
  id: string;
  type: 'checkerboard' | 'dots' | 'lines' | 'crosshatch' | 'custom';
  width: number;
  height: number;
  objects?: IconObject[]; // For custom patterns
  fill?: string;
  stroke?: string;
  spacing?: number;
  angle?: number;
}

export interface PathObject extends BaseIconObject {
  type: 'path';
  pathData: string; // SVG path data
  closed: boolean;
  windingRule: 'nonzero' | 'evenodd';
}

export interface RectangleObject extends BaseIconObject {
  type: 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius: number | [number, number, number, number]; // uniform or [tl, tr, br, bl]
}

export interface EllipseObject extends BaseIconObject {
  type: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  startAngle?: number;
  endAngle?: number;
  closedArc?: boolean;
}

export interface PolygonObject extends BaseIconObject {
  type: 'polygon';
  points: Point[];
  closed: boolean;
}

export interface StarObject extends BaseIconObject {
  type: 'star';
  cx: number;
  cy: number;
  points: number; // Number of star points (e.g., 5)
  innerRadius: number;
  outerRadius: number;
  rotation: number;
  cornerRadius?: number;
}

export interface LineObject extends BaseIconObject {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  // Arrowheads
  startArrow?: ArrowheadDefinition;
  endArrow?: ArrowheadDefinition;
}

export interface ArrowheadDefinition {
  type: 'none' | 'triangle' | 'circle' | 'square' | 'diamond' | 'custom';
  width: number;
  height: number;
  pathData?: string; // For custom arrowhead
}

export interface TextObject extends BaseIconObject {
  type: 'text';
  content: string;
  x: number;
  y: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number | string;
  fontStyle: 'normal' | 'italic' | 'oblique';
  textAlign: 'left' | 'center' | 'right' | 'justify';
  textAnchor: 'start' | 'middle' | 'end';
  lineHeight: number;
  letterSpacing: number;
  textDecoration: 'none' | 'underline' | 'line-through' | 'overline';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  // Text on path
  pathId?: string;
  pathOffset?: number;
}

export interface GroupObject extends BaseIconObject {
  type: 'group';
  objects: IconObject[];
}

export interface BooleanOperationObject extends BaseIconObject {
  type: 'boolean-operation';
  operation: BooleanOperation;
  objects: IconObject[]; // Exactly 2 objects for most operations
}

export type BooleanOperation = 'union' | 'subtract' | 'intersect' | 'exclude' | 'divide';

// ============================================================================
// Effects
// ============================================================================

export interface LayerEffect {
  id: string;
  type: LayerEffectType;
  enabled: boolean;
  visible: boolean;
  properties: Record<string, unknown>;
}

export type LayerEffectType =
  | 'drop-shadow'
  | 'inner-shadow'
  | 'glow'
  | 'inner-glow'
  | 'bevel-emboss'
  | 'color-overlay'
  | 'gradient-overlay'
  | 'pattern-overlay'
  | 'stroke'
  | 'blur';

export interface DropShadowEffect extends LayerEffect {
  type: 'drop-shadow';
  properties: {
    color: string;
    opacity: number;
    offsetX: number;
    offsetY: number;
    blur: number;
    spread: number;
    blendMode: BlendMode;
  };
}

export interface BlurEffect extends LayerEffect {
  type: 'blur';
  properties: {
    amount: number;
    type: 'gaussian' | 'motion' | 'radial' | 'zoom';
    angle?: number;
  };
}

export interface ObjectEffect {
  id: string;
  type: ObjectEffectType;
  enabled: boolean;
  properties: Record<string, unknown>;
}

export type ObjectEffectType = 'drop-shadow' | 'glow' | 'blur' | 'distort' | 'transform';

// ============================================================================
// Geometry Primitives
// ============================================================================

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BezierCurve {
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
}

export interface PathSegment {
  type: 'M' | 'L' | 'C' | 'Q' | 'A' | 'Z' | 'H' | 'V' | 'S' | 'T';
  points: Point[];
  relative: boolean;
}

// ============================================================================
// Icon Library Types
// ============================================================================

export interface IconLibrary {
  id: string;
  collectionId: string;
  collectionName: 'libraries';
  created: string;
  updated: string;
  name: string;
  description?: string;
  iconCount: number;
  ownerId: string;
  isPublic: boolean;
  isSystem: boolean;
  color?: string;
  icon?: string; // Thumbnail or representative icon
  tags?: string[];
  license?: IconLicense;
  settings?: LibrarySettings;
}

export interface LibrarySettings {
  defaultCanvasSize: { width: number; height: number };
  gridSize: number;
  snapToGrid: boolean;
  showGrid: boolean;
  theme: IconTheme;
  defaultExportFormat: string;
  autoSaveInterval: number; // in minutes, 0 = disabled
  collaborativeEditing: boolean;
}

export interface IconTheme {
  mode: 'dark' | 'light' | 'system';
  primaryColor: string;
  accentColor: string;
  canvasBackground: string;
}

// ============================================================================
// Main Icon Definition (PocketBase record)
// ============================================================================

export interface IconDefinition {
  id: string;
  collectionId: string;
  collectionName?: 'icons';
  created?: string;
  updated?: string;
  name: string;
  description?: string;
  // Canvas/Artboard
  artboardWidth: number;
  artboardHeight: number;
  // The actual vector data as a structured format
  objects: IconObject[];
  // Alternative: raw SVG string
  svgData?: string;
  // Grid and snap settings
  gridSize: number;
  snapToGrid: boolean;
  showGrid: boolean;
  // Color palette used in the icon
  colorPalette: ColorPaletteEntry[];
  // Metadata
  libraryId: string; // Foreign key to IconLibrary
  tags?: string[];
  category?: string;
  style?: IconStyle;
  isTemplate?: boolean;
  version: number;
  // User ownership
  ownerId: string;
  // Collaboration
  collaborators?: string[]; // Array of user IDs
  lockedBy?: string;
  lockExpires?: string;
  // Export settings
  exportPreferences?: ExportPreferences;
  // Thumbnail
  thumbnail?: string; // Base64 PNG thumbnail
  thumbnailGeneratedAt?: string;
  // Soft delete
  archived?: boolean;
  archivedAt?: string;
}

export interface ColorPaletteEntry {
  id: string;
  name?: string;
  hex: string;
  opacity: number;
  isGlobal: boolean;
  location: 'canvas' | 'stroke' | 'fill'; // where this color appears
}

export type IconStyle =
  | 'filled'
  | 'outline'
  | 'duotone'
  | 'color'
  | 'flat'
  | 'gradient'
  | 'hand-drawn'
  | 'pixel-art'
  | 'material'
  | 'line-art'
  | 'isometric';

export interface ExportPreferences {
  defaultFormat: string;
  includePNG: boolean;
  includeSVG: boolean;
  includeICO: boolean;
  includeICNS: boolean;
  svgOptimization: SvgOptimizationOptions;
  pngScale: number; // 1x, 2x, 3x, etc.
  backgroundTransparent: boolean;
  exportPath: string;
  autoExportOnSave: boolean;
}

export interface SvgOptimizationOptions {
  minify: boolean;
  removeComments: boolean;
  removeMetadata: boolean;
  removeHiddenElements: boolean;
  removeEmptyGroups: boolean;
  mergePaths: boolean;
  precision: number; // decimal places for coordinates
  styleToAttribute: boolean;
}

// ============================================================================
// Icon Import/Export
// ============================================================================

export interface IconImportResult {
  status: 'success' | 'error' | 'partial';
  icon?: IconDefinition;
  objects?: IconObject[];
  errors: ImportError[];
  warnings: ImportWarning[];
}

export interface ImportError {
  code: ImportErrorCode;
  message: string;
  line?: number;
  column?: number;
  elementId?: string;
}

export type ImportErrorCode =
  | 'unsupported_format'
  | 'parse_error'
  | 'invalid_svg'
  | 'large_file'
  | 'dimension_exceeded'
  | 'complex_path'
  | 'unknown_element'
  | 'missing_attribute'
  | 'invalid_value';

export interface ImportWarning {
  code: string;
  message: string;
  elementId?: string;
  suggestedFix?: string;
}

export interface IconExportResult {
  format: string;
  data: Blob | string;
  filename: string;
  size: number; // in bytes
  dimensions: { width: number; height: number };
  mimeType: string;
}

// ============================================================================
// Collaboration Types
// ============================================================================

export interface CollaborationSession {
  id: string;
  iconId: string;
  participants: CollaborationParticipant[];
  lastActivity: string;
  changes: CollaborationChange[];
}

export interface CollaborationParticipant {
  userId: string;
  name: string;
  avatar?: string;
  cursorPosition?: Point;
  selectedObjectIds?: string[];
  lastSeen: string;
  color: string; // assigned color for cursor and selections
}

export interface CollaborationChange {
  id: string;
  type: 'add' | 'modify' | 'remove' | 'reorder';
  objectId: string;
  timestamp: string;
  userId: string;
  payload: Record<string, unknown>;
  reverted: boolean;
}

// ============================================================================
// Icon Search & Filtering
// ============================================================================

export interface IconSearchParams {
  query?: string;
  tags?: string[];
  libraryId?: string;
  style?: IconStyle;
  category?: string;
  author?: string;
  license?: IconLicense;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  createdAfter?: string;
  createdBefore?: string;
  sortBy?: IconSortField;
  sortDirection?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  includeArchived?: boolean;
}

export type IconSortField =
  | 'name'
  | 'created'
  | 'updated'
  | 'width'
  | 'height'
  | 'popularity'
  | 'relevance';

export interface IconSearchResult {
  items: IconDefinition[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  facets?: IconSearchFacets;
}

export interface IconSearchFacets {
  tags: { value: string; count: number }[];
  styles: { value: IconStyle; count: number }[];
  libraries: { value: string; count: number }[];
  licenses: { value: string; count: number }[];
}

// ============================================================================
// Icon Versioning
// ============================================================================

export interface IconVersion {
  id: string;
  iconId: string;
  version: number;
  objects: IconObject[];
  snapshot: string; // JSON stringified snapshot
  created: string;
  authorId: string;
  message?: string;
  changes: string[]; // Summary of changes
}

// ============================================================================
// Helper Types & Utilities
// ============================================================================

export interface IconDimensions {
  width: number;
  height: number;
  unit: 'px' | 'mm' | 'cm' | 'in';
  dpi: number;
}

export interface IconTransform {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  skewX: number;
  skewY: number;
  originX: number;
  originY: number;
}

export type SelectionMode = 'single' | 'multiple' | 'add' | 'range';

export type CursorMode =
  | 'default'
  | 'crosshair'
  | 'pointer'
  | 'move'
  | 'text'
  | 'wait'
  | 'help'
  | 'not-allowed'
  | 'nw-resize'
  | 'n-resize'
  | 'ne-resize'
  | 'e-resize'
  | 'se-resize'
  | 's-resize'
  | 'sw-resize'
  | 'w-resize';

export interface IconEditorState {
  iconId: string | null;
  objects: IconObject[];
  selectedObjectIds: string[];
  activeTool: string;
  zoom: number;
  panX: number;
  panY: number;
  showGrid: boolean;
  gridSize: number;
  snapToGrid: boolean;
  cursorMode: CursorMode;
  editingTextId: string | null;
  isDirty: boolean;
  history: IconObject[][]; // array of object snapshots for undo
  future: IconObject[][]; // for redo
  clipboard: IconObject[];
  collaborationSession?: CollaborationSession;
}

// ============================================================================
// Animation (for later)
// ============================================================================

export interface AnimationDefinition {
  id: string;
  iconId: string;
  name: string;
  duration: number; // ms
  delay: number;
  easing: string;
  iterations: number; // 0 = infinite
  keyframes: AnimationKeyframe[];
  affectedObjectIds: string[];
  triggers: AnimationTrigger[];
}

export interface AnimationKeyframe {
  offset: number; // 0-1
  properties: Partial<Record<string, unknown>>;
  easing?: string;
}

export interface AnimationTrigger {
  event: 'hover' | 'click' | 'scroll' | 'load' | 'custom';
  customEventName?: string;
  delayFromEvent?: number;
  targetElementId?: string;
}

// ============================================================================
// Plugin System (extensibility)
// ============================================================================

export interface IconPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string; // path to main file
  permissions: PluginPermission[];
  settings?: Record<string, unknown>;
}

export type PluginPermission =
  | 'canvas:read'
  | 'canvas:write'
  | 'export:read'
  | 'export:write'
  | 'storage:read'
  | 'storage:write'
  | 'network'
  | 'ui';

// ============================================================================
// Constants & Enums (if any additional needed)
// ============================================================================

export const ALIGNMENT_TYPES = {
  LEFT: 'align-left',
  CENTER_H: 'align-center-h',
  RIGHT: 'align-right',
  TOP: 'align-top',
  CENTER_V: 'align-center-v',
  BOTTOM: 'align-bottom',
  DISTRIBUTE_H: 'distribute-horizontally',
  DISTRIBUTE_V: 'distribute-vertically',
} as const;

export type AlignmentType = (typeof ALIGNMENT_TYPES)[keyof typeof ALIGNMENT_TYPES];

export interface AlignmentOptions {
  type: AlignmentType;
  relativeTo: 'selection' | 'canvas' | 'first-selected';
}

/**
 * Utility type to extract only the essential icon info for lists/previews
 */
export interface IconSummary {
  id: string;
  name: string;
  thumbnail: string;
  artboardWidth: number;
  artboardHeight: number;
  libraryId: string;
  tags: string[];
  style?: IconStyle;
  created: string;
  updated: string;
}
