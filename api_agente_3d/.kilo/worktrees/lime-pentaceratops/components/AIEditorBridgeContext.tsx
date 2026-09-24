'use client';

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';

type WriteToEditorFn = (text: string) => void;
type GetDocumentContentFn = () => string | null;
type GetDocumentImagesFn = () => string[] | null;
type ExecuteActionFn = (action: string, params: Record<string, unknown>) => Promise<unknown>;
type CaptureVideoFrameAtFn = (timestampSeconds: number) => Promise<string | null>;
type GetVideoTimeFn = () => { currentTime: number; duration: number } | null;
type GetContextHintFn = () => string | null;
type GetSystemPromptFn = () => string | null;

type AIEditorBridgeValue = {
  /** Si está activado, las respuestas de la IA se escriben en el editor de texto registrado */
  allowAIToWriteToEditor: boolean;
  setAllowAIToWriteToEditor: (v: boolean) => void;
  /** Si está activado, el modelo puede ver imágenes (diapositivas, etc.) además del texto */
  allowVision: boolean;
  setAllowVision: (v: boolean) => void;
  /** Registrar el editor actual. Devuelve función para anular el registro al desmontar */
  registerEditor: (write: WriteToEditorFn) => () => void;
  /** Llamar desde el chat cuando llega una respuesta y el interruptor está activado */
  writeToEditor: (text: string) => void;
  /** Registrar un getter del contenido del documento abierto (para que el modelo tenga contexto) */
  registerDocumentContent: (getter: GetDocumentContentFn) => () => void;
  /** Obtener el contenido actual del documento si hay un editor con archivo abierto */
  getDocumentContent: () => string | null;
  /** Registrar un getter de imágenes del documento (diapositivas, frames, etc.) */
  registerDocumentImages: (getter: GetDocumentImagesFn) => () => void;
  /** Obtener imágenes actuales si el editor las proporciona (data URLs base64) */
  getDocumentImages: () => string[] | null;
  /** Registrar un ejecutor de acciones del editor (para que la IA controle la API) */
  registerActionExecutor: (fn: ExecuteActionFn) => () => void;
  /** Ejecutar una acción del editor vía SDK API */
  executeAction: (action: string, params: Record<string, unknown>) => Promise<unknown>;
  /** Si hay un executor registrado (editor activo y con API conectada) */
  hasActionExecutor: boolean;
  /** Registrar capturador de frame de vídeo a un timestamp (solo VideoEditor). */
  registerCaptureVideoFrameAt: (fn: CaptureVideoFrameAtFn) => () => void;
  /** Captura un frame del vídeo en el timestamp indicado -> data URL, o null si no hay vídeo. */
  captureVideoFrameAt: (timestampSeconds: number) => Promise<string | null>;
  /** Si hay capturador de frames registrado (editor de vídeo activo). */
  hasCaptureVideoFrameAt: boolean;
  /** Registrar un getter del tiempo de vídeo actual (currentTime + duration). Solo VideoEditor. */
  registerVideoTimeGetter: (fn: GetVideoTimeFn) => () => void;
  /** Devuelve { currentTime, duration } del vídeo del editor, o null si no hay. */
  getVideoTime: () => { currentTime: number; duration: number } | null;
  /** Registrar una pista de contexto específica del editor activo (ej. el editor
   *  HTML indica que el modelo debe generar CSS inline editable). El chat flotante
   *  la inyecta en el systemContext del modelo de texto. */
  registerContextHint: (fn: GetContextHintFn) => () => void;
  /** Devuelve la pista de contexto del editor activo, o null si no la define. */
  getContextHint: () => string | null;
  /**
   * Registrar un generador de system prompt específico del editor activo.
   * El chat flotante lo usa en lugar del system prompt genérico cuando hay
   * un executor de acciones registrado, de modo que cada editor (vídeo,
   * imagen, 3D, texto…) documenta sus propias acciones [ZEUS_ACTION]. */
  registerEditorSystemPrompt: (fn: GetSystemPromptFn) => () => void;
  /** Devuelve el system prompt del editor activo, o null si no lo define. */
  getEditorSystemPrompt: () => string | null;
};

const AIEditorBridgeContext = createContext<AIEditorBridgeValue | null>(null);

