import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const LOCAL_PATHS_FILE = path.join(process.cwd(), 'local-paths.json');

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath) {
      return NextResponse.json({ success: false, error: 'Missing path parameter' }, { status: 400 });
    }

    // Security: validate the file exists and is a font file
    const normalizedPath = path.normalize(filePath);
    if (!/\.(ttf|otf|woff|woff2)$/i.test(normalizedPath)) {
      return NextResponse.json({ success: false, error: 'Not a font file' }, { status: 400 });
    }

    // Check if file exists
    try {
      await fs.access(normalizedPath);
    } catch {
      return NextResponse.json({ success: false, error: 'Font file not found' }, { status: 404 });
    }

    // Serve the font binary for preview
    const data = await fs.readFile(normalizedPath);
    const ext = path.extname(normalizedPath).toLowerCase();
    const contentType =
      ext === '.woff2' ? 'font/woff2' :
      ext === '.woff' ? 'font/woff' :
      ext === '.otf' ? 'font/otf' :
      'font/ttf';
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error reading local font:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');
    const fontName = searchParams.get('name');
    
    if (!filePath) {
      return NextResponse.json({ success: false, error: 'Missing path parameter' }, { status: 400 });
    }
    
    // Security: validate the file exists and is a font file
    const normalizedPath = path.normalize(filePath);
    if (!/\.(ttf|otf|woff|woff2)$/i.test(normalizedPath)) {
      return NextResponse.json({ success: false, error: 'Not a font file' }, { status: 400 });
    }
    
    // Check if file exists
    try {
      await fs.access(normalizedPath);
    } catch {
      return NextResponse.json({ success: false, error: 'Font file not found' }, { status: 404 });
    }
    
    // Delete the file
    await fs.unlink(normalizedPath);
    
    return NextResponse.json({ success: true, message: `Font "${fontName || 'unknown'}" deleted` });
  } catch (error) {
    console.error('Error deleting local font:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}