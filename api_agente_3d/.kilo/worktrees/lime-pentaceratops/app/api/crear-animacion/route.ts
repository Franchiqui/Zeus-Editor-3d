import { NextResponse } from 'next/server';
import { POCKETBASE_EMAIL, POCKETBASE_PASSWORD, PB_COLLECTIONS, getAuthedPocketBase } from '@/lib/pb-api';
import { MODELOS_FIELDS, getProviderPreset, normalizeProvider } from '@/lib/collections';
import { extractChatContent, safeSnippet, ollamaNativeMode, messagesToGeneratePrompt, toOllamaNativeMessages } from '@/lib/llm';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const OLLAMA_CLOUD_API_KEY = process.env.OLLAMA_API_KEY ?? process.env.OLLAMA_CLOUD_API_KEY;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com/chat/completions';

type FileInfo = { name: string; type: string; size: number };

type SlideJson = {
  title: string;
  description: string;
  assignedImageName: string;
  durationSec: number;
};

export type CrearAnimacionBody = {
  title?: string;
  prompt: string;
  notes?: string;
  style: string;
  durationSeconds?: number;
  files?: FileInfo[];
  /** Proveedor (id canónico o texto libre; se normaliza en el servidor) */
  provider: string;
  /** ID del modelo en PocketBase (recomendado) */
  modelRecordId?: string;
  /** ID/nombre del modelo en el proveedor (ej. gpt-4o, deepseek-chat) */
  model?: string;
  /** Modo: animacion (por defecto) o presentacion */
  mode?: 'animacion' | 'presentation';
};

const HERRAMIENTAS_TEXTO = `
## Herramientas que tienes en Zeus Media Studio

Eres el asistente de creación dentro de **Zeus Media Studio**. La aplicación dispone de:

1. **Editor de vídeo** – Corte, montaje, pistas, transiciones, efectos. El usuario puede montar secuencias con sus clips.
2. **Editor de audio** – Pistas de audio, música, voz, mezcla. Puede añadir narración o música de fondo.
3. **Editor de imagen** – Retoque, recorte, capas, exportar frames o secuencias para usar en vídeo.
4. **Biblioteca multimedia** – Imágenes, vídeos, audios y documentos centralizados. El usuario puede elegir qué archivos usar en su pieza.
5. **Proyectos** – Organización por proyectos (vídeo, audio, imagen, documento). Los recursos se asocian a proyectos.

El resultado que propones debe ser **realizable con estas herramientas**: una animación o pieza multimedia significa una secuencia (guion/timeline) que combine los medios que el usuario ha subido o tiene en su biblioteca, no diapositivas estáticas. Puedes proponer:
- Orden y duración de cada clip o imagen.
- Dónde colocar música o voz en off.
- Textos en pantalla o títulos.
- Ritmo y estilo (pausado, dinámico, documental, etc.).
`;

