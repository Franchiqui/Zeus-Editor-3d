import PocketBase from 'pocketbase';
import { NextResponse } from 'next/server';
import { POCKETBASE_EMAIL, POCKETBASE_PASSWORD, PB_COLLECTIONS, getAuthedPocketBase } from '@/lib/pb-api';
import { MODELOS_FIELDS } from '@/lib/collections';

/** Campos permitidos al crear/actualizar (esquema colección modelos) */
const ALLOWED_FIELDS = [
  MODELOS_FIELDS.PROVEEDOR,
  MODELOS_FIELDS.NOMBRE_MODELO,
  MODELOS_FIELDS.ID_MODELO,
  MODELOS_FIELDS.CLAVE_API,
  MODELOS_FIELDS.URL,
  MODELOS_FIELDS.MAX_TOKEN,
  MODELOS_FIELDS.TEMPERATURA,
  MODELOS_FIELDS.USER,
  MODELOS_FIELDS.IS_VISION,
] as const;

function pickModelPayload(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
      out[key] = body[key];
    }
  }
  return out;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const nombre = body?.[MODELOS_FIELDS.NOMBRE_MODELO];
    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
      return NextResponse.json({ error: 'nombre_modelo es obligatorio' }, { status: 400 });
    }

    if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
      return NextResponse.json({ error: 'Credenciales de PocketBase no configuradas' }, { status: 500 });
    }

    const pb = await getAuthedPocketBase();
    const payload = pickModelPayload(body);
    const record = await pb.collection(PB_COLLECTIONS.MODELOS).create(payload);

    return NextResponse.json({ success: true, record }, { status: 201 });
  } catch (error) {
    console.error('Error creando modelo:', error);
    return NextResponse.json(
      { error: 'No se pudo guardar el modelo', details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const user = searchParams.get('user');

    if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
      return NextResponse.json({ error: 'Credenciales de PocketBase no configuradas' }, { status: 500 });
    }

    const pb = await getAuthedPocketBase();
    
    // Si no hay ID de usuario, devolvemos lista vacía para que no se vean modelos de otros
    if (!user) {
      return NextResponse.json({ records: [] }, { status: 200 });
    }

    // Usamos un filtro más robusto por si el campo es una relación
    const filter = `user = "${user}" || user.id = "${user}"`;
    const records = await pb.collection(PB_COLLECTIONS.MODELOS).getFullList({ 
      sort: '-created',
      filter
    });

    return NextResponse.json({ records }, { status: 200 });
  } catch (error) {
    console.error('Error leyendo modelos:', error);
    return NextResponse.json({ error: 'No se pudieron recuperar los modelos', details: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = typeof body?.id === 'string' ? body.id : undefined;
    if (!id) {
      return NextResponse.json({ error: 'id del modelo es obligatorio' }, { status: 400 });
    }

    if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
      return NextResponse.json({ error: 'Credenciales de PocketBase no configuradas' }, { status: 500 });
    }

    const pb = await getAuthedPocketBase();
    const payload = pickModelPayload(body);
    delete (payload as Record<string, unknown>).id;
    const record = await pb.collection(PB_COLLECTIONS.MODELOS).update(id, payload);

    return NextResponse.json({ success: true, record }, { status: 200 });
  } catch (error) {
    console.error('Error actualizando modelo:', error);
    return NextResponse.json(
      { error: 'No se pudo actualizar el modelo', details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const modelId = body?.id;
    if (!modelId) {
      return NextResponse.json({ error: 'ID del modelo requerido' }, { status: 400 });
    }

    if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
      return NextResponse.json({ error: 'Credenciales de PocketBase no configuradas' }, { status: 500 });
    }

    const pb = await getAuthedPocketBase();
    await pb.collection(PB_COLLECTIONS.MODELOS).delete(modelId);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error eliminando modelo:', error);
    return NextResponse.json({ error: 'No se pudo eliminar el modelo', details: (error as Error).message }, { status: 500 });
  }
}
