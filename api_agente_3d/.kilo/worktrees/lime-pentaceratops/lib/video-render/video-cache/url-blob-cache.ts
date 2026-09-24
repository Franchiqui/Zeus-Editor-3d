// Resuelve URLs de Zeus (media://, http(s)://, data:, blob:) a un Blob para alimentar
// mediabunny (BlobSource) y decodeAudioData. Cache LRU por tamaño total: los vídeos
// locales vía media:// pueden pesar cientos de MB; mantenemos unos pocos grandes.
//
// IMPORTANTE: no revocamos URLs blob: que no creamos nosotros (esas las gestiona
// fileCache del VideoEditor). Sólo revocamos las que creamos aquí como puente si
// hiciésemos fetch->blob: (raro: fetch ya devuelve un Blob, no hace falta crear URL).

interface CacheEntry {
  blob: Blob;
  size: number;
  lastUsed: number;
}

const MAX_TOTAL_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB
const MAX_ENTRIES = 16;

const cache = new Map<string, CacheEntry>();

async function fetchToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo descargar el medio (${res.status}): ${url}`);
  }
  return await res.blob();
}

function evictIfNeeded(): void {
  if (cache.size <= MAX_ENTRIES) return;
  let total = 0;
  for (const entry of cache.values()) total += entry.size;
  if (total <= MAX_TOTAL_BYTES && cache.size <= MAX_ENTRIES) return;

  // Evict by least-recently-used until under limits.
  const entries = Array.from(cache.entries()).sort(
    (a, b) => a[1].lastUsed - b[1].lastUsed,
  );
  for (const [key, entry] of entries) {
    if (cache.size <= MAX_ENTRIES && total <= MAX_TOTAL_BYTES) break;
    cache.delete(key);
    total -= entry.size;
  }
}

export const urlBlobCache = {
  async get(url: string): Promise<Blob> {
    if (!url) throw new Error("url vacía en urlBlobCache.get");

    const existing = cache.get(url);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.blob;
    }

    const blob = await fetchToBlob(url);
    cache.set(url, { blob, size: blob.size, lastUsed: Date.now() });
    evictIfNeeded();
    return blob;
  },

  /** Como get() pero devuelve también el arrayBuffer (para decodeAudioData). */
  async getArrayBuffer(url: string): Promise<ArrayBuffer> {
    const blob = await this.get(url);
    return await blob.arrayBuffer();
  },

  has(url: string): boolean {
    return cache.has(url);
  },

  clear(): void {
    cache.clear();
  },

  evict(url: string): void {
    cache.delete(url);
  },
};