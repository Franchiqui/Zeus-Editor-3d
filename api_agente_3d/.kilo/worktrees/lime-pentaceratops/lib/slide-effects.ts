/**
 * Efectos de overlay para diapositivas y vídeo (partículas, rayos de luz, viñeta, etc.)
 * Generan imágenes PNG/SVG como data URLs para superponer sobre el contenido.
 */

import { getLocalPaths, writeFile, copyFile, getFilePath } from './electron-fs';

export type SlideEffectId =
  | 'vignette'
  | 'glow'
  | 'light-leak'
  | 'film-grain'
  | 'bokeh'
  | 'golden-hour'
  | 'cool-tint'
  | 'lens-flare'
  | 'soft-dream'
  | 'gradient-warm'
  | 'gradient-cool'
  | 'rays'
  | 'particles-snow'
  | 'particles-dust';

export interface SlideEffect {
  id: SlideEffectId | string;
  name: string;
  description: string;
  /** Data URL del overlay (PNG o SVG). Se genera a un tamaño base (ej. 1280x720). */
  getDataUrl: (width?: number, height?: number) => string;
}

/** Rayos de luz realistas / god rays desde esquina (tipo sol) */
function createRaysDataUrl(width = 1280, height = 720): string {
  const srcX = 0;
  const srcY = height * 0.4;
  const numRays = 12;
  const spreadAngle = 0.7;
  const rayParts: string[] = [];
  const gradientParts: string[] = [];
  for (let i = 0; i < numRays; i++) {
    const t = (i + 0.5) / numRays;
    const angle = -spreadAngle / 2 + t * spreadAngle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dist = Math.max(width, height) * 1.5;
    const ex = srcX + cos * dist;
    const ey = srcY + sin * dist;
    const w = 50 + (i % 2) * 30;
    const perpX = -sin * w;
    const perpY = cos * w;
    const x1 = srcX + perpX;
    const y1 = srcY + perpY;
    const x2 = srcX - perpX;
    const y2 = srcY - perpY;
    const x3 = ex - perpX;
    const y3 = ey - perpY;
    const x4 = ex + perpX;
    const y4 = ey + perpY;
    const gradId = 'rayg' + i;
    const opacity = 0.1 + (i % 2) * 0.05;
    gradientParts.push(`<linearGradient id="${gradId}" x1="${srcX}" y1="${srcY}" x2="${ex}" y2="${ey}"><stop offset="0%" stop-color="white" stop-opacity="${opacity}"/><stop offset="50%" stop-color="white" stop-opacity="${opacity * 0.4}"/><stop offset="100%" stop-color="white" stop-opacity="0"/></linearGradient>`);
    rayParts.push(`<polygon points="${srcX},${srcY} ${x1},${y1} ${x3},${y3} ${x4},${y4} ${x2},${y2}" fill="url(#${gradId})"/>`);
  }
  const baseGrad = '<linearGradient id="raybase" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="white" stop-opacity="0.1"/><stop offset="50%" stop-color="white" stop-opacity="0.02"/><stop offset="100%" stop-color="white" stop-opacity="0"/></linearGradient>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="rbf" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur in="SourceGraphic" stdDeviation="3"/></filter>${gradientParts.join('')}${baseGrad}</defs><rect width="100%" height="100%" fill="url(#raybase)"/><g filter="url(#rbf)">${rayParts.join('')}</g></svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

/** Partículas tipo nieve / copos */
function createParticlesSnowDataUrl(width = 1280, height = 720): string {
  const count = 80;
  const dots = Array.from({ length: count }, () => {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = 1 + Math.random() * 2;
    const opacity = 0.3 + Math.random() * 0.5;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="white" opacity="${opacity}"/>`;
  }).join('\n');
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${dots}
</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg.trim())));
}

/** Partículas tipo polvo / ceniza */
function createParticlesDustDataUrl(width = 1280, height = 720): string {
  const count = 60;
  const dots = Array.from({ length: count }, () => {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = 0.5 + Math.random() * 1.5;
    const opacity = 0.15 + Math.random() * 0.25;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(255,255,255,${opacity})"/>`;
  }).join('\n');
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${dots}
</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg.trim())));
}

/** Viñeta (oscurecimiento en esquinas) */
function createVignetteDataUrl(width = 1280, height = 720): string {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="vignette-grad" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="black" stop-opacity="0"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.6"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#vignette-grad)"/>
</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg.trim())));
}

/** Luz suave / glow en centro */
function createGlowDataUrl(width = 1280, height = 720): string {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="glow-grad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="white" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#glow-grad)"/>
</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg.trim())));
}

