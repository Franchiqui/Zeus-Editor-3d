import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const TEXTURAS_DIR = path.join(process.cwd(), 'Api-Font-Texture', 'Texturas');

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const resolvedParams = await params;
    const filePath = resolvedParams.path.join('/');
    const fullPath = path.join(TEXTURAS_DIR, filePath);
    
    // Security: ensure the file is within the Texturas directory
    const normalizedFullPath = path.normalize(fullPath);
    const normalizedTexturasDir = path.normalize(TEXTURAS_DIR);
    
    if (!normalizedFullPath.startsWith(normalizedTexturasDir)) {
      return NextResponse.json(
        { success: false, message: 'Acceso denegado' },
        { status: 403 }
      );
    }
    
    if (!fullPath.toLowerCase().endsWith('.svg')) {
      return NextResponse.json(
        { success: false, message: 'Solo se permiten archivos SVG' },
        { status: 400 }
      );
    }
    
    const content = await fs.readFile(fullPath, 'utf-8');
    
    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Error reading SVG file:', error);
    return NextResponse.json(
      { success: false, message: 'Archivo no encontrado' },
      { status: 404 }
    );
  }
}