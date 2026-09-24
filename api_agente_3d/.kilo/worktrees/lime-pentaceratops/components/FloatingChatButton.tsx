'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { MessageCircle, X, Send, Paperclip, Volume2, VolumeX, Copy, Check, Pencil, History } from 'lucide-react';
import pb from '@/lib/pocketbase';
import { useStore } from '@/lib/store';
import { normalizeProvider } from '@/lib/collections';
import { motion, AnimatePresence } from 'framer-motion';
import { type ChatMessage, useChatContext } from '@/components/ChatContext';
import { useAIEditorBridgeOptional } from '@/components/AIEditorBridgeContext';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { cleanTextForTTS } from '@/lib/utils';
import { ChatHistorySidebar } from '@/components/ChatHistorySidebar';
import { parseVisionBlocks, stripVisionBlocks } from '@/lib/llm';
import { useI18n } from '@/lib/i18n';

const FAB_POSITION_KEY = 'zeus_chat_fab_position';
const AUTOPLAY_KEY = 'zeus_chat_autoplay_responses';
const DEFAULT_RIGHT = 24;
const DEFAULT_BOTTOM = 24;

// Prompt que se inyecta al modelo de texto para que delegue al modelo de visión mediante bloques [VISION].
const VISION_TOOL_PROMPT = `Eres el modelo de texto de Zeus Media Studio. NO puedes ver imágenes ni vídeos. Respondes SIEMPRE al usuario en español. Si la petición del usuario requiere observar la imagen/vídeo/GIF actual del editor, pídelo al modelo de visión escribiendo un bloque:
[VISION]pregunta concreta en español sobre lo que necesitas ver[/VISION]
El sistema llamará al modelo de visión (que sí ve las imágenes del editor) y te devolverá la respuesta para que continúes. Úsalo para describir, leer texto, identificar objetos/colores/composición, comparar frames, etc. No inventes contenido visual: pregunta. Limita a 3 bloques por respuesta. Cuando tengas la información que necesitas, responde al usuario de forma normal EN ESPAÑOL y CON TUS PROPIAS PALABRAS, SIN incluir bloques [VISION]. No reproduzcas ni traduzcas literalmente la respuesta del modelo de visión: sintetiza tu propia respuesta.
Importante: [VISION] ve la imagen ACTUAL del editor (en el editor de imagen/GIF) o el frame ACTUAL de la previsualización (en el editor de vídeo). Para ver un instante CONCRETO de un vídeo usa [VISION_FRAME]segundos[/VISION_FRAME] (ver instrucciones específicas abajo si están disponibles). Nunca digas que no tienes acceso a imágenes/vídeos: siempre puedes pedir el frame con [VISION] o [VISION_FRAME].`;

const MAX_VISION_ROUNDS = 4;

type VisionModelItem = { id: string; nombre_modelo?: string; name?: string; proveedor?: string };
type ApiChatMessage = { role: 'user' | 'assistant'; content: string };

function loadFabPosition(): { right: number; bottom: number } {
  if (typeof window === 'undefined') return { right: DEFAULT_RIGHT, bottom: DEFAULT_BOTTOM };
  try {
    const raw = localStorage.getItem(FAB_POSITION_KEY);
    if (!raw) return { right: DEFAULT_RIGHT, bottom: DEFAULT_BOTTOM };
    const data = JSON.parse(raw);
    return {
      right: typeof data.right === 'number' ? data.right : DEFAULT_RIGHT,
      bottom: typeof data.bottom === 'number' ? data.bottom : DEFAULT_BOTTOM,
    };
  } catch {
    return { right: DEFAULT_RIGHT, bottom: DEFAULT_BOTTOM };
  }
}

