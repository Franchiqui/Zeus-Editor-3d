const { contextBridge, ipcRenderer, webUtils } = require('electron');
let pptxgenjsCache = null;

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: process.versions,
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  toggleDevTools: () => ipcRenderer.send('window:toggle-devtools'),
  refreshFocus: () => ipcRenderer.send('window:refresh-focus'),
  /** Navegar a una URL en la misma ventana (evita destello de la página anterior) */
  navigateTo: (url) => ipcRenderer.send('navigate-to', url),
  // Zoom controls
  zoomIn: () => ipcRenderer.send('zoom:in'),
  zoomOut: () => ipcRenderer.send('zoom:out'),
  zoomReset: () => ipcRenderer.send('zoom:reset'),
  zoomSet: (factor) => ipcRenderer.send('zoom:set', factor),
  zoomGet: () => ipcRenderer.invoke('zoom:get'),

  // Filesystem APIs
  selectFolder: () => ipcRenderer.invoke('fs:selectFolder'),
  fsListDirectory: (folderPath, category) => ipcRenderer.invoke('fs:listDirectory', folderPath, category),
  fsReadFile: (filePath, encoding) => ipcRenderer.invoke('fs:readFile', filePath, encoding),
  fsReadFileBuffer: (filePath) => ipcRenderer.invoke('fs:readFileBuffer', filePath),
  fsWriteFile: (filePath, data) => ipcRenderer.invoke('fs:writeFile', filePath, data),
  fsDeleteFile: (filePath) => ipcRenderer.invoke('fs:deleteFile', filePath),
  fsCopyFile: (sourcePath, destPath) => ipcRenderer.invoke('fs:copyFile', sourcePath, destPath),
  fsStat: (filePath) => ipcRenderer.invoke('fs:stat', filePath),
  fsEnsureDir: (dirPath) => ipcRenderer.invoke('fs:ensureDir', dirPath),
  fsGetLocalPaths: () => ipcRenderer.invoke('fs:getLocalPaths'),
  fsSaveLocalPaths: (paths) => ipcRenderer.invoke('fs:saveLocalPaths', paths),
  fsReadProject: (projectPath) => ipcRenderer.invoke('fs:readProject', projectPath),
  fsSaveProject: (projectPath, data) => ipcRenderer.invoke('fs:saveProject', projectPath, data),
  getMediaUrl: (filePath) => 'media://file?path=' + encodeURIComponent(filePath),
  // Portapapeles (vía main; navigator.clipboard falla con NotAllowedError en Electron)
  clipboardWriteImage: (dataUrl) => ipcRenderer.invoke('clipboard:write-image', dataUrl),
  clipboardReadImage: () => ipcRenderer.invoke('clipboard:read-image'),
  clipboardWriteText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  transcodeVideo: (inputPath, outputPath) => ipcRenderer.invoke('video:transcode', inputPath, outputPath),
  onTranscodeProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('video:transcode-progress', listener);
    return () => ipcRenderer.removeListener('video:transcode-progress', listener);
  },
  enhanceVideo: (opts) => ipcRenderer.invoke('video:enhance', opts),
  onEnhanceProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('video:enhance-progress', listener);
    return () => ipcRenderer.removeListener('video:enhance-progress', listener);
  },
  htmlToMp4: (opts) => ipcRenderer.invoke('video:html-to-mp4', opts),
  onHtmlToMp4Progress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('video:html-to-mp4-progress', listener);
    return () => ipcRenderer.removeListener('video:html-to-mp4-progress', listener);
  },
  // Captura de pantalla (desktopCapturer)
  getDesktopSources: (types) => ipcRenderer.invoke('screen:getSources', types),
  saveCapture: (opts) => ipcRenderer.invoke('screen:saveCapture', opts),
  // Overlay icon de la barra de tareas (estado de captura)
  setCaptureOverlay: (opts) => ipcRenderer.send('capture:overlay', opts),
  // Audio export
  exportAudioToMp3: (inputPath, outputPath) => ipcRenderer.invoke('audio:export-mp3', inputPath, outputPath),
  // Demucs / separación de stems de audio
  checkDemucs: () => ipcRenderer.invoke('audio:check-demucs'),
  installDemucs: () => ipcRenderer.invoke('audio:install-demucs'),
  separateAudio: (opts) => ipcRenderer.invoke('audio:separate', opts),
  cancelSeparate: () => ipcRenderer.invoke('audio:cancel-separate'),
  onSeparateProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('audio:separate-progress', listener);
    return () => ipcRenderer.removeListener('audio:separate-progress', listener);
  },
  getFilePath: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (e) {
      return (file && file.path) || null;
    }
  },
  // pptxgenjs (no funciona import() dinámico en app empaquetada por node:fs)
  getPptxGenJS: () => {
    if (!pptxgenjsCache) pptxgenjsCache = require('pptxgenjs');
    return pptxgenjsCache;
  },
  // Server management APIs
  startComfyUI: () => ipcRenderer.invoke('server:start-comfyui'),
  startFluxBridge: () => ipcRenderer.invoke('server:start-fluxbridge'),
  stopComfyUI: () => ipcRenderer.invoke('server:stop-comfyui'),
  stopFluxBridge: () => ipcRenderer.invoke('server:stop-fluxbridge'),
  startTextureApi: () => ipcRenderer.invoke('server:start-textureapi'),
  stopTextureApi: () => ipcRenderer.invoke('server:stop-textureapi'),
  getServerStatus: () => ipcRenderer.invoke('server:status'),
});
