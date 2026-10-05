import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Lista las imágenes de public/Texturas para el Explorador de Texturas.
 * Cada subcarpeta actúa como categoría; los archivos sueltos van en
 * «General». Las rutas devueltas son rutas públicas servibles
 * (/Texturas/<...>) que el navegador puede usar directamente como src.
 */

const TEXTURAS_DIR = path.join(process.cwd(), 'public', 'Texturas');

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.bmp', '.tga', '.dds'];

function isImageFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = name.substring(dot).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

export async function GET() {
  try {
    let entries: import('fs').Dirent<string>[];
    try {
      entries = await fs.readdir(TEXTURAS_DIR, { withFileTypes: true });
    } catch {
			// La carpeta puede no existir todavía: se responde vacía, el
			// explorador seguirá mostrando las texturas creadas por el usuario.
			return NextResponse.json({ folder: null, items: [], categories: [] });
		}

    const folders = entries.filter((e) => e.isDirectory());
    const rootFiles = entries.filter(
      (e) => e.isFile() && e.name.toLowerCase() !== 'thumbs.db' && isImageFile(e.name)
    );

    const items: { name: string; path: string; isDirectory: boolean; size: number; category: string }[] = [];
    const categories: string[] = [];

    if (folders.length > 0) {
      for (const dir of folders) {
        try {
          const sub = await fs.readdir(path.join(TEXTURAS_DIR, dir.name), { withFileTypes: true });
          for (const file of sub) {
            if (!file.isFile() || !isImageFile(file.name)) continue;
            const abs = path.join(TEXTURAS_DIR, dir.name, file.name);
            const stats = await fs.stat(abs);
            items.push({
              name: file.name,
              path: `/Texturas/${dir.name}/${file.name}`,
              isDirectory: false,
              size: stats.size,
              category: dir.name,
            });
          }
          categories.push(dir.name);
        } catch (e) {
          console.error(`Error leyendo subcarpeta ${dir.name}:`, e);
        }
      }
    }

    if (rootFiles.length > 0) {
      for (const file of rootFiles) {
        const abs = path.join(TEXTURAS_DIR, file.name);
        const stats = await fs.stat(abs);
        items.push({
          name: file.name,
          path: `/Texturas/${file.name}`,
          isDirectory: false,
          size: stats.size,
          category: 'General',
        });
      }
      categories.unshift('General');
    }

    return NextResponse.json({
      folder: TEXTURAS_DIR,
      items,
      categories,
    });
  } catch (error) {
    console.error('Error listando texturas:', error);
    return NextResponse.json({ folder: null, items: [], categories: [] });
  }
}