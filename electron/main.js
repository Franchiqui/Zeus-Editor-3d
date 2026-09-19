const { app, BrowserWindow, dialog, Menu, ipcMain, session, protocol, clipboard, nativeImage, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const JSZip = require('jszip');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

let mainWindow = null;
let mainServerProcess = null;
let pbProcess = null;
let pbDatosProcess = null;
let comfyuiProcess = null;
let fluxBridgeProcess = null;
let demucsProcess = null;
let zeusApiProcess = null;
let zeusServeProcess = null;
let textureApiProcess = null;

// CONFIGURACIÓN DE ZOOM POR EDITOR
// Ajusta estos valores para controlar el tamaño de la interfaz según el editor abierto.
// 1.0 = tamaño normal | 0.8 = más pequeño | 1.2 = más grande
const ZOOM_BY_EDITOR = {
  default: 0.6,        // Zoom base al arrancar
  '/edit-imagen': 0.6, // Editor de imagen
  '/edit-video': 0.6,  // Editor de video
  '/edit-audio': 0.5,  // Editor de audio
  '/edit-texto': 0.6,  // Editor de texto/documentos
  '/edit-gif': 0.6,    // Editor de GIF
};

function getZoomForUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    for (const [pathPrefix, zoom] of Object.entries(ZOOM_BY_EDITOR)) {
      if (pathPrefix !== 'default' && pathname.startsWith(pathPrefix)) {
        return zoom;
      }
    }
  } catch {}
  return ZOOM_BY_EDITOR.default;
}

let currentZoom = ZOOM_BY_EDITOR.default;

function applyZoom(factor) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  currentZoom = Math.max(0.5, Math.min(3.0, factor));
  mainWindow.webContents.setZoomFactor(currentZoom);
}

function adjustZoom(delta) {
  applyZoom(currentZoom + delta);
}

function resetZoom() {
  applyZoom(1.0);
}

// Registrar el protocolo media:// como seguro y estándar para que fetch, <audio>, <video> e <img> funcionen
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { secure: true, standard: true, bypassCSP: true, supportFetchAPI: true, corsEnabled: true } }
]);

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const devPort = process.env.ELECTRON_DEV_PORT || '3003';
const prodPort = '3003';
const pbDatosPort = '3006';
const pocketBasePort = '8236';

// Configurar entorno base
if (!process.env.PATH) {
  process.env.PATH = process.platform === 'win32'
    ? 'C:\\Windows\\system32;C:\\Windows;C:\\Windows\\System32\\Wbem;'
    : '/usr/local/bin:/usr/bin:/bin';
}

function waitForServer(port, name, maxAttempts = 90) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        res.on('data', () => {});
        resolve();
      });
      req.on('error', () => {
        if (attempts >= maxAttempts) {
          reject(new Error(`El servidor ${name} (puerto ${port}) no responde tras ${maxAttempts}s`));
        } else {
          setTimeout(check, 1000);
        }
      });
      req.setTimeout(2000, () => { req.destroy(); });
    };
    check();
  });
}

// --- Personalización de ventana ---
// Color de fondo de la ventana (hex). Ejemplos: '#0f172a', '#1e293b', '#0c0c0c', '#18181b'
const WINDOW_BACKGROUND_COLOR = '#0f172a';
// Menú: 'none' = sin barra de menú | 'minimal' = solo Archivo (Salir) y Ayuda (Acerca de)
const MENU_MODE = 'none';

const EXTENSIONS = {
  video: ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.zeus'],
  imagen: ['.jpg', '.jpeg', '.png', '.webp', '.svg'],
  audio: ['.mp3', '.wav', '.ogg', '.aac', '.flac'],
  gif: ['.gif'],
  documentos: ['.txt', '.pdf', '.doc', '.docx', '.md', '.zeus'],
  efectos: ['.png', '.jpg', '.jpeg', '.gif', '.mp4', '.webm', '.mov', '.avi'],
  objetos: ['.png', '.jpg', '.jpeg', '.gif', '.mp4', '.webm', '.mov', '.avi', '.obj', '.fbx', '.glb', '.gltf'],
};

function getLocalPathsFile() {
  return path.join(app.getPath('userData'), 'local-paths.json');
}

ipcMain.handle('fs:selectFolder', async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('fs:listDirectory', async (_, folderPath, category) => {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) return { files: [], error: 'Ruta no existe' };
    const items = fs.readdirSync(folderPath);
    const allowedExts = category && EXTENSIONS[category] ? EXTENSIONS[category] : [];
    const files = [];
    for (const name of items) {
      const fullPath = path.join(folderPath, name);
      const stats = fs.statSync(fullPath);
      if (category === 'proyectos') {
        if (stats.isDirectory()) {
          files.push({
            id: `local-project-${Buffer.from(fullPath).toString('base64')}`,
            name,
            path: fullPath,
            isDirectory: true,
            size: 0,
            uploadedAt: stats.mtime,
          });
        } else if (path.extname(name).toLowerCase() === '.zeus') {
          files.push({
            id: `local-project-${Buffer.from(fullPath).toString('base64')}`,
            name,
            path: fullPath,
            isDirectory: false,
            size: stats.size,
            uploadedAt: stats.mtime,
          });
        }
      } else {
        const ext = path.extname(name).toLowerCase();
        if (allowedExts.length === 0 || allowedExts.includes(ext)) {
          files.push({
            id: `local-${Buffer.from(fullPath).toString('base64')}`,
            name,
            path: fullPath,
            size: stats.size,
            isDirectory: stats.isDirectory(),
            uploadedAt: stats.mtime,
          });
        }
      }
    }
    return { files };
  } catch (e) {
    return { files: [], error: e.message };
  }
});

