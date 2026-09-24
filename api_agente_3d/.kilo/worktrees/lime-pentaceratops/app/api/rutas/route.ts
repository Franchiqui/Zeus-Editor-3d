import { NextResponse } from 'next/server';
import { PB_COLLECTIONS, getAuthedPocketBase } from '@/lib/pb-api';
import { RUTAS_FIELDS } from '@/lib/collections';
import fs from 'fs';
import path from 'path';

// Extensiones permitidas por categoría
const EXTENSIONS = {
  video: ['.mp4', '.webm', '.ogg', '.mov', '.avi'],
  imagen: ['.jpg', '.jpeg', '.png', '.webp', '.svg'],
  audio: ['.mp3', '.wav', '.ogg', '.aac', '.flac'],
  gif: ['.gif'],
  documentos: ['.txt', '.pdf', '.doc', '.docx', '.md'],
  efectos: ['.png', '.jpg', '.jpeg', '.gif', '.mp4', '.webm', '.mov', '.avi'], // Efectos personalizados (imágenes y vídeos)
  proyectos: [] // Los proyectos se listarán como carpetas
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user');
    const category = searchParams.get('category') as keyof typeof EXTENSIONS | null;

    if (!userId) {
      return NextResponse.json({ error: 'ID de usuario requerido' }, { status: 400 });
    }

    const pb = await getAuthedPocketBase();

    // 1. Obtener las rutas configuradas para este usuario
    let record;
    try {
      record = await pb.collection(PB_COLLECTIONS.RUTAS || 'rutas').getFirstListItem(`user="${userId}"`);
    } catch (e) {
      // Si no existe el registro de rutas, devolvemos lista vacía
      return NextResponse.json({ files: [], paths: {} });
    }

    // 2. Si se pide una categoría específica, leemos esa carpeta
    if (category && record[category]) {
      const folderPath = record[category];
      
      // Verificamos si la carpeta existe
      if (!fs.existsSync(folderPath)) {
        console.warn(`Aviso: La ruta local ${folderPath} no es accesible desde este servidor.`);
        return NextResponse.json({ 
          files: [], 
          paths: record,
          warning: "Ruta local no accesible en entorno web" 
        });
      }

      const items = fs.readdirSync(folderPath);

      // Lógica específica para proyectos (listar subcarpetas)
      if (category === 'proyectos') {
        const projects = items
          .map(item => {
            const fullPath = path.join(folderPath, item);
            const stats = fs.statSync(fullPath);
            if (stats.isDirectory()) {
              return {
                id: `local-project-${Buffer.from(fullPath).toString('base64')}`,
                titulo: item,
                path: fullPath,
                tipo: 'local_project',
                isLocal: true,
                created: stats.mtime
              };
            }
            return null;
          })
          .filter(Boolean);

        return NextResponse.json({ projects, paths: record });
      }

      const allowedExts = EXTENSIONS[category];
      const filteredFiles = items
        .filter(file => allowedExts.includes(path.extname(file).toLowerCase()))
        .map(file => {
          const fullPath = path.join(folderPath, file);
          const stats = fs.statSync(fullPath);
          return {
            id: `local-${Buffer.from(fullPath).toString('base64')}`,
            name: file,
            path: fullPath,
            size: stats.size,
            type: category,
            isLocal: true,
            uploadedAt: stats.mtime
          };
        });

      return NextResponse.json({ files: filteredFiles, paths: record });
    }

    return NextResponse.json({ paths: record, files: [] });
  } catch (error) {
    console.error('Error en API de rutas:', error);
    return NextResponse.json({ error: 'Error al procesar las rutas locales' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { user, category, path: newPath } = body;

    if (!user || !category || !newPath) {
      return NextResponse.json({ error: 'Faltan campos obligatorios' }, { status: 400 });
    }

    const pb = await getAuthedPocketBase();

    // Verificar si ya existe un registro para este usuario
    let record;
    try {
      record = await pb.collection(PB_COLLECTIONS.RUTAS || 'rutas').getFirstListItem(`user="${user}"`);
      record = await pb.collection(PB_COLLECTIONS.RUTAS || 'rutas').update(record.id, {
        [category]: newPath
      });
    } catch (e) {
      record = await pb.collection(PB_COLLECTIONS.RUTAS || 'rutas').create({
        user,
        [category]: newPath
      });
    }

    return NextResponse.json({ success: true, record });
  } catch (error) {
    console.error('Error guardando ruta:', error);
    return NextResponse.json({ error: 'No se pudo guardar la ruta' }, { status: 500 });
  }
}
