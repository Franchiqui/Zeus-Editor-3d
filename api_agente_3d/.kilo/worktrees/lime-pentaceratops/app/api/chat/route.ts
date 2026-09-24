import PocketBase from 'pocketbase';
import { NextResponse } from 'next/server';
import { POCKETBASE_EMAIL, POCKETBASE_PASSWORD, PB_COLLECTIONS, getAuthedPocketBase } from '@/lib/pb-api';
import {
  CONVERSATIONS_FIELDS,
  MESSAGES_FIELDS,
  MODELOS_FIELDS,
  getProviderPreset,
  normalizeProvider,
} from '@/lib/collections';
import { extractChatContent, safeSnippet, ollamaNativeMode, messagesToGeneratePrompt, toOllamaNativeMessages, extractVisionQuestions, stripVisionBlocks } from '@/lib/llm';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const OLLAMA_CLOUD_API_KEY = process.env.OLLAMA_API_KEY ?? process.env.OLLAMA_CLOUD_API_KEY;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com/chat/completions';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type VisionModelRef = {
  provider: string;
  model: string;
  modelRecordId?: string;
};

type ChatBody = {
  provider: string;
  model: string;
  modelRecordId?: string;
  history?: ChatMessage[];
  newMessage: ChatMessage;
  conversationId?: string;
  projectId?: string;
  title?: string;
  /** Imágenes en base64 (data URLs) para visión. Solo OpenAI/GPT-4o las soporta. */
  images?: string[];
  /** System prompt opcional (ej. capacidades del editor) */
  systemContext?: string;
  /** Si se setea, el modelo de texto delega al modelo de visión mediante bloques [VISION]. */
  visionModel?: VisionModelRef;
  /** Modo de turno único para el bucle de delegación controlado por el cliente. */
  mode?: 'text' | 'vision' | 'persist';
  /** Texto final del asistente para persistir (modo 'persist'). */
  finalText?: string;
};

type ResolvedModelConfig = {
  apiKey: string | undefined;
  apiUrl: string | undefined;
  modelId: string;
  requiresApiKey: boolean;
  providerId: string;
};

const MAX_VISION_ROUNDS = 4;

/**
 * Resuelve la config (clave, url, id de modelo) de un modelo a partir de su registro en PocketBase
 * y los fallbacks por env/preset. Reutilizable para el modelo de texto y el de visión.
 */
