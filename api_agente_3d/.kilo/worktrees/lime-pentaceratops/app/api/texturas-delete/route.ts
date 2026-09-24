import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const TEXTURAS_DIR = path.join(process.cwd(), 'Api-Font-Texture', 'Texturas');

export async function DELETE(request: Request) {
  try {
    const { fullPath } = await request.json();

    if (!fullPath || typeof fullPath !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Falta el nombre del archivo' },
        { status: 400 }
      );
    }

    // Security: resolve the path and ensure it stays within Texturas/
    const fullFilePath = path.join(TEXTURAS_DIR, fullPath);
    const normalizedFullPath = path.normalize(fullFilePath);
    const normalizedTexturasDir = path.normalize(TEXTURAS_DIR);

    if (!normalizedFullPath.startsWith(normalizedTexturasDir)) {
      return NextResponse.json(
        { success: false, message: 'Acceso denegado' },
        { status: 403 }
      );
    }

    if (!normalizedFullPath.toLowerCase().endsWith('.svg')) {
      return NextResponse.json(
        { success: false, message: 'Solo se permiten archivos SVG' },
        { status: 400 }
      );
    }

    // No borrar archivos de referencia
    const basename = path.basename(normalizedFullPath).toLowerCase();
    if (['ladrillo.svg', 'ladrillo-2.svg'].includes(basename)) {
      return NextResponse.json(
        { success: false, message: 'Esta textura está protegida y no se puede borrar' },
        { status: 403 }
      );
    }

    try {
      await fs.unlink(normalizedFullPath);
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        return NextResponse.json(
          { success: false, message: 'El archivo ya no existe' },
          { status: 404 }
        );
      }
      throw err;
    }

    return NextResponse.json({ success: true, message: 'Textura eliminada' });
  } catch (error) {
    console.error('Error deleting SVG file:', error);
    return NextResponse.json(
      { success: false, message: 'Error al borrar la textura' },
      { status: 500 }
    );
  }
}
