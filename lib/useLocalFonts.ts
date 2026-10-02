import { useCallback, useEffect, useState } from 'react';

/**
 * Fuentes locales (carpeta «Fuentes» configurada en la pestaña Archivo).
 *
 * Hook compartido por los editores para reutilizar las APIs existentes:
 *  - /api/local-fonts        → lista de fuentes de la carpeta
 *  - /api/local-font-file    → bytes del archivo para registrarla en el lienzo
 *
 * `ensureLocalFontFace` registra la fuente en `document.fonts` para que el
 * lienzo (canvas 2D) pueda renderizarla con `ctx.font`. Si el archivo
 * desapareció o está corrupto (p. ej. un export roto de Font Studio) devuelve
 * null y se ignora con elegancia en lugar de romper el editor.
 *
 * La deduplicación es a nivel de módulo: si dos componentes de la misma página
 * (p. ej. el panel de texto y el panel de estilo del editor de vídeo) usan la
 * misma fuente, solo se descarga y registra una vez.
 */
export interface LocalFontInfo {
  id: string;
  name: string;
  family: string;
  path: string;
  size?: number;
}

const registeredFaces = new Set<string>();

function fontMime(ext: string): string {
  if (ext === 'woff2') return 'font/woff2';
  if (ext === 'woff') return 'font/woff';
  if (ext === 'otf') return 'font/otf';
  return 'font/ttf';
}

export function useLocalFonts() {
  const [localFonts, setLocalFonts] = useState<LocalFontInfo[]>([]);
  const [localFontsLoading, setLocalFontsLoading] = useState(false);

  const loadLocalFonts = useCallback(async () => {
    setLocalFontsLoading(true);
    try {
      const res = await fetch('/api/local-fonts');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLocalFonts(Array.isArray(data?.fonts) ? data.fonts : []);
    } catch (e) {
      console.warn('No se pudieron cargar las fuentes locales:', e);
      setLocalFonts([]);
    } finally {
      setLocalFontsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLocalFonts();
  }, [loadLocalFonts]);

  /**
   * Descarga la fuente y la registra en `document.fonts` (para el lienzo).
   * Devuelve el nombre de familia si se registró, o null si falló.
   */
  const ensureLocalFontFace = useCallback(async (font: LocalFontInfo): Promise<string | null> => {
    if (registeredFaces.has(font.family)) return font.family;
    try {
      const res = await fetch(`/api/local-font-file?path=${encodeURIComponent(font.path)}`);
      if (!res.ok) return null; // fuente desaparecida → se omite con elegancia
      const buf = await res.arrayBuffer();
      const ext = (font.path.split('.').pop() || 'ttf').toLowerCase();
      const mime = fontMime(ext);

      // Intento 1: blob URL (equivalente a EditorHTML)
      try {
        const url = URL.createObjectURL(new Blob([buf], { type: mime }));
        const face = new FontFace(font.family, `url(${url})`);
        const loaded = await face.load();
        document.fonts.add(loaded);
        registeredFaces.add(font.family);
        return font.family;
      } catch (e) {
        console.warn('No se pudo registrar la fuente local en el lienzo:', font.family, e);
      }

      // Intento 2: fuente como ArrayBuffer directo (sin blob URL)
      try {
        const face = new FontFace(font.family, buf);
        const loaded = await face.load();
        document.fonts.add(loaded);
        registeredFaces.add(font.family);
        return font.family;
      } catch (e2) {
        console.warn('Fuente local no válida (se omitirá):', font.family, e2);
        return null;
      }
    } catch (e) {
      console.warn('No se pudo cargar la fuente local:', font.family, e);
      return null;
    }
  }, []);

  return { localFonts, localFontsLoading, loadLocalFonts, ensureLocalFontFace };
}