async function resolveModelConfig(
  pb: PocketBase,
  modelRecordId: string | undefined,
  providerRaw: string
): Promise<ResolvedModelConfig> {
  const providerId = normalizeProvider(providerRaw);
  const preset = getProviderPreset(providerId);
  const requiresApiKey = preset?.requiresApiKey ?? true;

  let apiKey: string | undefined;
  let apiUrl: string | undefined;
  let modelId: string | undefined;

  if (modelRecordId) {
    try {
      const modelRecord = await pb.collection(PB_COLLECTIONS.MODELOS).getOne(modelRecordId);
      apiKey = modelRecord[MODELOS_FIELDS.CLAVE_API] ?? undefined;
      apiUrl = modelRecord[MODELOS_FIELDS.URL] ?? undefined;
      if (modelRecord[MODELOS_FIELDS.ID_MODELO]) {
        modelId = String(modelRecord[MODELOS_FIELDS.ID_MODELO]);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn('Modelo no encontrado en PocketBase, usando API key de env:', msg);
    }
  }

  if (!apiKey) {
    if (providerId === 'OpenAI') apiKey = OPENAI_API_KEY;
    else if (providerId === 'Deepseek') apiKey = DEEPSEEK_API_KEY;
    else if (providerId === 'OllamaCloud') apiKey = OLLAMA_CLOUD_API_KEY;
    else apiKey = undefined;

    if (!apiKey && requiresApiKey && modelRecordId) {
      throw new Error(
        'El modelo seleccionado no existe aquí. Ve a Ajustes (engranaje) y añade un modelo con tu API key.'
      );
    }
  }

  if (!apiUrl) {
    apiUrl =
      preset?.defaultBaseUrl ||
      (providerId === 'OpenAI' ? OPENAI_URL : providerId === 'Deepseek' ? DEEPSEEK_URL : OPENAI_URL);
  }

  return { apiKey, apiUrl, modelId: modelId || '', requiresApiKey, providerId };
}

/**
 * Llama al modelo de visión con una pregunta y las imágenes del editor. Devuelve texto.
 * Sólo proveedores OpenAI-compatibles soportan imágenes; DeepSeek no.
 */
async function callVisionModel(
  pb: PocketBase,
  vision: VisionModelRef,
  question: string,
  images: string[],
  systemContext: string
): Promise<string> {
  const { apiKey, apiUrl, modelId, requiresApiKey, providerId } = await resolveModelConfig(
    pb,
    vision.modelRecordId,
    vision.provider
  );

  if (providerId === 'Deepseek') {
    return 'El modelo de visión seleccionado (DeepSeek) no soporta imágenes. Configura un modelo de visión OpenAI-compatible (GPT-4o, etc.).';
  }

  const visionBody: ChatBody = {
    provider: vision.provider,
    model: modelId || vision.model,
    modelRecordId: vision.modelRecordId,
    history: [],
    newMessage: { role: 'user', content: question },
    images: images.length > 0 ? images : undefined,
    systemContext,
  };

  return callOpenAI(visionBody, apiKey, apiUrl, requiresApiKey);
}

function buildOpenAIMessages(body: ChatBody) {
  const history = [...(body.history ?? []), body.newMessage];
  const images = Array.isArray(body.images) && body.images.length > 0 ? body.images : [];
  const maxImages = 5;
  const msgs: Array<{ role: string; content: unknown }> = history.map((entry, index) => {
    const isLastUserMessage = index === history.length - 1 && entry.role === 'user' && images.length > 0;
    if (!isLastUserMessage) {
      return { role: entry.role, content: entry.content };
    }
    const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
      { type: 'text' as const, text: entry.content }
    ];
    for (let i = 0; i < Math.min(images.length, maxImages); i++) {
      const url = images[i];
      if (typeof url === 'string' && url.startsWith('data:')) {
        content.push({ type: 'image_url' as const, image_url: { url } });
      }
    }
    return { role: 'user' as const, content };
  });
  if (body.systemContext) {
    msgs.unshift({ role: 'system', content: body.systemContext });
  }
  return msgs;
}

async function callOpenAI(
  body: ChatBody,
  apiKey: string | undefined,
  apiUrl: string = OPENAI_URL,
  requiresApiKey = true
) {
  // Proveedores locales (Ollama, llama.cpp) y custom pueden no necesitar key.
  if (!apiKey && requiresApiKey) {
    throw new Error('OpenAI API key missing');
  }

  const messages = buildOpenAIMessages(body);

  // Endpoints nativos de Ollama (/api/generate, /api/chat) usan otro body.
  const nativeMode = ollamaNativeMode(apiUrl);
  let payload: Record<string, unknown>;
  if (nativeMode === 'generate') {
    const prompt = messagesToGeneratePrompt(messages);
    payload = { model: body.model, prompt, stream: false };
  } else if (nativeMode === 'chat') {
    const { messages: nativeMsgs } = toOllamaNativeMessages(messages);
    payload = { model: body.model, messages: nativeMsgs, stream: false };
  } else {
    payload = { model: body.model, messages };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI error: ${error}`);
  }

  const data = await response.json();
  const answer = extractChatContent(data);
  if (!answer) {
    console.warn('Respuesta del proveedor sin contenido reconocible:', safeSnippet(data));
    throw new Error(
      'El proveedor respondió 200 pero no se encontró texto en la respuesta. Revisa la URL y el modelo. Respuesta: ' +
        safeSnippet(data)
    );
  }
  return answer;
}

async function callDeepseek(body: ChatBody, apiKey?: string, apiUrl: string = DEEPSEEK_URL) {
  if (!apiKey) {
    throw new Error('Deepseek API key missing');
  }

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    ...(body.history ?? []),
    body.newMessage,
  ].map((entry) => ({ role: entry.role, content: entry.content }));
  // DeepSeek soporta mensaje system; sin esto, el systemContext (prompt del editor,
  // VISION_TOOL_PROMPT, framePrompt) se perdería y el modelo no sabría delegar a visión.
  if (body.systemContext) {
    messages.unshift({ role: 'system', content: body.systemContext });
  }

  const payload = {
    model: body.model,
    messages
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Deepseek error: ${error}`);
  }

  const data = await response.json();
  const answer = extractChatContent(data);
  if (!answer) {
    console.warn('Respuesta de Deepseek sin contenido reconocible:', safeSnippet(data));
    throw new Error('Deepseek respondió 200 pero sin contenido reconocible. Respuesta: ' + safeSnippet(data));
  }
  return answer;
}