ipcMain.handle('fs:getMediaUrl', async (_, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return { error: 'Archivo no existe' };
    return `media://${filePath}`;
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('fs:readFile', async (_, filePath, encoding = 'utf-8') => {
  try {
    if (!fs.existsSync(filePath)) return { error: 'Archivo no existe' };
    const data = fs.readFileSync(filePath, encoding);
    return { data };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('fs:readFileBuffer', async (_, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return { error: 'Archivo no existe' };
    const buffer = fs.readFileSync(filePath);
    return { data: Array.from(new Uint8Array(buffer)) };
  } catch (e) {
    return { error: e.message };
  }
});

// ---- Portapapeles (sin permisos: usa electron.clipboard / nativeImage) ----
// Escribe texto plano al portapapeles del sistema.
ipcMain.handle('clipboard:write-text', async (_, text) => {
  try {
    clipboard.writeText(String(text ?? ''));
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

// Escribe una imagen (dataURL) al portapapeles del sistema.
ipcMain.handle('clipboard:write-image', async (_, dataUrl) => {
  try {
    if (!dataUrl || typeof dataUrl !== 'string') return { error: 'Sin datos' };
    const img = nativeImage.createFromDataURL(dataUrl);
    if (img.isEmpty()) return { error: 'Imagen vacía' };
    clipboard.writeImage(img);
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

// Lee una imagen del portapapeles del sistema -> { dataUrl } | { empty: true }
ipcMain.handle('clipboard:read-image', async () => {
  try {
    const img = clipboard.readImage();
    if (img.isEmpty()) return { empty: true };
    return { dataUrl: img.toDataURL() };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('fs:writeFile', async (_, filePath, data) => {
  try {
    fs.writeFileSync(filePath, data);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:deleteFile', async (_, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'No existe' };
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      fs.rmSync(filePath, { recursive: true });
    } else {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:copyFile', async (_, sourcePath, destPath) => {
  try {
    fs.copyFileSync(sourcePath, destPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:stat', async (_, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return { error: 'No existe' };
    const stats = fs.statSync(filePath);
    return {
      size: stats.size,
      mtime: stats.mtime,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
    };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('fs:ensureDir', async (_, dirPath) => {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:getLocalPaths', async () => {
  try {
    const file = getLocalPathsFile();
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
});

ipcMain.handle('fs:saveLocalPaths', async (_, paths) => {
  try {
    fs.writeFileSync(getLocalPathsFile(), JSON.stringify(paths, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('app:get-temp-dir', async () => {
  try {
    return { success: true, path: app.getPath('temp') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Captura de pantalla: enumerar fuentes (pantallas enteras y ventanas) con desktopCapturer.
// Devuelve [{id, name, display_id, thumbnail}] para que el renderer muestre un selector.
ipcMain.handle('screen:getSources', async (_event, types) => {
  try {
    const sourceTypes = Array.isArray(types) && types.length ? types : ['screen', 'window'];
    const sources = await desktopCapturer.getSources({
      types: sourceTypes,
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      display_id: s.display_id,
      thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null,
      appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
    }));
  } catch (e) {
    return [];
  }
});

// Persistir una captura (foto o grabación de vídeo) al disco: escribe el buffer base64
// en la carpeta de vídeo del usuario (local-paths.json → paths.video) y devuelve la ruta.
// Las blob: no sobreviven al guardar .zeus; con la ruta media:// el clip persiste.
ipcMain.handle('screen:saveCapture', async (_event, opts) => {
  try {
    const base64 = opts && opts.base64;
    const ext = (opts && opts.ext) || 'webm';
    if (!base64) return { success: false, error: 'Falta el contenido (base64).' };

    const file = getLocalPathsFile();
    let paths = {};
    if (fs.existsSync(file)) {
      try { paths = JSON.parse(fs.readFileSync(file, 'utf-8')) || {}; } catch {}
    }
    const folder = paths.video || paths.proyectos_video;
    if (!folder) return { success: false, error: 'No hay carpeta de vídeo configurada.' };

    fs.mkdirSync(folder, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `zeus_captura_${stamp}.${ext}`;
    const filePath = path.join(folder, fileName);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return { success: true, filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Overlay icon de la barra de tareas (Windows): marca el icono de la app con un
// círculo rojo (grabando) o símbolo de pausa (pausado). dataUrl = PNG pequeño o null (limpiar).
ipcMain.on('capture:overlay', (_event, opts) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const dataUrl = opts && opts.dataUrl;
      const desc = (opts && opts.description) || '';
      if (dataUrl) {
        mainWindow.setOverlayIcon(nativeImage.createFromDataURL(dataUrl), desc);
      } else {
        mainWindow.setOverlayIcon(null, '');
      }
    }
  } catch {}
});

ipcMain.handle('fs:readProject', async (_, projectPath) => {
  try {
    if (!fs.existsSync(projectPath)) return { error: 'No existe' };
    const raw = fs.readFileSync(projectPath, 'utf-8');
    return { data: JSON.parse(raw) };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('fs:saveProject', async (_, projectPath, data) => {
  try {
    fs.writeFileSync(projectPath, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Exportar/convertir audio WAV -> MP3 usando ffmpeg (guardado local)
ipcMain.handle('audio:export-mp3', async (_, inputPath, outputPath) => {
  if (!fs.existsSync(inputPath)) {
    return { success: false, error: 'Archivo de entrada no encontrado' };
  }
  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .outputOptions(['-c:a libmp3lame', '-q:a 2', '-map_metadata -1'])
      .output(outputPath)
      .on('end', () => resolve({ success: true, outputPath }))
      .on('error', (err) => resolve({ success: false, error: err.message }))
      .run();
  });
});

// Transcodificar vídeo WebM -> MP4 usando ffmpeg
ipcMain.handle('video:transcode', async (_, inputPath, outputPath) => {
  if (!fs.existsSync(inputPath)) {
    return { success: false, error: 'Archivo de entrada no encontrado' };
  }

  const sendProgress = (percent) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('video:transcode-progress', { inputPath, percent });
      }
    } catch {}
  };

  // Sondear la duración real del entrada para calcular un porcentaje fiable
  // incluso cuando fluent-ffmpeg no lo proporciona (WebM sin metadata clara).
  let inputDuration = 0;
  try {
    inputDuration = await new Promise((res) => {
      ffmpeg.ffprobe(inputPath, (err, meta) => {
        if (err || !meta || !meta.format || !meta.format.duration) return res(0);
        res(parseFloat(meta.format.duration) || 0);
      });
    });
  } catch {}

  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .outputOptions([
        // Forzar dimensiones pares: libx264 con yuv420p no admite ancho/alto impar
        // y produce un MP4 vacío (p.ej. al transcodificar un WebM recortado a mano
        // cuya zona dejó una dimensión impar).
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v libx264',
        '-preset fast',
        '-crf 23',
        '-movflags +faststart',
        '-c:a aac',
        '-b:a 192k',
        '-pix_fmt yuv420p'
      ])
      .output(outputPath)
      .on('progress', (progress) => {
        let percent = (typeof progress.percent === 'number' && progress.percent >= 0) ? progress.percent : null;
        if (percent === null && progress.timemark && inputDuration > 0) {
          const parts = String(progress.timemark).split(':').map(Number);
          const seconds = (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
          percent = (seconds / inputDuration) * 100;
        }
        if (percent === null) { sendProgress(-1); return; } // en curso, sin porcentaje
        sendProgress(Math.max(0, Math.min(100, percent)));
      })
      .on('end', () => { sendProgress(100); resolve({ success: true, outputPath }); })
      .on('error', (err) => resolve({ success: false, error: err.message }))
      .run();
  });
});

// Mejorar calidad de un vídeo (reescalar + afilar + denoise + interpolar frames) con ffmpeg.
// opts = { inputPath, outputPath, scale, sharpen, denoise, fps, motionMci }
//   scale: 'no' | '1.5x' | '2x' | '1080p' | '4k'
//   sharpen: number 0..2 (0 = off)
//   denoise: number 0..3 (0 = off)
//   fps: 'no' | '30' | '60'
//   motionMci: boolean (true = interpolación por movimiento, lento; false = blend)
ipcMain.handle('video:enhance', async (_, opts) => {
  const inputPath = opts && opts.inputPath;
  const outputPath = opts && opts.outputPath;
  if (!inputPath || !fs.existsSync(inputPath)) {
    return { success: false, error: 'Archivo de entrada no encontrado (sólo vídeos locales).' };
  }
  if (!outputPath) {
    return { success: false, error: 'Falta la ruta de salida.' };
  }

  const sendProgress = (percent) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('video:enhance-progress', { inputPath, percent });
      }
    } catch {}
  };

  // Construir la cadena de filtros: denoise -> scale -> sharpen -> fps/interpolate
  const filters = [];
  const denoise = Number(opts.denoise) || 0;
  if (denoise > 0) {
    const s = (denoise * 1.5).toFixed(2);
    const t = (denoise * 4).toFixed(2);
    filters.push(`hqdn3d=${s}:${s}:${t}:${t}`);
  }
  const scale = String(opts.scale || 'no');
  if (scale === '1.5x') filters.push('scale=ceil(iw*3/2/2)*2:ceil(ih*3/2/2)*2:flags=lanczos');
  else if (scale === '2x') filters.push('scale=ceil(iw*2/2)*2:ceil(ih*2/2)*2:flags=lanczos');
  else if (scale === '1080p') filters.push('scale=-2:1080:flags=lanczos');
  else if (scale === '4k') filters.push('scale=-2:2160:flags=lanczos');
  const sharpen = Number(opts.sharpen) || 0;
  if (sharpen > 0) {
    filters.push(`unsharp=5:5:${sharpen.toFixed(2)}:5:5:0.0`);
  }
  const fps = String(opts.fps || 'no');
  if (fps === '30' || fps === '60') {
    const mci = !!opts.motionMci;
    if (mci) filters.push(`minterpolate=fps=${fps}:mi_mode=mci:me_mode=bidir:me=ds`);
    else filters.push(`minterpolate=fps=${fps}:mi_mode=blend`);
  }

  if (filters.length === 0) {
    return { success: false, error: 'No has elegido ninguna mejora (escalado, nitidez, ruido o FPS).' };
  }

  let inputDuration = 0;
  try {
    inputDuration = await new Promise((res) => {
      ffmpeg.ffprobe(inputPath, (err, meta) => {
        if (err || !meta || !meta.format || !meta.format.duration) return res(0);
        res(parseFloat(meta.format.duration) || 0);
      });
    });
  } catch {}

  const outputOptions = ['-vf', filters.join(','), '-c:v libx264', '-preset fast', '-crf 18', '-pix_fmt yuv420p', '-movflags +faststart', '-c:a aac', '-b:a 192k'];

  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('progress', (progress) => {
        let percent = (typeof progress.percent === 'number' && progress.percent >= 0) ? progress.percent : null;
        if (percent === null && progress.timemark && inputDuration > 0) {
          const parts = String(progress.timemark).split(':').map(Number);
          const seconds = (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
          percent = (seconds / inputDuration) * 100;
        }
        if (percent === null) { sendProgress(-1); return; }
        sendProgress(Math.max(0, Math.min(100, percent)));
      })
      .on('end', () => { sendProgress(100); resolve({ success: true, outputPath }); })
      .on('error', (err) => resolve({ success: false, error: err.message }))
      .run();
  });
});

// Convertir HTML animado (ZIP de proyecto o .html suelto) a MP4.
// Renderiza el HTML en una ventana oculta de Electron, captura frames en tiempo real
// alineados a reloj y los une con ffmpeg (setpts=1/speed). opts = {
//   zipPath?, htmlPath?, duration, speed, fps, width, height, outputPath, jobId }
function findIndexHtml(dir) {
  const found = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith('.html')) found.push(full);
    }
  };
  walk(dir);
  if (found.length === 0) return null;
  return found.find((p) => path.basename(p, '.html').toLowerCase() === 'index') || found[0];
}

ipcMain.handle('video:html-to-mp4', async (_, opts) => {
  const jobId = (opts && opts.jobId) ? String(opts.jobId) : ('html-' + Date.now());
  const sendProgress = (percent) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('video:html-to-mp4-progress', { jobId, percent });
      }
    } catch {}
  };

  let htmlDir = null;       // carpeta extraída del ZIP (a limpiar)
  let framesDir = null;     // frames PNG (a limpiar)
  let win = null;

  try {
    const zipPath = opts && opts.zipPath;
    const htmlPathIn = opts && opts.htmlPath;
    const urlIn = opts && opts.url ? String(opts.url) : null;
    const duration = Math.max(0.5, parseFloat(opts && opts.duration) || 6);
    const speed = Math.max(0.05, parseFloat(opts && opts.speed) || 1);
    const fps = Math.max(1, Math.min(60, parseInt(opts && opts.fps, 10) || 30));
    const width = Math.max(16, parseInt(opts && opts.width, 10) || 1920);
    const height = Math.max(16, parseInt(opts && opts.height, 10) || 1080);
    const outputPath = opts && opts.outputPath;
    if (!outputPath) return { success: false, error: 'Falta la ruta de salida.' };

    // 1) Preparar la carpeta con el HTML: extraer ZIP o usar .html suelto
    let htmlFile;
    if (zipPath && fs.existsSync(zipPath)) {
      htmlDir = path.join(os.tmpdir(), 'zms-html-' + jobId);
      fs.mkdirSync(htmlDir, { recursive: true });
      const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
      const entries = [];
      zip.forEach((relPath, file) => { if (!file.dir) entries.push({ relPath, file }); });
      for (const { relPath, file } of entries) {
        const dest = path.join(htmlDir, relPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, await file.async('nodebuffer'));
      }
      htmlFile = findIndexHtml(htmlDir);
      if (!htmlFile) { return { success: false, error: 'No se encontró ningún .html dentro del ZIP.' }; }
    } else if (htmlPathIn && fs.existsSync(htmlPathIn)) {
      htmlFile = htmlPathIn;
    } else if (!urlIn) {
      return { success: false, error: 'Falta el archivo de entrada (ZIP o HTML) o una URL.' };
    }

    // 2) Carpeta de frames
    framesDir = path.join(os.tmpdir(), 'zms-html-frames-' + jobId);
    fs.mkdirSync(framesDir, { recursive: true });

    // 3) Ventana oculta. backgroundThrottling:false es OBLIGATORIO: sin él Electron
    //    ralentiza rAF/timers de ventanas ocultas y la animación no avanza (frames iguales).
    win = new BrowserWindow({
      width, height, show: false, frame: false, resizable: false,
      webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true },
    });

    if (urlIn) {
      // Cargar una URL web. Esperar a did-finish-load (con timeout) para que la página
      // y sus animaciones arranquen; si falla la carga, abortar.
      let loadErr = null;
      const finishPromise = new Promise((resolve) => {
        const onFinish = () => { cleanup(); resolve(true); };
        const onFail = (_e, errCode, errDesc) => { loadErr = errDesc || ('Error de carga (' + errCode + ')'); cleanup(); resolve(false); };
        const cleanup = () => {
          win.webContents.removeListener('did-finish-load', onFinish);
          win.webContents.removeListener('did-fail-load', onFail);
        };
        win.webContents.once('did-finish-load', onFinish);
        win.webContents.once('did-fail-load', onFail);
      });
      await win.webContents.loadURL(urlIn).catch(() => {});
      await Promise.race([finishPromise, new Promise((r) => setTimeout(r, 20000))]);
      if (loadErr) return { success: false, error: 'No se pudo cargar la URL: ' + loadErr };
      // Espera extra para que arranquen animaciones/JS asíncrono de la página
      await new Promise((r) => setTimeout(r, 1500));
    } else {
      await win.webContents.loadFile(htmlFile);
      // Pequeña espera para que arranquen las animaciones (CSS/JS)
      await new Promise((r) => setTimeout(r, 1500));
    }

    // 4) Captura en tiempo real alineada a reloj: muestrea la animación a su velocidad natural
    const totalFrames = Math.max(1, Math.floor(duration * fps));
    const start = Date.now();
    for (let i = 0; i < totalFrames; i++) {
      const target = start + (i * 1000) / fps;
      const wait = target - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (win.isDestroyed()) break;
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(framesDir, `frame_${String(i).padStart(5, '0')}.png`), img.toPNG());
      sendProgress(Math.round((i / totalFrames) * 90));
    }

    if (!win.isDestroyed()) win.close();
    win = null;

    // 5) FFmpeg: frames PNG -> MP4 con setpts=1/speed (speed>1 = acelerado)
    sendProgress(92);
    const setpts = (1 / speed).toString();
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, [
        '-y', '-framerate', String(fps),
        '-i', path.join(framesDir, 'frame_%05d.png'),
        '-filter:v', `setpts=${setpts}*PTS`,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        outputPath,
      ], { windowsHide: true }, (err, _stdout, stderr) => {
        if (err) { console.error('[html2mp4] ffmpeg error:', String(stderr).slice(0, 500)); reject(new Error('ffmpeg falló: ' + err.message)); }
        else resolve();
      });
    });

    sendProgress(100);
    return { success: true, outputPath };
  } catch (e) {
    console.error('[html2mp4] error:', e);
    return { success: false, error: (e && e.message) || 'Error al convertir HTML a MP4.' };
  } finally {
    if (win && !win.isDestroyed()) { try { win.close(); } catch {} }
    if (framesDir) { try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch {} }
    if (htmlDir) { try { fs.rmSync(htmlDir, { recursive: true, force: true }); } catch {} }
  }
});

// --- Demucs / separación de stems de audio ---

function getDemucsModelsDir() {
  return path.join(app.getPath('userData'), 'demucs-models');
}

function getPythonVersion(pythonExe) {
  try {
    const output = execSync(`"${pythonExe}" --version`, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    const match = output.match(/Python\s+(\d+)\.(\d+)/);
    if (match) return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10), text: output.trim() };
  } catch {}
  return null;
}

function getDemucsVenvDir() {
  return path.join(app.getPath('userData'), 'demucs-venv');
}

async function checkDemucsAvailability() {
  const pythonExe = findPython();
  if (!pythonExe) {
    return { available: false, reason: 'python', python: null, message: 'No se encontró Python instalado.' };
  }
  const version = getPythonVersion(pythonExe);
  if (!version) {
    return { available: false, reason: 'python', python: pythonExe, message: 'No se pudo determinar la versión de Python.' };
  }
  // Python 3.13 no tiene ruedas oficiales de torch para Demucs; se requiere crear venv con 3.9-3.12
  if (version.major > 3 || (version.major === 3 && version.minor > 12)) {
    return {
      available: false,
      reason: 'python-version',
      python: pythonExe,
      version: version.text,
      message: `Tienes ${version.text}. Demucs requiere Python 3.9 - 3.12. Instala una de esas versiones y asegúrate de que esté en el PATH antes que 3.13.`,
    };
  }

  // 1) Comprobar entorno virtual dedicado
  const venvDir = getDemucsVenvDir();
  const venvPython = path.join(venvDir, process.platform === 'win32' ? 'Scripts' : 'bin', 'python.exe');
  if (fs.existsSync(venvPython)) {
    try {
      execSync(`"${venvPython}" -c "import demucs"`, { timeout: 5000, windowsHide: true });
      return { available: true, python: venvPython, venv: venvDir };
    } catch {}
  }

  // 2) Comprobar Python del sistema
  try {
    execSync(`"${pythonExe}" -c "import demucs"`, { timeout: 5000, windowsHide: true });
    return { available: true, python: pythonExe };
  } catch {
    return { available: false, reason: 'demucs', python: pythonExe, version: version.text, message: 'Python correcto, pero Demucs no está instalado.' };
  }
}

async function installDemucsPackage() {
  const pythonExe = findPython();
  if (!pythonExe) {
    return { success: false, error: 'No se encontró Python. Instálalo primero desde python.org.' };
  }
  const version = getPythonVersion(pythonExe);
  if (!version || version.major > 3 || (version.major === 3 && version.minor > 12)) {
    return {
      success: false,
      error: `Python ${version ? version.text : 'desconocido'} no es compatible. Necesitas Python 3.9 - 3.12 para Demucs.`,
    };
  }

  const venvDir = getDemucsVenvDir();
  return new Promise((resolve) => {
    // 1) Crear venv si no existe
    if (!fs.existsSync(venvDir)) {
      const createProc = spawn(pythonExe, ['-m', 'venv', venvDir], { windowsHide: true });
      let createOut = '';
      createProc.stdout.on('data', (d) => { createOut += d.toString(); });
      createProc.stderr.on('data', (d) => { createOut += d.toString(); });
      createProc.on('close', (code) => {
        if (code !== 0) {
          resolve({ success: false, error: `No se pudo crear el entorno virtual: ${createOut.slice(-600) || code}` });
          return;
        }
        installInVenv(resolve);
      });
      createProc.on('error', (err) => resolve({ success: false, error: err.message }));
    } else {
      installInVenv(resolve);
    }
  });

  function installInVenv(resolve) {
    const venvPython = path.join(venvDir, process.platform === 'win32' ? 'Scripts' : 'bin', 'python.exe');
    if (!fs.existsSync(venvPython)) {
      resolve({ success: false, error: 'No se encontró el intérprete del entorno virtual.' });
      return;
    }

    const runPip = (args, label) => new Promise((r) => {
      const proc = spawn(venvPython, ['-m', 'pip', 'install', '-U', ...args], { windowsHide: true });
      let output = '';
      proc.stdout.on('data', (d) => { output += d.toString(); });
      proc.stderr.on('data', (d) => { output += d.toString(); });
      proc.on('close', (code) => r({ ok: code === 0, output, code }));
      proc.on('error', (err) => r({ ok: false, output: err.message, code: -1 }));
    });

    (async () => {
      // Instalar primero dependencias base para evitar problemas de resolución en Windows
      const base = await runPip(['numpy', 'torch', 'torchaudio'], 'dependencias base');
      if (!base.ok) {
        resolve({ success: false, error: `Error instalando dependencias base:\n${base.output.slice(-1200)}` });
        return;
      }
      const demucs = await runPip(['demucs'], 'demucs');
      if (!demucs.ok) {
        resolve({ success: false, error: `Error instalando Demucs:\n${demucs.output.slice(-1200)}` });
        return;
      }
      resolve({ success: true, venv: venvDir });
    })();
  }
}

function listDemucsStems(outputDir, model, baseName) {
  const possibleDirs = [
    path.join(outputDir, model, baseName),
    path.join(outputDir, model),
    outputDir,
  ];
  const stemNames = ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'];
  for (const stemsDir of possibleDirs) {
    if (!fs.existsSync(stemsDir)) continue;
    const found = stemNames
      .map((name) => {
        const wav = path.join(stemsDir, `${name}.wav`);
        const mp3 = path.join(stemsDir, `${name}.mp3`);
        if (fs.existsSync(wav)) return { name, path: wav };
        if (fs.existsSync(mp3)) return { name, path: mp3 };
        return null;
      })
      .filter(Boolean);
    if (found.length > 0) return found;
  }
  return [];
}

ipcMain.handle('audio:check-demucs', async () => {
  return checkDemucsAvailability();
});

ipcMain.handle('audio:install-demucs', async () => {
  return installDemucsPackage();
});

ipcMain.handle('audio:separate', async (_, opts) => {
  const inputPath = opts && opts.inputPath;
  const model = opts && opts.model;
  const jobId = (opts && opts.jobId) ? String(opts.jobId) : ('demucs-' + Date.now());
  if (!inputPath || !fs.existsSync(inputPath)) {
    return { success: false, error: 'Archivo de entrada no encontrado.' };
  }

  const check = await checkDemucsAvailability();
  if (!check.available) {
    return { success: false, error: check.message || 'Demucs no disponible.' };
  }

  const outputDir = path.join(os.tmpdir(), 'zms-demucs-' + jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  const modelsDir = getDemucsModelsDir();
  fs.mkdirSync(modelsDir, { recursive: true });

  const sendProgress = (percent, status) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('audio:separate-progress', { jobId, percent, status });
      }
    } catch {}
  };

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const selectedModel = ['htdemucs', 'htdemucs_6s'].includes(model) ? model : 'htdemucs';

  return new Promise((resolve) => {
    sendProgress(0, 'Iniciando separación…');
    const args = [
      '-m', 'demucs.separate',
      '-o', outputDir,
      '-n', selectedModel,
      inputPath,
    ];


    demucsProcess = spawn(check.python, args, {
      env: { ...process.env, TORCH_HOME: modelsDir },
      windowsHide: true,
    });

    let stderr = '';
    let stdout = '';
    demucsProcess.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      stderr += text; // Demucs a veces escribe progreso en stdout
      const match = text.match(/(\d+)%\|/);
      if (match) {
        const pct = parseInt(match[1], 10);
        sendProgress(Math.max(0, Math.min(99, pct)), 'Separando…');
      } else if (/downloading|loading|preparing|importing/i.test(text)) {
        sendProgress(0, text.trim().slice(0, 120));
      }
    });

    demucsProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      const match = text.match(/(\d+)%\|/);
      if (match) {
        const pct = parseInt(match[1], 10);
        sendProgress(Math.max(0, Math.min(99, pct)), 'Separando…');
      }
    });

    demucsProcess.on('error', (err) => {
      demucsProcess = null;
      resolve({ success: false, error: `No se pudo lanzar Demucs: ${err.message}`, stderr: stderr.slice(-1200), stdout: stdout.slice(-1200) });
    });

    demucsProcess.on('exit', (code) => {
      demucsProcess = null;
      if (code !== 0) {
        // Intentar detectar causa común
        let cause = `Código ${code}`;
        const all = (stdout + stderr).toLowerCase();
        if (all.includes('no module named')) cause = 'Falta un módulo de Python. Reinstala Demucs.';
        else if (all.includes('cuda out of memory') || all.includes('out of memory')) cause = 'Memoria insuficiente (RAM/VRAM). Prueba un audio más corto.';
        else if (all.includes('could not load model')) cause = 'No se pudo descargar/cargar el modelo. Revisa la conexión.';
        else if (all.includes('file not found') || all.includes('no such file')) cause = 'No se encontró el archivo de audio.';
        else if (code === 3221226505) cause = 'El proceso se cerró inesperadamente (posiblemente falta memoria).';
        resolve({ success: false, error: `Demucs finalizó con error: ${cause}`, stderr: stderr.slice(-1200), stdout: stdout.slice(-1200) });
        return;
      }
      const stems = listDemucsStems(outputDir, selectedModel, baseName);
      if (stems.length === 0) {
        resolve({ success: false, error: 'No se encontraron stems generados.', stderr: stderr.slice(-1200), stdout: stdout.slice(-1200) });
        return;
      }
      sendProgress(100, 'Separación completada');
      resolve({ success: true, stems, outputDir, model: selectedModel });
    });
  });
});

ipcMain.handle('audio:cancel-separate', async () => {
  if (isProcessRunning(demucsProcess)) {
    try {
      demucsProcess.kill('SIGTERM');
      if (process.platform === 'win32') {
        try { execSync(`taskkill /F /T /PID ${demucsProcess.pid}`, { timeout: 5000 }); } catch {}
      }
    } catch {}
    demucsProcess = null;
  }
  return { success: true };
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1250,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, '..', 'public', 'installer-icon.ico'),
  });

  if (MENU_MODE === 'none') {
    mainWindow.setMenuBarVisibility(false);
    Menu.setApplicationMenu(null);
  } else if (MENU_MODE === 'minimal') {
    mainWindow.setMenuBarVisibility(true);
    const minimalMenu = Menu.buildFromTemplate([
      {
        label: 'Archivo',
        submenu: [
          { role: 'quit', label: 'Salir' },
        ],
      },
      {
        label: 'Ayuda',
        submenu: [
          {
            label: 'Acerca de Zeus Media Studio',
            click: () => dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Acerca de',
              message: 'Zeus Media Studio',
              detail: 'Aplicación de escritorio para crear y organizar tu universo multimedia.',
            }),
          },
        ],
      },
    ]);
    Menu.setApplicationMenu(minimalMenu);
  }

  const startUrl = isDev ? `http://localhost:${devPort}` : `http://localhost:${prodPort}`;
  mainWindow.loadURL(startUrl);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    // Fix para Windows: frame:false hace que los inputs no reciban foco
    // hasta que la ventana pierde y recupera el foco del SO al menos una vez.
    // Se crea una ventana fantasma invisible para forzar el cambio de foco.
    if (process.platform === 'win32') {
      setTimeout(() => {
        const ghost = new BrowserWindow({
          width: 1, height: 1, x: -10000, y: -10000,
          frame: false, show: false, skipTaskbar: true,
          webPreferences: { offscreen: true }
        });
        ghost.showInactive();
        ghost.focus();
        setTimeout(() => {
          ghost.close();
          mainWindow.focus();
          mainWindow.webContents.focus();
        }, 100);
      }, 500);
    }
    const zoom = getZoomForUrl(mainWindow.webContents.getURL());
    applyZoom(zoom);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Aplicar zoom por editor al cargar cada URL (incluyendo navegaciones SPA)
  mainWindow.webContents.on('did-finish-load', () => {
    const zoom = getZoomForUrl(mainWindow.webContents.getURL());
    console.log('[Zoom] did-finish-load ->', mainWindow.webContents.getURL(), 'zoom:', zoom);
    applyZoom(zoom);
  });
  mainWindow.webContents.on('did-navigate-in-page', (_event, url) => {
    const zoom = getZoomForUrl(url);
    console.log('[Zoom] did-navigate-in-page ->', url, 'zoom:', zoom);
    applyZoom(zoom);
  });

  // Atajos de zoom con before-input-event (más robusto que globalShortcut)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const ctrl = input.control || input.meta;
    if (!ctrl) return;
    if (input.key === 'Equal' || input.key === 'Plus' || input.key === 'Add' || input.code === 'Equal' || input.code === 'NumpadAdd') {
      event.preventDefault();
      adjustZoom(0.1);
    } else if (input.key === 'Minus' || input.key === 'Subtract' || input.code === 'Minus' || input.code === 'NumpadSubtract') {
      event.preventDefault();
      adjustZoom(-0.1);
    } else if (input.key === '0' || input.code === 'Digit0' || input.code === 'Numpad0') {
      event.preventDefault();
      resetZoom();
    }
  });
}

// Control de ventana desde la interfaz (minimizar, maximizar, cerrar)
ipcMain.on('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.on('window:maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});
ipcMain.on('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

// Abrir/cerrar DevTools para depuración (lo usa el botón del modal de modelos)
ipcMain.on('window:toggle-devtools', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools();
      else mainWindow.webContents.openDevTools({ mode: 'detach' });
    } catch (e) {
      console.error('Error abriendo DevTools:', e);
    }
  }
});

