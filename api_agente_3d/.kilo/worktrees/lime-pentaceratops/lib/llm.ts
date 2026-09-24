/**
 * Utilidades compartidas para interpretar respuestas de proveedores OpenAI-compatibles.
 * Cubre OpenAI, DeepSeek, Ollama (/v1/chat/completions y /api/chat nativo) y llama.cpp,
 * que devuelven el contenido en campos distintos.
 */

type AnyObj = { [key: string]: unknown };

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

/** Extrae texto de un campo `content` que puede ser string o array de partes {type:'text', text}. */
function extractContentField(content: unknown): string | null {
  if (typeof content === 'string') return asString(content);
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === 'object') {
        const p = part as AnyObj;
        const text = asString(p.text) ?? asString((p.content as unknown));
        if (text) return text;
      }
    }
  }
  return null;
}

/**
 * Extrae el texto de la respuesta JSON de un proveedor OpenAI-compatible.
 * Devuelve null si no encuentra contenido en ningún formato conocido.
 */
export function extractChatContent(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as AnyObj;

  // 1) OpenAI / Ollama /v1 / llama.cpp / DeepSeek: choices[].message.content
  const choices = d.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as AnyObj | undefined;
    const message = first?.message as AnyObj | undefined;
    const content = extractContentField(message?.content);
    if (content) return content;
    // Algunos servidores devuelven delta en vez de message
    const delta = first?.delta as AnyObj | undefined;
    const deltaContent = extractContentField(delta?.content);
    if (deltaContent) return deltaContent;
  }

  // 2) Formato alternativo: output[].content[].text
  const output = d.output;
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0] as AnyObj | undefined;
    const contentArr = first?.content;
    if (Array.isArray(contentArr) && contentArr.length > 0) {
      const text = asString((contentArr[0] as AnyObj)?.text);
      if (text) return text;
    }
  }

  // 3) Ollama nativo /api/chat: { message: { content: "..." } }
  const message = d.message as AnyObj | undefined;
  const ollamaContent = extractContentField(message?.content);
  if (ollamaContent) return ollamaContent;

  // 4) Formatos planos: { content } / { response } / { reply } / { outputText }
  return (
    asString(d.content) ??
    asString(d.response) ??
    asString(d.reply) ??
    asString(d.outputText) ??
    null
  );
}

/** Versión segura de JSON.stringify para logs (trunca cuerpos largos). */
export function safeSnippet(data: unknown, maxLen = 800): string {
  try {
    const s = typeof data === 'string' ? data : JSON.stringify(data);
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  } catch {
    return String(data);
  }
}

// ——— Endpoints nativos de Ollama (no OpenAI-compatible) ———
// /api/generate  -> body { model, prompt, stream:false }        respuesta { response }
// /api/chat      -> body { model, messages, stream:false }      respuesta { message: { content } }
// /v1/chat/completions -> formato OpenAI (lo tratan callOpenAI normal)

export type OllamaNativeMode = 'generate' | 'chat' | null;

/** Detecta si la URL apunta a un endpoint nativo de Ollama. */
export function ollamaNativeMode(url: string): OllamaNativeMode {
  const u = (url ?? '').toLowerCase();
  if (u.includes('/api/generate')) return 'generate';
  if (u.includes('/api/chat')) return 'chat';
  return null;
}

type OpenAIMessage = { role: string; content: unknown };

type NativeMessage = { role: string; content: string; images?: string[] };

/**
 * Convierte mensajes en formato OpenAI (content string o array de partes
 * con image_url) a mensajes nativos de Ollama. Devuelve también todas las
 * imágenes base64 recogidas (para adjuntarlas en /api/generate a nivel top).
 */
