import { NextResponse } from 'next/server';
import { PB_COLLECTIONS, getAuthedPocketBase } from '@/lib/pb-api';

const REMOVE_BG_ENDPOINT = 'https://api-quitar-fondo-imagen.onrender.com/remove-bg';

const respondWithImage = async (response: Response) => {
  const blob = await response.blob();
  const contentType = response.headers.get('content-type') || 'image/png';
  const headers = new Headers({ 'Content-Type': contentType });
  return new NextResponse(blob, { status: response.status, headers });
};

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('image_file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Se requiere un archivo de imagen' }, { status: 400 });
  }

  const pb = await getAuthedPocketBase();

  let removeBgResponse: Response;
  let tempRecord: any | null = null;

  try {
    tempRecord = await pb.collection(PB_COLLECTIONS.REMOVE_BG).create({ imagen: file });
    const filenames = Array.isArray(tempRecord.imagen) ? tempRecord.imagen : [tempRecord.imagen];
    const targetFile = filenames[0];
    if (!targetFile) {
      throw new Error('No se generó el archivo en PocketBase');
    }
    const imageUrl = pb.files.getURL(tempRecord, targetFile);
    const qs = new URLSearchParams({ image_url: imageUrl });
    removeBgResponse = await fetch(`${REMOVE_BG_ENDPOINT}?${qs.toString()}`);

    if (!removeBgResponse.ok) {
      const errorText = await removeBgResponse.text();
      return NextResponse.json(
        { error: errorText || 'remove-bg error' },
        { status: removeBgResponse.status }
      );
    }

    return await respondWithImage(removeBgResponse);
  } catch (error) {
    console.error('Error en /api/remove-bg:', error);
    return NextResponse.json({ error: 'No se pudo procesar la solicitud' }, { status: 500 });
  } finally {
    if (tempRecord) {
      try {
        await pb.collection(PB_COLLECTIONS.REMOVE_BG).delete(tempRecord.id);
      } catch (cleanupError) {
        console.warn('No se pudo eliminar el registro temporal de PocketBase:', cleanupError);
      }
    }
  }
}