// Fix foco inputs en Windows (frame:false): usamos una ventana auxiliar invisible 
// para forzar el refresco del foco sin parpadeos en la ventana principal.
ipcMain.on('window:refresh-focus', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      // Creamos una ventana mínima, fuera de pantalla e invisible
      let focusFixer = new BrowserWindow({
        width: 1,
        height: 1,
        x: -100,
        y: -100,
        show: true, // Debe estar "mostrada" para tomar el foco
        frame: false,
        transparent: true,
        opacity: 0,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: true
      });

      // Enfocamos la ventana invisible y luego volvemos a la principal
      focusFixer.focus();
      
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.focus();
          mainWindow.webContents.focus();
        }
        // Cerramos la ventana auxiliar inmediatamente
        if (focusFixer && !focusFixer.isDestroyed()) {
          focusFixer.close();
        }
      }, 10);
    } catch (e) {
      console.error('Error in refresh-focus helper:', e);
    }
  }
});

// Control de zoom desde el renderer
ipcMain.on('zoom:set', (_, factor) => applyZoom(factor));
ipcMain.on('zoom:in', () => adjustZoom(0.1));
ipcMain.on('zoom:out', () => adjustZoom(-0.1));
ipcMain.on('zoom:reset', () => resetZoom());
ipcMain.handle('zoom:get', () => currentZoom);

