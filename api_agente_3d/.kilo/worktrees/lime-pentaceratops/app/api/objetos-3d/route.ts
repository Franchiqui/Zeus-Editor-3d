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
 */
const OBJETOS_DIR = path.join(process.cwd(), 'public', 'Obj-3D');

export async function GET() {
  try {
    const entries = await fs.readdir(OBJETOS_DIR, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /\.zeus$/i.test(entry.name))
        .map(async (entry) => {
          let mesh = null;
          let size = 0;
          try {
            const fullPath = path.join(OBJETOS_DIR, entry.name);
            const [stats, content] = await Promise.all([
              fs.stat(fullPath),
              fs.readFile(fullPath, 'utf-8'),
            ]);
            size = stats.size;
            const source = extractObj3dMesh(JSON.parse(content));
            if (source) mesh = decimateMesh(source.mesh);
          } catch {
            // Archivo ilegible: se lista igualmente, solo sin miniatura
          }
          return { name: entry.name, size, mesh };
        })
    );
    return NextResponse.json({ files });
  } catch {
    // La carpeta todavía no existe (o no se puede leer): lista vacía
    return NextResponse.json({ files: [] });
  }
}