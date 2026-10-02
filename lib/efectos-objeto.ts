/**
 * Efectos visuales por objeto.
 *
 * Cada objeto de la escena puede llevar una lista de efectos (lluvia,
 * humo, fuego, chispas, estrellas, brillo) con sus parámetros y sus
 * focos (puntos colocados con clic desde los que emiten las partículas).
 * Todo viaja con el proyecto al guardar (vive dentro de `sceneObjects`)
 * y puede animarse con pistas de efecto del editor de movimiento.
 *
 * Módulo puro: solo datos serializables, sin THREE ni React.
 */

import type { EffectType } from '@/lib/animation';

/** Un foco de efecto: punto local al objeto donde nacen las partículas. */
export interface FocoEfecto {
  x: number;
  y: number;
  z: number;
}

/** Estrella colocada con clic (persistente por objeto). */
export interface EstrellaColocada {
  x: number;
  y: number;
  z: number;
  /** Tamaño relativo de la estrella (1 = el por defecto). */
  tamaño?: number;
}

/** Parámetros ajustables de un efecto (los mismos nombres que FxConfig). */
export type EfectoValores = Partial<{
  glowColor: string;
  glowIntensity: number;
  sparksCount: number;
  sparksSize: number;
  fireCount: number;
  fireSize: number;
  fireIntensity: number;
  fireEstilo: number;
  rainCount: number;
  rainSpeed: number;
  smokeCount: number;
  smokeSize: number;
  smokeColor: string;
  smokeRiseSpeed: number;
  starSize: number;
}>;

/** Efecto aplicado a un objeto concreto de la escena. */
export interface EfectoObjeto {
  /** Identificador único (estable) del efecto en el objeto. */
  id: string;
  /** Tipo de efecto (mismos tipos que EffectTrack). */
  tipo: EffectType;
  /** Si está activo, el visor emite el efecto. */
  activo: boolean;
  /** Parámetros concretados (solo los que el usuario tocó). */
  params?: EfectoValores;
  /** Focos de emisión (fuego/humo/chispas) en espacio local del objeto. */
  focos?: FocoEfecto[];
  /** Estrellas colocadas con clic en espacio local del objeto. */
  estrellas?: EstrellaColocada[];
}

/** FxConfig global (legacy v3): se conserva para migrar y abrir proyectos viejos. */
export interface FxConfig {
  glow: boolean;
  glowColor: string;      // hex #RRGGBB
  glowIntensity: number;  // 0..3
  sparks: boolean;
  sparksCount: number;    // 50..500
  sparksSize: number;     // 0.01..0.2
  fire: boolean;
  fireCount: number;      // 50..500
  fireSize: number;       // 0.05..1.2
  fireIntensity: number;  // 0..3 (multiplica color + luz)
  fireEstilo: number;     // 0..1 (0 = partículas sueltas, 1 = llama real)
  rain: boolean;
  rainCount: number;      // 100..1000
  rainSpeed: number;      // 1..10
  /** Estrellas que brillan sobre el texto */
  glowObjects: boolean;  // apply glow effect to scene objects too
  smoke: boolean;
  smokeCount: number;     // 50..500
  smokeSize: number;      // 0.05..0.5
  smokeColor: string;     // hex #RRGGBB
  smokeRiseSpeed: number; // 0.1..5
}

/** Configuración FX global por defecto (todo apagado). */
export const DEFAULT_FX_CONFIG: FxConfig = {
  glow: false,
  glowColor: '#5fd4ff',
  glowIntensity: 1.4,
  sparks: false,
  sparksCount: 140,
  sparksSize: 0.035,
  fire: false,
  fireCount: 160,
  fireSize: 0.11,
  fireIntensity: 1,
  fireEstilo: 0.35,
  rain: false,
  rainCount: 320,
  rainSpeed: 2,
  smoke: false,
  smokeCount: 120,
  smokeSize: 0.11,
  smokeColor: '#444a52',
  smokeRiseSpeed: 1,
  glowObjects: false,
};

