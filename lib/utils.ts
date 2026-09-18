import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Extrae un mensaje legible de errores de PocketBase o fetch.
 * PocketBase puede devolver error.data.message o error.message.
 */
export function getPocketBaseErrorMessage(error: unknown): string {
  if (error == null) return 'Error desconocido';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    const msg = (error as any).data?.message ?? (error as any).response?.data?.message ?? error.message;
    return String(msg);
  }
  const obj = error as Record<string, unknown>;
  if (obj?.data && typeof (obj.data as any)?.message === 'string') return (obj.data as any).message;
  if (obj?.message && typeof obj.message === 'string') return obj.message;
  return String(error);
}

/**
 * Quita el sufijo que PocketBase (o el sistema) añade a los nombres de archivo:
 * - PocketBase: nombre_52iwbgds7l.pdf → nombre.pdf
 * - Timestamps/números: nombre_1234567890.ext → nombre.ext
 */
export function cleanDisplayFileName(pbFileNameOrUrl: string): string {
  const name = pbFileNameOrUrl.split(/[/\\]/).pop() || pbFileNameOrUrl;
  return name.replace(/^(.+)_(?:[a-zA-Z0-9]{8,15}|\d{8,})(\.[^.]+)$/, '$1$2');
}

export function cleanTextForTTS(text: string): string {
  if (!text) return '';

  return text
    .split('\n')
    .map(line => {
      let l = line.trim();
      if (!l) return '';

      // 1. Quitar encabezados de Markdown al inicio (####, ###, etc.) para exponer el tiempo
      l = l.replace(/^#+\s*/, '');

      const upper = l.toUpperCase();
      // Omitir líneas estructurales pesadas
      if (upper.includes('DURACIÓN TOTAL') || upper.includes('TONO:') || 
          upper.includes('RITMO:') || upper.includes('SECCIÓN') || 
          upper.includes('ESTRUCTURA DETALLADA') || upper.includes('HERRAMIENTAS:')) return '';

      return l;
    })
    .filter(l => l.length > 0)
    .join(' \n ')
    // 2. Traducir rangos con o sin corchetes: [0:00 - 0:10] o 0:00-0:10
    .replace(/\[?(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\]?/g, (match, m1, s1, m2, s2) => {
      const start = parseInt(m1) === 0 ? `segundo ${parseInt(s1)}` : `minuto ${parseInt(m1)} y ${parseInt(s1)} segundos`;
      const end = parseInt(m2) === 0 ? `${parseInt(s2)}` : `minuto ${parseInt(m2)} y ${parseInt(s2)} segundos`;
      return `del ${start} al ${end} `;
    })
    // 3. Tiempos simples [0:00] o 0:00
    .replace(/\[?(\d{1,2}):(\d{2})\]?/g, (match, m, s) => {
      return parseInt(m) === 0 ? `segundo ${parseInt(s)} ` : `minuto ${parseInt(m)} y ${parseInt(s)} segundos `;
    })
    // 4. Limpieza final de símbolos de Markdown, código, técnicos y carácteres extraños
    .replace(/[#*`~_\-+|=>\[\]{}()\\/]/g, ' ')
    // 5. URLs y correos: sustituir por "enlace" o "correo" para no deletrearlos
    .replace(/https?:\/\/[^\s]+/gi, 'enlace')
    .replace(/www\.[^\s]+/gi, 'enlace')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, 'correo')
    // 6. Símbolos técnicos, emojis y puntuación rara
    .replace(/[<>@#$%^&*•·¶§†‡°±½¼¾¹²³⁴™®©☀-⛿✀-➿]+/g, ' ')
    .replace(/(\s):(?=\s|$)/g, ' ')
    .replace(/:+(\s|$)/g, ' ')
    .replace(/\.{3,}/g, ' ')
    .replace(/\bJSON\b|\bID\b|\bUUID\b/gi, '')
    // 7. Colapsar espacios
    .replace(/\s+/g, ' ')
    .trim();
}