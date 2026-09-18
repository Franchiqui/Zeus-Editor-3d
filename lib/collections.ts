/**
 * Configuración de las colecciones de PocketBase usadas en la aplicación.
 * Nombres de campos según el esquema. Los IDs reales usados por la API
 * se configuran en lib/pb-api.ts (variables de entorno).
 */

// Valores por defecto (referencia). Para otra base, usa env en pb-api.
export const CONVERSATIONS_COLLECTION_ID = '5t0lyd0dtx6drik';
export const CONVERSATIONS_COLLECTION_NAME = 'conversations';

export const CONVERSATIONS_FIELDS = {
  PROJECT_ID: 'project_id',
  MODEL_ID: 'model_id',
  TITLE: 'title',
} as const;

// ——— messages (i7knofp536h8qmt)
export const MESSAGES_COLLECTION_ID = 'i7knofp536h8qmt';
export const MESSAGES_COLLECTION_NAME = 'messages';

export const MESSAGES_FIELDS = {
  CONVERSATION_ID: 'conversation_id',
  ROLE: 'role',
  CONTENT_TEXT: 'content_text',
  TYPE: 'type',
  CONTENT_FILE: 'content_file',
} as const;

export const MESSAGE_TYPE = {
  CONTENT_TEXT: 'content_text',
  CONTENT_FILE: 'content_file',
} as const;

// ——— modelos (grhtlvueyj5437v)
export const MODELOS_COLLECTION_ID = 'grhtlvueyj5437v';
export const MODELOS_COLLECTION_NAME = 'modelos';

export const MODELOS_FIELDS = {
  PROVEEDOR: 'proveedor',
  NOMBRE_MODELO: 'nombre_modelo',
  ID_MODELO: 'id_modelo',
  CLAVE_API: 'clave_api',
  URL: 'url',
  MAX_TOKEN: 'max_token',
  TEMPERATURA: 'temperatura',
  USER: 'user',
  IS_VISION: 'is_vision',
} as const;

// ——— rutas (colección para carpetas locales)
export const RUTAS_COLLECTION_NAME = 'rutas';
export const RUTAS_FIELDS = {
  USER: 'user',
  VIDEO: 'video',
  IMAGEN: 'imagen',
  AUDIO: 'audio',
  DOCUMENTOS: 'documentos',
  PROYECTOS: 'proyectos',
} as const;

export type RutaRecord = {
  id: string;
  user: string;
  video?: string;
  imagen?: string;
  audio?: string;
  documentos?: string;
  proyectos?: string;
};

export type ModeloRecord = {
  id: string;
  [key: string]: unknown;
  proveedor?: string;
  nombre_modelo?: string;
  id_modelo?: string;
  clave_api?: string;
  url?: string;
  max_token?: number;
  temperatura?: number;
  is_vision?: boolean;
};

// ——— proveedores de IA admitidos
export const USERS_EDITOR_3D_COLLECTION_NAME = 'users_editor_3d';
export type UserEditor3DRecord = {
  id: string;
  name?: string;
  IP?: string;
  veces_conectado?: number;
  created: string;
  updated: string;
};
// Todos los OpenAI-compatibles (Ollama local/Cloud, llama.cpp, custom) usan el
// mismo formato /v1/chat/completions que OpenAI; solo varían la URL base y si
// requieren API key. Deepseek mantiene su propio formato (callDeepseek).

export type ProviderPreset = {
  /** id canónico guardado en el campo `proveedor` del registro */
  id: string;
  /** texto del desplegable en el modal de configuración */
  label: string;
  /** URL completa del endpoint /chat/completions (vacío para Personalizado) */
  defaultBaseUrl: string;
  /** id de modelo sugerido (vacío para Personalizado) */
  defaultModel: string;
  /** si el proveedor necesita API key (false para locales sin auth) */
  requiresApiKey: boolean;
  /** nota opcional mostrada bajo el desplegable */
  hint?: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'OpenAI',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o',
    requiresApiKey: true,
  },
  {
    id: 'Deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-chat',
    requiresApiKey: true,
  },
  {
    id: 'OllamaCloud',
    label: 'Ollama Cloud (remoto)',
    defaultBaseUrl: 'https://ollama.com/api/generate',
    defaultModel: 'gpt-oss:120b',
    requiresApiKey: true,
    hint: 'API key de ollama.com/settings/keys (Bearer). Endpoint nativo que funciona: ollama.com/api/generate (también /api/chat si prefieres roles).',
  },
  {
    id: 'Ollama',
    label: 'Ollama (local)',
    defaultBaseUrl: 'http://localhost:11434/v1/chat/completions',
    defaultModel: 'llama3.2',
    requiresApiKey: false,
    hint: 'Ollama local (ollama serve). No requiere API key.',
  },
  {
    id: 'llama.cpp',
    label: 'llama.cpp (llama-server)',
    defaultBaseUrl: 'http://localhost:8080/v1/chat/completions',
    defaultModel: 'local-model',
    requiresApiKey: false,
    hint: 'Servidor llama.cpp local. No requiere API key salvo auth configurada.',
  },
  {
    id: 'OpenAI-Compatible',
    label: 'Personalizado (OpenAI-compatible)',
    defaultBaseUrl: '',
    defaultModel: '',
    requiresApiKey: false,
    hint: 'Cualquier endpoint /v1/chat/completions (vLLM, LM Studio, proxy…). Rellena URL y modelo.',
  },
];

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/**
 * Normaliza texto libre / etiquetas antiguas al id canónico.
 * Permite que registros existentes (con `proveedor` escrito a mano)
 * sigan funcionando sin migrar el esquema.
 */
export function normalizeProvider(raw?: string): string {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return 'OpenAI';
  if (s.includes('deepseek')) return 'Deepseek';
  if (s.includes('ollama') && (s.includes('cloud') || s.includes('api.ollama'))) return 'OllamaCloud';
  if (s.includes('ollama')) return 'Ollama';
  if (s.includes('llama.cpp') || s.includes('llamacpp') || s.includes('llama-server')) return 'llama.cpp';
  if (s.includes('compatible') || s.includes('custom') || s.includes('personalizado')) return 'OpenAI-Compatible';
  // ids canónicos exactos
  if (['openai', 'ollama', 'ollamacloud', 'llama.cpp', 'openai-compatible', 'deepseek'].includes(s)) {
    return raw!.trim();
  }
  return 'OpenAI';
}

/** ¿Usa el formato OpenAI /v1/chat/completions? (todo excepto Deepseek) */
export function isOpenAICompatible(providerId: string): boolean {
  return providerId !== 'Deepseek';
}