/** Valores por defecto de cada tipo de efecto (los mismos que FxConfig). */
export const VALORES_DEFECTO_EFECTO: Record<EffectType, EfectoValores> = {
  glow: { glowColor: DEFAULT_FX_CONFIG.glowColor, glowIntensity: DEFAULT_FX_CONFIG.glowIntensity },
  sparks: { sparksCount: DEFAULT_FX_CONFIG.sparksCount, sparksSize: DEFAULT_FX_CONFIG.sparksSize },
  fire: {
    fireCount: DEFAULT_FX_CONFIG.fireCount,
    fireSize: DEFAULT_FX_CONFIG.fireSize,
    fireIntensity: DEFAULT_FX_CONFIG.fireIntensity,
    fireEstilo: DEFAULT_FX_CONFIG.fireEstilo,
  },
  rain: { rainCount: DEFAULT_FX_CONFIG.rainCount, rainSpeed: DEFAULT_FX_CONFIG.rainSpeed },
  smoke: {
    smokeCount: DEFAULT_FX_CONFIG.smokeCount,
    smokeSize: DEFAULT_FX_CONFIG.smokeSize,
    smokeColor: DEFAULT_FX_CONFIG.smokeColor,
    smokeRiseSpeed: DEFAULT_FX_CONFIG.smokeRiseSpeed,
  },
  stars: { starSize: 1 },
};

