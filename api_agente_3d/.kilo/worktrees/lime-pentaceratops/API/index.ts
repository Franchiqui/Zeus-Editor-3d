import { pb, authAsAdmin, authedUserId } from './pocketbase';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { TutorialSettings } from '../types/index-2';



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FFMPEG_PATH = fs.existsSync(path.resolve(__dirname, '..', 'serve', 'ffmpeg', 'ffmpeg.exe'))
  ? path.resolve(__dirname, '..', 'serve', 'ffmpeg', 'ffmpeg.exe')
  : process.env.FFMPEG_PATH || 'ffmpeg';

const FFPROBE_PATH = fs.existsSync(path.resolve(__dirname, '..', 'serve', 'ffmpeg', 'ffprobe.exe'))
  ? path.resolve(__dirname, '..', 'serve', 'ffmpeg', 'ffprobe.exe')
  : process.env.FFPROBE_PATH || 'ffprobe';

function isVideoFileValid(videoPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!fs.existsSync(videoPath)) {
      console.log(`[VideoValidation] File does not exist: ${videoPath}`);
      return resolve(false);
    }
    const stat = fs.statSync(videoPath);
    if (stat.size === 0) {
      console.log(`[VideoValidation] File is empty: ${videoPath}`);
      return resolve(false);
    }
    const probe = spawn(FFMPEG_PATH, ['-v', 'error', '-i', videoPath, '-f', 'null', '-']);
    let stderr = '';
    probe.stderr.on('data', (d) => { stderr += d.toString(); });
    probe.on('close', (code) => {
      const valid = code === 0;
      if (!valid) {
        console.log(`[VideoValidation] FFmpeg validation exited ${code} for ${videoPath}. stderr: ${stderr.slice(0, 500)}`);
      }
      resolve(valid);
    });
    probe.on('error', (err) => {
      console.error(`[VideoValidation] FFmpeg probe error for ${videoPath}:`, err);
      resolve(false);
    });
  });
}

const __zeusFilterObjectToPbFilter = (value: any): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || Array.isArray(value)) return String(value);

  const entries = Object.entries(value as Record<string, unknown>);
  return entries
    .map(([k, v]) => {
      if (v === null) return k + ' = null';
      if (typeof v === 'number' || typeof v === 'boolean') return k + ' = ' + String(v);
      const escaped = String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return k + " = '" + escaped + "'";
    })
    .join(' && ');
};

dotenv.config();

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: control point matching for generated steps
// ─────────────────────────────────────────────────────────────────────────────

function __zeusExtractJson(text: string): any {
  if (!text) throw new Error('Respuesta vacía');
  const trimmed = text.trim();

  // Try the whole response first
  try {
    return JSON.parse(trimmed);
  } catch { /* continue */ }

  // Strip markdown code fences and try again
  const withoutFences = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(withoutFences);
  } catch { /* continue */ }

  // Find outermost balanced JSON object by scanning braces
  let start = -1;
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (trimmed[i] === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && start !== -1) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch { /* keep searching */ }
      }
    }
  }

  // Find outermost balanced JSON array
  start = -1;
  depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (trimmed[i] === ']') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && start !== -1) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch { /* keep searching */ }
      }
    }
  }

  throw new Error('No se pudo extraer JSON válido');
}

function __zeusNormalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function __zeusFindControlPoint(
  stepText: string,
  points: { id: string; name: string; x: number; y: number; clic?: boolean }[],
  currentPosition?: { x: number; y: number },
  debugLabel?: string
): { id: string; name: string; x: number; y: number; clic?: boolean } | null {
  if (!points?.length || !stepText) return null;
  const normalizedStep = __zeusNormalizeText(stepText);
  if (!normalizedStep) return null;

  const stepWords = normalizedStep.split(' ').filter(w => w.length >= 3);

  const scored = points.map(p => {
    const normalizedName = __zeusNormalizeText(p.name);
    const nameWords = normalizedName.split(' ').filter(w => w.length >= 3);

    let score = 0;
    let reasons: string[] = [];

    // Exact match is strongest
    if (normalizedName === normalizedStep) {
      score += 1000;
      reasons.push('exact');
    }
    // Name is contained in step text
    if (normalizedStep.includes(normalizedName)) {
      score += 500;
      reasons.push('name-in-step');
    }
    // Step text is contained in name
    if (normalizedName.includes(normalizedStep)) {
      score += 400;
      reasons.push('step-in-name');
    }
    // Word overlap
    const overlap = nameWords.filter(w => stepWords.includes(w));
    if (overlap.length) {
      score += overlap.length * 80;
      reasons.push(`words:${overlap.join(',')}`);
    }

    // Distance bonus: prefer points close to current AI position (if provided)
    let distance = Infinity;
    if (currentPosition && Number.isFinite(currentPosition.x) && Number.isFinite(currentPosition.y)) {
      const dx = (p.x ?? 0) - currentPosition.x;
      const dy = (p.y ?? 0) - currentPosition.y;
      distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 80) { score += 150; reasons.push('dist-near'); }
      else if (distance < 200) { score += 60; reasons.push('dist-med'); }
    }

    return { point: p, score, distance, reasons, normalizedName };
  });

  // Snap por proximidad: si la coordenada que da la IA cae muy cerca de un punto de
  // control (tolerancia ajustada), ese punto es el ancla exacta y gana siempre, incluso
  // aunque otro punto tenga mejor puntuación textual. Así se respeta el `clic` del punto
  // sobre el que realmente cae el puntero (modelo mental del usuario: "lo puse sobre el botón").
  const PROXIMITY_TOLERANCE = 40;
  if (currentPosition && Number.isFinite(currentPosition.x) && Number.isFinite(currentPosition.y)) {
    let nearest = null as null | { point: any; distance: number };
    for (const s of scored) {
      if (!Number.isFinite(s.distance)) continue;
      if (!nearest || s.distance < nearest.distance) nearest = s;
    }
    if (nearest && nearest.distance <= PROXIMITY_TOLERANCE) {
      console.log(`[ControlPointMatch ${debugLabel || ''}] PROXIMITY snap: "${nearest.point.name}" dist=${nearest.distance.toFixed(0)} (<= ${PROXIMITY_TOLERANCE}) clic=${nearest.point.clic} — ignora coincidencia textual`);
      return nearest.point;
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored[1];

  console.log(`[ControlPointMatch ${debugLabel || ''}] step="${normalizedStep.slice(0, 80)}" best="${best?.normalizedName}" score=${best?.score} reasons=[${best?.reasons?.join('|') || ''}] distance=${best?.distance?.toFixed(0)} runnerUpScore=${runnerUp?.score || 0}`);

  if (!best) return null;

  // Require a strong textual signal; ignore pure distance matches unless extremely close
  const hasTextSignal = best.reasons.some(r => r !== 'dist-near' && r !== 'dist-med');
  if (!hasTextSignal) {
    if (best.distance < 80) return best.point;
    return null;
  }

  // If runner-up is close in score, require a clearer winner
  if (runnerUp && runnerUp.score > 0 && best.score < runnerUp.score * 1.3 && best.score < 200) return null;

  if (best.score < 80) return null;
  return best.point;
}

function __zeusForceControlPoints(
  steps: any[],
  controlPoints: { id: string; name: string; x: number; y: number; clic?: boolean }[],
  controlPointsReal: { id: string; name: string; x: number; y: number; clic?: boolean; pointerX?: number; pointerY?: number; moveMouse?: boolean }[]
): any[] {
  if (!Array.isArray(steps)) return steps;

  return steps.map((step, idx) => {
    if (!step || (step.action !== 'click' && step.action !== 'doubleclick' && step.action !== 'type')) return step;

    const stepText = [step.description, step.subtitle, step.voiceover].filter(Boolean).join(' ');
    const currentPos = step.mousePosition && Number.isFinite(step.mousePosition.x) && Number.isFinite(step.mousePosition.y)
      ? step.mousePosition
      : undefined;

    // Buscar punto de control real para mover el ratón físico (coordenada "Acción").
    const realMatch = __zeusFindControlPoint(stepText, controlPointsReal, currentPos, 'real');

    // Buscar punto de control virtual para dibujar el puntero en la captura (coordenada "Puntero").
    const virtualMatch = __zeusFindControlPoint(stepText, controlPoints, currentPos, 'virtual');

    const realPoint = realMatch;
    const virtualPoint = virtualMatch;

    if (!realPoint && !virtualPoint) return step;

    // Si solo existe uno, ese se usa para ambos punteros.
    const finalReal = realPoint || virtualPoint;
    const finalVirtual = virtualPoint || realPoint;

    // Coordenada "Acción": dónde se ejecuta el clic físico. Viene de (x, y) del punto real.
    const actionX = finalReal!.x;
    const actionY = finalReal!.y;
    // Coordenada "Puntero": dónde se mueve/dibuja el cursor. Por defecto coincide con
    // la de Acción, pero el usuario puede haberla cambiado en el modal (pointer_x/y).
    const anyReal = realPoint as any;
    const pointerX = (anyReal && anyReal.pointerX != null) ? anyReal.pointerX : actionX;
    const pointerY = (anyReal && anyReal.pointerY != null) ? anyReal.pointerY : actionY;
    // moveMouse: si false, el paso ejecuta la acción SIN mover/dibujar el puntero.
    const moveMouse = (anyReal && anyReal.moveMouse != null) ? anyReal.moveMouse : true;

    if (currentPos) {
      console.log(`[Desktop] Step ${idx + 1} forced: acción="${finalReal?.name}" (${actionX},${actionY}), puntero=(${pointerX},${pointerY}), was (${currentPos.x},${currentPos.y}), clic=${finalReal?.clic}, moveMouse=${moveMouse}`);
    }
    return {
      ...step,
      mousePositionReal: { x: actionX, y: actionY },
      mousePositionVirtual: { x: pointerX, y: pointerY },
      clic: finalReal?.clic,
      moveMouse,
    };
  });
}
app.use(cors());

// Configure multer for file uploads
const uploadMusic = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for background music
    fieldSize: 10 * 1024 * 1024, // 10MB limit for form fields (e.g. steps JSON)
  },
});

const uploadDoc = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for documentation files
    fieldSize: 10 * 1024 * 1024,
  },
});

const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tmpDir = path.resolve(__dirname, '..', 'serve', 'logs', 'videos', 'tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      cb(null, tmpDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
    },
  }),
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB limit for tutorial videos
    fieldSize: 10 * 1024 * 1024,
  },
});

// Zod Schemas
export const EditortutorialesZeusIASchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type EditortutorialesZeusIA = z.infer<typeof EditortutorialesZeusIASchema>;

/**
 * @swagger
 * /api/editor-tutoriales-zeus-ia:
 *   get:
 *     summary: Get all Editor tutoriales Zeus IA records
 *     responses:
 *       200:
 *         description: List of records
 */
app.get('/api/editor-tutoriales-zeus-ia', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const records = await pb.collection('editor_tutoriales_zeus_ia').getFullList({ sort: '-created' });
    res.json(records);
  } catch (error) {
    console.error('Error fetching editor tutoriales zeus ia:', error);
    res.status(500).json({ error: 'Failed to fetch records' });
  }
});

/**
 * @swagger
 * /api/editor-tutoriales-zeus-ia:
 *   post:
 *     summary: Create a new Editor tutoriales Zeus IA record
 *     responses:
 *       201:
 *         description: Created record
 */
app.post('/api/editor-tutoriales-zeus-ia', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const data = EditortutorialesZeusIASchema.parse(req.body);
    const record = await pb.collection('editor_tutoriales_zeus_ia').create(data);
    res.status(201).json(record);
  } catch (error) {
    console.error('Error creating editor tutoriales zeus ia:', error);
    res.status(400).json({ error: 'Invalid data' });
  }
});

/**
 * @swagger
 * /api/editor-tutoriales-zeus-ia/{id}:
 *   get:
 *     summary: Get Editor tutoriales Zeus IA record by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Record
 *       404:
 *         description: Not found
 */
app.get('/api/editor-tutoriales-zeus-ia/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const record = await pb.collection('editor_tutoriales_zeus_ia').getOne(req.params.id);
    res.json(record);
  } catch (error) {
    res.status(404).json({ error: 'Not found' });
  }
});

/**
 * @swagger
 * /api/editor-tutoriales-zeus-ia/{id}:
 *   put:
 *     summary: Update Editor tutoriales Zeus IA record
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Updated
 *       404:
 *         description: Not found
 */
app.put('/api/editor-tutoriales-zeus-ia/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const data = EditortutorialesZeusIASchema.partial().parse(req.body);
    const record = await pb.collection('editor_tutoriales_zeus_ia').update(req.params.id, data);
    res.json(record);
  } catch (error) {
    console.error('Error updating editor tutoriales zeus ia:', error);
    if ((error as any)?.status === 404) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.status(400).json({ error: 'Invalid data' });
  }
});

/**
 * @swagger
 * /api/editor-tutoriales-zeus-ia/{id}:
 *   delete:
 *     summary: Delete Editor tutoriales Zeus IA record
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
app.delete('/api/editor-tutoriales-zeus-ia/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    await pb.collection('editor_tutoriales_zeus_ia').delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(404).json({ error: 'Not found' });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// In-memory job store for async generation tracking
// ─────────────────────────────────────────────────────────────────────────────
const generationJobs = new Map<string, {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  message: string;
  tutorialId?: string;
  tutorial?: any;
  error?: string;
}>();

// ─────────────────────────────────────────────────────────────────────────────
// AI Provider: call the correct model based on provider type
// ─────────────────────────────────────────────────────────────────────────────
async function callAIModel(model: any, messages: any[]): Promise<string> {
  // normalizeAiProvider acepta tanto los IDs canónicos de `modelos` (OpenAI,
  // Deepseek, OllamaCloud, Ollama, llama.cpp, OpenAI-Compatible) como el enum
  // del editor (openai, ollama, ollama-cloud, lmstudio, local, custom, ...).
  const provider = normalizeAiProvider(model.provider || model.type);

  // ── Deepseek ──
  if (provider === 'deepseek') {
    const apiKey = model.apiKey || model.api_key || '';
    const modelName = model.modelName || model.model_name || model.model || model.name || 'deepseek-v4-flash';
    const baseUrl = (model.endpoint || 'https://api.deepseek.com').replace(/\/$/, '');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = JSON.stringify({
      model: modelName,
      messages,
      max_tokens: 4096,
      temperature: 0.3,
    });

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Deepseek API error (${res.status}): ${err.slice(0, 500)}`);
    }

    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content || '';
  }

  // ── Ollama Local ──
  if (provider === 'ollama') {
    const modelName = model.modelName || model.model_name || model.model || model.name || 'llama3.2';
    let baseUrl = (model.endpoint || 'http://localhost:11434').replace(/\/$/, '');

    // Limpiar el endpoint: quitar /api/chat o /api/generate si el usuario los incluyó
    baseUrl = baseUrl.replace(/\/api\/chat$/, '').replace(/\/api\/generate$/, '');

    const ollamaUrl = `${baseUrl}/api/chat`;
    console.log(`[Ollama Local] Calling ${ollamaUrl} with model: ${modelName}`);

    // Verificar si Ollama está disponible (timeout más largo para modelos locales)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const healthRes = await fetch(`${baseUrl}/api/tags`, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);
      if (!healthRes.ok) {
        throw new Error(`Ollama no responde en ${baseUrl}. ¿Está Ollama ejecutándose?`);
      }
    } catch (healthErr: any) {
      if (healthErr.name === 'AbortError') {
        throw new Error(`Timeout al conectar con Ollama en ${baseUrl}. Verifica que Ollama esté ejecutándose en ese puerto.`);
      }
      throw new Error(`No se pudo conectar a Ollama en ${baseUrl}: ${healthErr.message}. Verifica que Ollama esté ejecutándose.`);
    }

    // Ollama local usa /api/chat con formato de mensajes
    // Timeout largo: modelos locales pueden tardar 5-10 min en responder
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 600000); // 10 minutos

    const res = await fetch(ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelName,
        messages,
        stream: false,
      }),
    });
    clearTimeout(fetchTimeout);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama API error (${res.status}): ${err.slice(0, 500)}`);
    }

    const data = await res.json() as any;
    return data.message?.content || '';
  }

  // ── Ollama Cloud ──
  if (provider === 'ollama-cloud') {
    const modelName = model.modelName || model.model_name || model.model || model.name || 'llama3.2';
    let baseUrl = (model.endpoint || 'https://ollama.com').replace(/\/$/, '');

    // Limpiar el endpoint: quitar /api/chat o /api/generate si el usuario los incluyó
    baseUrl = baseUrl.replace(/\/api\/chat$/, '').replace(/\/api\/generate$/, '');

    const ollamaUrl = `${baseUrl}/api/generate`;
    console.log(`[Ollama Cloud] Calling ${ollamaUrl} with model: ${modelName}`);

    // Construir prompt en formato compatível con /api/generate
    const systemMsg = messages.find((m: any) => m.role === 'system');
    const userMsg = messages.filter((m: any) => m.role === 'user').pop();
    const assistantHistory = messages.filter((m: any) => m.role === 'assistant');

    let prompt = '';
    if (systemMsg?.content) {
      prompt += `### System:\n${systemMsg.content}\n\n`;
    }
    for (const msg of assistantHistory) {
      prompt += `### Assistant:\n${msg.content}\n\n`;
    }
    if (userMsg?.content) {
      prompt += `### User:\n${userMsg.content}\n\n`;
    }
    prompt += '### Assistant:\n';

    const payload: Record<string, any> = {
      model: modelName,
      prompt,
      stream: false,
    };

    // Opcional: temperatura y max_tokens si están en la config
    if (typeof model.temperature === 'number') payload.temperature = model.temperature;
    if (typeof model.maxTokens === 'number') payload.num_predict = model.maxTokens;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = model.apiKey || model.api_key || '';
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(ollamaUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama Cloud API error (${res.status}): ${err.slice(0, 500)}`);
    }

    const data = await res.json() as any;
    return data.response || data.message?.content || '';
  }

  // ── OpenAI compatible (openai, local with openai API, custom, remote, lmstudio) ──
  if (provider === 'openai' || provider === 'custom' || provider === 'local' || provider === 'remote' || provider === 'lmstudio') {
    let baseUrl = (model.endpoint || 'https://api.openai.com/v1').replace(/\/$/, '');
    if ((provider === 'lmstudio' || provider === 'local') && !model.endpoint) {
      baseUrl = 'http://localhost:1234/v1';
    }
    const apiKey = model.apiKey || model.api_key || '';
    const modelName = model.modelName || model.model_name || model.model || model.name || ((provider === 'lmstudio' || provider === 'local') ? 'local-model' : 'deepseek-v4-flash');

    // Si el endpoint ya incluye /chat/completions, lo quitamos para no duplicarlo
    if (baseUrl.includes('/chat/completions')) {
      baseUrl = baseUrl.replace('/chat/completions', '');
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = JSON.stringify({
      model: modelName,
      messages,
      max_tokens: model.maxTokens || 4096,
      temperature: typeof model.temperature === 'number' ? model.temperature : 0.3,
      stream: false,
    });

    console.log(`[AI ${provider}] POST ${baseUrl}/chat/completions model=${modelName}`);

    // Local models (LM Studio/Ollama) may need very long timeouts on first load
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 600000); // 10 minutos

    let res: any;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      clearTimeout(fetchTimeout);
      if (fetchErr.name === 'AbortError') {
        throw new Error(`Timeout: el modelo en ${baseUrl} no respondió en 10 minutos. Si es LM Studio/Ollama, verifica que el modelo esté cargado y el servidor activo.`);
      }
      throw new Error(`No se pudo conectar con ${baseUrl}: ${fetchErr.message}. Verifica que el servidor de IA esté ejecutándose.`);
    }
    clearTimeout(fetchTimeout);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AI API error (${res.status}): ${err.slice(0, 500)}`);
    }

    const rawText = await res.text();
    console.log(`[AI ${provider}] Raw response length: ${rawText.length}`);
    if (!rawText.trim()) {
      // LM Studio sometimes returns empty body if model isn't loaded. Try to discover available models.
      if (provider === 'lmstudio' || provider === 'local') {
        try {
          const modelsRes = await fetch(`${baseUrl}/models`, { method: 'GET', headers });
          if (modelsRes.ok) {
            const modelsData = await modelsRes.json() as any;
            const available = modelsData?.data?.map((m: any) => m.id || m.model || m.name).filter(Boolean) || [];
            console.log('[AI lmstudio] Available models:', available);
            if (available.length) {
              throw new Error(`El modelo "${modelName}" no devolvió respuesta. Modelos disponibles en LM Studio: ${available.join(', ')}`);
            }
          }
        } catch (e: any) {
          if (!e.message?.includes('disponibles')) {
            console.warn('[AI lmstudio] Could not list models:', e.message);
          } else {
            throw e;
          }
        }
      }
      throw new Error(`El servidor de IA en ${baseUrl} devolvió una respuesta vacía. Si usas LM Studio, verifica que el modelo "${modelName}" esté cargado (Load Model) y que el servidor esté activo.`);
    }

    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr: any) {
      console.error(`[AI ${provider}] Response is not valid JSON:`, rawText.slice(0, 500));
      throw new Error(`La respuesta del servidor no es JSON válido: ${parseErr.message}. Respuesta: ${rawText.slice(0, 200)}`);
    }

    let content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || data.message?.content || data.response || data.content || '';

    // Some local models (Qwen variants via LM Studio) return thinking in reasoning_content and leave content empty.
    if (!content && data.choices?.[0]?.message?.reasoning_content) {
      const reasoning = String(data.choices[0].message.reasoning_content);
      console.warn(`[AI ${provider}] content was empty, falling back to reasoning_content (length ${reasoning.length})`);
      try {
        // If reasoning itself is JSON, use it directly
        content = __zeusExtractJson(reasoning);
        console.log(`[AI ${provider}] Extracted JSON object from reasoning_content`);
        return JSON.stringify(content);
      } catch {
        // Otherwise, try to find JSON inside the reasoning text
        try {
          content = __zeusExtractJson(reasoning);
          console.log(`[AI ${provider}] Extracted JSON from reasoning_content text`);
          return JSON.stringify(content);
        } catch {
          console.warn(`[AI ${provider}] Could not extract JSON from reasoning_content, passing raw`);
          content = reasoning;
        }
      }
    }

    if (!content) {
      console.warn(`[AI ${provider}] Response JSON has no expected content field:`, JSON.stringify(data).slice(0, 500));
    }
    return content;
  }

  // ── Anthropic (Messages API) ──
  if (provider === 'anthropic') {
    const apiKey = model.apiKey || model.api_key || '';
    if (!apiKey) throw new Error('Falta la API key para Anthropic');
    const modelName = model.modelName || model.model_name || model.model || 'claude-3-5-sonnet-20241022';
    const baseUrl = (model.endpoint || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    const url = baseUrl.endsWith('/v1') ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;
    const body: any = {
      model: modelName,
      max_tokens: model.maxTokens || 4096,
      messages: messages.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    };
    if (model.temperature != null) body.temperature = model.temperature;
    // System message → top-level system param.
    const sys = messages.find((m: any) => m.role === 'system');
    if (sys) body.system = sys.content;

    console.log(`[AI ${provider}] POST ${url} model=${modelName}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic respondió ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = await res.json();
    const content = Array.isArray(data?.content)
      ? data.content.map((b: any) => b?.text || '').join('')
      : (data?.content || '');
    if (!content) {
      console.warn(`[AI ${provider}] Respuesta sin content:`, JSON.stringify(data).slice(0, 500));
    }
    return content;
  }

  throw new Error(`Proveedor de IA no soportado: ${provider}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Check if preview app is reachable
// ─────────────────────────────────────────────────────────────────────────────
async function isPreviewReachable(previewPort: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`http://localhost:${previewPort}`, { method: 'GET', signal: controller.signal });
    clearTimeout(timeout);
    return res.ok || res.status === 404; // 404 means server is up but path not found
  } catch {
    return false;
  }
}

// Take a screenshot of the preview app via serve server
// ─────────────────────────────────────────────────────────────────────────────
async function captureScreenshot(servePort: number, previewPort: number, mousePosition?: { x: number; y: number }): Promise<{ screenshot: string | null; error?: string }> {
  try {
    const res = await fetch(`http://127.0.0.1:${servePort}/api/tutorial/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewPort, mousePosition }),
    });
    if (!res.ok) {
      return { screenshot: null, error: `Screenshot endpoint returned ${res.status}` };
    }
    const data = await res.json() as any;
    return { screenshot: data.screenshot || null };
  } catch (err: any) {
    return { screenshot: null, error: err?.message || 'Failed to capture screenshot' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Execute an action in the serve server (click, type, scroll, wait)
// ─────────────────────────────────────────────────────────────────────────────
async function executeAction(servePort: number, action: any): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`http://127.0.0.1:${servePort}/api/tutorial/execute-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (!res.ok) {
      return { success: false, error: `Execute-action endpoint returned ${res.status}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to execute action' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop Automation helpers (real mouse, keyboard, screenshots, recording)
// ─────────────────────────────────────────────────────────────────────────────
async function executeDesktopAction(servePort: number, action: any): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`http://127.0.0.1:${servePort}/api/desktop/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (!res.ok) {
      return { success: false, error: `Desktop action endpoint returned ${res.status}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to execute desktop action' };
  }
}

async function captureDesktopScreenshot(servePort: number, filename?: string, clip?: { x: number; y: number; width: number; height: number }, cursorPosition?: { x: number; y: number }, cursorImagePath?: string): Promise<{ screenshot: string | null; error?: string }> {
  try {
    const res = await fetch(`http://127.0.0.1:${servePort}/api/desktop/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: filename || `desktop-${Date.now()}.png`,
        clip,
        cursorPosition,
        cursorImagePath,
      }),
    });
    if (!res.ok) {
      return { screenshot: null, error: `Desktop screenshot endpoint returned ${res.status}` };
    }
    const data: any = await res.json();
    return { screenshot: data.screenshot || null };
  } catch (err: any) {
    return { screenshot: null, error: err?.message || 'Failed to capture desktop screenshot' };
  }
}

async function startDesktopRecording(servePort: number, outputPath?: string, clip?: { x: number; y: number; width: number; height: number }, quality?: string): Promise<{ outputPath: string; message?: string }> {
  try {
    const res = await fetch(`http://127.0.0.1:${servePort}/api/desktop/recording/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputPath, clip, quality }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to start recording');
    }
    const data: any = await res.json();
    return { outputPath: data.outputPath, message: 'Recording started' };
  } catch (err: any) {
    throw new Error(err?.message || 'Failed to start desktop recording');
  }
}

async function stopDesktopRecording(servePort: number): Promise<{ outputPath: string | null; message?: string }> {
  try {
    const res = await fetch(`http://127.0.0.1:${servePort}/api/desktop/recording/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to stop recording');
    }
    const data: any = await res.json();
    return { outputPath: data.outputPath || null, message: data.message };
  } catch (err: any) {
    throw new Error(err?.message || 'Failed to stop desktop recording');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser Automation helpers (Puppeteer actions + screenshots, NO recording)
// ─────────────────────────────────────────────────────────────────────────────

async function executeBrowserAction(page: any, action: any, recordingArea?: { x: number; y: number; width: number; height: number }): Promise<void> {
  const { type, target, value, x, y } = action;
  const offsetX = recordingArea?.x || 0;
  const offsetY = recordingArea?.y || 0;

  switch ((type || '').toLowerCase()) {
    case 'click': {
      if (x != null && y != null) {
        await page.mouse.click(x + offsetX, y + offsetY);
      } else if (target) {
        await page.click(target);
      } else if (value && value.includes(',')) {
        const [cx, cy] = value.split(',').map(Number);
        await page.mouse.click(cx + offsetX, cy + offsetY);
      }
      break;
    }
    case 'doubleclick': {
      if (x != null && y != null) {
        await page.mouse.click(x + offsetX, y + offsetY, { count: 2 });
      } else if (target) {
        await page.click(target, { count: 2 });
      }
      break;
    }
    case 'move': {
      // Mover el ratón virtual sin pulsar (para pasos con clic=false).
      if (x != null && y != null) {
        await page.mouse.move(x + offsetX, y + offsetY);
      } else if (value && value.includes(',')) {
        const [cx, cy] = value.split(',').map(Number);
        await page.mouse.move(cx + offsetX, cy + offsetY);
      }
      break;
    }
    case 'type': {
      if (target) {
        await page.type(target, value || '');
      } else if (x != null && y != null) {
        await page.mouse.click(x + offsetX, y + offsetY);
        await new Promise(r => setTimeout(r, 200));
        await page.keyboard.type(value || '');
      }
      break;
    }
    case 'scroll': {
      const scrollAmount = parseInt(value || '300', 10);
      await page.evaluate((amount: number) => {
        window.scrollBy(0, amount);
      }, scrollAmount);
      break;
    }
    case 'navigate': {
      if (value) {
        await page.goto(value, { waitUntil: 'networkidle0', timeout: 10000 });
      }
      break;
    }
    case 'wait': {
      const waitMs = Math.min(parseInt(value || '1000', 10), 30000);
      await new Promise(r => setTimeout(r, waitMs));
      break;
    }
    case 'keypress': {
      if (value) {
        await page.keyboard.press(value);
      }
      break;
    }
    case 'highlight': {
      if (target) {
        await page.evaluate((sel: string) => {
          const el = document.querySelector(sel);
          if (el) {
            const prev = (el as HTMLElement).style.outline;
            (el as HTMLElement).style.outline = '3px solid red';
            setTimeout(() => { (el as HTMLElement).style.outline = prev; }, 1500);
          }
        }, target);
      }
      break;
    }
    default:
      console.warn(`[BrowserAction] Unknown action type: ${type}`);
  }
}

async function captureBrowserScreenshot(page: any, mousePosition?: { x: number; y: number }, recordingArea?: { x: number; y: number; width: number; height: number }): Promise<string | null> {
  try {
    const options: any = { type: 'png', encoding: 'base64' };

    if (recordingArea && recordingArea.width > 0 && recordingArea.height > 0) {
      // Ensure viewport is large enough to contain the clip area
      const requiredWidth = recordingArea.x + recordingArea.width;
      const requiredHeight = recordingArea.y + recordingArea.height;
      await page.setViewport({ width: requiredWidth, height: requiredHeight });
      console.log(`[Screenshot] Viewport set to ${requiredWidth}x${requiredHeight} to contain clip at (${recordingArea.x},${recordingArea.y})`);

      options.clip = {
        x: recordingArea.x,
        y: recordingArea.y,
        width: recordingArea.width,
        height: recordingArea.height,
      };
    } else {
      console.log('[Screenshot] NO recordingArea provided, capturing full page');
    }

    if (mousePosition && mousePosition.x != null && mousePosition.y != null) {
      await page.evaluate((pos: any, area: any) => {
        const id = 'zeus-cursor-indicator';
        let el = document.getElementById(id);
        if (!el) {
          el = document.createElement('div');
          el.id = id;
          el.style.cssText = 'position:fixed;width:20px;height:20px;border:2px solid red;border-radius:50%;pointer-events:none;z-index:99999;transform:translate(-50%,-50%);background:rgba(255,0,0,0.3);';
          document.body.appendChild(el);
        }
        const offsetX = area ? area.x : 0;
        const offsetY = area ? area.y : 0;
        el.style.left = (offsetX + pos.x) + 'px';
        el.style.top = (offsetY + pos.y) + 'px';
      }, mousePosition, recordingArea);
      await new Promise(r => setTimeout(r, 150));
    }

    const buffer = await page.screenshot(options);
    console.log(`[Screenshot] Captured with clip:`, options.clip || 'full page');
    return 'data:image/png;base64,' + buffer;
  } catch (err) {
    console.warn('[BrowserScreenshot] Failed:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Video composition helpers (browser-mode: frames + TTS + music + subtitles)
// ─────────────────────────────────────────────────────────────────────────────

function __zeusAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const cs = Math.floor((s % 1) * 100);
  const wholeS = Math.floor(s);
  return `${h}:${String(m).padStart(2, '0')}:${String(wholeS).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function __zeusHexToAssColor(hex: string, alpha = 1): string {
  const clean = hex.replace('#', '').trim();
  // Soportar #RGB (3 chars) expandiendo a #RRGGBB
  let full = clean;
  if (clean.length === 3) {
    full = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  }
  const r = parseInt(full.substring(0, 2) || 'ff', 16);
  const g = parseInt(full.substring(2, 4) || 'ff', 16);
  const b = parseInt(full.substring(4, 6) || 'ff', 16);
  const a = Math.round((1 - alpha) * 255);
  // ASS usa formato &HAABBGGRR y cada componente debe ser un byte (00-FF) en hex.
  // Antes se concatenaba el número decimal (p.ej. "16777215" para #ffffff) lo que rompía el color.
  const ah = Math.max(0, Math.min(255, a)).toString(16).padStart(2, '0');
  const bh = Math.max(0, Math.min(255, b)).toString(16).padStart(2, '0');
  const gh = Math.max(0, Math.min(255, g)).toString(16).padStart(2, '0');
  const rh = Math.max(0, Math.min(255, r)).toString(16).padStart(2, '0');
  return `&H${ah}${bh}${gh}${rh}`;
}

function __zeusRgbaToAssColor(rgba: string): string {
  const match = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (!match) return '&H33000000';
  const r = parseInt(match[1], 10);
  const g = parseInt(match[2], 10);
  const b = parseInt(match[3], 10);
  const alpha = match[4] ? parseFloat(match[4]) : 1;
  const a = Math.round((1 - alpha) * 255);
  const ah = Math.max(0, Math.min(255, a)).toString(16).padStart(2, '0');
  const bh = Math.max(0, Math.min(255, b)).toString(16).padStart(2, '0');
  const gh = Math.max(0, Math.min(255, g)).toString(16).padStart(2, '0');
  const rh = Math.max(0, Math.min(255, r)).toString(16).padStart(2, '0');
  return `&H${ah}${bh}${gh}${rh}`;
}

function __zeusEstimateDurationFromChars(text: string): number {
  // Conservative 15 chars per second + 0.5s buffer
  return Math.ceil(text.length / 15) + 0.5;
}

function __zeusGetAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve) => {
    const ffprobe = spawn(FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath]);
    let stdout = '';
    ffprobe.stdout.on('data', (d) => { stdout += d.toString(); });
    ffprobe.on('close', () => {
      const duration = parseFloat(stdout.trim());
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
    });
    ffprobe.on('error', () => resolve(0));
  });
}

// Voces neuronales de Microsoft Edge (Azure) por idioma para edge-tts.
const __ZEUS_EDGE_VOICE_BY_LANG: Record<string, string> = {
  es: 'es-ES-ElviraNeural',
  en: 'en-US-AriaNeural',
  fr: 'fr-FR-DeniseNeural',
  de: 'de-DE-KatjaNeural',
  it: 'it-IT-ElsaNeural',
  pt: 'pt-BR-FranciscaNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
};

// Genera audio con edge-tts (voces neuronales Azure, calidad alta) usando el
// protocolo WebSocket oficial del servicio Read Aloud de Edge. Sin dependencias
// externas: usa WebSocket global (Node/Electron 22+) y crypto. Devuelve true si
// escribió audio en outputPath (WAV), false si no pudo.
async function __zeusEdgeTts(text: string, outputPath: string, language = 'es', voiceOverride?: string): Promise<boolean> {
  if (typeof (globalThis as any).WebSocket !== 'function') return false;
  const cryptoMod = await import('crypto');
  const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  const WIN_EPOCH = 11644473600;

  // Sec-MS-GEC: ticks de Windows (100ns desde 1601), redondeado a 5 min.
  let ticks = (Date.now() / 1000) + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 1e7;
  const gec = cryptoMod.createHash('sha256').update(Math.round(ticks).toString() + TOKEN).digest('hex').toUpperCase();
  const gecVersion = '1-143.0.3650.75';
  const connId = cryptoMod.randomUUID().replace(/-/g, '');
  const reqId = cryptoMod.randomUUID().replace(/-/g, '');

  const lang = (language || 'es').toLowerCase().slice(0, 2);
  const voice = (voiceOverride && voiceOverride.includes('Neural')) ? voiceOverride : (__ZEUS_EDGE_VOICE_BY_LANG[lang] || __ZEUS_EDGE_VOICE_BY_LANG.es);
  const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1`
    + `?TrustedClientToken=${TOKEN}&ConnectionId=${connId}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${gecVersion}`;

  // SSML con el texto escapado.
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>`
    + `<voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${esc}</prosody></voice></speak>`;
  const ts = new Date().toUTCString();

  const mp3Path = outputPath.replace(/\.wav$/i, '') + '.mp3';
  const chunks: Buffer[] = [];

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; try { ws.close(); } catch {} resolve(ok); } };

    const ws = new WebSocket(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
      },
    } as any);

    const failTimer = setTimeout(() => done(false), 30000);

    ws.addEventListener('open', () => {
      ws.send('Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n'
        + '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},'
        + '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}');
      ws.send(`X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`);
    });

    ws.addEventListener('message', async (ev: any) => {
      try {
        if (typeof ev.data === 'string') {
          if (ev.data.includes('Path:turn.end')) {
            clearTimeout(failTimer);
            const out = Buffer.concat(chunks);
            if (out.length === 0) { done(false); return; }
            fs.writeFileSync(mp3Path, out);
            // Convertir MP3 -> WAV (PCM) para mantener compatibilidad con el pipeline.
            await new Promise<void>((res) => {
              const ff = spawn(FFMPEG_PATH, ['-y', '-i', mp3Path, '-ac', '1', '-ar', '24000', '-sample_fmt', 's16', outputPath]);
              ff.on('close', () => res());
              ff.on('error', () => res());
            });
            try { fs.unlinkSync(mp3Path); } catch {}
            done(fs.existsSync(outputPath));
          }
        } else {
          const buf = Buffer.from(await ev.data.arrayBuffer());
          if (buf.length < 2) return;
          const hl = (buf[0] << 8) | buf[1];
          const data = buf.slice(2 + hl);
          if (data.length) chunks.push(data);
        }
      } catch { /* ignore parse errors */ }
    });

    ws.addEventListener('error', () => { clearTimeout(failTimer); done(false); });
    ws.addEventListener('close', () => { clearTimeout(failTimer); done(fs.existsSync(outputPath)); });
  });
}

