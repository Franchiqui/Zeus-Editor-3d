import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * Este endpoint permite al editor ver archivos locales como si fueran de internet.
 * La ruta del archivo viene codificada en base4 en el parámetro 'f'.
 * Soporta streaming para vídeos y audios grandes.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileBase64 = searchParams.get('f');

    if (!fileBase64) {
      return NextResponse.json({ error: 'Ruta de archivo no proporcionada' }, { status: 400 });
    }

    const filePath = Buffer.from(fileBase64, 'base64').toString('utf-8');

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'El archivo no existe en el disco', path: filePath }, { status: 404 });
    }

    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return NextResponse.json({ error: 'La ruta no corresponde a un archivo' }, { status: 400 });
    }

    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'application/octet-stream';

    const CONTENT_TYPES: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.md': 'text/markdown'
    };

    if (CONTENT_TYPES[ext]) {
      contentType = CONTENT_TYPES[ext];
    }

    // Para archivos multimedia, permitimos streaming (soporta Range requests)
    const range = request.headers.get('range');
    
    if (range && (contentType.startsWith('video/') || contentType.startsWith('audio/'))) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunksize = (end - start) + 1;
      
      const fileStream = fs.createReadStream(filePath, { start, end });
      
      // Convertimos el stream de Node a un stream compatible con Web (NextResponse)
      const webStream = new ReadableStream({
        start(controller) {
          fileStream.on('data', (chunk) => controller.enqueue(chunk));
          fileStream.on('end', () => controller.close());
          fileStream.on('error', (err) => controller.error(err));
        },
        cancel() {
          fileStream.destroy();
        }
      });

      return new NextResponse(webStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize.toString(),
          'Content-Type': contentType,
        },
      });
    }

    // Para archivos pequeños o que no sean vídeo/audio
    const fileBuffer = fs.readFileSync(filePath);
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });

  } catch (error) {
    console.error('Error sirviendo archivo local:', error);
    return NextResponse.json({ error: 'Error al leer el archivo' }, { status: 500 });
  }
}
