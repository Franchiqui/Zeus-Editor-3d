/**
 * Puente del chat del editor hacia ZEIA (Zeus Editor 3D Integration API).
 *
 * Dirección: chat del editor → ZEIA (esta capa) y ZEIA → modelo de chat (ver
 * `api_agente_3d/LLM.md`). Juntos cierran el ciclo chat → ZEIA → escena.
 *
 * El modelo de texto del editor NO hace function-calling nativo (no todos los
 * proveedores lo soportan: DeepSeek, Ollama, llama.cpp…). Por eso exponemos las
 * herramientas ZEIA mediante un PROTOCOLO DE TEXTO robusto, igual que el
 * proyecto ya hace con los bloques [VISION]:
 *
 *   [ZEIA_PLAN]{"intent":"..."}[/ZEIA_PLAN]
 *   [ZEIA_EXECUTE]{"plan_id":"pln_...","auto_approve":false}[/ZEIA_EXECUTE]
 *   [ZEIA_CONTEXT]{ }[/ZEIA_CONTEXT]
 *   [ZEIA_CHAT]{"message":"..."}[/ZEIA_CHAT]
 *
 * El bucle de tools vive en `app/api/chat/route.ts` (función runZeiaToolLoop):
 * detecta los bloques en la respuesta del modelo, ejecuta la llamada real contra
 * ZEIA y devuelve el resultado al modelo para que redacte la respuesta final.
 *
 * Sin dependencias nuevas: `fetch` nativo + `AbortController`.
 */

const DEFAULT_ZEIA_URL = 'http://127.0.0.1:3012';
const REQUEST_TIMEOUT_MS = 20000;
/** Máximo de rondas del bucle de herramientas ZEIA por turno del usuario. */
export const MAX_ZEIA_ROUNDS = 4;

export type ZeiaPlanner = 'auto' | 'llm' | 'heuristic';

/** Opciones que puede enviar el cliente del chat (campo `zeia` del body). */
export type ZeiaOptions = {
  /** Fuerza activar/desactivar. Si se omite, se decide por entorno (ver ZEIA_URL). */
  enabled?: boolean;
  /** URL base de ZEIA. Por defecto `process.env.ZEIA_URL` o http://127.0.0.1:3012 */
  baseUrl?: string;
  /** API key (`zc_...`) o bearer token. Por defecto `ZEIA_API_KEY`/`ZEIA_BEARER`. */
  apiKey?: string;
  /** Permite ejecutar pasos destructivos sin aprobación explícita. */
  autoApprove?: boolean;
  /** Limita las pestañas que ZEIA puede usar al planificar. */
  tabsAllowed?: string[];
  /** Proyecto ZEIA de destino. */
  projectId?: string;
  /** Motor de planificación de ZEIA: auto (def.), llm o heuristic. */
  planner?: ZeiaPlanner;
};

export type ZeiaResolved = {
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  autoApprove: boolean;
  tabsAllowed?: string[];
  projectId?: string;
  planner?: ZeiaPlanner;
};

export type ZeiaTool = 'plan' | 'execute' | 'context' | 'chat';

export type ZeiaCall = {
  tool: ZeiaTool;
  args: Record<string, unknown>;
  raw: string;
};

/**
 * Paso de un plan ZEIA: `{ action, params }`. El vocabulario de acciones
 * ejecutables lo valida ZEIA (whitelist): objects.create/update/delete/
 * duplicate/parent/batch, motions.create/update, effects.apply,
 * plugins.install, exports.create, animations.*, templates.create.
 */
export type ZeiaPlanStep = {
  action: string;
  params: Record<string, unknown>;
};

/** Resultado por paso devuelto por `POST /v1/ai/execute` de ZEIA. */
export type ZeiaStepResult = {
  action: string;
  ok: boolean;
  object_id?: string;
  motion_id?: string;
  [k: string]: unknown;
};

/**
 * Plan ZEIA con sus pasos (y, si se ejecutó, los resultados por paso).
 * Esta es la unidad que el puente entrega al EDITOR 3D para reflejar en su
 * escena real lo que ZEIA planificó/ejecutó en su escena interna.
 */
export type ZeiaAppliedPlan = {
  plan_id?: string;
  status?: string;
  intent?: string;
  steps: ZeiaPlanStep[];
  results?: ZeiaStepResult[];
};

/** Resumen de aplicar planes ZEIA a la escena del editor. */
export type ZeiaApplyResult = {
  applied: number;
  created: number;
  updated: number;
  removed: number;
  motions: number;
  warnings: string[];
};

/** Función registrada por el editor 3D para aplicar planes ZEIA a su escena. */
export type ZeiaPlanApplier = (plans: ZeiaAppliedPlan[]) => ZeiaApplyResult | void;