// Fallback offline: SAPI de Windows (voces de sistema, calidad menor).
async function __zeusSapiTts(text: string, outputPath: string, language = 'es'): Promise<void> {
  const safeText = text.replace(/'/g, "''").replace(/"/g, '`"');
  const script = `
    Add-Type -AssemblyName System.Speech
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $preferred = @(${language.startsWith('es') ? `'Microsoft Helena Desktop', 'Microsoft Pablo Desktop'` : `'Microsoft Zira Desktop', 'Microsoft David Desktop'`})
    $selected = $null
    foreach ($name in $preferred) {
      try { $synth.SelectVoice($name); $selected = $name; break } catch {}
    }
    if (-not $selected) {
      $voices = $synth.GetInstalledVoices()
      if ($voices.Count -gt 0) { $synth.SelectVoice($voices[0].VoiceInfo.Name) }
    }
    $synth.SetOutputToWaveFile('${outputPath.replace(/\\/g, '\\\\')}')
    $synth.Speak('${safeText}')
    $synth.Dispose()
  `;

  await new Promise<void>((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
    let stderr = '';
    ps.stderr.on('data', (d) => { stderr += d.toString(); });
    ps.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `TTS PowerShell exited ${code}`));
      resolve();
    });
    ps.on('error', reject);
  });
}

async function __zeusGenerateTtsAudio(text: string, outputPath: string, language = 'es', voice?: string): Promise<number> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!text.trim()) return 0;

  // 1. Probar edge-tts (voces neuronales Azure, calidad alta, gratis).
  try {
    const ok = await __zeusEdgeTts(text, outputPath, language, voice);
    if (ok) {
      const measured = await __zeusGetAudioDuration(outputPath);
      if (measured > 0) {
        const lang = (language || 'es').toLowerCase().slice(0, 2);
        const v = (voice && voice.includes('Neural')) ? voice : (__ZEUS_EDGE_VOICE_BY_LANG[lang] || 'es-ES-ElviraNeural');
        console.log(`[TTS] edge-tts OK: ${measured}s (voz ${v})`);
        return measured;
      }
    }
  } catch (e: any) {
    console.warn(`[TTS] edge-tts falló (${e?.message || e}). Usando SAPI como fallback.`);
  }

  // 2. Fallback: SAPI de Windows (offline).
  try {
    await __zeusSapiTts(text, outputPath, language);
  } catch (e: any) {
    console.warn(`[TTS] SAPI también falló: ${e?.message || e}`);
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error('TTS audio file was not generated');
  }
  const measured = await __zeusGetAudioDuration(outputPath);
  const estimated = __zeusEstimateDurationFromChars(text);
  const finalDuration = measured > 0 ? measured : estimated;
  console.log(`[TTS] SAPI fallback: measured=${measured}s estimated=${estimated}s using=${finalDuration}s`);
  return finalDuration;
}


async function __zeusInjectPageCursor(page: any, cursorPosition?: { x: number; y: number }): Promise<void> {
  try {
    await page.evaluate((pos: any) => {
      const id = 'zeus-video-cursor';
      let el = document.getElementById(id) as HTMLElement | null;
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.cssText = `
          position: fixed;
          left: 0;
          top: 0;
          width: 24px;
          height: 34px;
          pointer-events: none;
          z-index: 2147483647;
          transform: translate(-2px, -2px);
          filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.5));
        `;
        el.innerHTML = `
          <svg width="24" height="34" viewBox="0 0 24 34" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 0L7 24L11 18L20 30L24 27L15 15L22 13L0 0Z" fill="white" stroke="black" stroke-width="2"/>
          </svg>
        `;
        document.body.appendChild(el);
      }
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        el.style.left = `${pos.x}px`;
        el.style.top = `${pos.y}px`;
        el.style.display = 'block';
      } else {
        el.style.display = 'none';
      }
    }, cursorPosition);
  } catch (err) {
    console.warn('[CursorInject] Failed to inject cursor:', err);
  }
}

async function __zeusRemovePageCursor(page: any): Promise<void> {
  try {
    await page.evaluate(() => {
      const el = document.getElementById('zeus-video-cursor');
      if (el) el.remove();
    });
  } catch (err) {
    console.warn('[CursorInject] Failed to remove cursor:', err);
  }
}

async function __zeusCaptureFrameSequence(
  page: any,
  framesDir: string,
  startFrameIndex: number,
  durationSeconds: number,
  fps: number,
  clip?: { x: number; y: number; width: number; height: number },
  cursorPosition?: { x: number; y: number }
): Promise<number> {
  if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });
  // Cap frame rate so capture stays fast and files stay small
  const cappedFps = Math.min(Math.max(10, fps), 20);
  const totalFrames = Math.max(1, Math.round(durationSeconds * cappedFps));
  const intervalMs = 1000 / cappedFps;
  let frameIndex = startFrameIndex;
  const startTime = Date.now();

  const options: any = { type: 'png', encoding: 'binary' };
  if (clip && clip.width > 0 && clip.height > 0) {
    // If the clip is larger than the page, fall back to full viewport capture
    const pageSize = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
    options.clip = {
      x: Math.min(clip.x, pageSize.width - 1),
      y: Math.min(clip.y, pageSize.height - 1),
      width: Math.min(clip.width, pageSize.width - clip.x),
      height: Math.min(clip.height, pageSize.height - clip.y),
    };
  }

  // Inject the cursor element once; it will move with CSS during captures
  await __zeusInjectPageCursor(page, cursorPosition);

  let capturedCount = 0;
  for (let i = 0; i < totalFrames; i++) {
    const targetTime = startTime + i * intervalMs;
    const now = Date.now();
    if (targetTime > now) {
      await new Promise(r => setTimeout(r, targetTime - now));
    }
    const framePath = path.join(framesDir, `frame-${String(frameIndex).padStart(6, '0')}.png`);
    try {
      // Update cursor position if needed
      if (cursorPosition && Number.isFinite(cursorPosition.x) && Number.isFinite(cursorPosition.y)) {
        await __zeusInjectPageCursor(page, cursorPosition);
      }
      const buffer = await Promise.race([
        page.screenshot(options),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Screenshot timeout')), 5000)),
      ]);
      fs.writeFileSync(framePath, buffer as Buffer);
      capturedCount++;
    } catch (err) {
      console.warn('[FrameCapture] Failed to capture frame:', err);
    }
    frameIndex++;
  }
  console.log(`[FrameCapture] Captured ${capturedCount}/${totalFrames} frames. Index now ${frameIndex}.`);
  return frameIndex;
}

async function __zeusGenerateAssSubtitle(
  outputPath: string,
  events: { start: number; end: number; text: string }[],
  styles: {
    fontSize?: number;
    textColor?: string;
    backgroundColor?: string;
    position?: 'bottom' | 'top' | 'center';
    verticalOffset?: number;
    fontFamily?: string;
  }
): Promise<void> {
  const fontSize = styles.fontSize || 18;
  const textColor = styles.textColor ? __zeusHexToAssColor(styles.textColor) : '&H00FFFFFF';
  const bgColor = styles.backgroundColor ? __zeusRgbaToAssColor(styles.backgroundColor) : '&H33000000';
  const alignment = styles.position === 'top' ? 8 : styles.position === 'center' ? 5 : 2;
  const marginV = Math.max(0, Math.round(styles.verticalOffset || 0));
  console.log(`[ASS] styles.verticalOffset=${styles.verticalOffset} → marginV=${marginV}`);
  const fontName = styles.fontFamily && styles.fontFamily !== 'inherit' ? styles.fontFamily.split(',')[0].trim() : 'Arial';

  let content = `[Script Info]\nTitle: Zeus Tutorial\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${fontName},${fontSize},${textColor},&H000000FF,${bgColor},${bgColor},0,0,0,0,100,100,0,0,3,2,0,${alignment},10,10,${marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  for (const ev of events) {
    const start = __zeusAssTime(ev.start);
    const end = __zeusAssTime(ev.end);
    const safeText = (ev.text || '').replace(/\r\n|\n/g, '\\N').replace(/,/g, '،');
    // Importante: en ASS, los campos MarginL/MarginR/MarginV del evento
    // SOBRESCRIBEN los del style. Si los dejamos en 0, el offset vertical
    // del style se ignora. Hay que propagar marginV al evento.
    content += `Dialogue: 0,${start},${end},Default,,0,0,${marginV},,${safeText}\n`;
  }

  fs.writeFileSync(outputPath, content, 'utf8');
}