export function AIEditorBridgeProvider({ children }: { children: ReactNode }) {
  const [allowAIToWriteToEditor, setAllowAIToWriteToEditor] = useState(false);
  const [allowVision, setAllowVision] = useState(false);
  const [hasActionExecutor, setHasActionExecutor] = useState(false);
  const [hasCaptureVideoFrameAt, setHasCaptureVideoFrameAt] = useState(false);
  const writerRef = useRef<WriteToEditorFn | null>(null);
  const documentContentGetterRef = useRef<GetDocumentContentFn | null>(null);
  const documentImagesGetterRef = useRef<GetDocumentImagesFn | null>(null);
  const actionExecutorRef = useRef<ExecuteActionFn | null>(null);
  const captureVideoFrameAtRef = useRef<CaptureVideoFrameAtFn | null>(null);
  const videoTimeGetterRef = useRef<GetVideoTimeFn | null>(null);
  const contextHintRef = useRef<GetContextHintFn | null>(null);
  const systemPromptGetterRef = useRef<GetSystemPromptFn | null>(null);

  const registerEditor = useCallback((write: WriteToEditorFn) => {
    writerRef.current = write;
    return () => {
      writerRef.current = null;
    };
  }, []);

  const registerDocumentContent = useCallback((getter: GetDocumentContentFn) => {
    documentContentGetterRef.current = getter;
    return () => {
      documentContentGetterRef.current = null;
    };
  }, []);

  const registerDocumentImages = useCallback((getter: GetDocumentImagesFn) => {
    documentImagesGetterRef.current = getter;
    return () => {
      documentImagesGetterRef.current = null;
    };
  }, []);

  const getDocumentContent = useCallback(() => {
    if (!documentContentGetterRef.current) return null;
    try {
      return documentContentGetterRef.current();
    } catch (e) {
      console.warn('[AIEditorBridge] Error al leer contenido del documento:', e);
      return null;
    }
  }, []);

  const getDocumentImages = useCallback(() => {
    if (!documentImagesGetterRef.current) return null;
    try {
      const imgs = documentImagesGetterRef.current();
      return Array.isArray(imgs) && imgs.length > 0 ? imgs.filter((u): u is string => typeof u === 'string' && u.startsWith('data:')) : null;
    } catch (e) {
      console.warn('[AIEditorBridge] Error al leer imágenes del documento:', e);
      return null;
    }
  }, []);

  const writeToEditor = useCallback((text: string) => {
    if (writerRef.current && text.trim()) {
      try {
        writerRef.current(text.trim());
      } catch (e) {
        console.warn('[AIEditorBridge] Error al escribir en el editor:', e);
      }
    }
  }, []);

  const registerActionExecutor = useCallback((fn: ExecuteActionFn) => {
    actionExecutorRef.current = fn;
    setHasActionExecutor(true);
    return () => {
      actionExecutorRef.current = null;
      setHasActionExecutor(false);
    };
  }, []);

  const executeAction = useCallback(async (action: string, params: Record<string, unknown>) => {
    if (!actionExecutorRef.current) throw new Error('No hay editor activo con API conectada');
    try {
      return await actionExecutorRef.current(action, params);
    } catch (e) {
      console.warn('[AIEditorBridge] Error ejecutando acción:', action, e);
      throw e;
    }
  }, []);

  const registerCaptureVideoFrameAt = useCallback((fn: CaptureVideoFrameAtFn) => {
    captureVideoFrameAtRef.current = fn;
    setHasCaptureVideoFrameAt(true);
    return () => {
      captureVideoFrameAtRef.current = null;
      setHasCaptureVideoFrameAt(false);
    };
  }, []);

  const captureVideoFrameAt = useCallback(async (timestampSeconds: number) => {
    if (!captureVideoFrameAtRef.current) return null;
    try {
      return await captureVideoFrameAtRef.current(timestampSeconds);
    } catch (e) {
      console.warn('[AIEditorBridge] Error al capturar frame de vídeo:', e);
      return null;
    }
  }, []);

  const registerVideoTimeGetter = useCallback((fn: GetVideoTimeFn) => {
    videoTimeGetterRef.current = fn;
    return () => {
      videoTimeGetterRef.current = null;
    };
  }, []);

  const getVideoTime = useCallback((): { currentTime: number; duration: number } | null => {
    if (!videoTimeGetterRef.current) return null;
    try {
      return videoTimeGetterRef.current();
    } catch (e) {
      console.warn('[AIEditorBridge] Error al leer el tiempo del vídeo:', e);
      return null;
    }
  }, []);

  const registerContextHint = useCallback((fn: GetContextHintFn) => {
    contextHintRef.current = fn;
    return () => {
      contextHintRef.current = null;
    };
  }, []);

  const getContextHint = useCallback((): string | null => {
    if (!contextHintRef.current) return null;
    try {
      return contextHintRef.current();
    } catch (e) {
      console.warn('[AIEditorBridge] Error al leer la pista de contexto del editor:', e);
      return null;
    }
  }, []);

  const registerEditorSystemPrompt = useCallback((fn: GetSystemPromptFn) => {
    systemPromptGetterRef.current = fn;
    return () => {
      systemPromptGetterRef.current = null;
    };
  }, []);

  const getEditorSystemPrompt = useCallback((): string | null => {
    if (!systemPromptGetterRef.current) return null;
    try {
      return systemPromptGetterRef.current();
    } catch (e) {
      console.warn('[AIEditorBridge] Error al leer el system prompt del editor:', e);
      return null;
    }
  }, []);

  const value: AIEditorBridgeValue = {
    allowAIToWriteToEditor,
    setAllowAIToWriteToEditor,
    allowVision,
    setAllowVision,
    registerEditor,
    writeToEditor,
    registerDocumentContent,
    getDocumentContent,
    registerDocumentImages,
    getDocumentImages,
    registerActionExecutor,
    executeAction,
    hasActionExecutor,
    registerCaptureVideoFrameAt,
    captureVideoFrameAt,
    hasCaptureVideoFrameAt,
    registerVideoTimeGetter,
    getVideoTime,
    registerContextHint,
    getContextHint,
    registerEditorSystemPrompt,
    getEditorSystemPrompt,
  };

  return (
    <AIEditorBridgeContext.Provider value={value}>
      {children}
    </AIEditorBridgeContext.Provider>
  );
}

export function useAIEditorBridge() {
  const ctx = useContext(AIEditorBridgeContext);
  if (!ctx) throw new Error('useAIEditorBridge debe usarse dentro de AIEditorBridgeProvider');
  return ctx;
}

export function useAIEditorBridgeOptional() {
  return useContext(AIEditorBridgeContext);
}
