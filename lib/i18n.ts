'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useCallback } from 'react';
import { translations, type Locale, type TranslationKeys } from '@/lib/i18n/translations';
export { translations } from '@/lib/i18n/translations';

export type { Locale } from '@/lib/i18n/translations';

/** Idiomas soportados. Las etiquetas se obtienen con t(`language.<code>`). */
export const LANGUAGES: { code: Locale }[] = [
  { code: 'es' },
  { code: 'en' },
  { code: 'fr' },
  { code: 'de' },
  { code: 'it' },
  { code: 'zh' },
  { code: 'hi' },
];

interface I18nState {
  locale: Locale;
  hasHydrated: boolean;
  setLocale: (locale: Locale) => void;
  setHasHydrated: (v: boolean) => void;
}

/**
 * Store del idioma. Persiste solo `locale` en localStorage (clave `zeus-i18n`).
 * `hasHydrated` permite evitar el parpadeo de hidratación: hasta que zustand
 * rehidrata el estado, se usa el locale por defecto (`es`).
 */
export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      locale: 'es',
      hasHydrated: false,
      setLocale: (locale) => {
        if (typeof document !== 'undefined') {
          document.documentElement.lang = locale;
        }
        set({ locale });
      },
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: 'zeus-i18n',
      partialize: (state) => ({ locale: state.locale }),
      onRehydrateStorage: () => (state) => {
        if (state) state.setHasHydrated(true);
        if (state && typeof document !== 'undefined') {
          document.documentElement.lang = state.locale;
        }
      },
    },
  ),
);

/** Resuelve una clave por puntos sobre el diccionario anidado. Best-effort. */
export function resolve(dict: TranslationKeys, key: string): string | undefined {
  const parts = key.split('.');
  let cur: unknown = dict;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** Crea una función `t` para un locale dado (estable por locale). */
function makeT(locale: Locale) {
  return (key: string, vars?: Record<string, string | number>): string => {
    const dict = translations[locale] ?? translations.es;
    let value = resolve(dict, key);
    if (value === undefined) value = resolve(translations.es, key); // fallback al español
    if (value === undefined) return key; // fallback a la clave
    if (vars) {
      value = value.replace(/\{(\w+)\}/g, (_, name) =>
        name in vars ? String(vars[name]) : `{${name}}`,
      );
    }
    return value;
  };
}

/**
 * t() fuera de componentes (stores de zustand, workers...). Lee el locale actual.
 */
export function getT() {
  const locale = useI18nStore.getState().locale;
  return makeT(locale);
}

/**
 * Hook de i18n. `t` es referencialmente estable mientras `locale` no cambie
 * (useCallback), para no invalidar useMemo internos de los editores.
 */
export function useI18n() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);
  const t = useCallback(makeT(locale), [locale]);
  return { locale, setLocale, t };
}