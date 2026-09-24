declare global {
  interface Window {
    electronAPI?: {
      selectFolder: () => Promise<string | null>;
      fsListDirectory: (folderPath: string, category?: string) => Promise<{ files: any[]; error?: string }>;
      fsReadFile: (filePath: string, encoding?: string) => Promise<{ data?: string; error?: string }>;
      fsReadFileBuffer: (filePath: string) => Promise<{ data?: number[]; error?: string }>;
      fsWriteFile: (filePath: string, data: string | Uint8Array) => Promise<{ success: boolean; error?: string }>;
      fsDeleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
      fsCopyFile: (sourcePath: string, destPath: string) => Promise<{ success: boolean; error?: string }>;
      fsStat: (filePath: string) => Promise<{ size?: number; mtime?: Date; isDirectory?: boolean; isFile?: boolean; error?: string }>;
      fsEnsureDir: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
      fsGetLocalPaths: () => Promise<Record<string, string>>;
      fsSaveLocalPaths: (paths: Record<string, string>) => Promise<{ success: boolean; error?: string }>;
      fsReadProject: (projectPath: string) => Promise<{ data?: any; error?: string }>;
      fsSaveProject: (projectPath: string, data: any) => Promise<{ success: boolean; error?: string }>;
      getMediaUrl: (filePath: string) => string;
      getFilePath: (file: File) => string | null;
      getDesktopSources: (types?: string[]) => Promise<Array<{ id: string; name: string; display_id?: string; thumbnail?: string | null; appIcon?: string | null }>>;
       saveCapture: (opts: { base64: string; ext: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
       getTempDir: () => Promise<{ success: boolean; path?: string; error?: string }>;
      setCaptureOverlay: (opts: { dataUrl: string | null; description?: string }) => void;
      startComfyUI: () => Promise<{ success: boolean; message?: string; error?: string }>;
      startFluxBridge: () => Promise<{ success: boolean; message?: string; error?: string }>;
      stopComfyUI: () => Promise<{ success: boolean; message?: string }>;
      stopFluxBridge: () => Promise<{ success: boolean; message?: string }>;
      startTextureApi: () => Promise<{ success: boolean; message?: string; error?: string }>;
      stopTextureApi: () => Promise<{ success: boolean; message?: string }>;
      getServerStatus: () => Promise<{
        comfyui: { running: boolean; process: boolean };
        fluxBridge: { running: boolean; process: boolean };
        textureApi: { running: boolean; process: boolean };
      }>;
      transcodeVideo: (inputPath: string, outputPath: string) => Promise<{ success: boolean; outputPath?: string; error?: string }>;
      onTranscodeProgress: (callback: (data: { inputPath: string; percent: number }) => void) => () => void;
      exportAudioToMp3: (inputPath: string, outputPath: string) => Promise<{ success: boolean; outputPath?: string; error?: string }>;
      enhanceVideo: (opts: EnhanceVideoOpts) => Promise<{ success: boolean; outputPath?: string; error?: string }>;
      onEnhanceProgress: (callback: (data: { inputPath: string; percent: number }) => void) => () => void;
      htmlToMp4: (opts: HtmlToMp4Opts) => Promise<{ success: boolean; outputPath?: string; error?: string }>;
      onHtmlToMp4Progress: (callback: (data: { jobId: string; percent: number }) => void) => () => void;
      // Demucs / separación de stems
      checkDemucs: () => Promise<{ available: boolean; reason?: string; python?: string | null; message?: string }>;
      installDemucs: () => Promise<{ success: boolean; error?: string }>;
      separateAudio: (opts: SeparateStemsOpts) => Promise<SeparateStemsResult>;
      cancelSeparate: () => Promise<{ success: boolean }>;
      onSeparateProgress: (callback: (data: { jobId: string; percent: number; status?: string }) => void) => () => void;
      windowMinimize: () => void;
      windowMaximize: () => void;
      windowClose: () => void;
    };
  }
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI;
}

export async function selectFolder(): Promise<string | null> {
  if (!isElectron()) return null;
  return window.electronAPI!.selectFolder();
}

export async function listDirectory(folderPath: string, category?: string): Promise<any[]> {
  if (isElectron()) {
    const res = await window.electronAPI!.fsListDirectory(folderPath, category);
    return res.files || [];
  }
  // Fallback web: intentar usar el puente local
  try {
    const res = await fetch(`http://localhost:4001/api/local/list?folder=${encodeURIComponent(folderPath)}&category=${category || ''}`);
    if (res.ok) {
      const data = await res.json();
      return data.files || [];
    }
  } catch (e) {}
  return [];
}

export async function readFile(filePath: string, encoding = 'utf-8'): Promise<string | null> {
  if (isElectron()) {
    const res = await window.electronAPI!.fsReadFile(filePath, encoding);
    return res.data ?? null;
  }
  return null;
}

export async function readFileBuffer(filePath: string): Promise<Uint8Array | null> {
  if (isElectron()) {
    const res = await window.electronAPI!.fsReadFileBuffer(filePath);
    if (res.data) return new Uint8Array(res.data);
  }
  return null;
}

export async function writeFile(filePath: string, data: string | Uint8Array): Promise<boolean> {
  if (isElectron()) {
    const res = await window.electronAPI!.fsWriteFile(filePath, data);
    return res.success;
  }
  return false;
}

export async function deleteFile(filePath: string): Promise<boolean> {
  if (isElectron()) {
    const res = await window.electronAPI!.fsDeleteFile(filePath);
    return res.success;
  }
  // Fallback web
  try {
    const res = await fetch('http://localhost:4001/api/local/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

export async function copyFile(sourcePath: string, destPath: string): Promise<boolean> {
  if (isElectron()) {
    const res = await window.electronAPI!.fsCopyFile(sourcePath, destPath);
    return res.success;
  }
  return false;
}

export async function stat(filePath: string) {
  if (isElectron()) {
    return window.electronAPI!.fsStat(filePath);
  }
  return { error: 'Not available' };
}

export async function ensureDir(dirPath: string): Promise<boolean> {
  if (isElectron()) {
    const res = await window.electronAPI!.fsEnsureDir(dirPath);
    return res.success;
  }
  return false;
}

export async function getLocalPaths(): Promise<Record<string, string>> {
  if (isElectron()) {
    return window.electronAPI!.fsGetLocalPaths();
  }
  // Fallback web: leer desde localStorage si existe
  try {
    const raw = localStorage.getItem('zeus_local_paths');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {};
}

export async function getTempDir(): Promise<string | null> {
  if (isElectron()) {
    const res = await window.electronAPI!.getTempDir();
    return res.path || null;
  }
  return null;
}

export async function saveLocalPaths(paths: Record<string, string>): Promise<void> {
  if (isElectron()) {
    await window.electronAPI!.fsSaveLocalPaths(paths);
    // Also save to JSON file for server-side API access
    try {
      await window.electronAPI!.fsWriteFile('local-paths.json', JSON.stringify(paths, null, 2));
    } catch (e) {
      console.warn('Could not save local-paths.json:', e);
    }
  } else {
    localStorage.setItem('zeus_local_paths', JSON.stringify(paths));
    // Also save via API route for server access
    try {
      await fetch('/api/local-paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paths),
      });
    } catch (e) {
      console.warn('Could not save local paths via API:', e);
    }
  }
}

export async function readProject(projectPath: string): Promise<any | null> {
  if (isElectron()) {
    const res = await window.electronAPI!.fsReadProject(projectPath);
    return res.data ?? null;
  }
  return null;
}

export async function saveProject(projectPath: string, data: any): Promise<boolean> {
  if (isElectron()) {
    const res = await window.electronAPI!.fsSaveProject(projectPath, data);
    return res.success;
  }
  return false;
}

export function getFilePath(file: File): string | null {
  if (isElectron()) {
    return window.electronAPI!.getFilePath(file);
  }
  return null;
}

export async function transcodeVideo(
  inputPath: string,
  outputPath: string,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  if (isElectron()) {
    // Suscribirse al progreso de ffmpeg si el renderer lo solicita
    let removeListener: (() => void) | null = null;
    if (onProgress && window.electronAPI?.onTranscodeProgress) {
      try {
        removeListener = window.electronAPI.onTranscodeProgress((data: { inputPath?: string; percent?: number }) => {
          if (data && data.inputPath === inputPath && typeof data.percent === 'number') {
            onProgress(data.percent);
          }
        });
      } catch {}
    }
    try {
      return await window.electronAPI!.transcodeVideo(inputPath, outputPath);
    } finally {
      if (removeListener) try { removeListener(); } catch {}
    }
  }
  return { success: false, error: 'Solo disponible en Electron' };
}

export interface EnhanceVideoOpts {
  inputPath: string;
  outputPath: string;
  scale: 'no' | '1.5x' | '2x' | '1080p' | '4k';
  sharpen: number;   // 0..2
  denoise: number;   // 0..3
  fps: 'no' | '30' | '60';
  motionMci: boolean;
}

export async function enhanceVideo(
  opts: EnhanceVideoOpts,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  if (isElectron()) {
    let removeListener: (() => void) | null = null;
    if (onProgress && window.electronAPI?.onEnhanceProgress) {
      try {
        removeListener = window.electronAPI.onEnhanceProgress((data: { inputPath?: string; percent?: number }) => {
          if (data && data.inputPath === opts.inputPath && typeof data.percent === 'number') {
            onProgress(data.percent);
          }
        });
      } catch {}
    }
    try {
      return await window.electronAPI!.enhanceVideo(opts);
    } finally {
      if (removeListener) try { removeListener(); } catch {}
    }
  }
  return { success: false, error: 'Solo disponible en Electron' };
}

// Captura de pantalla: enumerar pantallas/ventanas disponibles (desktopCapturer).
export async function getDesktopSources(types?: string[]): Promise<Array<{ id: string; name: string; display_id?: string; thumbnail?: string | null; appIcon?: string | null }>> {
  if (isElectron() && window.electronAPI?.getDesktopSources) {
    try { return await window.electronAPI.getDesktopSources(types); } catch { return []; }
  }
  return [];
}

// Persistir una captura (foto o grabación) al disco y devolver la ruta media:// del fichero.
export async function saveCapture(opts: { base64: string; ext: string }): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (isElectron() && window.electronAPI?.saveCapture) {
    return window.electronAPI.saveCapture(opts);
  }
  return { success: false, error: 'Solo disponible en Electron' };
}

// Overlay icon de la barra de tareas (Windows): marca el icono de la app según el estado
// de captura (dataUrl = PNG pequeño, o null para limpiar).
export function setCaptureOverlay(opts: { dataUrl: string | null; description?: string }): void {
  if (isElectron() && window.electronAPI?.setCaptureOverlay) {
    try { window.electronAPI.setCaptureOverlay(opts); } catch {}
  }
}

export interface HtmlToMp4Opts {
  zipPath?: string | null;
  htmlPath?: string | null;
  /** URL web a cargar en la ventana oculta y capturar a MP4 (alternativa a zipPath/htmlPath). */
  url?: string | null;
  duration: number;
  speed: number;
  fps: number;
  width: number;
  height: number;
  outputPath: string;
  jobId: string;
}

export async function htmlToMp4(
  opts: HtmlToMp4Opts,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  if (isElectron()) {
    let removeListener: (() => void) | null = null;
    if (onProgress && window.electronAPI?.onHtmlToMp4Progress) {
      try {
        removeListener = window.electronAPI.onHtmlToMp4Progress((data: { jobId?: string; percent?: number }) => {
          if (data && data.jobId === opts.jobId && typeof data.percent === 'number') {
            onProgress(data.percent);
          }
        });
      } catch {}
    }
    try {
      return await window.electronAPI!.htmlToMp4(opts);
    } finally {
      if (removeListener) try { removeListener(); } catch {}
    }
  }
  return { success: false, error: 'Solo disponible en Electron' };
}

// Demucs / separación de stems de audio
export type DemucsModel = 'htdemucs' | 'htdemucs_6s';

export interface SeparateStemsOpts {
  inputPath: string;
  model?: DemucsModel;
  jobId?: string;
}

export interface DemucsStem {
  name: string;
  path: string;
}

export interface SeparateStemsResult {
  success: boolean;
  stems?: DemucsStem[];
  outputDir?: string;
  model?: DemucsModel;
  error?: string;
  stderr?: string;
  stdout?: string;
}

export async function exportAudioToMp3(inputPath: string, outputPath: string): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  if (isElectron()) {
    return window.electronAPI!.exportAudioToMp3(inputPath, outputPath);
  }
  return { success: false, error: 'Solo disponible en Electron' };
}

export async function checkDemucs(): Promise<{ available: boolean; reason?: string; python?: string | null; message?: string }> {
  if (isElectron()) {
    return window.electronAPI!.checkDemucs();
  }
  return { available: false, message: 'Solo disponible en Electron' };
}

export async function installDemucs(): Promise<{ success: boolean; error?: string }> {
  if (isElectron()) {
    return window.electronAPI!.installDemucs();
  }
  return { success: false, error: 'Solo disponible en Electron' };
}

export async function separateAudio(
  opts: SeparateStemsOpts,
  onProgress?: (percent: number, status?: string) => void
): Promise<SeparateStemsResult> {
  if (isElectron()) {
    const jobId = opts.jobId || 'demucs-' + Date.now();
    let removeListener: (() => void) | null = null;
    if (onProgress && window.electronAPI?.onSeparateProgress) {
      try {
        removeListener = window.electronAPI.onSeparateProgress((data: { jobId?: string; percent?: number; status?: string }) => {
          if (data && data.jobId === jobId && typeof data.percent === 'number') {
            onProgress(data.percent, data.status);
          }
        });
      } catch {}
    }
    try {
      return await window.electronAPI!.separateAudio({ ...opts, jobId });
    } finally {
      if (removeListener) try { removeListener(); } catch {}
    }
  }
  return { success: false, error: 'Solo disponible en Electron' };
}

export async function cancelSeparate(): Promise<{ success: boolean }> {
  if (isElectron()) {
    return window.electronAPI!.cancelSeparate();
  }
  return { success: false };
}

// Server management helpers
export async function startComfyUI(): Promise<{ success: boolean; message?: string; error?: string }> {
  if (isElectron()) {
    return window.electronAPI!.startComfyUI();
  }
  return { success: false, error: 'Solo disponible en Electron' };
}

export async function startFluxBridge(): Promise<{ success: boolean; message?: string; error?: string }> {
  if (isElectron()) {
    return window.electronAPI!.startFluxBridge();
  }
  return { success: false, error: 'Solo disponible en Electron' };
}

export async function stopComfyUI(): Promise<{ success: boolean; message?: string }> {
  if (isElectron()) {
    return window.electronAPI!.stopComfyUI();
  }
  return { success: false, message: 'Solo disponible en Electron' };
}

export async function stopFluxBridge(): Promise<{ success: boolean; message?: string }> {
  if (isElectron()) {
    return window.electronAPI!.stopFluxBridge();
  }
  return { success: false, message: 'Solo disponible en Electron' };
}

export async function startTextureApi(): Promise<{ success: boolean; message?: string; error?: string }> {
  if (isElectron() && window.electronAPI?.startTextureApi) {
    return window.electronAPI.startTextureApi();
  }
  return { success: false, error: 'Solo disponible en Electron' };
}

export async function stopTextureApi(): Promise<{ success: boolean; message?: string }> {
  if (isElectron() && window.electronAPI?.stopTextureApi) {
    return window.electronAPI.stopTextureApi();
  }
  return { success: false, message: 'Solo disponible en Electron' };
}

export async function getServerStatus(): Promise<{
  comfyui: { running: boolean; process: boolean };
  fluxBridge: { running: boolean; process: boolean };
  textureApi: { running: boolean; process: boolean };
}> {
  if (isElectron() && window.electronAPI?.getServerStatus) {
    return window.electronAPI.getServerStatus();
  }
  return {
    comfyui: { running: false, process: false },
    fluxBridge: { running: false, process: false },
    textureApi: { running: false, process: false },
  };
}

export function getMediaUrl(filePath: string): string {
  if (isElectron()) {
    return window.electronAPI!.getMediaUrl(filePath);
  }
  return `http://localhost:4001/api/local/view?f=${encodeURIComponent(filePath)}`;
}
