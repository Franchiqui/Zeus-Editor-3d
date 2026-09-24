/**
 * Configuración compartida de PocketBase para las APIs (modelos y chat).
 * Las rutas /api/modelos y /api/chat usan estas constantes.
 * Usa credenciales de USUARIO (colección users), no de administrador.
 * Las colecciones se identifican por nombre (modelos, conversations, messages).
 */

import PocketBase from 'pocketbase';
import {
  MODELOS_COLLECTION_NAME,
  CONVERSATIONS_COLLECTION_NAME,
  MESSAGES_COLLECTION_NAME,
  RUTAS_COLLECTION_NAME,
} from '@/lib/collections';

export const POCKETBASE_URL =
  process.env.POCKETBASE_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://zeus-media-studio-ia.fly.dev';
/** URL de la PocketBase local (fallback si la desplegada no responde). */
export const POCKETBASE_LOCAL_URL =
  process.env.POCKETBASE_LOCAL_URL || 'http://127.0.0.1:8236';
export const POCKETBASE_EMAIL = process.env.POCKETBASE_EMAIL || process.env.PB_ADMIN_EMAIL;
export const POCKETBASE_PASSWORD = process.env.POCKETBASE_PASSWORD || process.env.PB_ADMIN_PASSWORD;

/** Colecciones (nombre por defecto; opcionalmente override con env para otra base) */
export const PB_COLLECTIONS = {
  MODELOS:
    process.env.POCKETBASE_COLLECTION_MODELOS ||
    process.env.NEXT_PUBLIC_POCKETBASE_COLLECTION_MODELOS ||
    MODELOS_COLLECTION_NAME,
  CONVERSATIONS:
    process.env.POCKETBASE_COLLECTION_CONVERSATIONS ||
    process.env.NEXT_PUBLIC_POCKETBASE_COLLECTION_CONVERSATIONS ||
    CONVERSATIONS_COLLECTION_NAME,
  MESSAGES:
    process.env.POCKETBASE_COLLECTION_MESSAGES ||
    process.env.NEXT_PUBLIC_POCKETBASE_COLLECTION_MESSAGES ||
    MESSAGES_COLLECTION_NAME,
  RUTAS:
    process.env.POCKETBASE_COLLECTION_RUTAS ||
    process.env.NEXT_PUBLIC_POCKETBASE_COLLECTION_RUTAS ||
    RUTAS_COLLECTION_NAME,
  REMOVE_BG:
    process.env.POCKETBASE_COLLECTION_REMOVE_BG ||
    process.env.NEXT_PUBLIC_POCKETBASE_COLLECTION_REMOVE_BG ||
    'quitar_fondo_imagen',
} as const;

export function getPocketBase(): PocketBase {
  const pb = new PocketBase(POCKETBASE_URL);
  pb.autoCancellation(false);
  return pb;
}

/** Autentica con la colección "users" (credenciales de usuario, no admin). */
export async function authPocketBaseAdmin(pb: PocketBase) {
  if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
    throw new Error('Credenciales de PocketBase no configuradas (POCKETBASE_EMAIL / POCKETBASE_PASSWORD o PB_ADMIN_*)');
  }
  await pb.collection('users').authWithPassword(POCKETBASE_EMAIL, POCKETBASE_PASSWORD);
}

// ---------------------------------------------------------------------------
// Autenticación con fallback: intenta primero la base desplegada (POCKETBASE_URL)
// y, si no responde (timeout/error), cae a la base local (POCKETBASE_LOCAL_URL).
// Cachea la instancia ya autenticada para no reintentar en cada petición.
// ---------------------------------------------------------------------------

let cachedAuthed: { pb: PocketBase; url: string; ts: number } | null = null;
const AUTH_TTL_MS = 5 * 60 * 1000; // re-autentica cada 5 min para refrescar el token

function newPocketBase(url: string): PocketBase {
  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  return pb;
}

/** Intenta autenticar contra una URL con un timeout corto (no bloquea el fallback). */
async function tryAuth(url: string, timeoutMs: number): Promise<PocketBase | null> {
  if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) return null;
  try {
    const pb = newPocketBase(url);
    const authP = pb.collection('users').authWithPassword(POCKETBASE_EMAIL, POCKETBASE_PASSWORD);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutP = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error('auth-timeout')), timeoutMs);
    });
    try {
      await Promise.race([authP, timeoutP]);
      if (timer) clearTimeout(timer);
      return pb;
    } catch {
      if (timer) clearTimeout(timer);
      // Evitar unhandled rejection del fetch que sigue pendiente.
      authP.catch(() => {});
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Devuelve una instancia de PocketBase ya autenticada. Intenta la base
 * desplegada y, si falla, la local. Cachea el resultado para las siguientes
 * peticiones.
 */
export async function getAuthedPocketBase(): Promise<PocketBase> {
  if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
    throw new Error('Credenciales de PocketBase no configuradas (POCKETBASE_EMAIL / POCKETBASE_PASSWORD o PB_ADMIN_*)');
  }
  if (cachedAuthed && Date.now() - cachedAuthed.ts < AUTH_TTL_MS) {
    return cachedAuthed.pb;
  }
  // 1) Base desplegada (timeout corto para no esperar si está caída).
  let pb = await tryAuth(POCKETBASE_URL, 3500);
  // 2) Base local (fallback).
  if (!pb) pb = await tryAuth(POCKETBASE_LOCAL_URL, 6000);
  if (!pb) {
    throw new Error('No se pudo autenticar con PocketBase: la base desplegada ni la local responden.');
  }
  cachedAuthed = { pb, url: pb.baseUrl, ts: Date.now() };
  return pb;
}

/** URL que quedó activa tras el fallback (útil para logs/diagnóstico). */
export function getActivePocketBaseUrl(): string | null {
  return cachedAuthed?.url ?? null;
}
