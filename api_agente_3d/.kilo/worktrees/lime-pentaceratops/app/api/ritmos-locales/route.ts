import { NextResponse } from 'next/server';
import { POCKETBASE_EMAIL, POCKETBASE_PASSWORD, getAuthedPocketBase } from '@/lib/pb-api';

const COLLECTION_NAME = 'ritmos_locales';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const user = searchParams.get('user');
    if (!user) return NextResponse.json({ records: [] });

    if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
      return NextResponse.json({ error: 'Credenciales de PocketBase no configuradas' }, { status: 500 });
    }

    const pb = await getAuthedPocketBase();
    
    const records = await pb.collection(COLLECTION_NAME).getFullList({ 
      filter: `user = "${user}"`
    });

    return NextResponse.json({ records }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Error leyendo ritmos', details: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.user) return NextResponse.json({ error: 'User ID requerido' }, { status: 400 });

    const pb = await getAuthedPocketBase();
    
    const record = await pb.collection(COLLECTION_NAME).create(body);
    return NextResponse.json({ success: true, record }, { status: 201 });
  } catch (error: any) {
    console.error('Error creando ritmo:', error);
    return NextResponse.json({ 
      error: 'Error creando ritmo', 
      details: error.message,
      data: error.data // Esto nos dirá qué campos fallan
    }, { status: error.status || 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, ...data } = body;
    if (!id) return NextResponse.json({ error: 'ID requerido' }, { status: 400 });

    const pb = await getAuthedPocketBase();
    
    const record = await pb.collection(COLLECTION_NAME).update(id, data);
    return NextResponse.json({ success: true, record }, { status: 200 });
  } catch (error: any) {
    console.error('Error actualizando ritmo:', error);
    return NextResponse.json({ 
      error: 'Error actualizando ritmo', 
      details: error.message,
      data: error.data 
    }, { status: error.status || 500 });
  }
}
