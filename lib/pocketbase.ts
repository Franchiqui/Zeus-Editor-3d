import PocketBase from 'pocketbase';

/** URL de PocketBase (desplegada). En otra app: .env con NEXT_PUBLIC_POCKETBASE_URL */
export function getPocketBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!url) {
    console.warn('⚠️ NEXT_PUBLIC_POCKETBASE_URL no está definida en .env.local. Usando localhost por defecto.');
    return 'http://127.0.0.1:8090';
  }
  return url;
}

/** URL de la PocketBase local (fallback si la desplegada no responde). */
export const POCKETBASE_LOCAL_URL =
  process.env.NEXT_PUBLIC_POCKETBASE_LOCAL_URL || 'http://127.0.0.1:8236';

/** Opciones por defecto para la cookie de sesión (reutilizable) */
export const authCookieOptions = {
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Lax' as const,
  path: '/',
  maxAge: 30 * 24 * 60 * 60, // 30 días
};

const REMOTE_URL = getPocketBaseUrl();
const LOCAL_URL = POCKETBASE_LOCAL_URL;
const STORED_URL_KEY = 'zeus_pb_client_url';

/** Instancia única del cliente. Se retargetea con pb.baseUrl según la URL activa. */
const pb = new PocketBase(REMOTE_URL);
pb.autoCancellation(false);

/** Devuelve la URL guardada en localStorage (de un login anterior), si la hay. */
function getStoredClientUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORED_URL_KEY);
  } catch {
    return null;
  }
}

function persistClientUrl(url: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORED_URL_KEY, url);
  } catch {
    /* ignore */
  }
}

let resolvedUrl: string | null = null;

/** Comprueba rápidamente si una URL responde (health check con timeout corto). */
async function healthCheck(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${url.replace(/\/$/, '')}/api/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Resuelve la URL activa del cliente: primero la guardada en localStorage,
 * si no, prueba la desplegada (timeout corto) y cae a la local si no responde.
 * Cachea el resultado y retargetea la instancia `pb`.
 */
export async function resolveClientBaseUrl(): Promise<string> {
  if (resolvedUrl) return resolvedUrl;

  const stored = getStoredClientUrl();
  if (stored) {
    resolvedUrl = stored;
    pb.baseUrl = stored;
    return stored;
  }

  if (await healthCheck(REMOTE_URL, 2500)) {
    resolvedUrl = REMOTE_URL;
    pb.baseUrl = REMOTE_URL;
    persistClientUrl(REMOTE_URL);
    return REMOTE_URL;
  }

  // Fallback local.
  if (await healthCheck(LOCAL_URL, 3000)) {
    resolvedUrl = LOCAL_URL;
    pb.baseUrl = LOCAL_URL;
    persistClientUrl(LOCAL_URL);
    return LOCAL_URL;
  }

  // No se pudo reachear ninguna: dejamos la remota por defecto.
  resolvedUrl = REMOTE_URL;
  pb.baseUrl = REMOTE_URL;
  return REMOTE_URL;
}

/**
 * Autentica al usuario contra la colección "users" con fallback:
 * intenta primero la URL ya resuelta; si falla la autenticación por
 * conexión, prueba la otra URL. Persiste la URL que funcione.
 */
export async function loginWithFallback(email: string, password: string): Promise<void> {
  const primary = await resolveClientBaseUrl();
  const candidates = primary === REMOTE_URL ? [REMOTE_URL, LOCAL_URL] : [LOCAL_URL, REMOTE_URL];

  let lastErr: unknown = null;
  for (const url of candidates) {
    try {
      pb.baseUrl = url;
      await pb.collection('users').authWithPassword(email, password);
      resolvedUrl = url;
      persistClientUrl(url);
      return;
    } catch (err) {
      lastErr = err;
      // Si es error de credenciales (400), no probamos la otra base.
      const msg = err instanceof Error ? err.message : '';
      if (/credentials|incorrect|validation|401|400/i.test(msg)) throw err;
      // Si no, probamos la siguiente URL.
    }
  }
  throw lastErr ?? new Error('No se pudo iniciar sesión: ninguna base de datos responde.');
}

export default pb;