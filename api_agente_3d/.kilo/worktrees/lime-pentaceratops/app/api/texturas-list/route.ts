import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const TEXTURAS_DIR = path.join(process.cwd(), 'Api-Font-Texture', 'Texturas');

async function findSvgFiles(dir: string, baseDir: string): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      
      if (entry.isDirectory()) {
        const subFiles = await findSvgFiles(fullPath, baseDir);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.svg')) {
        files.push(relativePath.split(path.sep).join('/'));
      }
    }
  } catch (error) {
    console.error('Error reading Texturas directory:', error);
  }
  
  return files.sort();
}

export async function GET() {
  try {
    const svgFiles = await findSvgFiles(TEXTURAS_DIR, TEXTURAS_DIR);
    
    const fileDetails = await Promise.all(
      svgFiles.map(async (relPath) => {
        const fullPath = path.join(TEXTURAS_DIR, relPath);
        try {
          const stats = await fs.stat(fullPath);
          const content = await fs.readFile(fullPath, 'utf-8');
          
          // Extract viewBox from SVG
          const viewBoxMatch = content.match(/viewBox\s*=\s*["']([^"']+)["']/i);
          const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 100 100';
          
          return {
            path: relPath,
            name: path.basename(relPath, '.svg'),
            fullPath: relPath,
            size: stats.size,
            viewBox,
            modified: stats.mtime.toISOString(),
          };
        } catch {
          return {
            path: relPath,
            name: path.basename(relPath, '.svg'),
            fullPath: relPath,
            size: 0,
            viewBox: '0 0 100 100',
            modified: '',
          };
        }
      })
    );
    
    return NextResponse.json({ files: fileDetails });
  } catch (error) {
    console.error('Error listing SVG files:', error);
    return NextResponse.json(
      { success: false, message: 'Error al listar archivos SVG' },
      { status: 500 }
    );
  }
}