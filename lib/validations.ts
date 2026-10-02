import { z } from 'zod';
import { format } from 'date-fns';

// ==================== TIPOS BASE ====================
export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'other';
export type ExportQuality = 'web' | 'mobile' | 'high';
export type EffectCategory = 'vintage' | 'modern' | 'cinematic' | 'energetic';

export interface MediaFile {
  id: string;
  name: string;
  type: MediaType;
  size: number;
  url: string;
  thumbnailUrl?: string;
  uploadedAt: Date;
  metadata?: MediaMetadata;
  tags: string[];
  projectId?: string;
}

export interface MediaMetadata {
  width?: number;
  height?: number;
  duration?: number;
  format?: string;
  bitrate?: number;
  sampleRate?: number;
  artist?: string;
  album?: string;
  title?: string;
  cameraModel?: string;
  exposure?: string;
  iso?: number;
  aperture?: string;
  focalLength?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  coverUrl?: string;
  mediaIds: string[];
  createdAt: Date;
  updatedAt: Date;
  isPublic: boolean;
  shareLink?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  storageUsed: number;
  storageLimit: number;
  createdAt: Date;
}

// ==================== ESQUEMAS DE VALIDACIÓN ====================
export const mediaFileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  type: z.enum(['image', 'video', 'audio', 'document', 'other']),
  size: z.number().positive().max(10 * 1024 * 1024 * 1024), // 10GB max
  url: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  uploadedAt: z.date(),
  metadata: z.object({
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    duration: z.number().positive().optional(),
    format: z.string().optional(),
    bitrate: z.number().positive().optional(),
    sampleRate: z.number().positive().optional(),
    artist: z.string().optional(),
    album: z.string().optional(),
    title: z.string().optional(),
    cameraModel: z.string().optional(),
    exposure: z.string().optional(),
    iso: z.number().positive().optional(),
    aperture: z.string().optional(),
    focalLength: z.string().optional(),
  }).optional(),
  tags: z.array(z.string().max(50)).max(20),
  projectId: z.string().uuid().optional(),
});

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  coverUrl: z.string().url().optional(),
  mediaIds: z.array(z.string().uuid()),
  createdAt: z.date(),
  updatedAt: z.date(),
  isPublic: z.boolean(),
  shareLink: z.string().url().optional(),
});

export const userProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(50),
  email: z.string().email(),
  avatarUrl: z.string().url().optional(),
  storageUsed: z.number().min(0),
  storageLimit: z.number().positive(),
  createdAt: z.date(),
});

export const exportSettingsSchema = z.object({
  format: z.enum(['jpg', 'png', 'webp', 'mp4', 'webm', 'mp3', 'wav']),
  quality: z.enum(['web', 'mobile', 'high']),
  resolution: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }).optional(),
  bitrate: z.number().positive().optional(),
});

export const effectSettingsSchema = z.object({
  category: z.enum(['vintage', 'modern', 'cinematic', 'energetic']),
  intensity: z.number().min(0).max(100),
  brightness: z.number().min(-100).max(100).optional(),
  contrast: z.number().min(-100).max(100).optional(),
  saturation: z.number().min(-100).max(100).optional(),
});

export const imageEditSchema = z.object({
  brightness: z.number().min(-100).max(100).default(0),
  contrast: z.number().min(-100).max(100).default(0),
  saturation: z.number().min(-100).max(100).default(0),
  crop: z.object({
    x: z.number().min(0),
    y: z.number().min(0),
    width: z.number().positive(),
    height: z.number().positive(),
  }).optional(),
});

export const audioEditSchema = z.object({
  volumeNormalization: z.boolean().default(false),
  trimStart: z.number().min(0).default(0),
  trimEnd: z.number().min(0).default(0),
  effects: z.array(z.enum(['echo', 'fadeIn', 'fadeOut'])).default([]),
});

export const videoEditSchema = z.object({
  trimStart: z.number().min(0).default(0),
  trimEnd: z.number().min(0).default(0),
  extractFrames: z.boolean().default(false),
});

// ==================== VALIDADORES ====================
export class ValidationService {
  
  static validateMediaFile(fileData: unknown): MediaFile {
    try {
      const validated = mediaFileSchema.parse(fileData);
      return validated;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Invalid media file data', error.errors);
      }
      throw error;
    }
  }

  static validateProject(projectData: unknown): Project {
    try {
      const validated = projectSchema.parse(projectData);
      return validated;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Invalid project data', error.errors);
      }
      throw error;
    }
  }

  static validateUserProfile(profileData: unknown): UserProfile {
    try {
      const validated = userProfileSchema.parse(profileData);
      return validated;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Invalid user profile data', error.errors);
      }
      throw error;
    }
  }

  static validateExportSettings(settingsData: unknown) {
    try {
      return exportSettingsSchema.parse(settingsData);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Invalid export settings', error.errors);
      }
      throw error;
    }
  }

  static validateEffectSettings(settingsData: unknown) {
    try {
      return effectSettingsSchema.parse(settingsData);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Invalid effect settings', error.errors);
      }
      throw error;
    }
  }

  static validateImageEditSettings(settingsData: unknown) {
    try {
      return imageEditSchema.parse(settingsData);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Invalid image edit settings', error.errors);
      }
      throw error;
    }
  }

  static validateAudioEditSettings(settingsData: unknown) {
    try {
      return audioEditSchema.parse(settingsData);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Invalid audio edit settings', error.errors);
      }
      throw error;
    }
  }

  static validateVideoEditSettings(settingsData: unknown) {
    try {
      return videoEditSchema.parse(settingsData);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Invalid video edit settings', error.errors);
      }
      throw error;
    }
  }

  
}

// ==================== UTILIDADES DE VALIDACIÓN ====================
export class ValidationUtils {
  
}

// ==================== ERRORES PERSONALIZADOS ====================
export class ValidationError extends Error {
  errors?: z.ZodError['errors'];
  
  constructor(message: string, errors?: z.ZodError['errors']) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

// ==================== CONSTANTES DE VALIDACIÓN ====================
export const VALIDATION_CONSTANTS = {
  
};

// ==================== TIPOS DE GUARDIA ====================
export function isMediaFile(data: unknown): data is MediaFile {
  try {
    mediaFileSchema.parse(data);
    return true;
  } catch {
    return false;
  }
}

export function isProject(data: unknown): data is Project {
  try {
    projectSchema.parse(data);
    return true;
  } catch {
    return false;
  }
}

export function isUserProfile(data: unknown): data is UserProfile {
  try {
    userProfileSchema.parse(data);
    return true;
  } catch {
    return false;
  }
}

// ==================== EXPORTACIONES POR DEFECTO ====================
export default ValidationService;