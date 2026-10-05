const fs = require('fs');
const path = require('path');

// Prepara el entorno para el empaquetado de Electron
// Este script se ejecuta entre `next build` y `electron-builder`

function copyFile(src, dest) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`[prepare] Copiado: ${src} -> ${dest}`);
  }
}

function copyDir(src, dest) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
    console.log(`[prepare] Copiado directorio: ${src} -> ${dest}`);
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[prepare] Creado directorio: ${dir}`);
  }
}

console.log('[prepare] Preparando entorno para Electron...');

// Asegurar que existe .env.electron para el empaquetado
const envFiles = ['.env.local', '.env'];
let envElectronCreated = false;

if (!fs.existsSync('.env.electron')) {
  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      fs.copyFileSync(envFile, '.env.electron');
      console.log(`[prepare] Creado .env.electron desde ${envFile}`);
      envElectronCreated = true;
      break;
    }
  }
  if (!envElectronCreated) {
    fs.writeFileSync('.env.electron', 'NODE_ENV=production\n');
    console.log('[prepare] Creado .env.electron por defecto');
  }
}

// Asegurar que existe el directorio de salida de Electron
ensureDir('dist');

// Asegurar que existe el directorio app (donde electron-builder coloca recursos)
ensureDir('app');

// Copiar Api-Font-Texture al directorio app para que esté disponible en producción
const apiFontTextureSrc = path.join(__dirname, '..', 'Api-Font-Texture');
const apiFontTextureDest = path.join(__dirname, '..', 'app', 'Api-Font-Texture');
if (fs.existsSync(apiFontTextureSrc)) {
  // Limpiar destino anterior
  if (fs.existsSync(apiFontTextureDest)) {
    fs.rmSync(apiFontTextureDest, { recursive: true, force: true });
  }
  copyDir(apiFontTextureSrc, apiFontTextureDest);
  console.log('[prepare] Api-Font-Texture copiado a app/');
} else {
  console.warn('[prepare] Api-Font-Texture no encontrado en la raíz del proyecto');
}

// Copiar archivos de Electron necesarios si no existen en la ubicacion esperada
const electronDir = path.join(__dirname, '..', 'electron');
if (fs.existsSync(electronDir)) {
  console.log('[prepare] Directorio electron/ encontrado');
} else {
  console.warn('[prepare] Directorio electron/ no encontrado');
}

console.log('[prepare] Entorno preparado correctamente.');