/** Light leak (filtro de luz de película) */
function createLightLeakDataUrl(width = 1280, height = 720): string {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="leak1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff9966" stop-opacity="0"/>
      <stop offset="100%" stop-color="#ff6633" stop-opacity="0.25"/>
    </linearGradient>
    <linearGradient id="leak2" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffcc99" stop-opacity="0"/>
      <stop offset="100%" stop-color="#ff9966" stop-opacity="0.2"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#leak1)"/>
  <rect width="100%" height="100%" fill="url(#leak2)"/>
</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg.trim())));
}

/** Grano de película (ruido fino cinematográfico) */
function createFilmGrainDataUrl(width = 1280, height = 720): string {
  const size = Math.min(width, height);
  const count = Math.floor((size / 4) * (size / 4));
  const dots = Array.from({ length: count }, () => {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = 0.3 + Math.random() * 0.5;
    const opacity = 0.03 + Math.random() * 0.08;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="white" opacity="${opacity}"/>`;
  }).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${dots}</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg.trim())));
}

/** Bokeh: círculos de luz suaves (desenfoque de luces) */
function createBokehDataUrl(width = 1280, height = 720): string {
  const circles = [
    { cx: width * 0.2, cy: height * 0.25, r: width * 0.08, opacity: 0.12 },
    { cx: width * 0.8, cy: height * 0.2, r: width * 0.06, opacity: 0.1 },
    { cx: width * 0.75, cy: height * 0.7, r: width * 0.07, opacity: 0.08 },
    { cx: width * 0.15, cy: height * 0.65, r: width * 0.05, opacity: 0.1 },
    { cx: width * 0.5, cy: height * 0.15, r: width * 0.04, opacity: 0.06 },
    { cx: width * 0.9, cy: height * 0.5, r: width * 0.05, opacity: 0.07 },
    { cx: width * 0.1, cy: height * 0.5, r: width * 0.04, opacity: 0.05 },
  ];
  const defs = `
  <defs>
    <radialGradient id="bokeh-g" cx="30%" cy="30%" r="50%">
      <stop offset="0%" stop-color="white" stop-opacity="1"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </radialGradient>
  </defs>`;
  const circlesSvg = circles.map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="url(#bokeh-g)" opacity="${c.opacity}"/>`).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defs}${circlesSvg}</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg.trim())));
}

/** Hora dorada: gradiente cálido desde esquina */
function createGoldenHourDataUrl(width = 1280, height = 720): string {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="golden-g" cx="100%" cy="0%" r="90%">
      <stop offset="0%" stop-color="#ffd700" stop-opacity="0"/>
      <stop offset="60%" stop-color="#ffb347" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#ff8c00" stop-opacity="0.18"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#golden-g)"/>
</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg.trim())));
}

/** Tono frío: overlay azul suave */
function createCoolTintDataUrl(width = 1280, height = 720): string {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="cool-g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a8d4ff" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#6eb5ff" stop-opacity="0.12"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#cool-g)"/>
</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg.trim())));
}

/** Destello de lente suave */
function createLensFlareDataUrl(width = 1280, height = 720): string {
  const cx = width * 0.75;
  const cy = height * 0.3;
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="flare-g" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="white" stop-opacity="0.4"/>
      <stop offset="70%" stop-color="white" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${width * 0.15}" fill="url(#flare-g)"/>
  <circle cx="${cx + width * 0.08}" cy="${cy - height * 0.05}" r="${width * 0.04}" fill="white" opacity="0.25"/>
</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg.trim())));
}

/** Brillo onírico / soft dream (centro iluminado suave) */
function createSoftDreamDataUrl(width = 1280, height = 720): string {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="dream-g" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="white" stop-opacity="0.25"/>
      <stop offset="50%" stop-color="white" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#dream-g)"/>
</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg.trim())));
}

/** Overlay cálido (naranja/dorado suave en bordes) */
function createGradientWarmDataUrl(width = 1280, height = 720): string {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="warm-g" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#ffeedd" stop-opacity="0"/>
      <stop offset="100%" stop-color="#ffaa55" stop-opacity="0.15"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#warm-g)"/>
</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg.trim())));
}

/** Overlay frío (azul/morado sutil en bordes) */
function createGradientCoolDataUrl(width = 1280, height = 720): string {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="cooledge-g" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#eef" stop-opacity="0"/>
      <stop offset="100%" stop-color="#5599dd" stop-opacity="0.12"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#cooledge-g)"/>
</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg.trim())));
}