async function persistConversation(pb: PocketBase, body: ChatBody, responseText: string) {
  let conversationId = body.conversationId;

  if (!conversationId) {
    const conversationPayload: Record<string, unknown> = {
      [CONVERSATIONS_FIELDS.PROJECT_ID]: body.projectId ?? '',
      [CONVERSATIONS_FIELDS.TITLE]: body.title ?? '',
    };
    if (body.modelRecordId != null && body.modelRecordId !== '') {
      conversationPayload[CONVERSATIONS_FIELDS.MODEL_ID] = body.modelRecordId;
    }
    const conversationRecord = await pb.collection(PB_COLLECTIONS.CONVERSATIONS).create(conversationPayload);
    conversationId = conversationRecord.id;
  }

  const createMessage = (message: ChatMessage, typeOverride?: 'content_text' | 'content_file') =>
    pb.collection(PB_COLLECTIONS.MESSAGES).create({
      [MESSAGES_FIELDS.CONVERSATION_ID]: conversationId,
      [MESSAGES_FIELDS.ROLE]: message.role,
      [MESSAGES_FIELDS.CONTENT_TEXT]: message.content,
      [MESSAGES_FIELDS.TYPE]: typeOverride ?? 'content_text',
    });

  await createMessage(body.newMessage);
  await createMessage({ role: 'assistant', content: responseText });

  return { conversationId };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatBody;

    const mode = body.mode;
    // Validación según modo. Los turnos 'vision'/'persist' no requieren provider/model del texto.
    if (mode === 'persist') {
      if (!body.newMessage?.content || typeof body.finalText !== 'string') {
        return NextResponse.json({ error: 'Datos incompletos para persistir' }, { status: 400 });
      }
    } else if (mode === 'vision') {
      if (!body.visionModel || !body.newMessage?.content) {
        return NextResponse.json({ error: 'Datos incompletos para visión' }, { status: 400 });
      }
    } else {
      if (!body.provider || !body.model || !body.newMessage?.content) {
        return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
      }
    }

    if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
      return NextResponse.json({ error: 'Credenciales de PocketBase no configuradas' }, { status: 500 });
    }

    const pb = await getAuthedPocketBase();

    // --- Turno único de persistencia (bucle delegación en cliente) ---
    if (mode === 'persist') {
      const persistence = await persistConversation(pb, body, body.finalText ?? '');
      return NextResponse.json({ success: true, conversationId: persistence.conversationId }, { status: 200 });
    }

    // --- Turno único de visión: una llamada al modelo de visión con imágenes + pregunta ---
    if (mode === 'vision') {
      const images = Array.isArray(body.images)
        ? body.images.filter((u): u is string => typeof u === 'string' && u.startsWith('data:'))
        : [];
      const visionSystem =
        body.systemContext ||
        'Eres un modelo de visión integrado en Zeus Media Studio. DEBES responder SIEMPRE en español. Describe lo que ves en la imagen/frame de forma concisa y factual. Si no se ve nada, dilo en español: "No se aprecia contenido visible en este frame". No uses inglés.';
      try {
        const text = await callVisionModel(pb, body.visionModel!, body.newMessage.content, images, visionSystem);
        return NextResponse.json({ success: true, text }, { status: 200 });
      } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
      }
    }

    // --- Turno único de texto: una llamada al modelo de texto SIN imágenes (bucle delegación) ---
    if (mode === 'text') {
      try {
        const cfg = await resolveModelConfig(pb, body.modelRecordId, body.provider);
        const bodyForProvider = { ...body, model: cfg.modelId || body.model, images: undefined };
        const text =
          cfg.providerId === 'Deepseek'
            ? await callDeepseek(bodyForProvider, cfg.apiKey, cfg.apiUrl)
            : await callOpenAI(bodyForProvider, cfg.apiKey, cfg.apiUrl, cfg.requiresApiKey);
        return NextResponse.json({ success: true, text }, { status: 200 });
      } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
      }
    }

    let text: string;

    if (body.visionModel) {
      // --- Modo delegación: el modelo de texto pregunta al de visión con bloques [VISION] ---
      const textCfg = await resolveModelConfig(pb, body.modelRecordId, body.provider);
      const images = Array.isArray(body.images)
        ? body.images.filter((u): u is string => typeof u === 'string' && u.startsWith('data:'))
        : [];
      const visionSystem =
        'Eres un modelo de visión integrado en Zeus Media Studio. DEBES responder SIEMPRE en español. Describe lo que ves en la imagen/frame de forma concisa y factual. Si no se ve nada, dilo en español: "No se aprecia contenido visible en este frame". No uses inglés.';

      // Historial corrido de mensajes {role, content} (sin imágenes para el modelo de texto).
      const running: ChatMessage[] = [...(body.history ?? []), body.newMessage];
      let lastText = '';

      for (let round = 0; round < MAX_VISION_ROUNDS; round++) {
        const roundBody: ChatBody = {
          ...body,
          model: textCfg.modelId || body.model,
          history: running.slice(0, -1),
          newMessage: running[running.length - 1],
          images: undefined, // el modelo de texto nunca recibe imágenes
        };
        const partial =
          textCfg.providerId === 'Deepseek'
            ? await callDeepseek(roundBody, textCfg.apiKey, textCfg.apiUrl)
            : await callOpenAI(roundBody, textCfg.apiKey, textCfg.apiUrl, textCfg.requiresApiKey);
        lastText = partial;

        const questions = extractVisionQuestions(partial);
        if (questions.length === 0) break;

        // Conservamos el turno del asistente (con sus bloques [VISION]) y añadimos las respuestas.
        running.push({ role: 'assistant', content: partial });
        const answers: string[] = [];
        for (const q of questions) {
          try {
            const ans =
              images.length > 0
                ? await callVisionModel(pb, body.visionModel, q, images, visionSystem)
                : 'No hay imágenes disponibles en el editor actualmente.';
            answers.push(`Pregunta: ${q}\nRespuesta: ${ans}`);
          } catch (e) {
            answers.push(
              `Pregunta: ${q}\nRespuesta: (Error al consultar el modelo de visión: ${(e as Error).message})`
            );
          }
        }
        running.push({
          role: 'user',
          content:
            `[Respuesta del modelo de visión]\n\n${answers.join('\n\n')}\n\nUsa esta información para responder al usuario. No incluyas bloques [VISION] en tu respuesta final.`,
        });
      }
      text = stripVisionBlocks(lastText);
    } else {
      // --- Modo simple: un solo modelo (con adjunto directo de imágenes si las hay) ---
      const cfg = await resolveModelConfig(pb, body.modelRecordId, body.provider);
      const bodyForProvider = { ...body, model: cfg.modelId || body.model };
      if (cfg.providerId === 'Deepseek') {
        text = await callDeepseek(bodyForProvider, cfg.apiKey, cfg.apiUrl);
      } else {
        text = await callOpenAI(bodyForProvider, cfg.apiKey, cfg.apiUrl, cfg.requiresApiKey);
      }
    }

    const persistence = await persistConversation(pb, body, text);
    return NextResponse.json({ success: true, text, conversationId: persistence.conversationId }, { status: 200 });
  } catch (error) {
    console.error('Chat API error', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversationId');
    const modelRecordId = url.searchParams.get('modelRecordId');

    if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
      return NextResponse.json({ error: 'Credenciales de PocketBase no configuradas' }, { status: 500 });
    }

    const pb = await getAuthedPocketBase();

    if (conversationId) {
      const conversation = await pb.collection(PB_COLLECTIONS.CONVERSATIONS).getOne(conversationId);
      const messagesData = await pb.collection(PB_COLLECTIONS.MESSAGES).getList(1, 100, {
        filter: `${MESSAGES_FIELDS.CONVERSATION_ID} = "${conversationId}"`,
        sort: 'created',
      });

      const messages = messagesData.items.map((item) => ({
        role: item[MESSAGES_FIELDS.ROLE] as 'user' | 'assistant',
        text: (item[MESSAGES_FIELDS.CONTENT_TEXT] as string) ?? '',
      }));

      return NextResponse.json({ conversation, messages }, { status: 200 });
    }

    if (modelRecordId) {
      const conversations = await pb.collection(PB_COLLECTIONS.CONVERSATIONS).getList(1, 5, {
        sort: '-created',
        filter: `${CONVERSATIONS_FIELDS.MODEL_ID} = "${modelRecordId}"`,
      });

      return NextResponse.json({ conversations: conversations.items }, { status: 200 });
    }

    const conversations = await pb.collection(PB_COLLECTIONS.CONVERSATIONS).getList(1, 10, {
      sort: '-created',
    });

    return NextResponse.json({ conversations: conversations.items }, { status: 200 });
  } catch (error) {
    console.error('Chat history error', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
      return NextResponse.json({ error: 'Credenciales de PocketBase no configuradas' }, { status: 500 });
    }

    const pb = await getAuthedPocketBase();

    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversationId');

    const deleteMessages = async (filter?: string) => {
      const messages = await pb.collection(PB_COLLECTIONS.MESSAGES).getFullList({ sort: '-created', filter });
      await Promise.all(messages.map((message) => pb.collection(PB_COLLECTIONS.MESSAGES).delete(message.id)));
    };

    const deleteConversations = async (filter?: string) => {
      const conversations = await pb.collection(PB_COLLECTIONS.CONVERSATIONS).getFullList({ sort: '-created', filter });
      await Promise.all(conversations.map((conversation) => pb.collection(PB_COLLECTIONS.CONVERSATIONS).delete(conversation.id)));
    };

    if (conversationId) {
      await deleteMessages(`${MESSAGES_FIELDS.CONVERSATION_ID} = "${conversationId}"`);
      await deleteConversations(`id = "${conversationId}"`);
    } else {
      await deleteMessages();
      await deleteConversations();
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Chat history delete error', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
      return NextResponse.json({ error: 'Credenciales de PocketBase no configuradas' }, { status: 500 });
    }

    const pb = await getAuthedPocketBase();

    const body = await request.json().catch(() => ({}));
    const conversationId = body.conversationId ?? body.id;
    const title = typeof body.title === 'string' ? body.title.trim() : '';

    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId requerido' }, { status: 400 });
    }

    await pb.collection(PB_COLLECTIONS.CONVERSATIONS).update(conversationId, {
      [CONVERSATIONS_FIELDS.TITLE]: title || 'Sin título',
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Chat conversation update error', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