ipcMain.on('navigate-to', (_, url) => {
  if (mainWindow && !mainWindow.isDestroyed() && url) {
    mainWindow.loadURL(url);
  }
});

function spawnServer(name, dir, scriptPath, port) {
  const nodeExe = process.execPath;
  console.log(`Starting ${name} server in ${dir}`);

  const proc = spawn(nodeExe, [scriptPath, 'start', '-p', port], {
    cwd: dir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true, // Sin esto, cada servidor hijo abre una consola al arrancar la app
  });

  proc.stdout.on('data', (data) => console.log(`[${name}] ${data}`));
  proc.stderr.on('data', (data) => console.error(`[${name} Error] ${data}`));

  return proc;
}

// --- API de Zeus (API/index.ts, puerto 3001) ---
// Resuelve el directorio de la API en dev (junto a electron/) y empaquetado.
function resolveApiDir() {
  const candidates = [
    path.join(__dirname, '..', 'API'),
    path.join(process.resourcesPath || '', 'app', 'API'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'index.ts'))) return c;
  }
  return null;
}

function resolveServeDir() {
  const candidates = [
    path.join(__dirname, '..', 'serve'),
    path.join(process.resourcesPath || '', 'app', 'serve'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'server.js'))) return c;
  }
  return null;
}

function startZeusServe() {
  if (zeusServeProcess && isProcessRunning(zeusServeProcess)) {
    console.log('[ZeusServe] ya está en ejecución');
    return;
  }
  const serveDir = resolveServeDir();
  if (!serveDir) {
    console.warn('[ZeusServe] No se encontró serve/server.js — omitiendo inicio del servidor de preview.');
    return;
  }

  // Túnel desactivado: la app trabaja en local. ENABLE_TUNNEL=1 para reactivarlo.
  const env = { ...process.env, ENABLE_TUNNEL: process.env.ENABLE_TUNNEL || '0' };
  const nodeModules = path.join(serveDir, 'node_modules');
  let proc;
  if (fs.existsSync(nodeModules)) {
    // Dev (o empaquetado con node_modules): correr server.js con el runtime de
    // Electron como Node (ELECTRON_RUN_AS_NODE=1). Así no hace falta `node` del sistema.
    proc = spawn(process.execPath, ['server.js'], {
      cwd: serveDir,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
    });
  } else {
    // Empaquetado sin node_modules: usar el build autocontenido preview-server.exe.
    const exe = path.join(serveDir, 'preview-server.exe');
    if (!fs.existsSync(exe)) {
      console.warn('[ZeusServe] No hay serve/node_modules ni preview-server.exe — omitiendo inicio.');
      return;
    }
    proc = spawn(exe, [], { cwd: serveDir, env, windowsHide: true });
  }

  zeusServeProcess = proc;
  console.log(`[ZeusServe] Iniciado en ${serveDir} (PID ${proc.pid || '?'})`);
  proc.stdout.on('data', (d) => console.log('[ZeusServe]', d.toString().trim()));
  proc.stderr.on('data', (d) => console.error('[ZeusServe]', d.toString().trim()));
  proc.on('error', (err) => console.error('[ZeusServe] error al iniciar:', err));
  proc.on('exit', (code) => {
    console.log(`[ZeusServe] proceso finalizado (code ${code})`);
    zeusServeProcess = null;
  });
}