export const SLIDE_EFFECTS: SlideEffect[] = [
  {
    id: 'vignette',
    name: 'Viñeta cinematográfica',
    description: 'Oscurecimiento suave en las esquinas, estilo cine',
    getDataUrl: createVignetteDataUrl,
  },
  {
    id: 'glow',
    name: 'Luz suave',
    description: 'Resplandor suave en el centro',
    getDataUrl: createGlowDataUrl,
  },
  {
    id: 'film-grain',
    name: 'Grano de película',
    description: 'Ruido fino cinematográfico',
    getDataUrl: createFilmGrainDataUrl,
  },
  {
    id: 'bokeh',
    name: 'Bokeh',
    description: 'Círculos de luz suaves (desenfoque de luces)',
    getDataUrl: createBokehDataUrl,
  },
  {
    id: 'golden-hour',
    name: 'Hora dorada',
    description: 'Tono cálido dorado desde la esquina',
    getDataUrl: createGoldenHourDataUrl,
  },
  {
    id: 'cool-tint',
    name: 'Tono frío',
    description: 'Overlay azul suave',
    getDataUrl: createCoolTintDataUrl,
  },
  {
    id: 'lens-flare',
    name: 'Destello de lente',
    description: 'Reflejo de luz suave tipo objetivo',
    getDataUrl: createLensFlareDataUrl,
  },
  {
    id: 'soft-dream',
    name: 'Brillo onírico',
    description: 'Centro iluminado suave, efecto sueño',
    getDataUrl: createSoftDreamDataUrl,
  },
  {
    id: 'gradient-warm',
    name: 'Overlay cálido',
    description: 'Bordes en tono naranja/dorado',
    getDataUrl: createGradientWarmDataUrl,
  },
  {
    id: 'gradient-cool',
    name: 'Overlay frío',
    description: 'Bordes en tono azul suave',
    getDataUrl: createGradientCoolDataUrl,
  },
  {
    id: 'light-leak',
    name: 'Light leak',
    description: 'Filtro de luz tipo película analógica',
    getDataUrl: createLightLeakDataUrl,
  },
  {
    id: 'rays',
    name: 'Rayos de luz',
    description: 'Rayos volumétricos realistas desde una esquina (tipo sol)',
    getDataUrl: createRaysDataUrl,
  },
  {
    id: 'particles-snow',
    name: 'Partículas (nieve)',
    description: 'Copos o partículas blancas flotantes',
    getDataUrl: createParticlesSnowDataUrl,
  },
  {
    id: 'particles-dust',
    name: 'Partículas (polvo)',
    description: 'Polvo o ceniza sutil',
    getDataUrl: createParticlesDustDataUrl,
  },
];

export function getSlideEffect(id: SlideEffectId | string): SlideEffect | undefined {
  const custom = customEffectsRegistry.get(id);
  if (custom) return custom;
  return SLIDE_EFFECTS.find((e) => e.id === id);
}

/** Efectos personalizados (imagen, vídeo, gif) creados por el usuario */
const customEffectsRegistry = new Map<string, SlideEffect>();

export function registerCustomEffect(effect: SlideEffect): void {
  customEffectsRegistry.set(effect.id, effect);
}

export function unregisterCustomEffect(id: string): void {
  customEffectsRegistry.delete(id);
}

export function getCustomEffects(): SlideEffect[] {
  return Array.from(customEffectsRegistry.values());
}

export function getAllEffects(): SlideEffect[] {
  return [...SLIDE_EFFECTS, ...getCustomEffects()];
}

const STORAGE_KEY = 'zeus-custom-effects';

export function loadCustomEffectsFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw) as { id: string; name: string; dataUrl: string }[];
    arr.forEach(({ id, name, dataUrl }) => {
      registerCustomEffect({
        id,
        name,
        description: 'Efecto personalizado',
        getDataUrl: () => dataUrl,
      });
    });
  } catch (_) {}
}

