// Auto-generated API client for Editor tutoriales Zeus IA - Refactored for uniqueness
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

import type { TutorialSettings } from '@/types';

// Tutorials
export async function api_tutorials_list() {
  const res = await fetch(`${BASE_URL}/api/tutorials`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('GET /api/tutorials failed: ' + res.status);
  return res.json();
}

export async function api_tutorials_create(data: { title: string; description?: string; modelId?: string; appPath?: string; status?: string; steps?: unknown[]; settings?: TutorialSettings | Record<string, unknown>; metadata?: Record<string, unknown>; prompt?: string; backgroundMusic?: File }) {
  const formData = new FormData();
  formData.append('title', data.title || 'Nuevo Tutorial');
  if (data.description) formData.append('description', data.description);
  if (data.modelId) formData.append('modelId', data.modelId);
  if (data.appPath) formData.append('appPath', data.appPath);
  if (data.status) formData.append('status', data.status);
  if (data.steps) formData.append('steps', JSON.stringify(data.steps));
  if (data.settings) formData.append('settings', JSON.stringify(data.settings as Record<string, unknown>));
  if (data.metadata) formData.append('metadata', JSON.stringify(data.metadata));
  if (data.prompt) formData.append('prompt', data.prompt);
  if (data.backgroundMusic) formData.append('backgroundMusic', data.backgroundMusic);

  const res = await fetch(`${BASE_URL}/api/tutorials`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('POST /api/tutorials failed: ' + res.status);
  return res.json();
}

export async function api_tutorials_get(id: string) {
  const res = await fetch(`${BASE_URL}/api/tutorials/${id}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('GET /api/tutorials/{id} failed: ' + res.status);
  return res.json();
}

export async function api_tutorials_update(id: string, data: { title?: string; description?: string; modelId?: string; status?: string; prompt?: string; settings?: TutorialSettings | Record<string, unknown>; metadata?: Record<string, unknown>; steps?: unknown[]; backgroundMusic?: File | null }) {
  const formData = new FormData();
  if (data.title) formData.append('title', data.title);
  if (data.description) formData.append('description', data.description);
  if (data.modelId) formData.append('modelId', data.modelId);
  if (data.status) formData.append('status', data.status);
  if (data.prompt) formData.append('prompt', data.prompt);
  if (data.settings) formData.append('settings', JSON.stringify(data.settings as Record<string, unknown>));
  if (data.metadata) formData.append('metadata', JSON.stringify(data.metadata));
  if (data.steps) formData.append('steps', JSON.stringify(data.steps));
  if (data.backgroundMusic) formData.append('backgroundMusic', data.backgroundMusic);

  const res = await fetch(`${BASE_URL}/api/tutorials/${id}`, {
    method: 'PUT',
    body: formData,
  });
  if (!res.ok) throw new Error('PUT /api/tutorials/{id} failed: ' + res.status);
  return res.json();
}

export async function api_tutorials_delete(id: string) {
  const res = await fetch(`${BASE_URL}/api/tutorials/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('DELETE /api/tutorials/{id} failed: ' + res.status);
  return res.json();
}

export async function api_tutorials_generate(
  description: string,
  modelId: string,
  appPath: string,
  servePort: number,
  previewPort: number,
  mode?: 'browser' | 'desktop',
  recordingOutputPath?: string,
  recordingArea?: { x: number; y: number; width: number; height: number },
  previewZoom?: number,
  devicePixelRatio?: number,
  controlPoints?: { id: string; name: string; x: number; y: number }[],
  controlPointsReal?: { id: string; name: string; x: number; y: number }[],
  realMouseOffset?: { x: number; y: number },
  virtualMouseOffset?: { x: number; y: number },
  realMouseScale?: { x: number; y: number },
  cursorImagePath?: string,
  manualSteps?: string,
  stepsCount?: number,
  settings?: TutorialSettings | Record<string, unknown>,
  backgroundMusicUrl?: string,
  videoSettings?: VideoSettings,
  tutorialId?: string
) {
  const res = await fetch(`${BASE_URL}/api/tutorials/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, modelId, appPath, servePort, previewPort, mode, recordingOutputPath, recordingArea, previewZoom, devicePixelRatio, controlPoints, controlPointsReal, realMouseOffset, virtualMouseOffset, realMouseScale, cursorImagePath, manualSteps, stepsCount, settings, backgroundMusicUrl, videoSettings, tutorialId })
  });
  if (!res.ok) throw new Error('POST /api/tutorials/generate failed: ' + res.status);
  return res.json();
}

export async function api_tutorials_generation_status(id: string) {
  const res = await fetch(`${BASE_URL}/api/tutorials/generation/${id}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('GET /api/tutorials/generation/{id} failed: ' + res.status);
  return res.json();
}

// Re-construye el MP4 de un tutorial desktop a partir de sus pasos editados
// (textos de subtítulo/voz y tiempos), re-mezclando sobre la grabación raw.
export async function api_tutorials_rebuild(
  id: string,
  payload: {
    steps: Array<{
      id?: string;
      subtitle?: string;
      voiceover?: string;
      subtitleStart?: number;
      subtitleEnd?: number;
      voiceStart?: number;
      duration?: number;
    }>;
    settings?: Record<string, unknown> | TutorialSettings;
    backgroundMusicUrl?: string;
    videoSettings?: VideoSettings;
  }
) {
  const res = await fetch(`${BASE_URL}/api/tutorials/${id}/rebuild`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error || `POST /api/tutorials/{id}/rebuild failed: ${res.status}`;
    throw new Error(msg);
  }
  return body as { id: string; status: string; progress: number; message: string };
}

// Recorta el MP4 final de un tutorial desktop según los rangos a conservar
// (start/end en segundos). Soporta cortar por delante, por detrás y extraer un
// fragmento del medio (varios segmentos → se concatenan). No re-mezcla voz ni
// subtítulos: opera sobre el MP4 ya generado. El progreso se consulta con
// api_tutorials_generation_status(jobId).
export async function api_tutorials_trim(
  id: string,
  payload: { segments: Array<{ start: number; end: number; speed?: number }> }
) {
  const res = await fetch(`${BASE_URL}/api/tutorials/${id}/trim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error || `POST /api/tutorials/{id}/trim failed: ${res.status}`;
    throw new Error(msg);
  }
  return body as { id: string; status: string; progress: number; message: string };
}

export async function api_tutorials_download(id: string) {
  const res = await fetch(`${BASE_URL}/api/tutorials/${id}/download`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('GET /api/tutorials/{id}/download failed: ' + res.status);
  return res.json();
}

export async function api_tutorials_upload_video(id: string, blob: Blob) {
  const formData = new FormData();
  formData.append('video', blob, 'tutorial-video.webm');
  const res = await fetch(`${BASE_URL}/api/tutorials/${id}/video`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('POST /api/tutorials/{id}/video failed: ' + res.status);
  return res.json();
}

// Sube un vídeo base propio para un tutorial manual. El backend le quita el
// audio (ffmpeg -an), lo copia a la carpeta del proyecto, fija
// metadata.rawVideoPath + rawDuration y settings.manualMode=true. Devuelve
// el tutorial actualizado para que el frontend refresque currentTutorial.
export async function api_tutorials_upload_raw_video(id: string, file: File) {
  const formData = new FormData();
  formData.append('video', file);
  const res = await fetch(`${BASE_URL}/api/tutorials/${id}/raw-video`, {
    method: 'POST',
    body: formData,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error || `POST /api/tutorials/{id}/raw-video failed: ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export async function api_tutorials_play_step(id: string, stepIndex: number, servePort: number, previewPort: number) {
  const res = await fetch(`${BASE_URL}/api/tutorials/${id}/play-step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stepIndex, servePort, previewPort })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error || `POST /api/tutorials/{id}/play-step failed: ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

// Models
export async function api_models_list() {
  const res = await fetch(`${BASE_URL}/api/models`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('GET /api/models failed: ' + res.status);
  return res.json();
}

export async function api_models_create(name: string, type: string, provider: string, endpoint: string, apiKey: string, modelName?: string) {
  const res = await fetch(`${BASE_URL}/api/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type, provider, endpoint, apiKey, modelName })
  });
  if (!res.ok) throw new Error('POST /api/models failed: ' + res.status);
  return res.json();
}

export async function api_models_update(id: string, name: string, endpoint: string, apiKey: string) {
  const res = await fetch(`${BASE_URL}/api/models/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name, endpoint, apiKey })
  });
  if (!res.ok) throw new Error('PUT /api/models/{id} failed: ' + res.status);
  return res.json();
}

export async function api_models_delete(id: string) {
  const res = await fetch(`${BASE_URL}/api/models/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('DELETE /api/models/{id} failed: ' + res.status);
  return res.json();
}

// Settings
export async function api_settings_get() {
  const res = await fetch(`${BASE_URL}/api/settings`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('GET /api/settings failed: ' + res.status);
  return res.json();
}

export async function api_settings_update(theme: string, language: string, outputResolution: string, backgroundMusic: boolean) {
  const res = await fetch(`${BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme, language, outputResolution, backgroundMusic })
  });
  if (!res.ok) throw new Error('PUT /api/settings failed: ' + res.status);
  return res.json();
}

// Editor
export async function api_editor_state_get() {
  const res = await fetch(`${BASE_URL}/api/editor/state`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('GET /api/editor/state failed: ' + res.status);
  return res.json();
}

export async function api_editor_timeline_update(clips: any[], transitions: any[]) {
  const res = await fetch(`${BASE_URL}/api/editor/timeline`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clips, transitions })
  });
  if (!res.ok) throw new Error('PUT /api/editor/timeline failed: ' + res.status);
  return res.json();
}

export async function api_editor_export(tutorialId: string, resolution: string) {
  const res = await fetch(`${BASE_URL}/api/editor/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tutorialId, resolution })
  });
  if (!res.ok) throw new Error('POST /api/editor/export failed: ' + res.status);
  return res.json();
}

// Control Points
export async function api_control_points_list() {
  const res = await fetch(`${BASE_URL}/api/control-points`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('GET /api/control-points failed: ' + res.status);
  return res.json();
}

export async function api_control_points_create(name: string, x: number, y: number, recordingArea?: any, targetApp?: string, tags?: string[], tutorialIds?: string[]) {
  const res = await fetch(`${BASE_URL}/api/control-points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, x, y, recordingArea, targetApp, tags, tutorialIds })
  });
  if (!res.ok) throw new Error('POST /api/control-points failed: ' + res.status);
  return res.json();
}