export function toOllamaNativeMessages(
  messages: OpenAIMessage[]
): { messages: NativeMessage[]; allImages: string[] } {
  const allImages: string[] = [];
  const out = messages.map((m) => {
    let text = '';
    const imgs: string[] = [];
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      for (const part of m.content as Array<{ type?: string; text?: string; image_url?: { url?: string } }>) {
        if (part?.type === 'text' && typeof part.text === 'string') {
          text += (text ? '\n' : '') + part.text;
        } else if (part?.type === 'image_url') {
          const url = part.image_url?.url ?? '';
          const b64 = url.startsWith('data:') ? url.split(',')[1] ?? '' : url;
          if (b64) imgs.push(b64);
        }
      }
    }
    allImages.push(...imgs);
    const msg: NativeMessage = { role: m.role, content: text };
    if (imgs.length) msg.images = imgs;
    return msg;
  });
  return { messages: out, allImages };
}

/** Aplana mensajes a un único prompt para /api/generate (sin roles estructurados). */
export function messagesToGeneratePrompt(messages: OpenAIMessage[]): string {
  return messages
    .map((m) => {
      let text = '';
      if (typeof m.content === 'string') text = m.content;
      else if (Array.isArray(m.content)) {
        text = m.content
          .filter((p) => p?.type === 'text')
          .map((p) => p.text ?? '')
          .join('\n');
      }
      if (m.role === 'system') return text;
      return `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${text}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

// ——— Delegación texto → visión mediante bloques [VISION]...[/VISION] ———

const VISION_BLOCK_RE = /\[VISION\]([\s\S]*?)\[\/VISION\]/gi;

/** Extrae las preguntas al modelo de visión embebidas en bloques [VISION]...[/VISION]. */
export function extractVisionQuestions(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const out: string[] = [];
  let m: RegExpExecArray | null;
  VISION_BLOCK_RE.lastIndex = 0;
  while ((m = VISION_BLOCK_RE.exec(text)) !== null) {
    const q = (m[1] || '').trim();
    if (q) out.push(q);
  }
  return out;
}

/** Elimina los bloques [VISION]...[/VISION] del texto (para la respuesta final al usuario). */
export function stripVisionBlocks(text: string): string {
  if (!text || typeof text !== 'string') return text;
  // Quita también los bloques [VISION_FRAME] por si quedan residuos.
  return text
    .replace(VISION_BLOCK_RE, '')
    .replace(/\[VISION_FRAME\][\s\S]*?\[\/VISION_FRAME\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type VisionBlock =
  | { type: 'vision'; question: string; index: number }
  | { type: 'frame'; timestamp: number; question: string; index: number };

const VISION_ANY_RE = /\[(VISION_FRAME|VISION)\]([\s\S]*?)\[\/\1\]/gi;

/**
 * Parsea los bloques de delegación al modelo de visión que aparecen en la respuesta del modelo de texto.
 * - [VISION]pregunta[/VISION]            -> usa las imágenes actuales del editor.
 * - [VISION_FRAME]segundos[/VISION_FRAME] (o [VISION_FRAME]12.5 | pregunta[/VISION_FRAME]) -> captura un frame del vídeo en ese timestamp.
 * Devuelve los bloques en orden de aparición.
 */
export function parseVisionBlocks(text: string): VisionBlock[] {
  if (!text || typeof text !== 'string') return [];
  const out: VisionBlock[] = [];
  let m: RegExpExecArray | null;
  VISION_ANY_RE.lastIndex = 0;
  while ((m = VISION_ANY_RE.exec(text)) !== null) {
    const tag = (m[1] || '').toUpperCase();
    const inner = (m[2] || '').trim();
    const index = m.index;
    if (tag === 'VISION_FRAME') {
      const tm = inner.match(/^\s*([\d.]+)\s*(?:(?:[|\n]|:\s*)\s*([\s\S]*))?$/);
      if (!tm) continue;
      const timestamp = parseFloat(tm[1]);
      if (isNaN(timestamp)) continue;
      const question = (tm[2] || '').trim() || 'Describe este frame del vídeo en español.';
      out.push({ type: 'frame', timestamp, question, index });
    } else if (tag === 'VISION' && inner) {
      out.push({ type: 'vision', question: inner, index });
    }
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}