/** Genera efecto personalizado desde archivo (imagen, vídeo o GIF). Usa callback porque video necesita capturar frame. */
export function createCustomEffectFromFile(
  file: File,
  name: string,
  onReady: (effect: SlideEffect) => void,
  onError: (err: string) => void
): void {
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const type = file.type;

  const finishWithDataUrl = async (dataUrl: string) => {
    const effect: SlideEffect = {
      id,
      name: name || file.name.replace(/\.[^/.]+$/, ''),
      description: 'Efecto personalizado',
      getDataUrl: () => dataUrl,
    };
    
    // Guardar el archivo original en la carpeta local "efectos"
    try {
      // Obtener la carpeta de efectos del usuario
      const userId = (globalThis as any).pb?.authStore?.model?.id;
      if (!userId) {
        console.warn('No hay usuario autenticado, guardando solo en memoria');
        registerCustomEffect(effect);
        onReady(effect);
        return;
      }

      const paths = await getLocalPaths();
      const effectsFolder = paths.efectos;

      if (effectsFolder) {
        const destPath = `${effectsFolder}\\${file.name}`;
        const sourcePath = getFilePath(file);
        if (sourcePath) {
          await copyFile(sourcePath, destPath);
        } else {
          const buffer = new Uint8Array(await file.arrayBuffer());
          await writeFile(destPath, buffer);
        }
        console.log('Efecto guardado en carpeta local:', effect.name);
      } else {
        console.warn('No se pudo guardar el efecto en carpeta local, guardando solo en memoria');
      }
    } catch (error) {
      console.warn('Error al guardar efecto en carpeta local, guardando solo en memoria:', error);
    }
    
    // Siempre registrar en memoria para uso inmediato
    registerCustomEffect(effect);
    onReady(effect);
  };

  if (type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = () => {
      finishWithDataUrl(reader.result as string);
    };
    reader.onerror = () => onError('No se pudo leer el archivo');
    reader.readAsDataURL(file);
    return;
  }

  if (type.startsWith('video/') || type === 'image/gif') {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.onloadeddata = () => {
      video.currentTime = 0;
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        return onError('No se pudo crear el canvas');
      }
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      URL.revokeObjectURL(url);
      video.src = '';
      finishWithDataUrl(dataUrl);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      if (type === 'image/gif') {
        const reader = new FileReader();
        reader.onload = () => finishWithDataUrl(reader.result as string);
        reader.onerror = () => onError('No se pudo leer el GIF');
        reader.readAsDataURL(file);
      } else {
        onError('No se pudo cargar el vídeo');
      }
    };
    video.src = url;
    video.load();
    return;
  }

  onError('Formato no soportado. Usa imagen, GIF o vídeo.');
}

export function saveCustomEffectsToStorage(): void {
  try {
    const effects = getSerializableCustomEffects();
    const dataStr = JSON.stringify(effects);
    
    // Verificar tamaño antes de guardar
    const dataSize = new Blob([dataStr]).size;
    const quotaLimit = 4 * 1024 * 1024; // 4MB límite aproximado
    
    if (dataSize > quotaLimit) {
      // Si excede el límite, eliminar efectos más antiguos hasta que quepa
      const effects = getCustomEffects();
      let trimmedEffects = [...effects];
      
      while (trimmedEffects.length > 0) {
        // Eliminar el efecto más antiguo
        trimmedEffects.shift();
        
        const serializable = trimmedEffects.map((e) => ({
          id: e.id,
          name: e.name,
          dataUrl: e.getDataUrl(1280, 720),
        }));
        
        const trimmedData = JSON.stringify(serializable);
        if (new Blob([trimmedData]).size <= quotaLimit) {
          localStorage.setItem(STORAGE_KEY, trimmedData);
          
          // Actualizar el registro para eliminar los efectos recortados
          const currentEffects = getCustomEffects();
          currentEffects.forEach(effect => {
            if (!trimmedEffects.find(e => e.id === effect.id)) {
              unregisterCustomEffect(effect.id);
            }
          });
          
          console.warn(`Se eliminaron ${effects.length - trimmedEffects.length} efectos antiguos por límite de almacenamiento`);
          return;
        }
      }
      
      // Si aún no cabe, guardar vacío
      localStorage.setItem(STORAGE_KEY, '[]');
      console.warn('Todos los efectos personalizados fueron eliminados por límite de almacenamiento');
      return;
    }
    
    localStorage.setItem(STORAGE_KEY, dataStr);
  } catch (error: any) {
    if (error.name === 'QuotaExceededError') {
      // Limpiar todos los efectos personalizados
      localStorage.setItem(STORAGE_KEY, '[]');
      clearCustomEffects();
      console.warn('Se eliminaron todos los efectos personalizados por límite de almacenamiento');
    } else {
      throw error;
    }
  }
}

/** Devuelve los efectos personalizados como array serializable para guardar en proyecto */
export function getSerializableCustomEffects(): { id: string; name: string; dataUrl: string }[] {
  return getCustomEffects().map((e) => ({
    id: e.id,
    name: e.name,
    dataUrl: e.getDataUrl(1280, 720),
  }));
}

/** Restaura efectos personalizados desde datos de proyecto (al cargar .Zeus o PocketBase) */
export function loadCustomEffectsFromProjectData(effects: { id: string; name: string; dataUrl: string }[]): void {
  if (!Array.isArray(effects)) return;
  clearCustomEffects();
  if (effects.length === 0) return;
  effects.forEach(({ id, name, dataUrl }) => {
    if (id && name && dataUrl) {
      registerCustomEffect({
        id,
        name,
        description: 'Efecto personalizado',
        getDataUrl: () => dataUrl,
      });
    }
  });
  saveCustomEffectsToStorage();
}

export function removeCustomEffectAndSave(id: string): void {
  unregisterCustomEffect(id);
  saveCustomEffectsToStorage();
}

export function clearCustomEffects(): void {
  customEffectsRegistry.clear();
  localStorage.removeItem(STORAGE_KEY);
}
