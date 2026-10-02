'use client';

export interface OverlayObjectAsset {
  id: string;
  name: string;
  dataUrl: string;
  mediaType: 'png' | 'gif' | 'video';
}

const STORAGE_KEY = 'zeus-overlay-objects';
const objectRegistry = new Map<string, OverlayObjectAsset>();

export function registerOverlayObject(asset: OverlayObjectAsset): void {
  objectRegistry.set(asset.id, asset);
}

export function unregisterOverlayObject(id: string): void {
  objectRegistry.delete(id);
}

export function getOverlayObjects(): OverlayObjectAsset[] {
  return Array.from(objectRegistry.values());
}

export function getOverlayObject(id: string): OverlayObjectAsset | undefined {
  return objectRegistry.get(id);
}

export function saveOverlayObjectsToStorage(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getSerializableOverlayObjects()));
  } catch (e) {
    // Los vídeos como data URL pueden exceder la cuota de localStorage (~5MB).
    // El objeto sigue registrado en memoria (funciona en la sesión actual y se
    // guarda dentro del proyecto .zeus); solo no persiste entre sesiones.
    console.warn('No se pudieron guardar los objetos en localStorage (cuota excedida?):', e);
  }
}

export function getSerializableOverlayObjects(): OverlayObjectAsset[] {
  return getOverlayObjects().map((asset) => ({
    id: asset.id,
    name: asset.name,
    dataUrl: asset.dataUrl,
    mediaType: asset.mediaType,
  }));
}

export function clearOverlayObjects(): void {
  objectRegistry.clear();
  localStorage.removeItem(STORAGE_KEY);
}

export function loadOverlayObjectsFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const assets = JSON.parse(raw) as OverlayObjectAsset[];
    assets.forEach((asset) => {
      if (asset?.id && asset?.name && asset?.dataUrl) {
        registerOverlayObject(asset);
      }
    });
  } catch (_) {}
}

export function loadOverlayObjectsFromProjectData(assets: OverlayObjectAsset[]): void {
  if (!Array.isArray(assets)) return;
  clearOverlayObjects();
  assets.forEach((asset) => {
    if (asset?.id && asset?.name && asset?.dataUrl) {
      registerOverlayObject(asset);
    }
  });
  saveOverlayObjectsToStorage();
}

export function removeOverlayObjectAndSave(id: string): void {
  unregisterOverlayObject(id);
  saveOverlayObjectsToStorage();
}

export function createOverlayObjectFromFile(
  file: File,
  name: string,
  onReady: (asset: OverlayObjectAsset) => void,
  onError: (message: string) => void
): void {
  const normalizedType =
    file.type === 'image/gif' ? 'gif' :
    file.type === 'image/png' ? 'png' :
    file.type === 'video/mp4' || file.type === 'video/webm' || file.type === 'video/quicktime' || /\.(mp4|webm|mov|m4v)$/i.test(file.name) ? 'video' :
    null;
  if (!normalizedType) {
    onError('Formato no soportado. Usa PNG, GIF o vídeo (MP4, WebM o MOV).');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const asset: OverlayObjectAsset = {
      id: `object-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name || file.name.replace(/\.[^/.]+$/, ''),
      dataUrl: reader.result as string,
      mediaType: normalizedType,
    };
    registerOverlayObject(asset);
    saveOverlayObjectsToStorage();
    onReady(asset);
  };
  reader.onerror = () => onError('No se pudo leer el archivo');
  reader.readAsDataURL(file);
}
