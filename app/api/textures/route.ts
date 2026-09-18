import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.bmp', '.tga', '.dds'];

function isImageFile(name: string): boolean {
  const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

interface TextureItem {
  name: string;
  path: string;
  category: string;
  isDirectory: boolean;
  size: number;
}

export async function GET() {
  const texturesDir = path.join(process.cwd(), 'public', 'Texturas');

  if (!fs.existsSync(texturesDir)) {
    return NextResponse.json({
      folder: 'public/Texturas',
      categories: [],
      items: [],
    });
  }

  const categories: string[] = [];
  const items: TextureItem[] = [];

  const entries = fs.readdirSync(texturesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      categories.push(entry.name);
      const subDir = path.join(texturesDir, entry.name);
      const subEntries = fs.readdirSync(subDir, { withFileTypes: true });
      for (const subEntry of subEntries) {
        if (!subEntry.isDirectory() && isImageFile(subEntry.name)) {
          const subPath = path.join(subDir, subEntry.name);
          const stats = fs.statSync(subPath);
          items.push({
            name: subEntry.name,
            path: `/Texturas/${entry.name}/${subEntry.name}`,
            category: entry.name,
            isDirectory: false,
            size: stats.size,
          });
        }
      }
    } else if (isImageFile(entry.name)) {
      const filePath = path.join(texturesDir, entry.name);
      const stats = fs.statSync(filePath);
      items.push({
        name: entry.name,
        path: `/Texturas/${entry.name}`,
        category: 'General',
        isDirectory: false,
        size: stats.size,
      });
    }
  }

  if (items.some((i) => i.category === 'General')) {
    categories.unshift('General');
  }

  const sortedItems = items.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    folder: 'public/Texturas',
    categories,
    items: sortedItems,
  });
}