function startZeusApi() {
  if (zeusApiProcess && isProcessRunning(zeusApiProcess)) {
    console.log('[ZeusAPI] ya está en ejecución');
    return;
  }
  const apiDir = resolveApiDir();
  if (!apiDir) {
    console.warn('[ZeusAPI] No se encontró API/index.ts — omitiendo inicio de la API.');
    return;
  }

  const isWin = process.platform === 'win32';
  const tsxCli = path.join(apiDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  let proc;
  if (fs.existsSync(tsxCli)) {
    // Usar el propio runtime de Electron como Node (ELECTRON_RUN_AS_NODE=1) para
    // ejecutar la CLI de tsx. Así funciona tanto en dev como empaquetado (donde
    // no hay `node` ni `npx` en el PATH del sistema).
    proc = spawn(process.execPath, [tsxCli, 'index.ts'], {
      cwd: apiDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
    });
  } else {
    // Fallback (sólo dev): npx tsx
    proc = spawn(isWin ? 'npx.cmd' : 'npx', ['tsx', 'index.ts'], { cwd: apiDir, env: { ...process.env }, shell: isWin, windowsHide: true });
  }

  zeusApiProcess = proc;
  console.log(`[ZeusAPI] Iniciada en ${apiDir} (PID ${proc.pid || '?'})`);
  proc.stdout.on('data', (d) => console.log('[ZeusAPI]', d.toString().trim()));
  proc.stderr.on('data', (d) => console.error('[ZeusAPI]', d.toString().trim()));
  proc.on('error', (err) => console.error('[ZeusAPI] error al iniciar:', err));
  proc.on('exit', (code) => {
    console.log(`[ZeusAPI] proceso finalizado (code ${code})`);
    zeusApiProcess = null;
  });
}

app.whenReady().then(async () => {
  // Registrar protocolo personalizado para servir archivos locales (imágenes, video, audio)
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url);
      const filePath = decodeURIComponent(url.searchParams.get('path') || '');
      console.log('[media://] Request:', request.url, '-> path:', filePath);
      if (!filePath) return new Response('Missing path', { status: 400 });
      const resolved = path.resolve(filePath);
      console.log('[media://] Resolved:', resolved, 'exists:', fs.existsSync(resolved));
      if (!fs.existsSync(resolved)) return new Response('Not found', { status: 404 });
      const stats = fs.statSync(resolved);
      if (!stats.isFile()) return new Response('Not a file', { status: 400 });

      const ext = path.extname(resolved).toLowerCase();
      const CONTENT_TYPES = {
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.flac': 'audio/flac',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
        '.svg': 'image/svg+xml', '.gif': 'image/gif',
        '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
        '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.obj': 'model/obj', '.fbx': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
      };
      const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

      const range = request.headers.get('Range');
      if (range && (contentType.startsWith('video/') || contentType.startsWith('audio/'))) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        const chunksize = (end - start) + 1;
        const stream = fs.createReadStream(resolved, { start, end });
        const webStream = new ReadableStream({
          start(controller) {
            stream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
            stream.on('end', () => controller.close());
            stream.on('error', (err) => controller.error(err));
          },
          cancel() { stream.destroy(); }
        });
        return new Response(webStream, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${stats.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunksize),
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      const fileBuffer = fs.readFileSync(resolved);
      console.log('[media://] Serving:', resolved, 'size:', stats.size, 'type:', contentType);
      return new Response(fileBuffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(stats.size),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (e) {
      return new Response(`Error: ${e.message}`, { status: 500 });
    }
  });

  // Permitir micrófono, cámara y MIDI cuando el renderer los solicite (funciona empaquetado con Electron)
  const allowedPermissions = ['media', 'microphone', 'audio', 'midi', 'midiSysex'];
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowedPermissions.includes(permission));
  });
  // Re-comprobaciones de permiso (navegación/recarga): deben pasar también
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return allowedPermissions.includes(permission);
  });

  try {
    if (!isDev) {
      const baseAppDir = path.join(process.resourcesPath, 'app');
      const nextBin = path.join(baseAppDir, 'node_modules', 'next', 'dist', 'bin', 'next');

      // PocketBase: usar directorio de datos escribible (en app instalada "Program Files" es solo lectura)
      const userDataDir = app.getPath('userData');
      const pbDataDir = path.join(userDataDir, 'pb_data');
      const pbSourceData = path.join(baseAppDir, 'pocket-base', 'pb_data');
      if (!fs.existsSync(pbDataDir)) {
        fs.mkdirSync(pbDataDir, { recursive: true });
        if (fs.existsSync(pbSourceData)) {
          try {
            fs.cpSync(pbSourceData, pbDataDir, { recursive: true });
          } catch (e) {
            console.warn('No se pudo copiar pb_data inicial:', e.message);
          }
        }
      }

      const pbPath = path.join(baseAppDir, 'pocket-base', 'pocketbase.exe');
      const pbDatosDir = path.join(baseAppDir, 'PB_Datos');
      const waiters = [];

      if (fs.existsSync(pbPath)) {
        // 1. Iniciar PocketBase con --dir en userData (escribible)
        pbProcess = spawn(pbPath, ['serve', `--http=127.0.0.1:${pocketBasePort}`, '--dir', pbDataDir], {
          cwd: path.dirname(pbPath),
          env: { ...process.env },
          windowsHide: true, // PocketBase es una app de consola: sin esto abre un terminal al arrancar
        });
        pbProcess.on('error', (err) => console.error('PocketBase error:', err));
        pbProcess.stdout.on('data', (d) => console.log('[PocketBase]', d.toString().trim()));
        pbProcess.stderr.on('data', (d) => console.error('[PocketBase]', d.toString().trim()));
        waiters.push(waitForServer(parseInt(pocketBasePort), 'PocketBase'));
      } else {
        console.warn('[Main] PocketBase no encontrado, omitiendo inicio de base de datos local.');
      }

      if (fs.existsSync(pbDatosDir)) {
        // 2. Iniciar PB_Datos Server
        pbDatosProcess = spawnServer('PB_Datos', pbDatosDir, nextBin, pbDatosPort);
        waiters.push(waitForServer(parseInt(pbDatosPort), 'Servidor de Datos'));
      } else {
        console.warn('[Main] PB_Datos no encontrado, omitiendo servidor de datos.');
      }

      // 3. Iniciar Main App Server
      mainServerProcess = spawnServer('Main', baseAppDir, nextBin, prodPort);
      waiters.push(waitForServer(parseInt(prodPort), 'Servidor Principal'));

      console.log('Esperando servidores...');
      await Promise.all(waiters);

      // Sembrar el admin local de PocketBase (idempotente). En una BD local
      // recién creada no hay usuarios ni admin → authAsAdmin() del API (que cae a
      // pb.admins.authWithPassword) no podría autenticar. Creamos el admin con las
      // credenciales de PB_ADMIN_* (API/.env); si ya existe, pocketbase devuelve
      // error y lo ignoramos. El editor de tutoriales usa la base local (PB_URL).
      if (fs.existsSync(pbPath)) {
        try {
          const seed = spawn(pbPath, ['admin', 'create', 'francisco@gmail.com', '1234512345', '--dir', pbDataDir], {
            cwd: path.dirname(pbPath), windowsHide: true
          });
          seed.on('error', () => {});
          seed.stderr.on('data', (d) => console.log('[PocketBase][seed]', d.toString().trim()));
          seed.on('exit', (code) => {
            if (code === 0) console.log('[PocketBase] Admin local sembrado (francisco@gmail.com).');
            // code != 0 = el admin ya existe → se ignora.
          });
        } catch (e) { /* sembrar es best-effort */ }
      }
    } else {
      await waitForServer(parseInt(devPort), 'Dev Server', 10).catch(() => {});
    }

    // Matar servidores zombie de ejecuciones anteriores
    killZombieServers();

    // Iniciar la API de Zeus (API/index.ts, puerto 3001) junto a la app
    startZeusApi();

    // Iniciar el servidor de preview (serve/server.js, puerto 3032) junto a la app
    startZeusServe();

    createWindow();
  } catch (err) {
    console.error('Startup error:', err);
    dialog.showErrorBox('Error de Inicio', err.message + '\n\nLa aplicación se cerrará.');
    app.quit();
  }
});