/** ¿Está ZEIA conectado al chat por configuración de entorno? */
export function zeiaDefaultEnabled(): boolean {
  return Boolean(process.env.ZEIA_URL || process.env.ZEIA_CHAT_TOOLS === 'true');
}

/** Normaliza las opciones del cliente + entorno a una config resuelta. */
export function resolveZeiaOptions(opts?: ZeiaOptions): ZeiaResolved {
  const baseUrl = (opts?.baseUrl || process.env.ZEIA_URL || DEFAULT_ZEIA_URL).replace(/\/+$/, '');
  const apiKey = opts?.apiKey || process.env.ZEIA_API_KEY || process.env.ZEIA_BEARER || undefined;
  const enabled = typeof opts?.enabled === 'boolean' ? opts.enabled : zeiaDefaultEnabled();
  const autoApprove =
    typeof opts?.autoApprove === 'boolean' ? opts.autoApprove : process.env.ZEIA_AUTO_APPROVE === 'true';
  const tabsAllowed =
    (opts?.tabsAllowed && opts.tabsAllowed.length > 0 ? opts.tabsAllowed : undefined) ||
    (process.env.ZEIA_TABS_ALLOWED
      ? process.env.ZEIA_TABS_ALLOWED.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined);
  const projectId = opts?.projectId || process.env.ZEIA_PROJECT_ID || undefined;
  const planner = opts?.planner || (process.env.ZEIA_PLANNER as ZeiaPlanner | undefined) || undefined;

  return { enabled, baseUrl, apiKey, autoApprove, tabsAllowed, projectId, planner };
}

/**
 * Prompt de sistema que enseña al modelo de chat a usar las herramientas ZEIA.
 * Se inyecta (server-side) en el systemContext sólo cuando ZEIA está activo.
 */
export function zeiaToolPrompt(): string {
  return [
    '## Herramientas ZEIA (Zeus Editor 3D Integration API)',
    '',
    'Tienes acceso a ZEIA, el backend que crea y modifica escenas 3D, animaciones,',
    'plantillas, efectos y exportaciones. Úsalo SOLO cuando el usuario pida crear,',
    'editar o animar objetos/escenas 3D. Emite los bloques EXACTOS, con JSON válido',
    'dentro y sin texto alrededor del bloque:',
    '',
    '1) PLANIFICAR (casi siempre el primer paso):',
    '[ZEIA_PLAN]',
    '{"intent":"<petición del usuario en lenguaje natural>","tabs_allowed":["objects","motions"]}',
    '[/ZEIA_PLAN]',
    '',
    '2) EJECUTAR el plan (tras recibir su plan_id):',
    '[ZEIA_EXECUTE]',
    '{"plan_id":"pln_xxxxxxxx","auto_approve":false}',
    '[/ZEIA_EXECUTE]',
    '',
    '3) CONSULTAR contexto (proyectos, escena, pestaña activa):',
    '[ZEIA_CONTEXT]',
    '{}',
    '[/ZEIA_CONTEXT]',
    '',
    'Reglas:',
    '- Llama primero a ZEIA_PLAN; cuando te devuelva el plan_id, llama a ZEIA_EXECUTE.',
    '- NUNCA inventes plan_id: usa el que devuelva ZEIA.',
    '- Cada bloque contiene UNA sola herramienta y su JSON. Puedes emitir varios bloques.',
    '- Para acciones destructivas (borrar objetos/sesiones) usa "auto_approve": true',
    '  únicamente si el usuario lo pidió de forma explícita.',
    '- Tras recibir los resultados, responde al usuario en español, breve y SIN bloques ZEIA.',
    '- Si la petición no es sobre escena 3D/animación, NO uses estas herramientas.',
  ].join('\n');
}

const ZEIA_BLOCK_SOURCE = '\\[ZEIA_(PLAN|EXECUTE|CONTEXT|CHAT)\\]([\\s\\S]*?)\\[\\/ZEIA_\\1\\]';

/** ¿Hay al menos una llamada a herramienta ZEIA en el texto? */
export function hasZeiaCalls(text: string): boolean {
  return new RegExp(ZEIA_BLOCK_SOURCE, 'i').test(text || '');
}