/** Generador de ids estable para efectos y focos. */
export function idEfecto(): string {
  return `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Crea un efecto por objeto con los valores por defecto de su tipo. */
export function crearEfectoObjeto(tipo: EffectType, activo = true): EfectoObjeto {
  return {
    id: idEfecto(),
    tipo,
    activo,
    params: { ...VALORES_DEFECTO_EFECTO[tipo] },
    focos: [],
  };
}

/** Une los valores por defecto del tipo con los params concretados. */
export function valoresEfecto(efecto: EfectoObjeto): EfectoValores {
  return { ...VALORES_DEFECTO_EFECTO[efecto.tipo], ...(efecto.params ?? {}) };
}

/**
 * Aplica (o retira) un efecto a una lista de objetos identificados por id.
 * Devuelve un mapa objectId -> efectos actualizados SOLO para los objetos
 * que cambian (los demás no se tocan). Si `activo` es false y el objeto no
 * tenía el efecto, no crea nada.
 */
export function aplicarAEfectos(
  efectosPorObjeto: Record<string, EfectoObjeto[] | undefined>,
  objectIds: string[],
  tipo: EffectType,
  activo: boolean
): Record<string, EfectoObjeto[]> {
  const resultado: Record<string, EfectoObjeto[]> = {};
  for (const id of objectIds) {
    const lista = efectosPorObjeto[id] ?? [];
    const ya = lista.find((e) => e.tipo === tipo);
    if (activo) {
      if (ya) {
        if (ya.activo) continue;
        resultado[id] = lista.map((e) => (e.id === ya.id ? { ...e, activo: true } : e));
      } else {
        resultado[id] = [...lista, crearEfectoObjeto(tipo, true)];
      }
    } else if (ya) {
      // Retirar: se APAGA sin borrar. Los focos (antorcha) y los parámetros
      // persisten en el efecto inactivo: al volver a encender, el fuego
      // vuelve a emitir del mismo foco y no de toda la malla (partículada).
      if (ya.activo) {
        resultado[id] = lista.map((e) => (e.id === ya.id ? { ...e, activo: false } : e));
      }
    }
  }
  return resultado;
}

/**
 * Migra un FxConfig global (proyectos v3) a efectos por objeto: cada
 * efecto activo pasa al objeto `configObjectId` y el FxConfig queda
 * todo-apagado (se sigue escribiendo en el proyecto por compatibilidad,
 * pero el visor ya no lo aplica).
 */
export function migrarFxConfigGlobal(
  fxConfig: Partial<FxConfig> | undefined,
  objectIds: string[],
  configObjectId: string | null
): { fxConfigLimpio: FxConfig; efectos: Record<string, EfectoObjeto[]> } {
  const fxConfigLimpio: FxConfig = {
    ...DEFAULT_FX_CONFIG,
    ...(fxConfig ?? {}),
    glow: false,
    sparks: false,
    fire: false,
    rain: false,
    smoke: false,
    glowObjects: false,
  };
  const efectos: Record<string, EfectoObjeto[]> = {};
  if (!fxConfig) return { fxConfigLimpio, efectos };
  // El objeto dueño: el que tenía la configuración; si no existe, el
  // primero de la escena (que era el activo al abrir).
  const dueño = (configObjectId && objectIds.includes(configObjectId) ? configObjectId : objectIds[0]) ?? null;
  if (!dueño) return { fxConfigLimpio, efectos };
  const lista: EfectoObjeto[] = [];
  const de = (encendido: boolean | undefined, tipo: EffectType) => {
    if (!encendido) return;
    const efecto = crearEfectoObjeto(tipo, true);
    // Hereda los parámetros del FxConfig global que apliquen al tipo.
    efecto.params = { ...VALORES_DEFECTO_EFECTO[tipo], ...paramsDe(fxConfig, tipo) };
    lista.push(efecto);
  };
  de(fxConfig.glow, 'glow');
  de(fxConfig.sparks, 'sparks');
  de(fxConfig.fire, 'fire');
  de(fxConfig.rain, 'rain');
  de(fxConfig.smoke, 'smoke');
  // Estrellas: el FxConfig no tenía flag de estrellas (venían de pistas).
  if (lista.length > 0) efectos[dueño] = lista;
  return { fxConfigLimpio, efectos };
}

/** Extrae de FxConfig los params que corresponden a un tipo de efecto. */
function paramsDe(fx: Partial<FxConfig>, tipo: EffectType): EfectoValores {
  switch (tipo) {
    case 'glow':
      return { glowColor: fx.glowColor, glowIntensity: fx.glowIntensity };
    case 'sparks':
      return { sparksCount: fx.sparksCount, sparksSize: fx.sparksSize };
    case 'fire':
      return {
        fireCount: fx.fireCount,
        fireSize: fx.fireSize,
        fireIntensity: fx.fireIntensity,
        fireEstilo: fx.fireEstilo,
      };
    case 'rain':
      return { rainCount: fx.rainCount, rainSpeed: fx.rainSpeed };
    case 'smoke':
      return {
        smokeCount: fx.smokeCount,
        smokeSize: fx.smokeSize,
        smokeColor: fx.smokeColor,
        smokeRiseSpeed: fx.smokeRiseSpeed,
      };
    default:
      return {};
  }
}

/** Tipos de efecto válidos (misma lista que el validador de effectTracks). */
const TIPOS_EFECTO: EffectType[] = ['rain', 'smoke', 'stars', 'fire', 'sparks', 'glow'];

/**
 * Valida (y completa) la lista de efectos de un objeto que llega del
 * disco: descarta entradas corruptas y completa params ausentes con los
 * valores por defecto. Devuelve `undefined` si no queda nada válido.
 */
export function validarEfectos(efectos: unknown): EfectoObjeto[] | undefined {
  if (!Array.isArray(efectos)) return undefined;
  const ok: EfectoObjeto[] = [];
  for (const crudo of efectos) {
    if (!crudo || typeof crudo !== 'object') continue;
    const e = crudo as Partial<EfectoObjeto>;
    if (typeof e.id !== 'string' || !e.id) continue;
    if (!e.tipo || !TIPOS_EFECTO.includes(e.tipo as EffectType)) continue;
    ok.push({
      id: e.id,
      tipo: e.tipo as EffectType,
      activo: e.activo !== false,
      params: e.params && typeof e.params === 'object' ? e.params : undefined,
      focos: validarPuntos(e.focos),
      estrellas: validarPuntos(e.estrellas) as EstrellaColocada[] | undefined,
    });
  }
  return ok.length > 0 ? ok : undefined;
}

/** Valida un array de puntos {x,y,z}. */
function validarPuntos(puntos: unknown): FocoEfecto[] | undefined {
  if (!Array.isArray(puntos)) return undefined;
  const ok = puntos.filter(
    (p): p is FocoEfecto =>
      !!p &&
      typeof p === 'object' &&
      typeof (p as FocoEfecto).x === 'number' &&
      typeof (p as FocoEfecto).y === 'number' &&
      typeof (p as FocoEfecto).z === 'number'
  );
  return ok.length > 0 ? ok : undefined;
}