// --- Gestión de ComfyUI y Flux Bridge ---
function isProcessRunning(proc) {
  return proc && proc.pid && !proc.killed;
}

const { execSync } = require('child_process');

function findPythonInRegistry() {
  try {
    // Buscar instalaciones de Python en el registro de Windows
    const regQuery = 'reg query HKLM\\\\SOFTWARE\\\\Python\\\\PythonCore /s /f InstallPath /d';
    const output = execSync(regQuery, { encoding: 'utf-8', timeout: 5000 });
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      if (line.includes('InstallPath')) {
        const parts = line.trim().split(/\s+/);
        const installPath = parts[parts.length - 1];
        const pythonExe = path.join(installPath, 'python.exe');
        if (fs.existsSync(pythonExe)) return pythonExe;
      }
    }
  } catch (e) {}
  try {
    // También buscar en HKCU (Current User)
    const regQuery = 'reg query HKCU\\\\SOFTWARE\\\\Python\\\\PythonCore /s /f InstallPath /d';
    const output = execSync(regQuery, { encoding: 'utf-8', timeout: 5000 });
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      if (line.includes('InstallPath')) {
        const parts = line.trim().split(/\s+/);
        const installPath = parts[parts.length - 1];
        const pythonExe = path.join(installPath, 'python.exe');
        if (fs.existsSync(pythonExe)) return pythonExe;
      }
    }
  } catch (e) {}
  return null;
}