export async function api_control_points_update(id: string, data: { name?: string; x?: number; y?: number; recordingArea?: any; targetApp?: string; tags?: string[]; tutorialIds?: string[] }) {
  const res = await fetch(`${BASE_URL}/api/control-points/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('PUT /api/control-points/{id} failed: ' + res.status);
  return res.json();
}

export async function api_control_points_delete(id: string) {
  const res = await fetch(`${BASE_URL}/api/control-points/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('DELETE /api/control-points failed: ' + res.status);
}

// Control Points Real (copia de puntos capturados desde el ratón físico)
export interface ControlPointReal {
  id: string;
  name: string;
  x: number;
  y: number;
  pointerX?: number;
  pointerY?: number;
  moveMouse?: boolean;
  clic?: boolean;
  recordingArea?: any;
  targetApp?: string;
  tags?: string[];
  tutorialIds?: string[];
  screenId?: string | null;
  landmark?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Atlas de pantallas
export interface Screen {
  id: string;
  name: string;
  targetApp?: string;
  tab?: string;
  matchHint?: string;
  layoutHint?: string;
  order?: number;
  createdAt?: string;
  updatedAt?: string;
}

// Transición entre pantallas (arista del grafo del atlas)
export interface ScreenTransition {
  id: string;
  fromScreenId: string | null;
  toScreenId: string | null;
  viaPointId?: string | null;
  triggerType?: string;
  estimatedDurationSec?: number;
  order?: number;
  createdAt?: string;
  updatedAt?: string;
}

export async function api_control_points_real_list() {
  const res = await fetch(`${BASE_URL}/api/control-points-real`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('GET /api/control-points-real failed: ' + res.status);
  return res.json();
}

export async function api_control_points_real_create(name: string, x: number, y: number, recordingArea?: any, targetApp?: string, tags?: string[], tutorialIds?: string[], clic?: boolean, pointerX?: number, pointerY?: number, moveMouse?: boolean, screenId?: string | null, landmark?: boolean) {
  const res = await fetch(`${BASE_URL}/api/control-points-real`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, x, y, recordingArea, targetApp, tags, tutorialIds, clic, pointerX, pointerY, moveMouse, screenId, landmark })
  });
  if (!res.ok) throw new Error('POST /api/control-points-real failed: ' + res.status);
  return res.json();
}