async function __zeusDownloadMusic(url: string, outputPath: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[Music] Failed to download music: HTTP ${res.status}`);
      return false;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return false;
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    console.log(`[Music] Downloaded ${buffer.length} bytes to ${outputPath}`);
    return true;
  } catch (err) {
    console.warn('[Music] Error downloading music:', err);
    return false;
  }
}

async function __zeusMixAudio(
  voiceFiles: { path: string; start: number }[],
  musicPath: string | null,
  outputPath: string,
  voiceoverVolume: number,
  musicVolume: number
): Promise<void> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (voiceFiles.length === 0) {
    throw new Error('No voice files to mix');
  }

  // Sort voice files by start time and build inputs
  const sortedVoice = voiceFiles.slice().sort((a, b) => a.start - b.start);
  const inputs: string[] = [];
  let filterComplex = '';

  sortedVoice.forEach((f, i) => {
    inputs.push('-i', f.path);
    const delayMs = Math.max(0, Math.round(f.start * 1000));
    filterComplex += `[${i}:a]adelay=${delayMs}|${delayMs},volume=${voiceoverVolume.toFixed(2)}[v${i}];`;
  });

  const voiceMixInputs = sortedVoice.map((_, i) => `[v${i}]`).join('');
  // normalize=0: NO dividir entre el nº de entradas. Con normalize por defecto,
  // amix divide por N; como todas las voces están "activas" (en silencio por el
  // adelay) a la vez, cada voz sonaba a 1/N → volumen bajísimo, sobre todo al
  // inicio del vídeo. Con normalize=0, al haber sólo una voz no-silenciosa en
  // cada instante, cada voz suena a su volumen real.
  filterComplex += `${voiceMixInputs}amix=inputs=${sortedVoice.length}:duration=longest:dropout_transition=0:normalize=0[voiceMix];`;

  const hasMusic = musicPath && fs.existsSync(musicPath);
  if (hasMusic) {
    inputs.push('-i', musicPath!);
    const musicIndex = sortedVoice.length;
    // alimiter al final evita recorte (clipping) al sumar voz + música a volumen real.
    filterComplex += `[${musicIndex}:a]aloop=loop=-1:size=2e+09,asetpts=PTS-STARTPTS,volume=${musicVolume.toFixed(2)}[music];[voiceMix][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,aformat=sample_fmts=fltp,alimiter=limit=0.95[aout]`;
  } else {
    filterComplex += `[voiceMix]aformat=sample_fmts=fltp,alimiter=limit=0.95[aout]`;
  }

  const args = ['-y', ...inputs, '-filter_complex', filterComplex, '-map', '[aout]', '-c:a', 'aac', '-b:a', '128k', outputPath];
  console.log('[MixAudio] FFmpeg command:', args.join(' '));

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(FFMPEG_PATH, args, { windowsHide: true });
    let stderr = '';
    ffmpeg.stderr.on('data', (d) => { stderr += d.toString(); });
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('[MixAudio] Audio mix finished successfully');
        resolve();
      } else {
        console.error('[MixAudio] FFmpeg stderr:', stderr.slice(0, 2000));
        reject(new Error(stderr || `Audio mix exited ${code}`));
      }
    });
    ffmpeg.on('error', (err) => {
      console.error('[MixAudio] FFmpeg process error:', err);
      reject(err);
    });
  });
}

// Mapa calidad → parámetros de codificación x264.
// CRF más bajo = más calidad (y archivo mayor). preset más lento = mejor compresión
// (pero más lento de codificar). Para la grabación en tiempo real (gdigrab) se usa
// solo el CRF con preset 'ultrafast' para no perder frames; el build/merge (offline)
// usa preset + CRF completos.
function __zeusQualityEncodeParams(quality?: string): { crf: number; preset: string } {
  switch (quality) {
    case 'low':    return { crf: 28, preset: 'veryfast' };
    case 'medium': return { crf: 23, preset: 'fast' };
    case 'ultra':  return { crf: 16, preset: 'medium' };
    case 'high':
    default:       return { crf: 20, preset: 'fast' };
  }
}

async function __zeusBuildFinalVideo(
  framesDir: string,
  finalOutputPath: string,
  audioPath: string | null,
  assPath: string | null,
  fps: number,
  quality?: string,
  videoSettings?: {
    brillo?: number;
    contraste?: number;
    intensidad?: number;
  }
): Promise<void> {
  const dir = path.dirname(finalOutputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const hasAudio = audioPath && fs.existsSync(audioPath);
  const hasSubtitles = assPath && fs.existsSync(assPath) && fs.statSync(assPath).size > 0;

  // Build eq= filter from videoSettings (brillo/contraste/intensidad).
  let eqFilter = '';
  if (videoSettings) {
    const eqFilters: string[] = [];
    if (videoSettings.brillo !== undefined && videoSettings.brillo !== 1.0) {
      eqFilters.push(`brightness=${((videoSettings.brillo - 1.0) * 0.5).toFixed(2)}`);
    }
    if (videoSettings.contraste !== undefined && videoSettings.contraste !== 1.0) {
      eqFilters.push(`contrast=${(1 + (videoSettings.contraste - 1.0) * 0.5).toFixed(2)}`);
    }
    if (videoSettings.intensidad !== undefined && videoSettings.intensidad !== 1.0) {
      eqFilters.push(`saturation=${(1 + (videoSettings.intensidad - 1.0) * 0.5).toFixed(2)}`);
    }
    if (eqFilters.length > 0) eqFilter = `eq=${eqFilters.join(':')}`;
  }

  // Count available frames
  const frames = fs.readdirSync(framesDir).filter(f => f.startsWith('frame-') && f.endsWith('.png')).sort();
  console.log(`[BuildVideo] Frames available: ${frames.length}, first: ${frames[0] || 'none'}, last: ${frames[frames.length - 1] || 'none'}`);
  if (frames.length === 0) {
    throw new Error('No frames available to build video');
  }

  const args = [
    '-y',
    '-framerate', String(fps),
    '-i', path.join(framesDir, 'frame-%06d.png'),
  ];

  if (hasAudio) {
    args.push('-i', audioPath!);
  }

  if (hasSubtitles) {
    // El filter `subtitles=` (y `ass=`) interpreta el primer ':' del path como
    // separador de la opción `original_size`, lo que rompe con paths de Windows
    // tipo `C:\...`. Solución: copiar el ASS a un directorio "limpio", hacer
    // cwd=ese directorio y usar path relativo sin ':'.
    const mergeDir = path.join(path.dirname(finalOutputPath), 'zeus-merge');
    if (!fs.existsSync(mergeDir)) fs.mkdirSync(mergeDir, { recursive: true });
    const localAss = path.join(mergeDir, 'zeus-subs.ass');
    try { fs.copyFileSync(assPath!, localAss); } catch {}
    // Guardamos los args y el cwd, los aplicamos al final.
    (args as any).__zeusMergeDir = mergeDir;
    (args as any).__zeusLocalAss = localAss;
    const assVf = eqFilter ? `${eqFilter},ass=zeus-subs.ass` : 'ass=zeus-subs.ass';
    args.push('-vf', assVf);
  } else if (eqFilter) {
    // Sin subtítulos pero con ajustes de vídeo: aplicamos solo el eq.
    args.push('-vf', eqFilter);
  }

  args.push(
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', __zeusQualityEncodeParams(quality).preset,
    '-crf', String(__zeusQualityEncodeParams(quality).crf),
    '-movflags', '+faststart'
  );

  if (hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
  }

  args.push(finalOutputPath);
  console.log('[BuildVideo] FFmpeg command:', args.join(' '));

  // Si hay mergeDir guardado por subs, ejecuta el spawn con cwd relativo.
  const mergeCwd = (args as any).__zeusMergeDir as string | undefined;
  const localAss = (args as any).__zeusLocalAss as string | undefined;

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(FFMPEG_PATH, args, { cwd: mergeCwd, windowsHide: true });
    let stderr = '';
    ffmpeg.stderr.on('data', (d) => { stderr += d.toString(); });
    ffmpeg.on('close', (code) => {
      // Limpiar ASS temporal y directorio de merge si lo creamos
      if (localAss) { try { fs.unlinkSync(localAss); } catch {} }
      if (mergeCwd) { try { fs.rmdirSync(mergeCwd); } catch {} }
      if (code === 0) {
        console.log('[BuildVideo] FFmpeg finished successfully');
        resolve();
      } else {
        console.error('[BuildVideo] FFmpeg stderr:', stderr.slice(0, 2000));
        reject(new Error(stderr || `FFmpeg video build exited ${code}`));
      }
    });
    ffmpeg.on('error', (err) => {
      if (localAss) { try { fs.unlinkSync(localAss); } catch {} }
      if (mergeCwd) { try { fs.rmdirSync(mergeCwd); } catch {} }
      console.error('[BuildVideo] FFmpeg process error:', err);
      reject(err);
    });
  });
}

// Run an FFmpeg process and capture stderr for diagnostics. Resolves with the
// exit code (0 = success) instead of throwing, so the merge chain can branch
// on partial failures and still produce a usable MP4. Optionally accepts a
// working directory `cwd` so paths in args can be relative.
function __zeusRunFfmpeg(args: string[], logTag: string, cwd?: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    console.log(`[${logTag}] FFmpeg command:`, args.join(' '));
    const ffmpeg = spawn(FFMPEG_PATH, args, { cwd, windowsHide: true });
    let stderr = '';
    ffmpeg.stderr.on('data', (d) => { stderr += d.toString(); });
    ffmpeg.on('close', (code) => {
      const exitCode = typeof code === 'number' ? code : -1;
      if (exitCode === 0) {
        console.log(`[${logTag}] FFmpeg finished successfully`);
      } else {
        console.error(`[${logTag}] FFmpeg exited ${exitCode}. stderr: ${stderr.slice(0, 2000)}`);
      }
      resolve({ code: exitCode, stderr });
    });
    ffmpeg.on('error', (err) => {
      console.error(`[${logTag}] FFmpeg process error:`, err);
      resolve({ code: -1, stderr: err?.message || String(err) });
    });
  });
}

// Returns true if the given MP4 has at least one video stream, plus an audio
// and/or subtitle stream as requested. Uses ffprobe which ships with FFmpeg.
async function __zeusProbeStreams(
  videoPath: string,
  need: { audio: boolean; subtitles: boolean }
): Promise<{ hasVideo: boolean; hasAudio: boolean; hasSubtitles: boolean }> {
  return new Promise((resolve) => {
    if (!fs.existsSync(videoPath)) {
      resolve({ hasVideo: false, hasAudio: false, hasSubtitles: false });
      return;
    }
    const args = [
      '-v', 'error',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      videoPath,
    ];
    const probe = spawn(FFPROBE_PATH, args, { windowsHide: true });
    let stdout = '';
    probe.stdout.on('data', (d) => { stdout += d.toString(); });
    probe.on('close', () => {
      const types = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const hasVideo = types.some((t) => t === 'video');
      const hasAudio = types.some((t) => t === 'audio');
      const hasSubtitles = types.some((t) => t === 'subtitle');
      resolve({ hasVideo, hasAudio, hasSubtitles });
    });
    probe.on('error', () => resolve({ hasVideo: false, hasAudio: false, hasSubtitles: false }));
  });
}

// Devuelve la duración (segundos) de un fichero multimedia con ffprobe, o null.
async function __zeusGetMediaDuration(mediaPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    if (!fs.existsSync(mediaPath)) { resolve(null); return; }
    const probe = spawn(FFPROBE_PATH, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      mediaPath,
    ], { windowsHide: true });
    let stdout = '';
    probe.stdout.on('data', (d) => { stdout += d.toString(); });
    probe.on('close', () => {
      const val = parseFloat(stdout.trim());
      resolve(Number.isFinite(val) ? val : null);
    });
    probe.on('error', () => resolve(null));
  });
}

// Merge a raw recorded MP4 with the mixed voice/music audio and the ASS
// subtitle file. The function is intentionally defensive: the final MP4 must
// always contain the original video, and at least the audio track when an
// audio file is provided. Subtitles are best-effort: if soft-subs fail we
// fall back to hard-burn, and if that also fails we keep audio without subs
// rather than returning a silent video.
async function __zeusMergeAudioSubtitlesToVideo(
  inputVideoPath: string,
  finalOutputPath: string,
  audioPath: string | null,
  assPath: string | null,
  quality?: string,
  videoSettings?: {
    brillo?: number;
    contraste?: number;
    intensidad?: number;
    tiempo_inicio?: number;
  }
): Promise<{ videoPath: string; hadSubtitles: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  const hasAudio = !!(audioPath && fs.existsSync(audioPath));
  const hasSubtitles = !!(assPath && fs.existsSync(assPath) && fs.statSync(assPath).size > 0);

  // Build video filter string from videoSettings
  let videoFilter = '';
  if (videoSettings) {
    const eqFilters: string[] = [];
    
    // brightness: 0-2 → FFmpeg: -1..1, escalado al 50% para un efecto sutil
    if (videoSettings.brillo !== undefined && videoSettings.brillo !== 1.0) {
      const brightnessValue = (videoSettings.brillo - 1.0) * 0.5;
      eqFilters.push(`brightness=${brightnessValue.toFixed(2)}`);
    }

    // contrast: 0-2 → FFmpeg: 0.5..1.5 (escalado al 50%)
    if (videoSettings.contraste !== undefined && videoSettings.contraste !== 1.0) {
      eqFilters.push(`contrast=${(1 + (videoSettings.contraste - 1.0) * 0.5).toFixed(2)}`);
    }

    // saturation (intensity): 0-2 → FFmpeg: 0.5..1.5 (escalado al 50% para no saturar de más)
    if (videoSettings.intensidad !== undefined && videoSettings.intensidad !== 1.0) {
      eqFilters.push(`saturation=${(1 + (videoSettings.intensidad - 1.0) * 0.5).toFixed(2)}`);
    }

    if (eqFilters.length > 0) {
      videoFilter = `eq=${eqFilters.join(':')}`;
    }
  }

  // tiempo_inicio: desplaza el VÍDEO respecto al audio/subtítulos (que quedan
  // fijos en su línea de tiempo). Se aplica solo al input de vídeo, antes de
  // `-i inputVideoPath`, y una sola vez (en el paso que lee el raw). El paso B
  // (quemado de subtítulos) lee la salida ya desplazada, así que no se vuelve
  // a aplicar.
  //   < 0 (ej. -10): la imagen sale |T| segundos ANTES (se adelanta el vídeo:
  //                  se saltan los primeros |T|s del raw). Corrige el caso en
  //                  que el vídeo va retrasado respecto a la voz.
  //   > 0 (ej. +10): la imagen sale T segundos DESPUÉS (se retrasa el vídeo:
  //                  empieza en t=T con negro hasta entonces). Corrige el caso
  //                  en que el vídeo va adelantado respecto a la voz.
  let videoOffset = 0;
  if (videoSettings?.tiempo_inicio != null && Number.isFinite(videoSettings.tiempo_inicio) && videoSettings.tiempo_inicio !== 0) {
    videoOffset = videoSettings.tiempo_inicio;
  }
  let offsetInputArgs: string[] = [];
  if (videoOffset < 0) {
    // Adelantar: seek de entrada (input seek) salta los primeros |T|s.
    offsetInputArgs = ['-ss', String(-videoOffset)];
  } else if (videoOffset > 0) {
    // Retrasar: desplaza los PTS del vídeo a partir de T.
    offsetInputArgs = ['-itsoffset', String(videoOffset)];
  }

  // Duración de salida: sin desplazamiento de tiempo, el MP4 final debe durar
  // exactamente lo mismo que el vídeo base, aunque los cambios (voz/subtítulos)
  // sólo afecten a los primeros segundos. -shortest cortaría al audio (más
  // corto) y perdería el resto del vídeo. Usamos -t con la duración real del
  // vídeo base. Con offset (tiempo_inicio) mantenemos -shortest para no alterar
  // esa función avanzada.
  let durationCapArgs: string[];
  if (videoOffset === 0) {
    let baseDur = 0;
    try { baseDur = (await __zeusGetMediaDuration(inputVideoPath)) ?? 0; } catch { baseDur = 0; }
    durationCapArgs = baseDur > 0 ? ['-t', String(baseDur)] : [];
  } else {
    durationCapArgs = ['-shortest'];
  }

  // Nothing to merge: just copy the raw video to the final destination.
  if (!hasAudio && !hasSubtitles) {
    // Apply video filters / time offset if present, even without audio/subtitles
    if (videoFilter || offsetInputArgs.length > 0) {
      const filterArgs = [
        '-y',
        ...offsetInputArgs,
        '-i', inputVideoPath,
      ];
      if (videoFilter) {
        filterArgs.push('-vf', videoFilter);
      }
      filterArgs.push('-c:a', 'copy', '-movflags', '+faststart', finalOutputPath);
      await __zeusRunFfmpeg(filterArgs, 'MergeVideo filters/offset only');
    } else {
      fs.copyFileSync(inputVideoPath, finalOutputPath);
    }
    return { videoPath: finalOutputPath, hadSubtitles: false, warnings };
  }

  // On Windows FFmpeg interprets el primer ':' dentro del path del filter
  // `ass=` como el separador de la opción `original_size`, lo que rompe el
  // comando. Lo evitamos ejecutando ffmpeg con cwd=un directorio "limpio"
  // y usando un path relativo sin dos puntos (ver Paso B más abajo).

  // ── Paso A: mezcla vídeo + audio ─────────────────────────────────────────
  // Empezamos con vídeo re-codificado a libx264 (presets ultrafast) para
  // maximizar la compatibilidad. Si el re-codificado falla (p.ej. códec
  // extraño en el MP4 crudo), reintentamos con `-c:v copy` para no perder
  // el audio.
  const audioTemp = finalOutputPath.replace(/\.mp4$/i, '.audio.mp4');
  if (hasAudio) {
    const reencodeArgs = [
      '-y',
      ...offsetInputArgs,
      '-i', inputVideoPath,
      '-i', audioPath!,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-preset', __zeusQualityEncodeParams(quality).preset,
      '-crf', String(__zeusQualityEncodeParams(quality).crf),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      ...durationCapArgs,
      '-movflags', '+faststart',
      audioTemp,
    ];
    let result = await __zeusRunFfmpeg(reencodeArgs, 'MergeVideo A1');

    if (result.code !== 0) {
      warnings.push(`Re-codificado libx264 falló (code ${result.code}); reintentando con -c:v copy`);
      const copyArgs = [
        '-y',
        ...offsetInputArgs,
        '-i', inputVideoPath,
        '-i', audioPath!,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        ...durationCapArgs,
        '-movflags', '+faststart',
        audioTemp,
      ];
      result = await __zeusRunFfmpeg(copyArgs, 'MergeVideo A2');
    }

    if (result.code !== 0 || !fs.existsSync(audioTemp)) {
      throw new Error(`No se pudo mezclar audio en el vídeo. Step A exit ${result.code}`);
    }
  } else {
    // Sin audio: si hay offset de tiempo hay que re-codificar (copy no puede
    // desplazar PTS). Si no hay offset, copiamos tal cual para el Paso B.
    if (offsetInputArgs.length > 0) {
      const offsetArgs = [
        '-y',
        ...offsetInputArgs,
        '-i', inputVideoPath,
        '-map', '0:v:0',
        '-c:v', 'libx264',
        '-preset', __zeusQualityEncodeParams(quality).preset,
        '-crf', String(__zeusQualityEncodeParams(quality).crf),
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        audioTemp,
      ];
      const offResult = await __zeusRunFfmpeg(offsetArgs, 'MergeVideo A0 offset');
      if (offResult.code !== 0 || !fs.existsSync(audioTemp)) {
        throw new Error(`No se pudo aplicar el desplazamiento de tiempo al vídeo. Exit ${offResult.code}`);
      }
    } else {
      fs.copyFileSync(inputVideoPath, audioTemp);
    }
  }

  // ── Paso B: quemar subtítulos ASS como overlay (hard-sub) ────────────────
  // En esta build de FFmpeg el filter `ass=` rompe cuando el path contiene
  // una letra de unidad (`C:`), porque interpreta el primer ':' como el
  // separador de la opción `original_size`. Para evitarlo copiamos el ASS a
  // un directorio temporal SIN dos puntos (path del sistema sin drive) y
  // ejecutamos ffmpeg con cwd=ese directorio + path relativo.
  if (hasSubtitles) {
    // Directorio temporal "limpio" para evitar el bug del filter ass= con ':'.
    // Usamos siempre el mismo nombre interno `zeus-subs.ass` y cwd fijo.
    const mergeDir = path.join(path.dirname(finalOutputPath), 'zeus-merge');
    if (!fs.existsSync(mergeDir)) fs.mkdirSync(mergeDir, { recursive: true });
    const localAss = path.join(mergeDir, 'zeus-subs.ass');
    try {
      fs.copyFileSync(assPath!, localAss);
    } catch (copyErr) {
      warnings.push(`No se pudo copiar ASS a directorio temporal: ${copyErr}`);
    }

    // B1: hard-sub con ass= filter (cwd relativo). Re-codifica vídeo
    // aplicando los subtítulos como overlay. Se ven en cualquier reproductor.
    // Combine video filters with ass filter if present
    let vfFilter = 'ass=zeus-subs.ass';
    if (videoFilter) {
      vfFilter = `${videoFilter},ass=zeus-subs.ass`;
    }
    
    const hardArgs = [
      '-y',
      '-i', audioTemp,
      '-vf', vfFilter,
      '-c:v', 'libx264',
      '-preset', __zeusQualityEncodeParams(quality).preset,
      '-crf', String(__zeusQualityEncodeParams(quality).crf),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      finalOutputPath,
    ];
    const hardResult = await __zeusRunFfmpeg(hardArgs, 'MergeVideo B1 hardsubs', mergeDir);

    if (hardResult.code === 0 && fs.existsSync(finalOutputPath)) {
      try { fs.unlinkSync(audioTemp); } catch {}
      try { fs.unlinkSync(localAss); } catch {}
      try { fs.rmdirSync(mergeDir); } catch {}
      console.log(`[MergeVideo] Hard-sub OK (subs burned into video)`);
      return { videoPath: finalOutputPath, hadSubtitles: true, warnings };
    }
    warnings.push(`Hard-sub falló (code ${hardResult.code}). Devolviendo MP4 con audio sin subtítulos.`);

    // B2: si ni hard funciona, conservamos el audio (sin subs).
    fs.copyFileSync(audioTemp, finalOutputPath);
    try { fs.unlinkSync(audioTemp); } catch {}
    try { fs.unlinkSync(localAss); } catch {}
    try { fs.rmdirSync(mergeDir); } catch {}
    return { videoPath: finalOutputPath, hadSubtitles: false, warnings };
  }

  // Sin subtítulos: el Paso A ya produjo el MP4 final en audioTemp.
  fs.renameSync(audioTemp, finalOutputPath);
  return { videoPath: finalOutputPath, hadSubtitles: false, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: run the AI generation loop in background
// ─────────────────────────────────────────────────────────────────────────────
async function runTutorialGeneration(jobId: string, params: {
  description: string;
  modelId: string;
  appPath: string;
  servePort?: number;
  previewPort?: number;
  mode?: 'browser' | 'desktop';
  recordingOutputPath?: string;
  recordingArea?: { x: number; y: number; width: number; height: number };
  previewZoom?: number;
  devicePixelRatio?: number;
  controlPoints?: { id: string; name: string; x: number; y: number }[];
  controlPointsReal?: { id: string; name: string; x: number; y: number }[];
  realMouseOffset?: { x: number; y: number };
  virtualMouseOffset?: { x: number; y: number };
  realMouseScale?: { x: number; y: number };
  cursorImagePath?: string;
  manualSteps?: string;
  stepsCount?: number;
  settings?: TutorialSettings;
  backgroundMusicUrl?: string;
  videoSettings?: {
    brillo?: number;
    contraste?: number;
    intensidad?: number;
    tiempo_inicio?: number;
  };
  tutorialId?: string;
}) {
  const job = generationJobs.get(jobId)!;
  const {
    description,
    modelId,
    servePort = 3032,
    previewPort = 3000,
    mode = 'browser',
    recordingOutputPath,
    recordingArea,
    previewZoom = 100,
    devicePixelRatio = 1,
    controlPoints = [],
    controlPointsReal = [],
    realMouseOffset = { x: 0, y: 0 },
    virtualMouseOffset = { x: 0, y: 0 },
    realMouseScale = { x: 1, y: 1 },
    cursorImagePath,
    manualSteps,
    stepsCount = 9,
    settings: userSettings,
    backgroundMusicUrl,
    videoSettings,
    tutorialId,
  } = params;
  const isDesktopMode = mode === 'desktop';

  const settings: TutorialSettings = {
    resolution: '1080p',
    fps: 30,
    backgroundMusic: false,
    musicVolume: 0.3,
    voiceoverVolume: 0.8,
    subtitleEnabled: true,
    subtitleLanguage: 'es',
    subtitlePosition: 'bottom',
    subtitleVerticalOffset: 30,
    subtitleFontSize: 18,
    subtitleTextColor: '#ffffff',
    subtitleBackgroundColor: 'rgba(0,0,0,0.8)',
    subtitleBackgroundOpacity: 0.8,
    subtitleFontFamily: 'inherit',
    quality: 'high',
    outputFormat: 'mp4',
    ...(userSettings || {}),
  };

  // Adjust recordingArea for preview zoom so coordinates match the real page
  let adjustedArea: { x: number; y: number; width: number; height: number } | undefined;
  if (recordingArea && previewZoom && previewZoom > 0 && !isDesktopMode) {
    const zoomFactor = previewZoom / 100;
    adjustedArea = {
      x: Math.round(recordingArea.x / zoomFactor),
      y: Math.round(recordingArea.y / zoomFactor),
      width: Math.round(recordingArea.width / zoomFactor),
      height: Math.round(recordingArea.height / zoomFactor),
    };
    console.log(`[Browser] Adjusted recording area for zoom ${previewZoom}%:`, adjustedArea);
  } else {
    adjustedArea = recordingArea;
    console.log(`[${isDesktopMode ? 'Desktop' : 'Browser'}] Using recordingArea directly:`, adjustedArea);
  }

  try {
    // Declare vars early so they are available across phases
    let recordingResult: { outputPath: string; message?: string } | null = null;
    let puppeteerPage: any = null;
    let puppeteerBrowser: any = null;
    let framesDir: string = '';
    const recPath = recordingOutputPath || `C:\\ZeusTutorials\\tutorial-${jobId}.mp4`;
    const recDir = path.dirname(recPath);
    if (!fs.existsSync(recDir)) {
      fs.mkdirSync(recDir, { recursive: true });
      console.log(`[GenerateTutorial] Created recording output directory: ${recDir}`);
    }
    console.log(`[GenerateTutorial] Recording output path: ${recPath}`);

    // 1. Load model config from PocketBase
    job.message = 'Cargando configuración del modelo...';
    job.progress = 5;
    await authAsAdmin();

    let modelConfig: any;
    try {
      const raw = await pb.collection('modelos').getOne(modelId);
      modelConfig = mapModelos(raw);
    } catch {
      // Fallback: list and find by name/id
      const models = await pb.collection('modelos').getFullList();
      const found = models.find((m: any) => m.id === modelId || m.nombre_modelo === modelId);
      modelConfig = found ? mapModelos(found) : undefined;
    }

    if (!modelConfig) {
      throw new Error(`No se encontró el modelo con ID: ${modelId}`);
    }

    job.message = `Modelo cargado: ${modelConfig.name}`;
    job.progress = 10;

    // 2. Take initial screenshot
    job.message = 'Capturando estado inicial de la aplicación...';
    job.progress = 15;
    let initialScreenshot: string | null = null;
    if (isDesktopMode) {
      const result = await captureDesktopScreenshot(servePort, 'initial-desktop.png', adjustedArea, undefined, cursorImagePath);
      initialScreenshot = result.screenshot;
    } else {
      // Open Puppeteer early so we can capture initial screenshot with clip to recordingArea
      let puppeteer: any;
      try {
        puppeteer = await import('puppeteer');
      } catch {
        throw new Error('Puppeteer no está instalado. Instálalo con: npm install puppeteer');
      }
      // Cap viewport size so screenshots stay fast and memory usage is reasonable.
      // The final video resolution is controlled by the output scaling, not by this viewport.
      const targetResolution = settings.resolution || '1080p';
      const maxW = targetResolution === '4k' ? 1920 : targetResolution === '1440p' ? 1440 : 1280;
      const maxH = targetResolution === '4k' ? 1080 : targetResolution === '1440p' ? 900 : 720;
      const viewportW = Math.min(Math.max(1280, (adjustedArea?.x || 0) + (adjustedArea?.width || 0)), maxW);
      const viewportH = Math.min(Math.max(720, (adjustedArea?.y || 0) + (adjustedArea?.height || 0)), maxH);
      puppeteerBrowser = await puppeteer.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', `--window-size=${viewportW},${viewportH}`],
      });
      puppeteerPage = await puppeteerBrowser.newPage();
      await puppeteerPage.setViewport({ width: viewportW, height: viewportH });
      await puppeteerPage.goto(`http://localhost:${previewPort}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      // Give React apps time to hydrate and render the initial UI
      await new Promise(r => setTimeout(r, 2500));
      console.log(`[Browser] Puppeteer abierto, viewport ${viewportW}x${viewportH}, recordingArea:`, adjustedArea);
      initialScreenshot = await captureBrowserScreenshot(puppeteerPage, undefined, adjustedArea);
    }

    // 3. Call AI to generate the step plan
    job.message = 'La IA está analizando la aplicación y planificando el tutorial...';
    job.progress = 25;

    const systemPrompt = isDesktopMode
      ? `Eres un experto en crear tutoriales de aplicaciones de escritorio Windows.
Genera un plan JSON de pasos para automatizar la app controlando el ratón y teclado REALES del usuario.

REGLAS CRÍTICAS:
0. NO uses bloques de razonamiento, thinking, reasoning ni texto explicativo. El JSON del plan debe ir directamente en la respuesta, sin etiquetas <think>, sin campos reasoning_content y sin nada antes o después del JSON.
1. Responde ÚNICAMENTE con JSON válido (sin markdown).
2. "action" solo puede ser: click | doubleclick | type | scroll | wait | keypress
3. "mousePosition": { "x": number, "y": number } — coordenadas RELATIVAS al área visible de la imagen capturada. El origen (0,0) es la esquina superior izquierda de la IMAGEN que recibes.
4. Para click, doubleclick y type: usa siempre "mousePosition". Esta coordenada sirve como referencia aproximada; el sistema reemplazará automáticamente por los puntos de control exactos cuando coincida.
5. "voiceover": texto de narración claro y conciso (1-2 frases).
6. "subtitle": texto de subtítulo breve (máx 60 caracteres).
7. "duration": segundos que dura mostrar este paso en el video (ej: 3).
8. Para "type": incluye SIEMPRE "value" con el texto EXACTO a escribir. No dejes "value" vacío.

ESTRUCTURA REQUERIDA:
{
  "title": "Nombre del tutorial",
  "description": "Descripción general",
  "steps": [
    {
      "order": 1,
      "action": "click",
      "description": "Descripción del paso para el usuario",
      "mousePosition": { "x": 100, "y": 200 },
      "voiceover": "Locución para este paso",
      "subtitle": "Subtítulo del paso",
      "duration": 3,
      "value": "texto opcional para type/keypress"
    }
  ]
}

Genera EXACTAMENTE ${stepsCount} paso${stepsCount === 1 ? '' : 's'}. CADA acción click, doubleclick O type DEBE tener "mousePosition" con coordenadas relativas a la imagen.

EJEMPLOS DE PASOS type CORRECTOS:
- Escribir un nombre: { "action": "type", "description": "Escribir el nombre del proyecto", "mousePosition": {...}, "value": "Proyecto Demo", "voiceover": "Escribimos el nombre del proyecto.", "subtitle": "Escribir nombre", "duration": 3 }
- Seleccionar una carpeta: { "action": "type", "description": "Indicar la ruta de la carpeta del proyecto", "mousePosition": {...}, "value": "C:\\Usuarios\\Zeus\\Proyectos\\Demo", "voiceover": "Indicamos la ruta de la carpeta del proyecto.", "subtitle": "Ruta de carpeta", "duration": 3 }
- Escribir una descripción: { "action": "type", "description": "Escribir la descripción de la API", "mousePosition": {...}, "value": "API REST para gestión de usuarios", "voiceover": "Añadimos una breve descripción.", "subtitle": "Escribir descripción", "duration": 3 }

PUNTOS DE CONTROL DISPONIBLES PARA EL RATÓN REAL (colección control_points_real, relativos al recorte):
${controlPointsReal.length ? controlPointsReal.map(p => `- "${p.name}": (${p.x}, ${p.y})`).join('\n') : 'Ninguno definido. Debes inferir las coordenadas de los elementos visibles en la imagen.'}

PUNTOS DE CONTROL DISPONIBLES PARA EL PUNTERO VIRTUAL DE CAPTURA (colección control_points, relativos al recorte):
${controlPoints.length ? controlPoints.map(p => `- "${p.name}": (${p.x}, ${p.y})`).join('\n') : 'Ninguno definido. Debes inferir las coordenadas de los elementos visibles en la imagen.'}

REGLAS DE LOS PUNTOS DE CONTROL:
- "control_points_real" se usa para mover el ratón FÍSICO real del usuario.
- "control_points" se usa para dibujar el puntero VIRTUAL en las capturas de pantalla.
- Un punto puede existir en ambas colecciones con el mismo nombre pero coordenadas DISTINTAS, porque cada puntero tiene su propia calibración para apuntar al mismo sitio físico.
- Cuando generes un paso, describe claramente el elemento a clicar; el sistema buscará automáticamente el punto de control con el nombre más parecido.
- Si no hay un punto de control que coincida exactamente con la acción, infiere la coordenada a partir de la imagen capturada.

IMPORTANTE: La imagen que ves es un recorte. Tus coordenadas (x,y) en "mousePosition" deben ser relativas a ese recorte (0,0 es arriba-izquierda de la imagen).`
      : `Eres un experto en crear tutoriales de aplicaciones web.
Genera un plan JSON de pasos para automatizar la app controlando un navegador headless (Puppeteer) sobre la aplicación web cargada en http://127.0.0.1:${previewPort}.

REGLAS CRÍTICAS:
0. NO uses bloques de razonamiento, thinking, reasoning ni texto explicativo. El JSON del plan debe ir directamente en la respuesta, sin etiquetas <think>, sin campos reasoning_content y sin nada antes o después del JSON.
1. Responde ÚNICAMENTE con JSON válido (sin markdown).
2. "action" solo puede ser: click | doubleclick | type | scroll | wait | keypress | navigate | highlight
3. "mousePosition": { "x": number, "y": number } — coordenadas RELATIVAS al área de grabación/recorte visible en la imagen. El origen (0,0) es la esquina superior izquierda de la IMAGEN que recibes.
4. Para click, doubleclick y type: usa siempre "mousePosition". Esta coordenada sirve como referencia aproximada; el sistema hará clic en esa posición dentro del viewport de Puppeteer.
5. "voiceover": texto de narración claro y conciso (1-2 frases).
6. "subtitle": texto de subtítulo breve (máx 60 caracteres).
7. "duration": segundos que dura mostrar este paso en el video (ej: 3).
8. Para "type": incluye SIEMPRE "value" con el texto EXACTO a escribir. No dejes "value" vacío.
9. Para "navigate": incluye SIEMPRE "value" con la URL completa a la que navegar.

ESTRUCTURA REQUERIDA:
{
  "title": "Nombre del tutorial",
  "description": "Descripción general",
  "steps": [
    {
      "order": 1,
      "action": "click",
      "description": "Descripción del paso para el usuario",
      "mousePosition": { "x": 100, "y": 200 },
      "voiceover": "Locución para este paso",
      "subtitle": "Subtítulo del paso",
      "duration": 3,
      "value": "texto opcional para type/keypress/navigate"
    }
  ]
}

Genera EXACTAMENTE ${stepsCount} paso${stepsCount === 1 ? '' : 's'}. CADA acción click, doubleclick O type DEBE tener "mousePosition" con coordenadas relativas a la imagen.

EJEMPLOS DE PASOS type CORRECTOS:
- Escribir un nombre: { "action": "type", "description": "Escribir el nombre del proyecto", "mousePosition": {...}, "value": "Proyecto Demo", "voiceover": "Escribimos el nombre del proyecto.", "subtitle": "Escribir nombre", "duration": 3 }
- Escribir una descripción: { "action": "type", "description": "Escribir la descripción de la API", "mousePosition": {...}, "value": "API REST para gestión de usuarios", "voiceover": "Añadimos una breve descripción.", "subtitle": "Escribir descripción", "duration": 3 }

IMPORTANTE: La imagen que ves es un recorte del navegador. Tus coordenadas (x,y) en "mousePosition" deben ser relativas a ese recorte (0,0 es arriba-izquierda de la imagen).`

    const userContent: any[] = [];
    
    if (initialScreenshot) {
      // Vision-capable models
      const provider = (modelConfig.type || modelConfig.provider || '').toLowerCase();
      if (provider === 'openai' || provider === 'anthropic') {
        // Aseguramos que solo haya un prefijo data:image
        const base64Image = initialScreenshot.startsWith('data:') 
          ? initialScreenshot 
          : `data:image/png;base64,${initialScreenshot}`;
          
        userContent.push({
          type: 'image_url',
          image_url: { url: base64Image, detail: 'high' }
        });
      }
    }
    
    const manualStepsBlock = manualSteps?.trim()
      ? `El usuario ha especificado los siguientes pasos que DEBEN incluirse en el plan del tutorial (respeta el orden y los detalles):\n"""\n${manualSteps.trim()}\n"""\n\nGenera el plan completo de pasos para este tutorial, combinando la descripción general con los pasos indicados por el usuario. Si la descripción o los pasos indican textos concretos que escribir (nombres, rutas, descripciones, etc.), incluye esos valores exactos en el campo "value" de los pasos "type". Si no indica textos concretos, inventa valores realistas y coherentes con el contexto, pero NUNCA dejes el campo "value" vacío en un paso "type".`
      : `Genera el plan completo de pasos para este tutorial.\n\nSi la descripción indica textos concretos que escribir (nombres, rutas, descripciones, etc.), incluye esos valores exactos en el campo "value" de los pasos "type". Si no indica textos concretos, inventa valores realistas y coherentes con el contexto, pero NUNCA dejes el campo "value" vacío en un paso "type".`;

    userContent.push({
      type: 'text',
      text: `Descripción del tutorial a crear: "${description}"\n\nRuta de la aplicación: ${params.appPath || 'Zeus Desktop'}\n\n${manualStepsBlock}`
    });

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent.length === 1 ? userContent[0].text : userContent }
    ];

    const aiResponse = await callAIModel(modelConfig, messages);

    // 4. Parse AI response
    job.message = 'Procesando respuesta de la IA...';
    job.progress = 50;

    let tutorialPlan: any;
    try {
      tutorialPlan = __zeusExtractJson(aiResponse);
    } catch (parseErr: any) {
      console.error('[GenerateTutorial] JSON parse error:', parseErr?.message || parseErr);
      console.error('[GenerateTutorial] Raw AI response (first 2000 chars):', aiResponse.slice(0, 2000));
      throw new Error('La IA no devolvió un JSON válido. Respuesta: ' + aiResponse.slice(0, 200));
    }

    if (!tutorialPlan || typeof tutorialPlan !== 'object') {
      throw new Error('La IA devolvió un JSON sin la estructura esperada (title/steps).');
    }

    if (!Array.isArray(tutorialPlan.steps)) {
      console.warn('[GenerateTutorial] AI response did not contain a steps array; trying to wrap into steps:', tutorialPlan);
      // Some models return an array directly instead of an object
      if (Array.isArray(tutorialPlan)) {
        tutorialPlan = {
          title: description.slice(0, 80),
          description,
          steps: tutorialPlan,
        };
      } else {
        tutorialPlan.steps = [];
      }
    }

    // 5. Execute steps and capture screenshots per step
    job.message = isDesktopMode
      ? 'Iniciando grabación de escritorio y ejecutando pasos reales...'
      : 'Ejecutando pasos y capturando capturas de pantalla...';
    job.progress = 50;
    let steps = tutorialPlan.steps || [];

    // Forzar el uso de puntos de control definidos por el usuario cuando sea posible
    if (isDesktopMode) {
      steps = __zeusForceControlPoints(steps, controlPoints, controlPointsReal);
    }

    const enrichedSteps: any[] = [];
    let frameIndex = 0;
    let currentTime = 0;
    let recordingStartMs = 0;
    const voiceFiles: { path: string; start: number }[] = [];
    const subtitleEvents: { start: number; end: number; text: string }[] = [];
    // Grabación raw + duración (modo desktop), para persistirlas y permitir re-edición.
    let rawVideoPath: string | undefined;
    let rawDuration: number | undefined;
    const audioDir = path.join(recDir, `audio-${jobId}`);
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

    if (isDesktopMode) {
      recordingResult = await startDesktopRecording(servePort, recPath, adjustedArea, settings.quality);
      console.log(`[Desktop] Recording started: ${recordingResult.outputPath}`);
      job.message = `Grabando escritorio... Ejecutando pasos reales`;
      // Marca de tiempo real de inicio de grabación. En desktop la grabación
      // captura tiempo real (incluye TTS/acción/captura entre pasos), así que la
      // línea de tiempo de voz/subtítulos debe basarse en tiempo real para no
      // desfasarse (sintoma: la voz termina antes que el vídeo).
      recordingStartMs = Date.now();
    } else {
      // Browser mode: prepare frames and ensure Puppeteer is open
      const recDir = path.dirname(recPath);
      if (!fs.existsSync(recDir)) fs.mkdirSync(recDir, { recursive: true });

      // Prepare frames directory for video assembly
      framesDir = path.join(recDir, `frames-${jobId}`);
      if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });

      // Reuse Puppeteer if already opened for initial screenshot; otherwise open now
      if (!puppeteerBrowser || !puppeteerPage) {
        let puppeteer: any;
        try {
          puppeteer = await import('puppeteer');
        } catch {
          throw new Error('Puppeteer no está instalado. Instálalo con: npm install puppeteer');
        }
        const targetResolution = settings.resolution || '1080p';
        const maxW = targetResolution === '4k' ? 1920 : targetResolution === '1440p' ? 1440 : 1280;
        const maxH = targetResolution === '4k' ? 1080 : targetResolution === '1440p' ? 900 : 720;
        const viewportW = Math.min(Math.max(1280, (adjustedArea?.x || 0) + (adjustedArea?.width || 0)), maxW);
        const viewportH = Math.min(Math.max(720, (adjustedArea?.y || 0) + (adjustedArea?.height || 0)), maxH);
        puppeteerBrowser = await puppeteer.default.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', `--window-size=${viewportW},${viewportH}`],
        });
        puppeteerPage = await puppeteerBrowser.newPage();
        await puppeteerPage.setViewport({ width: viewportW, height: viewportH });
        await puppeteerPage.goto(`http://localhost:${previewPort}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await new Promise(r => setTimeout(r, 2500));
        console.log(`[Browser] Puppeteer abierto con viewport ${viewportW}x${viewportH}, área de grabación:`, adjustedArea);
      }
      job.message = `Grabando pantalla... Ejecutando pasos`;

      recordingResult = { outputPath: recPath, message: 'Puppeteer frame capture started' };
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      job.progress = 50 + Math.round((i / steps.length) * 35);
      job.message = `Ejecutando paso ${i + 1} de ${steps.length}: ${step.description?.slice(0, 60)}...`;

      let virtualCursorPosition: { x: number; y: number } | undefined;

      // Execute the action
      if (step.action && step.action !== 'wait') {
        if (isDesktopMode) {
          // Desktop mode: real mouse/keyboard
          const actionPayload: any = {
            type: step.action,
            target: step.target,
            value: step.value,
          };
          const realPos = step.action === 'type' || step.action === 'click' || step.action === 'doubleclick'
            ? (step.mousePositionReal || step.mousePosition)
            : undefined;
          const virtualPos = step.action === 'type' || step.action === 'click' || step.action === 'doubleclick'
            ? (step.mousePositionVirtual || step.mousePosition)
            : undefined;

          if (realPos?.x != null && realPos?.y != null) {
            // adjustedArea ya llega en coordenadas FÍSICAS de pantalla.
            // Las coordenadas del punto de control son RELATIVAS al área roja en píxeles lógicos (CSS).
            const areaX = adjustedArea?.x || 0;
            const areaY = adjustedArea?.y || 0;
            const areaW = adjustedArea?.width || 0;
            const areaH = adjustedArea?.height || 0;

            const scaleX = Number.isFinite(realMouseScale?.x) ? realMouseScale!.x : 1;
            const scaleY = Number.isFinite(realMouseScale?.y) ? realMouseScale!.y : 1;

            // Calcular destino real con la MISMA fórmula que el botón "Probar" del frontend:
            // physicalX = areaPhysicalX + round(x * dpr * realMouseScaleX) + realMouseOffsetX
            // areaPhysicalX = round((windowX + recordingArea.x + mouseOffsetX) * dpr) = adjustedArea.x
            const realOffsetX = Math.round(realPos.x * devicePixelRatio * scaleX);
            const realOffsetY = Math.round(realPos.y * devicePixelRatio * scaleY);
            let destX = areaX + realOffsetX + (realMouseOffset?.x || 0);
            let destY = areaY + realOffsetY + (realMouseOffset?.y || 0);

            // Posición del puntero virtual en la captura usando la colección virtual.
            // Misma fórmula que el botón "Probar" para el cursor virtual:
            // virtualCursorX = areaPhysicalX + round(x * dpr) + virtualMouseOffsetX
            // Si moveMouse=false, el paso ejecuta la acción SIN mover/dibujar el puntero:
            // no componemos el cursor en la captura.
            if (step.moveMouse !== false) {
              const virtualOffsetX = Math.round(virtualPos.x * devicePixelRatio);
              const virtualOffsetY = Math.round(virtualPos.y * devicePixelRatio);
              virtualCursorPosition = {
                x: areaX + virtualOffsetX + (virtualMouseOffset?.x || 0),
                y: areaY + virtualOffsetY + (virtualMouseOffset?.y || 0),
              };
            } else {
              console.log(`[Desktop] Paso ${i + 1} tiene moveMouse=false: se ejecuta la acción en (${Math.round(destX)},${Math.round(destY)}) sin dibujar/mover el puntero.`);
            }

            actionPayload.x = Math.round(destX);
            actionPayload.y = Math.round(destY);

            const logReal = realPos ? `(${realPos.x},${realPos.y})` : 'n/a';
            const logVirtual = virtualPos ? `(${virtualPos.x},${virtualPos.y})` : 'n/a';
            console.log(`[Desktop] Paso ${i + 1} calculo:`);
            console.log(`  areaX/Y=(${areaX},${areaY}) areaW/H=(${areaW},${areaH}) DPR=${devicePixelRatio}`);
            console.log(`  real=${logReal} scale=(${scaleX.toFixed(3)},${scaleY.toFixed(3)}) offset=(${(realMouseOffset?.x || 0)},${(realMouseOffset?.y || 0)}) -> realOffset=(${realOffsetX},${realOffsetY}) -> destino real=(${actionPayload.x},${actionPayload.y})`);
            console.log(`  virtual=${logVirtual} offset=(${(virtualMouseOffset?.x || 0)},${(virtualMouseOffset?.y || 0)}) -> cursor virtual=${virtualCursorPosition ? `(${virtualCursorPosition.x},${virtualCursorPosition.y})` : 'oculto (moveMouse=false)'}`);

            // Seguridad mínima: solo omitir si el destino no es un número finito.
            // El ratón físico debe poder moverse al destino calibrado por el usuario, aunque
            // quede ligeramente fuera del área roja reportada.
            if (!Number.isFinite(actionPayload.x) || !Number.isFinite(actionPayload.y)) {
              console.error(`[Desktop] DESTINO INVÁLIDO. Omitiendo movimiento de ratón.`, actionPayload);
              delete actionPayload.x;
              delete actionPayload.y;
            } else if (
              actionPayload.x < areaX - 50 || actionPayload.y < areaY - 50 ||
              actionPayload.x > areaX + areaW + 50 || actionPayload.y > areaY + areaH + 50
            ) {
              console.warn(`[Desktop] Destino real (${actionPayload.x},${actionPayload.y}) está lejos del área roja (${areaX},${areaY},${areaW},${areaH}). El ratón se moverá igual; revisa los offsets/escala si no es correcto.`);
            }
          }
          if (step.action === 'type' && !step.value) {
            console.warn(`[Desktop] Paso ${i + 1} es type pero no tiene "value". Se hará clic para enfocar pero no se escribirá texto.`);
          }
          // Diagnóstico: registrar el valor de clic con el que llega el paso a ejecución.
          console.log(`[Desktop] Paso ${i + 1} action="${step.action}" clic=${step.clic} (mover sin pulsar si === false)`);
          // Si clic=false: el ratón se mueve al punto pero NO pulsa (acción 'move').
          if (step.clic === false) {
            if (actionPayload.x != null && actionPayload.y != null) {
              console.log(`[Desktop] Paso ${i + 1} tiene clic=false, moviendo sin pulsar a (${actionPayload.x},${actionPayload.y})`);
              await executeDesktopAction(servePort, { ...actionPayload, type: 'move' });
            } else {
              console.log(`[Desktop] Paso ${i + 1} tiene clic=false y sin coordenadas, se omite`);
            }
          } else {
            await executeDesktopAction(servePort, actionPayload);
          }
        } else if (puppeteerPage) {
          // Browser mode: direct Puppeteer action
          const actionPayload: any = {
            type: step.action,
            target: step.target,
            value: step.value,
          };
          if (step.mousePosition?.x != null && step.mousePosition?.y != null) {
            actionPayload.x = step.mousePosition.x;
            actionPayload.y = step.mousePosition.y;
          }
          // Solo ejecutar clic si el campo clic es true (o undefined por compatibilidad)
          if (step.clic === false) {
            if (actionPayload.x != null && actionPayload.y != null) {
              console.log(`[Browser] Paso ${i + 1} tiene clic=false, moviendo sin pulsar a (${actionPayload.x},${actionPayload.y})`);
              await executeBrowserAction(puppeteerPage, { ...actionPayload, type: 'move' }, adjustedArea);
            } else {
              console.log(`[Browser] Paso ${i + 1} tiene clic=false y sin coordenadas, se omite`);
            }
          } else {
            await executeBrowserAction(puppeteerPage, actionPayload, adjustedArea);
          }
        } else {
          // Fallback: delegate to serve server
          // Solo ejecutar clic si el campo clic es true (o undefined por compatibilidad)
          if (step.clic === false) {
            console.log(`[Fallback] Paso ${i + 1} tiene clic=false, omitiendo ejecución de acción`);
          } else {
            await executeAction(servePort, {
              type: step.action,
              target: step.target,
              value: step.value,
              previewPort,
            });
          }
        }
      }

      // Determine the text to speak and show
      const voiceoverText = step.voiceover || step.description || '';
      const subtitleText = step.subtitle || step.description || '';

      // Tiempo real transcurrido en la grabación hasta justo después de ejecutar
      // la acción del paso (la pantalla ya muestra el resultado). En desktop se
      // usa este tiempo real para colocar la voz/subtítulos, así van sincronizados
      // con lo que se ve. En browser se sigue usando la línea sintética (frames).
      const stepRealStart = isDesktopMode && recordingStartMs
        ? Math.max(0, (Date.now() - recordingStartMs) / 1000)
        : currentTime;

      // Generate TTS audio for this step
      let ttsDuration = 0;
      const ttsPath = path.join(audioDir, `voice-${String(i).padStart(4, '0')}.wav`);
      if (voiceoverText.trim()) {
        try {
          ttsDuration = await __zeusGenerateTtsAudio(voiceoverText, ttsPath, settings.subtitleLanguage, settings.voice);
          console.log(`[Step ${i + 1}] TTS generated: ${ttsDuration}s at ${ttsPath}`);
        } catch (ttsErr: any) {
          console.warn(`[Step ${i + 1}] TTS failed:`, ttsErr?.message || ttsErr);
        }
      }

      // 1. Calculate step duration based on the ACTUAL TTS audio duration so la voz
      // en off y el paso del vídeo vayan equilibrados (la voz rellena el paso, sin
      // quedarse corta ni ir "más ligera" que la acción). Si el TTS falla (ttsDuration
      // == 0), se usa la estimación por caracteres como respaldo.
      const estimatedVoiceoverDuration = Math.ceil(voiceoverText.length / 15) + 1.5;
      const voiceBasedDuration = ttsDuration > 0 ? ttsDuration + 0.5 : estimatedVoiceoverDuration;
      const stepDuration = Math.max(step.duration || 3, voiceBasedDuration);

      const stepStartTime = stepRealStart;
      const stepEndTime = stepStartTime + stepDuration;

      // 2. Wait for UI to update. Desktop still needs the full step duration because it
      // records the physical screen. Browser mode captures frames for the whole duration.
      const waitMs = step.action === 'wait'
        ? Math.min(parseInt(step.value || '1000', 10), 5000)
        : (isDesktopMode ? stepDuration * 1000 : 300);

      console.log(`[Step ${i + 1}] Text: "${voiceoverText.slice(0, 30)}...". Length: ${voiceoverText.length}. TTS: ${ttsDuration.toFixed(2)}s. Final duration: ${stepDuration}s.`);
      await new Promise(resolve => setTimeout(resolve, waitMs));

      // Capture screenshot after action
      let screenshot: string | null = null;
      if (isDesktopMode) {
        const result = await captureDesktopScreenshot(servePort, `step-${i + 1}.png`, adjustedArea, virtualCursorPosition, cursorImagePath);
        screenshot = result.screenshot;
      } else if (puppeteerPage) {
        // Determine the virtual cursor position inside the clip for this step's frames.
        // The page has the full viewport; the cursor must be placed at absolute page coords,
        // which are clip origin + relative mouse position + virtual offset.
        let frameCursorPosition: { x: number; y: number } | undefined;
        if (step.mousePosition?.x != null && step.mousePosition?.y != null && adjustedArea) {
          frameCursorPosition = {
            x: adjustedArea.x + step.mousePosition.x + (virtualMouseOffset?.x || 0),
            y: adjustedArea.y + step.mousePosition.y + (virtualMouseOffset?.y || 0),
          };
        }

        // Capture continuous frames for this step's video segment
        const captureDuration = Math.max(0.5, stepDuration - 0.3);
        frameIndex = await __zeusCaptureFrameSequence(puppeteerPage, framesDir, frameIndex, captureDuration, settings.fps, adjustedArea, frameCursorPosition);
        screenshot = await captureBrowserScreenshot(puppeteerPage, step.mousePosition, adjustedArea);
      } else {
        const result = await captureScreenshot(servePort, previewPort, step.mousePosition);
        screenshot = result.screenshot;
      }

      enrichedSteps.push({
        id: `step_${i + 1}`,
        order: i + 1,
        action: step.action || 'highlight',
        description: step.description || '',
        voiceover: voiceoverText,
        subtitle: subtitleText,
        duration: stepDuration,
        screenshot: screenshot || undefined,
        target: step.target,
        value: step.value,
        mousePosition: step.mousePosition || undefined,
        keyboardInput: step.keyboardInput || undefined,
        // Tiempos absolutos (s) dentro del vídeo raw, para el editor de timeline.
        subtitleStart: stepStartTime,
        subtitleEnd: stepEndTime,
        voiceStart: stepStartTime,
      });

      // Collect audio and subtitle events for composition
      if (ttsDuration > 0 && fs.existsSync(ttsPath)) {
        voiceFiles.push({ path: ttsPath, start: stepStartTime });
      }
      if (settings.subtitleEnabled && subtitleText.trim()) {
        subtitleEvents.push({ start: stepStartTime, end: stepEndTime, text: subtitleText });
      }
      currentTime = stepEndTime;
    }

    // Small extra wait at the end of all steps to avoid cutting the last voiceover
    if (isDesktopMode) {
      console.log('[Desktop] Waiting 2.5s for final voiceover buffer...');
      await new Promise(r => setTimeout(r, 2500));
    }

    // Stop recording / cleanup
    if (isDesktopMode && recordingResult) {
      job.message = 'Deteniendo grabación y finalizando...';
      const stopResult = await stopDesktopRecording(servePort);
      console.log(`[Desktop] Recording stopped: ${stopResult.outputPath}`);
      if (stopResult.outputPath && fs.existsSync(stopResult.outputPath)) {
        const stat = fs.statSync(stopResult.outputPath);
        console.log(`[Desktop] Final MP4 exists: ${stopResult.outputPath} (${stat.size} bytes)`);
        // Update recordingResult to point to the final MP4, not the temp AVI
        recordingResult = { outputPath: stopResult.outputPath, message: stopResult.message };

        // Mix and merge audio/subtitles for desktop video
        try {
          job.message = 'Generando subtítulos y preparando audio...';

          // Download background music if enabled and a URL is provided
          let musicPath: string | null = null;
          if (settings.backgroundMusic && backgroundMusicUrl) {
            try {
              const ext = path.extname(new URL(backgroundMusicUrl).pathname) || '.mp3';
              const musicTempPath = path.join(recDir, `music-${jobId}${ext}`);
              const downloaded = await __zeusDownloadMusic(backgroundMusicUrl, musicTempPath);
              if (downloaded) musicPath = musicTempPath;
            } catch (musicErr) {
              console.warn('[Desktop] Failed to download music:', musicErr);
            }
          }

          // Generate subtitle file only if there are events
          let assPath: string | null = null;
          if (subtitleEvents.length > 0) {
            assPath = path.join(recDir, `subtitles-${jobId}.ass`);
            await __zeusGenerateAssSubtitle(assPath, subtitleEvents, {
              fontSize: settings.subtitleFontSize,
              textColor: settings.subtitleTextColor,
              backgroundColor: settings.subtitleBackgroundColor,
              position: settings.subtitlePosition,
              verticalOffset: settings.subtitleVerticalOffset,
              fontFamily: settings.subtitleFontFamily,
            });
            console.log(`[Desktop] Generated ASS with ${subtitleEvents.length} events`);
          }

          // Mix voice and music
          const audioPath = path.join(recDir, `audio-${jobId}.aac`);
          const hasVoice = voiceFiles.length > 0;
          if (hasVoice) {
            await __zeusMixAudio(voiceFiles, musicPath, audioPath, settings.voiceoverVolume, settings.musicVolume);
          }

          job.message = 'Montando audio y subtítulos en el video de escritorio...';
          const tempInputPath = recordingResult.outputPath.replace(/\.mp4$/i, '-raw.mp4');
          fs.renameSync(recordingResult.outputPath, tempInputPath);

          let mergeOk = false;
          let hadSubtitles = false;
          let mergeWarnings: string[] = [];
          try {
            const result = await __zeusMergeAudioSubtitlesToVideo(
              tempInputPath,
              recordingResult.outputPath,
              hasVoice ? audioPath : null,
              assPath,
              settings.quality,
              videoSettings
            );
            hadSubtitles = result.hadSubtitles;
            mergeWarnings = result.warnings;
            if (result.warnings.length) {
              console.warn('[Desktop] Merge warnings:', result.warnings.join(' | '));
            }

            // Verificar con ffprobe que el MP4 final tiene los streams esperados.
            // Si no los tiene, marcamos la mezcla como fallida y caemos al fallback.
            const probe = await __zeusProbeStreams(recordingResult.outputPath, {
              audio: hasVoice,
              subtitles: false, // soft-subs sí, hard-sub no
            });
            const ok = probe.hasVideo && (!hasVoice || probe.hasAudio);
            if (!ok) {
              console.error(`[Desktop] MP4 final no tiene los streams esperados. hasVideo=${probe.hasVideo} hasAudio=${probe.hasAudio}`);
              mergeOk = false;
            } else {
              mergeOk = true;
              if (hadSubtitles) console.log(`[Desktop] Merge OK with subtitles (${probe.hasSubtitles ? 'soft' : 'hard'})`);
              else console.log(`[Desktop] Merge OK (audio only, no subtitles)`);
            }
          } catch (mergeErr: any) {
            console.warn('[Desktop] Audio/Subtitle merge failed, keeping raw video:', mergeErr?.message || mergeErr);
            mergeOk = false;
          }

          // Conservamos SIEMPRE la grabación raw (sin audio/subtítulos) para poder
          // re-editar el tutorial con el editor de timeline sin volver a grabar.
          let desktopRawVideoPath: string | undefined;
          if (mergeOk) {
            // El raw ya está en tempInputPath; lo dejamos ahí para diagnóstico/re-edición.
            desktopRawVideoPath = fs.existsSync(tempInputPath) ? tempInputPath : undefined;
          } else {
            // Fallback: el final ES el raw (sin mezcla). Lo usamos como raw también.
            if (fs.existsSync(tempInputPath)) {
              try { fs.renameSync(tempInputPath, recordingResult.outputPath); } catch {}
            }
            desktopRawVideoPath = fs.existsSync(recordingResult.outputPath) ? recordingResult.outputPath : undefined;
            console.warn('[Desktop] Merge did not complete cleanly. Final video may be missing audio/subtitles; see intermediate/ folder for fallback files.');
          }
          // Duración real de la grabación raw (alineada con los tiempos de subtítulo/voz).
          if (desktopRawVideoPath) {
            rawVideoPath = desktopRawVideoPath;
            const d = await __zeusGetMediaDuration(desktopRawVideoPath);
            if (d != null) rawDuration = d;
          }

          // Mover (no borrar) los archivos intermedios a una subcarpeta para
          // diagnóstico posterior. Solo se hace si la mezcla fue exitosa, así
          // no acumulamos gigas de basura tras cada tutorial.
          if (mergeOk) {
            try {
              const intermediateDir = path.join(recDir, 'intermediate');
              if (!fs.existsSync(intermediateDir)) fs.mkdirSync(intermediateDir, { recursive: true });
              if (fs.existsSync(audioPath)) fs.renameSync(audioPath, path.join(intermediateDir, path.basename(audioPath)));
              if (assPath && fs.existsSync(assPath)) fs.renameSync(assPath, path.join(intermediateDir, path.basename(assPath)));
              if (musicPath && fs.existsSync(musicPath)) fs.renameSync(musicPath, path.join(intermediateDir, path.basename(musicPath)));
              console.log(`[Desktop] Intermediate files moved to ${intermediateDir}`);
            } catch (mvErr) {
              console.warn('[Desktop] Failed to move intermediate files:', mvErr);
            }
          }

        } catch (desktopMergeErr: any) {
          console.error('[Desktop] Failed to process audio/subtitles for desktop video:', desktopMergeErr);
        } finally {
          try {
            if (fs.existsSync(audioDir)) {
              for (const f of fs.readdirSync(audioDir)) {
                fs.unlinkSync(path.join(audioDir, f));
              }
              fs.rmdirSync(audioDir);
            }
          } catch (cleanupErr) {
            console.warn('[Desktop] Failed to cleanup audio directory:', cleanupErr);
          }
        }
      } else {
        console.error(`[Desktop] Final MP4 missing after recording: ${stopResult.outputPath}`);
      }
    } else if (puppeteerBrowser) {
      job.message = 'Cerrando navegador de automatización...';
      await puppeteerBrowser.close();
      console.log('[Browser] Puppeteer cerrado');

      // Assemble video with audio and subtitles
      if (framesDir && fs.existsSync(framesDir) && recordingResult) {
        try {
          job.message = 'Generando subtítulos y preparando audio...';

          // Download background music if enabled and a URL is provided
          let musicPath: string | null = null;
          if (settings.backgroundMusic && backgroundMusicUrl) {
            const ext = path.extname(new URL(backgroundMusicUrl).pathname) || '.mp3';
            const musicTempPath = path.join(recDir, `music-${jobId}${ext}`);
            const downloaded = await __zeusDownloadMusic(backgroundMusicUrl, musicTempPath);
            if (downloaded) musicPath = musicTempPath;
          }

          // Generate subtitle file only if there are events
          let assPath: string | null = null;
          if (subtitleEvents.length > 0) {
            assPath = path.join(recDir, `subtitles-${jobId}.ass`);
            await __zeusGenerateAssSubtitle(assPath, subtitleEvents, {
              fontSize: settings.subtitleFontSize,
              textColor: settings.subtitleTextColor,
              backgroundColor: settings.subtitleBackgroundColor,
              position: settings.subtitlePosition,
              verticalOffset: settings.subtitleVerticalOffset,
              fontFamily: settings.subtitleFontFamily,
            });
            console.log(`[Browser] Generated ASS with ${subtitleEvents.length} events`);
          } else {
            console.log('[Browser] No subtitle events to generate');
          }

          // Mix voice and music (only when there is at least one voice file)
          const audioPath = path.join(recDir, `audio-${jobId}.aac`);
          const hasVoice = voiceFiles.length > 0;
          const hasMusic = !!musicPath;
          if (hasVoice) {
            await __zeusMixAudio(voiceFiles, musicPath, audioPath, settings.voiceoverVolume, settings.musicVolume);
          }

          job.message = 'Montando video final...';
          try {
            await __zeusBuildFinalVideo(framesDir, recordingResult.outputPath, hasVoice ? audioPath : null, assPath, settings.fps, settings.quality, videoSettings);
          } catch (buildErr: any) {
            console.warn('[Browser] Full video build failed, trying fallback without audio/subtitles:', buildErr?.message || buildErr);
            await __zeusBuildFinalVideo(framesDir, recordingResult.outputPath, null, null, settings.fps, settings.quality, videoSettings);
          }

          if (fs.existsSync(recordingResult.outputPath)) {
            const stat = fs.statSync(recordingResult.outputPath);
            console.log(`[Browser] Final video assembled: ${recordingResult.outputPath} (${stat.size} bytes)`);
          } else {
            console.error(`[Browser] Final video missing after assembly: ${recordingResult.outputPath}`);
          }
        } catch (ffmpegErr: any) {
          console.warn('[Browser] Failed to assemble video:', ffmpegErr?.message || ffmpegErr);
        } finally {
          // Cleanup temporary directories
          try {
            if (fs.existsSync(framesDir)) {
              for (const f of fs.readdirSync(framesDir)) {
                fs.unlinkSync(path.join(framesDir, f));
              }
              fs.rmdirSync(framesDir);
            }
          } catch (cleanupErr) {
            console.warn('[Browser] Failed to cleanup frames directory:', cleanupErr);
          }
          try {
            if (fs.existsSync(audioDir)) {
              for (const f of fs.readdirSync(audioDir)) {
                fs.unlinkSync(path.join(audioDir, f));
              }
              fs.rmdirSync(audioDir);
            }
          } catch (cleanupErr) {
            console.warn('[Browser] Failed to cleanup audio directory:', cleanupErr);
          }
        }
      }
    }

    // 6. Save tutorial to PocketBase
    job.message = 'Guardando tutorial en la base de datos...';
    job.progress = 88;

    // Guardamos los pasos con sus capturas base64 para que sean visibles en el frontend.
    // Si un screenshot es demasiado grande, lo truncamos para evitar rechazo de PocketBase.
    const MAX_SCREENSHOT_LEN = 500000; // ~500KB de base64 por paso
    const finalVideoPath = recordingResult?.outputPath;
    let finalVideoSize = 0;
    if (finalVideoPath && fs.existsSync(finalVideoPath)) {
      finalVideoSize = fs.statSync(finalVideoPath).size;
    }
    const stepsForDb = enrichedSteps.map((s: any) => ({
      ...s,
      screenshot: s.screenshot && s.screenshot.length > MAX_SCREENSHOT_LEN
        ? s.screenshot.substring(0, MAX_SCREENSHOT_LEN)
        : s.screenshot,
    }));

    const tutorialData = {
      title: tutorialPlan.title || description.slice(0, 80),
      description: tutorialPlan.description || description,
      appPath: params.appPath || 'Zeus Desktop',
      modelId: params.modelId || '',
      status: 'completed',
      steps: stepsForDb,
      settings: {
        ...settings,
        mode: mode || 'browser',
        recordingOutputPath: finalVideoPath || undefined,
      },
      metadata: {
        duration: enrichedSteps.reduce((acc: number, s: any) => acc + (s.duration || 3), 0),
        fileSize: finalVideoSize,
        resolution: settings.resolution === '4k' ? '3840x2160' : settings.resolution === '1440p' ? '2560x1440' : '1920x1080',
        fps: settings.fps,
        audioBitrate: 128000,
        videoBitrate: settings.quality === 'low' ? 2000000 : settings.quality === 'medium' ? 5000000 : settings.quality === 'ultra' ? 16000000 : 8000000,
        thumbnail: enrichedSteps[0]?.screenshot && enrichedSteps[0].screenshot.length > MAX_SCREENSHOT_LEN
          ? enrichedSteps[0].screenshot.substring(0, MAX_SCREENSHOT_LEN)
          : enrichedSteps[0]?.screenshot || undefined,
        videoPath: finalVideoPath || undefined,
        rawVideoPath,
        rawDuration,
      },
      prompt: description,
    };

    let savedTutorial: any;
    let saveError: any = null;
    try {
      if (tutorialId) {
        // Actualizar el tutorial existente (el usuario ya lo creó con su título).
        // Omitimos `title` del payload para no sobrescribir el título que el usuario
        // puso con el que la IA genera a partir de la descripción.
        const { title: _omitTitle, ...updateData } = tutorialData;
        savedTutorial = await pb.collection('tutorials').update(tutorialId, updateData);
        console.log('[GenerateTutorial] Tutorial existente actualizado en PocketBase con ID:', savedTutorial.id);
      } else {
        savedTutorial = await pb.collection('tutorials').create(tutorialData);
        console.log('[GenerateTutorial] Tutorial guardado en PocketBase con ID:', savedTutorial.id);
      }
    } catch (pbErr: any) {
      saveError = pbErr;
      console.error('[GenerateTutorial] ════════════════════════════════════════');
      console.error('[GenerateTutorial] PocketBase GUARDADO FALLIDO');
      console.error('[GenerateTutorial] Error:', pbErr?.message || pbErr);
      if (pbErr?.response?.data) {
        console.error('[GenerateTutorial] Validation errors:', JSON.stringify(pbErr.response.data, null, 2));
      }
      if (pbErr?.status) {
        console.error('[GenerateTutorial] HTTP status:', pbErr.status);
      }
      console.error('[GenerateTutorial] ════════════════════════════════════════');
      // Fallback: return in-memory tutorial
      savedTutorial = {
        id: Date.now().toString(),
        ...tutorialData,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };
    }

    // Subir el vídeo MP4 final al campo `file` del registro en PocketBase.
    // La generación crea el MP4 en disco (finalVideoPath) pero, sin este paso, el
    // campo `file` queda vacío y el tutorial no aparece en la pestaña MP4 del frontend.
    let generatedFileUrl: string | undefined;
    let generatedFileSoundUrl: string | undefined;
    if (!saveError && finalVideoPath && fs.existsSync(finalVideoPath)) {
      try {
        const fileBuffer = fs.readFileSync(finalVideoPath);
        const formData = new FormData();
        // En el flujo automático (generate) no hay base limpia subida por el
        // usuario: el propio MP4 final ya viene con voz/música/subtítulos, así
        // que `file` y `file_sound` reciben el mismo vídeo final. En modo manual,
        // en cambio, `file` lo fija /raw-video (limpio) y rebuild/trim sólo
        // actualizan `file_sound` (con sonido), conservando el limpio en `file`.
        formData.append('file', new Blob([fileBuffer], { type: 'video/mp4' }), `${savedTutorial.id}.mp4`);
        formData.append('file_sound', new Blob([fileBuffer], { type: 'video/mp4' }), `${savedTutorial.id}-sound.mp4`);
        const uploadResponse = await fetch(`${pb.baseUrl}/api/collections/tutorials/records/${savedTutorial.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${pb.authStore.token}`,
          },
          body: formData as any,
        });
        if (uploadResponse.ok) {
          const uploadData = await uploadResponse.json();
          if (uploadData.file) {
            generatedFileUrl = `${pb.baseUrl}/api/files/${uploadData.collectionId}/${uploadData.id}/${uploadData.file}`;
            console.log('[GenerateTutorial] MP4 subido al campo file:', generatedFileUrl);
          }
          if (uploadData.file_sound) {
            generatedFileSoundUrl = `${pb.baseUrl}/api/files/${uploadData.collectionId}/${uploadData.id}/${uploadData.file_sound}`;
            console.log('[GenerateTutorial] MP4 con sonido subido al campo file_sound:', generatedFileSoundUrl);
          }
        } else {
          console.warn('[GenerateTutorial] Subida del MP4 al campo file falló (status):', uploadResponse.status);
        }
      } catch (uploadErr: any) {
        console.warn('[GenerateTutorial] No se pudo subir el MP4 al campo file:', uploadErr?.message || uploadErr);
      }
    }

    // 7. Build the response object matching the Tutorial type
    const tutorial = {
      id: savedTutorial.id,
      title: savedTutorial.title,
      description: savedTutorial.description,
      targetApp: savedTutorial.appPath || savedTutorial.targetApp || '',
      status: 'completed' as const,
      steps: enrichedSteps,
      settings: savedTutorial.settings || {},
      metadata: savedTutorial.metadata || {},
      backgroundMusicUrl: savedTutorial.background_music ? `${pb.baseUrl}/api/files/${savedTutorial.collectionId}/${savedTutorial.id}/${savedTutorial.background_music}` : undefined,
      file: generatedFileUrl || (savedTutorial.file ? `${pb.baseUrl}/api/files/${savedTutorial.collectionId}/${savedTutorial.id}/${savedTutorial.file}` : undefined),
      fileSound: generatedFileSoundUrl || (savedTutorial.file_sound ? `${pb.baseUrl}/api/files/${savedTutorial.collectionId}/${savedTutorial.id}/${savedTutorial.file_sound}` : undefined),
      createdAt: savedTutorial.created || new Date().toISOString(),
      updatedAt: savedTutorial.updated || new Date().toISOString(),
    };

    job.status = 'completed';
    job.progress = 100;
    job.message = '¡Tutorial generado correctamente!';
    job.tutorialId = savedTutorial.id;
    job.tutorial = tutorial;

  } catch (error: any) {
    console.error('[GenerateTutorial] Error:', error);
    job.status = 'failed';
    job.progress = 0;
    job.message = 'Error al generar el tutorial';
    job.error = error?.message || 'Error desconocido';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-build de un tutorial desktop a partir de pasos editados.
// Reutiliza la grabación raw original (no vuelve a grabar la pantalla):
// regenera TTS por paso, re-mezcla audio, regenera subtítulos ASS y los
// "quema" de nuevo sobre el raw. Los textos/tiempos editados se persisten.
// ─────────────────────────────────────────────────────────────────────────────
async function runTutorialRebuild(
  jobId: string,
  params: {
    tutorialId: string;
    steps: Array<{
      id?: string;
      subtitle?: string;
      voiceover?: string;
      subtitleStart?: number;
      subtitleEnd?: number;
      voiceStart?: number;
      duration?: number;
    }>;
    settings?: Record<string, unknown>;
    backgroundMusicUrl?: string;
    videoSettings?: {
      brillo?: number;
      contraste?: number;
      intensidad?: number;
      tiempo_inicio?: number;
    };
  }
) {
  const job = generationJobs.get(jobId)!;
  try {
    await authAsAdmin();
    const r: any = await pb.collection('tutorials').getOne(params.tutorialId);

    const recordSettings: any = typeof r.settings === 'string' ? JSON.parse(r.settings || '{}') : (r.settings || {});
    const recordMetadata: any = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {});
    const recordSteps: any[] = typeof r.steps === 'string' ? JSON.parse(r.steps || '[]') : (r.steps || []);

    // settings finales: los editados tienen prioridad, pero conservamos modo/path.
    const settings: any = { ...recordSettings, ...(params.settings || {}) };
    const quality = settings.quality || 'high';

    const rawVideoPath: string | undefined = recordMetadata.rawVideoPath;
    if (!rawVideoPath || !fs.existsSync(rawVideoPath)) {
      throw new Error('Este tutorial no tiene grabación original (raw) disponible para re-editar. Se generó antes de esta función o el archivo fue eliminado.');
    }
    const rawDuration: number | null = recordMetadata.rawDuration != null
      ? recordMetadata.rawDuration
      : await __zeusGetMediaDuration(rawVideoPath);

    // Directorio de trabajo: junto al raw.
    const recDir = path.dirname(rawVideoPath);
    const workDir = path.join(recDir, `rebuild-${jobId}`);
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    // Red de seguridad: el raw de escritorio NO lleva audio (gdigrab graba sólo
    // vídeo). Pero si por algún motivo rawVideoPath apunta a un archivo CON pista
    // de audio (p.ej. el vídeo normal ya mezclado, no el raw), le quitamos el
    // audio a un temporal limpio antes de mezclar. Así nunca se monta la voz
    // nueva sobre la voz vieja (síntoma: la misma frase suena dos veces, con el
    // tiempo antiguo y el nuevo).
    let cleanRawPath = rawVideoPath;
    try {
      const probeRaw = await __zeusProbeStreams(rawVideoPath, { audio: true, subtitles: false });
      if (probeRaw.hasAudio) {
        console.warn(`[Rebuild] El raw "${rawVideoPath}" tiene pista de audio (no debería). Se le quita el audio para evitar duplicar la voz.`);
        cleanRawPath = path.join(workDir, `raw-noaudio-${jobId}.mp4`);
        const stripRes = await __zeusRunFfmpeg([
          '-y', '-i', rawVideoPath, '-map', '0:v:0', '-an',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
          '-pix_fmt', 'yuv420p', '-movflags', '+faststart', cleanRawPath,
        ], 'Rebuild strip raw audio');
        if (stripRes.code !== 0 || !fs.existsSync(cleanRawPath)) {
          console.warn('[Rebuild] No se pudo quitar el audio del raw; se sigue usando el original (el merge ya excluye el audio del origen con -map 0:v:0).');
          cleanRawPath = rawVideoPath;
        }
      }
    } catch (probeErr: any) {
      console.warn('[Rebuild] No se pudo comprobar el audio del raw:', probeErr?.message || probeErr);
      cleanRawPath = rawVideoPath;
    }
    const audioDir = path.join(workDir, 'audio');
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

    // Combinar pasos editados con los del record (para conservar campos no editables
    // como screenshot/mousePosition en el persist final).
    const editedById = new Map((params.steps || []).map((s, i) => [s.id || `__idx_${i}`, s]));
    const mergedSteps: any[] = recordSteps.map((rs: any, i: number) => {
      const ed = editedById.get(rs.id) || editedById.get(`__idx_${i}`);
      if (!ed) return rs;
      return {
        ...rs,
        subtitle: ed.subtitle ?? rs.subtitle,
        voiceover: ed.voiceover ?? rs.voiceover,
        duration: ed.duration ?? rs.duration,
        subtitleStart: ed.subtitleStart ?? rs.subtitleStart,
        subtitleEnd: ed.subtitleEnd ?? rs.subtitleEnd,
        voiceStart: ed.voiceStart ?? rs.voiceStart,
      };
    });

    const voiceFiles: { path: string; start: number }[] = [];
    const subtitleEvents: { start: number; end: number; text: string }[] = [];

    job.message = 'Regenerando voz en off (TTS)...';
    let done = 0;
    const total = mergedSteps.length;
    for (let i = 0; i < total; i++) {
      const s = mergedSteps[i];
      const voiceoverText = (s.voiceover || '').trim();
      const subtitleText = (s.subtitle || '').trim();

      // TTS por paso (si hay guion). Se regenera siempre: el texto pudo cambiar.
      if (voiceoverText) {
        const ttsPath = path.join(audioDir, `voice-${String(i).padStart(4, '0')}.wav`);
        try {
          await __zeusGenerateTtsAudio(voiceoverText, ttsPath, settings.subtitleLanguage, settings.voice);
          if (fs.existsSync(ttsPath)) {
            voiceFiles.push({ path: ttsPath, start: Number(s.voiceStart ?? 0) });
          }
        } catch (ttsErr: any) {
          console.warn(`[Rebuild] TTS falló en paso ${i + 1}:`, ttsErr?.message || ttsErr);
        }
      }

      if (settings.subtitleEnabled && subtitleText && s.subtitleStart != null && s.subtitleEnd != null) {
        subtitleEvents.push({
          start: Number(s.subtitleStart),
          end: Number(s.subtitleEnd),
          text: subtitleText,
        });
      }

      done++;
      job.progress = Math.round((done / total) * 60);
    }

    // Música de fondo (si la había).
    let musicPath: string | null = null;
    if (settings.backgroundMusic && params.backgroundMusicUrl) {
      try {
        const ext = path.extname(new URL(params.backgroundMusicUrl).pathname) || '.mp3';
        const musicTempPath = path.join(workDir, `music-${jobId}${ext}`);
        const downloaded = await __zeusDownloadMusic(params.backgroundMusicUrl, musicTempPath);
        if (downloaded) musicPath = musicTempPath;
      } catch (musicErr) {
        console.warn('[Rebuild] No se pudo descargar la música:', musicErr);
      }
    }

    // Mix audio.
    let audioPath: string | null = null;
    if (voiceFiles.length > 0) {
      job.message = 'Mezclando audio...';
      audioPath = path.join(workDir, `audio-${jobId}.aac`);
      await __zeusMixAudio(voiceFiles, musicPath, audioPath, settings.voiceoverVolume ?? 0.8, settings.musicVolume ?? 0.3);
    }

    // Subtítulos ASS.
    let assPath: string | null = null;
    if (subtitleEvents.length > 0) {
      job.message = 'Generando subtítulos...';
      assPath = path.join(workDir, `subtitles-${jobId}.ass`);
      await __zeusGenerateAssSubtitle(assPath, subtitleEvents, {
        fontSize: settings.subtitleFontSize,
        textColor: settings.subtitleTextColor,
        backgroundColor: settings.subtitleBackgroundColor,
        position: settings.subtitlePosition,
        verticalOffset: settings.subtitleVerticalOffset,
        fontFamily: settings.subtitleFontFamily,
      });
    }

    // Merge sobre el raw → nueva salida (no sobrescribe el final previo).
    job.message = 'Montando audio y subtítulos sobre la grabación...';
    job.progress = 75;
    const finalVideoPath = path.join(recDir, `tutorial-${params.tutorialId}-edited-${jobId}.mp4`);
    const mergeResult = await __zeusMergeAudioSubtitlesToVideo(
      cleanRawPath,
      finalVideoPath,
      audioPath,
      assPath,
      quality,
      params.videoSettings
    );
    if (mergeResult.warnings.length) {
      console.warn('[Rebuild] Merge warnings:', mergeResult.warnings.join(' | '));
    }

    if (!fs.existsSync(finalVideoPath)) {
      throw new Error('El merge no produjo un MP4 válido.');
    }

    // Validar streams finales.
    const probe = await __zeusProbeStreams(finalVideoPath, { audio: voiceFiles.length > 0, subtitles: false });
    if (!probe.hasVideo) {
      throw new Error('El MP4 resultante no tiene pista de vídeo.');
    }

    const finalSize = fs.statSync(finalVideoPath).size;

    // Persistir: steps editados + nueva ruta de vídeo + metadata actualizada.
    const newMetadata = {
      ...recordMetadata,
      fileSize: finalSize,
      duration: rawDuration != null ? rawDuration : (recordMetadata.duration || 0),
      videoPath: finalVideoPath,
      rawVideoPath, // se mantiene para futuras re-ediciones
      rawDuration: rawDuration ?? recordMetadata.rawDuration,
    };
    const newSettings = { ...settings, recordingOutputPath: finalVideoPath };

    // Subir el vídeo MP4 final (con voz/música/subtítulos) al campo `file_sound`
    // de la colección tutoriales. Se sobrescribe en cada modificación (rebuild/trim)
    // para que la BD tenga siempre la última versión con sonido. El campo `file`
    // (vídeo limpio/base) NO se toca aquí: se conserva para re-editar y previsualizar
    // el base (lo subió /raw-video en modo manual, o el generate en modo auto).
    let fileUrl: string | undefined;
    let fileSoundUrl: string | undefined;
    try {
      const fileBuffer = fs.readFileSync(finalVideoPath);
      const formData = new FormData();
      formData.append('file_sound', new Blob([fileBuffer], { type: 'video/mp4' }), `${params.tutorialId}-sound.mp4`);
      const uploadResponse = await fetch(`${pb.baseUrl}/api/collections/tutorials/records/${params.tutorialId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${pb.authStore.token}`,
        },
        body: formData as any,
      });
      if (uploadResponse.ok) {
        const uploadData = await uploadResponse.json();
        fileSoundUrl = uploadData.file_sound ? `${pb.baseUrl}/api/files/${uploadData.collectionId}/${uploadData.id}/${uploadData.file_sound}` : undefined;
        fileUrl = uploadData.file ? `${pb.baseUrl}/api/files/${uploadData.collectionId}/${uploadData.id}/${uploadData.file}` : undefined;
      }
    } catch (uploadErr) {
      console.warn('[Rebuild] No se pudo subir el vídeo MP4 al campo file_sound:', uploadErr);
    }

    await pb.collection('tutorials').update(params.tutorialId, {
      steps: mergedSteps,
      settings: newSettings,
      metadata: newMetadata,
    });

    const tutorial = {
      id: r.id,
      title: r.title,
      description: r.description,
      targetApp: r.appPath || r.targetApp || '',
      status: r.status || 'completed',
      steps: mergedSteps,
      settings: newSettings,
      metadata: newMetadata,
      backgroundMusicUrl: r.background_music ? `${pb.baseUrl}/api/files/${r.collectionId}/${r.id}/${r.background_music}` : undefined,
      file: fileUrl || (r.file ? `${pb.baseUrl}/api/files/${r.collectionId}/${r.id}/${r.file}` : undefined),
      fileSound: fileSoundUrl || (r.file_sound ? `${pb.baseUrl}/api/files/${r.collectionId}/${r.id}/${r.file_sound}` : undefined),
      createdAt: r.created,
      updatedAt: r.updated,
    };

    // Limpieza del directorio de trabajo temporal (wav por paso, etc.).
    try {
      for (const f of fs.readdirSync(audioDir)) fs.unlinkSync(path.join(audioDir, f));
      fs.rmdirSync(audioDir);
      if (musicPath && fs.existsSync(musicPath)) fs.unlinkSync(musicPath);
      // Conservamos audio/subs del workDir por si se quieren inspeccionar, pero
      // borramos el directorio si quedó vacío.
    } catch (cleanupErr) {
      console.warn('[Rebuild] Limpieza parcial:', cleanupErr);
    }

    job.status = 'completed';
    job.progress = 100;
    job.message = '¡MP4 re-generado correctamente!';
    job.tutorialId = params.tutorialId;
    job.tutorial = tutorial;

  } catch (error: any) {
    console.error('[Rebuild] Error:', error);
    job.status = 'failed';
    job.progress = 0;
    job.message = error?.message || 'Error al re-generar el tutorial';
    job.error = error?.message || 'Error desconocido';
  }
}

// ── Recorte de un tutorial desktop (trim del MP4 final) ──
// Corta el MP4 ya generado según los rangos a conservar y re-exporta un MP4
// nuevo con esa duración. Soporta cortar por delante, por detrás y extraer un
// fragmento del medio (múltiples segmentos que se concatenan).
async function runTutorialTrim(
  jobId: string,
  params: {
    tutorialId: string;
    segments: Array<{ start: number; end: number; speed?: number }>;
  }
) {
  const job = generationJobs.get(jobId)!;
  try {
    await authAsAdmin();
    const r: any = await pb.collection('tutorials').getOne(params.tutorialId);

    const recordSettings: any = typeof r.settings === 'string' ? JSON.parse(r.settings || '{}') : (r.settings || {});
    const recordMetadata: any = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {});

    // Resolver el MP4 origen: preferimos la ruta en disco (recordingOutputPath o
    // videoPath); si no existe, descargamos el campo `file` de PocketBase.
    let srcPath: string | null = null;
    const diskCandidates = [recordSettings.recordingOutputPath, recordMetadata.videoPath].filter(Boolean) as string[];
    for (const c of diskCandidates) {
      if (fs.existsSync(c) && await isVideoFileValid(c)) { srcPath = c; break; }
    }
    if (!srcPath && r.file) {
      const fileUrl = `${pb.baseUrl}/api/files/${r.collectionId}/${r.id}/${r.file}`;
      const tmpDir = path.join(path.resolve(__dirname, '..', 'serve', 'logs'), `trim-src-${jobId}`);
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const tmpPath = path.join(tmpDir, `src-${r.file}`);
      const ok = await __zeusDownloadMusic(fileUrl, tmpPath);
      if (ok && fs.existsSync(tmpPath) && await isVideoFileValid(tmpPath)) {
        srcPath = tmpPath;
      }
    }
    if (!srcPath) {
      throw new Error('Este tutorial no tiene un MP4 disponible para recortar (no hay archivo en disco ni en el campo file).');
    }

    const totalDuration = (await __zeusGetMediaDuration(srcPath)) ?? recordMetadata.duration ?? 0;
    if (!totalDuration) {
      throw new Error('No se pudo determinar la duración del vídeo origen.');
    }

    // Normalizar y validar segmentos a conservar: ordenados, start<end, dentro
    // de la duración, sin solapes. Descartamos los inválidos.
    const segs = params.segments
      .map(s => {
        let speed = Number(s.speed);
        if (!Number.isFinite(speed) || speed <= 0) speed = 1;
        // atempo de ffmpeg admite [0.5, 2.0] en un solo filtro; limitamos a ese
        // rango (la UI ya ofrece solo valores dentro de él).
        speed = Math.max(0.5, Math.min(2.0, speed));
        return { start: Math.max(0, Number(s.start) || 0), end: Math.min(totalDuration, Number(s.end) || 0), speed };
      })
      .filter(s => s.end > s.start && (s.end - s.start) > 0.05)
      .sort((a, b) => a.start - b.start);
    if (segs.length === 0) {
      throw new Error('No hay segmentos válidos que conservar (el recorte resultante sería vacío).');
    }
    // Eliminar solapes recortando el final del anterior.
    for (let i = 1; i < segs.length; i++) {
      if (segs[i].start < segs[i - 1].end) segs[i].start = segs[i - 1].end;
      if (segs[i].end <= segs[i].start) { segs.splice(i, 1); i--; }
    }
    if (segs.length === 0) {
      throw new Error('Los segmentos se solapan totalmente; el recorte resultante sería vacío.');
    }

    const recDir = path.dirname(srcPath);
    const workDir = path.join(recDir, `trim-${jobId}`);
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    // Comprobar si el origen tiene audio para conservarlo en cada trozo.
    const probeSrc = await __zeusProbeStreams(srcPath, { audio: true, subtitles: false });
    const hasAudio = probeSrc.hasAudio;

    job.message = `Recortando ${segs.length} segmento(s)...`;
    const segPaths: string[] = [];
    const total = segs.length;
    for (let i = 0; i < total; i++) {
      const s = segs[i];
      const speed = s.speed && s.speed !== 1 ? s.speed : 1;
      const segPath = path.join(workDir, `seg-${String(i).padStart(3, '0')}.mp4`);
      const args = [
        '-y', '-ss', String(s.start), '-to', String(s.end), '-i', srcPath,
        '-map', '0:v:0',
      ];
      if (speed !== 1) {
        // setpts escala la cadencia de vídeo: PTS/speed (speed>1 = más rápido
        // y corto; speed<1 = más lento y largo).
        args.push('-vf', `setpts=PTS/${speed}`);
      }
      args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
      if (hasAudio) {
        args.push('-map', '0:a:0');
        if (speed !== 1) {
          // atempo cambia la velocidad del audio sin cambiar el tono (0.5–2.0).
          args.push('-af', `atempo=${speed}`);
        }
        args.push('-c:a', 'aac', '-b:a', '128k');
      } else {
        args.push('-an');
      }
      args.push(segPath);
      const tag = speed !== 1 ? `Trim seg ${i + 1}/${total} (x${speed})` : `Trim seg ${i + 1}/${total}`;
      const res = await __zeusRunFfmpeg(args, tag);
      if (res.code !== 0 || !fs.existsSync(segPath)) {
        throw new Error(`ffmpeg falló al cortar el segmento ${i + 1}.`);
      }
      segPaths.push(segPath);
      job.progress = Math.round(((i + 1) / total) * 80);
    }

    // Concatenar (o usar el único segmento directamente).
    job.message = 'Concatenando segmentos...';
    job.progress = 85;
    const finalVideoPath = path.join(recDir, `tutorial-${params.tutorialId}-trimmed-${jobId}.mp4`);
    if (segPaths.length === 1) {
      fs.copyFileSync(segPaths[0], finalVideoPath);
    } else {
      const listPath = path.join(workDir, 'concat.txt');
      const listContent = segPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
      fs.writeFileSync(listPath, listContent, 'utf8');
      // Intentar concat sin re-encode (rápido); si falla, re-encode del concat.
      let concatRes = await __zeusRunFfmpeg([
        '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c', 'copy', '-movflags', '+faststart', finalVideoPath,
      ], 'Trim concat copy');
      if (concatRes.code !== 0 || !fs.existsSync(finalVideoPath)) {
        console.warn('[Trim] concat -c copy falló, re-encode del concat entero.');
        const reArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath,
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
          '-pix_fmt', 'yuv420p'];
        if (hasAudio) reArgs.push('-c:a', 'aac', '-b:a', '128k'); else reArgs.push('-an');
        reArgs.push('-movflags', '+faststart', finalVideoPath);
        concatRes = await __zeusRunFfmpeg(reArgs, 'Trim concat re-encode');
      }
      if (concatRes.code !== 0 || !fs.existsSync(finalVideoPath)) {
        throw new Error('ffmpeg falló al concatenar los segmentos.');
      }
    }

    // Validar resultado.
    if (!(await isVideoFileValid(finalVideoPath))) {
      throw new Error('El MP4 recortado no es válido.');
    }
    const probe = await __zeusProbeStreams(finalVideoPath, { audio: hasAudio, subtitles: false });
    if (!probe.hasVideo) {
      throw new Error('El MP4 recortado no tiene pista de vídeo.');
    }
    const finalDuration = (await __zeusGetMediaDuration(finalVideoPath)) ?? 0;
    const finalSize = fs.statSync(finalVideoPath).size;

    // Persistir (espejo de runTutorialRebuild): metadata + settings + file.
    const newMetadata = {
      ...recordMetadata,
      fileSize: finalSize,
      duration: finalDuration || recordMetadata.duration,
      videoPath: finalVideoPath,
      // Conservamos rawVideoPath/rawDuration para que siga permitiendo el
      // re-export completo (rebuild) sobre la grabación original.
    };
    const newSettings = { ...recordSettings, recordingOutputPath: finalVideoPath };

    let fileUrl: string | undefined;
    let fileSoundUrl: string | undefined;
    try {
      const fileBuffer = fs.readFileSync(finalVideoPath);
      const formData = new FormData();
      // Sólo se actualiza `file_sound` (con sonido, recortado). `file` (limpio/base)
      // se conserva intacto para seguir re-editando y previsualizando el base.
      formData.append('file_sound', new Blob([fileBuffer], { type: 'video/mp4' }), `${params.tutorialId}-sound.mp4`);
      const uploadResponse = await fetch(`${pb.baseUrl}/api/collections/tutorials/records/${params.tutorialId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${pb.authStore.token}` },
        body: formData as any,
      });
      if (uploadResponse.ok) {
        const uploadData = await uploadResponse.json();
        fileSoundUrl = uploadData.file_sound ? `${pb.baseUrl}/api/files/${uploadData.collectionId}/${uploadData.id}/${uploadData.file_sound}` : undefined;
        fileUrl = uploadData.file ? `${pb.baseUrl}/api/files/${uploadData.collectionId}/${uploadData.id}/${uploadData.file}` : undefined;
      }
    } catch (uploadErr) {
      console.warn('[Trim] No se pudo subir el MP4 recortado al campo file_sound:', uploadErr);
    }

    await pb.collection('tutorials').update(params.tutorialId, {
      settings: newSettings,
      metadata: newMetadata,
    });

    const tutorial = {
      id: r.id,
      title: r.title,
      description: r.description,
      targetApp: r.appPath || r.targetApp || '',
      status: r.status || 'completed',
      steps: typeof r.steps === 'string' ? JSON.parse(r.steps || '[]') : (r.steps || []),
      settings: newSettings,
      metadata: newMetadata,
      backgroundMusicUrl: r.background_music ? `${pb.baseUrl}/api/files/${r.collectionId}/${r.id}/${r.background_music}` : undefined,
      file: fileUrl,
      fileSound: fileSoundUrl,
      createdAt: r.created,
      updatedAt: r.updated,
    };

    // Limpieza del workDir y del posible src temporal descargado.
    try {
      for (const f of fs.readdirSync(workDir)) fs.unlinkSync(path.join(workDir, f));
      fs.rmdirSync(workDir);
      if (srcPath !== (recordSettings.recordingOutputPath || recordMetadata.videoPath)) {
        // srcPath era un temporal descargado de PocketBase: borrar su carpeta.
        const tmpParent = path.dirname(srcPath);
        if (fs.existsSync(tmpParent) && tmpParent.includes(`trim-src-${jobId}`)) {
          for (const f of fs.readdirSync(tmpParent)) fs.unlinkSync(path.join(tmpParent, f));
          fs.rmdirSync(tmpParent);
        }
      }
    } catch (cleanupErr) {
      console.warn('[Trim] Limpieza parcial:', cleanupErr);
    }

    job.status = 'completed';
    job.progress = 100;
    job.message = '¡MP4 recortado correctamente!';
    job.tutorialId = params.tutorialId;
    job.tutorial = tutorial;
  } catch (error: any) {
    console.error('[Trim] Error:', error);
    job.status = 'failed';
    job.progress = 0;
    job.message = error?.message || 'Error al recortar el tutorial';
    job.error = error?.message || 'Error desconocido';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tutorial endpoints — CRUD + Generate
// ─────────────────────────────────────────────────────────────────────────────

// List tutorials
app.get('/api/tutorials', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const records = await pb.collection('tutorials').getFullList({ sort: '-created' });
    const tutorials = records.map((r: any) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      targetApp: r.appPath || r.targetApp || '',
      status: r.status || 'completed',
      steps: typeof r.steps === 'string' ? JSON.parse(r.steps || '[]') : (r.steps || []),
      settings: typeof r.settings === 'string' ? JSON.parse(r.settings || '{}') : (r.settings || {}),
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {}),
      backgroundMusicUrl: r.background_music ? `${pb.baseUrl}/api/files/${r.collectionId}/${r.id}/${r.background_music}` : undefined,
      file: r.file ? `${pb.baseUrl}/api/files/${r.collectionId}/${r.id}/${r.file}` : undefined,
      fileSound: r.file_sound ? `${pb.baseUrl}/api/files/${r.collectionId}/${r.id}/${r.file_sound}` : undefined,
      createdAt: r.created,
      updatedAt: r.updated,
    }));
    res.json(tutorials);
  } catch (error) {
    console.error('Error fetching tutorials:', error);
    res.json([]);
  }
});

// Get tutorial by ID
app.get('/api/tutorials/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const r = await pb.collection('tutorials').getOne(req.params.id);
    res.json({
      id: r.id,
      title: r.title,
      description: r.description,
      targetApp: r.appPath || r.targetApp || '',
      status: r.status || 'completed',
      steps: typeof r.steps === 'string' ? JSON.parse(r.steps || '[]') : (r.steps || []),
      settings: typeof r.settings === 'string' ? JSON.parse(r.settings || '{}') : (r.settings || {}),
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {}),
      backgroundMusicUrl: r.background_music ? `${pb.baseUrl}/api/files/${r.collectionId}/${r.id}/${r.background_music}` : undefined,
      file: r.file ? `${pb.baseUrl}/api/files/${r.collectionId}/${r.id}/${r.file}` : undefined,
      fileSound: r.file_sound ? `${pb.baseUrl}/api/files/${r.collectionId}/${r.id}/${r.file_sound}` : undefined,
      createdAt: r.created,
      updatedAt: r.updated,
    });
  } catch (error) {
    res.status(404).json({ error: 'Tutorial not found' });
  }
});

// Create tutorial manually
app.post('/api/tutorials', uploadMusic.single('backgroundMusic'), async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const body = req.body;
    const formData = new FormData();
    formData.append('title', body.title || 'Nuevo Tutorial');
    formData.append('description', body.description || 'Sin descripción');
    formData.append('modelId', body.modelId || 'default');
    formData.append('appPath', body.appPath || 'Zeus Desktop');
    formData.append('status', body.status || 'draft');
    formData.append('prompt', body.prompt || '');
    formData.append('steps', body.steps || '[]');
    formData.append('settings', body.settings || '{}');
    formData.append('metadata', body.metadata || '{}');
    if (req.file) {
      const uint8Array = new Uint8Array(req.file.buffer);
      formData.append('background_music', new Blob([uint8Array]), req.file.originalname);
    }

    const record = await pb.collection('tutorials').create(formData);
    res.status(201).json({
      id: record.id,
      title: record.title,
      description: record.description,
      targetApp: record.appPath || record.targetApp || '',
      status: record.status || 'draft',
      steps: typeof record.steps === 'string' ? JSON.parse(record.steps || '[]') : (record.steps || []),
      settings: typeof record.settings === 'string' ? JSON.parse(record.settings || '{}') : (record.settings || {}),
      metadata: typeof record.metadata === 'string' ? JSON.parse(record.metadata || '{}') : (record.metadata || {}),
      backgroundMusicUrl: record.background_music ? `${pb.baseUrl}/api/files/${record.collectionId}/${record.id}/${record.background_music}` : undefined,
      createdAt: record.created,
      updatedAt: record.updated,
    });
  } catch (error) {
    console.error('Error creating tutorial:', error);
    res.status(500).json({ error: 'Failed to create tutorial' });
  }
});

// Update tutorial
app.put('/api/tutorials/:id', uploadMusic.single('backgroundMusic'), async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const body = req.body;
    const updatePayload: any = {};

    // Merge partial settings with existing ones so UI tweaks don't wipe previous fields
    if (body.settings !== undefined) {
      try {
        const existing = await pb.collection('tutorials').getOne(req.params.id);
        const existingSettings = typeof existing.settings === 'string' ? JSON.parse(existing.settings || '{}') : (existing.settings || {});
        const incomingSettings = typeof body.settings === 'string' ? JSON.parse(body.settings) : body.settings;
        updatePayload.settings = JSON.stringify({ ...existingSettings, ...incomingSettings });
      } catch (e) {
        updatePayload.settings = typeof body.settings === 'string' ? body.settings : JSON.stringify(body.settings);
      }
    }

    if (body.title !== undefined) updatePayload.title = body.title;
    if (body.description !== undefined) updatePayload.description = body.description;
    if (body.modelId !== undefined) updatePayload.modelId = body.modelId;
    if (body.appPath !== undefined) updatePayload.appPath = body.appPath;
    if (body.status !== undefined) updatePayload.status = body.status;
    if (body.prompt !== undefined) updatePayload.prompt = body.prompt;
    if (body.steps !== undefined) updatePayload.steps = body.steps;
    if (body.metadata !== undefined) updatePayload.metadata = body.metadata;

    if (req.file) {
      const uint8Array = new Uint8Array(req.file.buffer);
      const formData = new FormData();
      for (const [key, value] of Object.entries(updatePayload)) {
        formData.append(key, String(value));
      }
      formData.append('background_music', new Blob([uint8Array]), req.file.originalname);
      const record = await pb.collection('tutorials').update(req.params.id, formData);
      res.json({
        id: record.id,
        title: record.title,
        description: record.description,
        targetApp: record.appPath || record.targetApp || '',
        status: record.status || 'draft',
        steps: typeof record.steps === 'string' ? JSON.parse(record.steps || '[]') : (record.steps || []),
        settings: typeof record.settings === 'string' ? JSON.parse(record.settings || '{}') : (record.settings || {}),
        metadata: typeof record.metadata === 'string' ? JSON.parse(record.metadata || '{}') : (record.metadata || {}),
        backgroundMusicUrl: record.background_music ? `${pb.baseUrl}/api/files/${record.collectionId}/${record.id}/${record.background_music}` : undefined,
        file: record.file ? `${pb.baseUrl}/api/files/${record.collectionId}/${record.id}/${record.file}` : undefined,
        fileSound: record.file_sound ? `${pb.baseUrl}/api/files/${record.collectionId}/${record.id}/${record.file_sound}` : undefined,
        createdAt: record.created,
        updatedAt: record.updated,
      });
      return;
    }

    const record = await pb.collection('tutorials').update(req.params.id, updatePayload);
    res.json({
      id: record.id,
      title: record.title,
      description: record.description,
      targetApp: record.appPath || record.targetApp || '',
      status: record.status || 'draft',
      steps: typeof record.steps === 'string' ? JSON.parse(record.steps || '[]') : (record.steps || []),
      settings: typeof record.settings === 'string' ? JSON.parse(record.settings || '{}') : (record.settings || {}),
      metadata: typeof record.metadata === 'string' ? JSON.parse(record.metadata || '{}') : (record.metadata || {}),
      backgroundMusicUrl: record.background_music ? `${pb.baseUrl}/api/files/${record.collectionId}/${record.id}/${record.background_music}` : undefined,
      file: record.file ? `${pb.baseUrl}/api/files/${record.collectionId}/${record.id}/${record.file}` : undefined,
      fileSound: record.file_sound ? `${pb.baseUrl}/api/files/${record.collectionId}/${record.id}/${record.file_sound}` : undefined,
      createdAt: record.created,
      updatedAt: record.updated,
    });
  } catch (error) {
    console.error('Error updating tutorial:', error);
    res.status(500).json({ error: 'Failed to update tutorial' });
  }
});

// Delete tutorial
app.delete('/api/tutorials/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    await pb.collection('tutorials').delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete tutorial' });
  }
});

// ── Generate tutorial (async) ──
app.post('/api/tutorials/generate', async (req: Request, res: Response) => {
  const { description, modelId, appPath, servePort, previewPort, mode, recordingOutputPath, recordingArea, previewZoom, devicePixelRatio, controlPoints, controlPointsReal, realMouseOffset, virtualMouseOffset, realMouseScale, cursorImagePath, manualSteps, stepsCount, settings, backgroundMusicUrl, videoSettings, tutorialId } = req.body;
  const resolvedStepsCount = Number.isFinite(Number(stepsCount)) && Number(stepsCount) > 0 ? Math.min(Math.max(Math.round(Number(stepsCount)), 1), 50) : 9;
  console.log('[API /generate] Received recordingArea:', recordingArea, 'previewZoom:', previewZoom, 'DPR:', devicePixelRatio, 'controlPoints:', controlPoints?.length || 0, 'controlPointsReal:', controlPointsReal?.length || 0, 'realMouseOffset:', realMouseOffset, 'virtualMouseOffset:', virtualMouseOffset, 'realMouseScale:', realMouseScale, 'cursorImagePath:', cursorImagePath || 'default', 'manualSteps:', manualSteps ? 'yes' : 'no', 'stepsCount:', resolvedStepsCount, 'backgroundMusicUrl:', backgroundMusicUrl ? 'yes' : 'no', 'hasSettings:', !!settings);

  if (!description) {
    return res.status(400).json({ error: 'description is required' });
  }
  if (!modelId) {
    return res.status(400).json({ error: 'modelId is required' });
  }

  const resolvedMode = (mode === 'desktop' || mode === 'browser') ? mode : 'browser';

  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  generationJobs.set(jobId, {
    id: jobId,
    status: 'processing',
    progress: 0,
    message: resolvedMode === 'desktop' ? 'Iniciando generación en modo escritorio...' : 'Iniciando generación...',
  });

  // Run async (don't await)
  runTutorialGeneration(jobId, {
    description,
    modelId,
    appPath: appPath || '',
    servePort: servePort || 3032,
    previewPort: previewPort || 3000,
    mode: resolvedMode,
    recordingOutputPath: recordingOutputPath || undefined,
    recordingArea,
    previewZoom: previewZoom || 100,
    devicePixelRatio: devicePixelRatio || 1,
    controlPoints: controlPoints || [],
    controlPointsReal: controlPointsReal || [],
    realMouseOffset: realMouseOffset || { x: 0, y: 0 },
    virtualMouseOffset: virtualMouseOffset || { x: 0, y: 0 },
    realMouseScale: realMouseScale || { x: 1, y: 1 },
    cursorImagePath,
    manualSteps,
    stepsCount: resolvedStepsCount,
    settings,
    backgroundMusicUrl,
    videoSettings,
    tutorialId,
  });

  res.json({ id: jobId, status: 'processing', progress: 0, message: resolvedMode === 'desktop' ? 'Iniciando generación en modo escritorio...' : 'Iniciando generación...' });
});

// ── Poll generation status ──
app.get('/api/tutorials/generation/:id', (req: Request, res: Response) => {
  const job = generationJobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// ── Re-build de un tutorial desktop (editor de timeline) ──
// Re-mezcla audio + subtítulos sobre la grabación raw existente.
app.post('/api/tutorials/:id/rebuild', async (req: Request, res: Response) => {
  const { steps, settings, backgroundMusicUrl, videoSettings } = req.body || {};
  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ error: 'steps[] es obligatorio' });
  }

  const jobId = `rebuild_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  generationJobs.set(jobId, {
    id: jobId,
    status: 'processing',
    progress: 0,
    message: 'Preparando re-generación...',
  });

  runTutorialRebuild(jobId, {
    tutorialId: req.params.id,
    steps,
    settings,
    backgroundMusicUrl,
    videoSettings,
  });

  res.json({ id: jobId, status: 'processing', progress: 0, message: 'Preparando re-generación...' });
});

// ── Recorte de un tutorial desktop (trim del MP4 final) ──
// Corta el MP4 ya generado según los rangos a conservar (start/end en segundos).
// Soporta cortar por delante, por detrás y extraer un fragmento del medio
// (varios segmentos → se concatenan). No re-mezcla voz/subtítulos: opera sobre
// el MP4 final existente.
app.post('/api/tutorials/:id/trim', async (req: Request, res: Response) => {
  const { segments } = req.body || {};
  if (!Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: 'segments[] es obligatorio (rangos {start,end} a conservar)' });
  }
  for (const s of segments) {
    if (typeof s?.start !== 'number' || typeof s?.end !== 'number' || s.end <= s.start) {
      return res.status(400).json({ error: 'Cada segmento debe tener {start,end} numéricos con end>start' });
    }
    if (s?.speed != null && (typeof s.speed !== 'number' || s.speed <= 0 || s.speed > 4)) {
      return res.status(400).json({ error: 'speed debe ser un número entre 0 y 4 (0.5–2 recomendado)' });
    }
  }

  const jobId = `trim_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  generationJobs.set(jobId, {
    id: jobId,
    status: 'processing',
    progress: 0,
    message: 'Preparando recorte...',
  });

  runTutorialTrim(jobId, {
    tutorialId: req.params.id,
    segments,
  });

  res.json({ id: jobId, status: 'processing', progress: 0, message: 'Preparando recorte...' });
});

// Download tutorial (meta)
app.get('/api/tutorials/:id/download', (req: Request, res: Response) => {
  res.json({ url: `/api/tutorials/${req.params.id}/download-file` });
});

// Download tutorial file (video if available, otherwise JSON export)
app.get('/api/tutorials/:id/download-file', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const r = await pb.collection('tutorials').getOne(req.params.id);
    const settings = typeof r.settings === 'string' ? JSON.parse(r.settings || '{}') : (r.settings || {});
    const metadata = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {});

    // Prefer video file if it exists
    const videoCandidates = [
      settings.recordingOutputPath,
      metadata.videoPath,
    ].filter(Boolean) as string[];

    for (const videoPath of videoCandidates) {
      if (fs.existsSync(videoPath) && await isVideoFileValid(videoPath)) {
        const stat = fs.statSync(videoPath);
        const ext = path.extname(videoPath) || '.mp4';
        const filename = `tutorial-${r.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-${req.params.id}${ext}`;
        res.setHeader('Content-Type', ext === '.webm' ? 'video/webm' : 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', stat.size);
        return fs.createReadStream(videoPath).pipe(res);
      }
    }

    // Fallback: export tutorial as JSON
    const tutorial = {
      id: r.id,
      title: r.title,
      description: r.description,
      targetApp: r.appPath || r.targetApp || '',
      status: r.status || 'completed',
      steps: typeof r.steps === 'string' ? JSON.parse(r.steps || '[]') : (r.steps || []),
      settings,
      metadata,
      backgroundMusicUrl: r.background_music ? `${pb.baseUrl}/api/files/${r.collectionId}/${r.id}/${r.background_music}` : undefined,
      createdAt: r.created,
      updatedAt: r.updated,
    };
    const filename = `tutorial-${tutorial.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-${req.params.id}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(tutorial);
  } catch (error: any) {
    console.error('Error downloading tutorial:', error);
    res.status(500).json({ error: error?.message || 'Failed to download tutorial' });
  }
});

// Thumbnail
app.post('/api/tutorials/:id/thumbnail', (req: Request, res: Response) => {
  res.json({ thumbnail: '/thumbnail.jpg' });
});

// Upload tutorial video (from frontend MediaRecorder)
app.post('/api/tutorials/:id/video', uploadVideo.single('video'), async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const tutorialId = req.params.id;
    const videoFile = req.file;
    if (!videoFile) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    // Guardar el video en disco (multer ya lo escribió en tmp con diskStorage)
    const videosDir = path.resolve(__dirname, '..', 'serve', 'logs', 'videos');
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
    }
    const videoPath = path.join(videosDir, `tutorial-${tutorialId}.webm`);
    fs.copyFileSync(videoFile.path, videoPath);
    try { fs.unlinkSync(videoFile.path); } catch {}

    // Convertir a MP4 con FFmpeg si está disponible
    const mp4Path = videoPath.replace('.webm', '.mp4');
    const ffmpegAvailable = fs.existsSync(path.resolve(__dirname, '..', 'serve', 'ffmpeg', 'ffmpeg.exe'));
    if (ffmpegAvailable) {
      const ffmpegPath = path.resolve(__dirname, '..', 'serve', 'ffmpeg', 'ffmpeg.exe');
      const ffmpeg = spawn(ffmpegPath, [
        '-y',
        '-i', videoPath,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        mp4Path,
      ], { windowsHide: true });

      await new Promise<void>((resolve, reject) => {
        ffmpeg.on('close', (code: number) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg exited with code ${code}`));
        });
        ffmpeg.on('error', reject);
        setTimeout(() => reject(new Error('FFmpeg timeout')), 60000);
      });

      // Eliminar webm original
      try { fs.unlinkSync(videoPath); } catch {}
    }

    // Actualizar tutorial con la ruta del video
    const finalPath = ffmpegAvailable && fs.existsSync(mp4Path) ? mp4Path : videoPath;
    const r = await pb.collection('tutorials').getOne(tutorialId);
    const metadata = r.metadata || {};
    metadata.videoPath = finalPath;
    await pb.collection('tutorials').update(tutorialId, { metadata });

    res.json({ success: true, videoPath: finalPath });
  } catch (error: any) {
    console.error('Error uploading tutorial video:', error);
    res.status(500).json({ error: error?.message || 'Failed to upload video' });
  }
});

// ── Subir el vídeo base de un tutorial MANUAL ──
// El usuario selecciona un vídeo propio desde el modal de Configuración. Se le
// quita el audio (ffmpeg -an) y se copia a una ruta estable dentro de la
// carpeta del proyecto. Se fija metadata.rawVideoPath + rawDuration y
// settings.manualMode=true, de modo que runTutorialRebuild lo usa exactamente
// igual que la grabación raw del flujo automático. No añade campos a PocketBase:
// rawVideoPath vive en metadata (JSON) y manualMode en settings (JSON).
app.post('/api/tutorials/:id/raw-video', uploadVideo.single('video'), async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const tutorialId = req.params.id;
    const videoFile = req.file;
    if (!videoFile) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const videosDir = path.resolve(__dirname, '..', 'serve', 'logs', 'videos');
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
    }

    // Ruta de entrada: la que ya escribió multer (diskStorage en tmp).
    const srcPath = videoFile.path;
    // Ruta destino estable (raw sin audio). Sobrescribe si ya existía (-y).
    const rawPath = path.join(videosDir, `tutorial-${tutorialId}-raw.mp4`);

    // Quitar el audio y re-codificar a mp4 (yuv420p + faststart para re-edición).
    const stripRes = await __zeusRunFfmpeg([
      '-y', '-i', srcPath, '-map', '0:v:0', '-an',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', rawPath,
    ], 'Manual raw-video strip audio');

    // Limpiar el temporal de subida.
    try { fs.unlinkSync(srcPath); } catch {}

    if (stripRes.code !== 0 || !fs.existsSync(rawPath)) {
      return res.status(500).json({ error: 'No se pudo procesar el vídeo (ffmpeg falló al quitar el audio).' });
    }

    const rawDuration = await __zeusGetMediaDuration(rawPath);

    // Subir el mp4 (sin audio) al campo `file` de PocketBase para que la app
    // pueda reproducirlo mientras el usuario crea las tarjetas. Al exportar,
    // runTutorialRebuild sobrescribe este mismo campo con el MP4 final, así que
    // antes de exportar reproduce el vídeo base y después, el resultado. La
    // copia en disco (rawPath / metadata.rawVideoPath) se conserva para re-editar.
    try {
      const fileBuffer = fs.readFileSync(rawPath);
      const fileFormData = new FormData();
      fileFormData.append('file', new Blob([fileBuffer], { type: 'video/mp4' }), `${tutorialId}.mp4`);
      await fetch(`${pb.baseUrl}/api/collections/tutorials/records/${tutorialId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${pb.authStore.token}` },
        body: fileFormData as any,
      });
    } catch (fileErr) {
      console.warn('[raw-video] No se pudo subir el mp4 al campo file:', fileErr);
    }

    // Actualizar metadata + settings del tutorial.
    const r: any = await pb.collection('tutorials').getOne(tutorialId);
    const metadata = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {});
    const settings = typeof r.settings === 'string' ? JSON.parse(r.settings || '{}') : (r.settings || {});
    metadata.rawVideoPath = rawPath;
    metadata.rawDuration = rawDuration ?? metadata.rawDuration;
    settings.manualMode = true;

    await pb.collection('tutorials').update(tutorialId, {
      metadata: JSON.stringify(metadata),
      settings: JSON.stringify(settings),
    });

    const record = await pb.collection('tutorials').getOne(tutorialId);
    res.json({
      id: record.id,
      title: record.title,
      description: record.description,
      targetApp: record.appPath || record.targetApp || '',
      status: record.status || 'draft',
      steps: typeof record.steps === 'string' ? JSON.parse(record.steps || '[]') : (record.steps || []),
      settings: typeof record.settings === 'string' ? JSON.parse(record.settings || '{}') : (record.settings || {}),
      metadata: typeof record.metadata === 'string' ? JSON.parse(record.metadata || '{}') : (record.metadata || {}),
      backgroundMusicUrl: record.background_music ? `${pb.baseUrl}/api/files/${record.collectionId}/${record.id}/${record.background_music}` : undefined,
      file: record.file ? `${pb.baseUrl}/api/files/${record.collectionId}/${record.id}/${record.file}` : undefined,
      fileSound: record.file_sound ? `${pb.baseUrl}/api/files/${record.collectionId}/${record.id}/${record.file_sound}` : undefined,
      createdAt: record.created,
      updatedAt: record.updated,
    });
  } catch (error: any) {
    console.error('Error uploading manual raw video:', error);
    res.status(500).json({ error: error?.message || 'Failed to upload raw video' });
  }
});

// ── Play a single step of an existing tutorial ──
app.post('/api/tutorials/:id/play-step', async (req: Request, res: Response) => {
  try {
    const { stepIndex, servePort, previewPort } = req.body;
    const actualPreviewPort = previewPort || 3000;
    const actualServePort = servePort || 3032;

    if (typeof stepIndex !== 'number') {
      return res.status(400).json({ error: 'stepIndex is required and must be a number' });
    }

    await authAsAdmin();
    const r = await pb.collection('tutorials').getOne(req.params.id);
    const steps = typeof r.steps === 'string' ? JSON.parse(r.steps || '[]') : (r.steps || []);

    if (stepIndex < 0 || stepIndex >= steps.length) {
      return res.status(400).json({ error: 'Invalid stepIndex' });
    }

    const step = steps[stepIndex];
    let actionResult: any = { success: true };

    // Execute the action if applicable
    if (step.action && step.action !== 'wait') {
      actionResult = await executeAction(actualServePort, {
        type: step.action,
        target: step.target,
        value: step.value,
        previewPort: actualPreviewPort,
      });
    }

    // Wait for UI to update
    const waitMs = step.action === 'wait'
      ? Math.min(parseInt(step.value || '1000', 10), 5000)
      : (step.waitTime || 800);
    await new Promise(resolve => setTimeout(resolve, waitMs));

    // Capture live screenshot
    const { screenshot, error: screenshotError } = await captureScreenshot(actualServePort, actualPreviewPort);

    res.json({
      success: true,
      stepIndex,
      totalSteps: steps.length,
      screenshot,
      screenshotError,
      actionResult,
      action: step.action,
      description: step.description,
      duration: step.duration || 3,
    });
  } catch (error: any) {
    console.error('Error playing tutorial step:', error);
    res.status(500).json({ error: error?.message || 'Failed to play step' });
  }
});

// Models endpoints
// Normaliza cualquier etiqueta de proveedor a una clave interna que entienden
// las ramas de callAIModel. Acepta AMBOS esquemas:
//  - el canónico de la app principal en `modelos` (OpenAI, Deepseek, OllamaCloud,
//    Ollama, llama.cpp, OpenAI-Compatible) y
//  - el enum del editor de tutoriales (openai, anthropic, ollama, ollama-cloud,
//    lmstudio, local, custom, remote).
// Devuelve una de: deepseek | ollama | ollama-cloud | openai | custom | local |
// remote | lmstudio | anthropic.
function normalizeAiProvider(raw?: string): string {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return 'openai';
  if (s.includes('deepseek')) return 'deepseek';
  if (s.includes('ollama') && (s.includes('cloud') || s.includes('api.ollama'))) return 'ollama-cloud';
  if (s.includes('ollama')) return 'ollama';
  if (s.includes('llama.cpp') || s.includes('llamacpp') || s.includes('llama-server')) return 'lmstudio';
  if (s.includes('lmstudio')) return 'lmstudio';
  if (s.includes('compatible') || s.includes('custom') || s.includes('personalizado')) return 'custom';
  if (s.includes('local')) return 'local';
  if (s.includes('remote')) return 'remote';
  if (s.includes('anthropic')) return 'anthropic';
  if (s.includes('openai')) return 'openai';
  return 'openai';
}

// Convierte un proveedor (del editor o crudo) al ID canónico que usa la colección
// `modelos` de la app principal, para que lo que se guarda quede consistente.
function toModelosProviderId(raw?: string): string {
  switch (normalizeAiProvider(raw)) {
    case 'deepseek': return 'Deepseek';
    case 'ollama-cloud': return 'OllamaCloud';
    case 'ollama': return 'Ollama';
    case 'lmstudio':
    case 'local': return 'llama.cpp';
    case 'custom': return 'OpenAI-Compatible';
    case 'anthropic': return 'Anthropic';
    case 'remote':
    case 'openai':
    default: return 'OpenAI';
  }
}

// Normaliza un registro de la colección `modelos` (campos en español) al shape
// que espera el frontend y callAIModel (name/provider/endpoint/apiKey/modelName...).
function mapModelos(r: any) {
  return {
    id: r.id,
    name: r.nombre_modelo || r.name || '',
    provider: r.proveedor || r.provider || 'openai',
    type: r.proveedor || r.type || 'remote',
    endpoint: r.url || r.endpoint || '',
    apiKey: r.clave_api || r.apiKey || r.api_key || '',
    modelName: r.id_modelo || r.modelName || r.model_name || r.model || '',
    is_vision: r.is_vision,
    temperature: r.temperatura,
    maxTokens: r.max_token,
    documentation: r.documentation,
    createdAt: r.created,
    updatedAt: r.updated,
  };
}

app.get('/api/models', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const records = await pb.collection('modelos').getFullList();
    res.json(records.map(mapModelos));
  } catch (error) {
    console.error('Error fetching models:', error);
    res.json([]);
  }
});

app.post('/api/models', uploadDoc.single('documentation'), async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const provider = toModelosProviderId(req.body.provider || req.body.type || 'openai');
    const nombreModelo = req.body.name || 'Nuevo Modelo';
    const idModelo = req.body.modelName || req.body.model_name || '';
    const userId = authedUserId();

    const modelData: any = {
      nombre_modelo: nombreModelo,
      proveedor: provider,
      url: req.body.endpoint || '',
      clave_api: req.body.apiKey || '',
      id_modelo: idModelo,
    };
    if (userId) modelData.user = userId;

    if (req.file) {
      const formData = new FormData();
      const uint8Array = new Uint8Array(req.file.buffer);
      formData.append('nombre_modelo', nombreModelo);
      formData.append('proveedor', provider);
      formData.append('url', req.body.endpoint || '');
      formData.append('clave_api', req.body.apiKey || '');
      formData.append('id_modelo', idModelo);
      if (userId) formData.append('user', userId);
      formData.append('documentation', new Blob([uint8Array]), req.file.originalname);

      const record = await pb.collection('modelos').create(formData);
      res.json(mapModelos(record));
    } else {
      const record = await pb.collection('modelos').create(modelData);
      res.json(mapModelos(record));
    }
  } catch (error) {
    console.error('Error creating model:', error);
    res.status(500).json({ error: 'Failed to create model' });
  }
});

app.put('/api/models/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const updateData: any = {};
    if (req.body.name !== undefined) updateData.nombre_modelo = req.body.name;
    if (req.body.endpoint !== undefined) updateData.url = req.body.endpoint;
    if (req.body.apiKey !== undefined) updateData.clave_api = req.body.apiKey;
    if (req.body.provider !== undefined || req.body.type !== undefined) {
      updateData.proveedor = toModelosProviderId(req.body.provider || req.body.type);
    }
    if (req.body.modelName !== undefined || req.body.model_name !== undefined) {
      updateData.id_modelo = req.body.modelName || req.body.model_name;
    }

    const record = await pb.collection('modelos').update(req.params.id, updateData);
    res.json(mapModelos(record));
  } catch (error) {
    console.error('Error updating model:', error);
    res.status(500).json({ error: 'Failed to update model' });
  }
});

app.delete('/api/models/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    await pb.collection('modelos').delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting model:', error);
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

// Documentation endpoints
app.get('/api/documentation', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const records = await pb.collection('documentation').getFullList({
      expand: 'file',
    });
    res.json(records);
  } catch (error) {
    console.error('Error fetching documentation:', error);
    res.json([]);
  }
});

app.post('/api/documentation', uploadDoc.single('file'), async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    
    if (req.file) {
      const formData = new FormData();
      const uint8Array = new Uint8Array(req.file.buffer);
      formData.append('title', req.body.title);
      formData.append('description', req.body.description || '');
      formData.append('file', new Blob([uint8Array]), req.file.originalname);
      
      const record = await pb.collection('documentation').create(formData);
      res.json(record);
    } else {
      const record = await pb.collection('documentation').create({
        title: req.body.title,
        description: req.body.description || '',
      });
      res.json(record);
    }
  } catch (error) {
    console.error('Error creating documentation:', error);
    res.status(500).json({ error: 'Failed to create documentation' });
  }
});

app.delete('/api/documentation/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    await pb.collection('documentation').delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting documentation:', error);
    res.status(500).json({ error: 'Failed to delete documentation' });
  }
});

// Settings endpoints
app.get('/api/settings', (req: Request, res: Response) => {
  res.json({ theme: 'dark', language: 'es', outputResolution: '1080p', backgroundMusic: false });
});

app.put('/api/settings', (req: Request, res: Response) => {
  res.json({ ...req.body });
});

// ─────────────────────────────────────────────────────────────────────────────
// Debug endpoints (temporary, for diagnosing merge issues)
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/_debug/version', (req: Request, res: Response) => {
  res.json({
    mergeFnExists: typeof __zeusMergeAudioSubtitlesToVideo === 'function',
    probeFnExists: typeof __zeusProbeStreams === 'function',
    runFnExists: typeof __zeusRunFfmpeg === 'function',
    loadedAt: new Date().toISOString(),
    ffmpegPath: FFMPEG_PATH,
    ffmpegExists: fs.existsSync(FFMPEG_PATH),
    ffprobePath: FFPROBE_PATH,
    ffprobeExists: fs.existsSync(FFPROBE_PATH),
  });
});

app.post('/api/_debug/merge-existing', async (req: Request, res: Response) => {
  try {
    const { mp4Path, audioPath, assPath } = req.body;
    if (!mp4Path || !fs.existsSync(mp4Path)) {
      return res.status(400).json({ error: 'mp4Path missing or file not found' });
    }
    const tmpInput = mp4Path.replace(/\.mp4$/i, '.debug-raw.mp4');
    fs.copyFileSync(mp4Path, tmpInput);
    const tmpOutput = mp4Path.replace(/\.mp4$/i, '.debug-out.mp4');
    const result = await __zeusMergeAudioSubtitlesToVideo(
      tmpInput,
      tmpOutput,
      audioPath && fs.existsSync(audioPath) ? audioPath : null,
      assPath && fs.existsSync(assPath) ? assPath : null,
    );
    try { fs.unlinkSync(tmpInput); } catch {}
    const probe = await __zeusProbeStreams(tmpOutput, { audio: true, subtitles: true });
    res.json({ success: true, hadSubtitles: result.hadSubtitles, warnings: result.warnings, probe });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.post('/api/_debug/test-ass', async (req: Request, res: Response) => {
  try {
    const { outputPath, verticalOffset } = req.body;
    const events = [
      { start: 0, end: 4, text: 'Test subtitle 1' },
      { start: 4, end: 9, text: 'Test subtitle 2' },
    ];
    const target = outputPath || 'C:/Temp/zeus-test-ass.ass';
    await __zeusGenerateAssSubtitle(target, events, {
      fontSize: 18,
      textColor: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.8)',
      position: 'bottom',
      verticalOffset: typeof verticalOffset === 'number' ? verticalOffset : 30,
      fontFamily: 'Arial',
    });
    const content = fs.readFileSync(target, 'utf8');
    res.json({ outputPath: target, content });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// Editor endpoints
app.get('/api/editor/state', (req: Request, res: Response) => {
  res.json({ currentTutorial: null, clips: [] });
});

app.put('/api/editor/timeline', (req: Request, res: Response) => {
  res.json({ success: true });
});

app.post('/api/editor/export', (req: Request, res: Response) => {
  res.json({ status: 'processing' });
});

// Control endpoints
app.post('/api/control/mouse', (req: Request, res: Response) => {
  res.json({ success: true });
});

app.post('/api/control/keyboard', (req: Request, res: Response) => {
  res.json({ success: true });
});

app.post('/api/control/screenshot', async (req: Request, res: Response) => {
  try {
    const { servePort, previewPort, mousePosition } = req.body;
    const actualServePort = servePort || 3032;
    const actualPreviewPort = previewPort || 3000;
    const { screenshot, error } = await captureScreenshot(actualServePort, actualPreviewPort, mousePosition);
    if (error) {
      return res.status(500).json({ error, screenshot: null });
    }
    res.json({ screenshot });
  } catch (error: any) {
    console.error('Error capturing control screenshot:', error);
    res.status(500).json({ error: error?.message || 'Failed to capture screenshot' });
  }
});

// ── Control Points endpoints ──
app.get('/api/control-points', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const records = await pb.collection('control_points').getFullList({ sort: 'name' });
    const points = records.map((r: any) => ({
      id: r.id,
      name: r.name,
      x: r.x,
      y: r.y,
      recordingArea: r.recording_area,
      targetApp: r.target_app,
      tags: r.tags,
      tutorialIds: r.tutorials || [],
      createdAt: r.created,
      updatedAt: r.updated,
    }));
    res.json(points);
  } catch (error) {
    console.error('Error fetching control points:', error);
    res.status(500).json({ error: 'Failed to fetch control points' });
  }
});

app.post('/api/control-points', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const { name, x, y, recordingArea, targetApp, tags, tutorialIds } = req.body;
    if (!name || x == null || y == null) {
      return res.status(400).json({ error: 'name, x and y are required' });
    }
    const record = await pb.collection('control_points').create({
      name,
      x,
      y,
      recording_area: recordingArea || null,
      target_app: targetApp || '',
      tags: tags || [],
      tutorials: tutorialIds || [],
    });
    res.status(201).json({
      id: record.id,
      name: record.name,
      x: record.x,
      y: record.y,
      recordingArea: record.recording_area,
      targetApp: record.target_app,
      tags: record.tags,
      tutorialIds: record.tutorials || [],
      createdAt: record.created,
      updatedAt: record.updated,
    });
  } catch (error) {
    console.error('Error creating control point:', error);
    res.status(500).json({ error: 'Failed to create control point' });
  }
});

app.put('/api/control-points/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const { name, x, y, recordingArea, targetApp, tags, tutorialIds } = req.body;

    // Build payload only with provided fields to avoid overwriting existing data
    const updatePayload: any = {};
    if (name !== undefined) updatePayload.name = name;
    if (x !== undefined) updatePayload.x = x;
    if (y !== undefined) updatePayload.y = y;
    if (recordingArea !== undefined) updatePayload.recording_area = recordingArea || null;
    if (targetApp !== undefined) updatePayload.target_app = targetApp || '';
    if (tags !== undefined) updatePayload.tags = tags || [];
    if (tutorialIds !== undefined) updatePayload.tutorials = tutorialIds || [];

    const record = await pb.collection('control_points').update(req.params.id, updatePayload);
    res.json({
      id: record.id,
      name: record.name,
      x: record.x,
      y: record.y,
      recordingArea: record.recording_area,
      targetApp: record.target_app,
      tags: record.tags,
      tutorialIds: record.tutorials || [],
      createdAt: record.created,
      updatedAt: record.updated,
    });
  } catch (error) {
    console.error('Error updating control point:', error);
    res.status(500).json({ error: 'Failed to update control point' });
  }
});

app.delete('/api/control-points/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    await pb.collection('control_points').delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting control point:', error);
    res.status(500).json({ error: 'Failed to delete control point' });
  }
});

// ── Control Points Real (copia de los puntos capturados desde el ratón físico) ──
app.get('/api/control-points-real', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const records = await pb.collection('control_points_real').getFullList({ sort: 'name' });
    const points = records.map(r => ({
      id: r.id,
      name: r.name,
      x: r.x,
      y: r.y,
      // Coordenada "Puntero" (dónde se mueve/dibuja el cursor). Si no está definida,
      // coincide con (x, y) que es la coordenada de "Acción".
      pointerX: r.pointer_x != null ? r.pointer_x : r.x,
      pointerY: r.pointer_y != null ? r.pointer_y : r.y,
      // Si false, el paso ejecuta la acción sin mover/dibujar el puntero.
      moveMouse: r.move_mouse != null ? r.move_mouse : true,
      recordingArea: r.recording_area,
      targetApp: r.target_app,
      tags: r.tags,
      tutorialIds: r.tutorials || [],
      clic: r.clic ?? true,
      screenId: r.screen || null,
      landmark: r.landmark ?? false,
      createdAt: r.created,
      updatedAt: r.updated,
    }));
    res.json(points);
  } catch (error) {
    console.error('Error fetching control points real:', error);
    res.status(500).json({ error: 'Failed to fetch control points real' });
  }
});

app.post('/api/control-points-real', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const { name, x, y, pointerX, pointerY, moveMouse, recordingArea, targetApp, tags, tutorialIds, clic, screenId, landmark } = req.body;
    if (!name || x == null || y == null) {
      return res.status(400).json({ error: 'name, x and y are required' });
    }
    const record = await pb.collection('control_points_real').create({
      name,
      x,
      y,
      pointer_x: pointerX != null ? pointerX : x,
      pointer_y: pointerY != null ? pointerY : y,
      move_mouse: moveMouse != null ? moveMouse : true,
      recording_area: recordingArea || null,
      target_app: targetApp || '',
      tags: tags || [],
      tutorials: tutorialIds || [],
      clic: clic ?? true,
      screen: screenId || null,
      landmark: landmark ?? false,
    });
    res.status(201).json({
      id: record.id,
      name: record.name,
      x: record.x,
      y: record.y,
      pointerX: record.pointer_x != null ? record.pointer_x : record.x,
      pointerY: record.pointer_y != null ? record.pointer_y : record.y,
      moveMouse: record.move_mouse != null ? record.move_mouse : true,
      recordingArea: record.recording_area,
      targetApp: record.target_app,
      tags: record.tags,
      tutorialIds: record.tutorials || [],
      clic: record.clic ?? true,
      screenId: record.screen || null,
      landmark: record.landmark ?? false,
      createdAt: record.created,
      updatedAt: record.updated,
    });
  } catch (error) {
    console.error('Error creating control point real:', error);
    res.status(500).json({ error: 'Failed to create control point real' });
  }
});

app.put('/api/control-points-real/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const { name, x, y, pointerX, pointerY, moveMouse, recordingArea, targetApp, tags, tutorialIds, clic, screenId, landmark } = req.body;
    console.log('[API PUT /control-points-real/:id] body:', JSON.stringify(req.body, null, 2));

    const updatePayload: any = {};
    if (name !== undefined) updatePayload.name = name;
    if (x !== undefined) updatePayload.x = x;
    if (y !== undefined) updatePayload.y = y;
    if (pointerX !== undefined) updatePayload.pointer_x = pointerX;
    if (pointerY !== undefined) updatePayload.pointer_y = pointerY;
    if (moveMouse !== undefined) updatePayload.move_mouse = moveMouse;
    if (recordingArea !== undefined) updatePayload.recording_area = recordingArea || null;
    if (targetApp !== undefined) updatePayload.target_app = targetApp || '';
    if (tags !== undefined) updatePayload.tags = tags || [];
    if (tutorialIds !== undefined) updatePayload.tutorials = tutorialIds || [];
    if (clic !== undefined) updatePayload.clic = clic;
    if (screenId !== undefined) updatePayload.screen = screenId || null;
    if (landmark !== undefined) updatePayload.landmark = landmark;

    console.log('[API PUT /control-points-real/:id] updatePayload:', JSON.stringify(updatePayload, null, 2));

    const record = await pb.collection('control_points_real').update(req.params.id, updatePayload);
    res.json({
      id: record.id,
      name: record.name,
      x: record.x,
      y: record.y,
      pointerX: record.pointer_x != null ? record.pointer_x : record.x,
      pointerY: record.pointer_y != null ? record.pointer_y : record.y,
      moveMouse: record.move_mouse != null ? record.move_mouse : true,
      recordingArea: record.recording_area,
      targetApp: record.target_app,
      tags: record.tags,
      tutorialIds: record.tutorials || [],
      clic: record.clic ?? true,
      screenId: record.screen || null,
      landmark: record.landmark ?? false,
      createdAt: record.created,
      updatedAt: record.updated,
    });
  } catch (error: any) {
    console.error('[API PUT /control-points-real/:id] Error:', error?.response?.data || error?.message || error);
    res.status(500).json({ error: 'Failed to update control point real', details: error?.response?.data || error?.message });
  }
});

app.delete('/api/control-points-real/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    await pb.collection('control_points_real').delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting control point real:', error);
    res.status(500).json({ error: 'Failed to delete control point real' });
  }
});

// ── Atlas: pantallas (screens) ──
app.get('/api/screens', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const records = await pb.collection('screens').getFullList({ sort: 'tab,target_app,order,name' });
    const screens = records.map(r => ({
      id: r.id,
      name: r.name,
      targetApp: r.target_app,
      tab: r.tab,
      matchHint: r.match_hint,
      layoutHint: r.layout_hint,
      order: r.order,
      createdAt: r.created,
      updatedAt: r.updated,
    }));
    res.json(screens);
  } catch (error) {
    console.error('Error fetching screens:', error);
    res.status(500).json({ error: 'Failed to fetch screens' });
  }
});

app.post('/api/screens', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const { name, targetApp, tab, matchHint, layoutHint, order } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const record = await pb.collection('screens').create({
      name,
      target_app: targetApp || '',
      tab: tab || '',
      match_hint: matchHint || '',
      layout_hint: layoutHint || '',
      order: order != null ? order : 0,
    });
    res.status(201).json({
      id: record.id,
      name: record.name,
      targetApp: record.target_app,
      tab: record.tab,
      matchHint: record.match_hint,
      layoutHint: record.layout_hint,
      order: record.order,
      createdAt: record.created,
      updatedAt: record.updated,
    });
  } catch (error) {
    console.error('Error creating screen:', error);
    res.status(500).json({ error: 'Failed to create screen' });
  }
});

app.put('/api/screens/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const { name, targetApp, tab, matchHint, layoutHint, order } = req.body;
    const updatePayload: any = {};
    if (name !== undefined) updatePayload.name = name;
    if (targetApp !== undefined) updatePayload.target_app = targetApp || '';
    if (tab !== undefined) updatePayload.tab = tab || '';
    if (matchHint !== undefined) updatePayload.match_hint = matchHint || '';
    if (layoutHint !== undefined) updatePayload.layout_hint = layoutHint || '';
    if (order !== undefined) updatePayload.order = order;
    const record = await pb.collection('screens').update(req.params.id, updatePayload);
    res.json({
      id: record.id,
      name: record.name,
      targetApp: record.target_app,
      tab: record.tab,
      matchHint: record.match_hint,
      layoutHint: record.layout_hint,
      order: record.order,
      createdAt: record.created,
      updatedAt: record.updated,
    });
  } catch (error: any) {
    console.error('Error updating screen:', error);
    res.status(500).json({ error: 'Failed to update screen', details: error?.response?.data || error?.message });
  }
});

app.delete('/api/screens/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    await pb.collection('screens').delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting screen:', error);
    res.status(500).json({ error: 'Failed to delete screen' });
  }
});

// ── Atlas: transiciones entre pantallas (screen_transitions) ──
app.get('/api/screen-transitions', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const records = await pb.collection('screen_transitions').getFullList({ sort: 'from_screen,to_screen,order' });
    const transitions = records.map(r => ({
      id: r.id,
      fromScreenId: r.from_screen || null,
      toScreenId: r.to_screen || null,
      viaPointId: r.via_point || null,
      triggerType: r.trigger_type || '',
      estimatedDurationSec: r.estimated_duration_sec,
      order: r.order,
      createdAt: r.created,
      updatedAt: r.updated,
    }));
    res.json(transitions);
  } catch (error) {
    console.error('Error fetching screen transitions:', error);
    res.status(500).json({ error: 'Failed to fetch screen transitions' });
  }
});

app.post('/api/screen-transitions', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const { fromScreenId, toScreenId, viaPointId, triggerType, estimatedDurationSec, order } = req.body;
    if (!fromScreenId || !toScreenId) return res.status(400).json({ error: 'fromScreenId and toScreenId are required' });
    const record = await pb.collection('screen_transitions').create({
      from_screen: fromScreenId,
      to_screen: toScreenId,
      via_point: viaPointId || null,
      trigger_type: triggerType || '',
      estimated_duration_sec: estimatedDurationSec != null ? estimatedDurationSec : 0,
      order: order != null ? order : 0,
    });
    res.status(201).json({
      id: record.id,
      fromScreenId: record.from_screen || null,
      toScreenId: record.to_screen || null,
      viaPointId: record.via_point || null,
      triggerType: record.trigger_type || '',
      estimatedDurationSec: record.estimated_duration_sec,
      order: record.order,
      createdAt: record.created,
      updatedAt: record.updated,
    });
  } catch (error) {
    console.error('Error creating screen transition:', error);
    res.status(500).json({ error: 'Failed to create screen transition' });
  }
});

app.put('/api/screen-transitions/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const { fromScreenId, toScreenId, viaPointId, triggerType, estimatedDurationSec, order } = req.body;
    const updatePayload: any = {};
    if (fromScreenId !== undefined) updatePayload.from_screen = fromScreenId || null;
    if (toScreenId !== undefined) updatePayload.to_screen = toScreenId || null;
    if (viaPointId !== undefined) updatePayload.via_point = viaPointId || null;
    if (triggerType !== undefined) updatePayload.trigger_type = triggerType || '';
    if (estimatedDurationSec !== undefined) updatePayload.estimated_duration_sec = estimatedDurationSec;
    if (order !== undefined) updatePayload.order = order;
    const record = await pb.collection('screen_transitions').update(req.params.id, updatePayload);
    res.json({
      id: record.id,
      fromScreenId: record.from_screen || null,
      toScreenId: record.to_screen || null,
      viaPointId: record.via_point || null,
      triggerType: record.trigger_type || '',
      estimatedDurationSec: record.estimated_duration_sec,
      order: record.order,
      createdAt: record.created,
      updatedAt: record.updated,
    });
  } catch (error: any) {
    console.error('Error updating screen transition:', error);
    res.status(500).json({ error: 'Failed to update screen transition', details: error?.response?.data || error?.message });
  }
});

app.delete('/api/screen-transitions/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    await pb.collection('screen_transitions').delete(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting screen transition:', error);
    res.status(500).json({ error: 'Failed to delete screen transition' });
  }
});

// ── TTS: vista previa de voz (edge-tts) para el selector del modal ──
app.post('/api/tts/preview', async (req: Request, res: Response) => {
  try {
    const { text, voice, language } = req.body || {};
    const sample = (typeof text === 'string' && text.trim()) ? text.slice(0, 300) : 'Hola, esta es una muestra de la voz en off del tutorial.';
    const lang = language || 'es';
    const tmpDir = path.resolve(__dirname, '..', 'serve', 'logs');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, `tts-preview-${Date.now()}.wav`);
    await __zeusGenerateTtsAudio(sample, outPath, lang, voice || undefined);
    if (!fs.existsSync(outPath)) {
      return res.status(500).json({ error: 'No se pudo generar la muestra de voz' });
    }
    const data = fs.readFileSync(outPath);
    try { fs.unlinkSync(outPath); } catch {}
    res.set('Content-Type', 'audio/wav');
    res.set('Cache-Control', 'no-store');
    res.send(data);
  } catch (error: any) {
    console.error('Error generating TTS preview:', error?.message || error);
    res.status(500).json({ error: 'Failed to generate TTS preview' });
  }
});

// ── Point Zero: mouse calibration offsets ──
app.get('/api/point-zero', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const records = await pb.collection('point_zero').getFullList({ sort: '-created', limit: 1 });
    if (records.length === 0) {
      return res.json({});
    }
    const r = records[0];
    res.json({
      id: r.id,
      zeus_mouse_offset_x: r.zeus_mouse_offset_x,
      zeus_mouse_offset_y: r.zeus_mouse_offset_y,
      zeus_real_mouse_offset_x: r.zeus_real_mouse_offset_x,
      zeus_real_mouse_offset_y: r.zeus_real_mouse_offset_y,
      real_mouse_scale_x: r.real_mouse_scale_x,
      real_mouse_scale_y: r.real_mouse_scale_y,
      zeus_virtual_mouse_offset_x: r.zeus_virtual_mouse_offset_x,
      zeus_virtual_mouse_offset_y: r.zeus_virtual_mouse_offset_y,
    });
  } catch (error) {
    console.error('Error fetching point zero:', error);
    res.status(500).json({ error: 'Failed to fetch point zero' });
  }
});

app.post('/api/point-zero', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const record = await pb.collection('point_zero').create({
      zeus_mouse_offset_x: req.body.zeus_mouse_offset_x ?? 0,
      zeus_mouse_offset_y: req.body.zeus_mouse_offset_y ?? 0,
      zeus_real_mouse_offset_x: req.body.zeus_real_mouse_offset_x ?? 0,
      zeus_real_mouse_offset_y: req.body.zeus_real_mouse_offset_y ?? 0,
      real_mouse_scale_x: req.body.real_mouse_scale_x ?? 1,
      real_mouse_scale_y: req.body.real_mouse_scale_y ?? 1,
      zeus_virtual_mouse_offset_x: req.body.zeus_virtual_mouse_offset_x ?? 0,
      zeus_virtual_mouse_offset_y: req.body.zeus_virtual_mouse_offset_y ?? 0,
    });
    res.status(201).json({ id: record.id });
  } catch (error) {
    console.error('Error creating point zero:', error);
    res.status(500).json({ error: 'Failed to create point zero' });
  }
});

app.put('/api/point-zero/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const record = await pb.collection('point_zero').update(req.params.id, {
      zeus_mouse_offset_x: req.body.zeus_mouse_offset_x ?? 0,
      zeus_mouse_offset_y: req.body.zeus_mouse_offset_y ?? 0,
      zeus_real_mouse_offset_x: req.body.zeus_real_mouse_offset_x ?? 0,
      zeus_real_mouse_offset_y: req.body.zeus_real_mouse_offset_y ?? 0,
      real_mouse_scale_x: req.body.real_mouse_scale_x ?? 1,
      real_mouse_scale_y: req.body.real_mouse_scale_y ?? 1,
      zeus_virtual_mouse_offset_x: req.body.zeus_virtual_mouse_offset_x ?? 0,
      zeus_virtual_mouse_offset_y: req.body.zeus_virtual_mouse_offset_y ?? 0,
    });
    res.json({ id: record.id });
  } catch (error) {
    console.error('Error updating point zero:', error);
    res.status(500).json({ error: 'Failed to update point zero' });
  }
});

// ── Ajustes: video adjustment settings (brillo, contraste, intensidad, tiempo_inicio) ──
app.get('/api/ajustes', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const records = await pb.collection('ajustes').getFullList({ sort: '-created', limit: 1 });
    if (records.length === 0) {
      return res.json({});
    }
    const r = records[0];
    res.json({
      id: r.id,
      brillo: r.brillo,
      contraste: r.contraste,
      intensidad: r.intensidad,
      tiempo_inicio: r.tiempo_inicio,
    });
  } catch (error) {
    console.error('Error fetching ajustes:', error);
    res.status(500).json({ error: 'Failed to fetch ajustes' });
  }
});

app.post('/api/ajustes', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const record = await pb.collection('ajustes').create({
      brillo: req.body.brillo ?? 1.0,
      contraste: req.body.contraste ?? 1.0,
      intensidad: req.body.intensidad ?? 1.0,
      tiempo_inicio: req.body.tiempo_inicio ?? 0,
    });
    res.status(201).json({ id: record.id });
  } catch (error) {
    console.error('Error creating ajustes:', error);
    res.status(500).json({ error: 'Failed to create ajustes' });
  }
});

app.put('/api/ajustes/:id', async (req: Request, res: Response) => {
  try {
    await authAsAdmin();
    const record = await pb.collection('ajustes').update(req.params.id, {
      brillo: req.body.brillo ?? 1.0,
      contraste: req.body.contraste ?? 1.0,
      intensidad: req.body.intensidad ?? 1.0,
      tiempo_inicio: req.body.tiempo_inicio ?? 0,
    });
    res.json({ id: record.id });
  } catch (error) {
    console.error('Error updating ajustes:', error);
    res.status(500).json({ error: 'Failed to update ajustes' });
  }
});

// Swagger Config
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Editor tutoriales Zeus IA API',
      version: '1.0.0',
      description: 'Aplicación de escritorio para Windows Donde conectar mediante una API Un modelo de inteligencia artificial Tanto local como remoto Para controlar la aplicación La aplicación es un editor De tutoriales De aplicaciones Especialmente Zeus Tiene que tener un editor Donde cargo la aplicación Zeus Mediante un servidor Le paso una descripción al modelo Del tutorial que quiero hacer de la aplicación Ni el modelo Con permisos para mover El ratón sobre la aplicación Y poder controlar…',
    },
    servers: [{ url: 'http://localhost:8743' }],
    paths:
      {
        "/api/editor-tutoriales-zeus-ia": {
          "get": {
            "tags": [
              "Editor tutoriales Zeus IA"
            ],
            "summary": "Editor tutoriales Zeus IA: GET /api/editor-tutoriales-zeus-ia",
            "description": "Operación GET sobre /api/editor-tutoriales-zeus-ia",
            "responses": {
              "200": {
                "description": "OK"
              }
            },
            "parameters": [
              {
                "in": "query",
                "name": "page",
                "required": false,
                "description": "Número de página (empieza en 1)",
                "schema": {
                  "type": "integer",
                  "minimum": 1,
                  "default": 1
                }
              },
              {
                "in": "query",
                "name": "limit",
                "required": false,
                "description": "Cuántos ítems devolver por página",
                "schema": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 500,
                  "default": 20
                }
              },
              {
                "in": "query",
                "name": "offset",
                "required": false,
                "description": "Desplazamiento alternativo a page/limit (índice base 0)",
                "schema": {
                  "type": "integer",
                  "minimum": 0,
                  "default": 0
                }
              },
              {
                "in": "query",
                "name": "search",
                "required": false,
                "description": "Texto de búsqueda / filtro libre",
                "schema": {
                  "type": "string"
                }
              },
              {
                "in": "query",
                "name": "sortBy",
                "required": false,
                "description": "Campo por el que ordenar",
                "schema": {
                  "type": "string"
                }
              },
              {
                "in": "query",
                "name": "sortOrder",
                "required": false,
                "description": "asc = ascendente, desc = descendente",
                "schema": {
                  "type": "string",
                  "enum": [
                    "asc",
                    "desc"
                  ]
                }
              }
            ]
          },
          "post": {
            "tags": [
              "Editor tutoriales Zeus IA"
            ],
            "summary": "Editor tutoriales Zeus IA: POST /api/editor-tutoriales-zeus-ia",
            "description": "Operación POST sobre /api/editor-tutoriales-zeus-ia",
            "responses": {
              "200": {
                "description": "OK"
              },
              "201": {
                "description": "Created"
              }
            }
          }
        },
        "/api/editor-tutoriales-zeus-ia/{id}": {
          "get": {
            "tags": [
              "Editor tutoriales Zeus IA"
            ],
            "summary": "Editor tutoriales Zeus IA: GET /api/editor-tutoriales-zeus-ia/{id}",
            "description": "Operación GET sobre /api/editor-tutoriales-zeus-ia/{id}",
            "responses": {
              "200": {
                "description": "OK"
              }
            },
            "parameters": [
              {
                "in": "path",
                "name": "id",
                "required": true,
                "description": "Identificador id",
                "schema": {
                  "type": "string"
                }
              }
            ]
          },
          "put": {
            "tags": [
              "Editor tutoriales Zeus IA"
            ],
            "summary": "Editor tutoriales Zeus IA: PUT /api/editor-tutoriales-zeus-ia/{id}",
            "description": "Operación PUT sobre /api/editor-tutoriales-zeus-ia/{id}",
            "responses": {
              "200": {
                "description": "OK"
              }
            },
            "parameters": [
              {
                "in": "path",
                "name": "id",
                "required": true,
                "description": "Identificador id",
                "schema": {
                  "type": "string"
                }
              }
            ]
          },
          "delete": {
            "tags": [
              "Editor tutoriales Zeus IA"
            ],
            "summary": "Editor tutoriales Zeus IA: DELETE /api/editor-tutoriales-zeus-ia/{id}",
            "description": "Operación DELETE sobre /api/editor-tutoriales-zeus-ia/{id}",
            "responses": {
              "204": {
                "description": "No content"
              }
            },
            "parameters": [
              {
                "in": "path",
                "name": "id",
                "required": true,
                "description": "Identificador id",
                "schema": {
                  "type": "string"
                }
              }
            ]
          }
        }
      }
  },
  apis: ['./API/index.ts'],
};

function __zeusApplyDefinitionPathsToSwaggerSpec(spec: any, definition: any): any {
  const defPaths = definition && typeof definition === 'object' ? definition.paths : null;
  if (!defPaths || typeof defPaths !== 'object' || !spec || typeof spec !== 'object') return spec;
  if (!spec.paths || typeof spec.paths !== 'object') spec.paths = {};
  const verbs = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
  for (const pathKey of Object.keys(defPaths)) {
    const defItem = (defPaths as Record<string, unknown>)[pathKey];
    if (!defItem || typeof defItem !== 'object') continue;
    const specItem = (spec.paths as Record<string, unknown>)[pathKey];
    if (!specItem || typeof specItem !== 'object') continue;
    for (const verb of verbs) {
      const defOp = (defItem as Record<string, unknown>)[verb];
      const specOp = (specItem as Record<string, unknown>)[verb];
      if (!defOp || typeof defOp !== 'object' || !specOp || typeof specOp !== 'object') continue;
      if (Array.isArray((defOp as { parameters?: unknown }).parameters)) {
        const dp = (defOp as { parameters: unknown[] }).parameters;
        if (dp.length > 0) (specOp as { parameters: unknown[] }).parameters = dp;
      }
      const defRb = (defOp as { requestBody?: unknown }).requestBody;
      if (
        defRb &&
        typeof defRb === 'object' &&
        defRb !== null &&
        typeof (defRb as { content?: unknown }).content === 'object' &&
        (defRb as { content: unknown }).content !== null
      ) {
        (specOp as { requestBody: unknown }).requestBody = defRb;
      }
    }
  }
  return spec;
}

const swaggerSpec = __zeusApplyDefinitionPathsToSwaggerSpec(swaggerJsdoc(swaggerOptions), (swaggerOptions as { definition?: { paths?: unknown } }).definition);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customCss: ".swagger-ui .info .title{font-size:1.5rem!important;line-height:1.3;font-weight:600}.swagger-ui .info .description{font-size:.875rem!important;line-height:1.55!important;max-width:56rem;color:#3b4151;font-weight:400}.swagger-ui .info .description p{margin:.45em 0}.swagger-ui .info .description ul,.swagger-ui .info .description ol{margin:.4em 0 .4em 1.15em}.swagger-ui .info .description h1,.swagger-ui .info .description h2,.swagger-ui .info .description h3,.swagger-ui .info .description h4{font-size:1rem!important;font-weight:600!important;margin:.7em 0 .35em!important;line-height:1.35!important}" }));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customCss: ".swagger-ui .info .title{font-size:1.5rem!important;line-height:1.3;font-weight:600}.swagger-ui .info .description{font-size:.875rem!important;line-height:1.55!important;max-width:56rem;color:#3b4151;font-weight:400}.swagger-ui .info .description p{margin:.45em 0}.swagger-ui .info .description ul,.swagger-ui .info .description ol{margin:.4em 0 .4em 1.15em}.swagger-ui .info .description h1,.swagger-ui .info .description h2,.swagger-ui .info .description h3,.swagger-ui .info .description h4{font-size:1rem!important;font-weight:600!important;margin:.7em 0 .35em!important;line-height:1.35!important}" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Swagger UI available on http://localhost:${PORT}/api-docs and http://localhost:${PORT}/docs`);
  console.log(`[BUILD-INFO] Merge code v2 loaded at ${new Date().toISOString()}`);
  console.log(`[BUILD-INFO] __zeusMergeAudioSubtitlesToVideo exists: ${typeof __zeusMergeAudioSubtitlesToVideo === 'function'}`);
  console.log(`[BUILD-INFO] __zeusProbeStreams exists: ${typeof __zeusProbeStreams === 'function'}`);
});

