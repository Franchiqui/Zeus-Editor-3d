import { NextResponse } from 'next/server';
import { PB_COLLECTIONS, getAuthedPocketBase } from '@/lib/pb-api';
import fs from 'fs';
import path from 'path';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '100mb', // Ampliamos al máximo posible
    },
  },
};

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const userId = formData.get('userId') as string;
    const category = formData.get('category') as string;

    if (!file || !userId || !category) {
      return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
    }

    const pb = await getAuthedPocketBase();

    const record = await pb.collection(PB_COLLECTIONS.RUTAS || 'rutas').getFirstListItem(`user="${userId}"`);
    const targetFolder = record[category];

    if (!targetFolder || !fs.existsSync(targetFolder)) {
      return NextResponse.json({ error: 'Ruta local no accesible' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const targetPath = path.join(targetFolder, file.name);
    
    fs.writeFileSync(targetPath, buffer);

    return NextResponse.json({ success: true, path: targetPath });
  } catch (error) {
    console.error('Error en upload:', error);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