export async function api_control_points_real_update(id: string, data: { name?: string; x?: number; y?: number; pointerX?: number; pointerY?: number; moveMouse?: boolean; recordingArea?: any; targetApp?: string; tags?: string[]; tutorialIds?: string[]; clic?: boolean; screenId?: string | null; landmark?: boolean }) {
  const res = await fetch(`${BASE_URL}/api/control-points-real/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('PUT /api/control-points-real/{id} failed: ' + res.status);
  return res.json();
}

export async function api_control_points_real_delete(id: string) {
  const res = await fetch(`${BASE_URL}/api/control-points-real/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('DELETE /api/control-points-real failed: ' + res.status);
}

// ── Atlas: pantallas (screens) ──
export async function api_screens_list(): Promise<Screen[]> {
  const res = await fetch(`${BASE_URL}/api/screens`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('GET /api/screens failed: ' + res.status);
  return res.json();
}

export async function api_screens_create(name: string, targetApp?: string, tab?: string, matchHint?: string, layoutHint?: string, order?: number) {
  const res = await fetch(`${BASE_URL}/api/screens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, targetApp, tab, matchHint, layoutHint, order })
  });
  if (!res.ok) throw new Error('POST /api/screens failed: ' + res.status);
  return res.json();
}

export async function api_screens_update(id: string, data: { name?: string; targetApp?: string; tab?: string; matchHint?: string; layoutHint?: string; order?: number }) {
  const res = await fetch(`${BASE_URL}/api/screens/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('PUT /api/screens/{id} failed: ' + res.status);
  return res.json();
}

export async function api_screens_delete(id: string) {
  const res = await fetch(`${BASE_URL}/api/screens/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('DELETE /api/screens failed: ' + res.status);
}

// ── Atlas: transiciones entre pantallas (screen-transitions) ──
export async function api_screen_transitions_list(): Promise<ScreenTransition[]> {
  const res = await fetch(`${BASE_URL}/api/screen-transitions`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('GET /api/screen-transitions failed: ' + res.status);
  return res.json();
}

export async function api_screen_transitions_create(fromScreenId: string, toScreenId: string, viaPointId?: string | null, triggerType?: string, estimatedDurationSec?: number, order?: number) {
  const res = await fetch(`${BASE_URL}/api/screen-transitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromScreenId, toScreenId, viaPointId, triggerType, estimatedDurationSec, order })
  });
  if (!res.ok) throw new Error('POST /api/screen-transitions failed: ' + res.status);
  return res.json();
}

