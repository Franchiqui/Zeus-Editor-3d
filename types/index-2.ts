export type AIModelProvider = 'openai' | 'anthropic' | 'ollama' | 'ollama-cloud' | 'lmstudio' | 'local' | 'custom';
export type AIModelType = 'local' | 'remote';

export interface AIModelConfig {
  id: string;
  name: string;
  type: AIModelType;
  provider: AIModelProvider;
  endpoint: string;
  apiKey?: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  documentation?: string;
}

export interface AIModelConnection {
  status: 'connected' | 'disconnected' | 'error';
  latency: number;
  lastPing: Date;
  error?: string;
}

// Tutorial Types
export type TutorialStatus = 'draft' | 'recording' | 'processing' | 'completed' | 'failed';

export interface Tutorial {
  id: string;
  title: string;
  description: string;
  targetApp: string;
  status: TutorialStatus;
  steps: TutorialStep[];
  settings: TutorialSettings;
  metadata: TutorialMetadata;
  backgroundMusicUrl?: string;
  file?: string;
  fileSound?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TutorialStep {
  id: string;
  order: number;
  action: string;
  description: string;
  target?: string;
  value?: string;
  screenshot?: string;
  voiceover?: string;
  subtitle?: string;
  duration: number;
  mousePosition?: { x: number; y: number };
  keyboardInput?: string;
  waitTime?: number;
  // Tiempos absolutos (segundos) dentro del vídeo raw, para el editor de timeline.
  // Si no están, se calculan acumulando `duration` (mismo criterio que la generación).
  subtitleStart?: number;
  subtitleEnd?: number;
  voiceStart?: number;
}

export interface TutorialSettings {
  resolution: '1080p' | '1440p' | '4k';
  fps: number;
  backgroundMusic: boolean;
  musicVolume: number;
  backgroundMusicFile?: string;
  backgroundMusicFileName?: string;
  musicStartTime?: number;
  musicFadeInDuration?: number;
  musicFadeOutDuration?: number;
  voiceoverVolume: number;
  // Voz en off (edge-tts). Vacío = automática según el idioma de subtítulos.
  voice?: string;
  subtitleEnabled: boolean;
  subtitleLanguage: string;
  subtitlePosition?: 'bottom' | 'top' | 'center';
  subtitleVerticalOffset?: number;
  subtitleFontSize?: number;
  subtitleTextColor?: string;
  subtitleBackgroundColor?: string;
  subtitleBackgroundOpacity?: number;
  subtitleFontFamily?: string;
  recordingOutputPath?: string;
  mode?: 'browser' | 'desktop';
  quality: 'low' | 'medium' | 'high' | 'ultra';
  outputFormat: 'mp4' | 'webm';
  cursorImagePath?: string;
  cursorImageFileName?: string;
  // Tutorial creado manualmente: el usuario sube su propio vídeo base (sin
  // sonido) y rellena las tarjetas a mano. Exportar MP4 usa ese vídeo base
  // en lugar de la grabación automática. Se guarda en el JSON de settings;
  // no requiere un campo nuevo en PocketBase.
  manualMode?: boolean;
}

export interface TutorialMetadata {
  duration: number;
  fileSize: number;
  resolution: string;
  fps: number;
  audioBitrate: number;
  videoBitrate: number;
  thumbnail?: string;
  // Grabación de pantalla original (sin audio/subtítulos). Permite re-editar
  // el tutorial (editor de timeline) sin volver a grabar.
  rawVideoPath?: string;
  rawDuration?: number;
}

// Editor Types
export interface EditorState {
  currentTutorial: Tutorial | null;
  isRecording: boolean;
  isProcessing: boolean;
  currentStep: number;
  timelinePosition: number;
  zoomLevel: number;
  selectedTool: EditorTool;
}

export type EditorTool = 'select' | 'crop' | 'trim' | 'split' | 'text' | 'audio' | 'transition';

export interface TimelineClip {
  id: string;
  stepId: string;
  startTime: number;
  endTime: number;
  type: 'video' | 'audio' | 'text' | 'image';
  source: string;
  duration: number;
  effects: Effect[];
}

export interface Effect {
  id: string;
  type: 'fade' | 'zoom' | 'pan' | 'overlay' | 'transition';
  startTime: number;
  endTime: number;
  params: Record<string, unknown>;
}

// API Types
export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: Date;
}

export interface APIError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface APIPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Database Types (PocketBase)
export interface DatabaseRecord {
  id: string;
  created: Date;
  updated: Date;
  collectionId: string;
  collectionName: string;
}

export interface TutorialRecord extends DatabaseRecord {
  title: string;
  description: string;
  targetApp: string;
  status: TutorialStatus;
  settings: string; // JSON string
  metadata: string; // JSON string
  userId: string;
  fileUrl?: string;
}