function buildAnimationSystemMessage(): string {
  return `Eres un experto en crear **animaciones y piezas multimedia** (NO presentaciones de diapositivas). Tu trabajo es diseñar el montaje de una pieza dinámica (vídeo, motion, secuencia) y devolverlo como un **JSON estructurado** que el editor de vídeo materializará automáticamente en su timeline.

## REGLA ABSOLUTA - FORMATO DE RESPUESTA

Debes devolver EXCLUSIVAMENTE un objeto JSON válido. NADA de texto fuera del JSON. NO uses markdown, NO uses bloques de código. SOLO el JSON puro.

## ESTRUCTURA OBLIGATORIA

{
  "animation": {
    "title": "Título de la pieza",
    "durationSec": 30,
    "style": "cinematografico|motion_graphics|documental|minimalista|corporativo|...",
    "clips": [
      {
        "mediaName": "nombre_exacto_del_archivo.ext",
        "type": "video|image|audio",
        "track": "video|image|audio",
        "startTime": 0,
        "duration": 5,
        "sourceStartTime": 0,
        "playbackRate": 1,
        "reversed": false,
        "volume": 0.8,
        "opacity": 1,
        "transitionIn": { "type": "fade", "duration": 0.5 },
        "transitionOut": { "type": "fade", "duration": 0.5 },
        "label": "Etiqueta legible del clip"
      }
    ],
    "textOverlays": [
      { "text": "Texto en pantalla", "startTime": 0, "duration": 3, "x": 50, "y": 50, "fontSize": 48, "color": "#ffffff", "fontFamily": "Inter", "textAlign": "center", "opacity": 100 }
    ],
    "globalFilter": { "brightness": 0, "contrast": 0, "saturation": 0, "hue": 0, "blur": 0, "intensity": 0 },
    "crop": { "aspect": "16:9", "x": 0, "y": 0, "width": 100, "height": 100 }
  }
}

## INSTRUCCIONES OBLIGATORIAS

1. **MEDIOS:** Cada clip DEBE usar un \`mediaName\` que sea EXACTAMENTE el nombre de uno de los archivos que el usuario subió. NO inventes archivos. Si el usuario no subió nada, devuelve \`clips: []\` y exprésalo solo en textOverlays (títulos sobre fondo). Referencia cada medio por su nombre exacto.
2. **type/track:** \`type\` es "video" para vídeo, "image" para imágenes, "audio" para sonido. \`track\` debe coincidir con \`type\`: "video" para vídeo, "image" para imágenes (van en la pista de imagen), "audio" para audio (pista de audio).
3. **TIEMPOS:** \`startTime\` es la posición ABSOLUTA en la timeline (segundos). Los clips de vídeo/imágenes se encadenan sin huecos salvo intención expresiva. La suma/orden debe cubrir \`durationSec\`. \`duration\` es cuánto dura el clip en la timeline.
4. **FUENTE:** No conoces la duración interna de cada medio; pide duraciones razonables y el editor recortará/limitará al fuente. \`sourceStartTime\` es desde qué punto del medio empiezas (0 si no importa). \`playbackRate\` (>1 = acelerado, <1 = lento). \`reversed\` solo para vídeo.
5. **volume/opacity:** \`volume\` 0..1 (solo audio/vídeo). \`opacity\` 0..1 (vídeo/imágenes). \`transitionIn/Out\` usan tipos: "fade", "dissolve", "slide-left", "slide-right", "slide-up", "slide-down", "zoom-in", "zoom-out", "blur".
6. **textOverlays:** Títulos/subtítulos sobre el vídeo, SIN fondo (flotan sobre la imagen, no la tapan). \`x\`/\`y\` son % (0..100) de posición del centro. \`fontSize\` en px. \`opacity\` 0..100. \`textAlign\`: "left"|"center"|"right".
7. **globalFilter** (opcional): ajustes de imagen globales. brightness/contrast/saturation -100..100, hue -180..180, blur 0..20, intensity -100..100 (nitidez).
8. **crop** (opcional): recorte de exportación. \`aspect\` ∈ "16:9","9:16","1:1","4:3","3:2","21:9","5:4". x/y/width/height en % 0..100.

## RECETAS (patrones a combinar, NO selección rígida)

Inspírate en estos patrones según el objetivo del usuario, combínalos y adáptalos:

- **Intro cinética:** títulos grandes con entradas/salidas rápidas, ritmo de cortes 0.3-1s, 3-8s. Usa textOverlays con fontSize alto y transiciones zoom-in/slide.
- **Promo de producto:** vídeo del producto + texto de venta + CTA al final, 10-20s. textOverlay final con la llamada a la acción.
- **Slideshow Ken Burns:** imágenes con duración 3-6s cada una, encadenadas con fade/dissolve, música de fondo en pista de audio (volume ~0.6). Puedes añadir playbackRate o variar opacity.
- **Lower-third / título sobre vídeo:** vídeo principal en pista de vídeo + un textOverlay de título en la parte inferior (y ~80) semitransparente.

Responde en el mismo idioma que use el usuario (español si escribe en español). Devuelve SOLO el JSON con la estructura indicada.`;
}