export async function api_screen_transitions_update(id: string, data: { fromScreenId?: string; toScreenId?: string; viaPointId?: string | null; triggerType?: string; estimatedDurationSec?: number; order?: number }) {
  const res = await fetch(`${BASE_URL}/api/screen-transitions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('PUT /api/screen-transitions/{id} failed: ' + res.status);
  return res.json();
}

export async function api_screen_transitions_delete(id: string) {
  const res = await fetch(`${BASE_URL}/api/screen-transitions/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('DELETE /api/screen-transitions failed: ' + res.status);
}

// TTS: vista previa de voz (devuelve un blob de audio WAV para reproducirlo en el modal)
export async function api_tts_preview(text: string, voice: string, language: string): Promise<Blob> {
  const res = await fetch(`${BASE_URL}/api/tts/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, language })
  });
  if (!res.ok) throw new Error('POST /api/tts/preview failed: ' + res.status);
  return res.blob();
}

// Point Zero (mouse calibration offsets)
export interface PointZeroOffsets {
  zeus_mouse_offset_x?: number;
  zeus_mouse_offset_y?: number;
  zeus_real_mouse_offset_x?: number;
  zeus_real_mouse_offset_y?: number;
  real_mouse_scale_x?: number;
  real_mouse_scale_y?: number;
  zeus_virtual_mouse_offset_x?: number;
  zeus_virtual_mouse_offset_y?: number;
}

export async function api_point_zero_get(): Promise<PointZeroOffsets & { id?: string }> {
  const res = await fetch(`${BASE_URL}/api/point-zero`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('GET /api/point-zero failed: ' + res.status);
  return res.json();
}

export async function api_point_zero_upsert(data: PointZeroOffsets, id?: string) {
  const url = id ? `${BASE_URL}/api/point-zero/${id}` : `${BASE_URL}/api/point-zero`;
  const res = await fetch(url, {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`${id ? 'PUT' : 'POST'} /api/point-zero failed: ` + res.status);
  return res.json();
}

// Control
export async function api_control_mouse(action: string, x: number, y: number) {
  const res = await fetch(`${BASE_URL}/api/control/mouse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, x, y })
  });
  if (!res.ok) throw new Error('POST /api/control/mouse failed: ' + res.status);
  return res.json();
}

export async function api_control_keyboard(key: string, modifiers: string[]) {
  const res = await fetch(`${BASE_URL}/api/control/keyboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, modifiers })
  });
  if (!res.ok) throw new Error('POST /api/control/keyboard failed: ' + res.status);
  return res.json();
}

export async function api_control_screenshot() {
  const res = await fetch(`${BASE_URL}/api/control/screenshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('POST /api/control/screenshot failed: ' + res.status);
  return res.json();
}

// Ajustes de video (brillo, contraste, intensidad, tiempo_inicio)
export interface VideoSettings {
  brillo?: number;
  contraste?: number;
  intensidad?: number;
  tiempo_inicio?: number;
}

export async function api_ajustes_get(): Promise<VideoSettings & { id?: string }> {
  const res = await fetch(`${BASE_URL}/api/ajustes`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('GET /api/ajustes failed: ' + res.status);
  return res.json();
}

export async function api_ajustes_upsert(data: VideoSettings, id?: string) {
  const url = id ? `${BASE_URL}/api/ajustes/${id}` : `${BASE_URL}/api/ajustes`;
  const res = await fetch(url, {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`${id ? 'PUT' : 'POST'} /api/ajustes failed: ` + res.status);
  return res.json();
}
