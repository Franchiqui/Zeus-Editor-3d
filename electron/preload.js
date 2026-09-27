const { contextBridge, ipcRenderer, webUtils } = require('electron');
let pptxgenjsCache = null;

// Exponer APIs del main process al renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // --- ZEUS 3D VIEWER APIs ---
  zeusProcessAction: (actionText) => ipcRenderer.invoke('zeus:process-action', actionText),
  zeusAction: (actionText) => {
    ipcRenderer.send('zeus:action', actionText);
    return new Promise((resolve) => {
      const listener = (_event, result) => resolve(result);
      ipcRenderer.on('zeus:action-result', listener);
      return () => ipcRenderer.removeListener('zeus:action-result', listener);
    });
  },
  
  // --- Filesystem APIs ---
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
  
  // --- Clipboard APIs ---
  clipboardWriteImage: (dataUrl) => ipcRenderer.invoke('clipboard:write-image', dataUrl),
  clipboardReadImage: () => ipcRenderer.invoke('clipboard:read-image'),
  clipboardWriteText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  
  // --- Video APIs ---
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
  
  // --- Screen APIs ---
  getDesktopSources: (types) => ipcRenderer.invoke('screen:getSources', types),
  saveCapture: (opts) => ipcRenderer.invoke('screen:saveCapture', opts),
  setCaptureOverlay: (opts) => ipcRenderer.send('capture:overlay', opts),
  
  // --- Audio APIs ---
  exportAudioToMp3: (inputPath, outputPath) => ipcRenderer.invoke('audio:export-mp3', inputPath, outputPath),
  checkDemucs: () => ipcRenderer.invoke('audio:check-demucs'),
  installDemucs: () => ipcRenderer.invoke('audio:install-demucs'),
  separateAudio: (opts) => ipcRenderer.invoke('audio:separate', opts),
  cancelSeparate: () => ipcRenderer.invoke('audio:cancel-separate'),
  onSeparateProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('audio:separate-progress', listener);
    return () => ipcRenderer.removeListener('audio:separate-progress', listener);
  },
  
  // --- Server Management APIs ---
  startComfyUI: () => ipcRenderer.invoke('server:start-comfyui'),
  stopComfyUI: () => ipcRenderer.invoke('server:stop-comfyui'),
  startFluxBridge: () => ipcRenderer.invoke('server:start-fluxbridge'),
  stopFluxBridge: () => ipcRenderer.invoke('server:stop-fluxbridge'),
  startTextureApi: () => ipcRenderer.invoke('server:start-textureapi'),
  stopTextureApi: () => ipcRenderer.invoke('server:stop-textureapi'),
  getServerStatus: () => ipcRenderer.invoke('server:status'),
  
  // --- Window & Zoom ---
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  toggleDevTools: () => ipcRenderer.send('window:toggle-devtools'),
  refreshFocus: () => ipcRenderer.send('window:refresh-focus'),
  navigateTo: (url) => ipcRenderer.send('navigate-to', url),
  zoomIn: () => ipcRenderer.send('zoom:in'),
  zoomOut: () => ipcRenderer.send('zoom:out'),
  zoomReset: () => ipcRenderer.send('zoom:reset'),
  zoomSet: (factor) => ipcRenderer.send('zoom:set', factor),
  zoomGet: () => ipcRenderer.invoke('zoom:get'),
  
  // --- PPTX ---
  getPptxGenJS: () => {
    if (!pptxgenjsCache) pptxgenjsCache = require('pptxgenjs');
    return pptxgenjsCache;
  },
});

console.log('✅ Preload API expuesta correctamente');