function buildPresentationSystemMessage(): string {
  return `Eres un experto en diseño de presentaciones visuales. Tu trabajo es crear una presentación de diapositivas a partir de las imágenes y el guion que te proporcione el usuario.

## REGLA ABSOLUTA - FORMATO DE RESPUESTA

Debes devolver EXCLUSIVAMENTE un objeto JSON válido. NADA de texto fuera del JSON. NO uses markdown, NO uses bloques de código. SOLO el JSON puro.

## ESTRUCTURA OBLIGATORIA

Cada diapositiva DEBE incluir TODOS estos campos obligatoriamente:

{
  "presentation": {
    "title": "Título de la presentación",
    "coverSvg": "<svg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'>...</svg>",
    "slides": [
      {
        "title": "Título de la diapositiva",
        "description": "Texto descriptivo que aparecerá sobre la imagen",
        "assignedImageName": "nombre_exacto_del_archivo.jpg",
        "durationSec": 5,
        "textWidth": 100,
        "textAlign": "center",
        "titleFontSize": 37,
        "titleColor": "#ffffff",
        "titleFontFamily": "Inter",
        "descriptionFontSize": 24,
        "descriptionColor": "#e5e7eb",
        "descriptionFontFamily": "Inter"
      }
    ],
    "gradientFrom": "#1a1a2e",
    "gradientTo": "#0a0a0a"
  }
}

## INSTRUCCIONES OBLIGATORIAS

1. **PORTADA SVG:** Genera obligatoriamente un campo coverSvg a nivel de presentation (NO dentro de slides). Debe ser un SVG completo y autónomo de 1920x1080 px que sirva como diapositiva de portada. Puedes usar: formas geométricas, degradados, texto estilizado, líneas decorativas, círculos, ondas, etc. El SVG debe incluir el título de la presentación y un subtítulo. NO uses fuentes externas; usa solo fuentes del sistema (serif, sans-serif, monospace). Devuélvelo como string SVG escapado en JSON.
2. Cada diapositiva DEBE tener un título corto y atractivo, una descripción de 2-4 frases, el nombre exacto del archivo de imagen, y una duración en segundos.
3. **OBLIGATORIO - ESTILO DE TEXTO:** Para cada diapositiva DEBES elegir y devolver:
   - textWidth: SIEMPRE 100 (obligatorio, no puede ser otro valor).
   - textAlign: "left", "center" o "right".
   - titleFontSize: tamaño en px del título.
   - titleColor: color del título en HEX (ej. "#ff6b6b", "#4ecdc4", "#f7d794"). NO uses siempre blanco; elige colores que encajen con el tema y la imagen.
   - titleFontFamily: fuente del título ("Inter", "Georgia", "Playfair Display", "Arial Black", "Courier New", etc.).
   - descriptionFontSize: tamaño en px de la descripción.
   - descriptionColor: color de la descripción en HEX.
   - descriptionFontFamily: fuente de la descripción.
4. **OBLIGATORIO - FONDO:** Si el usuario NO proporcionó un archivo de vídeo/imagen EXCLUSIVAMENTE para fondo, DEBES generar un degradado. Añade los campos gradientFrom y gradientTo a nivel de presentation (NO dentro de slides) con colores HEX que combinen armoniosamente con los colores del texto y el tema de la presentación.
5. Asigna cada imagen proporcionada a la diapositiva que mejor encaje según el guion.
6. La suma total de durationSec debe coincidir aproximadamente con la duración indicada.
7. Si hay audio de fondo, menciónalo en la descripción pero NO generes URLs.`;
}

function buildAnimationUserMessage(body: CrearAnimacionBody): string {
  const parts: string[] = [];

  if (body.title) {
    parts.push(`**Título de la pieza:** ${body.title}`);
  }

  parts.push(`**Objetivo / qué quiero conseguir:**\n${body.prompt}`);

  if (body.notes?.trim()) {
    parts.push(`**Texto, guion o notas adicionales:**\n${body.notes}`);
  }

  parts.push(`**Estilo/tono deseado:** ${body.style}`);

  if (body.durationSeconds && body.durationSeconds > 0) {
    parts.push(`**Duración aproximada deseada:** ${body.durationSeconds} segundos`);
  }

  if (body.files && body.files.length > 0) {
    parts.push(
      `**Material que el usuario envía (archivos que tendrá disponibles):**\n${body.files
        .map(
          (f) =>
            `- ${f.name} (tipo: ${f.type || 'desconocido'}, tamaño: ${(f.size / 1024).toFixed(1)} KB)`
        )
        .join('\n')}\n\nUsa SOLO estos nombres exactos en el campo \`mediaName\` de cada clip. No inventes archivos.`
    );
  } else {
    parts.push('**El usuario no subió archivos:** construye la pieza solo con textOverlays (títulos sobre fondo) y deja \`clips: []\`.');
  }

  parts.push(
    '\nDiseña el montaje de la animación/pieza multimedia como un JSON con la estructura indicada: clips en `clips` (encadenados por startTime absoluto), títulos en `textOverlays`, y opcionalmente `globalFilter` y `crop`. Devuelve SOLO el JSON.'
  );

  return parts.join('\n\n');
}

