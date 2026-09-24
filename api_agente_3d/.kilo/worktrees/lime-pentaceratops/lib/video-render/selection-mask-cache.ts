// Cache compartido de imágenes de máscara (PNG alpha, res nativa) para la silueta
// cambiante por SAM2. Lo usan el nodo de export (SelectionMaskNode) y el overlay
// de preview (SelectionOverlay). media:// NECESITA crossOrigin='anonymous' para
// no taint el canvas (igual que el resto del editor).

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

// Ediciones de retoque EN MEMORIA (aún no volcadas a disco). Tienen PRIORIDAD
// sobre el PNG del disco: así el preview/export muestra el retoque en vivo sin
// persistirlo. Sólo se vuelcan a disco al confirmar ("Listo" / "Guardar proyecto");
// si se descartan, se borran los overrides y el disco (original) vuelve a mandar.
const overrides = new Map<string, HTMLImageElement>();

export function loadMaskImage(url: string): Promise<HTMLImageElement> {
  const ov = overrides.get(url);
  if (ov && ov.complete && ov.naturalWidth > 0) return Promise.resolve(ov);
  const cached = cache.get(url);
  if (cached && cached.complete && cached.naturalWidth > 0) return Promise.resolve(cached);
  const p = pending.get(url);
  if (p) return p;
  const pr = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { cache.set(url, img); pending.delete(url); resolve(img); };
    img.onerror = () => { pending.delete(url); reject(new Error('No se pudo cargar la máscara: ' + url)); };
    img.src = url;
  });
  pending.set(url, pr);
  return pr;
}

// Activa un override para una URL. La imagen puede estar aún decodificando: la
// activa al cargar para no mostrar el disco antiguo mientras tanto (mantiene el
// override anterior hasta que el nuevo está listo).
export function setMaskOverride(url: string, img: HTMLImageElement): void {
  const activate = () => { overrides.set(url, img); cache.delete(url); pending.delete(url); };
  if (img.complete && img.naturalWidth > 0) activate();
  else { img.onload = activate; img.onerror = () => {}; }
}

export function clearMaskOverride(url: string): void {
  overrides.delete(url);
  cache.delete(url);
  pending.delete(url);
}

export function clearAllMaskOverrides(): void {
  overrides.clear();
}

export function evictMaskImage(url: string): void {
  cache.delete(url);
  pending.delete(url);
}

export function clearMaskCache(): void {
  cache.clear();
  pending.clear();
  overrides.clear();
}