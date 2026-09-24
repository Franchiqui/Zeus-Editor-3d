export const APP_NAME = 'Zeus Media Studio';
export const APP_SLOGAN = 'Crea, organiza y comparte tu universo multimedia.';
export const APP_VERSION = '1.0.0';

// File type constants
export const FILE_TYPES = {
  IMAGE: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  VIDEO: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
  AUDIO: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'],
  DOCUMENT: ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
} as const;

export type FileType = keyof typeof FILE_TYPES;

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
export const ACCEPTED_FILE_TYPES = [
  ...FILE_TYPES.IMAGE,
  ...FILE_TYPES.VIDEO,
  ...FILE_TYPES.AUDIO,
  ...FILE_TYPES.DOCUMENT,
];

// Storage constants
export const STORAGE_LIMITS = {
  FREE: 5 * 1024 * 1024 * 1024, // 5GB
  PRO: 50 * 1024 * 1024 * 1024, // 50GB
  ENTERPRISE: 500 * 1024 * 1024 * 1024, // 500GB
} as const;

// Editor constants
export const EDITOR_CONFIG = {
  IMAGE: {
    MIN_BRIGHTNESS: -100,
    MAX_BRIGHTNESS: 100,
    MIN_CONTRAST: -100,
    MAX_CONTRAST: 100,
    MIN_SATURATION: -100,
    MAX_SATURATION: 100,
    DEFAULT_QUALITY: 0.85,
  },
  AUDIO: {
    MIN_VOLUME: 0,
    MAX_VOLUME: 200,
    DEFAULT_NORMALIZATION: -1.0,
  },
  VIDEO: {
    SUPPORTED_FORMATS: ['mp4', 'webm'],
    DEFAULT_FPS: 30,
  },
} as const;

// Filter categories
export const FILTER_CATEGORIES = [
  { id: 'vintage', name: 'Vintage', color: '#8B4513' },
  { id: 'modern', name: 'Moderno', color: '#1E40AF' },
  { id: 'cinematic', name: 'Cinematográfico', color: '#000000' },
  { id: 'energetic', name: 'Energético', color: '#DC2626' },
] as const;

// Export presets
export const EXPORT_PRESETS = [
  { id: 'web', name: 'Para web', quality: 0.7, format: 'webp' },
  { id: 'high-quality', name: 'Alta calidad', quality: 0.95, format: 'png' },
  { id: 'mobile', name: 'Para móvil', quality: 0.8, format: 'jpeg' },
] as const;

// Dashboard widget IDs
export const DASHBOARD_WIDGETS = {
  RECENT_FILES: 'recent-files',
  ACTIVE_PROJECTS: 'active-projects',
  STORAGE_USAGE: 'storage-usage',
  CONTENT_SUGGESTIONS: 'content-suggestions',
} as const;

// API routes
export const API_ROUTES = {
  UPLOAD: '/api/upload',
  METADATA: '/api/metadata',
  EXPORT: '/api/export',
  SHARE: '/api/share',
} as const;

// Animation constants
export const ANIMATION_DURATIONS = {
  FAST: 150,
  NORMAL: 300,
  SLOW: 500,
} as const;

// Breakpoints (matches Tailwind defaults)
export const BREAKPOINTS = {
  SM: 640,
  MD: 768,
  LG: 1024,
  XL: 1280,
  '2XL': 1536,
} as const;

// Color palette
export const COLORS = {
  PRIMARY: {
    50: '#f5f3ff',
    100: '#ede9fe',
    200: '#ddd6fe',
    300: '#c4b5fd',
    400: '#a78bfa',
    500: '#8b5cf6',
    600: '#7c3aed',
    700: '#6d28d9',
    800: '#5b21b6',
    900: '#4c1d95',
    950: '#2e1065',
  },
  SECONDARY: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
    950: '#172554',
  },
} as const;

// Local storage keys
export const LOCAL_STORAGE_KEYS = {
  DASHBOARD_LAYOUT: 'Zeus-dashboard-layout',
  USER_PREFERENCES: 'Zeus-user-preferences',
  RECENT_PROJECTS: 'Zeus-recent-projects',
} as const;

// Validation constants
export const VALIDATION = {
  PROJECT_NAME_MIN_LENGTH: 3,
  PROJECT_NAME_MAX_LENGTH: 100,
  PROJECT_DESCRIPTION_MAX_LENGTH: 500,
  TAG_MAX_LENGTH: 50,
} as const;

// Metadata field types
export const METADATA_FIELDS = {
  IMAGE: ['camera', 'lens', 'exposure', 'aperture', 'iso', 'focalLength'],
  AUDIO: ['artist', 'album', 'genre', 'year', 'bitrate', 'duration'],
  VIDEO: ['resolution', 'duration', 'codec', 'frameRate'],
} as const;

// Share options
export const SHARE_OPTIONS = [
  { id: 'link', name: 'Enlace compartido', icon: 'Link' },
  { id: 'embed', name: 'Código embebido', icon: 'Code' },
] as const;

// Performance constants
export const PERFORMANCE = {
  LAZY_LOAD_THRESHOLD: 300, // pixels from viewport
  DEBOUNCE_DELAY: 300, // ms
} as const;