function buildPresentationUserMessage(body: CrearAnimacionBody): string {
  const parts: string[] = [];

  if (body.title) {
    parts.push(`**Título de la presentación:** ${body.title}`);
  }

  parts.push(`**Objetivo / qué quiero conseguir:**\n${body.prompt}`);

  if (body.notes?.trim()) {
    parts.push(`**Guión o notas adicionales:**\n${body.notes}`);
  }

  parts.push(`**Estilo/tono deseado:** ${body.style}`);

  if (body.durationSeconds && body.durationSeconds > 0) {
    parts.push(`**Duración total aproximada:** ${body.durationSeconds} segundos`);
  }

  if (body.files && body.files.length > 0) {
    const imageFiles = body.files.filter(f => (f.type || '').startsWith('image/'));
    const videoFiles = body.files.filter(f => (f.type || '').startsWith('video/'));
    const audioFiles = body.files.filter(f => (f.type || '').startsWith('audio/'));

    // Las imágenes pueden ser de diapositivas o de fondo; asumimos que la mayoría son diapositivas
    // y el usuario puede haber subido un vídeo/imagen de fondo adicional
    parts.push(
      `**Imágenes para las diapositivas:**\n${imageFiles
        .map((f) => `- ${f.name} (${(f.size / 1024).toFixed(1)} KB)`)
        .join('\n')}`
    );

    if (videoFiles.length > 0) {
      parts.push(
        `**Vídeo de fondo proporcionado:**\n${videoFiles
          .map((f) => `- ${f.name} (${(f.size / 1024).toFixed(1)} KB)`)
          .join('\n')}`
      );
    }

    if (audioFiles.length > 0) {
      parts.push(
        `**Audio de fondo proporcionado:**\n${audioFiles
          .map((f) => `- ${f.name} (${(f.size / 1024).toFixed(1)} KB)`)
          .join('\n')}`
      );
    }
  }

  parts.push(
    '\nCrea una presentación de diapositivas usando las imágenes proporcionadas. Devuelve SOLO el JSON con la estructura indicada. RECUERDA incluir TODOS los campos de estilo en cada diapositiva y los campos gradientFrom/gradientTo a nivel de presentation.'
  );

  return parts.join('\n\n');
}

async function callOpenAI(
  messages: { role: 'user' | 'assistant'; content: string }[],
  model: string,
  apiKey: string | undefined,
  apiUrl: string = OPENAI_URL,
  responseFormat?: { type: 'json_object' },
  requiresApiKey = true
) {
  if (!apiKey && requiresApiKey) {
    throw new Error('OpenAI API key missing');
  }

  // Endpoints nativos de Ollama (/api/generate, /api/chat) usan otro body.
  const nativeMode = ollamaNativeMode(apiUrl);
  let body: Record<string, unknown>;
  if (nativeMode === 'generate') {
    const prompt = messagesToGeneratePrompt(messages);
    body = { model, prompt, stream: false };
  } else if (nativeMode === 'chat') {
    const { messages: nativeMsgs } = toOllamaNativeMessages(messages);
    body = { model, messages: nativeMsgs, stream: false };
  } else {
    body = { model, messages };
    // response_format (JSON estricto) solo vale para /v1/chat/completions.
    if (responseFormat) body.response_format = responseFormat;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI: ${err}`);
  }

  const data = await response.json();
  const content = extractChatContent(data);
  if (!content) {
    console.warn('Respuesta del proveedor sin contenido reconocible:', safeSnippet(data));
    throw new Error(
      'El proveedor respondió 200 pero no se encontró texto. Revisa la URL y el modelo. Respuesta: ' +
        safeSnippet(data)
    );
  }
  return content;
}

async function callDeepseek(
  messages: { role: 'user' | 'assistant'; content: string }[],
  model: string,
  apiKey: string,
  apiUrl: string = DEEPSEEK_URL
) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Deepseek: ${err}`);
  }

  const data = await response.json();
  const content = extractChatContent(data);
  if (!content) {
    console.warn('Respuesta de Deepseek sin contenido reconocible:', safeSnippet(data));
    throw new Error('Deepseek respondió 200 pero sin contenido reconocible. Respuesta: ' + safeSnippet(data));
  }
  return content;
}