function findPython() {
  // 0. Buscar en el PATH completo del usuario (incluye Microsoft Store, instalaciones locales, etc.)
  // Usamos cmd /c para que se evalúe el PATH del usuario actual, no el del proceso empaquetado
  try {
    const output = execSync('cmd /c "where python 2>nul"', { encoding: 'utf-8', timeout: 5000 });
    const firstLine = output.split(/\r?\n/)[0].trim();
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch (e) {}
  try {
    const output = execSync('cmd /c "where python3 2>nul"', { encoding: 'utf-8', timeout: 5000 });
    const firstLine = output.split(/\r?\n/)[0].trim();
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch (e) {}

  // 1. py.exe launcher
  try {
    const output = execSync('cmd /c "py -3 -c \\"import sys; print(sys.executable)\\" 2>nul"', { encoding: 'utf-8', timeout: 5000 });
    const pyPath = output.trim();
    if (pyPath && fs.existsSync(pyPath)) return pyPath;
  } catch (e) {}

  // 2. Registro de Windows
  const regPython = findPythonInRegistry();
  if (regPython) return regPython;

  // 3. Rutas conocidas
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'python3.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python39', 'python.exe'),
    'C:\\Python312\\python.exe',
    'C:\\Python311\\python.exe',
    'C:\\Python310\\python.exe',
    'C:\\Python39\\python.exe',
    'C:\\Program Files\\Python312\\python.exe',
    'C:\\Program Files\\Python311\\python.exe',
    'C:\\Program Files\\Python310\\python.exe',
    'C:\\Program Files\\Python39\\python.exe',
    'C:\\Program Files (x86)\\Python312\\python.exe',
    'C:\\Program Files (x86)\\Python311\\python.exe',
    'C:\\Program Files (x86)\\Python310\\python.exe',
    'C:\\Program Files (x86)\\Python39\\python.exe',
    path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'python.exe'),
    path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// stderr de procesos hijo (ComfyUI, Flux Bridge, Tracking API): NO todo lo que
// sale por stderr es un error. Python escribe por stderr salidas diagnósticas que
// NO son errores, por convención:
//  - Barras de progreso de tqdm (propagación SAM2, generación de vídeo):
//    "propagate in video:  91%|███████ | 489/539 [02:53<00:17, 2.80it/s]"
//  - Logs de acceso de Flask/Werkzeug (servidor dev del bridge):
//    '127.0.0.1 - - [13/Aug/2026 02:42:00] "GET /sam2/status/... HTTP/1.1" 200 -'
// El lanzador antes etiquetaba TODO stderr como "[X Error]" → el usuario veía
// "Error" en la terminal aunque todo fuese OK (HTTP 200, propagación al 100%).
// Clasificamos: progreso y logs de acceso = info (console.log), lo demás = error.
function isStderrNoise(line) {
  const s = line.trim();
  if (!s) return true;
  // Barra de progreso tqdm: "desc: 91%|██| 489/539 [.., 2.80it/s]"
  if (/\d+%\s*\|/.test(s)) return true;
  if (/\d+\s*\/\s*\d+\s*\[/.test(s)) return true;
  if (/\bit\/s\b|\bs\/it\b/.test(s)) return true;
  // Werkzeug/Flask access log: '... "GET /path HTTP/1.1" 200 -'
  if (/HTTP\/1\.[01]"\s*\d{3}/.test(s)) return true;
  // Werkzeug startup/debug (van por stderr en el dev server):
  // "* Running on http://", "* Debugger is active!", "* Restarting with stat"
  if (/^\*\s+(Running on|Debugger|Restarting|Serving|Starting)/.test(s)) return true;
  return false;
}
function printChildStderr(name, line) {
  const s = line.trim();
  if (!s) return;
  if (isStderrNoise(line)) console.log(`[${name}]`, s);
  else console.error(`[${name} Error]`, s);
}

function startComfyUI() {
  return new Promise((resolve, reject) => {
    if (isProcessRunning(comfyuiProcess)) {
      resolve({ success: true, message: 'ComfyUI ya está corriendo' });
      return;
    }
    const comfyDir = 'F:\\ComfyUI';
    if (!fs.existsSync(comfyDir)) {
      reject(new Error('Directorio F:\\ComfyUI no encontrado'));
      return;
    }

    const logDir = app.getPath('userData');
    const logPath = path.join(logDir, 'comfyui.log');

    // Preferir el venv de ComfyUI (tiene sqlalchemy y demás dependencias instaladas);
    // caer al Python del sistema solo si el venv no existe.
    const venvPython = path.join(comfyDir, '.venv', 'Scripts', 'python.exe');
    const pythonExe = fs.existsSync(venvPython) ? venvPython : findPython();
    if (!pythonExe) {
      reject(new Error('No se encontró Python. Asegúrate de que esté instalado y en el PATH.'));
      return;
    }
    console.log(`[ComfyUI] Usando Python: ${pythonExe}`);

    // Ejecutar Python directamente (sin PowerShell) para que el PID sea el de Python
    comfyuiProcess = spawn(pythonExe, ['main.py'], {
      cwd: comfyDir,
      env: { ...process.env },
      windowsHide: true
    });

    comfyuiProcess.stdout.on('data', (data) => {
      const line = data.toString();
      console.log('[ComfyUI]', line.trim());
      try { fs.appendFileSync(logPath, '[STDOUT] ' + line); } catch (e) {}
    });
    comfyuiProcess.stderr.on('data', (data) => {
      const line = data.toString();
      printChildStderr('ComfyUI', line);
      try { fs.appendFileSync(logPath, '[STDERR] ' + line); } catch (e) {}
    });
    comfyuiProcess.on('error', (err) => {
      console.error('[ComfyUI] Error al lanzar:', err);
      try { fs.appendFileSync(logPath, '[ERROR] ' + err.message + '\n'); } catch (e) {}
      comfyuiProcess = null;
      reject(err);
    });
    comfyuiProcess.on('exit', (code, signal) => {
      console.log(`[ComfyUI] Proceso finalizado con código ${code}, signal ${signal}`);
      try { fs.appendFileSync(logPath, `[EXIT] Código ${code}, signal ${signal}\n`); } catch (e) {}
      comfyuiProcess = null;
    });

    // Esperar a que el puerto 8188 responda (máx 180s para modelos pesados)
    let attempts = 0;
    const checkPort = () => {
      attempts++;
      http.get('http://127.0.0.1:8188/system_stats', { timeout: 3000 }, (res) => {
        res.on('data', () => {});
        if (res.statusCode < 400) {
          resolve({ success: true, message: 'ComfyUI iniciado' });
        } else {
          retry();
        }
      }).on('error', retry);
    };
    const retry = () => {
      if (attempts >= 180) {
        const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').slice(-2000) : 'Sin logs';
        reject(new Error(`ComfyUI no respondió tras 180s. Logs:\n${logContent}`));
        return;
      }
      if (!isProcessRunning(comfyuiProcess)) {
        const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').slice(-2000) : 'Sin logs';
        reject(new Error(`ComfyUI terminó inesperadamente. Logs:\n${logContent}`));
        return;
      }
      setTimeout(checkPort, 1000);
    };
    setTimeout(checkPort, 5000);
  });
}

function startFluxBridge() {
  return new Promise(async (resolve, reject) => {
    if (isProcessRunning(fluxBridgeProcess)) {
      resolve({ success: true, message: 'Flux Bridge ya está corriendo' });
      return;
    }
    // Raíz de la app (el directorio que contiene electron/), donde vive flux-bridge.py.
    // Antes estaba hardcodeado a C:\Zeus Media Studio (resto de una ubicación antigua),
    // lo que hacía que el bridge corriera un flux-bridge.py viejo y sin rutas nuevas.
    const bridgeDir = path.resolve(__dirname, '..');
    if (!fs.existsSync(bridgeDir)) {
      reject(new Error('No se encontró el directorio de la app para el Flux Bridge.'));
      return;
    }

    const logDir = app.getPath('userData');
    const logPath = path.join(logDir, 'fluxbridge.log');

    const pythonExe = findPython();
    if (!pythonExe) {
      reject(new Error('No se encontró Python. Asegúrate de que esté instalado y en el PATH.'));
      return;
    }

    // Verificar e instalar dependencias automáticamente antes de arrancar
    try {
      console.log('[FluxBridge] Verificando dependencias...');
      try {
        execSync(`"${pythonExe}" -c "import flask, requests, websocket"`, { timeout: 5000, windowsHide: true });
        console.log('[FluxBridge] Dependencias ya instaladas.');
      } catch {
        console.log('[FluxBridge] Instalando dependencias...');
        const installProc = spawn(pythonExe, ['-m', 'pip', 'install', 'flask', 'requests', 'websocket-client', '--user'], { windowsHide: true, cwd: bridgeDir });
        let installOut = '';
        installProc.stdout.on('data', (d) => { installOut += d.toString(); });
        installProc.stderr.on('data', (d) => { installOut += d.toString(); });
        await new Promise((r) => installProc.on('close', r));
        console.log('[FluxBridge] Instalación:', installOut.slice(-200));
      }
    } catch (e) {
      console.warn('[FluxBridge] No se pudieron instalar dependencias:', e.message);
    }

    // Ejecutar Python directamente (sin PowerShell) para que el PID sea el de Python
    fluxBridgeProcess = spawn(pythonExe, ['flux-bridge.py'], {
      cwd: bridgeDir,
      env: { ...process.env },
      windowsHide: true
    });

    fluxBridgeProcess.stdout.on('data', (data) => {
      const line = data.toString();
      console.log('[FluxBridge]', line.trim());
      try { fs.appendFileSync(logPath, '[STDOUT] ' + line); } catch (e) {}
    });
    fluxBridgeProcess.stderr.on('data', (data) => {
      const line = data.toString();
      printChildStderr('FluxBridge', line);
      try { fs.appendFileSync(logPath, '[STDERR] ' + line); } catch (e) {}
    });
    fluxBridgeProcess.on('error', (err) => {
      console.error('[FluxBridge] Error al lanzar:', err);
      try { fs.appendFileSync(logPath, '[ERROR] ' + err.message + '\n'); } catch (e) {}
      fluxBridgeProcess = null;
      reject(err);
    });
    fluxBridgeProcess.on('exit', (code, signal) => {
      console.log(`[FluxBridge] Proceso finalizado con código ${code}, signal ${signal}`);
      try { fs.appendFileSync(logPath, `[EXIT] Código ${code}, signal ${signal}\n`); } catch (e) {}
      fluxBridgeProcess = null;
    });

    let attempts = 0;
    const checkPort = () => {
      attempts++;
      http.get('http://127.0.0.1:5081/health', { timeout: 3000 }, (res) => {
        res.on('data', () => {});
        if (res.statusCode < 400) {
          resolve({ success: true, message: 'Flux Bridge iniciado' });
        } else {
          retry();
        }
      }).on('error', retry);
    };
    const retry = () => {
      if (attempts >= 30) {
        const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').slice(-2000) : 'Sin logs';
        reject(new Error(`Flux Bridge no respondió tras 30s. Logs:\n${logContent}`));
        return;
      }
      if (!isProcessRunning(fluxBridgeProcess)) {
        const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').slice(-2000) : 'Sin logs';
        reject(new Error(`Flux Bridge terminó inesperadamente. Logs:\n${logContent}`));
        return;
      }
      setTimeout(checkPort, 1000);
    };
    setTimeout(checkPort, 2000);
  });
}

function killWindowsTree(pid) {
  if (!pid) return;
  try {
    execSync(`taskkill /F /T /PID ${pid}`, { timeout: 5000 });
  } catch (e) {}
}

function findAndKillPython(scriptPattern) {
  try {
    const output = execSync(`wmic process where "commandline like '%${scriptPattern}%'" get processid`, { encoding: 'utf-8', timeout: 5000 });
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      const pid = parseInt(line.trim(), 10);
      if (!isNaN(pid)) {
        try {
          execSync(`taskkill /F /T /PID ${pid}`, { timeout: 5000 });
        } catch (e) {}
      }
    }
  } catch (e) {}
}

function killZombieServers() {
  console.log('[Cleanup] Matando servidores zombie...');
  findAndKillPython('flux-bridge.py');
  findAndKillPython('main.py');
}

function stopComfyUI() {
  if (isProcessRunning(comfyuiProcess)) {
    killWindowsTree(comfyuiProcess.pid);
    comfyuiProcess = null;
  }
  findAndKillPython('main.py');
  return { success: true, message: 'ComfyUI detenido' };
}

function stopFluxBridge() {
  if (isProcessRunning(fluxBridgeProcess)) {
    killWindowsTree(fluxBridgeProcess.pid);
    fluxBridgeProcess = null;
  }
  findAndKillPython('flux-bridge.py');
  return { success: true, message: 'Flux Bridge detenido' };
}

// --- API de Texturas (Api-Font-Texture/simple_api.py, puerto 8000) ---
// Resuelve el directorio de la API de texturas en dev (junto a electron/) y empaquetado.
function resolveTextureApiDir() {
  const candidates = [
    path.join(__dirname, '..', 'Api-Font-Texture'),
    path.join(process.resourcesPath || '', 'app', 'Api-Font-Texture'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'simple_api.py'))) return c;
  }
  return null;
}

