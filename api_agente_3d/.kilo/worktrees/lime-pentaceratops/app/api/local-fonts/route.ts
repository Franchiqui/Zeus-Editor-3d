import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const API_FONT_TEXTURE_DIR = path.join(process.cwd(), 'Api-Font-Texture');

export async function GET() {
  try {
    // Get local paths to find the fuentes folder
    const localPathsResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003'}/api/local-paths`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => null);
    
    let fuentesFolder = path.join(API_FONT_TEXTURE_DIR, 'fonts');
    
    if (localPathsResponse?.ok) {
      const data = await localPathsResponse.json();
      if (data.fuentes) {
        fuentesFolder = data.fuentes;
      }
    }
    
    // List TTF/OTF files in the fuentes folder
    const fonts: any[] = [];
    try {
      const entries = await fs.readdir(fuentesFolder, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isFile() && /\.(ttf|otf)$/i.test(entry.name)) {
          const fullPath = path.join(fuentesFolder, entry.name);
          const stats = await fs.stat(fullPath);
          
          fonts.push({
            id: `local-${entry.name}-${stats.mtimeMs}`,
            name: entry.name.replace(/\.[^/.]+$/, ''),
            family: entry.name.replace(/\.[^/.]+$/, ''),
            style: 'Display',
            previewText: 'Sample Text',
            path: fullPath,
            size: stats.size,
            modified: stats.mtime.toISOString(),
          });
        }
      }
    } catch (e) {
      console.log('Fuentes folder not found or empty:', fuentesFolder);
    }
    
    return NextResponse.json({ fonts });
  } catch (error) {
    console.error('Error listing local fonts:', error);
    return NextResponse.json({ fonts: [] });
  }
}