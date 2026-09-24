import { NextResponse } from 'next/server';

/**
 * Obtiene la lista de colecciones de PocketBase usando autenticación de admin.
 * Así se muestran todas las colecciones (incluidas las que crees tú), ya que
 * el cliente con usuario normal no tiene permiso para listar colecciones.
 */
export async function GET() {
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL || process.env.NEXT_PUBLIC_PB_URL || 'http://127.0.0.1:8090';
  const adminEmail = process.env.PB_ADMIN_EMAIL || process.env.NEXT_PUBLIC_POCKETBASE_EMAIL || process.env.POCKETBASE_EMAIL;
  const adminPassword = process.env.PB_ADMIN_PASSWORD || process.env.NEXT_PUBLIC_POCKETBASE_PASSWORD || process.env.POCKETBASE_PASSWORD;

  if (!adminEmail || !adminPassword) {
    return NextResponse.json(
      { error: 'Falta configuración de admin de PocketBase (PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD o NEXT_PUBLIC_*).' },
      { status: 503 }
    );
  }

  try {
    // Autenticación como admin (PB 0.23+ usa _superusers)
    const superuserAuthUrl = `${pbUrl}/api/collections/_superusers/auth-with-password`;
    const adminAuthUrl = `${pbUrl}/api/admins/auth-with-password`;

    let authRes = await fetch(superuserAuthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
    });
    if (authRes.status === 404) {
      authRes = await fetch(adminAuthUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
      });
    }

    if (!authRes.ok) {
      const err = await authRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: 'Error de autenticación admin con PocketBase', details: err },
        { status: 401 }
      );
    }

    const { token } = await authRes.json();

    const authHeader = { Authorization: `Bearer ${token}` };
    const allItems: { type?: string; name?: string; id?: string }[] = [];
    let page = 1;
    const perPage = 500;

    for (;;) {
      const collectionsRes = await fetch(
        `${pbUrl}/api/collections?page=${page}&perPage=${perPage}`,
        { headers: authHeader }
      );
      if (!collectionsRes.ok) {
        return NextResponse.json(
          { error: 'Error al listar colecciones', status: collectionsRes.status },
          { status: 502 }
        );
      }
      const data = await collectionsRes.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      allItems.push(...items);
      const totalPages = data?.totalPages ?? 1;
      if (page >= totalPages || items.length < perPage) break;
      page++;
    }

    // Solo colecciones tipo "base" y excluir sistema
    const exclude = ['users', 'proyectos', 'notificaciones', 'logs', '_superusers'];
    const collections = allItems
      .filter((c: { type?: string; name?: string }) => c.type === 'base' && c.name && !exclude.includes(c.name))
      .map((c: { id?: string; name?: string; type?: string }) => ({
        id: c.id || c.name,
        name: c.name,
        type: c.type || 'base',
      }));

    return NextResponse.json({ items: collections });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Error al conectar con PocketBase';
    console.error('Error API colecciones:', e);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