function startTextureApi() {
  return new Promise(async (resolve, reject) => {
    if (textureApiProcess && isProcessRunning(textureApiProcess)) {
      resolve({ success: true, message: 'API de Texturas ya está corriendo' });
      return;
    }
    const apiDir = resolveTextureApiDir();
    if (!apiDir) {
      reject(new Error('No se encontró el directorio Api-Font-Texture/simple_api.py'));
      return;
    }

    const logDir = app.getPath('userData');
    const logPath = path.join(logDir, 'texture-api.log');

    // Preferir el venv de la API de texturas si existe; caer al Python del sistema.
    const venvPython = path.join(apiDir, 'venv', 'Scripts', 'python.exe');
    const pythonExe = fs.existsSync(venvPython) ? venvPython : findPython();
    if (!pythonExe) {
      reject(new Error('No se encontró Python. Asegúrate de que esté instalado y en el PATH.'));
      return;
    }
    console.log(`[TextureAPI] Usando Python: ${pythonExe}`);

    textureApiProcess = spawn(pythonExe, ['simple_api.py'], {
      cwd: apiDir,
      env: { ...process.env },
      windowsHide: true,
    });

    textureApiProcess.stdout.on('data', (data) => {
      const line = data.toString();
      console.log('[TextureAPI]', line.trim());
      try { fs.appendFileSync(logPath, '[STDOUT] ' + line); } catch (e) {}
    });
    textureApiProcess.stderr.on('data', (data) => {
      const line = data.toString();
      printChildStderr('TextureAPI', line);
      try { fs.appendFileSync(logPath, '[STDERR] ' + line); } catch (e) {}
    });
    textureApiProcess.on('error', (err) => {
      console.error('[TextureAPI] Error al lanzar:', err);
      try { fs.appendFileSync(logPath, '[ERROR] ' + err.message + '\n'); } catch (e) {}
      textureApiProcess = null;
      reject(err);
    });
    textureApiProcess.on('exit', (code, signal) => {
      console.log(`[TextureAPI] Proceso finalizado con código ${code}, signal ${signal}`);
      try { fs.appendFileSync(logPath, `[EXIT] Código ${code}, signal ${signal}\n`); } catch (e) {}
      textureApiProcess = null;
    });

    // Esperar a que el puerto 8000 responda (máx 60s)
    let attempts = 0;
    const checkPort = () => {
      attempts++;
      http.get('http://127.0.0.1:8000/health', { timeout: 3000 }, (res) => {
        res.on('data', () => {});
        if (res.statusCode < 400) {
          resolve({ success: true, message: 'API de Texturas iniciada' });
        } else {
          retry();
        }
      }).on('error', retry);
    };
    const retry = () => {
      if (attempts >= 60) {
        const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').slice(-2000) : 'Sin logs';
        reject(new Error(`API de Texturas no respondió tras 60s. Logs:\n${logContent}`));
        return;
      }
      if (!isProcessRunning(textureApiProcess)) {
        const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').slice(-2000) : 'Sin logs';
        reject(new Error(`API de Texturas terminó inesperadamente. Logs:\n${logContent}`));
        return;
      }
      setTimeout(checkPort, 1000);
    };
    setTimeout(checkPort, 2000);
  });
}

function stopTextureApi() {
  if (isProcessRunning(textureApiProcess)) {
    killWindowsTree(textureApiProcess.pid);
    textureApiProcess = null;
  }
  findAndKillPython('simple_api.py');
  return { success: true, message: 'API de Texturas detenida' };
}

async function checkServerStatus(port, path = '/') {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, { timeout: 3000 }, (res) => {
      resolve({ running: res.statusCode < 400, statusCode: res.statusCode });
    });
    req.on('error', () => resolve({ running: false }));
    req.on('timeout', () => { req.destroy(); resolve({ running: false }); });
  });
}

// IPC handlers para gestionar servidores desde el renderer
ipcMain.handle('server:start-comfyui', async () => {
  try {
    const result = await startComfyUI();
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('server:start-fluxbridge', async () => {
  try {
    const result = await startFluxBridge();
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('server:stop-comfyui', () => stopComfyUI());
ipcMain.handle('server:stop-fluxbridge', () => stopFluxBridge());

ipcMain.handle('server:status', async () => {
  const comfyuiStatus = await checkServerStatus(8188);
  const bridgeStatus = await checkServerStatus(5081, '/health');
  const textureApiStatus = await checkServerStatus(8000, '/health');
  return {
    comfyui: { running: comfyuiStatus.running, process: isProcessRunning(comfyuiProcess) },
    fluxBridge: { running: bridgeStatus.running, process: isProcessRunning(fluxBridgeProcess) },
    textureApi: { running: textureApiStatus.running, process: isProcessRunning(textureApiProcess) },
  };
});

ipcMain.handle('server:start-textureapi', async () => {
  try {
    const result = await startTextureApi();
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('server:stop-textureapi', () => stopTextureApi());

function cleanup() {
  [mainServerProcess, pbProcess, pbDatosProcess, comfyuiProcess, fluxBridgeProcess, zeusApiProcess, zeusServeProcess, textureApiProcess].forEach(p => {
    if (p && p.pid) {
      killWindowsTree(p.pid);
    }
  });
  killZombieServers();
}

app.on('window-all-closed', () => {
  cleanup();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', cleanup);
app.on('will-quit', cleanup);

// Si el renderer pide cerrar (botón personalizado), matar todo antes
ipcMain.on('app:quit', () => {
  cleanup();
  app.quit();
});
