import PocketBase from 'pocketbase';
import dotenv from 'dotenv';

dotenv.config();

const pbUrl = process.env.PB_URL || 'https://zeus-media-studio-ia.fly.dev';
export const pb = new PocketBase(pbUrl);

// La PocketBase remota (fly.dev) usa autenticación de USUARIO (colección `users`),
// no de administrador. Por eso authAsAdmin() prueba primero credenciales de usuario
// y sólo cae a admin/_superusers si las de usuario no están configuradas o fallan.
export async function authAsAdmin() {
  const userEmail = process.env.PB_USER_EMAIL || '';
  const userPassword = process.env.PB_USER_PASSWORD || '';
  const adminEmail = process.env.PB_ADMIN_EMAIL || '';
  const adminPassword = process.env.PB_ADMIN_PASSWORD || '';

  // 1. Autenticación como usuario (colección users) — la que usa la BD remota.
  if (userEmail && userPassword) {
    try {
      await pb.collection('users').authWithPassword(userEmail, userPassword);
      console.log('[PocketBase] Usuario autenticado');
      return;
    } catch (e: any) {
      console.warn('[PocketBase] auth con users falló:', e?.message || e, '— intentando admin');
    }
  }

  // 2. Fallback: admin moderno (_superusers, PB 0.23+).
  if (adminEmail && adminPassword) {
    try {
      await pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);
      console.log('[PocketBase] Admin autenticado (_superusers)');
      return;
    } catch {}
    // 3. Fallback: admin legacy (PB < 0.23).
    try {
      await pb.admins.authWithPassword(adminEmail, adminPassword);
      console.log('[PocketBase] Admin autenticado (legacy)');
      return;
    } catch (e) {
      console.warn('[PocketBase] No se pudo autenticar como admin:', e);
    }
  }

  console.warn('[PocketBase] Sin credenciales válidas: las peticiones a colecciones protegidas fallarán.');
}

/** Devuelve el id del usuario/admin autenticado (para el campo `user` de colecciones per-user como modelos). */
export function authedUserId(): string | undefined {
  return (pb.authStore.model as any)?.id;
}