export function FloatingChatButton() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(() => ({ right: DEFAULT_RIGHT, bottom: DEFAULT_BOTTOM }));
  const { messages, setMessages, conversationId, setConversationId, triggerRefreshConversations } = useChatContext();
  const generateMessageId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const createChatMessage = (role: 'user' | 'assistant', content: string): ChatMessage => ({
    id: generateMessageId(),
    role,
    content,
  });
  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [autoPlayResponses, setAutoPlayResponses] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(AUTOPLAY_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const speechSynthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const { selectedModel, setSelectedModel, selectedVisionModel, setSelectedVisionModel, systemPrompt, setSystemPrompt } = useStore();
  const aiBridge = useAIEditorBridgeOptional();
  const hasContextAccess = aiBridge?.allowAIToWriteToEditor || aiBridge?.allowVision;

  const prevAllowVisionRef = useRef(aiBridge?.allowVision);
  const [visionModels, setVisionModels] = useState<VisionModelItem[]>([]);

  // Prompt del sistema del usuario: modal de edición + borrado con confirmación.
  const hasSystemPrompt = !!systemPrompt;
  const [systemPromptModalOpen, setSystemPromptModalOpen] = useState(false);
  const [systemPromptDraft, setSystemPromptDraft] = useState('');
  const openSystemPromptModal = () => {
    setSystemPromptDraft(systemPrompt || '');
    setSystemPromptModalOpen(true);
  };
  const saveSystemPrompt = () => {
    setSystemPrompt(systemPromptDraft.trim());
    setSystemPromptModalOpen(false);
  };
  const toggleSystemPrompt = (checked: boolean) => {
    if (checked) {
      // Activar: abrir el modal para escribir/editar el prompt.
      openSystemPromptModal();
    } else {
      // Desactivar: confirmar y eliminar el prompt.
      if (systemPrompt && !window.confirm(t('chat.deleteSystemPromptConfirm'))) return;
      setSystemPrompt('');
    }
  };

  // Al activar el interruptor de visión, cargamos los modelos is_vision del usuario y
  // auto-asignamos el primero si no hay uno seleccionado. El modelo de texto (selectedModel) NO se toca.
  useEffect(() => {
    if (!aiBridge?.allowVision || !pb.authStore.model?.id) {
      prevAllowVisionRef.current = aiBridge?.allowVision;
      return;
    }
    let cancelled = false;
    const loadVisionModels = async () => {
      try {
        const userId = pb.authStore.model!.id;
        const res = await fetch(`/api/modelos?user=${userId}`);
        if (!res.ok) return;
        const data = await res.json();
        const records: VisionModelItem[] = (data.records || []).filter((r: any) => r.is_vision);
        if (cancelled) return;
        setVisionModels(records);
        const stillExists = selectedVisionModel ? records.some((r) => r.id === selectedVisionModel.id) : false;
        if (!stillExists && records.length > 0) {
          const first = records[0];
          setSelectedVisionModel({
            id: first.id,
            nombre_modelo: first.nombre_modelo ?? first.name,
            proveedor: first.proveedor,
          });
        }
      } catch (e) {
        console.error(t('chat.errLoadVisionModels'), e);
      }
    };
    if (!prevAllowVisionRef.current && aiBridge.allowVision) {
      loadVisionModels();
    }
    prevAllowVisionRef.current = aiBridge.allowVision;
  }, [aiBridge?.allowVision, selectedVisionModel, setSelectedVisionModel]);

  // En Electron/Chromium las voces se cargan de forma asíncrona; prepararlas al abrir el chat.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const es = voices.find((v) => v.lang.startsWith('es'));
      voiceRef.current = es || voices[0] || null;
    };
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [open]);

  useEffect(() => {
    setPosition(loadFabPosition());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FAB_POSITION_KEY, JSON.stringify(position));
    } catch {
      // ignore
    }
  }, [position]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(AUTOPLAY_KEY, autoPlayResponses ? '1' : '0');
    } catch {
      // ignore
    }
  }, [autoPlayResponses]);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages]);

  const provider = normalizeProvider((selectedModel?.proveedor as string) ?? '');
  const modelId = (selectedModel?.id_modelo as string) || (selectedModel?.nombre_modelo as string) || 'gpt-4';

  const sendMessage = async () => {
    const text = input.trim();
    const hasContent = text || attachedFiles.length > 0;
    if (!hasContent || loading) return;
    if (!selectedModel) {
      const userReminder = createChatMessage('user', text + (attachedFiles.length ? ` [Adjuntos: ${attachedFiles.map((f) => f.name).join(', ')}]` : ''));
      const assistantReminder = createChatMessage('assistant', 'Selecciona un modelo en la barra (desplegable junto al engranaje) para usar el chat.');
      setMessages((m) => [...m, userReminder, assistantReminder]);
      setInput('');
      setAttachedFiles([]);
      return;
    }

    const fileNames = attachedFiles.map((f) => f.name).join(', ');
    const contentWithFiles = fileNames ? (text ? `${text}\n[Archivos adjuntos: ${fileNames}]` : `[Archivos adjuntos: ${fileNames}]`) : text;
    setInput('');
    setAttachedFiles([]);
    const userMessage: ChatMessage = createChatMessage('user', contentWithFiles);
    setMessages((m) => [...m, userMessage]);
    setLoading(true);

    const hasContextAccess = aiBridge?.allowAIToWriteToEditor || aiBridge?.allowVision;
    const documentContext = (hasContextAccess && aiBridge?.getDocumentContent?.()) ?? null;
    const documentImages = (aiBridge?.allowVision && aiBridge?.getDocumentImages?.()) ?? null;
    const hasImages = Array.isArray(documentImages) && documentImages.length > 0;
    const textContent = documentContext
      ? `[Contexto del documento abierto en el editor]\n\n${documentContext}\n\n---\n\n${contentWithFiles}`
      : contentWithFiles;
    const newMessageForApi: ChatMessage = createChatMessage('user', textContent);

    const editorSystemContext = aiBridge?.hasActionExecutor
      ? (aiBridge.getEditorSystemPrompt() ?? `Eres el asistente IA integrado en Zeus Media Studio, un editor de vídeo profesional.
Tienes acceso completo a la API del editor. Cuando el usuario te pida hacer algo en el editor, ejecuta la acción usando bloques [ZEUS_ACTION].

Formato de acción:
[ZEUS_ACTION]{"action":"nombreAccion","params":{...}}[/ZEUS_ACTION]

Hay DOS familias de acciones:
- **Backend** (operan sobre el proyecto del servidor, requieren projectId): createProject, getProjects, getProject, updateProject, deleteProject, getTimeline, insertClip, updateClip, deleteClip, getAssets, getAsset, uploadAsset, listFiles, deleteFile, addEffect, addTransition, addText, getEffects, getTransitions, getStyles, generateScript, getSuggestions, autoEdit, exportProject, getExportStatus, downloadExport, getCurrentProjectId.
- **Locales** (operan sobre el proyecto VISIBLE en el editor, NO requieren projectId — son las que normalmente quieres para editar el vídeo que ve el usuario):

INSPECCIÓN
- getEditState: {} → resumen del estado actual (clips del timeline con ids/tiempos, tracks, textClips, objectClips, crop, selección, filtros, trim). Los ids de clips tienen formato "clip-<número>" (NO son el nombre del archivo). IMPORTANTE: el resultado te llega en MI SIGUIENTE mensaje, no lo ves en el mismo turno. Si necesitas un id, emite SOLO getEditState en un mensaje, espera mi respuesta con el estado y usa ese id en el mensaje siguiente. NUNCA inventes ids a partir del nombre del archivo: si pasas un id inexistente la acción fallará.

TIMELINE
- addClip: {"type":"video|audio|image|text","mediaFileId":"...","label":"...","startTime":0,"duration":5,"trackId?":"..."} → crea un clip en la primera pista del tipo (o la indicada). Devuelve {clipId}.
- deleteClip: {"clipId":"..."}
- splitClip: {"clipId":"...","time":10} → divide en el segundo 10 (tiempo absoluto del timeline).
- mergeClips: {"clipIdA":"...","clipIdB":"..."} → suelda dos clips de la misma pista.
- setClipProp: {"clipId":"...","prop":"startTime|duration|playbackRate|reversed|opacity|volume|transitionIn|transitionOut|sourceStartTime|label","value":...} → opacity y volume en 0..100 (se convierten). transitionIn/transitionOut = {"type":"fade|slide-left|...|none","duration":0.5}.
- addSpeedZone: {"clipId":"...","startLocal":2,"endLocal":5,"newDuration":8} → zona lenta/rápida (coords locales del clip).
- snapTrackToStart: {"trackId":"..."} → mueve todos los clips de la pista para que el primero empiece en 0.
- deleteTrack: {"trackId":"..."}
- addTrack: {"type":"video|audio|text|image"}
- separateAudio: {"clipId":"..."} → separa el audio de un clip de vídeo.
- duplicateClip: {"clipId":"..."}

CROP / ZONA
- setCrop: {"x":10,"y":10,"width":80,"height":80,"aspect?":"16:9"} → valores en % 0..100.
- applyCropPreset: {"aspect":"16:9"} → "16:9","9:16","1:1","4:3",... o null para libre.
- toggleCrop: {} → activa/desactiva el recorte.
- resetCrop: {}

SELECCIÓN / MÁSCARA
- setSelectionShape: {"type":"rect|circle","x":25,"y":25,"width":50,"height":50} → % 0..100.
- setSelectionScope: {"scope":"inside|outside"}
- setSelectionTimeRange: {"timeStart":0,"timeEnd":10,"enabled?":true}
- toggleSelectionTrack: {"enabled?":true} → activa "seguir objeto".
- addSelectionKeyframe: {"time":2,"x":30,"y":30,"width":40,"height":40} → fija la caja en el segundo 2 (sigue el objeto).
- removeSelectionKeyframe: {"time":2}
- clearSelectionKeyframes: {}
- resetSelection: {}

OBJETOS
- addObject: {"src":"dataURL o URL","mediaType":"png|gif|video","name?":"..."} → añade objeto en el instante actual (centro, 28% ancho). Usa getEditState luego para su id.
- updateObject: {"id":"...","startTime?":0,"duration?":5,"width?":30,"opacity?":80,"position?":{"x":50,"y":50},"name?":"..."} (opacity 0..100).
- deleteObject: {"id":"..."}

TEXTO
- addTextOverlay: {"text":"Hola","startTime?":1,"duration?":3,"fontSize?":48,"color?":"#ffffff","x?":50,"y?":50,"fontFamily?":"Arial","textAlign?":"left|center|right","opacity?":100} (opacity 0..100). Usa getEditState luego para su id.
- updateText: {"id":"...","text?":"...","startTime?":0,"duration?":5,"fontSize?":48,"color?":"#000","x?":50,"y?":50,"opacity?":80,...}
- deleteText: {"id":"..."}

FILTROS / TRIM
- setFilter: {"brightness?":40,"contrast?":0,"saturation?":0,"hue?":0,"blur?":0,"intensity?":0} → rangos -100..100 (hue -180..180, blur 0..20).
- setTrim: {"trimStart?":2,"trimEnd?":50} → segundos.
- resetFilters: {}
- resetTrim: {}

TRANSPORTE / GLOBAL
- seek: {"time":12.5} → mueve el cabezal.
- playPause: {"playing?":true}
- refreshPreview: {}
- undo: {} / redo: {} / newProject: {}

GENERACIÓN DE MEDIA (solo app de escritorio; asíncronas, tardan y añaden un clip al timeline al terminar)
- startLtxServers: {} → arranca ComfyUI + Flux Bridge (necesario antes de generateLtx).
- restartBridge: {} → rearranca solo el Flux Bridge.
- capturePreviewFrame: {} → captura el frame actual del preview como imagen de entrada del LTX i2v.
- addLocalFile: {"filePath":"C:\\ruta\\clip.mp4","type?":"video|audio|image","label?":"...","duration?":3} → añade un archivo local por ruta como clip.
- enhanceVideo: {"scale?":2,"sharpen?":1,"denoise?":1,"fps?":60,"motionMci?":true,"inputPath?":"...","fileName?":"..."} → mejora el vídeo cargado (o inputPath) con ffmpeg; el resultado se añade al timeline.
- htmlToMp4: {"htmlPath?":"C:\\ruta\\anim.html","zipPath?":"C:\\ruta\\proy.zip","duration":10,"speed":1,"fps":30,"width":1920,"height":1080,"fileName?":"..."} → renderiza HTML/ZIP a MP4 (uno de htmlPath/zipPath).
- generateLtx: {"prompt":"...","seed?":12345,"duration?":97,"fps?":30,"width?":768,"height?":512,"fileName?":"..."} → genera vídeo con LTX. Requiere un workflow de ComfyUI y los node IDs ya cargados en la pestaña LTX (la UI); la IA sólo puede pasar prompt/seed/duración/fps/resolución/nombre. Si falla con "no hay workflow", pide al usuario que lo cargue.

Puedes usar múltiples bloques [ZEUS_ACTION] en una misma respuesta, pero SOLO cuando no dependan del resultado de otra. Si una acción necesita un id que no conoces (splitClip, deleteClip, setClipProp, updateObject, updateText, addSpeedZone, separateAudio, duplicateClip…), detente: emite getEditState SOLO, espera mi respuesta con los ids reales, y actúa en el siguiente mensaje. Los ids son opacos (formato "clip-<número>"); no los deduzcas del nombre del archivo. Explica al usuario lo que estás haciendo antes de ejecutar cada acción. Para editar el vídeo visible prefiere las acciones LOCALES. Para operaciones de proyecto del servidor usa getCurrentProjectId primero.`)
      : undefined;

    // Modo delegación: hay modelo de visión seleccionado y el interruptor de visión está on.
    // El modelo de texto NO recibe imágenes; delega al modelo de visión con bloques [VISION].
    const delegationMode = !!(aiBridge?.allowVision && selectedVisionModel);
    const hasFrameCapture = !!aiBridge?.hasCaptureVideoFrameAt;
    const visionModelRef = delegationMode
      ? {
          provider: normalizeProvider((selectedVisionModel.proveedor as string) ?? ''),
          model: (selectedVisionModel.id_modelo as string) || (selectedVisionModel.nombre_modelo as string) || selectedVisionModel.id,
          modelRecordId: selectedVisionModel.id,
        }
      : undefined;
    const videoTime = (hasFrameCapture && aiBridge?.getVideoTime?.()) || null;
    const fmtSec = (s: number | undefined | null) =>
      typeof s === 'number' && isFinite(s) ? s.toFixed(1) : '0.0';
    const framePrompt = hasFrameCapture
      ? `\n\nEstás en el EDITOR DE VÍDEO. Hay un vídeo cargado en el timeline (duración ${fmtSec(videoTime?.duration)}s); la previsualización está ahora mismo en ${fmtSec(videoTime?.currentTime)}s. Para ver CUALQUIER frame del vídeo usa SIEMPRE [VISION_FRAME]segundos[/VISION_FRAME] (ej. [VISION_FRAME]120[/VISION_FRAME] para el minuto 2, o [VISION_FRAME]${fmtSec(videoTime?.currentTime)}[/VISION_FRAME] para el frame actual). Admite un segundo decimal y una pregunta opcional: [VISION_FRAME]12.5 | tu pregunta[/VISION_FRAME]. El sistema capturará ese frame y el modelo de visión lo describirá. [VISION] (sin _FRAME) en el editor de vídeo sólo ve el frame ACTUAL de la previsualización: úsalo sólo si quieres "lo que se ve ahora". NO digas que no tienes acceso al vídeo: pídelo con [VISION_FRAME]. No inventes lo que no ves.`
      : '';
    const editorContextHint = aiBridge?.getContextHint?.() ?? null;
    const systemContext = [systemPrompt ? `Instrucciones del usuario (prompt del sistema):\n${systemPrompt}` : null, editorSystemContext, editorContextHint, delegationMode ? VISION_TOOL_PROMPT + framePrompt : null]
      .filter(Boolean)
      .join('\n\n') || undefined;
    const visionSystemPrompt =
      [systemPrompt ? `Instrucciones del usuario (prompt del sistema):\n${systemPrompt}` : null,
       'Eres un modelo de visión integrado en Zeus Media Studio. DEBES responder SIEMPRE en español, por muy concreto que sea lo que se te pregunte. Describe lo que ves en la imagen/frame de forma concisa y factual (objetos, personas, texto, colores, composición, acción). Si la imagen está vacía, negra o no se ve nada, dilo así en español: "No se aprecia contenido visible en este frame". No uses inglés bajo ningún concepto.']
      .filter(Boolean)
      .join('\n\n');

    const chatTextTurn = async (history: ApiChatMessage[], newMsg: ApiChatMessage): Promise<string> => {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'text',
          provider,
          model: modelId,
          modelRecordId: selectedModel.id,
          history,
          newMessage: newMsg,
          conversationId: conversationId ?? undefined,
          systemContext,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Error al enviar');
      return data.text || '';
    };

    const chatVisionTurn = async (question: string, images: string[] | null): Promise<string> => {
      if (!images || images.length === 0) return t('chat.noImagesAvailable');
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'vision',
          visionModel: visionModelRef,
          newMessage: { role: 'user', content: question },
          images,
          systemContext: visionSystemPrompt,
          conversationId: conversationId ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t('chat.errVisionModel'));
      return data.text || '';
    };

    let assistantText = '';
    let resultConversationId: string | undefined = conversationId ?? undefined;

    try {
      if (delegationMode) {
        // Bucle cliente: el modelo de texto delega al de visión con bloques [VISION] / [VISION_FRAME].
        const running: ApiChatMessage[] = [
          ...messages.map((msg) => ({ role: msg.role, content: msg.content })),
          newMessageForApi,
        ];
        let lastPartial = '';
        for (let round = 0; round < MAX_VISION_ROUNDS; round++) {
          const partial = await chatTextTurn(running.slice(0, -1), running[running.length - 1]);
          lastPartial = partial;
          const blocks = parseVisionBlocks(partial);
          if (blocks.length === 0) break;

          running.push({ role: 'assistant', content: partial });
          const answers: string[] = [];
          for (const b of blocks) {
            try {
              if (b.type === 'frame') {
                if (!hasFrameCapture) {
                  answers.push(`Pregunta (frame ${b.timestamp}s): ${b.question}\nRespuesta: La captura de frames no está disponible (no estás en el editor de vídeo).`);
                  continue;
                }
                const frame = await aiBridge!.captureVideoFrameAt!(b.timestamp);
                if (!frame) {
                  answers.push(`Pregunta (frame ${b.timestamp}s): ${b.question}\nRespuesta: No se pudo capturar el frame en ${b.timestamp}s del vídeo.`);
                  continue;
                }
                const ans = await chatVisionTurn(b.question, [frame]);
                answers.push(`Pregunta (frame ${b.timestamp}s): ${b.question}\nRespuesta: ${ans}`);
              } else {
                // [VISION]: usa las imágenes actuales del editor. En el editor de vídeo
                // documentImages son las diapositivas (no frames del vídeo); si no hay,
                // capturamos el frame ACTUAL de la previsualización para que [VISION]
                // también funcione sobre el vídeo.
                let imgs: string[] | null = Array.isArray(documentImages) ? documentImages : null;
                if ((!imgs || imgs.length === 0) && hasFrameCapture && videoTime) {
                  const nowFrame = await aiBridge!.captureVideoFrameAt!(videoTime.currentTime);
                  imgs = nowFrame ? [nowFrame] : null;
                }
                const ans = await chatVisionTurn(b.question, imgs);
                answers.push(`Pregunta: ${b.question}\nRespuesta: ${ans}`);
              }
            } catch (blockErr) {
              answers.push(
                `Pregunta: ${'question' in b ? b.question : ''}\nRespuesta: (Error al consultar el modelo de visión: ${
                  blockErr instanceof Error ? blockErr.message : String(blockErr)
                })`
              );
            }
          }
          running.push({
            role: 'user',
            content:
              `[Respuesta del modelo de visión]\n\n${answers.join('\n\n')}\n\nAhora redacta TU respuesta final al usuario EN ESPAÑOL y con tus propias palabras, usando esta información. NO copies ni traduzcas literalmente el texto del modelo de visión: sintetiza una respuesta natural y útil para el usuario. No incluyas bloques [VISION] ni [VISION_FRAME] en tu respuesta final.`,
          });
        }
        assistantText = stripVisionBlocks(lastPartial) || 'Sin respuesta';
      } else {
        // Modo simple: un solo modelo (con adjunto directo de imágenes si las hay).
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider,
            model: modelId,
            modelRecordId: selectedModel.id,
            history: messages.map((msg) => ({ role: msg.role, content: msg.content })),
            newMessage: newMessageForApi,
            conversationId: conversationId ?? undefined,
            images: hasImages ? documentImages : undefined,
            systemContext,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Error al enviar');
        assistantText = data.text || 'Sin respuesta';
        if (data.conversationId) resultConversationId = data.conversationId;
      }

      // ── Bucle de realimentación de acciones [ZEUS_ACTION] ──
      // El modelo emite acciones; las ejecutamos y le DEVOLVEMOS los resultados
      // (getEditState → ids reales; errores → puede corregir y reintentar). Sin este
      // bucle, el modelo no ve el resultado de getEditState ni los errores, e inventa
      // ids a partir del nombre del archivo. Iteramos hasta que no emita más acciones.
      if (aiBridge?.hasActionExecutor) {
        const actionRunning: ApiChatMessage[] = [
          ...messages.map((msg) => ({ role: msg.role, content: msg.content })),
          newMessageForApi,
          { role: 'assistant', content: assistantText },
        ];
        const ACTION_MAX_ITERS = 6;
        for (let iter = 0; iter < ACTION_MAX_ITERS; iter++) {
          const actionPattern = /\[ZEUS_ACTION\]([\s\S]*?)\[\/ZEUS_ACTION\]/g;
          const results: { action: string; params: any; result: any }[] = [];
          let match;
          while ((match = actionPattern.exec(assistantText)) !== null) {
            try {
              const { action, params } = JSON.parse(match[1].trim());
              const result = await aiBridge.executeAction(action, params || {});
              results.push({ action, params, result });
              console.log(`[Zeus AI] ✅ ${action}:`, result);
            } catch (actionErr) {
              results.push({ action: '(error)', params: null, result: { ok: false, error: actionErr instanceof Error ? actionErr.message : String(actionErr) } });
              console.warn('[Zeus AI] Error ejecutando acción:', actionErr);
            }
          }
          if (results.length === 0) break; // respuesta final sin más acciones
          // Devolver los resultados al modelo para que actúe sobre ellos.
          const feedback =
            `[RESULTADOS DE TUS ACCIONES ANTERIORES]\n` +
            results.map((r) => JSON.stringify({ action: r.action, params: r.params, result: r.result })).join('\n') +
            `\n\nAhora continúa. Si pediste getEditState, usa los ids REALES del resultado (campo "id" de cada clip, formato "clip-<número>") para la siguiente acción; NO los inventes. Si una acción devolvió ok:false, corrige el problema (ej. usa el id correcto) y reintenta con un nuevo bloque [ZEUS_ACTION]. Si ya has terminado todo lo que pediste, responde al usuario en español de forma natural y SIN más bloques [ZEUS_ACTION].`;
          actionRunning.push({ role: 'user', content: feedback });
          const next = await chatTextTurn(actionRunning.slice(0, -1), actionRunning[actionRunning.length - 1]);
          assistantText = stripVisionBlocks(next) || next;
          actionRunning.push({ role: 'assistant', content: next });
        }
      }

      // Persistir (modo delegación: los turnos mode:'text' no persisten en servidor;
      // aquí persistimos el mensaje del usuario + la respuesta final, ya tras el bucle).
      if (delegationMode) {
        try {
          const pRes = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'persist',
              provider,
              model: modelId,
              modelRecordId: selectedModel.id,
              newMessage: newMessageForApi,
              finalText: assistantText,
              conversationId: conversationId ?? undefined,
            }),
          });
          const pData = await pRes.json();
          if (pRes.ok && pData.conversationId) resultConversationId = pData.conversationId;
        } catch (persistErr) {
          console.warn('[Zeus AI] No se pudo persistir la conversación:', persistErr);
        }
      }

      const assistantMessage = createChatMessage('assistant', assistantText);
      setMessages((m) => [...m, assistantMessage]);
      if (autoPlayResponses && assistantText.trim() && typeof window !== 'undefined' && window.speechSynthesis) {
        stopSpeaking();
        const utterance = new SpeechSynthesisUtterance(prepareTtsText(assistantText));
        utterance.lang = 'es-ES';
        utterance.rate = 0.95;
        if (voiceRef.current) utterance.voice = voiceRef.current;
        speechSynthRef.current = utterance;
        utterance.onend = () => setSpeakingIndex(null);
        utterance.onerror = () => setSpeakingIndex(null);
        window.speechSynthesis.speak(utterance);
        setSpeakingIndex(messages.length);
      }
      if (aiBridge?.allowAIToWriteToEditor) aiBridge.writeToEditor(assistantText);
      if (resultConversationId) {
        setConversationId(resultConversationId);
        triggerRefreshConversations();
      }
    } catch (e) {
      let errorContent = e instanceof Error ? e.message : t('chat.connError');
      if (typeof errorContent === 'string' && errorContent.includes(t('chat.notHere'))) {
        setSelectedModel(null);
        errorContent += ' ' + t('chat.selectOther');
      }
      setMessages((m) => [...m, createChatMessage('assistant', errorContent)]);
      if (autoPlayResponses && errorContent.trim() && typeof window !== 'undefined' && window.speechSynthesis) {
        stopSpeaking();
        const utterance = new SpeechSynthesisUtterance(prepareTtsText(errorContent));
        utterance.lang = 'es-ES';
        utterance.rate = 0.95;
        if (voiceRef.current) utterance.voice = voiceRef.current;
        speechSynthRef.current = utterance;
        utterance.onend = () => setSpeakingIndex(null);
        utterance.onerror = () => setSpeakingIndex(null);
        window.speechSynthesis.speak(utterance);
        setSpeakingIndex(messages.length);
      }
      if (aiBridge?.allowAIToWriteToEditor) aiBridge.writeToEditor(errorContent);
    } finally {
      setLoading(false);
    }
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const stopSpeaking = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeakingIndex(null);
  };

  const prepareTtsText = (text: string) => {
    if (!text) return '';
    // Quitar bloques internos del sistema (visiones y acciones) para no leerlos en voz alta.
    const cleaned = text
      .replace(/\[VISION\][\s\S]*?\[\/VISION\]/gi, ' ')
      .replace(/\[VISION_FRAME\][\s\S]*?\[\/VISION_FRAME\]/gi, ' ')
      .replace(/\[ZEUS_ACTION\][\s\S]*?\[\/ZEUS_ACTION\]/gi, ' ')
      .replace(/\[RESULTADOS DE TUS ACCIONES ANTERIORES\][\s\S]*?(?=\n\nAhora continúa|$)/gi, ' ');
    return cleanTextForTTS(cleaned);
  };

  const speakMessage = (index: number, text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const plainText = prepareTtsText(text);
    if (!plainText) return;
    if (speakingIndex === index) {
      stopSpeaking();
      return;
    }
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(plainText);
    utterance.lang = 'es-ES';
    utterance.rate = 0.95;
    if (voiceRef.current) utterance.voice = voiceRef.current;
    speechSynthRef.current = utterance;
    utterance.onend = () => setSpeakingIndex(null);
    utterance.onerror = () => setSpeakingIndex(null);
    window.speechSynthesis.speak(utterance);
    setSpeakingIndex(index);
  };

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    };
  }, []);

  const handleClose = () => {
    stopSpeaking();
    setOpen(false);
  };

  const isHiddenPage = pathname === '/auth' || pathname === '/terms' || pathname === '/privacy';
  if (isHiddenPage) return null;

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110]"
            onClick={handleClose}
            aria-hidden
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed z-[120] w-[min(480px,calc(100vw-3rem))] rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl flex flex-col overflow-hidden"
            style={{
              maxHeight: 'min(88vh,860px)',
              right: position.right,
              bottom: position.bottom + 72,
            }}
          >
            <style>{`
              .chat-scrollbar::-webkit-scrollbar { width: 5px; }
              .chat-scrollbar::-webkit-scrollbar-track { background: transparent; }
              .chat-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
              .chat-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
            `}</style>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800/80">
              <span className="font-semibold text-white flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-green-400" />
                Chat
              </span>
               <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowHistoryPanel((v) => !v)}
                  className={`p-2 rounded-lg transition-colors ${
                    showHistoryPanel ? 'bg-blue-500/30 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.35)]' : 'text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                  title="Historial de chat"
                  aria-label="Abrir historial"
                >
                  <History className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAutoPlayResponses((v) => {
                      if (v) stopSpeaking();
                      return !v;
                    });
                  }}
                  className={`p-2 rounded-lg transition-colors ${
                    autoPlayResponses
                      ? 'bg-green-500/30 text-green-400 shadow-[0_0_10px_rgba(74,222,128,0.35)]'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                  title={autoPlayResponses ? t('chat.disableAutoRead') : t('chat.enableAutoReadDesc')}
                  aria-label={autoPlayResponses ? t('chat.disableAutoRead') : t('chat.enableAutoRead')}
                >
                  {autoPlayResponses ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                  aria-label="Cerrar chat"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {selectedModel ? (
              <p className="px-4 py-1.5 text-xs text-gray-500 border-b border-gray-800">
                Modelo: {selectedModel.nombre_modelo || selectedModel.id}
              </p>
            ) : (
              <p className="px-4 py-1.5 text-xs text-amber-500/90 border-b border-gray-800">
                Selecciona un modelo en la barra para usar la IA.
              </p>
            )}

            {aiBridge?.allowVision && (
              <div className="px-4 py-1.5 text-xs text-gray-400 border-b border-gray-800 flex items-center gap-2">
                <span className="shrink-0 text-blue-400/90">{t('chat.visionModelLabel')}</span>
                {visionModels.length > 0 ? (
                  <select
                    value={selectedVisionModel?.id ?? ''}
                    onChange={(e) => {
                      const m = visionModels.find((v) => v.id === e.target.value);
                      if (m) setSelectedVisionModel({ id: m.id, nombre_modelo: m.nombre_modelo ?? m.name, proveedor: m.proveedor });
                    }}
                    className="bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-0.5 outline-none border border-gray-700 max-w-[60%] truncate"
                  >
                    {visionModels.map((v) => (
                      <option key={v.id} value={v.id} className="bg-gray-900">
                        {v.nombre_modelo || v.name || v.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-amber-500/90">{t('chat.noVisionModels')}</span>
                )}
              </div>
            )}

            {hasContextAccess && aiBridge?.getDocumentContent() && (
              <p className="px-4 py-1.5 text-xs text-emerald-500/90 border-b border-gray-800">
                El modelo tiene acceso al contenido del documento abierto.
              </p>
            )}
            {aiBridge?.allowVision && aiBridge?.getDocumentImages?.() && aiBridge.getDocumentImages()!.length > 0 && (
              <p className="px-4 py-1.5 text-xs text-blue-400/90 border-b border-gray-800">
                {selectedVisionModel
                  ? `El modelo de visión puede ver ${aiBridge.getDocumentImages()!.length} imagen(es); el modelo de texto le consultará con bloques [VISION].`
                  : `El modelo puede ver ${aiBridge.getDocumentImages()!.length} imagen(es) del editor.`}
              </p>
            )}

            {aiBridge && (
              <div className="flex items-stretch gap-2 px-3 py-2 border-b border-gray-800 bg-gray-800/30">
                <Label htmlFor="ai-write-editor" className="flex flex-1 flex-col items-center justify-center gap-1.5 cursor-pointer rounded-md px-1 py-1 hover:bg-gray-700/30 transition-colors">
                  <span className="text-[10px] leading-tight text-center text-gray-400">{t('chat.writePermission')}</span>
                  <Switch
                    id="ai-write-editor"
                    checked={aiBridge.allowAIToWriteToEditor}
                    onCheckedChange={aiBridge.setAllowAIToWriteToEditor}
                    className="h-4 w-8 shrink-0 [&>span]:h-3 [&>span]:w-3 [&[data-state=checked]>span]:translate-x-4"
                  />
                </Label>
                <Label htmlFor="ai-vision" className="flex flex-1 flex-col items-center justify-center gap-1.5 cursor-pointer rounded-md px-1 py-1 hover:bg-gray-700/30 transition-colors">
                  <span className="text-[10px] leading-tight text-center text-gray-400">{t('chat.visionPermission')}</span>
                  <Switch
                    id="ai-vision"
                    checked={aiBridge.allowVision}
                    onCheckedChange={aiBridge.setAllowVision}
                    className="h-4 w-8 shrink-0 [&>span]:h-3 [&>span]:w-3 [&[data-state=checked]>span]:translate-x-4"
                  />
                </Label>
                <Label htmlFor="ai-system-prompt" className="flex flex-1 flex-col items-center justify-center gap-1.5 cursor-pointer rounded-md px-1 py-1 hover:bg-gray-700/30 transition-colors">
                  <span className="text-[10px] leading-tight text-center text-gray-400">{t('chat.createPrompt')}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {hasSystemPrompt && (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); openSystemPromptModal(); }}
                        title={t('chat.editSystemPrompt')}
                        className="text-gray-400 hover:text-amber-400 transition-colors p-0.5 rounded hover:bg-gray-700/50"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    <Switch
                      id="ai-system-prompt"
                      checked={hasSystemPrompt}
                      onCheckedChange={toggleSystemPrompt}
                      className="h-4 w-8 [&>span]:h-3 [&>span]:w-3 [&[data-state=checked]>span]:translate-x-4"
                    />
                  </div>
                </Label>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] chat-scrollbar">
              {messages.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-8">
                  {t('chat.startMessage')}
                </p>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm font-semibold flex flex-col gap-1 ${
                      msg.role === 'user'
                        ? 'bg-green-600 text-gray-700 rounded-br-md'
                        : 'bg-gray-500 text-gray-700 rounded-bl-md'
                    }`}
                  >
                    <span className="block">{msg.content}</span>
                    {msg.role === 'assistant' && msg.content.trim() && (
                      <div className="self-end flex items-center gap-1">
                        <button
                          type="button"
                          onClick={async () => {
                            const ea = (window as any).electronAPI;
                            let copied = false;
                            if (ea?.clipboardWriteText) {
                              try {
                                const res = await ea.clipboardWriteText(msg.content);
                                if (res?.ok) copied = true;
                              } catch { /* fallback abajo */ }
                            }
                            if (!copied) {
                              try {
                                await navigator.clipboard?.writeText(msg.content);
                                copied = true;
                              } catch { /* ignore */ }
                            }
                            if (copied) {
                              setCopiedIndex(i);
                              setTimeout(() => setCopiedIndex(null), 1500);
                            }
                          }}
                          className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-600/70 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
                          title="Copiar contenido"
                          aria-label="Copiar contenido"
                        >
                          {copiedIndex === i ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => speakMessage(i, msg.content)}
                          className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                            speakingIndex === i
                              ? 'bg-green-500/50 text-green-200'
                              : 'bg-gray-600/70 text-gray-300 hover:bg-gray-600 hover:text-white'
                          }`}
                          title={speakingIndex === i ? 'Detener lectura' : 'Escuchar por altavoz'}
                          aria-label={speakingIndex === i ? 'Detener lectura' : 'Escuchar mensaje'}
                        >
                          {speakingIndex === i ? (
                            <VolumeX className="w-4 h-4" />
                          ) : (
                            <Volume2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md px-4 py-2.5 bg-gray-500 text-gray-700 text-sm font-semibold">
                    <span className="animate-pulse">Escribiendo...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="p-3 border-t border-gray-700 bg-gray-800/50"
            >
              {attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {attachedFiles.map((file, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-700 text-gray-200 text-xs"
                    >
                      <span className="truncate max-w-[120px]" title={file.name}>{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeAttachedFile(i)}
                        className="shrink-0 p-0.5 rounded hover:bg-gray-600 text-gray-400 hover:text-white"
                        aria-label="Quitar archivo"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx,.txt,.md"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files?.length) setAttachedFiles((prev) => [...prev, ...Array.from(files)]);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  className="p-2.5 rounded-xl text-gray-400 hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
                  title="Adjuntar archivos"
                  aria-label="Adjuntar archivos"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !loading) {
                      e.preventDefault();
                      (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
                    }
                  }}
                  placeholder={t('chat.msgPlaceholder')}
                  rows={1}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 text-sm outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-y min-h-[44px] max-h-[240px] overflow-y-auto leading-6"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || (!input.trim() && attachedFiles.length === 0)}
                  className="p-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white transition-colors"
                  aria-label="Enviar"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed z-[110] flex items-center justify-center w-14 h-14 rounded-full bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-500/30 hover:shadow-green-500/50 transition-shadow cursor-grab active:cursor-grabbing touch-none"
        style={{ right: position.right, bottom: position.bottom }}
        aria-label={open ? 'Cerrar chat' : 'Abrir chat'}
        drag
        dragMomentum={false}
        dragElastic={0}
        onDragEnd={(_, info) => {
          setPosition((prev) => ({
            right: Math.max(0, Math.min(window.innerWidth - 56, prev.right - info.delta.x)),
            bottom: Math.max(0, Math.min(window.innerHeight - 56, prev.bottom - info.delta.y)),
          }));
        }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <MessageCircle className="w-7 h-7 pointer-events-none" />
      </motion.button>

      <ChatHistorySidebar open={showHistoryPanel} onClose={() => setShowHistoryPanel(false)} showBackdrop={false} />
      <Modal
        isOpen={systemPromptModalOpen}
        onClose={() => setSystemPromptModalOpen(false)}
        title={t('chat.systemPromptTitle')}
        description={t('chat.contextPlaceholder')}
        size="md"
      >
        <div className="flex flex-col gap-4">
          <textarea
            value={systemPromptDraft}
            onChange={(e) => setSystemPromptDraft(e.target.value)}
            placeholder={t('chat.contextPlaceholder2')}
            rows={8}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-amber-500 resize-y min-h-[160px]"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSystemPromptModalOpen(false)}
              className="px-4 py-2 rounded-lg text-sm text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors"
            >
              {t('chat.cancel')}
            </button>
            <button
              type="button"
              onClick={saveSystemPrompt}
              className="px-4 py-2 rounded-lg text-sm text-gray-900 bg-amber-400 hover:bg-amber-300 font-semibold transition-colors"
            >
              {t('chat.save')}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
