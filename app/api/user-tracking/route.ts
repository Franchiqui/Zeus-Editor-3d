import { NextResponse } from 'next/server';
import PocketBase from 'pocketbase';
import { USERS_EDITOR_3D_COLLECTION_NAME, type UserEditor3DRecord } from '@/lib/collections';

function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return '';
}

async function getAdminPb() {
  const url =
    process.env.NEXT_PUBLIC_POCKETBASE_URL ||
    process.env.POCKETBASE_URL ||
    'http://127.0.0.1:8090';
  const pb = new PocketBase(url);
  const email = process.env.POCKETBASE_EMAIL;
  const password = process.env.POCKETBASE_PASSWORD;
  if (email && password) {
    await pb.admins.authWithPassword(email, password);
  }
  return pb;
}

export async function GET(request: Request) {
  try {
    const ip = getClientIP(request);
    if (!ip) {
      return NextResponse.json(
        { exists: false, error: 'No IP detected' },
        { status: 400 }
      );
    }

    const pb = await getAdminPb();
    const records = await pb
      .collection(USERS_EDITOR_3D_COLLECTION_NAME)
      .getFullList<UserEditor3DRecord>({
        filter: `IP = "${ip}"`,
      });

    if (records.length > 0) {
      const user = records[0];
      await pb
        .collection(USERS_EDITOR_3D_COLLECTION_NAME)
        .update(user.id, {
          veces_conectado: (user.veces_conectado || 0) + 1,
        });
      return NextResponse.json({ exists: true, user });
    }

    return NextResponse.json({ exists: false, ip });
  } catch (e) {
    console.error('[user-tracking] GET error:', e);
    return NextResponse.json(
      { exists: false, error: String(e) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { name } = await request.json();
    const ip = getClientIP(request);
    if (!ip) {
      return NextResponse.json(
        { success: false, error: 'No IP detected' },
        { status: 400 }
      );
    }

    const pb = await getAdminPb();
    const record = await pb
      .collection(USERS_EDITOR_3D_COLLECTION_NAME)
      .create<UserEditor3DRecord>({
        IP: ip,
        name: name || '',
        veces_conectado: 1,
      });
    return NextResponse.json({ exists: true, user: record, isNew: true });
  } catch (e) {
    console.error('[user-tracking] POST error:', e);
    return NextResponse.json(
      { success: false, error: String(e) },
      { status: 500 }
    );
  }
}