export interface AIModelRecord extends DatabaseRecord {
  name: string;
  type: AIModelType;
  provider: AIModelProvider;
  endpoint: string;
  apiKey?: string;
  modelName: string;
  config: string; // JSON string
  userId: string;
}

// User Types
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  preferences: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPreferences {
  theme: 'dark' | 'light';
  accentColor: string;
  defaultResolution: string;
  autoSave: boolean;
  autoSaveInterval: number;
  language: string;
}

// Modal Types
export interface ModalConfig {
  isOpen: boolean;
  type: 'model' | 'tutorial' | 'settings' | 'export' | 'confirm';
  data?: Record<string, unknown>;
  onClose?: () => void;
  onConfirm?: (data: Record<string, unknown>) => void;
}

// Recording Types
export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  startTime: Date | null;
  elapsedTime: number;
  currentAction: string;
  mousePosition: { x: number; y: number };
  keyboardEvents: KeyboardEvent[];
  screenshotQueue: string[];
}

export interface RecordingAction {
  type: 'click' | 'move' | 'keypress' | 'scroll' | 'wait';
  timestamp: number;
  data: Record<string, unknown>;
}

// Export Types
export interface ExportConfig {
  format: 'mp4' | 'webm';
  resolution: string;
  quality: 'low' | 'medium' | 'high' | 'ultra';
  includeAudio: boolean;
  includeSubtitles: boolean;
  compressionLevel: number;
  outputPath?: string;
}

export interface ExportProgress {
  stage: 'encoding' | 'audio' | 'subtitles' | 'finalizing';
  progress: number;
  estimatedTimeRemaining: number;
}

// Store Types (Zustand)
export interface TutorialStore {
  tutorials: Tutorial[];
  currentTutorial: Tutorial | null;
  isLoading: boolean;
  error: string | null;
  setCurrentTutorial: (tutorial: Tutorial | null) => void;
  addTutorial: (tutorial: Tutorial) => void;
  updateTutorial: (id: string, updates: Partial<Tutorial>) => void;
  deleteTutorial: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export interface AIModelStore {
  models: AIModelConfig[];
  currentModel: AIModelConfig | null;
  connection: AIModelConnection | null;
  isLoading: boolean;
  error: string | null;
  setCurrentModel: (model: AIModelConfig | null) => void;
  addModel: (model: AIModelConfig) => void;
  updateModel: (id: string, updates: Partial<AIModelConfig>) => void;
  deleteModel: (id: string) => void;
  setConnection: (connection: AIModelConnection | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export interface EditorStore {
  state: EditorState;
  timeline: TimelineClip[];
  selectedClip: TimelineClip | null;
  setState: (state: Partial<EditorState>) => void;
  addClip: (clip: TimelineClip) => void;
  removeClip: (id: string) => void;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
  setSelectedClip: (clip: TimelineClip | null) => void;
}

// Utility Types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type Nullable<T> = T | null;

export type AsyncReturnType<T extends (...args: unknown[]) => unknown> = 
  T extends (...args: unknown[]) => Promise<infer R> ? R : never;

// Constants
export const DEFAULT_TUTORIAL_SETTINGS: TutorialSettings = {
  resolution: '1080p',
  fps: 30,
  backgroundMusic: false,
  musicVolume: 0.3,
  voiceoverVolume: 0.8,
  subtitleEnabled: true,
  subtitleLanguage: 'en',
  quality: 'high',
  outputFormat: 'mp4',
};

export const DEFAULT_AI_MODEL_CONFIG: Partial<AIModelConfig> = {
  temperature: 0.7,
  maxTokens: 2048,
  isActive: true,
};

export const SUPPORTED_RESOLUTIONS = ['1080p', '1440p', '4k'] as const;
export const SUPPORTED_FORMATS = ['mp4', 'webm'] as const;
export const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'] as const;

// Theme Types
export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  error: string;
  success: string;
  warning: string;
}

export const DARK_THEME: ThemeColors = {
  primary: '#3B82F6',
  secondary: '#6366F1',
  accent: '#8B5CF6',
  background: '#0F172A',
  surface: '#1E293B',
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  border: '#334155',
  error: '#EF4444',
  success: '#22C55E',
  warning: '#F59E0B',
};

export const LIGHT_THEME: ThemeColors = {
  primary: '#2563EB',
  secondary: '#4F46E5',
  accent: '#7C3AED',
  background: '#F8FAFC',
  surface: '#FFFFFF',
  text: '#0F172A',
  textSecondary: '#64748B',
  border: '#E2E8F0',
  error: '#DC2626',
  success: '#16A34A',
  warning: '#D97706',
};