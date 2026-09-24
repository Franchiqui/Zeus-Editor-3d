/**
 * Zeus Editor 3D Integration API (ZEIA) — implementación de referencia
 * -------------------------------------------------------------------
 * Puente REST (OpenAPI 3.1) entre modelos de IA y Zeus Editor 3D.
 * Implementa el contrato descrito en README.md / documentation.md:
 * auth, proyectos/sesiones, pestañas+prompts, plantillas, objetos 3D,
 * movimientos/animaciones, plugins, efectos, exportación y orquestación IA.
 *
 * Runtime: Node 18+ (probado en Node 22). Express 4 + Zod + Swagger UI.
 * Persistencia: en memoria (fuente de verdad) + espejo opcional de auditoría
 * a PocketBase si POCKETBASE_URL está definido.
 */
import express, { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import swaggerUi from 'swagger-ui-express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import PocketBase from 'pocketbase';

dotenv.config();

/* =========================================================================
 * Configuración
 * ========================================================================= */
const PORT = Number(process.env.PORT || 3012);
const BASE_PATH = '/v1';
const API_VERSION = '1.0.0';
const ERROR_BASE = 'https://api.zeus-editor.io/errors';
/** Duración simulada de jobs asíncronos (render/export) en segundos. */
const JOB_SECONDS = Math.max(1, Number(process.env.ZEIA_JOB_SECONDS || 5));
/** Exigir Authorization (Bearer/API key). Por defecto OFF para desarrollo. */
const REQUIRE_AUTH = String(process.env.ZEIA_REQUIRE_AUTH || '').toLowerCase() === 'true';
/** Rate limit por IP en req/min sobre /v1. 0 = deshabilitado. */
const RATE_LIMIT = Number(process.env.ZEIA_RATE_LIMIT || 0);
const POCKETBASE_URL = process.env.POCKETBASE_URL || '';
/** Permitir cualquier client_id/secret mientras no haya IdP real. */
const ALLOW_ANY_CLIENT =
  String(process.env.ZEIA_ALLOW_ANY_CLIENT ?? 'true').toLowerCase() !== 'false';

/* --- Modelo de chat (LLM) -------------------------------------------------
 * ZEIA puede delegar la interpretación de lenguaje natural al modelo de chat
 * que ya usa el editor. Prioridad:
 *   1) ZEIA_CHAT_URL -> puente al endpoint /api/chat de Zeus Media Studio-3D
 *      (reutiliza el proveedor/modelo/keys ya configurados por el usuario).
 *   2) ZEIA_LLM_URL  -> endpoint OpenAI-compatible (.../chat/completions):
 *      OpenAI, DeepSeek, Groq, Ollama, LM Studio, llama.cpp, etc.
 * Si ninguno está definido se usa el planificador heurístico local (sin red).
 */
const ZEIA_CHAT_URL = (process.env.ZEIA_CHAT_URL || '').replace(/\/+$/, '');
const ZEIA_CHAT_PROVIDER = process.env.ZEIA_CHAT_PROVIDER || '';
const ZEIA_CHAT_MODEL = process.env.ZEIA_CHAT_MODEL || '';
const ZEIA_CHAT_MODEL_RECORD_ID = process.env.ZEIA_CHAT_MODEL_RECORD_ID || '';
const ZEIA_LLM_URL = process.env.ZEIA_LLM_URL || '';
const ZEIA_LLM_API_KEY = process.env.ZEIA_LLM_API_KEY || '';
const ZEIA_LLM_MODEL = process.env.ZEIA_LLM_MODEL || 'gpt-4o-mini';
/** Timeout de las llamadas al modelo de chat (ms). */
const ZEIA_LLM_TIMEOUT_MS = Math.max(1000, Number(process.env.ZEIA_LLM_TIMEOUT_MS || 30000));
/** Máximo de tokens de la respuesta del modelo. */
const ZEIA_LLM_MAX_TOKENS = Math.max(64, Number(process.env.ZEIA_LLM_MAX_TOKENS || 1200));
/** Si es 'true', no se envían datos de objetos (ids) al modelo. */
const ZEIA_LLM_REDACT = String(process.env.ZEIA_LLM_REDACT || '').toLowerCase() === 'true';


/* =========================================================================
 * Utilidades
 * ========================================================================= */
const nowIso = (): string => new Date().toISOString();
const rid = (prefix: string): string =>
  `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
const slug = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/** Lectura robusta de un valor de query como string. */
function qs(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.length ? String(v[0]) : undefined;
  return String(v);
}
/** Lectura robusta de un valor de query como número entero. */
function qn(v: unknown, def: number): number {
  const s = qs(v);
  if (s === undefined) return def;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : def;
}
const qbool = (v: unknown): boolean => ['1', 'true', 'yes', 'on'].includes(String(qs(v) || '').toLowerCase());

/** Respuesta de error RFC 7807 (application/problem+json). */
function sendProblem(
  res: Response,
  status: number,
  title: string,
  detail?: string,
  instance?: string,
  type?: string
): Response {
  return res
    .status(status)
    .type('application/problem+json')
    .json({
      type: type || `${ERROR_BASE}/${slug(title) || 'generic'}`,
      title,
      status,
      detail,
      instance: instance || res.req.originalUrl,
    });
}

/** Filtro + paginación simple sobre listas en memoria. */
function listQuery<T extends Record<string, any>>(
  items: T[],
  req: Request,
  searchFields: string[] = ['name']
): T[] {
  const search = (qs(req.query.search) || '').toLowerCase();
  let out = items;
  if (search) {
    out = out.filter((it) =>
      searchFields.some((f) =>
        String(it?.[f] ?? '')
          .toLowerCase()
          .includes(search)
      )
    );
  }
  const page = qn(req.query.page, 1);
  const limit = qn(req.query.limit, 0); // 0 = sin límite
  if (limit > 0) {
    const start = Math.max(0, (page - 1) * limit);
    out = out.slice(start, start + limit);
  } else if (req.query.offset !== undefined) {
    out = out.slice(Math.max(0, qn(req.query.offset, 0)));
  }
  return out;
}

/** Sustitución de variables {{clave}} / {{clave.anidada}} en un texto. */
function renderTemplate(tpl: string, vars: Record<string, any>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const val = path.split('.').reduce<any>((acc, k) => (acc == null ? acc : acc[k]), vars);
    return val === undefined || val === null ? '' : String(val);
  });
}

/** Envuelve un handler async y propaga errores al error middleware. */
const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any> | any) =>
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      const r = fn(req, res, next);
      if (r && typeof r.then === 'function') r.catch(next);
    } catch (e) {
      next(e);
    }
  };

/* =========================================================================
 * Modelo de datos en memoria (seed)
 * ========================================================================= */
interface TabTool {
  name: string;
  description: string;
  schema: Record<string, string>;
}
interface TabDef {
  tab: string;
  name: string;
  description: string;
  icon: string;
  tools: TabTool[];
  system_prompt: string;
  constraints: Record<string, any>;
  examples: { input: string; output: any }[];
  allowed_actions: string[];
}

const VALID_TABS = [
  'modeling',
  'materials',
  'lighting',
  'animation',
  'rigging',
  'effects',
  'plugins',
  'render',
  'export',
  'scripting',
] as const;

const TABS: TabDef[] = [
  {
    tab: 'modeling',
    name: 'Modelado',
    description: 'Creación y edición de mallas, primitivas y jerarquías.',
    icon: 'cube',
    tools: [
      { name: 'create_object', description: 'Crea una primitiva o malla.', schema: { type: 'string', primitive: 'string', params: 'object' } },
      { name: 'transform_object', description: 'Mueve, rota o escala un objeto.', schema: { position: 'array', rotation: 'array', scale: 'array' } },
      { name: 'parent_object', description: 'Establece jerarquía padre/hijo.', schema: { parent_id: 'string' } },
    ],
    system_prompt:
      'Eres un asistente experto en modelado 3D dentro de Zeus Editor 3D. Usa primitivas y transformaciones coherentes.\n1. Define unidades en metros.\n2. No dejes objetos huérfanos sin parent salvo en la raíz.\n3. Nombra los objetos de forma descriptiva.\n4. Valida que la primitiva exista antes de crearla.',
    constraints: { units: 'meter', max_objects_per_batch: 200 },
    examples: [{ input: 'añade un cubo en el origen', output: { action: 'objects.create', type: 'mesh', primitive: 'cube', transform: { position: [0, 0, 0] } } }],
    allowed_actions: ['objects.create', 'objects.update', 'objects.delete', 'objects.duplicate', 'objects.parent', 'objects.batch', 'templates.create'],
  },
  {
    tab: 'materials',
    name: 'Materiales',
    description: 'Shaders PBR, texturas y propiedades de superficie.',
    icon: 'palette',
    tools: [
      { name: 'create_material', description: 'Crea un material PBR.', schema: { name: 'string', base_color: 'string', metallic: 'number', roughness: 'number' } },
      { name: 'assign_material', description: 'Asigna material a un objeto.', schema: { object_id: 'string', material_id: 'string' } },
    ],
    system_prompt:
      'Eres un asistente experto en materiales PBR. Genera materiales físicamente plausibles.\n1. metallic y roughness en [0,1].\n2. Usa colores en formato #RRGGBB.\n3. Evita valores de emisión excesivos.',
    constraints: { metallic_range: [0, 1], roughness_range: [0, 1] },
    examples: [{ input: 'material rojo metálico', output: { action: 'materials.create', base_color: '#FF0000', metallic: 1, roughness: 0.3 } }],
    allowed_actions: ['materials.create', 'materials.update', 'objects.update'],
  },
  {
    tab: 'lighting',
    name: 'Iluminación',
    description: 'Luces direccionales, puntuales, área y HDRI.',
    icon: 'sun',
    tools: [{ name: 'create_light', description: 'Crea una luz.', schema: { kind: 'string', intensity: 'number', color: 'string' } }],
    system_prompt:
      'Eres un asistente de iluminación 3D. Diseña esquemas coherentes (key/fill/rim).\n1. Intensidad en vatios o lux según el tipo.\n2. Evita sobreexposición.\n3. Usa temperatura de color realista.',
    constraints: { intensity_range: [0, 100000] },
    examples: [{ input: 'luz principal cálida', output: { action: 'objects.create', type: 'light', kind: 'directional', color: '#FFE0B2' } }],
    allowed_actions: ['objects.create', 'objects.update'],
  },
  {
    tab: 'animation',
    name: 'Animación',
    description: 'Keyframes, curvas de easing y trayectorias.',
    icon: 'film',
    tools: [
      { name: 'create_keyframe', description: 'Inserta un keyframe.', schema: { t: 'number', value: 'array', easing: 'string' } },
      { name: 'set_easing', description: 'Define la curva de easing.', schema: { curve: 'string' } },
      { name: 'add_constraint', description: 'Añade una restricción.', schema: { type: 'string', target: 'string' } },
    ],
    system_prompt:
      "Eres un asistente experto en animación 3D dentro de Zeus Editor 3D. Tu tarea es generar keyframes, curvas de easing y trayectorias coherentes. Reglas:\n1. Usa fps entre 12 y 120.\n2. Toda animación debe tener duración > 0.\n3. Prefiere easing 'easeInOut' salvo indicación contraria.\n4. No superes 500 keyframes por pista sin confirmación.\n5. Valida que el objeto referenciado exista antes de animar.",
    constraints: { max_duration: 600, fps_range: [12, 120], max_keyframes_per_track: 500 },
    examples: [{ input: 'haz que el cubo gire 360° en 3 segundos', output: { action: 'motions.create', type: 'rotate', duration: 3, degrees: 360 } }],
    allowed_actions: ['motions.create', 'motions.update', 'animations.create', 'animations.tracks', 'animations.keyframes', 'animations.play', 'animations.render'],
  },
  {
    tab: 'rigging',
    name: 'Rigging',
    description: 'Huesos, pesos y restricciones esqueléticas.',
    icon: 'bone',
    tools: [{ name: 'create_rig', description: 'Crea un rig esquelético.', schema: { bones: 'array', constraints: 'array' } }],
    system_prompt:
      'Eres un asistente de rigging. Crea jerarquías de huesos limpias y controladores.\n1. Un hueso raíz por personaje.\n2. Nombres consistentes (spine, arm.L, ...).\n3. Evita ciclos en la jerarquía.',
    constraints: { max_bones: 400 },
    examples: [{ input: 'rig humanoide básico', output: { action: 'templates.create', tab: 'rigging', name: 'Rig Humanoide Base' } }],
    allowed_actions: ['motions.create', 'templates.create'],
  },
  {
    tab: 'effects',
    name: 'Efectos',
    description: 'Post-proceso y efectos volumétricos.',
    icon: 'sparkles',
    tools: [
      { name: 'apply_effect', description: 'Aplica un efecto a escena/objeto.', schema: { name: 'string', target: 'string', params: 'object' } },
      { name: 'tune_effect', description: 'Ajusta parámetros de un efecto.', schema: { params: 'object' } },
    ],
    system_prompt:
      'Eres un asistente de efectos visuales. Aplica post-proceso con mesura.\n1. Bloom y DOF deben ser sutiles.\n2. La niebla no debe ocultar la escena.\n3. Documenta los parámetros aplicados.',
    constraints: { density_range: [0, 1] },
    examples: [{ input: 'añade niebla densa', output: { action: 'effects.apply', name: 'Dense Fog', params: { density: 0.8 } } }],
    allowed_actions: ['effects.create', 'effects.apply', 'effects.update', 'plugins.install'],
  },
  {
    tab: 'plugins',
    name: 'Plugins',
    description: 'Registro, instalación y capacidades de extensiones.',
    icon: 'plug',
    tools: [
      { name: 'install_plugin', description: 'Instala un plugin del catálogo.', schema: { id: 'string' } },
      { name: 'disable_plugin', description: 'Deshabilita un plugin.', schema: { id: 'string' } },
    ],
    system_prompt:
      'Eres un asistente de extensiones. Instala solo plugins compatibles y verifica capacidades.\n1. Comprueba compatibilidad de versión.\n2. Ejecuta en sandbox.\n3. Registra cada instalación para auditoría.',
    constraints: { allowed_sources: ['official', 'verified'] },
    examples: [{ input: 'instala niebla volumétrica', output: { action: 'plugins.install', id: 'plg_volumetric_fog' } }],
    allowed_actions: ['plugins.install', 'plugins.uninstall', 'plugins.enable', 'plugins.disable', 'plugins.register'],
  },
  {
    tab: 'render',
    name: 'Render',
    description: 'Presets de render y renderizado a video.',
    icon: 'camera',
    tools: [{ name: 'render_animation', description: 'Renderiza la animación actual.', schema: { format: 'string', fps: 'number', preset: 'string' } }],
    system_prompt:
      'Eres un asistente de render. Elige presets adecuados al destino.\n1. fps en [12,120].\n2. Usa H.264 para web, ProRes para master.\n3. Informa del tiempo estimado.',
    constraints: { formats: ['mp4', 'webm', 'mov', 'png_sequence'], fps_range: [12, 120] },
    examples: [{ input: 'renderiza a mp4 30fps', output: { action: 'animations.render', format: 'mp4', fps: 30 } }],
    allowed_actions: ['animations.render', 'exports.create'],
  },
  {
    tab: 'export',
    name: 'Exportación',
    description: 'Exportación multi-formato (glTF, FBX, OBJ, USDZ, MP4).',
    icon: 'download',
    tools: [{ name: 'export_scene', description: 'Exporta el proyecto/escena.', schema: { format: 'string', target: 'string' } }],
    system_prompt:
      'Eres un asistente de exportación. Elige el formato según el consumidor.\n1. glTF para web, FBX para DCC, OBJ para intercambio, USDZ para AR.\n2. Empaqueta texturas.\n3. Valida la integridad del resultado.',
    constraints: { formats: ['gltf', 'glb', 'fbx', 'obj', 'usdz', 'mp4'] },
    examples: [{ input: 'exporta a gltf', output: { action: 'exports.create', format: 'gltf' } }],
    allowed_actions: ['exports.create', 'exports.download'],
  },
  {
    tab: 'scripting',
    name: 'Scripting',
    description: 'Automatización mediante scripts del editor.',
    icon: 'code',
    tools: [{ name: 'run_script', description: 'Ejecuta un script en el editor.', schema: { language: 'string', source: 'string' } }],
    system_prompt:
      'Eres un asistente de scripting. Genera scripts idempotentes y seguros.\n1. No accedas a red sin permiso.\n2. Maneja errores.\n3. Limita la duración de ejecución.',
    constraints: { languages: ['js', 'ts', 'python'], max_runtime_seconds: 60 },
    examples: [{ input: 'selecciona todos los cubos', output: { action: 'scripts.run', language: 'js', source: '...' } }],
    allowed_actions: ['scripts.create', 'scripts.run'],
  },
];

const TAB_MAP: Record<string, TabDef> = Object.fromEntries(TABS.map((t) => [t.tab, t]));

/** Mapa acción -> pestaña (para validar ejecución IA). */
function tabForAction(action: string): string | undefined {
  for (const t of TABS) if (t.allowed_actions.includes(action)) return t.tab;
  const head = action.split('.')[0];
  const alias: Record<string, string> = {
    objects: 'modeling',
    materials: 'materials',
    motions: 'animation',
    animations: 'animation',
    plugins: 'plugins',
    effects: 'effects',
    exports: 'export',
    scripts: 'scripting',
  };
  return alias[head];
}

const DB = {
  projects: [] as any[],
  scenes: [] as any[],
  objects: [] as any[],
  templates: [] as any[],
  templateVersions: {} as Record<string, any[]>,
  motions: [] as any[],
  animations: [] as any[],
  plugins: [] as any[],
  effects: [] as any[],
  exports: [] as any[],
  plans: [] as any[],
  sessions: [] as any[],
  webhooks: [] as any[],
  apiKeys: [] as any[],
  tokens: [] as any[],
  feedback: [] as any[],
};

const EFFECT_CATALOG = [
  { name: 'Bloom', plugin_id: 'plg_bloom', description: 'Bloom HDR suave.', params: { intensity: 0.6, threshold: 0.8 } },
  { name: 'Dense Fog', plugin_id: 'plg_volumetric_fog', description: 'Niebla volumétrica densa.', params: { density: 0.8, color: '#AABBCC' } },
  { name: 'Depth of Field', plugin_id: 'plg_bloom', description: 'Desenfoque por profundidad.', params: { focus_distance: 8, aperture: 2.8 } },
  { name: 'Motion Blur', plugin_id: 'plg_bloom', description: 'Desenfoque de movimiento.', params: { samples: 16 } },
  { name: 'Particles Burst', plugin_id: 'plg_particles', description: 'Emisión de partículas.', params: { count: 2000, lifetime: 2 } },
];

function seed(): void {
  const prj = {
    id: rid('prj'),
    name: 'Bosque Encantado',
    owner_id: 'usr_123',
    created_at: nowIso(),
    updated_at: nowIso(),
    tabs: ['modeling', 'materials', 'lighting', 'animation', 'effects'],
    active_template_id: null as string | null,
  };
  DB.projects.push(prj);

  const scn = { id: rid('scn'), project_id: prj.id, name: 'Escena principal', created_at: nowIso() };
  DB.scenes.push(scn);

  const cube = {
    id: rid('obj'),
    scene_id: scn.id,
    name: 'Cube',
    type: 'mesh',
    geometry: { primitive: 'cube', params: { size: 1 } },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    material_id: null,
    parent_id: null,
    tags: ['seed'],
    created_at: nowIso(),
  };
  DB.objects.push(cube);

  const tpl = {
    id: rid('tpl'),
    tab: 'animation',
    name: 'Rig Humanoide Base',
    schema: { bones: [], constraints: [] },
    version: '1.2.0',
    created_by: 'ai:seed',
    project_id: prj.id,
    metadata: { tags: ['rig', 'humanoid'] },
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  DB.templates.push(tpl);
  prj.active_template_id = tpl.id;
  DB.templateVersions[tpl.id] = [{ version: '1.2.0', created_at: nowIso(), created_by: 'ai:seed', schema: tpl.schema }];

  DB.plugins.push(
    { id: 'plg_volumetric_fog', name: 'Volumetric Fog', version: '3.1.0', author: 'Zeus Labs', tab: 'effects', capabilities: ['fog', 'volumetrics'], status: 'available', source: 'official', installed_at: null },
    { id: 'plg_bloom', name: 'Bloom HDR', version: '2.0.1', author: 'Zeus Labs', tab: 'effects', capabilities: ['bloom', 'hdr'], status: 'installed', source: 'official', installed_at: nowIso() },
    { id: 'plg_particles', name: 'Particle System Pro', version: '1.4.0', author: 'Zeus Labs', tab: 'effects', capabilities: ['particles', 'gpu'], status: 'available', source: 'official', installed_at: null },
    { id: 'plg_rig_ik', name: 'IK Solver', version: '1.0.2', author: 'Zeus Labs', tab: 'rigging', capabilities: ['ik', 'constraints'], status: 'installed', source: 'official', installed_at: nowIso() },
    { id: 'plg_gltf_exporter', name: 'glTF Exporter', version: '4.2.0', author: 'Zeus Labs', tab: 'export', capabilities: ['gltf', 'glb'], status: 'installed', source: 'official', installed_at: nowIso() }
  );
}
seed();


/* =========================================================================
 * Bus de eventos (SSE + WebSocket + Webhooks)
 * ========================================================================= */
const bus = new EventEmitter();
bus.setMaxListeners(0);

interface SseClient {
  id: string;
  res: Response;
}
const sseClients = new Set<SseClient>();

interface WsClient {
  id: string;
  sessionId: string;
  socket: any;
}
const wsClients = new Set<WsClient>();

const KNOWN_EVENTS = [
  'project.created',
  'session.opened',
  'session.closed',
  'template.created',
  'template.applied',
  'object.created',
  'object.updated',
  'object.deleted',
  'motion.created',
  'animation.created',
  'animation.play',
  'animation.render.started',
  'animation.rendered',
  'plugin.installed',
  'plugin.uninstalled',
  'effect.applied',
  'export.requested',
  'export.completed',
  'ai.plan.created',
  'ai.executed',
];

function envelope(type: string, data: any) {
  return { id: rid('evt'), type, ts: nowIso(), data };
}

/** Emite un evento a SSE, WebSocket y webhooks suscritos. */
function emitEvent(type: string, data: any): any {
  const evt = envelope(type, data);
  bus.emit('event', evt);

  const ssePayload = `id: ${evt.id}\nevent: ${type}\ndata: ${JSON.stringify(evt)}\n\n`;
  for (const c of sseClients) {
    try {
      c.res.write(ssePayload);
    } catch {
      /* cliente desconectado */
    }
  }

  wsBroadcast({ type: 'event', event: evt });

  for (const wh of DB.webhooks) {
    if (wh.events.includes('*') || wh.events.includes(type)) deliverWebhook(wh, evt);
  }
  return evt;
}

/** Entrega (fire-and-forget) de un evento a un webhook registrado. */
function deliverWebhook(wh: any, evt: any): void {
  const record = { id: rid('dlv'), webhook_id: wh.id, event_id: evt.id, type: evt.type, at: nowIso(), ok: false, status: 0 };
  wh.deliveries = wh.deliveries || [];
  wh.deliveries.push(record);
  if (wh.deliveries.length > 100) wh.deliveries.shift();
  const f = (globalThis as any).fetch;
  if (typeof f !== 'function') return;
  f(wh.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-ZEIA-Event': evt.type, 'X-ZEIA-Delivery': record.id },
    body: JSON.stringify(evt),
  })
    .then((r: any) => {
      record.ok = r.ok;
      record.status = r.status;
    })
    .catch(() => {
      record.ok = false;
    });
}

/* =========================================================================
 * WebSocket mínimo (sin dependencias): /ws/session/{id}
 * ========================================================================= */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function wsAccept(key: string): string {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}
function wsEncode(payload: Buffer, opcode = 0x1): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}
function wsSend(client: WsClient, obj: any): void {
  try {
    if (client.socket && client.socket.writable) {
      client.socket.write(wsEncode(Buffer.from(JSON.stringify(obj), 'utf8')));
    }
  } catch {
    /* ignore */
  }
}
function wsBroadcast(obj: any, sessionId?: string): void {
  for (const c of wsClients) {
    if (!sessionId || c.sessionId === sessionId) wsSend(c, obj);
  }
}
const wsBuffers = new WeakMap<WsClient, Buffer>();
function wsHandleMessage(client: WsClient, msg: any): void {
  if (!msg || typeof msg !== 'object') return wsSend(client, { type: 'error', detail: 'invalid_message' });
  switch (msg.type) {
    case 'ping':
      return wsSend(client, { type: 'pong', ts: nowIso() });
    case 'subscribe':
      return wsSend(client, { type: 'subscribed', channel: msg.channel || '*', ts: nowIso() });
    case 'editor.action':
      emitEvent('editor.action', { session_id: client.sessionId, action: msg.action, params: msg.params });
      return wsSend(client, { type: 'ack', ts: nowIso() });
    default:
      return wsSend(client, { type: 'ack', ts: nowIso() });
  }
}
function wsParse(client: WsClient, chunk: Buffer): void {
  let buf = Buffer.concat([wsBuffers.get(client) || Buffer.alloc(0), chunk]);
  for (;;) {
    if (buf.length < 2) break;
    const b0 = buf[0];
    const b1 = buf[1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < 4) break;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) break;
      len = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }
    let maskKey: Buffer | null = null;
    if (masked) {
      if (buf.length < offset + 4) break;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + len) break;
    let payload = buf.subarray(offset, offset + len);
    if (maskKey) {
      const p = Buffer.alloc(len);
      for (let i = 0; i < len; i++) p[i] = payload[i] ^ maskKey[i % 4];
      payload = p;
    }
    buf = buf.subarray(offset + len);
    if (opcode === 0x8) {
      try {
        client.socket.end(wsEncode(Buffer.alloc(0), 0x8));
      } catch {
        /* ignore */
      }
      wsClients.delete(client);
      return;
    } else if (opcode === 0x9) {
      try {
        client.socket.write(wsEncode(payload, 0xa));
      } catch {
        /* ignore */
      }
    } else if (opcode === 0x1 || opcode === 0x0) {
      try {
        wsHandleMessage(client, JSON.parse(payload.toString('utf8')));
      } catch {
        wsSend(client, { type: 'error', detail: 'invalid_json' });
      }
    }
  }
  wsBuffers.set(client, buf);
}

/* =========================================================================
 * Jobs asíncronos simulados (render de animación / exportación)
 * ========================================================================= */
interface Job {
  id: string;
  kind: 'render' | 'export';
  ref_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  started_at: number;
  duration_ms: number;
  output_url: string | null;
  error: string | null;
  meta: any;
}
const jobs = new Map<string, Job>();

function createJob(kind: 'render' | 'export', refId: string, meta: any): Job {
  const job: Job = {
    id: rid('job'),
    kind,
    ref_id: refId,
    status: 'processing',
    progress: 0,
    started_at: Date.now(),
    duration_ms: JOB_SECONDS * 1000,
    output_url: null,
    error: null,
    meta,
  };
  jobs.set(job.id, job);
  return job;
}
function refreshJob(job: Job): Job {
  if (job.status === 'processing' || job.status === 'queued') {
    const elapsed = Date.now() - job.started_at;
    job.progress = Math.min(1, elapsed / job.duration_ms);
    if (elapsed >= job.duration_ms) {
      job.status = 'completed';
      job.progress = 1;
      job.output_url = `/v1/${job.kind === 'export' ? 'exports' : 'animations'}/${job.ref_id}/${job.kind === 'export' ? 'download' : 'render/output'}`;
      if (job.kind === 'export') {
        emitEvent('export.completed', { export_id: job.ref_id, job_id: job.id, output_url: job.output_url });
      } else {
        emitEvent('animation.rendered', { animation_id: job.ref_id, job_id: job.id, output_url: job.output_url });
      }
    }
  }
  return job;
}

/* =========================================================================
 * Espejo opcional de auditoría a PocketBase
 * ========================================================================= */
let pb: PocketBase | null = null;
if (POCKETBASE_URL) {
  try {
    pb = new PocketBase(POCKETBASE_URL);
  } catch {
    pb = null;
  }
}
/** Registra una acción en la colección `zeia_audit` (best-effort). */
function audit(action: string, target: string, payload?: any): void {
  if (!pb) return;
  try {
    const p = pb;
    p.collection('zeia_audit')
      .create({ action, target, payload: payload ?? {}, ts: nowIso() })
      .catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/* =========================================================================
 * App + middleware base
 * ========================================================================= */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(cors({ origin: true, credentials: true, exposedHeaders: ['X-Request-Id'] }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Request id
app.use((req: Request, res: Response, next: NextFunction) => {
  const id = (req.headers['x-request-id'] as string) || rid('req');
  (req as any).id = id;
  res.setHeader('X-Request-Id', id);
  next();
});

// Rate limiting (token bucket por IP) solo sobre /v1
const buckets = new Map<string, { tokens: number; ts: number }>();
function rateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!RATE_LIMIT || !req.path.startsWith(BASE_PATH)) return next();
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const refill = (RATE_LIMIT / 60) * ((now - (buckets.get(ip)?.ts ?? now)) / 1000);
  const b = buckets.get(ip) || { tokens: RATE_LIMIT, ts: now };
  b.tokens = Math.min(RATE_LIMIT, b.tokens + refill);
  b.ts = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    res.setHeader('Retry-After', '1');
    return void sendProblem(res, 429, 'Rate limit excedido', `Máximo ${RATE_LIMIT} req/min por IP.`);
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  next();
}
app.use(rateLimit);

/* =========================================================================
 * Autenticación (opcional) + scopes
 * ========================================================================= */
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!REQUIRE_AUTH || !req.path.startsWith(BASE_PATH)) return next();
  if (req.path.startsWith(`${BASE_PATH}/auth`)) return next();
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const apiKey = String(req.headers['x-api-key'] || '');
  let principal: { kind: string; scopes: string[] } | null = null;
  if (bearer) {
    const t = DB.tokens.find((x) => x.access_token === bearer && x.expires_at > Date.now());
    if (t) principal = { kind: 'token', scopes: t.scopes || [] };
  }
  if (!principal && apiKey) {
    const k = DB.apiKeys.find((x) => x.api_key === apiKey && !x.revoked);
    if (k) principal = { kind: 'api_key', scopes: k.scopes || [] };
  }
  if (!principal) {
    return void sendProblem(res, 401, 'No autenticado', 'Se requiere Authorization: Bearer <token> o cabecera X-API-Key.', req.originalUrl, `${ERROR_BASE}/unauthorized`);
  }
  (req as any).principal = principal;
  next();
}
app.use(authMiddleware);

function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!REQUIRE_AUTH) return next();
    const p = (req as any).principal as { scopes: string[] } | undefined;
    if (!p) return void sendProblem(res, 401, 'No autenticado', undefined, req.originalUrl, `${ERROR_BASE}/unauthorized`);
    if (p.scopes.includes('*') || p.scopes.includes(scope)) return next();
    return void sendProblem(res, 403, 'Sin permisos', `Se requiere el scope '${scope}'.`, req.originalUrl, `${ERROR_BASE}/forbidden`);
  };
}

/* =========================================================================
 * Schemas Zod
 * ========================================================================= */
const ProjectCreate = z.object({
  name: z.string().min(1),
  owner_id: z.string().optional(),
  tabs: z.array(z.string()).optional(),
  active_template_id: z.string().nullable().optional(),
});
const TemplateCreate = z.object({
  tab: z.enum(VALID_TABS as unknown as [string, ...string[]]),
  name: z.string().min(1),
  schema: z.record(z.any()).optional(),
  version: z.string().optional(),
  created_by: z.string().optional(),
  project_id: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});
const ObjectCreate = z.object({
  name: z.string().optional(),
  type: z.enum(['mesh', 'light', 'camera', 'empty', 'particle']),
  geometry: z.record(z.any()).optional(),
  transform: z.record(z.any()).optional(),
  material_id: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});
const MotionCreate = z.object({
  type: z.enum(['translate', 'rotate', 'scale', 'path', 'physics']),
  keyframes: z.array(z.record(z.any())).optional(),
  duration: z.number().optional(),
  loop: z.boolean().optional(),
});
const AnimationCreate = z.object({
  project_id: z.string().optional(),
  name: z.string().min(1),
  duration: z.number().positive().optional(),
  fps: z.number().int().min(1).max(240).optional(),
  tracks: z.array(z.record(z.any())).optional(),
  render_preset: z.string().optional(),
});
const PluginRegister = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  version: z.string().optional(),
  author: z.string().optional(),
  tab: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  manifest: z.record(z.any()).optional(),
});
const EffectCreate = z.object({
  name: z.string().min(1),
  plugin_id: z.string().optional(),
  params: z.record(z.any()).optional(),
  applied_to: z.array(z.string()).optional(),
});
const ExportCreate = z.object({
  format: z.enum(['gltf', 'glb', 'fbx', 'obj', 'usdz', 'mp4']),
  target: z.string().optional(),
  project_id: z.string().optional(),
  scene_id: z.string().optional(),
  options: z.record(z.any()).optional(),
});
const PlannerMode = z.enum(['auto', 'llm', 'heuristic']);
const PlanCreate = z.object({
  intent: z.string().min(1),
  project_id: z.string().optional(),
  tabs_allowed: z.array(z.string()).optional(),
  auto_approve: z.boolean().optional(),
  /** 'auto' (def.): usa el modelo de chat si está conectado; si no, heurístico.
   *  'llm': exige el modelo (503 si no hay). 'heuristic': solo reglas locales. */
  planner: PlannerMode.optional(),
  /** Override del modelo a usar (modo puente u OpenAI-compatible). */
  model: z.string().optional(),
  /** Contexto adicional para el modelo (selección, preferencias, etc.). */
  context: z.record(z.any()).optional(),
});
const ChatRequest = z.object({
  message: z.string().min(1),
  system: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  model: z.string().optional(),
  history: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
});
const ExecuteRequest = z.object({
  plan_id: z.string().min(1),
  auto_approve: z.boolean().optional(),
});
const WebhookCreate = z.object({
  url: z.string().url(),
  events: z.array(z.string()).optional(),
  secret: z.string().optional(),
});
const TokenRequest = z.object({
  grant_type: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});
const ApiKeyCreate = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  ip_allowlist: z.array(z.string()).optional(),
});
const FeedbackCreate = z.object({
  plan_id: z.string().optional(),
  rating: z.number().optional(),
  comment: z.string().optional(),
  context: z.record(z.any()).optional(),
});


/* =========================================================================
 * Rutas — Sistema
 * ========================================================================= */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'ZEIA', version: API_VERSION, ts: nowIso(), uptime_s: Math.round(process.uptime()), model: llmStatus() });
});

app.get('/v1/meta', (_req: Request, res: Response) => {
  res.json({
    service: 'Zeus Editor 3D Integration API',
    acronym: 'ZEIA',
    version: API_VERSION,
    base_path: BASE_PATH,
    tabs: VALID_TABS,
    events: KNOWN_EVENTS,
    model: llmStatus(),
    docs: '/api-docs',
    openapi: '/openapi.json',
  });
});

/* =========================================================================
 * Rutas — Autenticación
 * ========================================================================= */
function issueToken(scopes: string[]): any {
  const t = {
    access_token: randomBytes(32).toString('base64url'),
    refresh_token: randomBytes(32).toString('base64url'),
    token_type: 'Bearer',
    expires_in: 3600,
    expires_at: Date.now() + 3600 * 1000,
    scopes,
    created_at: nowIso(),
  };
  DB.tokens.push(t);
  return t;
}

app.post('/v1/auth/token', (req: Request, res: Response) => {
  const parsed = TokenRequest.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  const { client_id, client_secret, grant_type } = parsed.data;
  if (!ALLOW_ANY_CLIENT) {
    const ok = client_id === 'zeus-ai' && client_secret === (process.env.ZEIA_CLIENT_SECRET || 'zeus-ai-secret');
    if (!ok) return void sendProblem(res, 401, 'Credenciales inválidas', 'client_id/client_secret incorrectos.', req.originalUrl, `${ERROR_BASE}/unauthorized`);
  }
  const gt = grant_type || 'client_credentials';
  if (!['client_credentials', 'password', 'refresh_token'].includes(gt)) {
    return void sendProblem(res, 400, 'grant_type no soportado', `Se recibió '${gt}'.`);
  }
  const scopes = (parsed.data.scope ? parsed.data.scope.split(/\s+/) : []).filter(Boolean);
  const t = issueToken(scopes.length ? scopes : ['*']);
  audit('auth.token', client_id || parsed.data.username || 'anonymous', { grant_type: gt });
  res.status(201).json({
    access_token: t.access_token,
    token_type: 'Bearer',
    expires_in: t.expires_in,
    refresh_token: t.refresh_token,
    scope: t.scopes.join(' '),
  });
});

app.post('/v1/auth/refresh', (req: Request, res: Response) => {
  const rt = String(req.body?.refresh_token || '');
  const prev = DB.tokens.find((t) => t.refresh_token === rt);
  if (!prev) return void sendProblem(res, 401, 'Refresh token inválido', undefined, req.originalUrl, `${ERROR_BASE}/unauthorized`);
  const t = issueToken(prev.scopes || ['*']);
  res.status(201).json({ access_token: t.access_token, token_type: 'Bearer', expires_in: t.expires_in, refresh_token: t.refresh_token, scope: t.scopes.join(' ') });
});

app.post('/v1/auth/api-keys', requireScope('auth:write'), (req: Request, res: Response) => {
  const parsed = ApiKeyCreate.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  const key = {
    id: rid('key'),
    name: parsed.data.name,
    api_key: `zc_${randomBytes(24).toString('hex')}`,
    scopes: parsed.data.scopes || ['*'],
    ip_allowlist: parsed.data.ip_allowlist || [],
    revoked: false,
    created_at: nowIso(),
  };
  DB.apiKeys.push(key);
  audit('auth.api_key.created', key.id, { name: key.name });
  res.status(201).json({ ...key, api_key: key.api_key, warning: 'Guarda la api_key: no se volverá a mostrar.' });
});

app.get('/v1/auth/api-keys', requireScope('auth:write'), (_req: Request, res: Response) => {
  res.json(DB.apiKeys.map(({ api_key, ...rest }) => rest));
});

app.delete('/v1/auth/api-keys/:id', requireScope('auth:write'), (req: Request, res: Response) => {
  const k = DB.apiKeys.find((x) => x.id === req.params.id);
  if (!k) return void sendProblem(res, 404, 'Recurso no encontrado', `api-key ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  k.revoked = true;
  res.status(204).send();
});