/** Extrae las llamadas a herramientas ZEIA embebidas en el texto. */
export function parseZeiaCalls(text: string): ZeiaCall[] {
  if (!text) return [];
  const re = new RegExp(ZEIA_BLOCK_SOURCE, 'gi');
  const calls: ZeiaCall[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const tool = match[1].toLowerCase() as ZeiaTool;
    const raw = match[0];
    const body = match[2]
      .trim()
      .replace(/^```[a-zA-Z0-9_-]*\s*/, '')
      .replace(/```\s*$/, '')
      .trim();

    let args: unknown = {};
    if (body) {
      try {
        args = JSON.parse(body);
      } catch {
        // El modelo no emitió JSON: tratamos el cuerpo como texto plano.
        args =
          tool === 'plan' || tool === 'chat'
            ? { intent: body, message: body }
            : { _raw: body };
      }
    }
    let callArgs: Record<string, unknown>;
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      callArgs = args as Record<string, unknown>;
    } else {
      callArgs = { value: args };
    }
    calls.push({ tool, args: callArgs, raw });
  }
  return calls;
}

/** Quita los bloques ZEIA de la respuesta (para mostrarla limpia al usuario). */
export function stripZeiaBlocks(text: string): string {
  if (!text) return '';
  return text
    .replace(new RegExp(ZEIA_BLOCK_SOURCE, 'gi'), '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------------ */
/* Autenticación y transporte                                               */
/* ------------------------------------------------------------------------ */

type CachedToken = { value: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

async function getZeiaAuthHeader(cfg: ZeiaResolved): Promise<Record<string, string>> {
  if (cfg.apiKey) {
    return cfg.apiKey.startsWith('zc_')
      ? { 'X-API-Key': cfg.apiKey }
      : { Authorization: `Bearer ${cfg.apiKey}` };
  }

  // Flujo client_credentials si hay credenciales de servicio configuradas.
  const clientId = process.env.ZEIA_CLIENT_ID;
  const clientSecret = process.env.ZEIA_CLIENT_SECRET;
  if (clientId && clientSecret) {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) {
      return { Authorization: `Bearer ${cachedToken.value}` };
    }
    try {
      const res = await fetch(`${cfg.baseUrl}/v1/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
      });
      if (res.ok) {
        const data = (await res.json()) as { access_token?: string; expires_in?: number };
        if (data.access_token) {
          cachedToken = {
            value: data.access_token,
            expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
          };
          return { Authorization: `Bearer ${cachedToken.value}` };
        }
      }
    } catch {
      // Sin token seguimos intentando (ZEIA permite auth opcional por defecto).
    }
  }
  return {};
}

type ZeiaHttpResult = { ok: boolean; status: number; data: unknown };

async function zeiaFetchJson(
  cfg: ZeiaResolved,
  path: string,
  init: RequestInit = {}
): Promise<ZeiaHttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const auth = await getZeiaAuthHeader(cfg);
    const response = await fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...auth, ...(init.headers || {}) },
      signal: controller.signal,
    });
    const raw = await response.text();
    let data: unknown = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw;
    }
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** Construye un mensaje de error legible a partir del problem+json de ZEIA. */
function zeiaErrorMessage(result: ZeiaHttpResult): string {
  const d = result.data as Record<string, unknown> | null;
  if (d && typeof d === 'object') {
    const detail = (d.detail ?? d.message ?? d.error ?? d.title) as string | undefined;
    if (detail) return `ZEIA ${result.status}: ${detail}`;
  }
  if (typeof result.data === 'string' && result.data) return `ZEIA ${result.status}: ${result.data}`;
  return `ZEIA ${result.status}`;
}

/* ------------------------------------------------------------------------ */
/* Ejecución de una herramienta                                             */
/* ------------------------------------------------------------------------ */

function pickString(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return undefined;
}

/**
 * Captura el plan ZEIA (sus pasos) y, cuando se ejecuta, los resultados por
 * paso, en un mapa `plan_id -> plan`. El bucle de tools del chat lo usa para
 * devolver al editor 3D exactamente lo que ZEIA planificó/ejecutó, de modo que
 * la escena REAL del editor pueda reflejarlo (ver `lib/zeia-scene.ts`).
 *
 * `out` es el resultado crudo de `callZeiaTool` (de un `plan` o un `execute`).
 */
export function captureAppliedPlan(
  map: Map<string, ZeiaAppliedPlan>,
  call: ZeiaCall,
  out: unknown
): void {
  if (!out || typeof out !== 'object') return;
  const d = out as Record<string, unknown>;

  const steps: ZeiaPlanStep[] = Array.isArray(d.steps)
    ? (d.steps as unknown[])
        .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
        .map((s) => ({
          action: String(s.action || '').trim(),
          params: (s.params && typeof s.params === 'object' ? s.params : {}) as Record<string, unknown>,
        }))
        .filter((s) => s.action)
    : [];

  if (call.tool === 'plan') {
    const planId = typeof d.plan_id === 'string' ? d.plan_id : undefined;
    if (!planId) return;
    map.set(planId, {
      plan_id: planId,
      status: typeof d.status === 'string' ? d.status : 'proposed',
      intent: typeof call.args.intent === 'string' ? (call.args.intent as string) : undefined,
      steps,
    });
    return;
  }

  if (call.tool === 'execute') {
    const planId = pickString(call.args.plan_id, call.args.planId, call.args.id);
    if (!planId) return;
    const prev = map.get(planId);
    const results: ZeiaStepResult[] | undefined = Array.isArray(d.results)
      ? (d.results as unknown[])
          .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
          .map((r) => ({
            action: String(r.action || '').trim(),
            ok: r.ok !== false,
            ...(typeof r.object_id === 'string' ? { object_id: r.object_id } : {}),
            ...(typeof r.motion_id === 'string' ? { motion_id: r.motion_id } : {}),
          }))
      : prev?.results;
    map.set(planId, {
      plan_id: planId,
      status: typeof d.status === 'string' ? d.status : 'executed',
      intent: prev?.intent,
      steps: steps.length ? steps : prev?.steps ?? [],
      results,
    });
  }
}

/**
 * Ejecuta una llamada de herramienta contra ZEIA y devuelve un resultado
 * compacto (apto para realimentar al modelo). Lanza Error si ZEIA responde !ok.
 */
export async function callZeiaTool(call: ZeiaCall, cfg: ZeiaResolved): Promise<unknown> {
  const args = call.args || {};

  if (call.tool === 'context') {
    const r = await zeiaFetchJson(cfg, '/v1/ai/context', { method: 'GET' });
    if (!r.ok) throw new Error(zeiaErrorMessage(r));
    return r.data;
  }

  if (call.tool === 'plan') {
    const intent = pickString(args.intent, args.prompt, args._raw, args.value);
    if (!intent) throw new Error('falta "intent" en ZEIA_PLAN');
    const payload: Record<string, unknown> = { intent };
    const projectId = cfg.projectId ?? pickString(args.project_id);
    if (projectId) payload.project_id = projectId;
    const tabs = cfg.tabsAllowed ?? (Array.isArray(args.tabs_allowed) ? args.tabs_allowed : undefined);
    if (tabs) payload.tabs_allowed = tabs;
    if (cfg.planner ?? pickString(args.planner)) payload.planner = cfg.planner ?? args.planner;
    if (typeof args.context === 'object' && args.context) payload.context = args.context;
    const r = await zeiaFetchJson(cfg, '/v1/ai/plan', { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(zeiaErrorMessage(r));
    const d = r.data as Record<string, unknown>;
    return {
      plan_id: d.plan_id,
      planner: d.planner,
      status: d.status,
      warnings: d.warnings,
      steps: d.steps,
    };
  }

  if (call.tool === 'execute') {
    const planId = pickString(args.plan_id, args.planId, args.id);
    if (!planId) throw new Error('falta "plan_id" en ZEIA_EXECUTE');
    const autoApprove =
      typeof args.auto_approve === 'boolean' ? (args.auto_approve as boolean) : cfg.autoApprove;
    const r = await zeiaFetchJson(cfg, '/v1/ai/execute', {
      method: 'POST',
      body: JSON.stringify({ plan_id: planId, auto_approve: autoApprove }),
    });
    if (!r.ok) throw new Error(zeiaErrorMessage(r));
    return r.data;
  }

  // chat
  const message = pickString(args.message, args.prompt, args._raw, args.value);
  if (!message) throw new Error('falta "message" en ZEIA_CHAT');
  const r = await zeiaFetchJson(cfg, '/v1/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
  if (!r.ok) throw new Error(zeiaErrorMessage(r));
  return r.data;
}

/* ------------------------------------------------------------------------ */
/* Estado (para /api/zeia)                                                  */
/* ------------------------------------------------------------------------ */

export type ZeiaStatus = {
  enabled: boolean;
  baseUrl: string;
  reachable: boolean;
  health?: unknown;
  meta?: unknown;
  error?: string;
};

/** Comprueba si ZEIA está configurado y accesible, y devuelve su health/meta. */
export async function zeiaStatus(opts?: ZeiaOptions): Promise<ZeiaStatus> {
  const cfg = resolveZeiaOptions(opts);
  const out: ZeiaStatus = { enabled: cfg.enabled, baseUrl: cfg.baseUrl, reachable: false };
  try {
    const health = await zeiaFetchJson(cfg, '/health', { method: 'GET' });
    if (health.ok) {
      out.reachable = true;
      out.health = health.data;
      try {
        const meta = await zeiaFetchJson(cfg, '/v1/meta', { method: 'GET' });
        if (meta.ok) out.meta = meta.data;
      } catch {
        /* meta es opcional */
      }
    } else {
      out.error = zeiaErrorMessage(health);
    }
  } catch (error) {
    out.error = error instanceof Error ? error.message : String(error);
  }
  return out;
}
