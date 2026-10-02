import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Catálogo de objetos 3D guardados como bloques [ZEUS_ACTION] en
 * public/OBJ_ZEUS_ACTION/. Cada archivo .txt contiene un bloque:
 *   [ZEUS_ACTION]{...json...}[/ZEUS_ACTION]
 *
 * GET                    → lista los objetos disponibles (nombre + descripción breve).
 * GET ?name=Taza          → devuelve el contenido del bloque [ZEUS_ACTION] sin tags
 *                           (JSON listo para parsear), para que el editor lo re-ejecute.
 */
const OBJ_ZEUS_ACTION_DIR = path.join(process.cwd(), 'public', 'OBJ_ZEUS_ACTION');

const ZEUS_ACTION_RE = /\[ZEUS_ACTION\]([\s\S]*?)\[\/ZEUS_ACTION\]/i;

function safeBasename(name: string): string {
  return path.basename(name, '.txt');
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const name = url.searchParams.get('name');

    if (name) {
      const filePath = path.join(OBJ_ZEUS_ACTION_DIR, `${safeBasename(name)}.txt`);
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        return NextResponse.json(
          { error: `No se encontró el objeto guardado "${name}"` },
          { status: 404 }
        );
      }
      const match = content.match(ZEUS_ACTION_RE);
      const raw = (match ? match[1] : content).trim();
      return NextResponse.json({ name: safeBasename(name), raw });
    }

    // Listar
    let entries;
    try {
      entries = await fs.readdir(OBJ_ZEUS_ACTION_DIR, { withFileTypes: true });
    } catch {
      return NextResponse.json({ objects: [] });
    }

    const objects = entries
      .filter((entry) => entry.isFile() && /\.txt$/i.test(entry.name))
      .map((entry) => ({
        name: safeBasename(entry.name),
        file: entry.name,
      }));

    return NextResponse.json({ objects });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 }
    );
  }
}
