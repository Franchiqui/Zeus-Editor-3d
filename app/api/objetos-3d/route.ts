import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { extractObj3dMesh, decimateMesh } from '@/lib/obj3d-thumbnails';

/**
 * Lista los objetos 3D guardados (.zeus) que el usuario haya metido en
 * public/Obj-3D. El modal "Objeto 3D" del editor los enseña (con una
 * miniatura 3D de su figura) y al pinchar uno lo crea en la escena.
 *
 * Aquí ya se lee y se parsea cada archivo, así que la respuesta incluye
 * la miniatura diezmada de cada figura: así el navegador no tiene que
 * bajarse los .zeus enteros (pesan megas) solo para pintar las tarjetas.
 * La malla completa solo se descarga al pinchar un archivo.
 *
 * Miniaturas en caché (clave = nombre, validada por mtime + tamaño):
 * reabrir el modal no tiene que releer ni re-diecimar megas de nuevo.
 */
const OBJETOS_DIR = path.join(process.cwd(), 'public', 'Obj-3D');

type ThumbCacheEntry = {
  mtimeMs: number;
  size: number;
  mesh: unknown;
};

// Por proceso: se vacía al reiniciar el dev server. El nombre es la clave
// (la carpeta es única), y mtime+size la validación de que el archivo no
// cambió. Además se persiste a disco, así que la primera apertura del
// modal también reutiliza las miniaturas de la ejecución anterior.
const thumbCache = new Map<string, ThumbCacheEntry>();
const CACHE_FILE = path.join(process.cwd(), '.next', 'cache', 'obj3d-thumbs.json');
let diskCacheLoaded = false;
let diskCacheDirty = false;

async function loadDiskCache() {
  if (diskCacheLoaded) return;
  diskCacheLoaded = true;
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [name, entry] of Object.entries(parsed)) {
        const e = entry as ThumbCacheEntry;
        if (e && typeof e.mtimeMs === 'number' && typeof e.size === 'number') {
          thumbCache.set(name, e);
        }
      }
    }
  } catch {
    // Sin caché anterior: se genera al vuelo y se guarda después
  }
}

function saveDiskCache() {
  if (!diskCacheDirty) return;
  diskCacheDirty = false;
  const data = JSON.stringify(Object.fromEntries(thumbCache), null, 2);
  fs.mkdir(path.dirname(CACHE_FILE), { recursive: true })
    .then(() => fs.writeFile(CACHE_FILE, data, 'utf-8'))
    .catch(() => {
      // La caché es best-effort: sin disco escribible se regenera siempre
    });
}

export async function GET() {
  try {
    await loadDiskCache();
    const entries = await fs.readdir(OBJETOS_DIR, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /\.zeus$/i.test(entry.name))
        .map(async (entry) => {
          let mesh = null;
          let size = 0;
          try {
            const fullPath = path.join(OBJETOS_DIR, entry.name);
            const stats = await fs.stat(fullPath);
            size = stats.size;
            const cached = thumbCache.get(entry.name);
            // Hit: el archivo no cambió desde la última vez → la miniatura
            // diezmada se reutiliza sin releer ni re-diecimar los megas.
            if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === size) {
              mesh = cached.mesh;
            } else {
              const content = await fs.readFile(fullPath, 'utf-8');
              const source = extractObj3dMesh(JSON.parse(content));
              if (source) {
                mesh = decimateMesh(source.mesh);
                thumbCache.set(entry.name, { mtimeMs: stats.mtimeMs, size, mesh });
                diskCacheDirty = true;
              }
            }
          } catch {
            // Archivo ilegible: se lista igualmente, solo sin miniatura
          }
          return { name: entry.name, size, mesh };
        })
    );
    saveDiskCache();
    return NextResponse.json({ files });
  } catch {
    // La carpeta todavía no existe (o no se puede leer): lista vacía
    return NextResponse.json({ files: [] });
  }
}