export async function POST(request: Request) {
  try {
    let body: CrearAnimacionBody;
    try {
      body = (await request.json()) as CrearAnimacionBody;
    } catch {
      return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
    }

    if (!body.prompt?.trim()) {
      return NextResponse.json({ error: 'Falta el objetivo/prompt' }, { status: 400 });
    }

    if (!body.provider) {
      return NextResponse.json({ error: 'Falta el proveedor' }, { status: 400 });
    }

    if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
      return NextResponse.json(
        { error: 'Credenciales de PocketBase no configuradas' },
        { status: 500 }
      );
    }

    const pb = await getAuthedPocketBase();

    // Id canónico del proveedor (admite texto libre / registros antiguos).
    const providerId = normalizeProvider(body.provider);
    const preset = getProviderPreset(providerId);
    const requiresApiKey = preset?.requiresApiKey ?? true;

    let apiKey: string | undefined;
    let apiUrl: string | undefined;
    let modelId =
      body.model ??
      preset?.defaultModel ??
      (providerId === 'OpenAI' ? 'gpt-4o' : providerId === 'Deepseek' ? 'deepseek-chat' : 'gpt-4o');

    if (body.modelRecordId) {
      try {
        const record = await pb.collection(PB_COLLECTIONS.MODELOS).getOne(body.modelRecordId);
        apiKey = record[MODELOS_FIELDS.CLAVE_API] as string | undefined;
        apiUrl = record[MODELOS_FIELDS.URL] as string | undefined;
        if (record[MODELOS_FIELDS.ID_MODELO]) {
          modelId = String(record[MODELOS_FIELDS.ID_MODELO]);
        }
      } catch (e) {
        console.warn('No se pudo cargar el modelo desde PocketBase:', e);
      }
    }

    // Fallback de API key por env si no hay registro con clave.
    if (!apiKey) {
      if (providerId === 'OpenAI') apiKey = OPENAI_API_KEY;
      else if (providerId === 'Deepseek') apiKey = DEEPSEEK_API_KEY;
      else if (providerId === 'OllamaCloud') apiKey = OLLAMA_CLOUD_API_KEY;
      else apiKey = undefined;
    }
    if (!apiUrl) {
      apiUrl =
        preset?.defaultBaseUrl ||
        (providerId === 'OpenAI' ? OPENAI_URL : providerId === 'Deepseek' ? DEEPSEEK_URL : OPENAI_URL);
    }

    // Solo se exige key si el proveedor la requiere (locales como Ollama/llama.cpp no).
    if (!apiKey && requiresApiKey) {
      return NextResponse.json(
        { error: 'Falta API key: configura la variable de entorno del proveedor o usa un modelo con clave en PocketBase' },
        { status: 400 }
      );
    }

    const isPresentation = body.mode === 'presentation';
    const isAnimation = !isPresentation; // modo por defecto
    const systemMessage = isPresentation ? buildPresentationSystemMessage() : buildAnimationSystemMessage();
    const userContent = isPresentation ? buildPresentationUserMessage(body) : buildAnimationUserMessage(body);

    const messages = [
      { role: 'system' as const, content: systemMessage },
      { role: 'user' as const, content: userContent },
    ];

    // Deepseek a veces usa otro formato; si falla "system", se puede enviar todo en user
    const messagesToSend =
      providerId === 'Deepseek'
        ? [{ role: 'user' as const, content: `${systemMessage}\n\n---\n\n${userContent}` }]
        : messages;

    let rawResponse: string;
    if (providerId === 'Deepseek') {
      rawResponse = await callDeepseek(
        messagesToSend as { role: 'user'; content: string }[],
        modelId,
        apiKey as string,
        apiUrl
      );
    } else {
      // OpenAI y todos los compatibles (Ollama local/Cloud, llama.cpp, custom).
      // response_format (JSON estricto) solo se envía a OpenAI real; otros pueden no soportarlo.
      // Ambos modos (presentación y animación) piden JSON estructurado.
      const responseFormat = (isPresentation || isAnimation) && providerId === 'OpenAI' ? { type: 'json_object' } as const : undefined;
      rawResponse = await callOpenAI(
        messagesToSend as { role: 'user'; content: string }[],
        modelId,
        apiKey,
        apiUrl,
        responseFormat,
        requiresApiKey
      );
    }

    // Intentar extraer JSON de la respuesta (ambos modos piden JSON estructurado)
    let jsonText = rawResponse.trim();
    // Quitar bloques de código markdown si existen
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/```\s*$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/```\s*$/, '');
    }
    jsonText = jsonText.trim();

    try {
      const parsed = JSON.parse(jsonText);
      if (isPresentation && parsed.presentation && Array.isArray(parsed.presentation.slides)) {
        return NextResponse.json({ success: true, presentation: parsed.presentation }, { status: 200 });
      }
      if (isAnimation && parsed.animation && Array.isArray(parsed.animation.clips)) {
        return NextResponse.json({ success: true, animation: parsed.animation }, { status: 200 });
      }
    } catch {
      // Si no es JSON válido, cae al fallback de texto
    }
    // Fallback: devolver el texto plano para que el usuario lo vea (panel de guion)
    return NextResponse.json({ success: true, text: rawResponse }, { status: 200 });
  } catch (error) {
    console.error('Crear animación API error', error);
    return NextResponse.json(
      { error: (error instanceof Error ? error.message : 'Error interno') },
      { status: 500 }
    );
  }
}