/* =========================================================================
 * Rutas — Proyectos y Sesiones
 * ========================================================================= */
app.get('/v1/projects', (req: Request, res: Response) => {
  res.json(listQuery(DB.projects, req));
});

app.post('/v1/projects', requireScope('projects:write'), (req: Request, res: Response) => {
  const parsed = ProjectCreate.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  const prj = {
    id: rid('prj'),
    name: parsed.data.name,
    owner_id: parsed.data.owner_id || 'usr_anonymous',
    tabs: parsed.data.tabs || ['modeling', 'materials', 'animation'],
    active_template_id: parsed.data.active_template_id ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  DB.projects.push(prj);
  const scn = { id: rid('scn'), project_id: prj.id, name: 'Escena principal', created_at: nowIso() };
  DB.scenes.push(scn);
  emitEvent('project.created', { project_id: prj.id, name: prj.name });
  audit('project.created', prj.id, { name: prj.name });
  res.status(201).json(prj);
});

app.get('/v1/projects/:id', (req: Request, res: Response) => {
  const p = DB.projects.find((x) => x.id === req.params.id);
  if (!p) return void sendProblem(res, 404, 'Recurso no encontrado', `project ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  res.json({
    ...p,
    scenes: DB.scenes.filter((s) => s.project_id === p.id),
    templates: DB.templates.filter((t) => t.project_id === p.id),
    animations: DB.animations.filter((a) => a.project_id === p.id),
  });
});

app.patch('/v1/projects/:id', requireScope('projects:write'), (req: Request, res: Response) => {
  const p = DB.projects.find((x) => x.id === req.params.id);
  if (!p) return void sendProblem(res, 404, 'Recurso no encontrado', `project ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const allowed = ['name', 'tabs', 'active_template_id', 'owner_id'];
  for (const k of allowed) if (k in (req.body || {})) p[k] = req.body[k];
  p.updated_at = nowIso();
  audit('project.updated', p.id, req.body);
  res.json(p);
});

app.delete('/v1/projects/:id', requireScope('projects:write'), (req: Request, res: Response) => {
  const i = DB.projects.findIndex((x) => x.id === req.params.id);
  if (i === -1) return void sendProblem(res, 404, 'Recurso no encontrado', `project ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const [removed] = DB.projects.splice(i, 1);
  DB.scenes = DB.scenes.filter((s) => s.project_id !== removed.id);
  audit('project.deleted', removed.id);
  res.status(204).send();
});

app.post('/v1/projects/:id/sessions', (req: Request, res: Response) => {
  const p = DB.projects.find((x) => x.id === req.params.id);
  if (!p) return void sendProblem(res, 404, 'Recurso no encontrado', `project ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const session = {
    id: rid('ses'),
    project_id: p.id,
    ws_url: `/ws/session/${rid('ses')}`,
    status: 'open',
    opened_at: nowIso(),
  };
  session.ws_url = `/ws/session/${session.id}`;
  DB.sessions.push(session);
  emitEvent('session.opened', { session_id: session.id, project_id: p.id });
  res.status(201).json(session);
});

app.delete('/v1/sessions/:id', (req: Request, res: Response) => {
  const s = DB.sessions.find((x) => x.id === req.params.id);
  if (!s) return void sendProblem(res, 404, 'Recurso no encontrado', `session ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  s.status = 'closed';
  s.closed_at = nowIso();
  emitEvent('session.closed', { session_id: s.id });
  res.status(204).send();
});

/* =========================================================================
 * Rutas — Pestañas y Prompts (núcleo IA)
 * ========================================================================= */
app.get('/v1/tabs', (_req: Request, res: Response) => {
  res.json(
    TABS.map((t) => ({
      tab: t.tab,
      name: t.name,
      description: t.description,
      icon: t.icon,
      tools: t.tools.length,
      allowed_actions: t.allowed_actions,
    }))
  );
});

function getTabOr404(tab: string, res: Response): TabDef | null {
  const t = TAB_MAP[tab];
  if (!t) {
    sendProblem(res, 404, 'Pestaña no encontrada', `'${tab}' no es una pestaña válida. Válidas: ${VALID_TABS.join(', ')}`, undefined, `${ERROR_BASE}/unknown-tab`);
    return null;
  }
  return t;
}

app.get('/v1/tabs/:tab', (req: Request, res: Response) => {
  const t = getTabOr404(req.params.tab, res);
  if (!t) return;
  res.json({ tab: t.tab, name: t.name, description: t.description, icon: t.icon, allowed_actions: t.allowed_actions, constraints: t.constraints, tool_count: t.tools.length });
});

app.get('/v1/tabs/:tab/tools', (req: Request, res: Response) => {
  const t = getTabOr404(req.params.tab, res);
  if (!t) return;
  res.json(t.tools);
});

app.get('/v1/tabs/:tab/prompt', (req: Request, res: Response) => {
  const t = getTabOr404(req.params.tab, res);
  if (!t) return;
  res.json({ tab: t.tab, version: '1.0', system_prompt: t.system_prompt, tools: t.tools, examples: t.examples, constraints: t.constraints });
});

app.post('/v1/tabs/:tab/prompt/render', (req: Request, res: Response) => {
  const t = getTabOr404(req.params.tab, res);
  if (!t) return;
  const vars = (req.body && typeof req.body.variables === 'object' && req.body.variables) || {};
  res.json({ tab: t.tab, version: '1.0', rendered: renderTemplate(t.system_prompt, vars), variables: vars });
});

app.get('/v1/tabs/:tab/schema', (req: Request, res: Response) => {
  const t = getTabOr404(req.params.tab, res);
  if (!t) return;
  res.json({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `ZeusEditor.${t.tab}.operations`,
    type: 'object',
    properties: {
      action: { type: 'string', enum: t.allowed_actions, description: 'Acción a ejecutar.' },
      params: { type: 'object', description: 'Parámetros específicos de la acción.' },
    },
    required: ['action'],
    additionalProperties: false,
  });
});

/* =========================================================================
 * Rutas — Plantillas
 * ========================================================================= */
app.get('/v1/templates', (req: Request, res: Response) => {
  let out = DB.templates;
  const tab = qs(req.query.tab);
  if (tab) out = out.filter((t) => t.tab === tab);
  const pid = qs(req.query.project_id);
  if (pid) out = out.filter((t) => t.project_id === pid);
  res.json(listQuery(out, req));
});

app.post('/v1/templates', requireScope('templates:write'), (req: Request, res: Response) => {
  const parsed = TemplateCreate.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  const d = parsed.data;
  const tpl = {
    id: rid('tpl'),
    tab: d.tab,
    name: d.name,
    schema: d.schema || {},
    version: d.version || '1.0.0',
    created_by: d.created_by || 'manual',
    project_id: d.project_id || null,
    metadata: d.metadata || { tags: [] },
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  DB.templates.push(tpl);
  DB.templateVersions[tpl.id] = [{ version: tpl.version, created_at: tpl.created_at, created_by: tpl.created_by, schema: tpl.schema }];
  emitEvent('template.created', { template_id: tpl.id, tab: tpl.tab });
  audit('template.created', tpl.id, { tab: tpl.tab });
  res.status(201).json(tpl);
});

app.get('/v1/templates/:id', (req: Request, res: Response) => {
  const t = DB.templates.find((x) => x.id === req.params.id);
  if (!t) return void sendProblem(res, 404, 'Recurso no encontrado', `template ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  res.json(t);
});

app.put('/v1/templates/:id', requireScope('templates:write'), (req: Request, res: Response) => {
  const i = DB.templates.findIndex((x) => x.id === req.params.id);
  if (i === -1) return void sendProblem(res, 404, 'Recurso no encontrado', `template ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const parsed = TemplateCreate.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((x) => x.message).join('; '));
  const prev = DB.templates[i];
  const d = parsed.data;
  const next = { ...prev, tab: d.tab, name: d.name, schema: d.schema || {}, version: d.version || prev.version, created_by: d.created_by || prev.created_by, project_id: d.project_id ?? prev.project_id, metadata: d.metadata || prev.metadata, updated_at: nowIso() };
  DB.templates[i] = next;
  (DB.templateVersions[next.id] = DB.templateVersions[next.id] || []).push({ version: next.version, created_at: next.updated_at, created_by: next.created_by, schema: next.schema });
  res.json(next);
});

app.patch('/v1/templates/:id', requireScope('templates:write'), (req: Request, res: Response) => {
  const t = DB.templates.find((x) => x.id === req.params.id);
  if (!t) return void sendProblem(res, 404, 'Recurso no encontrado', `template ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const allowed = ['tab', 'name', 'schema', 'version', 'metadata', 'project_id'];
  for (const k of allowed) if (k in (req.body || {})) t[k] = req.body[k];
  t.updated_at = nowIso();
  (DB.templateVersions[t.id] = DB.templateVersions[t.id] || []).push({ version: t.version, created_at: t.updated_at, created_by: t.created_by, schema: t.schema });
  res.json(t);
});

app.delete('/v1/templates/:id', requireScope('templates:write'), (req: Request, res: Response) => {
  const i = DB.templates.findIndex((x) => x.id === req.params.id);
  if (i === -1) return void sendProblem(res, 404, 'Recurso no encontrado', `template ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  DB.templates.splice(i, 1);
  delete DB.templateVersions[req.params.id];
  res.status(204).send();
});

app.post('/v1/templates/:id/apply', (req: Request, res: Response) => {
  const t = DB.templates.find((x) => x.id === req.params.id);
  if (!t) return void sendProblem(res, 404, 'Recurso no encontrado', `template ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const { project_id, scene_id } = req.body || {};
  const project = DB.projects.find((p) => p.id === project_id) || DB.projects.find((p) => p.id === t.project_id);
  if (project) project.active_template_id = t.id;
  emitEvent('template.applied', { template_id: t.id, project_id: project?.id || null, scene_id: scene_id || null });
  audit('template.applied', t.id, { project_id: project?.id || null });
  res.json({ applied: true, template_id: t.id, project_id: project?.id || null, scene_id: scene_id || null, applied_at: nowIso() });
});

app.post('/v1/templates/:id/clone', requireScope('templates:write'), (req: Request, res: Response) => {
  const t = DB.templates.find((x) => x.id === req.params.id);
  if (!t) return void sendProblem(res, 404, 'Recurso no encontrado', `template ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const overrides = (req.body && req.body.overrides) || {};
  const clone = { ...t, ...overrides, id: rid('tpl'), name: (req.body?.name) || `${t.name} (copia)`, version: '1.0.0', created_by: req.body?.created_by || 'clone', created_at: nowIso(), updated_at: nowIso() };
  DB.templates.push(clone);
  DB.templateVersions[clone.id] = [{ version: clone.version, created_at: clone.created_at, created_by: clone.created_by, schema: clone.schema }];
  res.status(201).json(clone);
});

app.get('/v1/templates/:id/versions', (req: Request, res: Response) => {
  const t = DB.templates.find((x) => x.id === req.params.id);
  if (!t) return void sendProblem(res, 404, 'Recurso no encontrado', `template ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  res.json(DB.templateVersions[t.id] || []);
});


/* =========================================================================
 * Rutas — Objetos 3D
 * ========================================================================= */
function defaultTransform(): any {
  return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

app.get('/v1/scenes/:sceneId/objects', (req: Request, res: Response) => {
  const scn = DB.scenes.find((s) => s.id === req.params.sceneId);
  if (!scn) return void sendProblem(res, 404, 'Recurso no encontrado', `scene ${req.params.sceneId}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  res.json(listQuery(DB.objects.filter((o) => o.scene_id === scn.id), req));
});

app.post('/v1/scenes/:sceneId/objects', requireScope('objects:write'), (req: Request, res: Response) => {
  const scn = DB.scenes.find((s) => s.id === req.params.sceneId);
  if (!scn) return void sendProblem(res, 404, 'Recurso no encontrado', `scene ${req.params.sceneId}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const parsed = ObjectCreate.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  const d = parsed.data;
  const obj = {
    id: rid('obj'),
    scene_id: scn.id,
    name: d.name || `${d.type}_${DB.objects.length + 1}`,
    type: d.type,
    geometry: d.geometry || (d.type === 'mesh' ? { primitive: 'cube', params: { size: 1 } } : {}),
    transform: { ...defaultTransform(), ...(d.transform || {}) },
    material_id: d.material_id ?? null,
    parent_id: d.parent_id ?? null,
    tags: d.tags || ['generated'],
    created_at: nowIso(),
  };
  DB.objects.push(obj);
  emitEvent('object.created', { object_id: obj.id, scene_id: scn.id, type: obj.type });
  audit('object.created', obj.id, { type: obj.type, scene_id: scn.id });
  res.status(201).json(obj);
});

app.get('/v1/scenes/:sceneId', (req: Request, res: Response) => {
  const scn = DB.scenes.find((s) => s.id === req.params.sceneId);
  if (!scn) return void sendProblem(res, 404, 'Recurso no encontrado', `scene ${req.params.sceneId}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  res.json({ ...scn, objects: DB.objects.filter((o) => o.scene_id === scn.id) });
});

app.get('/v1/objects/:id', (req: Request, res: Response) => {
  const o = DB.objects.find((x) => x.id === req.params.id);
  if (!o) return void sendProblem(res, 404, 'Recurso no encontrado', `object ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  res.json({ ...o, motions: DB.motions.filter((m) => m.object_id === o.id), children: DB.objects.filter((c) => c.parent_id === o.id).map((c) => c.id) });
});

app.patch('/v1/objects/:id', requireScope('objects:write'), (req: Request, res: Response) => {
  const o = DB.objects.find((x) => x.id === req.params.id);
  if (!o) return void sendProblem(res, 404, 'Recurso no encontrado', `object ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const allowed = ['name', 'geometry', 'transform', 'material_id', 'parent_id', 'tags'];
  for (const k of allowed) if (k in (req.body || {})) o[k] = req.body[k];
  o.updated_at = nowIso();
  emitEvent('object.updated', { object_id: o.id, scene_id: o.scene_id });
  res.json(o);
});

app.delete('/v1/objects/:id', requireScope('objects:write'), (req: Request, res: Response) => {
  const i = DB.objects.findIndex((x) => x.id === req.params.id);
  if (i === -1) return void sendProblem(res, 404, 'Recurso no encontrado', `object ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const [removed] = DB.objects.splice(i, 1);
  DB.motions = DB.motions.filter((m) => m.object_id !== removed.id);
  DB.objects.forEach((c) => {
    if (c.parent_id === removed.id) c.parent_id = null;
  });
  emitEvent('object.deleted', { object_id: removed.id, scene_id: removed.scene_id });
  res.status(204).send();
});

app.post('/v1/objects/:id/duplicate', requireScope('objects:write'), (req: Request, res: Response) => {
  const o = DB.objects.find((x) => x.id === req.params.id);
  if (!o) return void sendProblem(res, 404, 'Recurso no encontrado', `object ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const copy = { ...o, id: rid('obj'), name: req.body?.name || `${o.name} (copia)`, created_at: nowIso() };
  DB.objects.push(copy);
  emitEvent('object.created', { object_id: copy.id, scene_id: copy.scene_id, duplicated_from: o.id });
  res.status(201).json(copy);
});

app.post('/v1/objects/:id/parent', requireScope('objects:write'), (req: Request, res: Response) => {
  const o = DB.objects.find((x) => x.id === req.params.id);
  if (!o) return void sendProblem(res, 404, 'Recurso no encontrado', `object ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const parentId = req.body?.parent_id ?? null;
  if (parentId) {
    const parent = DB.objects.find((x) => x.id === parentId);
    if (!parent) return void sendProblem(res, 404, 'Recurso no encontrado', `parent ${parentId}`, req.originalUrl, `${ERROR_BASE}/not-found`);
    if (parentId === o.id) return void sendProblem(res, 409, 'Conflicto de jerarquía', 'Un objeto no puede ser padre de sí mismo.', req.originalUrl, `${ERROR_BASE}/conflict`);
  }
  o.parent_id = parentId;
  o.updated_at = nowIso();
  res.json({ object_id: o.id, parent_id: o.parent_id });
});

app.post('/v1/objects/batch', requireScope('objects:write'), (req: Request, res: Response) => {
  const ops = Array.isArray(req.body?.operations) ? req.body.operations : [];
  if (!ops.length) return void sendProblem(res, 400, 'Payload inválido', "Se espera { operations: [...] }.", req.originalUrl, `${ERROR_BASE}/bad-request`);
  const results: any[] = [];
  for (const op of ops) {
    try {
      switch (op.op) {
        case 'create': {
          const scn = DB.scenes.find((s) => s.id === op.scene_id) || DB.scenes[0];
          const parsed = ObjectCreate.safeParse(op.data || {});
          if (!parsed.success || !scn) throw new Error('invalid_create');
          const obj = { id: rid('obj'), scene_id: scn.id, name: parsed.data.name || 'object', type: parsed.data.type, geometry: parsed.data.geometry || {}, transform: { ...defaultTransform(), ...(parsed.data.transform || {}) }, material_id: parsed.data.material_id ?? null, parent_id: parsed.data.parent_id ?? null, tags: parsed.data.tags || ['generated'], created_at: nowIso() };
          DB.objects.push(obj);
          results.push({ op: 'create', ok: true, id: obj.id });
          break;
        }
        case 'update': {
          const o = DB.objects.find((x) => x.id === op.id);
          if (!o) throw new Error('not_found');
          Object.assign(o, op.data || {});
          o.updated_at = nowIso();
          results.push({ op: 'update', ok: true, id: o.id });
          break;
        }
        case 'delete': {
          const idx = DB.objects.findIndex((x) => x.id === op.id);
          if (idx === -1) throw new Error('not_found');
          DB.objects.splice(idx, 1);
          results.push({ op: 'delete', ok: true, id: op.id });
          break;
        }
        default:
          results.push({ op: op.op, ok: false, error: 'unsupported_op' });
      }
    } catch (e: any) {
      results.push({ op: op.op, ok: false, error: e?.message || 'error' });
    }
  }
  audit('objects.batch', 'batch', { count: ops.length });
  res.json({ requested: ops.length, results });
});

/* =========================================================================
 * Rutas — Movimiento y Animación
 * ========================================================================= */
app.post('/v1/objects/:id/motions', requireScope('objects:write'), (req: Request, res: Response) => {
  const o = DB.objects.find((x) => x.id === req.params.id);
  if (!o) return void sendProblem(res, 404, 'Recurso no encontrado', `object ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const parsed = MotionCreate.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  const d = parsed.data;
  let keyframes = d.keyframes;
  if (!keyframes || !keyframes.length) {
    const dur = d.duration ?? 5;
    const to = d.type === 'rotate' ? [0, 360, 0] : d.type === 'translate' ? [1, 0, 0] : [2, 2, 2];
    keyframes = [
      { t: 0, value: d.type === 'rotate' ? [0, 0, 0] : [0, 0, 0], easing: 'easeInOut' },
      { t: dur, value: to, easing: 'easeInOut' },
    ];
  }
  const motion = { id: rid('mot'), object_id: o.id, type: d.type, keyframes, loop: d.loop ?? false, duration: d.duration ?? (keyframes[keyframes.length - 1]?.t || 5), created_at: nowIso() };
  DB.motions.push(motion);
  emitEvent('motion.created', { motion_id: motion.id, object_id: o.id, type: motion.type });
  audit('motion.created', motion.id, { object_id: o.id, type: motion.type });
  res.status(201).json(motion);
});

app.get('/v1/objects/:id/motions', (req: Request, res: Response) => {
  const o = DB.objects.find((x) => x.id === req.params.id);
  if (!o) return void sendProblem(res, 404, 'Recurso no encontrado', `object ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  res.json(DB.motions.filter((m) => m.object_id === o.id));
});

app.patch('/v1/motions/:id', requireScope('objects:write'), (req: Request, res: Response) => {
  const m = DB.motions.find((x) => x.id === req.params.id);
  if (!m) return void sendProblem(res, 404, 'Recurso no encontrado', `motion ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const allowed = ['type', 'keyframes', 'loop', 'duration'];
  for (const k of allowed) if (k in (req.body || {})) m[k] = req.body[k];
  if (!m.duration && Array.isArray(m.keyframes) && m.keyframes.length) m.duration = m.keyframes[m.keyframes.length - 1].t;
  res.json(m);
});

app.delete('/v1/motions/:id', requireScope('objects:write'), (req: Request, res: Response) => {
  const i = DB.motions.findIndex((x) => x.id === req.params.id);
  if (i === -1) return void sendProblem(res, 404, 'Recurso no encontrado', `motion ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  DB.motions.splice(i, 1);
  res.status(204).send();
});

app.get('/v1/animations', (req: Request, res: Response) => {
  res.json(listQuery(DB.animations, req));
});

app.post('/v1/animations', requireScope('objects:write'), (req: Request, res: Response) => {
  const parsed = AnimationCreate.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  const d = parsed.data;
  const fps = d.fps ?? 30;
  if (fps < 12 || fps > 120) {
    return void sendProblem(res, 422, 'Acción IA inválida', `fps=${fps} fuera del rango permitido [12,120].`, req.originalUrl, `${ERROR_BASE}/invalid-action`);
  }
  const anim = { id: rid('anm'), project_id: d.project_id || DB.projects[0]?.id || null, name: d.name, duration: d.duration ?? 5, fps, tracks: d.tracks || [], render_preset: d.render_preset || '1080p_h264', created_at: nowIso() };
  DB.animations.push(anim);
  emitEvent('animation.created', { animation_id: anim.id, name: anim.name });
  audit('animation.created', anim.id, { name: anim.name });
  res.status(201).json(anim);
});

app.get('/v1/animations/:id', (req: Request, res: Response) => {
  const a = DB.animations.find((x) => x.id === req.params.id);
  if (!a) return void sendProblem(res, 404, 'Recurso no encontrado', `animation ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const job = [...jobs.values()].reverse().find((j) => j.kind === 'render' && j.ref_id === a.id);
  res.json({ ...a, render_job: job ? { id: job.id, status: refreshJob(job).status, progress: job.progress, output_url: job.output_url } : null });
});

app.post('/v1/animations/:id/tracks', requireScope('objects:write'), (req: Request, res: Response) => {
  const a = DB.animations.find((x) => x.id === req.params.id);
  if (!a) return void sendProblem(res, 404, 'Recurso no encontrado', `animation ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const { object_id, motion_id } = req.body || {};
  if (!object_id || !motion_id) return void sendProblem(res, 400, 'Payload inválido', 'Se requieren object_id y motion_id.', req.originalUrl, `${ERROR_BASE}/bad-request`);
  if (!DB.objects.some((o) => o.id === object_id)) return void sendProblem(res, 422, 'Acción IA inválida', `El objeto '${object_id}' no existe.`, req.originalUrl, `${ERROR_BASE}/invalid-action`);
  const track = { id: rid('trk'), object_id, motion_id };
  a.tracks.push(track);
  res.status(201).json(track);
});

app.post('/v1/animations/:id/keyframes', requireScope('objects:write'), (req: Request, res: Response) => {
  const a = DB.animations.find((x) => x.id === req.params.id);
  if (!a) return void sendProblem(res, 404, 'Recurso no encontrado', `animation ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const { track_id, keyframes } = req.body || {};
  const track = a.tracks.find((t: any) => t.id === track_id) || a.tracks[0];
  if (!track) return void sendProblem(res, 400, 'Payload inválido', 'No hay pista destino (track_id).', req.originalUrl, `${ERROR_BASE}/bad-request`);
  const kfs = Array.isArray(keyframes) ? keyframes : [];
  const motion = DB.motions.find((m) => m.id === track.motion_id);
  if (motion) {
    const merged = [...(motion.keyframes || []), ...kfs].sort((x, y) => x.t - y.t);
    if (merged.length > 500) return void sendProblem(res, 422, 'Acción IA inválida', 'No se permiten más de 500 keyframes por pista sin confirmación.', req.originalUrl, `${ERROR_BASE}/invalid-action`);
    motion.keyframes = merged;
  }
  res.status(201).json({ animation_id: a.id, track_id: track.id, added: kfs.length, total: motion?.keyframes.length ?? kfs.length });
});

app.post('/v1/animations/:id/play', (req: Request, res: Response) => {
  const a = DB.animations.find((x) => x.id === req.params.id);
  if (!a) return void sendProblem(res, 404, 'Recurso no encontrado', `animation ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  emitEvent('animation.play', { animation_id: a.id });
  wsBroadcast({ type: 'play', animation_id: a.id, ts: nowIso() });
  res.json({ playing: true, animation_id: a.id, started_at: nowIso() });
});

app.post('/v1/animations/:id/render', requireScope('render:write'), (req: Request, res: Response) => {
  const a = DB.animations.find((x) => x.id === req.params.id);
  if (!a) return void sendProblem(res, 404, 'Recurso no encontrado', `animation ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const job = createJob('render', a.id, { format: req.body?.format || 'mp4', fps: req.body?.fps || a.fps, preset: req.body?.preset || a.render_preset });
  emitEvent('animation.render.started', { animation_id: a.id, job_id: job.id });
  audit('animation.render', a.id, { job_id: job.id });
  res.status(202).json({ animation_id: a.id, job_id: job.id, status: job.status, poll_url: `/v1/animations/${a.id}/status` });
});

app.get('/v1/animations/:id/status', (req: Request, res: Response) => {
  const a = DB.animations.find((x) => x.id === req.params.id);
  if (!a) return void sendProblem(res, 404, 'Recurso no encontrado', `animation ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const job = [...jobs.values()].reverse().find((j) => j.kind === 'render' && j.ref_id === a.id);
  if (!job) return res.json({ animation_id: a.id, status: 'idle', progress: 0, output_url: null });
  refreshJob(job);
  res.json({ animation_id: a.id, job_id: job.id, status: job.status, progress: job.progress, output_url: job.output_url, error: job.error });
});

app.get('/v1/animations/:id/render/output', (req: Request, res: Response) => {
  const a = DB.animations.find((x) => x.id === req.params.id);
  if (!a) return void sendProblem(res, 404, 'Recurso no encontrado', `animation ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const job = [...jobs.values()].reverse().find((j) => j.kind === 'render' && j.ref_id === a.id);
  if (!job || refreshJob(job).status !== 'completed') return void sendProblem(res, 409, 'Render no disponible', 'El render aún no ha finalizado.', req.originalUrl, `${ERROR_BASE}/conflict`);
  const body = { animation_id: a.id, format: job.meta.format, fps: job.meta.fps, duration: a.duration, generated_at: nowIso(), note: 'Placeholder de render (implementación de referencia).' };
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${a.name.replace(/\s+/g, '_')}.${job.meta.format === 'mp4' ? 'json' : job.meta.format}"`);
  res.send(Buffer.from(JSON.stringify(body, null, 2)));
});

/* =========================================================================
 * Rutas — Plugins
 * ========================================================================= */
app.get('/v1/plugins', (req: Request, res: Response) => {
  let out = DB.plugins;
  const status = qs(req.query.status);
  if (status) out = out.filter((p) => p.status === status);
  const tab = qs(req.query.tab);
  if (tab) out = out.filter((p) => p.tab === tab);
  res.json(listQuery(out, req));
});

app.get('/v1/plugins/:id', (req: Request, res: Response) => {
  const p = DB.plugins.find((x) => x.id === req.params.id);
  if (!p) return void sendProblem(res, 404, 'Recurso no encontrado', `plugin ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  res.json(p);
});

app.post('/v1/plugins', requireScope('plugins:install'), (req: Request, res: Response) => {
  const parsed = PluginRegister.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  const d = parsed.data;
  const plugin = { id: d.id || rid('plg'), name: d.name, version: d.version || '0.1.0', author: d.author || 'unknown', tab: d.tab || 'plugins', capabilities: d.capabilities || [], status: 'available', source: 'community', manifest: d.manifest || null, installed_at: null, created_at: nowIso() };
  DB.plugins.push(plugin);
  audit('plugin.registered', plugin.id, { name: plugin.name });
  res.status(201).json(plugin);
});

function pluginState(req: Request, res: Response, next: NextFunction, fn: (p: any) => void): void {
  const p = DB.plugins.find((x) => x.id === req.params.id);
  if (!p) return void sendProblem(res, 404, 'Recurso no encontrado', `plugin ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  fn(p);
}

app.post('/v1/plugins/:id/install', requireScope('plugins:install'), (req: Request, res: Response) => {
  pluginState(req, res, () => {}, (p) => {
    p.status = 'installed';
    p.installed_at = nowIso();
    emitEvent('plugin.installed', { plugin_id: p.id, name: p.name, version: p.version });
    audit('plugin.installed', p.id, { version: p.version });
    res.json(p);
  });
});

app.post('/v1/plugins/:id/uninstall', requireScope('plugins:install'), (req: Request, res: Response) => {
  pluginState(req, res, () => {}, (p) => {
    p.status = 'available';
    p.installed_at = null;
    emitEvent('plugin.uninstalled', { plugin_id: p.id, name: p.name });
    res.json(p);
  });
});

app.post('/v1/plugins/:id/enable', requireScope('plugins:install'), (req: Request, res: Response) => {
  pluginState(req, res, () => {}, (p) => {
    p.status = 'installed';
    res.json(p);
  });
});

app.post('/v1/plugins/:id/disable', requireScope('plugins:install'), (req: Request, res: Response) => {
  pluginState(req, res, () => {}, (p) => {
    p.status = 'disabled';
    res.json(p);
  });
});

app.get('/v1/plugins/:id/capabilities', (req: Request, res: Response) => {
  pluginState(req, res, () => {}, (p) => {
    res.json({ plugin_id: p.id, capabilities: p.capabilities, status: p.status });
  });
});


/* =========================================================================
 * Rutas — Efectos
 * ========================================================================= */
app.get('/v1/effects', (_req: Request, res: Response) => {
  res.json({
    catalog: EFFECT_CATALOG.map((e) => ({ ...e, kind: 'catalog' })),
    instances: DB.effects.map((e) => ({ ...e, kind: 'instance' })),
  });
});

app.post('/v1/effects', requireScope('effects:write'), (req: Request, res: Response) => {
  const parsed = EffectCreate.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  const d = parsed.data;
  const cat = EFFECT_CATALOG.find((e) => e.name.toLowerCase() === d.name.toLowerCase());
  const eff = {
    id: rid('eff'),
    plugin_id: d.plugin_id || cat?.plugin_id || null,
    name: d.name,
    params: d.params || cat?.params || {},
    applied_to: d.applied_to || [],
    created_at: nowIso(),
  };
  DB.effects.push(eff);
  audit('effect.created', eff.id, { name: eff.name });
  res.status(201).json(eff);
});

app.patch('/v1/effects/:id', requireScope('effects:write'), (req: Request, res: Response) => {
  const e = DB.effects.find((x) => x.id === req.params.id);
  if (!e) return void sendProblem(res, 404, 'Recurso no encontrado', `effect ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  if (req.body?.params) e.params = { ...e.params, ...req.body.params };
  if (req.body?.name) e.name = req.body.name;
  e.updated_at = nowIso();
  res.json(e);
});

app.delete('/v1/effects/:id', requireScope('effects:write'), (req: Request, res: Response) => {
  const i = DB.effects.findIndex((x) => x.id === req.params.id);
  if (i === -1) return void sendProblem(res, 404, 'Recurso no encontrado', `effect ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  DB.effects.splice(i, 1);
  res.status(204).send();
});

app.post('/v1/effects/:id/apply', requireScope('effects:write'), (req: Request, res: Response) => {
  const e = DB.effects.find((x) => x.id === req.params.id);
  if (!e) return void sendProblem(res, 404, 'Recurso no encontrado', `effect ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const targets = req.body?.targets || (req.body?.target ? [req.body.target] : e.applied_to);
  e.applied_to = Array.from(new Set([...(e.applied_to || []), ...targets]));
  emitEvent('effect.applied', { effect_id: e.id, name: e.name, targets: e.applied_to });
  audit('effect.applied', e.id, { targets: e.applied_to });
  res.json({ applied: true, effect_id: e.id, applied_to: e.applied_to, applied_at: nowIso() });
});

app.post('/v1/effects/:id/preview', (req: Request, res: Response) => {
  const e = DB.effects.find((x) => x.id === req.params.id);
  if (!e) return void sendProblem(res, 404, 'Recurso no encontrado', `effect ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const ttl = Math.max(5, JOB_SECONDS);
  res.json({ preview_id: rid('prv'), effect_id: e.id, url: `/v1/effects/${e.id}/preview/render.png`, expires_in: ttl, params: e.params });
});

app.get('/v1/effects/:id/preview/render.png', (req: Request, res: Response) => {
  const e = DB.effects.find((x) => x.id === req.params.id);
  if (!e) return void sendProblem(res, 404, 'Recurso no encontrado', `effect ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  // PNG 1x1 transparente como placeholder
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.send(png);
});

/* =========================================================================
 * Rutas — Exportación
 * ========================================================================= */
app.post('/v1/exports', requireScope('exports:write'), (req: Request, res: Response) => {
  const parsed = ExportCreate.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  const d = parsed.data;
  const job = createJob('export', '', { format: d.format });
  const exp = {
    id: rid('exp'),
    format: d.format,
    target: d.target || d.scene_id || d.project_id || 'scene',
    project_id: d.project_id || DB.projects[0]?.id || null,
    scene_id: d.scene_id || null,
    options: d.options || {},
    status: job.status,
    job_id: job.id,
    output_url: null as string | null,
    created_at: nowIso(),
  };
  job.ref_id = exp.id;
  exp.output_url = `/v1/exports/${exp.id}/download`;
  DB.exports.push(exp);
  emitEvent('export.requested', { export_id: exp.id, format: exp.format });
  audit('export.requested', exp.id, { format: exp.format });
  res.status(202).json(exp);
});

function refreshExport(exp: any): any {
  const job = jobs.get(exp.job_id);
  if (job) {
    refreshJob(job);
    exp.status = job.status;
    exp.progress = job.progress;
    if (job.status === 'completed') exp.output_url = `/v1/exports/${exp.id}/download`;
  }
  return exp;
}

app.get('/v1/exports', (req: Request, res: Response) => {
  res.json(listQuery(DB.exports, req, ['format', 'target']).map((e) => refreshExport({ ...e })));
});

app.get('/v1/exports/:id', (req: Request, res: Response) => {
  const e = DB.exports.find((x) => x.id === req.params.id);
  if (!e) return void sendProblem(res, 404, 'Recurso no encontrado', `export ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  res.json(refreshExport({ ...e }));
});

app.get('/v1/exports/:id/download', (req: Request, res: Response) => {
  const e = DB.exports.find((x) => x.id === req.params.id);
  if (!e) return void sendProblem(res, 404, 'Recurso no encontrado', `export ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  refreshExport(e);
  if (e.status !== 'completed') return void sendProblem(res, 409, 'Exportación no disponible', `Estado actual: ${e.status}.`, req.originalUrl, `${ERROR_BASE}/conflict`);
  const manifest = {
    export_id: e.id,
    format: e.format,
    target: e.target,
    scene_id: e.scene_id,
    project_id: e.project_id,
    options: e.options,
    generated_at: nowIso(),
    assets: DB.objects.filter((o) => !e.scene_id || o.scene_id === e.scene_id).map((o) => ({ id: o.id, name: o.name, type: o.type })),
    note: 'Asset placeholder de la implementación de referencia ZEIA.',
  };
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${e.target}.${e.format}.json"`);
  res.send(Buffer.from(JSON.stringify(manifest, null, 2)));
});

/* =========================================================================
 * Rutas — Orquestación IA
 * ========================================================================= */
function planFromIntent(intent: string, opts: { project_id?: string; tabs_allowed?: string[] }): { steps: any[]; warnings: string[] } {
  const text = intent.toLowerCase();
  const steps: any[] = [];
  const warnings: string[] = [];

  // Objetos
  if (/\b(cubo|cube|box|caja)\b/.test(text)) steps.push({ action: 'objects.create', params: { type: 'mesh', primitive: 'cube' } });
  if (/\b(esfera|sphere|bola)\b/.test(text)) steps.push({ action: 'objects.create', params: { type: 'mesh', primitive: 'sphere' } });
  if (/\b(plano|plane|suelo|ground)\b/.test(text)) steps.push({ action: 'objects.create', params: { type: 'mesh', primitive: 'plane' } });
  if (/\b(cono|cone|cilindro|cylinder|torus|toro)\b/.test(text)) steps.push({ action: 'objects.create', params: { type: 'mesh', primitive: 'cone' } });
  if (/\b(luz|light|iluminacion|iluminación|lámpara|lampara)\b/.test(text)) steps.push({ action: 'objects.create', params: { type: 'light' } });
  if (/\b(c[aá]mara|camera)\b/.test(text)) steps.push({ action: 'objects.create', params: { type: 'camera' } });

  // Movimientos
  const rot = text.match(/(\d{1,4})\s*(°|grados|degrees|deg)/);
  if (/\b(gir|rotar|rotaci[oó]n|rotate|spin)\b/.test(text)) steps.push({ action: 'motions.create', params: { type: 'rotate', duration: 5, degrees: rot ? Number(rot[1]) : 360 } });
  if (/\b(mover|mueve|trasladar|translate|move|desplaz)/.test(text)) steps.push({ action: 'motions.create', params: { type: 'translate', duration: 5 } });
  if (/\b(escalar|scale|agrandar|ampliar)\b/.test(text)) steps.push({ action: 'motions.create', params: { type: 'scale', duration: 5 } });
  if (/\b(animad[oa]|anima|animar|animaci[oó]n|keyframe|keyframes|movimiento)\b/.test(text) && !steps.some((s) => s.action === 'motions.create')) steps.push({ action: 'motions.create', params: { type: 'rotate', duration: 5 } });

  // Plugins / efectos
  if (/\b(niebla|fog|neblina|volumetric)/.test(text)) {
    steps.push({ action: 'plugins.install', params: { id: 'plg_volumetric_fog' } });
    steps.push({ action: 'effects.apply', params: { name: 'Dense Fog', params: { density: 0.8 } } });
  }
  if (/\b(bloom|brillo|glow)\b/.test(text)) steps.push({ action: 'effects.apply', params: { name: 'Bloom' } });
  if (/\b(part[ií]culas|particles|chispas|sparks)\b/.test(text)) steps.push({ action: 'effects.apply', params: { name: 'Particles Burst' } });
  if (/\b(dof|profundidad de campo|depth of field|desenfoque)\b/.test(text)) steps.push({ action: 'effects.apply', params: { name: 'Depth of Field' } });

  // Render / export
  if (/\b(mp4|video|render|renderiza|renderizar)\b/.test(text)) steps.push({ action: 'animations.render', params: { format: 'mp4', fps: 30 } });
  if (/\b(gltf|glb)\b/.test(text)) steps.push({ action: 'exports.create', params: { format: 'gltf' } });
  if (/\bfbx\b/.test(text)) steps.push({ action: 'exports.create', params: { format: 'fbx' } });
  if (/\bobj\b/.test(text)) steps.push({ action: 'exports.create', params: { format: 'obj' } });
  if (/\busdz\b/.test(text)) steps.push({ action: 'exports.create', params: { format: 'usdz' } });

  if (!steps.length) {
    steps.push({ action: 'objects.create', params: { type: 'mesh', primitive: 'cube' } });
    warnings.push('Intención no reconocida con precisión; se propone crear un cubo por defecto.');
  }

  if (opts.tabs_allowed && opts.tabs_allowed.length) {
    const filtered = steps.filter((s) => {
      const tab = tabForAction(s.action);
      return !tab || opts.tabs_allowed!.includes(tab);
    });
    if (filtered.length !== steps.length) warnings.push('Algunos pasos se omitieron por restricciones de tabs_allowed.');
    return { steps: filtered, warnings };
  }
  return { steps, warnings };
}

/* =========================================================================
 * Cliente del modelo de chat (LLM) — planificador inteligente opcional
 * -------------------------------------------------------------------------
 * Conecta ZEIA con el modelo de chat (dos modos, el puente tiene prioridad):
 *   'chat'   -> ZEIA_CHAT_URL = /api/chat del editor (reutiliza su modelo).
 *   'openai' -> ZEIA_LLM_URL  = endpoint OpenAI-compatible /chat/completions.
 * Si no hay modelo conectado, /ai/plan usa el planificador heurístico local.
 * ========================================================================= */
type LlmMode = 'chat' | 'openai';

/** Modo del modelo de chat activo, o null si no hay ninguno conectado. */
function llmMode(): LlmMode | null {
  if (ZEIA_CHAT_URL) return 'chat';
  if (ZEIA_LLM_URL) return 'openai';
  return null;
}

/** Estado de la conexión con el modelo (para /health y /v1/meta). */
function llmStatus() {
  const mode = llmMode();
  return {
    connected: !!mode,
    mode: mode || 'none',
    endpoint: mode === 'chat' ? ZEIA_CHAT_URL : mode === 'openai' ? ZEIA_LLM_URL : null,
    model: mode === 'chat' ? ZEIA_CHAT_MODEL || '(auto del editor)' : mode === 'openai' ? ZEIA_LLM_MODEL : null,
    fallback: 'heuristic',
    redact: ZEIA_LLM_REDACT,
  };
}

/** Acciones que el planificador puede proponer (solo las ejecutables). */
const EXECUTABLE_ACTIONS: string[] = [
  'objects.create',
  'objects.update',
  'objects.delete',
  'objects.duplicate',
  'objects.parent',
  'motions.create',
  'animations.create',
  'animations.render',
  'plugins.install',
  'plugins.uninstall',
  'effects.apply',
  'effects.create',
  'exports.create',
];

/** Catálogo compacto "acción -> parámetros" para el prompt de sistema. */
function actionSpec(): string {
  const effects = EFFECT_CATALOG.map((e) => e.name).join(', ');
  const plugins = DB.plugins.map((p) => p.id + ' (' + p.name + ')').join(', ');
  return [
    "objects.create     {type:'mesh'|'light'|'camera', primitive?:'cube'|'sphere'|'cylinder'|'torus'|'cone'|'plane', name?, transform?:{position:[x,y,z],rotation:[x,y,z],scale:[x,y,z]}, parent_id?}",
    'objects.update     {id, patch:{...}}',
    'objects.delete     {id}  /* DESTRUCTIVA */',
    'objects.duplicate  {id}',
    'objects.parent     {id, parent_id:null|string}',
    "motions.create     {object_id?, type:'rotate'|'translate'|'scale'|'physics', duration?:number(s), degrees?:number, loop?:boolean}",
    'animations.create  {name?, duration?:number, fps?:number}',
    "animations.render  {format:'mp4', fps?:number}",
    'plugins.install    {id}  /* catálogo: ' + plugins + ' */',
    'plugins.uninstall  {id}  /* DESTRUCTIVA */',
    'effects.apply      {name, target?|targets?:[], params?:{}}  /* catálogo: ' + effects + ' */',
    'effects.create     {name, params?:{}}',
    "exports.create     {format:'gltf'|'glb'|'fbx'|'obj'|'usdz'|'mp4', target?, options?}",
  ].join('\n');
}

/** Ejemplos (entrada -> plan) de las tabs, como guía few-shot del modelo. */
function fewShotExamples(tabsAllowed?: string[] | null): string {
  const out: string[] = [];
  for (const t of TABS) {
    if (tabsAllowed && tabsAllowed.length && !tabsAllowed.includes(t.tab)) continue;
    for (const ex of t.examples || []) {
      const o: any = ex.output || {};
      const params: any = {};
      for (const k of Object.keys(o)) if (k !== 'action') params[k] = o[k];
      out.push('- "' + ex.input + '" => ' + JSON.stringify({ steps: [{ action: o.action, params }] }));
    }
  }
  return out.join('\n');
}

/** Prompt de sistema del planificador (acciones, parámetros y ejemplos). */
function buildPlannerSystem(tabsAllowed?: string[] | null): string {
  const allowed = EXECUTABLE_ACTIONS.filter((a) => {
    const tab = tabForAction(a);
    return !tabsAllowed || !tabsAllowed.length || !tab || tabsAllowed.includes(tab);
  });
  return [
    'Eres el planificador de acciones de ZEUS EDITOR 3D (ZEIA).',
    'Conviertes una instrucción en lenguaje natural (español o inglés) en un PLAN de acciones JSON.',
    '',
    'REGLAS ESTRICTAS:',
    '- Responde ÚNICAMENTE con un objeto JSON válido (sin markdown ni texto extra).',
    '- Formato exacto: {"steps":[{"action":"<accion>","params":{...}}],"warnings":["..."]}',
    '- Si algo se crea y luego se anima, incluye primero objects.create y después motions.create (referenciando ese objeto).',
    '- Reutiliza objetos existentes si el usuario los menciona por nombre.',
    '- No inventes acciones fuera de la lista permitida.',
    '- Añade en "warnings" cualquier suposición (unidades, radio por defecto, etc.).',
    '',
    'ACCIONES PERMITIDAS:',
    allowed.join(', '),
    '',
    'PARÁMETROS POR ACCIÓN:',
    actionSpec(),
    '',
    'EJEMPLOS:',
    fewShotExamples(tabsAllowed),
  ].join('\n');
}

/** Prompt de usuario con el contexto actual (objetos existentes, etc.). */
function buildPlannerUser(intent: string, ctx: any, projectId?: string | null): string {
  const parts = ['INSTRUCCIÓN: ' + intent];
  if (projectId) parts.push('PROYECTO: ' + projectId);
  if (ctx && Object.keys(ctx).length) parts.push('CONTEXTO_EXTRA: ' + JSON.stringify(ctx));
  if (!ZEIA_LLM_REDACT) {
    const objs = DB.objects.slice(-40).map((o) => ({ id: o.id, name: o.name, type: o.type, primitive: o.geometry ? o.geometry.primitive : undefined }));
    parts.push('OBJETOS_ACTUALES: ' + JSON.stringify(objs));
  }
  return parts.join('\n');
}

/* --- Transporte HTTP (fetch con timeout) -------------------------------- */
async function httpJson(
  method: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ status: number; json: any; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined || body === null ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* el cuerpo no era JSON */
    }
    return { status: r.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/** Resuelve proveedor/modelo del editor (puente). Cachea 5 minutos. */
let chatModelCache: { provider: string; model: string; modelRecordId?: string; at: number } | null = null;
async function resolveChatModel(override?: string): Promise<{ provider: string; model: string; modelRecordId?: string }> {
  if (ZEIA_CHAT_PROVIDER && ZEIA_CHAT_MODEL) {
    return { provider: ZEIA_CHAT_PROVIDER, model: override || ZEIA_CHAT_MODEL, modelRecordId: ZEIA_CHAT_MODEL_RECORD_ID || undefined };
  }
  if (chatModelCache && Date.now() - chatModelCache.at < 300000 && !override) return chatModelCache;
  const modelsUrl = process.env.ZEIA_CHAT_MODELS_URL || ZEIA_CHAT_URL.replace(/\/api\/chat$/, '/api/modelos');
  const userId = process.env.ZEIA_CHAT_USER_ID || '';
  if (!userId) throw new Error('chat_model_unresolved (define ZEIA_CHAT_PROVIDER+ZEIA_CHAT_MODEL o ZEIA_CHAT_USER_ID)');
  const { status, json } = await httpJson('GET', modelsUrl + '?user=' + encodeURIComponent(userId), null, {}, ZEIA_LLM_TIMEOUT_MS);
  if (status >= 400 || !json || !Array.isArray(json.records)) throw new Error('chat_models_unavailable');
  const rec = json.records.find((m: any) => !m.is_vision) || json.records[0];
  if (!rec) throw new Error('chat_model_unresolved');
  chatModelCache = { provider: String(rec.proveedor || ''), model: override || String(rec.id_modelo || rec.nombre_modelo || ''), modelRecordId: rec.id, at: Date.now() };
  return chatModelCache;
}

/** Llama al modelo de chat y devuelve el texto de la respuesta. */
async function callChatModel(
  system: string,
  user: string,
  opts: { model?: string; temperature?: number; history?: Array<{ role: string; content: string }> }
): Promise<string> {
  const mode = llmMode();
  if (mode === 'chat') {
    const cfg = await resolveChatModel(opts.model);
    const payload: any = {
      mode: 'text',
      provider: cfg.provider,
      model: cfg.model,
      history: opts.history || [],
      newMessage: { role: 'user', content: user },
      systemContext: system,
    };
    if (cfg.modelRecordId) payload.modelRecordId = cfg.modelRecordId;
    const { status, json, text } = await httpJson('POST', ZEIA_CHAT_URL, payload, {}, ZEIA_LLM_TIMEOUT_MS);
    if (status >= 400) throw new Error('chat_http_' + status + ':' + ((json && (json.error || json.message)) || text.slice(0, 180)));
    const reply = json && (json.text ?? json.reply ?? json.answer ?? json.content);
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('chat_empty_reply');
    return reply;
  }
  if (mode === 'openai') {
    const headers: Record<string, string> = {};
    if (ZEIA_LLM_API_KEY) headers.authorization = 'Bearer ' + ZEIA_LLM_API_KEY;
    const base: any = {
      model: opts.model || ZEIA_LLM_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: opts.temperature ?? 0.2,
      max_tokens: ZEIA_LLM_MAX_TOKENS,
    };
    let r = await httpJson('POST', ZEIA_LLM_URL, { ...base, response_format: { type: 'json_object' } }, headers, ZEIA_LLM_TIMEOUT_MS);
    if (r.status === 400 || r.status === 422) r = await httpJson('POST', ZEIA_LLM_URL, base, headers, ZEIA_LLM_TIMEOUT_MS);
    if (r.status >= 400) {
      const msg = r.json && r.json.error ? r.json.error.message || r.json.error : r.text.slice(0, 180);
      throw new Error('llm_http_' + r.status + ':' + msg);
    }
    const reply = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message ? r.json.choices[0].message.content : r.json && (r.json.message ? r.json.message.content : r.json.response);
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('llm_empty_reply');
    return reply;
  }
  throw new Error('llm_not_configured');
}

/** Extrae el primer objeto JSON de un texto (tolera vallas ```json). */
function extractJson(text: string): any | null {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    /* intenta recortar */
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      /* no-JSON */
    }
  }
  return null;
}

/** Normaliza los pasos del modelo a {action, params} validados contra la whitelist. */
function normalizeSteps(raw: any): { steps: any[]; warnings: string[] } {
  const warnings: string[] = [];
  const arr = Array.isArray(raw) ? raw : raw && Array.isArray(raw.steps) ? raw.steps : [];
  const steps: any[] = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const action = String(it.action || '').trim();
    if (!action) continue;
    if (!EXECUTABLE_ACTIONS.includes(action)) {
      warnings.push('Acción ignorada (no permitida): ' + action);
      continue;
    }
    const params: any = it.params && typeof it.params === 'object' ? { ...it.params } : {};
    for (const k of Object.keys(it)) if (k !== 'action' && k !== 'params') params[k] = it[k];
    steps.push({ action, params });
  }
  return { steps, warnings };
}

/** Genera un plan usando el modelo de chat. Lanza si no hay modelo o si falla. */
async function llmPlan(
  intent: string,
  opts: { project_id?: string | null; tabs_allowed?: string[]; context?: any; model?: string }
): Promise<{ steps: any[]; warnings: string[] }> {
  if (!llmMode()) throw new Error('llm_not_configured');
  const system = buildPlannerSystem(opts.tabs_allowed);
  const user = buildPlannerUser(intent, opts.context, opts.project_id);
  const raw = await callChatModel(system, user, { model: opts.model });
  const parsed = extractJson(raw);
  if (!parsed) throw new Error('llm_invalid_json');
  const norm = normalizeSteps(parsed);
  const warnings = norm.warnings.slice();
  if (parsed && Array.isArray(parsed.warnings)) for (const w of parsed.warnings) if (typeof w === 'string') warnings.push(w);
  let steps = norm.steps;
  if (opts.tabs_allowed && opts.tabs_allowed.length) {
    const allowed = opts.tabs_allowed;
    const filtered = steps.filter((s) => {
      const tab = tabForAction(s.action);
      return !tab || allowed.includes(tab);
    });
    if (filtered.length !== steps.length) warnings.push('Se omitieron pasos por restricciones de tabs_allowed.');
    steps = filtered;
  }
  if (!steps.length) throw new Error('llm_empty_plan');
  return { steps, warnings };
}

app.post('/v1/ai/plan', requireScope('ai:execute'), async (req: Request, res: Response) => {
  const parsed = PlanCreate.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  const { intent, project_id, tabs_allowed, planner, model, context } = parsed.data;
  const projectId = project_id || DB.projects[0]?.id || null;
  const mode: 'auto' | 'llm' | 'heuristic' = planner || 'auto';

  let steps: any[] = [];
  let warnings: string[] = [];
  let usedPlanner: 'llm' | 'heuristic' = 'heuristic';
  let llmError: string | null = null;

  const wantLlm = mode === 'llm' || (mode === 'auto' && !!llmMode());
  if (wantLlm) {
    try {
      const llm = await llmPlan(intent, { project_id: projectId, tabs_allowed, context, model });
      steps = llm.steps;
      warnings = llm.warnings;
      usedPlanner = 'llm';
    } catch (e: any) {
      llmError = (e && e.message) || 'llm_error';
      if (mode === 'llm') {
        const notConfigured = /llm_not_configured/.test(String(llmError));
        return void sendProblem(
          res,
          notConfigured ? 503 : 502,
          'Modelo de chat no disponible',
          'No se pudo generar el plan con el modelo de chat (' + llmError + ').',
          req.originalUrl,
          `${ERROR_BASE}/llm-unavailable`
        );
      }
      warnings.push('Modelo de chat no disponible (' + llmError + '). Se usó el planificador heurístico.');
    }
  }

  if (steps.length === 0) {
    const h = planFromIntent(intent, { project_id: projectId, tabs_allowed });
    steps = h.steps;
    warnings = warnings.concat(h.warnings);
  }

  const plan = {
    plan_id: rid('pln'),
    intent,
    project_id: projectId,
    tabs_allowed: tabs_allowed || null,
    planner: usedPlanner,
    model: usedPlanner === 'llm' ? llmStatus().model : null,
    steps,
    warnings,
    status: 'proposed',
    created_at: nowIso(),
  };
  DB.plans.push(plan);
  emitEvent('ai.plan.created', { plan_id: plan.plan_id, steps: plan.steps.length, planner: usedPlanner });
  audit('ai.plan', plan.plan_id, { intent, steps: plan.steps.length, planner: usedPlanner, llm_error: llmError });
  res.status(201).json({ plan_id: plan.plan_id, status: plan.status, planner: usedPlanner, model: plan.model, warnings, steps: plan.steps });
});

/* POST /v1/ai/chat — puente directo de texto libre al modelo de chat. */
app.post('/v1/ai/chat', requireScope('ai:execute'), async (req: Request, res: Response) => {
  const parsed = ChatRequest.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  if (!llmMode()) {
    return void sendProblem(
      res,
      503,
      'Modelo de chat no conectado',
      'Define ZEIA_CHAT_URL (puente al editor) o ZEIA_LLM_URL (OpenAI-compatible) para usar el modelo de chat.',
      req.originalUrl,
      `${ERROR_BASE}/llm-unavailable`
    );
  }
  try {
    const system = parsed.data.system || 'Eres un asistente experto de Zeus Editor 3D. Responde en español, claro y breve.';
    const reply = await callChatModel(system, parsed.data.message, { model: parsed.data.model, temperature: parsed.data.temperature, history: parsed.data.history });
    res.json({ reply, mode: llmMode(), model: llmStatus().model });
  } catch (e: any) {
    sendProblem(res, 502, 'Error del modelo de chat', (e && e.message) || String(e), req.originalUrl, `${ERROR_BASE}/llm-unavailable`);
  }
});


app.get('/v1/ai/plan/:id', (req: Request, res: Response) => {
  const p = DB.plans.find((x) => x.plan_id === req.params.id);
  if (!p) return void sendProblem(res, 404, 'Recurso no encontrado', `plan ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  res.json(p);
});

/** Ejecuta un plan de acciones sobre las entidades en memoria. */
function executeStep(step: any, ctx: { project_id: string | null }): any {
  const { action, params = {} } = step || {};
  switch (action) {
    case 'objects.create': {
      const scn = DB.scenes.find((s) => s.project_id === ctx.project_id) || DB.scenes[0];
      const obj = {
        id: rid('obj'),
        scene_id: scn?.id || null,
        name: params.name || `${params.primitive || params.type}_${DB.objects.length + 1}`,
        type: params.type || 'mesh',
        geometry: params.primitive ? { primitive: params.primitive, params: params.geometry_params || {} } : {},
        transform: { ...defaultTransform(), ...(params.transform || {}) },
        material_id: null,
        parent_id: params.parent_id ?? null,
        tags: ['ai'],
        created_at: nowIso(),
      };
      DB.objects.push(obj);
      emitEvent('object.created', { object_id: obj.id, scene_id: obj.scene_id, type: obj.type });
      return { action, ok: true, object_id: obj.id };
    }
    case 'objects.update': {
      const o = DB.objects.find((x) => x.id === params.id);
      if (!o) return { action, ok: false, error: 'not_found' };
      Object.assign(o, params.patch || {});
      emitEvent('object.updated', { object_id: o.id });
      return { action, ok: true, object_id: o.id };
    }
    case 'objects.delete': {
      const i = DB.objects.findIndex((x) => x.id === params.id);
      if (i === -1) return { action, ok: false, error: 'not_found' };
      DB.objects.splice(i, 1);
      emitEvent('object.deleted', { object_id: params.id });
      return { action, ok: true, object_id: params.id };
    }
    case 'objects.duplicate': {
      const o = DB.objects.find((x) => x.id === params.id);
      if (!o) return { action, ok: false, error: 'not_found' };
      const copy = { ...o, id: rid('obj'), name: `${o.name} (copia)`, created_at: nowIso() };
      DB.objects.push(copy);
      return { action, ok: true, object_id: copy.id };
    }
    case 'objects.parent': {
      const o = DB.objects.find((x) => x.id === params.id);
      if (!o) return { action, ok: false, error: 'not_found' };
      o.parent_id = params.parent_id ?? null;
      return { action, ok: true, object_id: o.id };
    }
    case 'motions.create': {
      const target = DB.objects.find((x) => x.id === params.object_id) || DB.objects[DB.objects.length - 1];
      if (!target) return { action, ok: false, error: 'no_object' };
      const dur = params.duration ?? 5;
      const to = params.type === 'rotate' ? [0, params.degrees ?? 360, 0] : params.type === 'translate' ? [1, 0, 0] : [2, 2, 2];
      const motion = { id: rid('mot'), object_id: target.id, type: params.type || 'rotate', keyframes: [{ t: 0, value: [0, 0, 0], easing: 'easeInOut' }, { t: dur, value: to, easing: 'easeInOut' }], loop: params.loop ?? false, duration: dur, created_at: nowIso() };
      DB.motions.push(motion);
      emitEvent('motion.created', { motion_id: motion.id, object_id: target.id, type: motion.type });
      return { action, ok: true, motion_id: motion.id, object_id: target.id };
    }
    case 'plugins.install': {
      const p = DB.plugins.find((x) => x.id === params.id);
      if (!p) return { action, ok: false, error: 'plugin_not_found' };
      p.status = 'installed';
      p.installed_at = nowIso();
      emitEvent('plugin.installed', { plugin_id: p.id, name: p.name });
      return { action, ok: true, plugin_id: p.id };
    }
    case 'plugins.uninstall': {
      const p = DB.plugins.find((x) => x.id === params.id);
      if (!p) return { action, ok: false, error: 'plugin_not_found' };
      p.status = 'available';
      p.installed_at = null;
      emitEvent('plugin.uninstalled', { plugin_id: p.id, name: p.name });
      return { action, ok: true, plugin_id: p.id };
    }
    case 'effects.apply':
    case 'effects.create': {
      const cat = EFFECT_CATALOG.find((e) => e.name.toLowerCase() === String(params.name || '').toLowerCase());
      const eff = { id: rid('eff'), plugin_id: params.plugin_id || cat?.plugin_id || null, name: params.name || cat?.name || 'Effect', params: params.params || cat?.params || {}, applied_to: params.targets || (params.target ? [params.target] : []), created_at: nowIso() };
      DB.effects.push(eff);
      emitEvent('effect.applied', { effect_id: eff.id, name: eff.name, targets: eff.applied_to });
      return { action, ok: true, effect_id: eff.id };
    }
    case 'animations.create': {
      const anim = { id: rid('anm'), project_id: ctx.project_id, name: params.name || 'Animation', duration: params.duration ?? 5, fps: params.fps ?? 30, tracks: [], render_preset: params.render_preset || '1080p_h264', created_at: nowIso() };
      DB.animations.push(anim);
      emitEvent('animation.created', { animation_id: anim.id, name: anim.name });
      return { action, ok: true, animation_id: anim.id };
    }
    case 'animations.render': {
      const anim = DB.animations[DB.animations.length - 1];
      if (!anim) {
        const a = { id: rid('anm'), project_id: ctx.project_id, name: 'Auto Animation', duration: 5, fps: params.fps ?? 30, tracks: [], render_preset: '1080p_h264', created_at: nowIso() };
        DB.animations.push(a);
        const job = createJob('render', a.id, { format: params.format || 'mp4', fps: params.fps ?? 30 });
        emitEvent('animation.render.started', { animation_id: a.id, job_id: job.id });
        return { action, ok: true, animation_id: a.id, job_id: job.id };
      }
      const job = createJob('render', anim.id, { format: params.format || 'mp4', fps: params.fps ?? anim.fps });
      emitEvent('animation.render.started', { animation_id: anim.id, job_id: job.id });
      return { action, ok: true, animation_id: anim.id, job_id: job.id };
    }
    case 'exports.create': {
      const job = createJob('export', '', { format: params.format || 'gltf' });
      const exp = { id: rid('exp'), format: params.format || 'gltf', target: params.target || 'scene', project_id: ctx.project_id, scene_id: params.scene_id || null, options: params.options || {}, status: job.status, job_id: job.id, output_url: null as string | null, created_at: nowIso() };
      job.ref_id = exp.id;
      exp.output_url = `/v1/exports/${exp.id}/download`;
      DB.exports.push(exp);
      emitEvent('export.requested', { export_id: exp.id, format: exp.format });
      return { action, ok: true, export_id: exp.id, job_id: job.id };
    }
    default:
      return { action, ok: false, error: 'unsupported_action' };
  }
}

app.post('/v1/ai/execute', requireScope('ai:execute'), (req: Request, res: Response) => {
  const parsed = ExecuteRequest.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  const plan = DB.plans.find((x) => x.plan_id === parsed.data.plan_id);
  if (!plan) return void sendProblem(res, 404, 'Recurso no encontrado', `plan ${parsed.data.plan_id}`, req.originalUrl, `${ERROR_BASE}/not-found`);

  const autoApprove = parsed.data.auto_approve ?? false;
  const destructive = plan.steps.some((s: any) => /delete|uninstall/.test(s.action));
  if (destructive && !autoApprove) {
    return void sendProblem(res, 422, 'Acción no permitida sin aprobación', 'El plan incluye acciones destructivas y auto_approve=false.', req.originalUrl, `${ERROR_BASE}/invalid-action`);
  }

  const ctx = { project_id: plan.project_id || null };
  const results: any[] = [];
  for (const step of plan.steps) {
    const tab = tabForAction(step.action);
    if (tab && plan.tabs_allowed && plan.tabs_allowed.length && !plan.tabs_allowed.includes(tab)) {
      results.push({ action: step.action, ok: false, error: `action_not_allowed_in_tab:${tab}` });
      continue;
    }
    results.push(executeStep(step, ctx));
  }

  plan.status = 'executed';
  plan.executed_at = nowIso();
  emitEvent('ai.executed', { plan_id: plan.plan_id, results: results.length });
  audit('ai.execute', plan.plan_id, { steps: plan.steps.length });
  res.json({ plan_id: plan.plan_id, status: plan.status, executed_at: plan.executed_at, results });
});

app.get('/v1/ai/context', (_req: Request, res: Response) => {
  res.json({
    active_tab: 'animation',
    selection: DB.objects.slice(-1).map((o) => ({ id: o.id, type: o.type })),
    project: DB.projects[0] || null,
    scene: DB.scenes[0] || null,
    counts: { objects: DB.objects.length, motions: DB.motions.length, animations: DB.animations.length, effects: DB.effects.length, plugins: DB.plugins.filter((p) => p.status === 'installed').length },
    recent_events: KNOWN_EVENTS.slice(0, 5),
  });
});

app.post('/v1/ai/feedback', (req: Request, res: Response) => {
  const parsed = FeedbackCreate.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  const fb = { id: rid('fbk'), ...parsed.data, created_at: nowIso() };
  DB.feedback.push(fb);
  audit('ai.feedback', fb.id, { plan_id: fb.plan_id, rating: fb.rating });
  res.status(201).json(fb);
});

/* =========================================================================
 * Rutas — Webhooks y Eventos
 * ========================================================================= */
app.get('/v1/webhooks/events', (_req: Request, res: Response) => {
  res.json({ events: KNOWN_EVENTS });
});

app.post('/v1/webhooks', requireScope('webhooks:write'), (req: Request, res: Response) => {
  const parsed = WebhookCreate.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', parsed.error.issues.map((i) => i.message).join('; '));
  const wh = { id: rid('whk'), url: parsed.data.url, events: parsed.data.events || ['*'], secret: parsed.data.secret || null, active: true, deliveries: [], created_at: nowIso() };
  DB.webhooks.push(wh);
  audit('webhook.created', wh.id, { url: wh.url, events: wh.events });
  const { secret, ...safe } = wh;
  res.status(201).json({ ...safe, secret: secret ? '***' : null });
});

app.get('/v1/webhooks', requireScope('webhooks:write'), (_req: Request, res: Response) => {
  res.json(DB.webhooks.map(({ secret, ...rest }) => ({ ...rest, secret: secret ? '***' : null })));
});

app.delete('/v1/webhooks/:id', requireScope('webhooks:write'), (req: Request, res: Response) => {
  const i = DB.webhooks.findIndex((x) => x.id === req.params.id);
  if (i === -1) return void sendProblem(res, 404, 'Recurso no encontrado', `webhook ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  DB.webhooks.splice(i, 1);
  res.status(204).send();
});

/** Server-Sent Events: /v1/events/stream */
app.get('/v1/events/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const client: SseClient = { id: rid('sse'), res };
  sseClients.add(client);
  res.write(`event: ready\ndata: ${JSON.stringify({ ts: nowIso(), message: 'Conectado al stream de eventos ZEIA' })}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: keepalive ${Date.now()}\n\n`);
    } catch {
      /* ignore */
    }
  }, 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
});

/* =========================================================================
 * Compatibilidad — Scaffold original /api/api_agente_3d-api
 * ========================================================================= */
export const Api_Agente_3DAPISchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Api_Agente_3DAPI = z.infer<typeof Api_Agente_3DAPISchema>;

const records: any[] = [{ id: '1', name: 'Sample Record', description: 'This is a sample generated record' }];

app.get('/api/api_agente_3d-api', (req: Request, res: Response) => {
  res.json(listQuery(records, req));
});
app.post('/api/api_agente_3d-api', (req: Request, res: Response) => {
  const parsed = Api_Agente_3DAPISchema.safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', 'Invalid data', req.originalUrl, `${ERROR_BASE}/bad-request`);
  const newRecord = { ...parsed.data, id: rid('rec'), createdAt: nowIso() };
  records.push(newRecord);
  res.status(201).json(newRecord);
});
app.get('/api/api_agente_3d-api/:id', (req: Request, res: Response) => {
  const rec = records.find((r) => r.id === req.params.id);
  if (!rec) return void sendProblem(res, 404, 'Recurso no encontrado', `record ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  res.json(rec);
});
app.put('/api/api_agente_3d-api/:id', (req: Request, res: Response) => {
  const i = records.findIndex((r) => r.id === req.params.id);
  if (i === -1) return void sendProblem(res, 404, 'Recurso no encontrado', `record ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  const parsed = Api_Agente_3DAPISchema.partial().safeParse(req.body || {});
  if (!parsed.success) return void sendProblem(res, 400, 'Payload inválido', 'Invalid data', req.originalUrl, `${ERROR_BASE}/bad-request`);
  records[i] = { ...records[i], ...parsed.data, updatedAt: nowIso() };
  res.json(records[i]);
});
app.delete('/api/api_agente_3d-api/:id', (req: Request, res: Response) => {
  const i = records.findIndex((r) => r.id === req.params.id);
  if (i === -1) return void sendProblem(res, 404, 'Recurso no encontrado', `record ${req.params.id}`, req.originalUrl, `${ERROR_BASE}/not-found`);
  records.splice(i, 1);
  res.status(204).send();
});


/* =========================================================================
 * Especificación OpenAPI 3.1 + Swagger UI
 * ========================================================================= */
type OpenApiOp = {
  summary: string;
  description?: string;
  tags: string[];
  parameters?: any[];
  requestBody?: any;
  responses: Record<string, any>;
  security?: any[];
};

const openapi: Record<string, any> = {
  openapi: '3.1.0',
  info: {
    title: 'Zeus Editor 3D Integration API (ZEIA)',
    version: API_VERSION,
    description:
      'API REST de nivel empresarial que actúa como puente bidireccional entre modelos de IA (LLM, generativos 3D, animación procedural) y Zeus Editor 3D. ' +
      'Permite crear plantillas por pestaña, generar objetos, aplicar movimientos, instalar plugins, gestionar efectos y producir animaciones, ' +
      'con prompts de sistema dinámicos por pestaña y orquestación de pipelines 3D.',
    contact: { name: 'Zeus Labs', url: 'https://api.zeus-editor.io' },
    license: { name: 'Proprietary' },
  },
  servers: [{ url: `http://localhost:${PORT}`, description: 'Local' }, { url: 'https://api.zeus-editor.io', description: 'Producción' }],
  tags: [
    { name: 'System', description: 'Salud y metadatos.' },
    { name: 'Auth', description: 'Autenticación, tokens y API keys.' },
    { name: 'Projects', description: 'Proyectos y sesiones.' },
    { name: 'Tabs & Prompts', description: 'Pestañas, herramientas y prompts de sistema (núcleo IA).' },
    { name: 'Templates', description: 'Plantillas por pestaña y versionado.' },
    { name: 'Scenes & Objects', description: 'Escenas y objetos 3D.' },
    { name: 'Motions & Animations', description: 'Movimientos, animaciones y render.' },
    { name: 'Plugins', description: 'Catálogo y ciclo de vida de plugins.' },
    { name: 'Effects', description: 'Catálogo e instancias de efectos.' },
    { name: 'Exports', description: 'Exportación multi-formato.' },
    { name: 'AI', description: 'Orquestación IA (plan/execute/context/feedback).' },
    { name: 'Webhooks & Events', description: 'Webhooks, SSE y WebSocket.' },
  ],
  paths: {} as Record<string, any>,
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque-token' },
      apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
    schemas: {} as Record<string, any>,
  },
};

function addOp(path: string, method: string, op: OpenApiOp): void {
  (openapi.paths[path] = openapi.paths[path] || {})[method.toLowerCase()] = op;
}
const problemResp = {
  description: 'Error (RFC 7807)',
  content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
};
function responses(...objs: Record<string, any>[]): Record<string, any> {
  return Object.assign({}, ...objs, { default: problemResp });
}
const pathId = (name = 'id') => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const jsonRef = (ref: string) => ({ required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } } });
const jsonInline = (schema: any) => ({ required: true, content: { 'application/json': { schema } } });

// --- System
addOp('/health', 'get', { summary: 'Health check', tags: ['System'], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/meta', 'get', { summary: 'Metadatos del servicio', tags: ['System'], responses: responses({ 200: { description: 'OK' } }) });

// --- Auth
addOp('/v1/auth/token', 'post', { summary: 'Obtener token (client_credentials / password)', tags: ['Auth'], requestBody: jsonRef('TokenRequest'), responses: responses({ 201: { description: 'Token emitido' } }) });
addOp('/v1/auth/refresh', 'post', { summary: 'Renovar token', tags: ['Auth'], requestBody: jsonInline({ type: 'object', properties: { refresh_token: { type: 'string' } }, required: ['refresh_token'] }), responses: responses({ 201: { description: 'Token renovado' } }) });
addOp('/v1/auth/api-keys', 'post', { summary: 'Crear API key de servicio IA', tags: ['Auth'], security: [{ bearerAuth: [] }], requestBody: jsonRef('ApiKeyCreate'), responses: responses({ 201: { description: 'API key creada' } }) });
addOp('/v1/auth/api-keys', 'get', { summary: 'Listar API keys', tags: ['Auth'], security: [{ bearerAuth: [] }], responses: responses({ 200: { description: 'Lista' } }) });
addOp('/v1/auth/api-keys/{id}', 'delete', { summary: 'Revocar API key', tags: ['Auth'], security: [{ bearerAuth: [] }], parameters: [pathId()], responses: responses({ 204: { description: 'Revocada' } }) });

// --- Projects & sessions
addOp('/v1/projects', 'get', { summary: 'Listar proyectos', tags: ['Projects'], parameters: [{ in: 'query', name: 'search', schema: { type: 'string' } }, { in: 'query', name: 'page', schema: { type: 'integer' } }, { in: 'query', name: 'limit', schema: { type: 'integer' } }], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/projects', 'post', { summary: 'Crear proyecto', tags: ['Projects'], requestBody: jsonRef('Project'), responses: responses({ 201: { description: 'Creado' } }) });
addOp('/v1/projects/{id}', 'get', { summary: 'Detalle de proyecto', tags: ['Projects'], parameters: [pathId()], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/projects/{id}', 'patch', { summary: 'Actualizar metadatos', tags: ['Projects'], parameters: [pathId()], requestBody: jsonInline({ type: 'object' }), responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/projects/{id}', 'delete', { summary: 'Eliminar proyecto', tags: ['Projects'], parameters: [pathId()], responses: responses({ 204: { description: 'Eliminado' } }) });
addOp('/v1/projects/{id}/sessions', 'post', { summary: 'Abrir sesión con Zeus Editor', tags: ['Projects'], parameters: [pathId()], responses: responses({ 201: { description: 'Sesión abierta' } }) });
addOp('/v1/sessions/{id}', 'delete', { summary: 'Cerrar sesión', tags: ['Projects'], parameters: [pathId()], responses: responses({ 204: { description: 'Cerrada' } }) });

// --- Tabs & prompts
addOp('/v1/tabs', 'get', { summary: 'Listar pestañas disponibles', tags: ['Tabs & Prompts'], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/tabs/{tab}', 'get', { summary: 'Metadatos de una pestaña', tags: ['Tabs & Prompts'], parameters: [pathId('tab')], responses: responses({ 200: { description: 'OK' }, 404: { description: 'Pestaña no encontrada' } }) });
addOp('/v1/tabs/{tab}/tools', 'get', { summary: 'Herramientas expuestas por la pestaña', tags: ['Tabs & Prompts'], parameters: [pathId('tab')], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/tabs/{tab}/prompt', 'get', { summary: 'Prompt de sistema específico para el modelo', tags: ['Tabs & Prompts'], parameters: [pathId('tab')], responses: responses({ 200: { description: 'PromptContext' } }) });
addOp('/v1/tabs/{tab}/prompt/render', 'post', { summary: 'Renderizar prompt con variables de contexto', tags: ['Tabs & Prompts'], parameters: [pathId('tab')], requestBody: jsonInline({ type: 'object', properties: { variables: { type: 'object' } } }), responses: responses({ 200: { description: 'Prompt renderizado' } }) });
addOp('/v1/tabs/{tab}/schema', 'get', { summary: 'JSON Schema de operaciones válidas', tags: ['Tabs & Prompts'], parameters: [pathId('tab')], responses: responses({ 200: { description: 'JSON Schema' } }) });

// --- Templates
addOp('/v1/templates', 'get', { summary: 'Listar plantillas (filtro por tab)', tags: ['Templates'], parameters: [{ in: 'query', name: 'tab', schema: { type: 'string' } }, { in: 'query', name: 'project_id', schema: { type: 'string' } }], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/templates', 'post', { summary: 'Crear plantilla (IA o manual)', tags: ['Templates'], requestBody: jsonRef('Template'), responses: responses({ 201: { description: 'Creada' } }) });
addOp('/v1/templates/{id}', 'get', { summary: 'Detalle de plantilla', tags: ['Templates'], parameters: [pathId()], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/templates/{id}', 'put', { summary: 'Reemplazar plantilla', tags: ['Templates'], parameters: [pathId()], requestBody: jsonRef('Template'), responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/templates/{id}', 'patch', { summary: 'Actualizar parcial', tags: ['Templates'], parameters: [pathId()], requestBody: jsonInline({ type: 'object' }), responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/templates/{id}', 'delete', { summary: 'Eliminar plantilla', tags: ['Templates'], parameters: [pathId()], responses: responses({ 204: { description: 'Eliminada' } }) });
addOp('/v1/templates/{id}/apply', 'post', { summary: 'Aplicar plantilla a proyecto/escena', tags: ['Templates'], parameters: [pathId()], requestBody: jsonInline({ type: 'object', properties: { project_id: { type: 'string' }, scene_id: { type: 'string' } } }), responses: responses({ 200: { description: 'Aplicada' } }) });
addOp('/v1/templates/{id}/clone', 'post', { summary: 'Clonar con variaciones', tags: ['Templates'], parameters: [pathId()], requestBody: jsonInline({ type: 'object' }), responses: responses({ 201: { description: 'Clonada' } }) });
addOp('/v1/templates/{id}/versions', 'get', { summary: 'Historial de versiones', tags: ['Templates'], parameters: [pathId()], responses: responses({ 200: { description: 'OK' } }) });

// --- Scenes & objects
addOp('/v1/scenes/{sceneId}', 'get', { summary: 'Detalle de escena', tags: ['Scenes & Objects'], parameters: [pathId('sceneId')], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/scenes/{sceneId}/objects', 'get', { summary: 'Listar objetos de una escena', tags: ['Scenes & Objects'], parameters: [pathId('sceneId')], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/scenes/{sceneId}/objects', 'post', { summary: 'Crear objeto (mesh/light/camera/empty/particle)', tags: ['Scenes & Objects'], parameters: [pathId('sceneId')], requestBody: jsonRef('Object3D'), responses: responses({ 201: { description: 'Creado' } }) });
addOp('/v1/objects/{id}', 'get', { summary: 'Detalle de objeto', tags: ['Scenes & Objects'], parameters: [pathId()], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/objects/{id}', 'patch', { summary: 'Modificar transform/material', tags: ['Scenes & Objects'], parameters: [pathId()], requestBody: jsonInline({ type: 'object' }), responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/objects/{id}', 'delete', { summary: 'Eliminar objeto', tags: ['Scenes & Objects'], parameters: [pathId()], responses: responses({ 204: { description: 'Eliminado' } }) });
addOp('/v1/objects/{id}/duplicate', 'post', { summary: 'Duplicar objeto', tags: ['Scenes & Objects'], parameters: [pathId()], responses: responses({ 201: { description: 'Duplicado' } }) });
addOp('/v1/objects/{id}/parent', 'post', { summary: 'Establecer jerarquía', tags: ['Scenes & Objects'], parameters: [pathId()], requestBody: jsonInline({ type: 'object', properties: { parent_id: { type: 'string', nullable: true } } }), responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/objects/batch', 'post', { summary: 'Operaciones masivas (bulk)', tags: ['Scenes & Objects'], requestBody: jsonInline({ type: 'object', properties: { operations: { type: 'array', items: { type: 'object' } } }, required: ['operations'] }), responses: responses({ 200: { description: 'Resultados' } }) });

// --- Motions & animations
addOp('/v1/objects/{id}/motions', 'post', { summary: 'Crear movimiento (translate/rotate/scale/path/physics)', tags: ['Motions & Animations'], parameters: [pathId()], requestBody: jsonRef('Motion'), responses: responses({ 201: { description: 'Creado' } }) });
addOp('/v1/objects/{id}/motions', 'get', { summary: 'Listar movimientos de un objeto', tags: ['Motions & Animations'], parameters: [pathId()], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/motions/{id}', 'patch', { summary: 'Actualizar keyframes', tags: ['Motions & Animations'], parameters: [pathId()], requestBody: jsonInline({ type: 'object' }), responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/motions/{id}', 'delete', { summary: 'Eliminar movimiento', tags: ['Motions & Animations'], parameters: [pathId()], responses: responses({ 204: { description: 'Eliminado' } }) });
addOp('/v1/animations', 'get', { summary: 'Listar animaciones', tags: ['Motions & Animations'], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/animations', 'post', { summary: 'Crear animación (timeline)', tags: ['Motions & Animations'], requestBody: jsonRef('Animation'), responses: responses({ 201: { description: 'Creada' }, 422: { description: 'Viola constraints' } }) });
addOp('/v1/animations/{id}', 'get', { summary: 'Detalle de animación', tags: ['Motions & Animations'], parameters: [pathId()], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/animations/{id}/tracks', 'post', { summary: 'Añadir pista', tags: ['Motions & Animations'], parameters: [pathId()], requestBody: jsonInline({ type: 'object', properties: { object_id: { type: 'string' }, motion_id: { type: 'string' } }, required: ['object_id', 'motion_id'] }), responses: responses({ 201: { description: 'Pista añadida' }, 422: { description: 'Objeto inexistente' } }) });
addOp('/v1/animations/{id}/keyframes', 'post', { summary: 'Insertar keyframes', tags: ['Motions & Animations'], parameters: [pathId()], requestBody: jsonInline({ type: 'object', properties: { track_id: { type: 'string' }, keyframes: { type: 'array', items: { type: 'object' } } } }), responses: responses({ 201: { description: 'Keyframes insertados' }, 422: { description: 'Límite excedido' } }) });
addOp('/v1/animations/{id}/play', 'post', { summary: 'Reproducir en editor', tags: ['Motions & Animations'], parameters: [pathId()], responses: responses({ 200: { description: 'Reproduciendo' } }) });
addOp('/v1/animations/{id}/render', 'post', { summary: 'Renderizar a video (async)', tags: ['Motions & Animations'], parameters: [pathId()], requestBody: jsonInline({ type: 'object', properties: { format: { type: 'string', enum: ['mp4', 'webm', 'mov', 'png_sequence'] }, fps: { type: 'integer' }, preset: { type: 'string' } } }), responses: responses({ 202: { description: 'Render encolado' } }) });
addOp('/v1/animations/{id}/status', 'get', { summary: 'Estado de render (async)', tags: ['Motions & Animations'], parameters: [pathId()], responses: responses({ 200: { description: 'OK' } }) });

// --- Plugins
addOp('/v1/plugins', 'get', { summary: 'Catálogo de plugins', tags: ['Plugins'], parameters: [{ in: 'query', name: 'status', schema: { type: 'string', enum: ['installed', 'available', 'disabled'] } }, { in: 'query', name: 'tab', schema: { type: 'string' } }], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/plugins', 'post', { summary: 'Registrar plugin propio (manifest)', tags: ['Plugins'], requestBody: jsonRef('Plugin'), responses: responses({ 201: { description: 'Registrado' } }) });
addOp('/v1/plugins/{id}', 'get', { summary: 'Detalle de plugin', tags: ['Plugins'], parameters: [pathId()], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/plugins/{id}/install', 'post', { summary: 'Instalar', tags: ['Plugins'], parameters: [pathId()], responses: responses({ 200: { description: 'Instalado' } }) });
addOp('/v1/plugins/{id}/uninstall', 'post', { summary: 'Desinstalar', tags: ['Plugins'], parameters: [pathId()], responses: responses({ 200: { description: 'Desinstalado' } }) });
addOp('/v1/plugins/{id}/enable', 'post', { summary: 'Habilitar', tags: ['Plugins'], parameters: [pathId()], responses: responses({ 200: { description: 'Habilitado' } }) });
addOp('/v1/plugins/{id}/disable', 'post', { summary: 'Deshabilitar', tags: ['Plugins'], parameters: [pathId()], responses: responses({ 200: { description: 'Deshabilitado' } }) });
addOp('/v1/plugins/{id}/capabilities', 'get', { summary: 'Capacidades expuestas', tags: ['Plugins'], parameters: [pathId()], responses: responses({ 200: { description: 'OK' } }) });

// --- Effects
addOp('/v1/effects', 'get', { summary: 'Catálogo e instancias de efectos', tags: ['Effects'], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/effects', 'post', { summary: 'Crear efecto (instancia)', tags: ['Effects'], requestBody: jsonRef('Effect'), responses: responses({ 201: { description: 'Creado' } }) });
addOp('/v1/effects/{id}', 'patch', { summary: 'Ajustar parámetros', tags: ['Effects'], parameters: [pathId()], requestBody: jsonInline({ type: 'object' }), responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/effects/{id}', 'delete', { summary: 'Eliminar efecto', tags: ['Effects'], parameters: [pathId()], responses: responses({ 204: { description: 'Eliminado' } }) });
addOp('/v1/effects/{id}/apply', 'post', { summary: 'Aplicar a escena/objeto', tags: ['Effects'], parameters: [pathId()], requestBody: jsonInline({ type: 'object', properties: { targets: { type: 'array', items: { type: 'string' } }, target: { type: 'string' } } }), responses: responses({ 200: { description: 'Aplicado' } }) });
addOp('/v1/effects/{id}/preview', 'post', { summary: 'Previsualización rápida', tags: ['Effects'], parameters: [pathId()], responses: responses({ 200: { description: 'OK' } }) });

// --- Exports
addOp('/v1/exports', 'get', { summary: 'Listar exportaciones', tags: ['Exports'], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/exports', 'post', { summary: 'Solicitar exportación (gltf, fbx, obj, usdz, mp4)', tags: ['Exports'], requestBody: jsonRef('ExportJob'), responses: responses({ 202: { description: 'Encolada' } }) });
addOp('/v1/exports/{id}', 'get', { summary: 'Estado de exportación', tags: ['Exports'], parameters: [pathId()], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/exports/{id}/download', 'get', { summary: 'Descargar resultado', tags: ['Exports'], parameters: [pathId()], responses: responses({ 200: { description: 'Archivo' }, 409: { description: 'No disponible aún' } }) });

// --- AI
addOp('/v1/ai/plan', 'post', { summary: 'Intención en lenguaje natural -> plan de acciones (modelo de chat u heurístico)', tags: ['AI'], requestBody: jsonInline({ type: 'object', properties: { intent: { type: 'string' }, project_id: { type: 'string' }, tabs_allowed: { type: 'array', items: { type: 'string' } }, planner: { type: 'string', enum: ['auto', 'llm', 'heuristic'] }, model: { type: 'string' }, context: { type: 'object' } }, required: ['intent'] }), responses: responses({ 201: { description: 'Plan propuesto' }, 502: { description: 'Error del modelo de chat' }, 503: { description: 'Modelo de chat no conectado' } }) });
addOp('/v1/ai/chat', 'post', { summary: 'Puente de texto libre al modelo de chat', tags: ['AI'], requestBody: jsonInline({ type: 'object', properties: { message: { type: 'string' }, system: { type: 'string' }, temperature: { type: 'number' }, model: { type: 'string' } }, required: ['message'] }), responses: responses({ 200: { description: 'Respuesta del modelo' }, 503: { description: 'Modelo de chat no conectado' } }) });
addOp('/v1/ai/execute', 'post', { summary: 'Ejecutar plan aprobado', tags: ['AI'], requestBody: jsonInline({ type: 'object', properties: { plan_id: { type: 'string' }, auto_approve: { type: 'boolean' } }, required: ['plan_id'] }), responses: responses({ 200: { description: 'Ejecutado' }, 422: { description: 'Acción IA inválida' } }) });
addOp('/v1/ai/context', 'get', { summary: 'Contexto actual (pestaña, selección, historial)', tags: ['AI'], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/ai/feedback', 'post', { summary: 'Enviar feedback para ajuste del modelo', tags: ['AI'], requestBody: jsonInline({ type: 'object', properties: { plan_id: { type: 'string' }, rating: { type: 'number' }, comment: { type: 'string' } } }), responses: responses({ 201: { description: 'Feedback registrado' } }) });

// --- Webhooks & events
addOp('/v1/webhooks', 'get', { summary: 'Listar webhooks', tags: ['Webhooks & Events'], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/webhooks', 'post', { summary: 'Registrar webhook', tags: ['Webhooks & Events'], requestBody: jsonRef('Webhook'), responses: responses({ 201: { description: 'Registrado' } }) });
addOp('/v1/webhooks/{id}', 'delete', { summary: 'Eliminar webhook', tags: ['Webhooks & Events'], parameters: [pathId()], responses: responses({ 204: { description: 'Eliminado' } }) });
addOp('/v1/webhooks/events', 'get', { summary: 'Lista de eventos disponibles', tags: ['Webhooks & Events'], responses: responses({ 200: { description: 'OK' } }) });
addOp('/v1/events/stream', 'get', { summary: 'SSE de eventos en tiempo real', description: 'Server-Sent Events. El canal WebSocket bidireccional con el editor está en `ws://host/ws/session/{id}`.', tags: ['Webhooks & Events'], responses: responses({ 200: { description: 'text/event-stream' } }) });

// Component schemas
openapi.components.schemas = {
  Problem: {
    type: 'object',
    properties: {
      type: { type: 'string', example: `${ERROR_BASE}/invalid-action` },
      title: { type: 'string', example: 'Acción no permitida en la pestaña actual' },
      status: { type: 'integer', example: 422 },
      detail: { type: 'string', example: "La herramienta 'add_constraint' no está disponible en 'modeling'." },
      instance: { type: 'string', example: '/v1/ai/execute' },
    },
  },
  Project: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, owner_id: { type: 'string' }, tabs: { type: 'array', items: { type: 'string' } }, active_template_id: { type: 'string', nullable: true } }, required: ['name'] },
  Template: { type: 'object', properties: { tab: { type: 'string', enum: VALID_TABS as unknown as string[] }, name: { type: 'string' }, schema: { type: 'object' }, version: { type: 'string' }, created_by: { type: 'string' }, project_id: { type: 'string' }, metadata: { type: 'object' } }, required: ['tab', 'name'] },
  Object3D: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: ['mesh', 'light', 'camera', 'empty', 'particle'] }, geometry: { type: 'object' }, transform: { type: 'object' }, material_id: { type: 'string', nullable: true }, parent_id: { type: 'string', nullable: true }, tags: { type: 'array', items: { type: 'string' } } }, required: ['type'] },
  Motion: { type: 'object', properties: { type: { type: 'string', enum: ['translate', 'rotate', 'scale', 'path', 'physics'] }, keyframes: { type: 'array', items: { type: 'object' } }, duration: { type: 'number' }, loop: { type: 'boolean' } }, required: ['type'] },
  Animation: { type: 'object', properties: { project_id: { type: 'string' }, name: { type: 'string' }, duration: { type: 'number' }, fps: { type: 'integer', minimum: 1, maximum: 240 }, tracks: { type: 'array', items: { type: 'object' } }, render_preset: { type: 'string' } }, required: ['name'] },
  Plugin: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, version: { type: 'string' }, author: { type: 'string' }, tab: { type: 'string' }, capabilities: { type: 'array', items: { type: 'string' } }, manifest: { type: 'object' } }, required: ['name'] },
  Effect: { type: 'object', properties: { name: { type: 'string' }, plugin_id: { type: 'string' }, params: { type: 'object' }, applied_to: { type: 'array', items: { type: 'string' } } }, required: ['name'] },
  ExportJob: { type: 'object', properties: { format: { type: 'string', enum: ['gltf', 'glb', 'fbx', 'obj', 'usdz', 'mp4'] }, target: { type: 'string' }, project_id: { type: 'string' }, scene_id: { type: 'string' }, options: { type: 'object' } }, required: ['format'] },
  Webhook: { type: 'object', properties: { url: { type: 'string', format: 'uri' }, events: { type: 'array', items: { type: 'string' } }, secret: { type: 'string' } }, required: ['url'] },
  TokenRequest: { type: 'object', properties: { grant_type: { type: 'string', enum: ['client_credentials', 'password', 'refresh_token'] }, client_id: { type: 'string' }, client_secret: { type: 'string' }, username: { type: 'string' }, password: { type: 'string' }, scope: { type: 'string' } } },
  ApiKeyCreate: { type: 'object', properties: { name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } }, ip_allowlist: { type: 'array', items: { type: 'string' } } }, required: ['name'] },
};

const customCss =
  '.swagger-ui .info .title{font-size:1.5rem!important;line-height:1.3;font-weight:600}' +
  '.swagger-ui .info .description{font-size:.875rem!important;line-height:1.55!important;max-width:56rem;color:#3b4151;font-weight:400}';

app.get('/openapi.json', (_req: Request, res: Response) => res.json(openapi));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi, { customCss }));

/* =========================================================================
 * 404 y manejador de errores (RFC 7807)
 * ========================================================================= */
app.use((req: Request, res: Response) => {
  sendProblem(res, 404, 'Recurso no encontrado', `No existe la ruta ${req.method} ${req.path}.`, req.originalUrl, `${ERROR_BASE}/not-found`);
});

app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return void sendProblem(res, 400, 'JSON inválido', 'El cuerpo de la petición no es JSON válido.', req.originalUrl, `${ERROR_BASE}/bad-request`);
  }
  const status = err?.status || err?.statusCode || 500;
  if (status >= 500) console.error('[ZEIA] error interno:', err);
  sendProblem(res, status, status >= 500 ? 'Error interno' : 'Error de petición', err?.message || 'Error inesperado.', req.originalUrl);
});

/* =========================================================================
 * Servidor HTTP + Upgrade WebSocket
 * ========================================================================= */
const server = http.createServer(app);

server.on('upgrade', (req: http.IncomingMessage, socket: any, head: Buffer) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const m = url.pathname.match(/^\/ws\/session\/([^/]+)$/);
  const key = req.headers['sec-websocket-key'];
  if (!m || typeof key !== 'string') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`
  );
  const client: WsClient = { id: rid('ws'), sessionId: m[1], socket };
  wsClients.add(client);
  if (head && head.length) wsParse(client, head);
  socket.on('data', (c: Buffer) => wsParse(client, c));
  socket.on('close', () => wsClients.delete(client));
  socket.on('error', () => wsClients.delete(client));
  wsSend(client, { type: 'session.open', session_id: client.sessionId, client_id: client.id, ts: nowIso() });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n  ZEIA — Zeus Editor 3D Integration API v${API_VERSION}`);
    console.log(`  ▸ API:        http://localhost:${PORT}${BASE_PATH}`);
    console.log(`  ▸ Swagger UI: http://localhost:${PORT}/api-docs`);
    console.log(`  ▸ OpenAPI:    http://localhost:${PORT}/openapi.json`);
    console.log(`  ▸ Health:     http://localhost:${PORT}/health`);
    console.log(`  ▸ WebSocket:  ws://localhost:${PORT}/ws/session/{id}`);
    console.log(`  ▸ Auth:       ${REQUIRE_AUTH ? 'ON' : 'OFF (dev)'}   Rate limit: ${RATE_LIMIT || 'OFF'}   PocketBase: ${POCKETBASE_URL || 'OFF'}\n`);
  });
}

export { app, server, openapi };
export default app;
