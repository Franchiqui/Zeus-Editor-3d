'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, steps } from 'framer-motion';
import {
  Play,
  Pause,
  Settings,
  Server,
  Plus,
  Video,
  Save,
  Trash2,
  ChevronRight,
  Layers,
  Music,
  Type,
  Mic,
  Monitor,
  Sparkles,
  Wand2,
  RefreshCw,
  Camera,
  Copy,
  Zap,
  Edit3,
  File,
  FileVideo,
  ZoomIn,
  ZoomOut,
  StopCircle,
  Clock,
  Image,
  MousePointer,
  Film,
  RotateCcw,
  SkipBack,
  SkipForward,
  Scissors,
  Download,
  Upload,
  Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import Modal from '@/components/ui/modal-2';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useScreenRecorder } from '@/hooks/use-screen-recorder';
import * as Api from '@/components/api/ApiClient';
import { useStore } from '@/lib/store';
import { copyText } from '@/lib/clipboard';
import { useTutorialTitle } from '@/lib/tutorial-store';
import { useI18n } from '@/lib/i18n';
import type { Tutorial, TutorialStep, TutorialSettings } from '@/types/index-2';

// Helper: ensure image src is a valid data URI or URL
function normalizeImageSrc(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  if (src.startsWith('data:') || src.startsWith('http')) return src;
  // Raw base64 without prefix — add PNG data URI header
  return 'data:image/png;base64,' + src;
}

function hexToRgba(hex: string, alpha: number): string {
  const sanitized = hex.replace('#', '');
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexFromRgba(rgba: string): string {
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return '#000000';
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(parseInt(match[1]))}${toHex(parseInt(match[2]))}${toHex(parseInt(match[3]))}`;
}

export interface EditorTutorialsProps {
  isLocalProject?: boolean;
  projectName?: string;
  projectPath?: string;
  onSave?: () => void;
  onCancel?: () => void;
}

// Servicio auxiliar de la app objetivo (BD/API/servidor) que se arranca junto
// al preview. El comando se ejecuta en la carpeta del proyecto; admite el
// token {port} (sustituido por el puerto) y además se inyecta env.PORT.
export type TutorialService = {
  id: string;
  name: string;
  port: number;
  command: string;
  enabled: boolean;
};

// Defaults originales de Zeus (pre-rellenados como ejemplo editable).
const DEFAULT_TUTORIAL_SERVICES: TutorialService[] = [
  { id: 'srv-pb',     name: 'PocketBase',      port: 8091, command: 'pocket-base-zeus/pocket-base/pocketbase.exe serve --dir=pocket-base-zeus/pocket-base/pb_data --http=127.0.0.1:{port}', enabled: true },
  { id: 'srv-api',    name: 'API Express',      port: 8742, command: 'node api/server.js', enabled: true },
  { id: 'srv-rae',    name: 'API RAE',           port: 3011, command: 'npm run api', enabled: true },
  { id: 'srv-term',   name: 'Terminal server',   port: 0,    command: 'node terminal-server/dist/terminal-server.js', enabled: true },
  { id: 'srv-prev',   name: 'PreviewServer',     port: 8744, command: 'node serve/server.js', enabled: true },
  { id: 'srv-main',   name: 'API principal',     port: 0,    command: 'npm run api', enabled: true },
];

export default function ZeusEditorPage(_props: EditorTutorialsProps = {}) {
  const { t } = useI18n();
  const { toast } = useToast();

  // State
  const [tutorials, setTutorials] = useState<Tutorial[]>([]);
  const [currentTutorial, setCurrentTutorial] = useState<Tutorial | null>(null);
  const setSharedTutorialTitle = useTutorialTitle((s: { setTitle: any; }) => s.setTitle);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationMessage, setGenerationMessage] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'preview' | 'mp4'>('preview');
  const [playingMp4, setPlayingMp4] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<'server' | 'mp4'>('server');
  const [tutorialToDelete, setTutorialToDelete] = useState<Tutorial | null>(null);

  // Timeline Editor (re-exportar MP4 sobre la grabación raw)
  const [showTimelineEditor, setShowTimelineEditor] = useState(false);
  const [timelineTab, setTimelineTab] = useState<'timeline' | 'subtitles' | 'cards' | 'settings'>('timeline');
  const cardsExportRef = React.useRef<(() => void) | null>(null);
  const [cardsIsRebuilding, setCardsIsRebuilding] = useState(false);
  const [cardsProgress, setCardsProgress] = useState(0);
  const [cardsMessage, setCardsMessage] = useState('');
  // {t('tutorialEditor.exportMp4')} (rebuild) movido a la cabecera de pestañas del timeline.
  const [mp4ExportRebuilding, setMp4ExportRebuilding] = useState(false);
  const [mp4ExportProgress, setMp4ExportProgress] = useState(0);
  const [mp4ExportMessage, setMp4ExportMessage] = useState('');
  // Recorte de MP4 (trim) desde la pestaña t('tutorialEditor.timelineTab') en modo MP4.
  const [trimRebuilding, setTrimRebuilding] = useState(false);
  const [trimProgress, setTrimProgress] = useState(0);
  const [trimMessage, setTrimMessage] = useState('');
  
  // Shared edited steps state for timeline panels
  const [editedSteps, setEditedSteps] = useState<EditedStep[]>([]);

  // Initialize edited steps when tutorial changes
  useEffect(() => {
    if (currentTutorial) {
      const initial = buildEditedSteps(currentTutorial);
      setEditedSteps(initial.steps);
    }
  }, [currentTutorial?.id]);

  // Video adjustment settings
  const [videoBrightness, setVideoBrightness] = useState(1.0);
  const [videoContrast, setVideoContrast] = useState(1.0);
  const [videoIntensity, setVideoIntensity] = useState(1.0);
  const [videoTimeOffset, setVideoTimeOffset] = useState(0);
  // Si los ajustes (brillo/contraste/intensidad) se superponen sobre el reproductor
  // de MP4 al reproducir un vídeo YA creado. Por defecto OFF: el vídeo ya viene con
  // los ajustes horneados, así que se ve tal cual (realidad). ON = usar los sliders
  // como referencia visual de cómo quedaría el próximo render.
  const [applyAdjustsToPlayer, setApplyAdjustsToPlayer] = useState(false);
  const [ajustesId, setAjustesId] = useState<string | null>(null);

  // Generation State
  const [prompt, setPrompt] = useState('');
  const [manualSteps, setManualSteps] = useState('');
  // El modelo de IA ya no se selecciona aquí: usa el modelo seleccionado en el
  // selector global de la app (store). Véase `globalModel` más abajo.
  const globalModel = useStore(s => s.selectedModel);
  const selectedModel = globalModel?.id || '';
  const [appPath, setAppPath] = useState<string>('');
  const [stepsCount, setStepsCount] = useState<number>(9);
  const generationMode = 'desktop';

  // Recording Area Calibration
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [recordingArea, setRecordingArea] = useState<{ x: number; y: number; width: number; height: number }>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zeus-recording-area');
      if (saved) return JSON.parse(saved);
    }
    return { x: 100, y: 100, width: 800, height: 600 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [calibrationStep, setCalibrationStep] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zeus-calibration-step');
      if (saved) return parseInt(saved, 10) || 10;
    }
    return 10;
  });

  // Modals
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Tutorial Title State
  const [tutorialTitle, setTutorialTitle] = useState('');

  // Id del tutorial que se está editando dentro del modal "Configuración
  // del Tutorial". null = se va a CREAR un tutorial nuevo. Cuando el usuario
  // selecciona un tutorial existente en el desplegable del modal (o abre el
  // modal con un tutorial seleccionado en el editor), se cargan todos sus
  // datos y al aplicar se ACTUALIZA ese tutorial en vez de crear uno nuevo.
  const [settingsEditingId, setSettingsEditingId] = useState<string | null>(null);

  // Control point editing state
  const [editingPoint, setEditingPoint] = useState<{ id: string; name: string; x: number; y: number; pointerX?: number; pointerY?: number; moveMouse?: boolean; tutorialIds: string[]; clic?: boolean; screenId?: string | null; landmark?: boolean } | null>(null);
  const [selectedTutorialIds, setSelectedTutorialIds] = useState<string[]>([]);
  const [editPointX, setEditPointX] = useState(0);
  const [editPointY, setEditPointY] = useState(0);
  const [editPointerX, setEditPointerX] = useState(0);
  const [editPointerY, setEditPointerY] = useState(0);
  const [pointClic, setPointClic] = useState(true);
  const [pointMoveMouse, setPointMoveMouse] = useState(true);
  const [pointScreenId, setPointScreenId] = useState<string | null>(null);
  const [pointLandmark, setPointLandmark] = useState(false);
  // Pantalla activa del atlas (para asignar puntos nuevos y filtrar la lista).
  // Se declara aquí arriba porque el efecto de inicialización del modal la referencia.
  const [currentScreenId, setCurrentScreenId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zeus-current-screen');
      if (saved) return saved;
    }
    return null;
  });
  const [captureTestScreenshot, setCaptureTestScreenshot] = useState(true);
  const [pendingPoint, setPendingPoint] = useState<{ x: number; y: number } | null>(null);

  // Sincroniza el título del tutorial actual con el store compartido (lo muestra
  // el Navbar centrado en la barra de navegación).
  useEffect(() => {
    setSharedTutorialTitle(currentTutorial?.title ?? null);
  }, [currentTutorial?.title, setSharedTutorialTitle]);

  // Keep point name input and coordinate inputs in sync when editing
  useEffect(() => {
    const input = document.getElementById('zeus-point-name-input') as HTMLInputElement;
    if (input) {
      input.value = editingPoint?.name || '';
    }
    if (editingPoint) {
      setEditPointX(editingPoint.x);
      setEditPointY(editingPoint.y);
      setEditPointerX(editingPoint.pointerX ?? editingPoint.x);
      setEditPointerY(editingPoint.pointerY ?? editingPoint.y);
      setPointClic(editingPoint.clic ?? true);
      setPointMoveMouse(editingPoint.moveMouse ?? true);
      setPointScreenId(editingPoint.screenId ?? null);
      setPointLandmark(editingPoint.landmark ?? false);
    } else if (pendingPoint) {
      // Punto nuevo: ambos campos se rellenan con la misma coordenada capturada.
      setEditPointerX(pendingPoint.x);
      setEditPointerY(pendingPoint.y);
      setEditPointX(pendingPoint.x);
      setEditPointY(pendingPoint.y);
      setPointClic(true);
      setPointMoveMouse(true);
      // Por defecto, el punto nuevo pertenece a la pantalla actual (si hay).
      setPointScreenId(currentScreenId);
      setPointLandmark(false);
    } else {
      setPointClic(true);
      setPointMoveMouse(true);
      setPointScreenId(currentScreenId);
      setPointLandmark(false);
    }
  }, [editingPoint, pendingPoint, currentScreenId]);

  // Settings Form State
  const [tutorialSettings, setTutorialSettings] = useState<TutorialSettings>({
    resolution: '1080p',
    fps: 30,
    backgroundMusic: true,
    musicVolume: 0.3,
    voiceoverVolume: 0.8,
    subtitleEnabled: true,
    subtitleLanguage: 'es',
    subtitleFontSize: 18,
    subtitleTextColor: '#ffffff',
    subtitleBackgroundColor: 'rgba(0,0,0,0.8)',
    subtitleBackgroundOpacity: 0.8,
    subtitleVerticalOffset: 30,
    subtitleFontFamily: 'inherit',
    quality: 'high',
    outputFormat: 'mp4',
  });

  // Background music file selected in tutorial settings modal
  const [tutorialBackgroundMusic, setTutorialBackgroundMusic] = useState<File | null>(null);

  // Vista previa de voz (edge-tts) en el modal de configuración del tutorial.
  const [ttsPreviewLoading, setTtsPreviewLoading] = useState(false);
  const [ttsPreviewText, setTtsPreviewText] = useState('Hola, esta es una muestra de la voz en off del tutorial.');
  const ttsPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [tutorialMusicPreviewUrl, setTutorialMusicPreviewUrl] = useState<string | null>(null);
  const [isTutorialMusicPlaying, setIsTutorialMusicPlaying] = useState(false);

  // Vídeo base para un tutorial MANUAL. El usuario lo selecciona en el modal de
  // configuración; al aplicar, se sube y el backend le quita el audio y lo
  // fija como rawVideoPath para que {t('tutorialEditor.exportMp4')} lo use como base.
  const [tutorialRawVideo, setTutorialRawVideo] = useState<File | null>(null);
  const [tutorialRawVideoPreviewUrl, setTutorialRawVideoPreviewUrl] = useState<string | null>(null);
  const [tutorialRawVideoUploading, setTutorialRawVideoUploading] = useState(false);

  // ── Grabación manual (botón REC) ──
  // Reutiliza los endpoints /api/desktop/recording/start|stop del serve (mismo
  // gdigrab que el flujo automático) y, al detener, pasa el MP4 resultante al
  // modal "Configuración del Tutorial" como vídeo base (sin sonido).
  const [isRecordingManual, setIsRecordingManual] = useState(false);
  const [recordingElapsedSec, setRecordingElapsedSec] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const tutorialAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const [musicStartTime, setMusicStartTime] = useState(0);
  const [musicFadeInDuration, setMusicFadeInDuration] = useState(2);
  const [musicFadeOutDuration, setMusicFadeOutDuration] = useState(3);

  // Documentation State
  const [documentationList, setDocumentationList] = useState<any[]>([]);
  const [isDocumentationModalOpen, setIsDocumentationModalOpen] = useState(false);
  const [newDocumentation, setNewDocumentation] = useState({ title: '', description: '', file: null as File | null });

  // Export/Import de pestañas (transferir datos entre proyectos).
  // Pestañas exportables: timeline, subtitles, cards, settings.
  type TransferTabKey = 'timeline' | 'subtitles' | 'cards' | 'settings';
  const TRANSFER_TABS: { key: TransferTabKey; label: string; desc: string }[] = [
    { key: 'timeline', label: 'Timeline', desc: 'Secuencia de pasos (acción y duración)' },
    { key: 'subtitles', label: 'Subtítulos/Voz', desc: 'Subtítulos y voz en off de cada paso' },
    { key: 'cards', label: 'Tarjetas', desc: 'Tarjetas completas con todos sus campos' },
    { key: 'settings', label: 'Ajustes', desc: 'Brillo, contraste, intensidad, tiempos y volúmenes' },
  ];
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<'export' | 'import'>('export');
  const [transferSelected, setTransferSelected] = useState<Record<TransferTabKey, boolean>>({
    timeline: false, subtitles: false, cards: false, settings: false,
  });
  // Bundle importado del archivo (solo las pestañas presentes). Null hasta que se lee.
  const [transferImported, setTransferImported] = useState<any | null>(null);

  // Preview State
  const [showPreview, setShowPreview] = useState(false);
  const [servePort, setServePort] = useState<number>(3032);
  const [previewPort, setPreviewPort] = useState<number>(8741);
  // Cubre el iframe con un fondo oscuro mientras arranca la app del preview,
  // para evitar el destello blanco del visor antes de que renderice.
  const [previewBooting, setPreviewBooting] = useState(true);
  // t('tutorialEditor.servicesTab') auxiliares de la app objetivo (BD/API/servidor). Lista editable,
  // genérica (no atada a Zeus). Persiste en localStorage. Cada servicio indica
  // su puerto y el comando para arrancarlo (con token {port}).
  const [services, setServices] = useState<TutorialService[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zeus-tutorial-services');
      if (saved) {
        try { return JSON.parse(saved); } catch { /* falla -> defaults */ }
      }
    }
    return DEFAULT_TUTORIAL_SERVICES;
  });
  const [isServicesModalOpen, setIsServicesModalOpen] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('zeus-tutorial-services', JSON.stringify(services));
    }
  }, [services]);
  const [previewZoom, setPreviewZoom] = useState<number>(70);

  // Control Points for mouse automation (relative to recordingArea)
  const [generationTab, setGenerationTab] = useState<'generate' | 'coordinates' | 'subtitles' | 'maps'>('generate');
  const [controlPoints, setControlPoints] = useState<{ id: string; name: string; x: number; y: number; tutorialIds?: string[] }[]>([]);
  const [controlPointsReal, setControlPointsReal] = useState<Api.ControlPointReal[]>([]);
  // Atlas de pantallas: pantallas + transiciones + pantalla activa para captura.
  const [screens, setScreens] = useState<Api.Screen[]>([]);
  const [screenTransitions, setScreenTransitions] = useState<Api.ScreenTransition[]>([]);
  const [groupByScreen, setGroupByScreen] = useState(false);
  const [controlPointSearch, setControlPointSearch] = useState('');
  const [isCapturingPoint, setIsCapturingPoint] = useState(false);
  const [manualPointText, setManualPointText] = useState('');

  // Correcciones independientes para alinear área roja, ratón real y puntero virtual.
  // La fuente de verdad es la colección point_zero de PocketBase (cargada en el fetch
  // inicial); estos son solo los defaults hasta que se complete la carga. NO se usa
  // localStorage para los offsets.
  const [mouseOffsetX, setMouseOffsetX] = useState(115); // corrección empírica default del área roja
  const [mouseOffsetY, setMouseOffsetY] = useState(57);
  const [realMouseOffsetX, setRealMouseOffsetX] = useState(0);
  const [realMouseOffsetY, setRealMouseOffsetY] = useState(0);
  const [realMouseScaleX, setRealMouseScaleX] = useState(1);
  const [realMouseScaleY, setRealMouseScaleY] = useState(1);
  const [virtualMouseOffsetX, setVirtualMouseOffsetX] = useState(0);
  const [virtualMouseOffsetY, setVirtualMouseOffsetY] = useState(0);
  const [cursorImagePath, setCursorImagePath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zeus-cursor-image-path');
      if (saved) return saved;
    }
    return '';
  });
  const [cursorImageFileName, setCursorImageFileName] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('zeus-cursor-image-filename');
      if (saved) return saved;
    }
    return '';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Solo persistimos en localStorage el cursor (no pertenece a point_zero).
      // Los offsets de calibración se guardan únicamente en PocketBase.
      localStorage.setItem('zeus-cursor-image-path', cursorImagePath || '');
      localStorage.setItem('zeus-cursor-image-filename', cursorImageFileName || '');
    }
  }, [cursorImagePath, cursorImageFileName]);

  // Persistir la pantalla activa del atlas (para captura/agrupado) en localStorage.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (currentScreenId) localStorage.setItem('zeus-current-screen', currentScreenId);
      else localStorage.removeItem('zeus-current-screen');
    }
  }, [currentScreenId]);

  // Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackStepIndex, setPlaybackStepIndex] = useState<number | null>(null);
  const [playbackScreenshot, setPlaybackScreenshot] = useState<string | null>(null);
  const [isPlaybackLoading, setIsPlaybackLoading] = useState(false);
  const playbackTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Voice & Subtitle State
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [currentSubtitle, setCurrentSubtitle] = useState('');
  const [subtitlePreviewText, setSubtitlePreviewText] = useState('');
  const speechUtteranceRef = React.useRef<SpeechSynthesisUtterance | null>(null);

  // Background music during tutorial playback
  const tutorialPlaybackAudioRef = React.useRef<HTMLAudioElement | null>(null);

  // Layout constants (fixed sizes, no resize)
  const SIDEBAR_WIDTH = 380;
  const TIMELINE_HEIGHT = 180;

  // Point Zero record id cache
  const [pointZeroId, setPointZeroId] = useState<string | undefined>(undefined);

  // Mientras arranca la app del preview (cambio de puerto o se muestra el
  // visor), mostramos el overlay oscuro y lo mantenemos hasta que la app
  // renderice de verdad. Como el iframe es cross-origin (puertos distintos),
  // no podemos leer su DOM ni fiarnos solo de `onLoad` (el HTML carga antes de
  // que React pinte). Hacemos polling con un fetch no-cors al puerto del
  // preview: cuando el servidor responde, la app ya está cargando, y le damos
  // un margen extra de render antes de quitar el overlay. Así se evita el
  // destello blanco del visor.
  useEffect(() => {
    if (!showPreview) return;
    setPreviewBooting(true);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = Date.now();
    const RENDER_DELAY_MS = 2000; // margen para que React pinte tras responder
    const MAX_WAIT_MS = 30000;    // red de seguridad
    const check = async () => {
      if (cancelled) return;
      if (Date.now() - start > MAX_WAIT_MS) {
        setPreviewBooting(false);
        return;
      }
      try {
        // mode: 'no-cors' resuelve en cuanto el servidor responde (respuesta
        // opaca) y rechaza si aún no está levantado. Cross-origin seguro.
        await fetch(`http://localhost:${previewPort}/`, { mode: 'no-cors', cache: 'no-store' });
        // El servidor ya responde: margen extra para que la app renderice.
        timer = setTimeout(() => { if (!cancelled) setPreviewBooting(false); }, RENDER_DELAY_MS);
        return;
      } catch {
        // El servidor aún no responde (arrancando): reintentar.
        timer = setTimeout(check, 400);
      }
    };
    timer = setTimeout(check, 150);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [previewPort, showPreview]);

  // Initial Data Fetch
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const [tutorialsData, documentationData, controlPointsRealData, pointZeroData, ajustesData, screensData, transitionsData] = await Promise.all([
          Api.api_tutorials_list(),
          fetch('http://localhost:3001/api/documentation').then(r => r.json()),
          Api.api_control_points_real_list().catch(() => []),
          Api.api_point_zero_get().catch(() => undefined),
          Api.api_ajustes_get().catch(() => undefined),
          Api.api_screens_list().catch(() => []),
          Api.api_screen_transitions_list().catch(() => []),
        ]);
        setTutorials(tutorialsData || []);
        setDocumentationList(documentationData || []);
        setControlPointsReal(controlPointsRealData || []);
        setScreens(screensData || []);
        setScreenTransitions(transitionsData || []);
        // Precargar settings del primer tutorial seleccionado si viene de PocketBase
        if (tutorialsData?.[0]?.settings) {
          setTutorialSettings((prev: any) => ({ ...prev, ...tutorialsData[0].settings }));
        }
        if (pointZeroData?.id) {
          setPointZeroId(pointZeroData.id);
          if (typeof pointZeroData.zeus_mouse_offset_x === 'number') setMouseOffsetX(pointZeroData.zeus_mouse_offset_x);
          if (typeof pointZeroData.zeus_mouse_offset_y === 'number') setMouseOffsetY(pointZeroData.zeus_mouse_offset_y);
          if (typeof pointZeroData.zeus_real_mouse_offset_x === 'number') setRealMouseOffsetX(pointZeroData.zeus_real_mouse_offset_x);
          if (typeof pointZeroData.zeus_real_mouse_offset_y === 'number') setRealMouseOffsetY(pointZeroData.zeus_real_mouse_offset_y);
          if (typeof pointZeroData.real_mouse_scale_x === 'number') setRealMouseScaleX(pointZeroData.real_mouse_scale_x);
          if (typeof pointZeroData.real_mouse_scale_y === 'number') setRealMouseScaleY(pointZeroData.real_mouse_scale_y);
          if (typeof pointZeroData.zeus_virtual_mouse_offset_x === 'number') setVirtualMouseOffsetX(pointZeroData.zeus_virtual_mouse_offset_x);
          if (typeof pointZeroData.zeus_virtual_mouse_offset_y === 'number') setVirtualMouseOffsetY(pointZeroData.zeus_virtual_mouse_offset_y);
        }
        // Cargar ajustes de video
        if (ajustesData?.id) {
          setAjustesId(ajustesData.id);
          if (typeof ajustesData.brillo === 'number') setVideoBrightness(ajustesData.brillo);
          if (typeof ajustesData.contraste === 'number') setVideoContrast(ajustesData.contraste);
          if (typeof ajustesData.intensidad === 'number') setVideoIntensity(ajustesData.intensidad);
          if (typeof ajustesData.tiempo_inicio === 'number') setVideoTimeOffset(ajustesData.tiempo_inicio);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        toast({
          title: t('tutorialEditor.errConn'),
          description: 'No se pudo conectar con el servidor API.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [toast]);

  // Fetch serve server port
  useEffect(() => {
    const fetchServePort = async () => {
      try {
        // Try common ports for serve server (3032 is the default)
        const ports = [3032, 3033, 3000, 3001, 3003, 3004, 3005];
        for (const port of ports) {
          try {
            const response = await fetch(`http://localhost:${port}/api/health`);
            const data = await response.json();
            if (data.port) {
              setServePort(port);
              console.log(`Found serve server on port ${port}`);
              return;
            }
          } catch (e) {
            // Try next port
          }
        }
        console.log('Serve server not found on common ports, using default 3032');
      } catch (error) {
        console.log('Error fetching serve server port:', error);
      }
    };
    fetchServePort();
    const interval = setInterval(fetchServePort, 5000);
    return () => clearInterval(interval);
  }, []);

  // Handlers
  const [isCapturingTest, setIsCapturingTest] = useState(false);

  const handleTestCapture = async () => {
    try {
      setIsCapturingTest(true);

      // Ajustar área de grabación a coordenadas FÍSICAS globales (mismo cálculo que en handleGenerate)
      let finalRecordingArea = recordingArea;
      const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
      let windowX = window.screenLeft || window.screenX || 0;
      let windowY = window.screenTop || window.screenY || 0;

      if ((window as any).electronAPI?.getWindowBounds) {
        const bounds = await (window as any).electronAPI.getWindowBounds();
        if (bounds && bounds.content) {
          windowX = bounds.content.x;
          windowY = bounds.content.y;
        }
      }

      // Aplicar corrección del área roja (offset independiente) al origen de captura
      finalRecordingArea = {
        x: Math.round((windowX + recordingArea.x + mouseOffsetX) * dpr),
        y: Math.round((windowY + recordingArea.y + mouseOffsetY) * dpr),
        width: Math.round(recordingArea.width * dpr),
        height: Math.round(recordingArea.height * dpr)
      };

      const response = await fetch(`http://localhost:${servePort}/api/desktop/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: `test-capture-${Date.now()}.png`,
          clip: finalRecordingArea,
          cursorOffset: { x: virtualMouseOffsetX, y: virtualMouseOffsetY },
          cursorImagePath: cursorImagePath || undefined,
        }),
      });

      if (!response.ok) throw new Error('Error al realizar la captura de prueba');
      const data = await response.json();

      if (data.screenshot) {
        setPlaybackScreenshot(data.screenshot);
        setShowPreview(false);
        toast({
          title: 'Captura de prueba realizada',
          description: 'Se muestra en el área de reproducción para verificar coordenadas.',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Error en captura',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setIsCapturingTest(false);
    }
  };

  // Convierte el área roja calibrada (recordingArea) a coordenadas FÍSICAS
  // globales de la pantalla, aplicando DPR y los offsets del ratón. Es la misma
  // matemática que usa el flujo automático (handleGenerate), el REC manual y la
  // captura instantánea (handleTestCapture), para que los tres capturen la
  // misma región. Los offsets (mouseOffsetX/Y) son necesarios: sin ellos la
  // grabación se desplaza y no encaja con el recuadro rojo.
  const computePhysicalRecordingArea = useCallback(async () => {
    const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;

    let windowX = window.screenLeft || window.screenX || 0;
    let windowY = window.screenTop || window.screenY || 0;

    // En Electron, usar la API nativa para el origen real del contenido.
    if ((window as any).electronAPI?.getWindowBounds) {
      try {
        const bounds = await (window as any).electronAPI.getWindowBounds();
        if (bounds && bounds.content) {
          windowX = bounds.content.x;
          windowY = bounds.content.y;
          console.log('[Zeus] Native Content Origin:', { windowX, windowY });
        }
      } catch (err) {
        console.warn('[Zeus] getWindowBounds faló, usando screen origin:', err);
      }
    }

    const area = {
      x: Math.round((windowX + recordingArea.x + mouseOffsetX) * dpr),
      y: Math.round((windowY + recordingArea.y + mouseOffsetY) * dpr),
      width: Math.round(recordingArea.width * dpr),
      height: Math.round(recordingArea.height * dpr),
    };
    console.log(`[Zeus] PHYSICAL Global Area (DPR ${dpr}):`, area);
    return area;
  }, [recordingArea, mouseOffsetX, mouseOffsetY]);

  // ── Botón REC manual ──
  // Arranca la grabación del área del preview con el mismo gdigrab que el flujo
  // automático (serve /api/desktop/recording/start). Sirve para capturar la
  // pantalla del servidor de vista previa como MP4 sin audio (raw_video).
  const handleRecStart = async () => {
    if (isRecordingManual) return;
    try {
      setRecordingError(null);
      const clip = await computePhysicalRecordingArea();
      if (!clip.width || !clip.height) {
        setRecordingError(t('tutorialEditor.errEmptyArea'));
        toast({ title: t('tutorialEditor.invalidArea'), description: t('tutorialEditor.adjustRedAreaFirst'), variant: 'destructive' });
        return;
      }
      const resp = await fetch(`http://localhost:${servePort}/api/desktop/recording/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip, quality: tutorialSettings.quality || 'high' }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `No se pudo iniciar la grabación (${resp.status})`);
      }
      setIsRecordingManual(true);
      setRecordingElapsedSec(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingElapsedSec((s) => s + 1);
      }, 1000);
    } catch (err: any) {
      console.error('[REC] start error:', err);
      setRecordingError(err?.message || t('tutorialEditor.errStartRecording'));
      toast({ title: 'No se pudo grabar', description: err?.message, variant: 'destructive' });
    }
  };

  // Detiene la grabación, descarga el MP4 resultante del serve y lo pasa al
  // modal de Configuración del Tutorial como "vídeo base (sin sonido)".
  const handleRecStop = async () => {
    if (!isRecordingManual) return;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecordingManual(false);

    try {
      const stopResp = await fetch(`http://localhost:${servePort}/api/desktop/recording/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!stopResp.ok) throw new Error(`stop respondió ${stopResp.status}`);
      const stopData = await stopResp.json();
      const outputPath: string | undefined = stopData.outputPath;
      if (!outputPath) throw new Error('El servidor no devolvió la ruta del vídeo.');

      // Descargar el MP4 grabado para alimentar el modal como File.
      const fileResp = await fetch(
        `http://localhost:${servePort}/api/desktop/recording/file?path=${encodeURIComponent(outputPath)}`
      );
      if (!fileResp.ok) throw new Error(`No se pudo descargar el vídeo (${fileResp.status})`);
      const blob = await fileResp.blob();
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = new window.File([blob], `rec-${ts}.mp4`, { type: 'video/mp4' });

      // Alimentar el modal de Configuración del Tutorial.
      setTutorialRawVideo(file);
      setTutorialRawVideoPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      setTutorialSettings((prev: any) => ({ ...prev, manualMode: true }));
      setTutorialTitle((prev) => prev || `Grabación ${new Date().toLocaleString('es-ES')}`);
      setRecordingElapsedSec(0);
      // La grabación manual crea un tutorial NUEVO (no edita el seleccionado).
      setSettingsEditingId(null);
      setIsSettingsModalOpen(true);
      toast({ title: 'Grabación lista', description: t('tutorialEditor.nameAndFinish') });
    } catch (err: any) {
      console.error('[REC] stop/fetch error:', err);
      setRecordingError(err?.message || t('tutorialEditor.errFinishRecording'));
      toast({ title: t('tutorialEditor.errProcessRecording'), description: err?.message, variant: 'destructive' });
    }
  };

  // Aborta la grabación manual sin abrir el modal ni procesar el vídeo: solo
  // detiene ffmpeg y limpia el estado. Se usa al ocultar el preview a mitad
  // de una grabación para no dejar el proceso colgado.
  const handleRecAbort = async () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecordingManual(false);
    setRecordingElapsedSec(0);
    try {
      await fetch(`http://localhost:${servePort}/api/desktop/recording/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.warn('[REC] abort stop falló:', err);
    }
  };

  // Cleanup: si se desmonta con una grabación en curso, parar el cronómetro.
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, []);

  // Si se oculta el preview a mitad de una grabación manual, detener ffmpeg.
  useEffect(() => {
    if (!showPreview && isRecordingManual) {
      handleRecAbort();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview]);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast({
        title: t('tutorialEditor.missingInfo'),
        description: t('tutorialEditor.enterDesc'),
        variant: 'destructive',
      });
      return;
    }
    if (!selectedModel) {
      toast({
        title: 'Sin modelo',
        description: 'Selecciona un modelo de IA en el selector global de la app.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsGenerating(true);
      setGenerationProgress(0);
      setGenerationMessage(t('tutorialEditor.startingGeneration'));

      let targetTutorialId = currentTutorial?.id;
      let targetTutorialTitle = currentTutorial?.title;

      // Solo enviar al modelo los puntos de control relacionados con el tutorial actual
      const relatedControlPoints = targetTutorialId
        ? controlPoints.filter(p => p.tutorialIds?.includes(targetTutorialId as string))
        : controlPoints;
      const relatedControlPointsReal = targetTutorialId
        ? controlPointsReal.filter(p => p.tutorialIds?.includes(targetTutorialId as string))
        : controlPointsReal;
      console.log(`[Zeus] Puntos relacionados con tutorial ${targetTutorialId || '(nuevo)'}: virtual=${relatedControlPoints.length}, real=${relatedControlPointsReal.length}`);

      // Si hay un tutorial seleccionado, actualizarlo con la nueva descripción
      if (targetTutorialId) {
        toast({
          title: 'Actualizando tutorial',
          description: t('tutorialEditor.aiWillGenerate', { title: targetTutorialTitle ?? '' }),
        });
        await Api.api_tutorials_update(targetTutorialId, {
          description: prompt.trim(),
          prompt: prompt.trim(),
          modelId: selectedModel,
          settings: tutorialSettings,
          status: 'processing',
        });
      } else {
        toast({
          title: 'Generando tutorial',
          description: t('tutorialEditor.analyzingApp'),
        });
      }

      // 1. Start async generation job
      const recordingPath = `C:\\ZeusTutorials\\tutorial-${Date.now()}.mp4`;
      const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;

      // Ajustar área de grabación a coordenadas FÍSICAS globales de la pantalla.
      // Misma matemática que el REC manual (computePhysicalRecordingArea).
      const finalRecordingArea = await computePhysicalRecordingArea();

      console.log('[Zeus] Generating tutorial with recordingArea:', finalRecordingArea, 'zoom:', previewZoom);
      const response = await Api.api_tutorials_generate(
        prompt,
        selectedModel,
        appPath || 'Zeus Desktop',
        servePort,
        previewPort,
        generationMode,
        recordingPath,
        finalRecordingArea,
        previewZoom,
        dpr,
        relatedControlPoints,
        relatedControlPointsReal,
        { x: realMouseOffsetX, y: realMouseOffsetY },
        { x: virtualMouseOffsetX, y: virtualMouseOffsetY },
        { x: realMouseScaleX, y: realMouseScaleY },
        cursorImagePath || undefined,
        manualSteps,
        stepsCount,
        tutorialSettings,
        tutorialMusicPreviewUrl || currentTutorial?.backgroundMusicUrl || undefined,
        {
          brillo: videoBrightness,
          contraste: videoContrast,
          intensidad: videoIntensity,
          tiempo_inicio: videoTimeOffset,
        },
        targetTutorialId || undefined,
      );

      const jobId = response.id;

      // 2. Poll for completion
      const pollInterval = 2000; // 2 seconds
      const maxPolls = 1800; // 60 minutes max for local models
      let polls = 0;

      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(async () => {
          polls++;
          if (polls > maxPolls) {
            clearInterval(interval);
            reject(new Error(t('tutorialEditor.genTimeout')));
            return;
          }

          try {
            const status = await Api.api_tutorials_generation_status(jobId);
            setGenerationProgress(status.progress || 0);
            setGenerationMessage(status.message || '');

            if (status.status === 'completed') {
              clearInterval(interval);
              if (targetTutorialId) {
                // Actualizar el tutorial seleccionado con los pasos generados
                const updated = await Api.api_tutorials_update(targetTutorialId, {
                  // Conservamos el título que el usuario puso al crear el tutorial;
                  // no lo sobrescribimos con el que la IA genera a partir de la descripción.
                  title: targetTutorialTitle || status.tutorial?.title || prompt.slice(0, 100),
                  description: prompt.trim(),
                  prompt: prompt.trim(),
                  status: 'completed',
                  steps: status.tutorial?.steps || [],
                  metadata: status.tutorial?.metadata || {},
                });
                setTutorials(prev => prev.map(t => t.id === targetTutorialId ? updated : t));
                setCurrentTutorial(updated);
                // El id del tutorial no cambia al regenerar sobre uno existente, así que
                // el useEffect que rellena editedSteps no se dispara: lo forzamos aquí.
                setEditedSteps(buildEditedSteps(updated).steps);
                toast({
                  title: t('tutorialEditor.tutorialUpdated'),
                  description: t('tutorialEditor.tutorialHasSteps', { title: updated.title, n: updated.steps?.length || 0 }),
                });
              } else if (status.tutorial) {
                setTutorials(prev => [status.tutorial, ...prev]);
                setCurrentTutorial(status.tutorial);
                setEditedSteps(buildEditedSteps(status.tutorial).steps);
                toast({
                  title: t('tutorialEditor.tutorialGenerated'),
                  description: t('tutorialEditor.tutorialCreatedWith', { title: status.tutorial?.title || prompt.slice(0, 40), n: status.tutorial?.steps?.length || 0 }),
                });
              }
              // t('tutorialEditor.refresh') la lista completa desde el servidor para que la pestaña MP4
              // (tutorials.filter(t => t.file)) refleje el campo file del MP4 recién subido,
              // ya que el objeto en memoria (status.tutorial / updated) puede no llevarlo.
              Api.api_tutorials_list()
                .then((data: any) => setTutorials(data || []))
                .catch(() => { });
              setPrompt(''); // Clear prompt only on success
              resolve();
            } else if (status.status === 'failed') {
              if (targetTutorialId) {
                await Api.api_tutorials_update(targetTutorialId, { status: 'failed' }).catch(() => { });
              }
              clearInterval(interval);
              reject(new Error(status.error || status.message || t('tutorialEditor.errGeneration')));
            }
          } catch (pollErr) {
            // Don't stop polling on network blip
            console.warn('Poll error:', pollErr);
          }
        }, pollInterval);
      });

    } catch (error: any) {
      console.error('Generation error:', error);
      toast({
        title: 'Error de generación',
        description: error?.message || 'Hubo un problema al generar el tutorial.',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
      setGenerationProgress(0);
      setGenerationMessage('');
    }
  };

  // Re-exportar MP4 sobre la grabación raw (mismo flujo que tenía el panel de subtítulos).
  const handleExportMp4 = async () => {
    if (!currentTutorial) return;
    const rawAvailable = !!currentTutorial.metadata?.rawVideoPath;
    if (!rawAvailable) return;
    try {
      setMp4ExportRebuilding(true);
      setMp4ExportProgress(0);
      setMp4ExportMessage(t('tutorialEditor.preparingRegen'));

      // Si editedSteps está vacío (p.ej. el tutorial se generó/cargó antes de
      // refrescar el estado), caemos a los pasos del propio tutorial para no
      // enviar un steps[] vacío, que el backend rechaza ("steps[] es obligatorio").
      const sourceSteps = editedSteps.length > 0
        ? editedSteps
        : buildEditedSteps(currentTutorial).steps;

      const payload = {
        steps: sourceSteps.map(s => ({
          id: s.id,
          subtitle: s.subtitle,
          voiceover: s.voiceover,
          subtitleStart: s.subtitleStart,
          subtitleEnd: s.subtitleEnd,
          voiceStart: s.voiceStart,
          duration: s.duration,
        })),
        settings: {
          ...currentTutorial.settings,
          voiceoverVolume: tutorialSettings.voiceoverVolume ?? 0.8,
          musicVolume: tutorialSettings.musicVolume ?? 0.3,
        },
        backgroundMusicUrl: currentTutorial.backgroundMusicUrl,
        videoSettings: {
          brillo: videoBrightness,
          contraste: videoContrast,
          intensidad: videoIntensity,
          tiempo_inicio: videoTimeOffset,
        },
      };

      // Persistir los volúmenes ajustados y las tarjetas (steps) en el tutorial
      // ANTES de lanzar el rebuild. Esto es crítico para el modo manual: las
      // tarjetas creadas a mano solo existen en editedSteps; si no se persisten
      // aquí, runTutorialRebuild no las encontraría al hacer merge por id y se
      // perderían. También asegura que los volúmenes se mantengan la próxima vez.
      try {
        await Api.api_tutorials_update(currentTutorial.id, {
          steps: payload.steps,
          settings: payload.settings,
        });
      } catch (persistErr) {
        console.warn('No se pudieron persistir las tarjetas antes del rebuild:', persistErr);
      }

      const resp = await Api.api_tutorials_rebuild(currentTutorial.id, payload);
      const jobId = resp.id;

      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(async () => {
          try {
            const status = await Api.api_tutorials_generation_status(jobId);
            setMp4ExportProgress(status.progress || 0);
            setMp4ExportMessage(status.message || '');
            if (status.status === 'completed') {
              clearInterval(interval);
              if (status.tutorial) {
                const updated = status.tutorial as Tutorial;
                setCurrentTutorial(updated);
                setEditedSteps(buildEditedSteps(updated).steps);
                setTutorials(prev => prev.map(t => t.id === updated.id ? updated : t));
                // t('tutorialEditor.refresh') lista para que la pestaña MP4 refleje el file actualizado.
                Api.api_tutorials_list().then((data: any) => setTutorials(data || [])).catch(() => { });
                toast({ title: '¡MP4 re-generado!', description: t('tutorialEditor.subsVoiceUpdated') });
              }
              resolve();
            } else if (status.status === 'failed') {
              clearInterval(interval);
              reject(new Error(status.error || status.message || t('tutorialEditor.errRegeneration')));
            }
          } catch (pollErr) {
            console.warn('Rebuild poll error:', pollErr);
          }
        }, 2000);
      });
    } catch (error: any) {
      console.error('Rebuild error:', error);
      toast({ title: 'Error al re-generar', description: error?.message || 'Hubo un problema.', variant: 'destructive' });
    } finally {
      setMp4ExportRebuilding(false);
      setMp4ExportProgress(0);
      setMp4ExportMessage('');
    }
  };

  // Recortar el MP4 final según los rangos a conservar (trim). Se invoca desde
  // el VideoTrimmerPanel de la pestaña t('tutorialEditor.timelineTab') cuando hay un MP4 seleccionado.
  const handleTrimExport = async (segments: Array<{ start: number; end: number; speed?: number }>) => {
    if (!currentTutorial) return;
    if (!segments || segments.length === 0) {
      toast({ title: 'Nada que recortar', description: t('tutorialEditor.adjustHandlers'), variant: 'destructive' });
      return;
    }
    try {
      setTrimRebuilding(true);
      setTrimProgress(0);
      setTrimMessage('Preparando recorte...');

      const resp = await Api.api_tutorials_trim(currentTutorial.id, { segments });
      const jobId = resp.id;

      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(async () => {
          try {
            const status = await Api.api_tutorials_generation_status(jobId);
            setTrimProgress(status.progress || 0);
            setTrimMessage(status.message || '');
            if (status.status === 'completed') {
              clearInterval(interval);
              if (status.tutorial) {
                const updated = status.tutorial as Tutorial;
                setCurrentTutorial(updated);
                setTutorials(prev => prev.map(t => t.id === updated.id ? updated : t));
                // t('tutorialEditor.refresh') la URL del MP4 en reproducción (cache-bust para que
                // el <video> recargue el archivo nuevo y no el cacheado). Se
                // prefiere `fileSound` (vídeo con sonido, el resultado final) y se
                // mantiene `file` (base limpia) como fallback.
                const playUrl = updated.fileSound || updated.file;
                if (playUrl) {
                  const sep = playUrl.includes('?') ? '&' : '?';
                  setPlayingMp4(`${playUrl}${sep}t=${Date.now()}`);
                }
                Api.api_tutorials_list().then((data: any) => setTutorials(data || [])).catch(() => { });
                toast({ title: '¡MP4 recortado!', description: t('tutorialEditor.exportedNewDuration') });
              }
              resolve();
            } else if (status.status === 'failed') {
              clearInterval(interval);
              reject(new Error(status.error || status.message || 'Error en el recorte'));
            }
          } catch (pollErr) {
            console.warn('Trim poll error:', pollErr);
          }
        }, 2000);
      });
    } catch (error: any) {
      console.error('Trim error:', error);
      toast({ title: 'Error al recortar', description: error?.message || 'Hubo un problema.', variant: 'destructive' });
    } finally {
      setTrimRebuilding(false);
      setTrimProgress(0);
      setTrimMessage('');
    }
  };

  const handleSelectFolder = async () => {
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      try {
        const selectedPath = await (window as any).electronAPI.selectFolder();
        if (selectedPath) {
          setAppPath(selectedPath);
          // Send the folder path to the serve server
          try {
            await fetch(`http://localhost:${servePort}/api/set-project-path`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectPath: selectedPath }),
            });
            console.log('Folder path sent to serve server:', selectedPath);
          } catch (error) {
            console.error('Error sending folder path to serve server:', error);
          }
        }
      } catch (error) {
        console.error('Error selecting folder:', error);
        toast({
          title: 'Error',
          description: 'No se pudo seleccionar la carpeta',
          variant: 'destructive',
        });
      }
    } else {
      // Fallback for web version
      toast({
        title: 'No disponible',
        description: t('tutorialEditor.folderDesktopOnly'),
        variant: 'destructive',
      });
    }
  };

  const handleDeleteTutorial = async (id: string) => {
    try {
      await Api.api_tutorials_delete(id);
      setTutorials(tutorials.filter(t => t.id !== id));
      if (currentTutorial?.id === id) setCurrentTutorial(null);
      toast({ title: 'Tutorial eliminado' });
    } catch (error) {
      toast({ title: 'Error al eliminar', variant: 'destructive' });
    }
  };

  // Carga todos los datos de un tutorial existente en los campos del modal
  // "Configuración del Tutorial" para editarlo. Si se pasa null, prepara el
  // modal para CREAR un tutorial nuevo (campos por defecto).
  const loadTutorialIntoModal = (t: Tutorial | null) => {
    if (!t) {
      setSettingsEditingId(null);
      setTutorialTitle('');
      setTutorialBackgroundMusic(null);
      setTutorialMusicPreviewUrl(null);
      setTutorialSettings({
        resolution: '1080p',
        fps: 30,
        backgroundMusic: true,
        musicVolume: 0.3,
        voiceoverVolume: 0.8,
        subtitleEnabled: true,
        subtitleLanguage: 'es',
        subtitleFontSize: 18,
        subtitleTextColor: '#ffffff',
        subtitleBackgroundColor: 'rgba(0,0,0,0.8)',
        subtitleBackgroundOpacity: 0.8,
        subtitleVerticalOffset: 30,
        subtitleFontFamily: 'inherit',
        quality: 'high',
        outputFormat: 'mp4',
      });
      setMusicStartTime(0);
      setMusicFadeInDuration(2);
      setMusicFadeOutDuration(3);
      // Vídeo base (modo manual): limpiar selección nueva.
      if (tutorialRawVideoPreviewUrl) URL.revokeObjectURL(tutorialRawVideoPreviewUrl);
      setTutorialRawVideo(null);
      setTutorialRawVideoPreviewUrl(null);
      return;
    }

    setSettingsEditingId(t.id);
    setTutorialTitle(t.title || '');
    setTutorialBackgroundMusic(null);
    setTutorialMusicPreviewUrl(t.backgroundMusicUrl || null);
    if (t.settings) {
      setTutorialSettings((prev) => ({
        ...prev,
        ...t.settings,
        resolution: '1080p',
        musicVolume: typeof t.settings.musicVolume === 'number' ? t.settings.musicVolume : prev.musicVolume,
        voiceoverVolume: typeof t.settings.voiceoverVolume === 'number' ? t.settings.voiceoverVolume : prev.voiceoverVolume,
        voice: typeof t.settings.voice === 'string' ? t.settings.voice : prev.voice,
        backgroundMusicFile: t.backgroundMusicUrl || t.settings.backgroundMusicFile,
        backgroundMusicFileName: t.settings.backgroundMusicFileName || prev.backgroundMusicFileName,
        manualMode: typeof t.settings.manualMode === 'boolean' ? t.settings.manualMode : false,
      }));
      setMusicStartTime(typeof t.settings.musicStartTime === 'number' ? t.settings.musicStartTime : 0);
      setMusicFadeInDuration(typeof t.settings.musicFadeInDuration === 'number' ? t.settings.musicFadeInDuration : 2);
      setMusicFadeOutDuration(typeof t.settings.musicFadeOutDuration === 'number' ? t.settings.musicFadeOutDuration : 3);
    }
    // Limpiar selección de vídeo base nueva (se conserva la que ya tiene el
    // tutorial en metadata.rawVideoPath; si el usuario quiere cambiarla, debe
    // elegir un archivo nuevo).
    if (tutorialRawVideoPreviewUrl) URL.revokeObjectURL(tutorialRawVideoPreviewUrl);
    setTutorialRawVideo(null);
    setTutorialRawVideoPreviewUrl(null);
  };

  // Abre el modal "Configuración del Tutorial". Si hay un tutorial
  // seleccionado en el editor, carga sus datos para editarlos; si no,
  // prepara el modal para crear uno nuevo.
  // --- Export/Import de pestañas entre proyectos ---

  // Nombre de archivo seguro a partir del título del tutorial actual.
  const transferFileName = () => {
    const base = (currentTutorial?.title || currentTutorial?.id || 'editor-tarjetas')
      .replace(/[\\/:*?"<>|]+/g, '_').trim() || 'editor-tarjetas';
    return `${base}.json`;
  };

  // Abre el modal de exportación con las 4 pestañas deseleccionadas.
  const openTransferExport = () => {
    if (!currentTutorial) {
      toast({ title: 'Sin proyecto', description: 'Abre un tutorial antes de exportar.', variant: 'destructive' });
      return;
    }
    setTransferMode('export');
    setTransferImported(null);
    setTransferSelected({ timeline: false, subtitles: false, cards: false, settings: false });
    setTransferOpen(true);
  };

  // Lee el archivo JSON (Electron o web) y abre el modal de importación con las
  // pestañas presentes en el archivo preseleccionadas.
  const openTransferImport = () => {
    const applyFile = (text: string) => {
      try {
        const data = JSON.parse(text);
        const tabs = data?.tabs && typeof data.tabs === 'object' ? data.tabs : null;
        if (!tabs) {
          toast({ title: t('tutorialEditor.invalidJson'), description: t('tutorialEditor.noTabSections'), variant: 'destructive' });
          return;
        }
        setTransferImported({ tabs, project: data?.project ?? null });
        setTransferMode('import');
        setTransferSelected({
          timeline: !!tabs.timeline,
          subtitles: !!tabs.subtitles,
          cards: !!tabs.cards,
          settings: !!tabs.settings,
        });
        setTransferOpen(true);
      } catch (err: any) {
        console.error(t('tutorialEditor.errReadingJson'), err);
        toast({ title: 'Error al importar', description: err?.message || 'No se pudo leer el JSON.', variant: 'destructive' });
      }
    };

    const ea: any = (typeof window !== 'undefined' ? (window as any).electronAPI : undefined);
    if (ea?.importCardsJson) {
      ea.importCardsJson().then((text: string | null) => { if (typeof text === 'string') applyFile(text); });
      return;
    }
    // Fallback web: selector de archivo.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => applyFile(String(reader.result ?? ''));
      reader.readAsText(f);
    };
    input.click();
  };

  // Construye el bundle con las pestañas seleccionadas y lo guarda.
  const doExportTransfer = async () => {
    const sel = transferSelected;
    if (!sel.timeline && !sel.subtitles && !sel.cards && !sel.settings) {
      toast({ title: 'Selecciona pestañas', description: t('tutorialEditor.selectTabToExport') });
      return;
    }
    const steps = currentTutorial?.steps ?? [];
    const tabs: any = {};
    if (sel.timeline) {
      tabs.timeline = steps.map((s) => ({
        action: s.action, duration: s.duration,
        subtitleStart: s.subtitleStart ?? 0, subtitleEnd: s.subtitleEnd ?? 0, voiceStart: s.voiceStart ?? 0,
      }));
    }
    if (sel.subtitles) {
      tabs.subtitles = editedSteps.map(s => ({ subtitle: s.subtitle, voiceover: s.voiceover }));
    }
    if (sel.cards) {
      tabs.cards = editedSteps.map(s => ({
        id: s.id, action: s.action, subtitle: s.subtitle, voiceover: s.voiceover,
        subtitleStart: s.subtitleStart, subtitleEnd: s.subtitleEnd, voiceStart: s.voiceStart, duration: s.duration,
      }));
    }
    if (sel.settings) {
      tabs.settings = {
        videoBrightness, videoContrast, videoIntensity, videoTimeOffset,
        voiceoverVolume: tutorialSettings.voiceoverVolume ?? 0.8,
        musicVolume: tutorialSettings.musicVolume ?? 0.3,
      };
    }
    const payload = {
      app: 'Editor Tutoriales Zeus IA',
      version: 2,
      exportedAt: new Date().toISOString(),
      project: { id: currentTutorial?.id, title: currentTutorial?.title },
      tabs,
    };
    const json = JSON.stringify(payload, null, 2);
    const name = transferFileName();

    try {
      const ea: any = (typeof window !== 'undefined' ? (window as any).electronAPI : undefined);
      if (ea?.exportCardsJson) {
        const saved = await ea.exportCardsJson(json, name);
        if (saved) toast({ title: 'Exportado', description: `Guardado en: ${saved}` });
      } else {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast({ title: 'Exportado', description: `Archivo ${name} descargado.` });
      }
      setTransferOpen(false);
    } catch (err: any) {
      console.error('Error exportando:', err);
      toast({ title: 'Error al exportar', description: err?.message || 'No se pudo guardar el JSON.', variant: 'destructive' });
    }
  };

  // Aplica al proyecto actual las pestañas seleccionadas del bundle importado.
  const doImportTransfer = () => {
    const tabs = transferImported?.tabs;
    if (!tabs) return;
    const sel = transferSelected;
    if (!sel.timeline && !sel.subtitles && !sel.cards && !sel.settings) {
      toast({ title: 'Selecciona pestañas', description: t('tutorialEditor.selectTabToImport') });
      return;
    }

    const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `imp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let applied: string[] = [];

    // cards y timeline reemplazan la lista de pasos; cards tiene prioridad
    // (es un superconjunto de timeline). subtitles se fusiona por índice.
    if (sel.cards && Array.isArray(tabs.cards)) {
      const imported: EditedStep[] = tabs.cards.map((s: any, i: number) => ({
        id: newId(), order: i + 1,
        action: s.action ?? `Tarjeta ${i + 1}`,
        subtitle: String(s.subtitle ?? ''), voiceover: String(s.voiceover ?? ''),
        subtitleStart: Number(s.subtitleStart ?? 0), subtitleEnd: Number(s.subtitleEnd ?? 0),
        voiceStart: Number(s.voiceStart ?? 0), duration: Number(s.duration ?? 0),
      }));
      setEditedSteps(imported);
      applied.push('Tarjetas');
    } else if (sel.timeline && Array.isArray(tabs.timeline)) {
      const imported: EditedStep[] = tabs.timeline.map((s: any, i: number) => ({
        id: newId(), order: i + 1,
        action: s.action ?? `Paso ${i + 1}`,
        subtitle: '', voiceover: '',
        subtitleStart: Number(s.subtitleStart ?? 0), subtitleEnd: Number(s.subtitleEnd ?? 0),
        voiceStart: Number(s.voiceStart ?? 0), duration: Number(s.duration ?? 0),
      }));
      setEditedSteps(imported);
      applied.push(t('tutorialEditor.timelineTab'));
    }

    if (sel.subtitles && Array.isArray(tabs.subtitles)) {
      setEditedSteps((prev: EditedStep[]) => prev.map((s, i) => {
        const sub = tabs.subtitles[i];
        if (!sub) return s;
        return {
          ...s,
          subtitle: sub.subtitle !== undefined ? String(sub.subtitle) : s.subtitle,
          voiceover: sub.voiceover !== undefined ? String(sub.voiceover) : s.voiceover,
        };
      }));
      applied.push('Subtítulos/Voz');
    }

    if (sel.settings && tabs.settings && typeof tabs.settings === 'object') {
      const st = tabs.settings;
      if (typeof st.videoBrightness === 'number') setVideoBrightness(st.videoBrightness);
      if (typeof st.videoContrast === 'number') setVideoContrast(st.videoContrast);
      if (typeof st.videoIntensity === 'number') setVideoIntensity(st.videoIntensity);
      if (typeof st.videoTimeOffset === 'number') setVideoTimeOffset(st.videoTimeOffset);
      if (typeof st.voiceoverVolume === 'number' || typeof st.musicVolume === 'number') {
        setTutorialSettings((prev: any) => ({
          ...prev,
          ...(typeof st.voiceoverVolume === 'number' ? { voiceoverVolume: st.voiceoverVolume } : {}),
          ...(typeof st.musicVolume === 'number' ? { musicVolume: st.musicVolume } : {}),
        }));
      }
      applied.push('Ajustes');
    }

    toast({ title: 'Importado', description: `Se aplicaron: ${applied.join(', ')}.` });
    setTransferOpen(false);
  };

  // Atlas: valida la alineación de una pantalla moviendo el ratón real a cada
  // landmark y comparando la posición devuelta con la esperada (drift). Reutiliza
  // la misma matemática que el botón "Probar" de Coordenadas y el ejecutor
  // /api/desktop/action (que ahora devuelve realCursorPosition).
  const probarLandmarks = async (screenId: string) => {
    const screen = screens.find(s => s.id === screenId);
    if (!screen) return;
    const landmarks = controlPointsReal.filter(p => p.screenId === screenId && p.landmark);
    if (landmarks.length < 2) {
      toast({ title: 'Faltan landmarks', description: 'Marca al menos 2 puntos como landmark para validar la pantalla.', variant: 'destructive' });
      return;
    }
    try {
      const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
      let windowX = window.screenLeft || window.screenX || 0;
      let windowY = window.screenTop || window.screenY || 0;
      if ((window as any).electronAPI?.getWindowBounds) {
        const bounds = await (window as any).electronAPI.getWindowBounds();
        if (bounds && bounds.content) {
          windowX = bounds.content.x;
          windowY = bounds.content.y;
        }
      }
      const areaPhysicalX = Math.round((windowX + recordingArea.x + mouseOffsetX) * dpr);
      const areaPhysicalY = Math.round((windowY + recordingArea.y + mouseOffsetY) * dpr);
      const results: string[] = [];
      for (const p of landmarks) {
        const physicalX = areaPhysicalX + Math.round(p.x * dpr * realMouseScaleX) + realMouseOffsetX;
        const physicalY = areaPhysicalY + Math.round(p.y * dpr * realMouseScaleY) + realMouseOffsetY;
        const resp = await fetch(`http://localhost:${servePort}/api/desktop/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'move', x: physicalX, y: physicalY }),
        });
        const data = await resp.json().catch(() => ({}));
        const real = data?.realCursorPosition;
        if (real && typeof real.x === 'number') {
          const drift = Math.round(Math.sqrt((real.x - physicalX) ** 2 + (real.y - physicalY) ** 2));
          results.push(`${p.name}: drift ${drift}px`);
        } else {
          results.push(`${p.name}: movido (sin lectura)`);
        }
        await new Promise(r => setTimeout(r, 400));
      }
      toast({ title: `Landmarks de "${screen.name}"`, description: results.join(' · ') });
    } catch (err: any) {
      console.error('Error validando landmarks:', err);
      toast({ title: t('tutorialEditor.errValidate'), description: err?.message || t('tutorialEditor.errTestLandmarks'), variant: 'destructive' });
    }
  };

  const openSettingsModal = () => {
    loadTutorialIntoModal(currentTutorial);
    setIsSettingsModalOpen(true);
  };

  const handleApplyTutorialSettings = async () => {
    if (!tutorialTitle.trim()) {
      toast({
        title: t('tutorialEditor.missingTitle'),
        description: t('tutorialEditor.enterTitle'),
        variant: 'destructive',
      });
      return;
    }

    // ── Modo EDICIÓN: actualizar un tutorial existente ──
    if (settingsEditingId) {
      try {
        const updated = await Api.api_tutorials_update(settingsEditingId, {
          title: tutorialTitle.trim(),
          settings: {
            ...tutorialSettings,
            musicStartTime,
            musicFadeInDuration,
            musicFadeOutDuration,
          },
          backgroundMusic: tutorialBackgroundMusic || undefined,
        });
        let finalTutorial = updated as Tutorial;

        // Si el modo manual está activo y se seleccionó un vídeo base nuevo,
        // subirlo: el backend le quita el audio y lo fija como rawVideoPath.
        // Así, la próxima vez que se exporte (rebuild), se usará ese vídeo
        // (sin sonido) como base.
        if (tutorialSettings.manualMode && tutorialRawVideo) {
          try {
            setTutorialRawVideoUploading(true);
            toast({ title: t('tutorialEditor.uploadingBaseVideo'), description: 'Procesando (se le quita el audio).' });
            const withVideo = await Api.api_tutorials_upload_raw_video(settingsEditingId, tutorialRawVideo);
            if (withVideo && typeof withVideo === 'object' && withVideo.id) {
              finalTutorial = withVideo as Tutorial;
            }
            toast({ title: 'Vídeo base actualizado', description: t('tutorialEditor.usedNoSoundNextExport') });
          } catch (uploadErr: any) {
            console.error('Error uploading manual raw video (edit):', uploadErr);
            toast({
              title: t('tutorialEditor.errUploadVideo'),
              description: uploadErr?.message || t('tutorialEditor.errProcessBaseVideo'),
              variant: 'destructive',
            });
          } finally {
            setTutorialRawVideoUploading(false);
          }
        }

        // t('tutorialEditor.refresh') la lista completa y el tutorial actual desde el servidor.
        try {
          const fresh = await Api.api_tutorials_list();
          if (Array.isArray(fresh)) {
            setTutorials(fresh);
            const me = fresh.find((tt: Tutorial) => tt.id === settingsEditingId);
            if (me) finalTutorial = me;
          }
        } catch (refreshErr) {
          console.warn('[Tutorial] refresco de lista tras edición falló:', refreshErr);
        }

        setCurrentTutorial(finalTutorial);
        setTutorials(prev => prev.map(t => t.id === finalTutorial.id ? finalTutorial : t));

        // Limpieza del vídeo base seleccionado.
        if (tutorialRawVideoPreviewUrl) URL.revokeObjectURL(tutorialRawVideoPreviewUrl);
        setTutorialRawVideo(null);
        setTutorialRawVideoPreviewUrl(null);
        setTutorialBackgroundMusic(null);
        setSettingsEditingId(null);

        setIsSettingsModalOpen(false);
        toast({
          title: 'Tutorial actualizado',
          description: `Se guardaron los cambios de "${finalTutorial.title}".`,
        });
      } catch (error) {
        console.error('Error updating tutorial from settings:', error);
        toast({
          title: 'Error al actualizar',
          description: 'No se pudo guardar el tutorial en PocketBase.',
          variant: 'destructive',
        });
      }
      return;
    }

    try {
      const saved = await Api.api_tutorials_create({
        title: tutorialTitle.trim(),
        settings: {
          ...tutorialSettings,
          musicStartTime,
          musicFadeInDuration,
          musicFadeOutDuration,
        },
        backgroundMusic: tutorialBackgroundMusic || undefined,
      });
      setTutorials(prev => [saved, ...prev]);
      setCurrentTutorial(saved);
      setTutorialTitle('');
      setTutorialBackgroundMusic(null);
      setTutorialMusicPreviewUrl(null);
      setIsTutorialMusicPlaying(false);
      if (tutorialAudioRef.current) {
        tutorialAudioRef.current.pause();
        tutorialAudioRef.current = null;
      }

      // Si el usuario activó el modo manual y seleccionó un vídeo base,
      // subirlo: el backend le quita el audio y lo fija como rawVideoPath.
      let finalTutorial = saved;
      if (tutorialSettings.manualMode && tutorialRawVideo) {
        try {
          setTutorialRawVideoUploading(true);
          toast({ title: t('tutorialEditor.uploadingBaseVideo'), description: 'Procesando (se le quita el audio).' });
          const updated = await Api.api_tutorials_upload_raw_video(saved.id, tutorialRawVideo);
          if (updated && typeof updated === 'object' && updated.id) {
            finalTutorial = updated;
            setCurrentTutorial(updated);
            setTutorials(prev => prev.map(t => t.id === updated.id ? updated : t));
          }
          toast({ title: 'Vídeo base subido', description: 'Ya puedes ir a Tarjetas y crearlas manualmente.' });
        } catch (uploadErr: any) {
          console.error('Error uploading manual raw video:', uploadErr);
          toast({
            title: t('tutorialEditor.errUploadVideo'),
            description: uploadErr?.message || t('tutorialEditor.errProcessBaseVideoCreated'),
            variant: 'destructive',
          });
        } finally {
          setTutorialRawVideoUploading(false);
        }
      }

      // t('tutorialEditor.refresh') la lista completa desde el servidor para que la pestaña MP4
      // (tutorials.filter(t => t.file)) y la reproducción reflejen el campo
      // file del MP4 recién subido. El objeto en memoria (updated) puede no
      // llevarlo, igual que pasa en el flujo de generación, y sin este refresco
      // el tutorial aparece en la lista pero no se puede reproducir hasta
      // recargar la app.
      try {
        const fresh = await Api.api_tutorials_list();
        if (Array.isArray(fresh)) {
          setTutorials(fresh);
          const me = fresh.find(t => t.id === finalTutorial.id);
          if (me) {
            finalTutorial = me;
            setCurrentTutorial(me);
          }
        }
      } catch (refreshErr) {
        console.warn('[Tutorial] refresco de lista tras raw-video falló:', refreshErr);
      }

      // Limpiar el vídeo base seleccionado.
      if (tutorialRawVideoPreviewUrl) URL.revokeObjectURL(tutorialRawVideoPreviewUrl);
      setTutorialRawVideo(null);
      setTutorialRawVideoPreviewUrl(null);

      setIsSettingsModalOpen(false);
      toast({
        title: 'Tutorial creado',
        description: `Se guardó "${finalTutorial.title}" en PocketBase.`,
      });
    } catch (error) {
      console.error('Error creating tutorial from settings:', error);
      toast({
        title: 'Error al crear tutorial',
        description: 'No se pudo guardar el tutorial en PocketBase.',
        variant: 'destructive',
      });
    }
  };

  const handleSaveDocumentation = async () => {
    try {
      const formData = new FormData();
      formData.append('title', newDocumentation.title);
      formData.append('description', newDocumentation.description);
      if (newDocumentation.file) {
        formData.append('file', newDocumentation.file);
      }

      const response = await fetch('http://localhost:3001/api/documentation', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Failed to create documentation');
      const savedDoc = await response.json();
      setDocumentationList([...documentationList, savedDoc]);
      setIsDocumentationModalOpen(false);
      setNewDocumentation({ title: '', description: '', file: null });
      toast({ title: t('tutorialEditor.docSaved') });
    } catch (error) {
      toast({ title: t('tutorialEditor.errSaveDoc'), variant: 'destructive' });
    }
  };

  const handleDeleteDocumentation = async (id: string) => {
    try {
      await fetch(`http://localhost:3001/api/documentation/${id}`, {
        method: 'DELETE',
      });
      setDocumentationList(documentationList.filter(d => d.id !== id));
      toast({ title: t('tutorialEditor.docDeleted') });
    } catch (error) {
      toast({ title: t('tutorialEditor.errDeleteDoc'), variant: 'destructive' });
    }
  };

  const handleSaveTutorial = async (id: string) => {
    toast({ title: 'Tutorial guardado correctamente' });
  }

  // ── Voice & Subtitle Logic ──
  const speakStep = (text: string, lang = 'es-ES') => {
    if (!voiceEnabled || !text || typeof window === 'undefined') return;
    // Cancel any ongoing speech
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = tutorialSettings.voiceoverVolume;
    speechUtteranceRef.current = utterance;
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      // Web Speech API not available
    }
  };

  const stopVoice = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  };

  // ── Playback Logic ──
  const stopPlayback = () => {
    setIsPlaying(false);
    setPlaybackStepIndex(null);
    setPlaybackScreenshot(null);
    setIsPlaybackLoading(false);
    setCurrentSubtitle('');
    stopVoice();
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    // Detener música de fondo del tutorial
    if (tutorialPlaybackAudioRef.current) {
      tutorialPlaybackAudioRef.current.pause();
      tutorialPlaybackAudioRef.current.currentTime = 0;
    }
  };

  const runPlaybackStep = async (index: number) => {
    if (!currentTutorial || !currentTutorial.steps) return;

    const step = currentTutorial.steps[index];
    if (!step) return;

    // Mostrar el screenshot guardado del paso (modo Slideshow)
    setPlaybackScreenshot(normalizeImageSrc(step.screenshot) || null);
    setPlaybackStepIndex(index);
    setIsPlaybackLoading(false);

    // t('tutorialEditor.voiceoverTitle'): narrar el voiceover del paso
    if (step.voiceover) {
      speakStep(step.voiceover, tutorialSettings.subtitleLanguage === 'es' ? 'es-ES' : 'en-US');
    }

    // Subtítulos: mostrar el subtitle o description
    if (subtitlesEnabled) {
      setCurrentSubtitle(step.subtitle || step.description || '');
    } else {
      setCurrentSubtitle('');
    }

    // Schedule next step after duration
    const durationMs = (step.duration || 3) * 1000;
    playbackTimeoutRef.current = setTimeout(() => {
      const nextIndex = index + 1;
      if (nextIndex < (currentTutorial.steps?.length || 0)) {
        runPlaybackStep(nextIndex);
      } else {
        // Último paso: iniciar fade-out del audio antes de terminar
        const settings = currentTutorial.settings || {};
        const fadeOutDuration = typeof settings.musicFadeOutDuration === 'number' ? settings.musicFadeOutDuration : 3;
        const targetVolume = typeof settings.musicVolume === 'number' ? settings.musicVolume : tutorialSettings.musicVolume;
        if (tutorialPlaybackAudioRef.current && fadeOutDuration > 0) {
          const audio = tutorialPlaybackAudioRef.current;
          let fadeOutFrame: number | null = null;
          const startFadeOut = performance.now();
          const startVolume = audio.volume;
          const doFadeOut = (now: number) => {
            const elapsed = (now - startFadeOut) / 1000;
            const progress = Math.min(1, elapsed / fadeOutDuration);
            audio.volume = Math.max(0, startVolume * (1 - progress));
            if (progress < 1) {
              fadeOutFrame = requestAnimationFrame(doFadeOut);
            } else {
              toast({ title: t('tutorialEditor.playbackCompleted') });
              stopPlayback();
            }
          };
          fadeOutFrame = requestAnimationFrame(doFadeOut);
        } else {
          toast({ title: t('tutorialEditor.playbackCompleted') });
          stopPlayback();
        }
      }
    }, durationMs);
  };

  const togglePlayback = () => {
    if (isPlaying) {
      // Pause
      setIsPlaying(false);
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
        playbackTimeoutRef.current = null;
      }
      // Pausar música de fondo (sin reiniciar para poder reanudar)
      if (tutorialPlaybackAudioRef.current) {
        tutorialPlaybackAudioRef.current.pause();
      }
      toast({ title: t('tutorialEditor.playbackPaused') });
    } else {
      if (!currentTutorial || !currentTutorial.steps?.length) {
        toast({
          title: t('tutorialEditor.noSteps'),
          description: t('tutorialEditor.noStepsDesc'),
          variant: 'destructive',
        });
        return;
      }
      // Start or resume
      setIsPlaying(true);

      // Iniciar o reanudar música de fondo del tutorial
      const musicUrl = currentTutorial.backgroundMusicUrl || currentTutorial.settings?.backgroundMusicFile;
      const musicEnabled = currentTutorial.settings?.backgroundMusic !== false;
      const settings = currentTutorial.settings || {};
      const targetVolume = typeof settings.musicVolume === 'number' ? settings.musicVolume : tutorialSettings.musicVolume;
      const startTime = typeof settings.musicStartTime === 'number' ? settings.musicStartTime : 0;
      const fadeInDuration = typeof settings.musicFadeInDuration === 'number' ? settings.musicFadeInDuration : 2;
      const fadeOutDuration = typeof settings.musicFadeOutDuration === 'number' ? settings.musicFadeOutDuration : 3;

      if (musicUrl && musicEnabled) {
        if (!tutorialPlaybackAudioRef.current || tutorialPlaybackAudioRef.current.src !== musicUrl) {
          tutorialPlaybackAudioRef.current = new Audio(musicUrl);
          tutorialPlaybackAudioRef.current.loop = true;
          tutorialPlaybackAudioRef.current.currentTime = startTime;
        }
        // Aplicar fade-in desde 0 hasta targetVolume
        tutorialPlaybackAudioRef.current.volume = 0;
        tutorialPlaybackAudioRef.current.play().catch((err) => {
          console.warn(t('tutorialEditor.errBgMusic'), err);
        });
        const audio = tutorialPlaybackAudioRef.current;
        let fadeInFrame: number | null = null;
        const startFadeIn = performance.now();
        const doFadeIn = (now: number) => {
          const elapsed = (now - startFadeIn) / 1000;
          const progress = Math.min(1, elapsed / Math.max(0.1, fadeInDuration));
          audio.volume = progress * targetVolume;
          if (progress < 1) {
            fadeInFrame = requestAnimationFrame(doFadeIn);
          }
        };
        fadeInFrame = requestAnimationFrame(doFadeIn);
      }

      const startIndex = playbackStepIndex !== null ? playbackStepIndex : 0;
      runPlaybackStep(startIndex);
    }
  };

  // Cleanup on unmount / tutorial change
  useEffect(() => {
    return () => {
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
      }
      if (tutorialPlaybackAudioRef.current) {
        tutorialPlaybackAudioRef.current.pause();
        tutorialPlaybackAudioRef.current = null;
      }
    };
  }, []);

  // Reset playback when tutorial changes
  useEffect(() => {
    stopPlayback();
  }, [currentTutorial?.id]);

  // Sincronizar settings del tutorial seleccionado con el modal de configuración
  useEffect(() => {
    if (currentTutorial?.settings) {
      setTutorialSettings((prev) => ({
        ...prev,
        ...currentTutorial.settings,
        resolution: '1080p',
        musicVolume: typeof currentTutorial.settings.musicVolume === 'number' ? currentTutorial.settings.musicVolume : prev.musicVolume,
        voiceoverVolume: typeof currentTutorial.settings.voiceoverVolume === 'number' ? currentTutorial.settings.voiceoverVolume : prev.voiceoverVolume,
        voice: typeof currentTutorial.settings.voice === 'string' ? currentTutorial.settings.voice : prev.voice,
        backgroundMusicFile: currentTutorial.backgroundMusicUrl || currentTutorial.settings.backgroundMusicFile,
        backgroundMusicFileName: currentTutorial.settings.backgroundMusicFileName || prev.backgroundMusicFileName,
      }));
      if (currentTutorial.backgroundMusicUrl && !tutorialMusicPreviewUrl) {
        setTutorialMusicPreviewUrl(currentTutorial.backgroundMusicUrl);
      }
      setMusicStartTime(typeof currentTutorial.settings?.musicStartTime === 'number' ? currentTutorial.settings.musicStartTime : 0);
      setMusicFadeInDuration(typeof currentTutorial.settings?.musicFadeInDuration === 'number' ? currentTutorial.settings.musicFadeInDuration : 2);
      setMusicFadeOutDuration(typeof currentTutorial.settings?.musicFadeOutDuration === 'number' ? currentTutorial.settings.musicFadeOutDuration : 3);
    }
  }, [currentTutorial?.id]);

  return (
    <div className="flex h-[calc(100vh-64px)] w-full overflow-hidden bg-[#0a0c10] text-white">
      {/* Sidebar - Tutorial List */}
      <aside className="w-80 border-r border-gray-800 bg-[#0f1117] flex flex-col shrink-0">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">{t('tutorialEditor.myTutorials')}</h2>
          <Button variant="ghost" size="icon" onClick={() => setCurrentTutorial(null)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as 'preview' | 'mp4')} className="flex-1 flex flex-col h-full">
          <TabsList className="w-full justify-start rounded-none border-b border-gray-800 bg-[#0f1117] h-10 flex-shrink-0">
            <TabsTrigger value="preview" className="data-[state=active]:bg-[#0d1117] data-[state=active]:text-blue-400">
              <Video className="h-4 w-4 mr-2" />{t('tutorialEditor.previewTab')}</TabsTrigger>
            <TabsTrigger value="mp4" className="data-[state=active]:bg-[#0d1117] data-[state=active]:text-emerald-400">
              <FileVideo className="h-4 w-4 mr-2" />{t('tutorialEditor.mp4Tab')}</TabsTrigger>
          </TabsList>

          <TabsContent value="preview" className="flex-1 mt-0 p-2 overflow-y-auto">
            {isLoading ? (
              <div className="flex flex-col gap-4 p-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 w-full bg-gray-800/50 animate-pulse rounded-lg" />
                ))}
              </div>
            ) : tutorials.length === 0 ? (
              <div className="text-center py-10 px-4 text-gray-500 text-sm">
                {t('tutorialEditor.noTutorialsCreated')}
              </div>
            ) : (
              tutorials.map(tutorial => (
                <div
                  key={tutorial.id}
                  onClick={() => setCurrentTutorial(tutorial)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-xl transition-all group cursor-pointer text-left",
                    currentTutorial?.id === tutorial.id
                      ? "bg-blue-600/10 border border-blue-500/30 text-blue-400"
                      : "hover:bg-gray-800/50 text-gray-300"
                  )}
                >
                  <div className="relative shrink-0">
                    <div className="w-12 h-12 bg-gray-700 rounded-lg overflow-hidden border border-gray-600">
                      {tutorial.metadata?.thumbnail ? (
                        <img src={normalizeImageSrc(tutorial.metadata.thumbnail)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Video className="w-full h-full p-3 opacity-20" />
                      )}
                    </div>
                    {tutorial.status === 'processing' && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <RefreshCw className="h-4 w-4 animate-spin text-blue-400" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{tutorial.title}</p>
                    <p className="text-xs text-gray-500 truncate">{new Date(tutorial.createdAt).toLocaleDateString()}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTutorialToDelete(tutorial);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600/20 hover:text-red-400 shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="mp4" className="flex-1 mt-0 p-2 overflow-y-auto">
            {isLoading ? (
              <div className="flex flex-col gap-4 p-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 w-full bg-gray-800/50 animate-pulse rounded-lg" />
                ))}
              </div>
            ) : tutorials.length === 0 ? (
              <div className="text-center py-10 px-4 text-gray-500 text-sm">
                {t('tutorialEditor.noTutorialsCreated')}
              </div>
            ) : (
              (() => {
                const mp4Tutorials = tutorials.filter(t => t.file || t.fileSound);
                return mp4Tutorials.map(tutorial => (
                  <button
                    key={tutorial.id}
                    onClick={() => {
                      setCurrentTutorial(tutorial);
                      // Preferimos el vídeo con sonido (fileSound) para la
                      // reproducción; la base limpia (file) queda como fallback.
                      setPlayingMp4(tutorial.fileSound || tutorial.file || null);
                      setPreviewTab('mp4');
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-xl transition-all group",
                      currentTutorial?.id === tutorial.id
                        ? "bg-emerald-600/10 border border-emerald-500/30 text-emerald-400"
                        : "hover:bg-gray-800/50 text-gray-300"
                    )}
                  >
                    <div className="relative">
                      <div className="w-12 h-12 bg-gray-700 rounded-lg overflow-hidden border border-gray-600 flex items-center justify-center">
                        <FileVideo className="h-6 w-6 text-emerald-400" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-medium truncate text-sm">{tutorial.title}</p>
                      <p className="text-xs text-gray-500 truncate">{new Date(tutorial.createdAt).toLocaleDateString()}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ));
              })()
            )}
            {tutorials.filter(t => t.file || t.fileSound).length === 0 && (
              <div className="text-center py-10 px-4 text-gray-500 text-sm">{t('tutorialEditor.noMp4Videos')}</div>
            )}
          </TabsContent>
        </Tabs>

        {/* Playback Controls en Sidebar */}
        {currentTutorial && currentTutorial.steps?.length > 0 && (
          <div className="border-t border-gray-800 bg-[#0f1117] p-3 space-y-3">
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-10 w-10 rounded-full",
                  isPlaying ? "bg-blue-600 text-white hover:bg-blue-500" : "bg-gray-800 text-white hover:bg-gray-700"
                )}
                onClick={togglePlayback}
                title={isPlaying ? 'Pausar' : 'Reproducir'}
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5 fill-white" />
                ) : (
                  <Play className="h-5 w-5 fill-white ml-0.5" />
                )}
              </Button>
              {(isPlaying || playbackStepIndex !== null) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-full bg-gray-800 text-red-400 hover:bg-red-900/30 hover:text-red-300"
                  onClick={stopPlayback}
                  title="Detener"
                >
                  <StopCircle className="h-5 w-5" />
                </Button>
              )}
            </div>

            {/* Voice, Subtitle & Music Toggles */}
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 text-[10px] rounded-full px-2",
                  voiceEnabled ? "bg-blue-600/20 text-blue-400 border border-blue-500/30" : "bg-gray-800 text-gray-400 border border-gray-700"
                )}
                onClick={() => setVoiceEnabled(!voiceEnabled)}
                title={t('tutorialEditor.voiceoverTitle')}
              >
                <Mic className="h-3 w-3 mr-1" /> {t('tutorialEditor.voice')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 text-[10px] rounded-full px-2",
                  subtitlesEnabled ? "bg-blue-600/20 text-blue-400 border border-blue-500/30" : "bg-gray-800 text-gray-400 border border-gray-700"
                )}
                onClick={() => setSubtitlesEnabled(!subtitlesEnabled)}
                title={t('tutorialEditor.subtitlesTitle')}
              >
                <Type className="h-3 w-3 mr-1" />{t('tutorialEditor.subtitles')}</Button>
              {(currentTutorial.backgroundMusicUrl || currentTutorial.settings?.backgroundMusicFile) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 text-[10px] rounded-full px-2",
                    currentTutorial.settings?.backgroundMusic !== false
                      ? "bg-amber-600/20 text-amber-400 border border-amber-500/30"
                      : "bg-gray-800 text-gray-400 border border-gray-700"
                  )}
                  onClick={() => {
                    const next = { ...currentTutorial.settings, backgroundMusic: !currentTutorial.settings?.backgroundMusic };
                    setTutorialSettings((prev: any) => ({ ...prev, backgroundMusic: next.backgroundMusic }));
                    setCurrentTutorial((prev: any) => prev ? { ...prev, settings: next } : null);
                    Api.api_tutorials_update(currentTutorial.id, { settings: next }).catch(() => { });
                    if (next.backgroundMusic) {
                      if (tutorialPlaybackAudioRef.current) {
                        tutorialPlaybackAudioRef.current.play().catch(() => { });
                      }
                    } else {
                      if (tutorialPlaybackAudioRef.current) tutorialPlaybackAudioRef.current.pause();
                    }
                  }}
                  title={t('tutorialEditor.bgMusicTitle')}
                >
                  <Music className="h-3 w-3 mr-1" /> {currentTutorial.settings?.backgroundMusic !== false ? t('tutorialEditor.musicOn') : t('tutorialEditor.musicOff')}
                </Button>
              )}
            </div>

            {/* Progreso */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-gray-400 uppercase tracking-wider">
                <span>{t('tutorialEditor.stepProgress', { n: playbackStepIndex !== null ? playbackStepIndex + 1 : 0, total: currentTutorial.steps.length })}</span>
                <span>{isPlaying ? t('tutorialEditor.playing') : playbackStepIndex !== null ? t('tutorialEditor.paused') : t('tutorialEditor.ready')}</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    isPlaying ? "bg-emerald-500" : "bg-blue-500"
                  )}
                  style={{
                    width: `${currentTutorial.steps.length > 0
                      ? ((playbackStepIndex !== null ? playbackStepIndex + 1 : 0) / currentTutorial.steps.length) * 100
                      : 0}%`,
                  }}
                />
              </div>
            </div>

            {/* Mini thumbnail del paso actual */}
            {playbackScreenshot && (
              <div className="aspect-video bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
                <img src={normalizeImageSrc(playbackScreenshot)} alt="Paso actual" className="w-full h-full object-cover" />
              </div>
            )}
            {isPlaybackLoading && !playbackScreenshot && (
              <div className="aspect-video bg-gray-800 rounded-lg flex items-center justify-center border border-gray-700">
                <RefreshCw className="h-5 w-5 text-blue-400 animate-spin" />
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col bg-gradient-to-br from-[#0a0c10] via-[#11141d] to-[#0a0c10] pl-2">

        {/* Header bar */}
        <header className="h-16 border-b border-gray-800/50 flex items-center justify-end px-8">
          <div className="flex items-center gap-2">
            {/* Selector de Vista (Preview vs MP4) */}
            <div className="flex items-center bg-gray-900 border border-gray-800 p-0.5 rounded-lg mr-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewTab('server')}
                className={cn(
                  "h-7 px-3 text-xs rounded-md transition-all",
                  previewTab === 'server'
                    ? "bg-blue-600/20 text-blue-400 font-medium"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                )}
              >
                <Monitor className="h-3.5 w-3.5 mr-1.5" />{t('tutorialEditor.previewTab')}</Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewTab('mp4')}
                className={cn(
                  "h-7 px-3 text-xs rounded-md transition-all",
                  previewTab === 'mp4'
                    ? "bg-emerald-600/20 text-emerald-400 font-medium"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                )}
              >
                <FileVideo className="h-3.5 w-3.5 mr-1.5" />{t('tutorialEditor.mp4Tab')}</Button>
            </div>
            <Button variant="outline" size="sm" onClick={openSettingsModal} className="border-gray-700 bg-gray-800/50 hover:bg-gray-700">
              <Settings className="h-4 w-4 mr-2" />{t('tutorialEditor.tutorial')}</Button>
            <Button variant="outline" size="sm" onClick={() => setIsDocumentationModalOpen(true)} className="border-gray-700 bg-gray-800/50 hover:bg-gray-700">
              <File className="h-4 w-4 mr-2" />{t('tutorialEditor.documentation')}</Button>
            {appPath && (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={previewPort}
                    onChange={(e) => setPreviewPort(parseInt(e.target.value) || 3000)}
                    className="w-20 bg-gray-800/50 border-gray-700 text-sm"
                    placeholder="3000"
                  />
                  <span className="text-xs text-gray-400">{t('tutorialEditor.port')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsServicesModalOpen(true)}
                    className="border-gray-700 bg-gray-800/50 hover:bg-gray-700"
                  >
                    <Server className="h-4 w-4 mr-2" />
                    {t('tutorialEditor.servicesTab')}
                    {services.filter(s => s.enabled).length > 0 && (
                      <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-green-600 text-white text-[10px] font-bold">
                        {services.filter(s => s.enabled).length}
                      </span>
                    )}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsCalibrating(!isCalibrating)}
                    className={cn(
                      "border-gray-700 hover:bg-gray-700",
                      isCalibrating ? "bg-red-900/40 border-red-500/50 text-red-300" : "bg-gray-800/50"
                    )}
                  >
                    {isCalibrating ? (
                      <><Video className="h-4 w-4 mr-2 text-red-400" />{t('tutorialEditor.confirmArea')}</>
                    ) : (
                      <><Video className="h-4 w-4 mr-2" />{t('tutorialEditor.adjustArea')}</>
                    )}
                  </Button>
                  {!isCalibrating && (
                    <span className="text-[10px] text-gray-500 font-mono">
                      {recordingArea.width}×{recordingArea.height} @ ({recordingArea.x},{recordingArea.y})
                    </span>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={async () => {
                  if (!showPreview) {
                    // Start development server before showing preview
                    try {
                      const response = await fetch(`http://localhost:${servePort}/api/start-dev`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectPath: appPath, port: previewPort, services }),
                      });
                      const data = await response.json();

                      // Update previewPort with the actual port returned by serve server
                      if (data.port && data.port !== previewPort) {
                        setPreviewPort(data.port);
                        console.log('Preview port updated to:', data.port);
                      } else if (data.url) {
                        try {
                          const url = new URL(data.url);
                          const actualPort = parseInt(url.port, 10);
                          if (actualPort && actualPort !== previewPort) {
                            setPreviewPort(actualPort);
                            console.log('Preview port updated from URL to:', actualPort);
                          }
                        } catch {
                          // ignore parse error
                        }
                      }

                      // Only kill PocketBase if project doesn't have its own pocket-base folder
                      if (!data.hasPocketBase) {
                        try {
                          await fetch(`http://localhost:${servePort}/api/kill-port`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ port: 8236 }),
                          });
                          console.log('Killed PocketBase on port 8236');
                        } catch (error) {
                          console.error('Error killing PocketBase:', error);
                        }
                      }

                      // Wait a moment for the server to start
                      await new Promise(resolve => setTimeout(resolve, 3000));

                      // Forzar recarga del iframe para que pille el servidor ya
                      // arrancado (si el puerto no cambió, el iframe no recarga
                      // solo y se quedaría en blanco). Así dispara onLoad y quita
                      // el overlay oscuro de arranque.
                      try {
                        const iframeEl = document.querySelector<HTMLIFrameElement>('iframe');
                        if (iframeEl) {
                          const currentSrc = iframeEl.src;
                          iframeEl.src = currentSrc;
                        }
                      } catch (reloadErr) {
                        console.warn('No se pudo forzar la recarga del preview:', reloadErr);
                      }
                    } catch (error) {
                      console.error('Error starting development server:', error);
                    }
                  } else {
                    // Parar los servicios auxiliares arrancados con el preview
                    try {
                      await fetch(`http://localhost:${servePort}/api/stop-services`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                      });
                      console.log('Stopped app services');
                    } catch (error) {
                      console.error('Error stopping app services:', error);
                    }
                    // Restart PocketBase on port 8236 when closing preview
                    try {
                      await fetch(`http://localhost:${servePort}/api/restart-pocketbase`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                      });
                      console.log('Restarted PocketBase on port 8236');
                    } catch (error) {
                      console.error('Error restarting PocketBase:', error);
                    }
                  }
                  setShowPreview(!showPreview);
                }} className="border-gray-700 bg-gray-800/50 hover:bg-gray-700">
                  <Monitor className="h-4 w-4 mr-2" />
                  {showPreview ? t('tutorialEditor.hidePreview') : t('tutorialEditor.showPreview')}
                </Button>
                {showPreview && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => {
                      const iframe = document.querySelector('iframe');
                      if (iframe) {
                        iframe.src = iframe.src;
                      }
                    }} className="border-gray-700 bg-gray-800/50 hover:bg-gray-700">
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {t('tutorialEditor.refresh')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPreviewZoom(Math.max(50, previewZoom - 5))} className="border-gray-700 bg-gray-800/50 hover:bg-gray-700">
                      <ZoomOut className="h-4 w-4 mr-2" />
                      {previewZoom}%
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPreviewZoom(Math.min(150, previewZoom + 5))} className="border-gray-700 bg-gray-800/50 hover:bg-gray-700">
                      <ZoomIn className="h-4 w-4 mr-2" />
                      {previewZoom}%
                    </Button>

                    {/* Botón REC manual: graba el área del preview como MP4 sin
                        audio (mismo gdigrab que el flujo automático) y, al
                        detener, pasa la grabación al modal de Configuración
                        del Tutorial para nombrarla y seguir configurando. */}
                    {isRecordingManual ? (
                      <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-red-950/60 border border-red-500/60">
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                        </span>
                        <span className="text-xs font-semibold text-red-300">REC</span>
                        <span className="text-xs font-mono text-red-200 tabular-nums">
                          {String(Math.floor(recordingElapsedSec / 60)).padStart(2, '0')}:{String(recordingElapsedSec % 60).padStart(2, '0')}
                        </span>
                        <Button size="sm" onClick={handleRecStop} className="h-7 px-3 bg-red-600 hover:bg-red-500 text-white border-0">
                          <span className="mr-1.5">■</span>{t('tutorialEditor.stop')}</Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRecStart}
                        title={t('tutorialEditor.recordBaseVideoTitle')}
                        className="border-red-700/60 bg-red-950/40 hover:bg-red-900/60 text-red-300"
                      >
                        <span className="h-3 w-3 rounded-full bg-red-500 mr-2 inline-block"></span>
                        REC
                      </Button>
                    )}
                    {recordingError && !isRecordingManual && (
                      <span className="text-[10px] text-red-400/80 max-w-[160px] truncate" title={recordingError}>
                        {recordingError}
                      </span>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-hidden p-8 pb-0 pr-0">
          <AnimatePresence mode="wait">
            {/* Editor View */}
            <motion.div
              key="editor"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex gap-4 h-full editor-container overflow-hidden"
            >

              {/* Main Editor Area */}
              <div className="flex-1 flex flex-col gap-6 min-w-0 relative">
                {/* Preview Area */}
                <div className="flex-1 flex flex-col gap-6 min-w-0 relative">
                  <div className="flex-1 flex flex-col gap-6 min-w-0">
                    <div id="zeus-preview-container" className="h-full bg-gray-900 rounded-2xl border border-gray-800 shadow-2xl relative overflow-hidden group">
                      {/* Nota: NO se pinta ningún indicador rojo sobre el preview
                          mientras graba el REC manual, porque gdigrab captura los
                          píxeles reales de la pantalla y esos overlays quedarían
                          dentro del vídeo. El indicador vive solo en la toolbar
                          (fuera de la región capturada). */}
                      {/* Preview Tabs */}
                      <Tabs value={previewTab} onValueChange={(v) => setPreviewTab(v as 'server' | 'mp4')} className="h-full flex flex-col">
                        {/* Se ha eliminado la barra de pestañas (TabsList) interna para que el visor ocupe todo el espacio */}

                        <TabsContent value="server" className="flex-1 mt-0 relative">
                          {/* Fondo gris detrás del iframe para evitar pantalla blanca mientras carga */}
                          <div className="absolute inset-0 bg-gray-800 z-0"></div>
                          {/* Iframe siempre montado para no perder la sesión del preview */}
                          <iframe
                            src={`http://localhost:${previewPort}/`}
                            className={cn(
                              "w-full h-full border-0 absolute inset-0",
                              showPreview ? "visible z-10" : "invisible z-0"
                            )}
                            style={{
                              zoom: `${previewZoom / 100}`,
                              backgroundColor: '#1f2937',
                              background: '#1f2937'
                            }}
                            title="Application Preview"
                            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                          />
                          {/* Overlay oscuro mientras la app del preview arranca:
                              evita el destello blanco del visor antes de renderizar. */}
                          {showPreview && previewBooting && (
                            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#111827]">
                              <div className="text-center space-y-4">
                                <RefreshCw className="h-10 w-10 text-emerald-400 mx-auto animate-spin opacity-70" />
                                <p className="text-gray-400 text-sm">{t('tutorialEditor.loadingApp')}</p>
                              </div>
                            </div>
                          )}
                        </TabsContent>

                        <TabsContent value="mp4" className="flex-1 mt-0 relative">
                          {playingMp4 ? (
                            <>
                              <video
                                src={playingMp4}
                                className="w-full h-full absolute inset-0 object-contain bg-black"
                                style={{
                                  // Solo superponemos los ajustes sobre el MP4 si el usuario lo
                                  // activa en Ajustes. Por defecto OFF para ver el vídeo real (los
                                  // ajustes ya están horneados en el archivo generado).
                                  filter: applyAdjustsToPlayer
                                    ? `brightness(${videoBrightness}) contrast(${videoContrast}) saturate(${videoIntensity})`
                                    : 'none',
                                }}
                                controls
                                autoPlay
                              />
                              {/* Badge de referencia cuando hay ajustes activos y el usuario
                                  quiere verlos superpuestos sobre el MP4 ya creado */}
                              {applyAdjustsToPlayer && (videoBrightness !== 1.0 || videoContrast !== 1.0 || videoIntensity !== 1.0) && (
                                <div className="absolute top-2 left-2 z-30 bg-purple-600/90 text-white text-[10px] px-2 py-1 rounded-full font-semibold pointer-events-none flex items-center gap-1">
                                  <Settings className="h-3 w-3" />
                                  Vista previa con ajustes (referencia)
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117]">
                              <div className="text-center space-y-4">
                                <FileVideo className="h-16 w-16 text-emerald-400 mx-auto opacity-50" />
                                <p className="text-gray-400">{t('tutorialEditor.selectTutorialMp4')}</p>
                              </div>
                            </div>
                          )}
                        </TabsContent>
                      </Tabs>

                      {/* Captura overlay: cuando estamos añadiendo un punto, intercepta clics sobre el preview */}
                      {isCapturingPoint && showPreview && (
                        <div
                          className="absolute inset-0 z-50 cursor-crosshair bg-red-500/5 border-2 border-dashed border-red-500 animate-pulse"
                          onClick={(e) => {
                            // Coordenada relativa al rectángulo rojo (área de grabación), en píxeles CSS
                            // lógicos. recordingArea.x/y son coords relativas a la ventana (el rectángulo
                            // rojo de calibración es un overlay `fixed`), así que e.clientX - recordingArea.x
                            // da el desplazamiento desde el origen del área. Para que coincida con el MP4,
                            // el origen de grabación debe ser el mismo que el del rectángulo rojo, es decir,
                            // mouseOffsetX/Y deben valer 0 (la grabación se hace en el rectángulo rojo).
                            const relX = e.clientX - recordingArea.x;
                            const relY = e.clientY - recordingArea.y;
                            setPendingPoint({ x: Math.round(relX), y: Math.round(relY) });
                            setIsCapturingPoint(false);
                          }}
                        >
                          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] px-3 py-1 rounded-full font-bold pointer-events-none">
                            {t('tutorialEditor.clickElementToSave')}
                          </div>
                        </div>
                      )}

                      {/* Subtitles Overlay — shared for preview and playback */}
                      {subtitlesEnabled && (currentSubtitle || subtitlePreviewText) && (isPlaying || playbackStepIndex !== null || subtitlePreviewText || showPreview) && (() => {
                        // Live preview: prioritize tutorialSettings (in-memory edit) over currentTutorial.settings (saved).
                        // This way the user sees exactly what will be generated without having to press "Aplicar Cambios" first.
                        const s = tutorialSettings;
                        const saved = (currentTutorial?.settings as Partial<TutorialSettings>) || {};
                        const position = s.subtitlePosition ?? saved.subtitlePosition ?? 'bottom';
                        const fontSize = s.subtitleFontSize ?? saved.subtitleFontSize ?? 18;
                        const textColor = s.subtitleTextColor ?? saved.subtitleTextColor ?? '#ffffff';
                        const bgColor = s.subtitleBackgroundColor ?? saved.subtitleBackgroundColor ?? 'rgba(0,0,0,0.8)';
                        const fontFamily = s.subtitleFontFamily ?? saved.subtitleFontFamily ?? 'inherit';
                        const verticalOffset = s.subtitleVerticalOffset ?? saved.subtitleVerticalOffset ?? 0;
                        return (
                          <div
                            className={cn(
                              "absolute left-1/2 -translate-x-1/2 max-w-2xl px-6 py-3 rounded-xl z-[40] transition-all pointer-events-none",
                              position === 'top' && "top-8",
                              position === 'center' && "top-1/2 -translate-y-1/2",
                              position === 'bottom' && "bottom-24"
                            )}
                            style={{
                              backgroundColor: bgColor,
                              fontSize: `${fontSize}px`,
                              color: textColor,
                              fontFamily,
                              [position === 'top' ? 'marginTop' : 'marginBottom']: `${verticalOffset}px`,
                            }}
                          >
                            <p
                              className="text-center font-medium leading-relaxed"
                              style={{
                                fontSize: `${fontSize}px`,
                                color: textColor,
                                fontFamily,
                              }}
                            >{subtitlePreviewText || currentSubtitle}</p>
                          </div>
                        );
                      })()}

                      {/* Editor / Playback layer */}
                      {!showPreview && previewTab === 'server' && (
                        <>
                          <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117] z-20 rounded-2xl overflow-hidden">
                            {isPlaybackLoading && !playbackScreenshot ? (
                              <div className="text-center space-y-4">
                                <RefreshCw className="h-12 w-12 text-blue-500 mx-auto animate-spin" />
                                <p className="text-gray-400">{t('tutorialEditor.loadingStep')}</p>
                              </div>
                            ) : playbackScreenshot ? (
                              <img 
                                src={normalizeImageSrc(playbackScreenshot)} 
                                alt="Paso actual" 
                                className="w-full h-full object-contain"
                                style={{
                                  filter: `brightness(${videoBrightness}) contrast(${videoContrast}) saturate(${videoIntensity})`,
                                }}
                              />
                            ) : playbackStepIndex !== null && currentTutorial?.steps?.[playbackStepIndex] ? (
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-[#0f172a] via-[#1e293b] to-[#0f172a] z-20">
                                {/* Número de paso grande con círculo */}
                                <div className="relative mb-8">
                                  <div className="w-32 h-32 rounded-full bg-blue-600/20 border-4 border-blue-500/40 flex items-center justify-center animate-pulse">
                                    <span className="text-6xl font-bold text-blue-400">{playbackStepIndex + 1}</span>
                                  </div>
                                  <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full bg-emerald-500/20 border-2 border-emerald-400/40 flex items-center justify-center">
                                    <span className="text-xs font-bold text-emerald-400">{currentTutorial.steps.length}</span>
                                  </div>
                                </div>

                                {/* Descripción principal */}
                                <h3 className="text-2xl md:text-3xl font-bold text-white text-center max-w-2xl px-8 leading-relaxed mb-6">
                                  {currentTutorial.steps[playbackStepIndex].description}
                                </h3>

                                {/* Detalles del paso */}
                                <div className="flex flex-wrap justify-center gap-3 mb-6">
                                  <span className="px-4 py-2 bg-blue-600/20 text-blue-300 text-sm font-medium rounded-full border border-blue-500/30 flex items-center gap-2">
                                    <Monitor className="h-4 w-4" />
                                    {t('tutorialEditor.action')}: {currentTutorial.steps[playbackStepIndex].action}
                                  </span>
                                  <span className="px-4 py-2 bg-gray-700/50 text-gray-300 text-sm font-medium rounded-full border border-gray-600/50 flex items-center gap-2">
                                    <Clock className="h-4 w-4" />
                                    {currentTutorial.steps[playbackStepIndex].duration}s
                                  </span>
                                </div>

                                {/* Target si existe */}
                                {currentTutorial.steps[playbackStepIndex].target && (
                                  <div className="px-4 py-2 bg-gray-800/50 text-gray-400 text-xs rounded-lg border border-gray-700/50 mb-4">
                                    <span className="font-semibold text-gray-300">Elemento:</span> {currentTutorial.steps[playbackStepIndex].target}
                                  </div>
                                )}

                                {/* Indicador visual de que no hay screenshot */}
                                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-yellow-500/10 text-yellow-400 text-xs rounded-full border border-yellow-500/20">
                                  <Image className="h-3 w-3" />
                                  {t('tutorialEditor.tutorialBeforeAutoCapture')}
                                </div>
                              </div>
                            ) : currentTutorial?.metadata?.thumbnail ? (
                              <img src={normalizeImageSrc(currentTutorial.metadata.thumbnail)} alt="" className="w-full h-full object-contain" />
                            ) : (
                              <div className="text-center space-y-4">
                                <Video className="h-16 w-16 text-gray-700 mx-auto" />
                                <p className="text-gray-600">{t('tutorialEditor.videoNotAvailable')}</p>
                              </div>
                            )}
                          </div>

                          {/* Playback Controls Overlay */}
                          <div className="absolute bottom-0 inset-x-0 h-12 flex items-center px-6 gap-3 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-white"
                              onClick={togglePlayback}
                              disabled={!currentTutorial || currentTutorial.steps?.length === 0}
                            >
                              {isPlaying ? (
                                <Pause className="h-6 w-6 fill-white" />
                              ) : (
                                <Play className="h-6 w-6 fill-white" />
                              )}
                            </Button>
                            {(isPlaying || playbackStepIndex !== null) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-white"
                                onClick={stopPlayback}
                              >
                                <StopCircle className="h-6 w-6" />
                              </Button>
                            )}
                            <div className="flex-1 h-1 rounded-full relative">
                              {currentTutorial && currentTutorial.steps && currentTutorial.steps.length > 0 && (
                                <>
                                  <div
                                    className="absolute inset-y-0 left-0 bg-blue-500 rounded-full transition-all"
                                    style={{
                                      width: `${playbackStepIndex !== null
                                        ? ((playbackStepIndex + 1) / currentTutorial.steps.length) * 100
                                        : 0}%`,
                                    }}
                                  />
                                  <div
                                    className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg transition-all"
                                    style={{
                                      left: `${playbackStepIndex !== null
                                        ? (playbackStepIndex / Math.max(currentTutorial.steps.length - 1, 1)) * 100
                                        : 0}%`,
                                    }}
                                  />
                                </>
                              )}
                            </div>
                            <span className="text-xs font-mono text-gray-300">
                              {playbackStepIndex !== null
                                ? t('tutorialEditor.stepProgress', { n: playbackStepIndex + 1, total: currentTutorial?.steps?.length || 0 })
                                : t('tutorialEditor.ready')}
                            </span>
                          </div>
                        </>
                      )}
                    </div>

                    {/* t('tutorialEditor.timelineTab') / Steps con pestañas */}
                    <div className="bg-[#161b22] border border-gray-800 rounded-2xl flex flex-col min-w-0 overflow-hidden" style={{ height: !currentTutorial ? '150px' : ((timelineTab === 'cards' || timelineTab === 'subtitles' || timelineTab === 'settings') ? '600px' : (timelineTab === 'timeline' && previewTab === 'mp4' && playingMp4 ? '420px' : (currentTutorial.steps?.length === 0 ? '150px' : '300px'))), maxWidth: '100%' }}>
                      <Tabs value={timelineTab} onValueChange={(v) => setTimelineTab(v as 'timeline' | 'subtitles' | 'cards' | 'settings')} className="flex-1 flex flex-col h-full min-w-0">
                        <div className="flex items-center gap-3 px-2 border-b border-gray-800 bg-[#161b22] h-10 flex-shrink-0">
                          <TabsList className="justify-start rounded-none border-0 bg-transparent p-0 h-10">
                            <TabsTrigger value="timeline" className="data-[state=active]:bg-[#0d1117] data-[state=active]:text-blue-400">
                              <Film className="h-4 w-4 mr-2" />
                              {t('tutorialEditor.timelineTab')}
                            </TabsTrigger>
                            <TabsTrigger value="subtitles" className="data-[state=active]:bg-[#0d1117] data-[state=active]:text-emerald-400">
                              <Type className="h-4 w-4 mr-2" />
                              {t('tutorialEditor.subsVoiceTab')}
                            </TabsTrigger>
                            <TabsTrigger value="cards" className="data-[state=active]:bg-[#0d1117] data-[state=active]:text-amber-400">
                              <Layers className="h-4 w-4 mr-2" />{t('tutorialEditor.cards')}</TabsTrigger>
                            <TabsTrigger value="settings" className="data-[state=active]:bg-[#0d1117] data-[state=active]:text-purple-400">
                              <Settings className="h-4 w-4 mr-2" />
                              {t('tutorialEditor.settings')}
                            </TabsTrigger>
                          </TabsList>

                          {/* Barra de progreso del export (entre las pestañas y el botón) */}
                          {mp4ExportRebuilding && (
                            <div className="flex-1 min-w-[120px] max-w-[280px]">
                              <div className="flex justify-between text-[11px] text-gray-400 mb-0.5">
                                <span className="truncate">{mp4ExportMessage}</span>
                                <span className="ml-2 flex-shrink-0">{mp4ExportProgress}%</span>
                              </div>
                              <div className="h-1.5 bg-gray-800 rounded overflow-hidden">
                                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${mp4ExportProgress}%` }} />
                              </div>
                            </div>
                          )}

                          {/* Botón {t('tutorialEditor.exportMp4')} (parte derecha, al final) */}
                          <Button
                            size="sm"
                            onClick={handleExportMp4}
                            disabled={!currentTutorial?.metadata?.rawVideoPath || mp4ExportRebuilding}
                            className="ml-auto h-8 px-3 bg-emerald-600 hover:bg-emerald-500 [&]:!text-emerald-950"
                            style={{ color: '#022c22' }}
                          >
                            <RefreshCw className={cn("h-4 w-4 mr-2", mp4ExportRebuilding && "animate-spin")} />
                            {mp4ExportRebuilding ? t('tutorialEditor.regenerating') : t('tutorialEditor.exportMp4')}
                          </Button>
                        </div>

                        {/* Pestaña t('tutorialEditor.timelineTab') - El timeline actual */}
                        <TabsContent value="timeline" className="flex-1 mt-0 p-4 pb-0 h-full overflow-hidden min-w-0 w-full relative">
                          {(previewTab === 'mp4' && playingMp4 && currentTutorial) ? (
                            <VideoTrimmerPanel
                              key={currentTutorial.id}
                              videoSrc={playingMp4}
                              onExport={handleTrimExport}
                              rebuilding={trimRebuilding}
                              progress={trimProgress}
                              message={trimMessage}
                            />
                          ) : (
                          <div className="absolute inset-0 overflow-x-auto overflow-y-hidden pb-1 timeline-scrollbar">
                            <div className="flex gap-4 min-w-max" style={{ width: 'max-content' }}>
                              {currentTutorial?.steps?.map((step, idx) => {
                                const isActive = playbackStepIndex === idx;
                                return (
                                  <div key={idx} className="flex-shrink-0 w-48 space-y-2">
                                    <div
                                      className={cn(
                                        "aspect-video bg-gray-800 rounded-xl border overflow-hidden relative group cursor-pointer transition-all",
                                        isActive ? "border-blue-500 ring-2 ring-blue-500/30" : "border-gray-700 hover:border-gray-500"
                                      )}
                                      onClick={() => {
                                        if (currentTutorial) {
                                          stopPlayback();
                                          setIsPlaying(true);
                                          runPlaybackStep(idx as number);
                                        }
                                      }}
                                    >
                                      {step.screenshot ? (
                                        <img
                                          src={normalizeImageSrc(step.screenshot)}
                                          alt={`Paso ${(idx as number) + 1}`}
                                          className="w-full h-full object-cover opacity-80"
                                          style={{
                                            filter: `brightness(${videoBrightness}) contrast(${videoContrast}) saturate(${videoIntensity})`,
                                          }}
                                        />
                                      ) : (
                                        <img
                                          src={`https://api.dicebear.com/7.x/shapes/svg?seed=${idx}`}
                                          alt="" 
                                          className="w-full h-full object-cover opacity-50"
                                          style={{
                                            filter: `brightness(${videoBrightness}) contrast(${videoContrast}) saturate(${videoIntensity})`,
                                          }}
                                        />
                                      )}
                                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                                        <Play className="h-6 w-6 text-white" />
                                      </div>
                                      {isActive && (
                                        <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-blue-600 text-white text-[10px] rounded font-bold">
                                          ACTIVO
                                        </div>
                                      )}
                                      <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/80 text-[10px] rounded">
                                        {step.duration}s
                                      </div>
                                    </div>
                                    <p className={cn(
                                      "text-[10px] truncate font-medium uppercase tracking-tight",
                                      isActive ? "text-blue-400" : "text-gray-400"
                                    )}>{t('tutorialEditor.stepN', { n: (idx as number) + 1, action: step.action })}</p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          )}
                        </TabsContent>

                        {/* Pestaña t('tutorialEditor.subsVoiceTab') - Editor de timeline */}
                        <TabsContent value="subtitles" className="flex-1 mt-0 p-4 pb-0 h-full overflow-hidden min-w-0">
                          {currentTutorial && (
                            <TimelineEditorPanel
                              tutorial={currentTutorial}
                              editedSteps={editedSteps}
                              setEditedSteps={setEditedSteps}
                            />
                          )}
                        </TabsContent>

                        {/* Pestaña Tarjetas - Tarjetas de edición en scroll horizontal */}
                        <TabsContent value="cards" className="flex-1 mt-0 p-4 pb-0 h-full overflow-hidden min-w-0">
                          <div className="flex gap-4 h-full">
                            <div className="flex-1 overflow-hidden">
                              {currentTutorial && (
                                <TimelineCardsPanel
                                  tutorial={currentTutorial}
                                  onRebuilt={(updated) => {
                                    setCurrentTutorial(updated);
                                    setEditedSteps(buildEditedSteps(updated).steps);
                                    setTutorials(prev => prev.map(t => t.id === updated.id ? updated : t));
                                  } }
                                  toast={toast}
                                  onExport={(exportFn) => {
                                    cardsExportRef.current = exportFn;
                                  } }
                                  isRebuilding={cardsIsRebuilding}
                                  progress={cardsProgress}
                                  message={cardsMessage}
                                  videoBrightness={videoBrightness}
                                  videoContrast={videoContrast}
                                  videoIntensity={videoIntensity}
                                  videoTimeOffset={videoTimeOffset}
                                  voiceoverVolume={tutorialSettings.voiceoverVolume ?? 0.8}
                                  musicVolume={tutorialSettings.musicVolume ?? 0.3}
                                  editedSteps={editedSteps}
                                  setEditedSteps={setEditedSteps}
                                  onExportTabs={openTransferExport}
                                  onImportTabs={openTransferImport}
                                />
                              )}
                            </div>
                            <div className="flex flex-col gap-2">
                              {cardsIsRebuilding && (
                                <div className="w-48">
                                  <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                                    <span>{cardsMessage}</span>
                                    <span>{cardsProgress}%</span>
                                  </div>
                                  <Button
                                    size="sm"
                                    onClick={() => cardsExportRef.current?.()}
                                    disabled={!currentTutorial?.metadata?.rawVideoPath || cardsIsRebuilding}
                                    className="bg-emerald-600 hover:bg-emerald-500"
                                  >
                                    <RefreshCw className={cn("h-4 w-4 mr-2", cardsIsRebuilding && "animate-spin")} />
                                    {cardsIsRebuilding ? t('tutorialEditor.regenerating') : t('tutorialEditor.exportMp4')}
                                  </Button>
                                  <div className="h-1.5 bg-gray-800 rounded overflow-hidden">
                                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${cardsProgress}%` }} />
                                  </div>
                                </div>
                              )}

                            </div>
                          </div>
                        </TabsContent>

                        {/* Pestaña Ajustes - Controles de brillo, contraste e intensidad */}
                        <TabsContent value="settings" className="flex-1 mt-0 p-4 pb-0 h-full overflow-y-auto custom-scrollbar min-w-0">
                          <div className="flex flex-col gap-4">
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-semibold text-white">{t('tutorialEditor.mp4Settings')}</h3>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setVideoTimeOffset(prev => prev - 1)}
                                  className="border-gray-700 bg-gray-800/50 hover:bg-gray-700"
                                >
                                  <SkipBack className="h-4 w-4 mr-2" />
                                  -1s
                                </Button>
                                <span className="text-xs text-white font-mono w-16 text-center">
                                  {videoTimeOffset > 0 ? `+${videoTimeOffset}s` : `${videoTimeOffset}s`}
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setVideoTimeOffset(prev => prev + 1)}
                                  className="border-gray-700 bg-gray-800/50 hover:bg-gray-700"
                                >
                                  +1s
                                  <SkipForward className="h-4 w-4 ml-2" />
                                </Button>
                                <div className="w-px h-6 bg-gray-700 mx-2" />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={async () => {
                                    try {
                                      const saved = await Api.api_ajustes_upsert({
                                        brillo: videoBrightness,
                                        contraste: videoContrast,
                                        intensidad: videoIntensity,
                                        tiempo_inicio: videoTimeOffset,
                                      }, ajustesId || undefined);
                                      setAjustesId(saved.id);
                                      toast({ title: 'Ajustes guardados', description: 'Ajustes de video guardados en PocketBase.' });
                                    } catch {
                                      toast({ title: t('tutorialEditor.errSaveSettings'), variant: 'destructive' });
                                    }
                                  }}
                                  className="border-emerald-700 bg-emerald-900/20 hover:bg-emerald-900/40 text-emerald-300"
                                >
                                  <Save className="h-4 w-4 mr-2" />
                                  {t('tutorialEditor.save')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setVideoBrightness(1.0);
                                    setVideoContrast(1.0);
                                    setVideoIntensity(1.0);
                                    setVideoTimeOffset(0);
                                  }}
                                  className="border-gray-700 bg-gray-800/50 hover:bg-gray-700"
                                >
                                  <RotateCcw className="h-4 w-4 mr-2" />{t('tutorialEditor.reset')}</Button>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={applyAdjustsToPlayer}
                                onClick={() => setApplyAdjustsToPlayer(v => !v)}
                                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${applyAdjustsToPlayer ? 'bg-emerald-600' : 'bg-gray-700'}`}
                              >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${applyAdjustsToPlayer ? 'translate-x-4' : 'translate-x-0.5'}`} />
                              </button>
                              <Label
                                className="text-xs text-gray-300 select-none cursor-pointer"
                                onClick={() => setApplyAdjustsToPlayer(v => !v)}
                              >{t('tutorialEditor.applySettingsToMp4')}</Label>
                              <span className="text-[10px] text-gray-500">
                                {t('tutorialEditor.offOnHint')}
                              </span>
                            </div>

                            <div className="flex items-end pb-4">
                              <div className="flex gap-4 w-full">
                                <div className="flex-1 min-w-0 space-y-2">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-xs text-gray-400">{t('tutorialEditor.brightness')}</Label>
                                    <span className="text-xs text-white font-mono">{videoBrightness.toFixed(2)}</span>
                                  </div>
                                  <Slider
                                    value={[videoBrightness]}
                                    onValueChange={(value) => setVideoBrightness(value[0])}
                                    min={0}
                                    max={2}
                                    step={0.05}
                                    className="w-full"
                                  />
                                </div>

                                <div className="flex-1 min-w-0 space-y-2">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-xs text-gray-400">{t('tutorialEditor.contrast')}</Label>
                                    <span className="text-xs text-white font-mono">{videoContrast.toFixed(2)}</span>
                                  </div>
                                  <Slider
                                    value={[videoContrast]}
                                    onValueChange={(value) => setVideoContrast(value[0])}
                                    min={0}
                                    max={2}
                                    step={0.05}
                                    className="w-full"
                                  />
                                </div>

                                <div className="flex-1 min-w-0 space-y-2">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-xs text-gray-400">{t('tutorialEditor.intensity')}</Label>
                                    <span className="text-xs text-white font-mono">{videoIntensity.toFixed(2)}</span>
                                  </div>
                                  <Slider
                                    value={[videoIntensity]}
                                    onValueChange={(value) => setVideoIntensity(value[0])}
                                    min={0}
                                    max={2}
                                    step={0.05}
                                    className="w-full"
                                  />
                                </div>

                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-800">
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <Label className="text-xs text-gray-400">{t('tutorialEditor.voiceover')}</Label>
                                  <span className="text-xs text-white font-mono">{Math.round((tutorialSettings.voiceoverVolume ?? 0.8) * 100)}%</span>
                                </div>
                                <Slider
                                  value={[(tutorialSettings.voiceoverVolume ?? 0.8) * 100]}
                                  onValueChange={(value) => setTutorialSettings((prev: any) => ({ ...prev, voiceoverVolume: value[0] / 100 }))}
                                  min={0}
                                  max={100}
                                  step={1}
                                  className="w-full"
                                />
                              </div>
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <Label className="text-xs text-gray-400">{t('tutorialEditor.bgMusic')}</Label>
                                  <span className="text-xs text-white font-mono">{Math.round((tutorialSettings.musicVolume ?? 0.3) * 100)}%</span>
                                </div>
                                <Slider
                                  value={[(tutorialSettings.musicVolume ?? 0.3) * 100]}
                                  onValueChange={(value) => setTutorialSettings((prev: any) => ({ ...prev, musicVolume: value[0] / 100 }))}
                                  min={0}
                                  max={100}
                                  step={1}
                                  className="w-full"
                                />
                              </div>
                            </div>

                            <div className="pt-4 border-t border-gray-800">
                              <p className="text-[10px] text-gray-500">{t('tutorialEditor.videoSettingsHint')}</p>
                            </div>
                          </div>
                        </TabsContent>
                      </Tabs>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Panel - Generation + Post-Production stacked */}
              <div className="flex flex-col gap-4 min-w-64 shrink-0 h-full" style={{ width: `${SIDEBAR_WIDTH}px` }}>

                {/* Generación de Tutorial */}
                <div className="bg-[#161b22] border border-gray-800 rounded-2xl flex flex-col flex-1 min-h-0 h-full">
                  <div className="p-4 border-b border-gray-800">
                    <h3 className="text-base font-semibold text-white mb-0.5">{t('tutorialEditor.tutorialGeneration')}</h3>
                    <p className="text-xs text-gray-400">{t('tutorialEditor.tutorialGenerationDesc')}</p>
                  </div>
                  {/* Tabs */}
                  <div className="flex border-b border-gray-800">
                    <button
                      onClick={() => setGenerationTab('generate')}
                      className={cn(
                        "flex-1 py-2 text-xs font-medium transition-colors",
                        generationTab === 'generate' ? "text-blue-400 border-b-2 border-blue-500 bg-blue-500/10" : "text-gray-400 hover:text-white"
                      )}
                    >{t('tutorialEditor.generate')}</button>
                    <button
                      onClick={() => setGenerationTab('coordinates')}
                      className={cn(
                        "flex-1 py-2 text-xs font-medium transition-colors",
                        generationTab === 'coordinates' ? "text-emerald-400 border-b-2 border-emerald-500 bg-emerald-500/10" : "text-gray-400 hover:text-white"
                      )}
                    >
                      {t('tutorialEditor.coordinatesTab', { n: controlPointsReal.length })}
                    </button>
                    <button
                      onClick={() => setGenerationTab('subtitles')}
                      className={cn(
                        "flex-1 py-2 text-xs font-medium transition-colors",
                        generationTab === 'subtitles' ? "text-amber-400 border-b-2 border-amber-500 bg-amber-500/10" : "text-gray-400 hover:text-white"
                      )}
                    >{t('tutorialEditor.subtitles')}</button>
                    <button
                      onClick={() => setGenerationTab('maps')}
                      className={cn(
                        "flex-1 py-2 text-xs font-medium transition-colors",
                        generationTab === 'maps' ? "text-purple-400 border-b-2 border-purple-500 bg-purple-500/10" : "text-gray-400 hover:text-white"
                      )}
                    >
                      {t('tutorialEditor.mapsTab', { n: screens.length })}
                    </button>
                  </div>

                  {generationTab === 'generate' && (
                    <div className="flex-1 p-4 space-y-4 overflow-y-auto custom-scrollbar min-h-0">
                      <div className="space-y-2">
                        <Label className="text-gray-400 text-sm">{t('tutorialEditor.existingTutorial')}</Label>
                        <select
                          className="w-full bg-[#0d1117] border border-gray-700 rounded-lg p-2.5 text-white text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                          value={currentTutorial?.id || ''}
                          onChange={(e) => {
                            const selected = tutorials.find(t => t.id === e.target.value) || null;
                            setCurrentTutorial(selected);
                          }}
                        >
                          <option value="">{t('tutorialEditor.selectTutorial')}</option>
                          {tutorials.map(t => (
                            <option key={t.id} value={t.id}>{t.title}</option>
                          ))}
                        </select>
                        {tutorials.length === 0 && (
                          <p className="text-[10px] text-gray-500">{t('tutorialEditor.noTutorialsSaved')}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-400 text-sm">{t('tutorialEditor.tutorialDesc')}</Label>
                        <textarea
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          placeholder={t('tutorialEditor.describeWhatToShow')}
                          className="w-full h-28 bg-[#0d1117] border border-gray-700 rounded-lg p-3 text-white text-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all resize-none"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-400 text-sm">{t('tutorialEditor.stepsOptional')}</Label>
                        <textarea
                          value={manualSteps}
                          onChange={(e) => setManualSteps(e.target.value)}
                          placeholder={t('tutorialEditor.stepsPlaceholder')}
                          className="w-full h-24 bg-[#0d1117] border border-gray-700 rounded-lg p-3 text-white text-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all resize-none"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-gray-400 text-sm">{t('tutorialEditor.stepCount')}</Label>
                        <input
                          type="number"
                          value={stepsCount}
                          onChange={(e) => setStepsCount(parseInt(e.target.value) || 9)}
                          min="1"
                          max="50"
                          className="w-full bg-[#0d1117] border border-gray-700 rounded-lg p-2.5 text-white text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-gray-400 text-sm">{t('tutorialEditor.targetApp')}</Label>
                        <div
                          className="flex items-center gap-2 bg-[#0d1117] border border-gray-700 rounded-lg p-2.5 text-gray-300 text-sm cursor-pointer hover:border-blue-500 transition-colors"
                          onClick={handleSelectFolder}
                        >
                          <Monitor className="h-4 w-4 shrink-0" />
                          <span className="truncate">
                            {t('tutorialEditor.selectFolder')}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1 h-11 border-gray-700 bg-gray-800/50 hover:bg-gray-700 font-bold rounded-lg"
                          onClick={handleTestCapture}
                          disabled={isCapturingTest || isGenerating}
                        >
                          <Camera className={cn("h-4 w-4 mr-2", isCapturingTest && "animate-pulse")} />
                          {isCapturingTest ? '...' : t('tutorialEditor.test')}
                        </Button>
                        <Button
                          className="flex-[2] h-11 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 font-bold rounded-lg shadow-lg shadow-blue-500/20"
                          onClick={handleGenerate}
                          disabled={isGenerating || isCapturingTest}
                        >
                          {isGenerating ? (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                              Generando...
                            </>
                          ) : (
                            <>
                              <Wand2 className="h-4 w-4 mr-2" />{t('tutorialEditor.generateTutorial')}</>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                  {generationTab === 'coordinates' && (
                    <div className="flex-1 p-4 space-y-4 overflow-y-auto custom-scrollbar min-h-0">
                      <div className="space-y-2">
                        <p className="text-xs text-gray-400">
                          {t('tutorialEditor.defineClickPoints')}
                        </p>

                        {/* Ajustes independientes: área roja, ratón real y puntero virtual */}
                        <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-3 space-y-4">
                          <p className="text-xs font-semibold text-gray-300 flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-red-500" />{t('tutorialEditor.redAreaCorrection')}</p>
                          <p className="text-[10px] text-gray-500 leading-tight">{t('tutorialEditor.redAreaCorrectionDesc')}</p>
                          <div className="flex gap-2">
                            <div className="flex-1 space-y-1">
                              <Label className="text-[10px] text-gray-500">{t('tutorialEditor.coordOffsetX')}</Label>
                              <Input
                                type="number"
                                value={mouseOffsetX}
                                onChange={(e) => setMouseOffsetX(parseInt(e.target.value || '0', 10))}
                                className="h-8 bg-gray-900 border-gray-600 text-xs"
                              />
                            </div>
                            <div className="flex-1 space-y-1">
                              <Label className="text-[10px] text-gray-500">{t('tutorialEditor.coordOffsetY')}</Label>
                              <Input
                                type="number"
                                value={mouseOffsetY}
                                onChange={(e) => setMouseOffsetY(parseInt(e.target.value || '0', 10))}
                                className="h-8 bg-gray-900 border-gray-600 text-xs"
                              />
                            </div>
                          </div>

                          <p className="text-xs font-semibold text-gray-300 flex items-center gap-2 pt-1 border-t border-gray-700">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />{t('tutorialEditor.mouseCorrection')}</p>
                          <p className="text-[10px] text-gray-500 leading-tight">{t('tutorialEditor.mouseCorrectionDesc')}</p>
                          <div className="flex gap-2">
                            <div className="flex-1 space-y-1">
                              <Label className="text-[10px] text-gray-500">{t('tutorialEditor.coordRealX')}</Label>
                              <Input
                                type="number"
                                value={realMouseOffsetX}
                                onChange={(e) => setRealMouseOffsetX(parseInt(e.target.value || '0', 10))}
                                className="h-8 bg-gray-900 border-gray-600 text-xs"
                              />
                            </div>
                            <div className="flex-1 space-y-1">
                              <Label className="text-[10px] text-gray-500">{t('tutorialEditor.coordRealY')}</Label>
                              <Input
                                type="number"
                                value={realMouseOffsetY}
                                onChange={(e) => setRealMouseOffsetY(parseInt(e.target.value || '0', 10))}
                                className="h-8 bg-gray-900 border-gray-600 text-xs"
                              />
                            </div>
                          </div>

                          <p className="text-xs font-semibold text-gray-300 flex items-center gap-2 pt-1 border-t border-gray-700">
                            <span className="h-2 w-2 rounded-full bg-amber-500" />{t('tutorialEditor.mouseScale')}</p>
                          <p className="text-[10px] text-gray-500 leading-tight">{t('tutorialEditor.scaleHint')}</p>
                          <div className="flex gap-2">
                            <div className="flex-1 space-y-1">
                              <Label className="text-[10px] text-gray-500">{t('tutorialEditor.coordScaleX')}</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={realMouseScaleX}
                                onChange={(e) => setRealMouseScaleX(parseFloat(e.target.value || '1'))}
                                className="h-8 bg-gray-900 border-gray-600 text-xs"
                              />
                            </div>
                            <div className="flex-1 space-y-1">
                              <Label className="text-[10px] text-gray-500">{t('tutorialEditor.coordScaleY')}</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={realMouseScaleY}
                                onChange={(e) => setRealMouseScaleY(parseFloat(e.target.value || '1'))}
                                className="h-8 bg-gray-900 border-gray-600 text-xs"
                              />
                            </div>
                          </div>

                        </div>

                        <Button
                          variant="outline"
                          className="w-full h-11 border-emerald-700 bg-emerald-900/20 hover:bg-emerald-900/40 text-emerald-300 font-bold rounded-lg"
                          onClick={() => {
                            setIsCapturingPoint(true);
                            if (!showPreview) setShowPreview(true);
                            toast({ title: 'Modo captura activado', description: 'Haz clic dentro del preview para guardar un punto.' });
                          }}
                          disabled={isCapturingPoint}
                        >
                          {isCapturingPoint ? t('tutorialEditor.clickInPreview') : t('tutorialEditor.addClickPoint')}
                        </Button>

                        <Button
                          className="w-full h-11 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 font-bold rounded-lg shadow-lg shadow-blue-500/20"
                          onClick={async () => {
                            try {
                              const saved = await Api.api_point_zero_upsert({
                                zeus_mouse_offset_x: mouseOffsetX,
                                zeus_mouse_offset_y: mouseOffsetY,
                                zeus_real_mouse_offset_x: realMouseOffsetX,
                                zeus_real_mouse_offset_y: realMouseOffsetY,
                                real_mouse_scale_x: realMouseScaleX,
                                real_mouse_scale_y: realMouseScaleY,
                                zeus_virtual_mouse_offset_x: virtualMouseOffsetX,
                                zeus_virtual_mouse_offset_y: virtualMouseOffsetY,
                              }, pointZeroId);
                              setPointZeroId(saved.id);
                              toast({ title: 'Correcciones guardadas', description: 'Offsets guardados en PocketBase (point_zero).' });
                            } catch {
                              toast({ title: 'Error al guardar correcciones', variant: 'destructive' });
                            }
                          }}
                        >
                          <Save className="h-4 w-4 mr-2" />{t('tutorialEditor.saveCorrections')}</Button>

                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            <Input
                              placeholder="x,y  (ej: 120,340)"
                              value={manualPointText}
                              onChange={(e) => setManualPointText(e.target.value)}
                              className="flex-1 bg-[#0d1117] border-gray-700 text-xs"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-blue-700 bg-blue-900/20 hover:bg-blue-900/40 text-blue-200"
                              onClick={async () => {
                                const match = manualPointText.match(/(\d+)\s*,\s*(\d+)/);
                                if (!match) {
                                  toast({ title: t('tutorialEditor.invalidFormat'), description: 'Usa x,y, por ejemplo: 120,340', variant: 'destructive' });
                                  return;
                                }
                                const x = parseInt(match[1], 10);
                                const y = parseInt(match[2], 10);
                                if (x < 0 || y < 0 || x > recordingArea.width || y > recordingArea.height) {
                                  toast({
                                    title: t('tutorialEditor.coordOutOfArea'),
                                    description: t('tutorialEditor.areaIsDesc', { w: recordingArea.width, h: recordingArea.height }),
                                    variant: 'destructive',
                                  });
                                  return;
                                }
                                try {
                                  setIsCapturingTest(true);
                                  // Mover ratón real a la coordenada relativa del área de grabación
                                  const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
                                  let windowX = window.screenLeft || window.screenX || 0;
                                  let windowY = window.screenTop || window.screenY || 0;
                                  let boundsDebug = null;
                                  if ((window as any).electronAPI?.getWindowBounds) {
                                    const bounds = await (window as any).electronAPI.getWindowBounds();
                                    boundsDebug = bounds;
                                    if (bounds && bounds.content) {
                                      windowX = bounds.content.x;
                                      windowY = bounds.content.y;
                                    }
                                  }
                                  const areaPhysicalX = Math.round((windowX + recordingArea.x + mouseOffsetX) * dpr);
                                  const areaPhysicalY = Math.round((windowY + recordingArea.y + mouseOffsetY) * dpr);
                                  const physicalX = areaPhysicalX + Math.round(x * dpr * realMouseScaleX) + realMouseOffsetX;
                                  const physicalY = areaPhysicalY + Math.round(y * dpr * realMouseScaleY) + realMouseOffsetY;
                                  await fetch(`http://localhost:${servePort}/api/desktop/action`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ type: 'click', x: physicalX, y: physicalY }),
                                  });

                                  if (captureTestScreenshot) {
                                    // Capturar pantalla para ver dónde quedó
                                    const clip = {
                                      x: Math.round((windowX + recordingArea.x + mouseOffsetX) * dpr),
                                      y: Math.round((windowY + recordingArea.y + mouseOffsetY) * dpr),
                                      width: Math.round(recordingArea.width * dpr),
                                      height: Math.round(recordingArea.height * dpr),
                                    };
                                    // Posición absoluta del puntero virtual: área + punto + corrección virtual
                                    const virtualCursorX = areaPhysicalX + Math.round(x * dpr) + virtualMouseOffsetX;
                                    const virtualCursorY = areaPhysicalY + Math.round(y * dpr) + virtualMouseOffsetY;
                                    const response = await fetch(`http://localhost:${servePort}/api/desktop/screenshot`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        filename: `test-point-${Date.now()}.png`,
                                        clip,
                                        cursorPosition: { x: virtualCursorX, y: virtualCursorY },
                                        cursorImagePath: cursorImagePath || undefined,
                                      }),
                                    });
                                    if (!response.ok) throw new Error('Error capturando');
                                    const data = await response.json();
                                    if (data.screenshot) {
                                      setPlaybackScreenshot(data.screenshot);
                                      setShowPreview(false);
                                    }
                                    toast({ title: t('tutorialEditor.testCoord', { x, y }), description: t('tutorialEditor.mouseMovedCaptured') });
                                  } else {
                                    toast({ title: t('tutorialEditor.testCoord', { x, y }), description: t('tutorialEditor.mouseMovedNoCapture') });
                                  }
                                } catch (err: any) {
                                  toast({ title: 'Error', description: err.message, variant: 'destructive' });
                                } finally {
                                  setIsCapturingTest(false);
                                }
                              }}
                            >{t('tutorialEditor.test')}</Button>
                          </div>
                          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
                              checked={captureTestScreenshot}
                              onChange={(e) => setCaptureTestScreenshot(e.target.checked)}
                            />{t('tutorialEditor.captureScreenOnTest')}</label>
                        </div>
                      </div>

                      {controlPointsReal.length === 0 ? (
                        <p className="text-xs text-gray-500 text-center py-4">No hay puntos guardados</p>
                      ) : (
                        <>
                          {/* Selector de pantalla actual + agrupado */}
                          <div className="mb-3 flex items-center gap-2">
                            <select
                              className="flex-1 h-8 bg-[#0d1117] border border-gray-700 rounded px-2 text-xs text-white"
                              value={currentScreenId || ''}
                              onChange={(e) => setCurrentScreenId(e.target.value || null)}
                            >
                              <option value="">{t('tutorialEditor.noScreenAll')}</option>
                              {screens.map(s => (
                                <option key={s.id} value={s.id}>{s.name}{s.tab ? ` · ${s.tab}` : ''}</option>
                              ))}
                            </select>
                            <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer select-none whitespace-nowrap">
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-purple-600 focus:ring-purple-500"
                                checked={groupByScreen}
                                onChange={(e) => setGroupByScreen(e.target.checked)}
                              />{t('tutorialEditor.group')}</label>
                          </div>
                          <div className="mb-3">
                            <Input
                              placeholder={t('tutorialEditor.searchPoints')}
                              value={controlPointSearch}
                              onChange={(e) => setControlPointSearch(e.target.value)}
                              className="bg-[#0d1117] border-gray-700 text-white placeholder-gray-500 text-sm h-8"
                            />
                          </div>
                          {(() => {
                            const screenName = (id: string | null | undefined) =>
                              (id ? screens.find(s => s.id === id)?.name : undefined) || t('tutorialEditor.noScreen');
                            const matchesSearch = (p: Api.ControlPointReal) =>
                              p.name.toLowerCase().includes(controlPointSearch.toLowerCase());
                            const toggleLandmark = async (p: Api.ControlPointReal) => {
                              try {
                                const updated = await Api.api_control_points_real_update(p.id, { landmark: !p.landmark });
                                setControlPointsReal(prev => prev.map(x => x.id === p.id ? { ...x, ...updated } : x));
                              } catch {
                                toast({ title: 'Error al cambiar landmark', variant: 'destructive' });
                              }
                            };
                            const row = (point: Api.ControlPointReal) => (
                              <div key={point.id} className="flex items-center justify-between bg-[#0d1117] border border-gray-700 rounded-lg p-2.5">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm text-white truncate">{point.name}</p>
                                    {point.landmark && (
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 border border-amber-700/50 shrink-0">landmark</span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-gray-400 font-mono truncate">
                                    x:{point.x} y:{point.y} · <span className="text-gray-500">{screenName(point.screenId)}</span>
                                  </p>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title={point.landmark ? 'Quitar landmark' : 'Marcar como landmark'}
                                    className={`h-7 w-7 ${point.landmark ? 'text-amber-400 hover:bg-amber-900/30' : 'text-gray-500 hover:text-amber-400 hover:bg-amber-900/30'}`}
                                    onClick={() => toggleLandmark(point)}
                                  >
                                    <Star className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-blue-400 hover:text-blue-300 hover:bg-blue-900/30"
                                    onClick={() => {
                                      setEditingPoint({
                                        id: point.id,
                                        name: point.name,
                                        x: point.x,
                                        y: point.y,
                                        pointerX: point.pointerX,
                                        pointerY: point.pointerY,
                                        moveMouse: point.moveMouse,
                                        clic: point.clic,
                                        tutorialIds: point.tutorialIds || [],
                                        screenId: point.screenId ?? null,
                                        landmark: point.landmark ?? false,
                                      });
                                      setSelectedTutorialIds(point.tutorialIds || []);
                                      // Populate name input for editing
                                      const input = document.getElementById('zeus-point-name-input') as HTMLInputElement;
                                      if (input) input.value = point.name;
                                    }}
                                  >
                                    <Edit3 className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-900/30"
                                    onClick={async () => {
                                      try {
                                        // El punto mostrado pertenece a control_points_real (ratón real)
                                        await Api.api_control_points_real_delete(point.id);
                                        // Limpiar también la copia vieja en control_points (virtual) si existe por nombre
                                        const controlPoint = controlPoints.find(p => p.name.trim().toLowerCase() === point.name.trim().toLowerCase());
                                        if (controlPoint) {
                                          try {
                                            await Api.api_control_points_delete(controlPoint.id);
                                          } catch (controlErr: any) {
                                            console.error('Error eliminando punto virtual:', controlErr);
                                          }
                                        }
                                        const nextReal = controlPointsReal.filter(p => p.id !== point.id);
                                        const next = controlPoint ? controlPoints.filter(p => p.id !== controlPoint.id) : controlPoints;
                                        setControlPointsReal(nextReal);
                                        setControlPoints(next);
                                        toast({ title: 'Punto eliminado' });
                                      } catch {
                                        toast({ title: 'Error al eliminar punto', variant: 'destructive' });
                                      }
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            );

                            if (groupByScreen) {
                              // Vista agrupada por pantalla.
                              const groups: { id: string | null; name: string }[] = [
                                ...screens.map(s => ({ id: s.id, name: s.name })),
                                { id: null, name: t('tutorialEditor.noScreen') },
                              ];
                              return (
                                <div className="space-y-3 max-h-48 overflow-y-auto pr-1 thin-scrollbar">
                                  {groups.map(g => {
                                    const pts = controlPointsReal.filter(p => (p.screenId ?? null) === g.id && matchesSearch(p));
                                    if (pts.length === 0) return null;
                                    return (
                                      <div key={g.id || 'none'}>
                                        <p className="text-[10px] uppercase tracking-wide text-purple-300/80 mb-1 sticky top-0 bg-[#0a0e14] py-0.5">{g.name} ({pts.length})</p>
                                        <div className="space-y-2">{pts.map(row)}</div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            }

                            // Vista plana: si hay pantalla actual, sólo sus puntos.
                            const visible = controlPointsReal
                              .filter(matchesSearch)
                              .filter(p => !currentScreenId || (p.screenId ?? null) === currentScreenId);
                            if (visible.length === 0) {
                              return <p className="text-xs text-gray-500 text-center py-4">No hay puntos para esta pantalla</p>;
                            }
                            return <div className="space-y-2 max-h-48 overflow-y-auto pr-1 thin-scrollbar">{visible.map(row)}</div>;
                          })()}
                        </>
                      )}
                    </div>
                  )}
                  {generationTab === 'subtitles' && (
                    <div className="flex-1 p-4 space-y-4 overflow-y-auto custom-scrollbar min-h-0">
                      <div className="space-y-2">
                        <p className="text-xs text-gray-400">
                          {t('tutorialEditor.customSubsHint')}
                        </p>

                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">{t('tutorialEditor.position')}</Label>
                          <select
                            className="w-full h-9 bg-[#0d1117] border border-gray-700 rounded px-2 text-xs text-white"
                            value={currentTutorial?.settings?.subtitlePosition || tutorialSettings.subtitlePosition || 'bottom'}
                            onChange={e => {
                              const pos = e.target.value as 'bottom' | 'top' | 'center';
                              const next = { ...tutorialSettings, subtitlePosition: pos };
                              setTutorialSettings(next);
                              if (currentTutorial) {
                                const mergedSettings = { ...currentTutorial.settings, ...next };
                                setCurrentTutorial({ ...currentTutorial, settings: mergedSettings });
                                Api.api_tutorials_update(currentTutorial.id, { settings: mergedSettings }).catch(() => { });
                              }
                            }}
                          >
                            <option value="bottom">{t('tutorialEditor.bottom')}</option>
                            <option value="top">{t('tutorialEditor.top')}</option>
                            <option value="center">{t('tutorialEditor.center')}</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-gray-500">
                            <span>{t('tutorialEditor.verticalOffset')}</span>
                            <span>{(currentTutorial?.settings?.subtitleVerticalOffset ?? tutorialSettings.subtitleVerticalOffset ?? 0) > 0 ? `+${currentTutorial?.settings?.subtitleVerticalOffset ?? tutorialSettings.subtitleVerticalOffset ?? 0}` : currentTutorial?.settings?.subtitleVerticalOffset ?? tutorialSettings.subtitleVerticalOffset ?? 0}px</span>
                          </div>
                          <Slider
                            value={[currentTutorial?.settings?.subtitleVerticalOffset ?? tutorialSettings.subtitleVerticalOffset ?? 0]}
                            min={-200}
                            max={200}
                            step={1}
                            onValueChange={value => {
                              const offset = value[0];
                              const next = { ...tutorialSettings, subtitleVerticalOffset: offset };
                              setTutorialSettings(next);
                              if (currentTutorial) {
                                const mergedSettings = { ...currentTutorial.settings, ...next };
                                setCurrentTutorial({ ...currentTutorial, settings: mergedSettings });
                                Api.api_tutorials_update(currentTutorial.id, { settings: mergedSettings }).catch(() => { });
                              }
                            }}
                          />
                          <p className="text-[10px] text-gray-500">
                            {t('tutorialEditor.offsetHint')}
                          </p>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-gray-500">
                            <span>{t('tutorialEditor.fontSizePx')}</span>
                            <span>{tutorialSettings.subtitleFontSize || 18}px</span>
                          </div>
                          <Input
                            type="number"
                            min={10}
                            max={120}
                            value={tutorialSettings.subtitleFontSize || 18}
                            onChange={e => {
                              const size = Math.max(10, Math.min(120, parseInt(e.target.value || '18', 10)));
                              const next = { ...tutorialSettings, subtitleFontSize: size };
                              setTutorialSettings(next);
                              if (currentTutorial) {
                                const mergedSettings = { ...currentTutorial.settings, ...next };
                                setCurrentTutorial({ ...currentTutorial, settings: mergedSettings });
                                Api.api_tutorials_update(currentTutorial.id, { settings: mergedSettings }).catch(() => { });
                              }
                            }}
                            className="h-8 bg-gray-900 border-gray-600 text-xs"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">{t('tutorialEditor.textColor')}</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="color"
                              value={tutorialSettings.subtitleTextColor || '#ffffff'}
                              onChange={e => {
                                const color = e.target.value;
                                const next = { ...tutorialSettings, subtitleTextColor: color };
                                setTutorialSettings(next);
                                if (currentTutorial) {
                                  const mergedSettings = { ...currentTutorial.settings, ...next };
                                  setCurrentTutorial({ ...currentTutorial, settings: mergedSettings });
                                  Api.api_tutorials_update(currentTutorial.id, { settings: mergedSettings }).catch(() => { });
                                }
                              }}
                              className="h-8 w-12 p-1 bg-gray-900 border-gray-600"
                            />
                            <span className="text-xs text-gray-400 font-mono">{tutorialSettings.subtitleTextColor || '#ffffff'}</span>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">{t('tutorialEditor.bgColor')}</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="color"
                              value={hexFromRgba(tutorialSettings.subtitleBackgroundColor || 'rgba(0,0,0,0.8)')}
                              onChange={e => {
                                const color = e.target.value;
                                const alpha = typeof tutorialSettings.subtitleBackgroundOpacity === 'number' ? tutorialSettings.subtitleBackgroundOpacity : 0.8;
                                const rgba = hexToRgba(color, alpha);
                                const next = { ...tutorialSettings, subtitleBackgroundColor: rgba };
                                setTutorialSettings(next);
                                if (currentTutorial) {
                                  const mergedSettings = { ...currentTutorial.settings, ...next };
                                  setCurrentTutorial({ ...currentTutorial, settings: mergedSettings });
                                  Api.api_tutorials_update(currentTutorial.id, { settings: mergedSettings }).catch(() => { });
                                }
                              }}
                              className="h-8 w-12 p-1 bg-gray-900 border-gray-600"
                            />
                            <span className="text-xs text-gray-400 font-mono">{tutorialSettings.subtitleBackgroundColor || 'rgba(0,0,0,0.8)'}</span>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-gray-500">
                            <span>{t('tutorialEditor.bgOpacity')}</span>
                            <span>{Math.round((typeof tutorialSettings.subtitleBackgroundOpacity === 'number' ? tutorialSettings.subtitleBackgroundOpacity : 0.8) * 100)}%</span>
                          </div>
                          <Slider
                            value={[Math.round((typeof tutorialSettings.subtitleBackgroundOpacity === 'number' ? tutorialSettings.subtitleBackgroundOpacity : 0.8) * 100)]}
                            min={0}
                            max={100}
                            step={1}
                            onValueChange={value => {
                              const opacity = value[0] / 100;
                              const baseColor = hexFromRgba(tutorialSettings.subtitleBackgroundColor || 'rgba(0,0,0,0.8)');
                              const rgba = hexToRgba(baseColor, opacity);
                              const next = { ...tutorialSettings, subtitleBackgroundOpacity: opacity, subtitleBackgroundColor: rgba };
                              setTutorialSettings(next);
                              if (currentTutorial) {
                                const mergedSettings = { ...currentTutorial.settings, ...next };
                                setCurrentTutorial({ ...currentTutorial, settings: mergedSettings });
                                Api.api_tutorials_update(currentTutorial.id, { settings: mergedSettings }).catch(() => { });
                              }
                            }}
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">{t('tutorialEditor.testText')}</Label>
                          <textarea
                            value={subtitlePreviewText}
                            onChange={e => setSubtitlePreviewText(e.target.value)}
                            placeholder={t('tutorialEditor.subtitlePreviewPlaceholder')}
                            className="w-full h-20 bg-[#0d1117] border border-gray-700 rounded-lg p-2 text-white text-xs focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all resize-none"
                          />
                          {subtitlePreviewText && (
                            <p className="text-[10px] text-gray-500">{t('tutorialEditor.previewWhileTyping')}</p>
                          )}
                        </div>

                        <div className="space-y-1">
                          <Label className="text-[10px] text-gray-500">{t('tutorialEditor.fontType')}</Label>
                          <select
                            className="w-full h-9 bg-[#0d1117] border border-gray-700 rounded px-2 text-xs text-white"
                            value={tutorialSettings.subtitleFontFamily || 'inherit'}
                            onChange={e => {
                              const family = e.target.value;
                              const next = { ...tutorialSettings, subtitleFontFamily: family };
                              setTutorialSettings(next);
                              if (currentTutorial) {
                                const mergedSettings = { ...currentTutorial.settings, ...next };
                                setCurrentTutorial({ ...currentTutorial, settings: mergedSettings });
                                Api.api_tutorials_update(currentTutorial.id, { settings: mergedSettings }).catch(() => { });
                              }
                            }}
                          >
                            <option value="inherit">{t('tutorialEditor.inheritDefault')}</option>
                            <option value="Arial, sans-serif">Arial</option>
                            <option value="'Times New Roman', serif">Times New Roman</option>
                            <option value="'Courier New', monospace">Courier New</option>
                            <option value="Verdana, sans-serif">Verdana</option>
                            <option value="Georgia, serif">Georgia</option>
                            <option value="'Comic Sans MS', cursive">Comic Sans</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {generationTab === 'maps' && (
                    <AtlasPanel
                      screens={screens}
                      setScreens={setScreens}
                      transitions={screenTransitions}
                      setTransitions={setScreenTransitions}
                      controlPointsReal={controlPointsReal}
                      setControlPointsReal={setControlPointsReal}
                      currentScreenId={currentScreenId}
                      setCurrentScreenId={setCurrentScreenId}
                      defaultTargetApp={appPath || 'Zeus Desktop'}
                      toast={toast}
                      onProbarLandmarks={probarLandmarks}
                    />
                  )}
                </div>


              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Point Name Modal */}
      <Modal
        isOpen={pendingPoint !== null || editingPoint !== null}
        onClose={() => {
          setPendingPoint(null);
          setEditingPoint(null);
          setSelectedTutorialIds([]);
          setPointClic(true);
          setPointMoveMouse(true);
          setPointScreenId(currentScreenId);
          setPointLandmark(false);
        }}
        title={editingPoint ? t('tutorialEditor.editControlPoint') : t('tutorialEditor.saveControlPoint')}
        size="sm"
      >
        <div className="space-y-4">
          {/* Coordenadas: "Puntero" (dónde se mueve/dibuja el cursor) y
              "Acción" (dónde se ejecuta la acción). Por defecto ambas coinciden
              con la coordenada capturada; el usuario puede cambiar la de Acción
              para que el clic ocurra en otro punto distinto al del puntero. */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] text-gray-400">{t('tutorialEditor.pointerLabel')}</Label>
                {!editingPoint && pendingPoint && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px] text-blue-300 hover:text-blue-200 hover:bg-blue-900/30"
                    onClick={() => {
                      if (!pendingPoint) return;
                      const text = `${pendingPoint.x},${pendingPoint.y}`;
                      copyText(text);
                      setManualPointText(text);
                      toast({
                        title: 'Coordenada copiada al portapapeles',
                        description: text,
                      });
                    }}
                  >
                    <Copy className="h-3 w-3 mr-1" /> Copiar
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-[10px] text-gray-500">X</Label>
                  <Input
                    type="number"
                    value={editPointerX}
                    onChange={(e) => setEditPointerX(parseInt(e.target.value || '0', 10))}
                    className="h-8 bg-[#0d1117] border-gray-700 text-xs"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-[10px] text-gray-500">Y</Label>
                  <Input
                    type="number"
                    value={editPointerY}
                    onChange={(e) => setEditPointerY(parseInt(e.target.value || '0', 10))}
                    className="h-8 bg-[#0d1117] border-gray-700 text-xs"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-gray-400">{t('tutorialEditor.actionLabel')}</Label>
              <div className="flex gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-[10px] text-gray-500">X</Label>
                  <Input
                    type="number"
                    value={editPointX}
                    onChange={(e) => setEditPointX(parseInt(e.target.value || '0', 10))}
                    className="h-8 bg-[#0d1117] border-gray-700 text-xs"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-[10px] text-gray-500">Y</Label>
                  <Input
                    type="number"
                    value={editPointY}
                    onChange={(e) => setEditPointY(parseInt(e.target.value || '0', 10))}
                    className="h-8 bg-[#0d1117] border-gray-700 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="point-move-mouse"
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
                checked={pointMoveMouse}
                onChange={(e) => setPointMoveMouse(e.target.checked)}
              />
              <Label htmlFor="point-move-mouse" className="text-xs text-gray-400">{t('tutorialEditor.moveMouseHint')}</Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="point-clic"
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
                checked={pointClic}
                onChange={(e) => setPointClic(e.target.checked)}
              />
              <Label htmlFor="point-clic" className="text-xs text-gray-400">{t('tutorialEditor.clickLabel')}</Label>
            </div>
            {/* Atlas: pantalla a la que pertenece el punto + landmark de validación */}
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Pantalla (atlas)</Label>
              <select
                className="w-full h-8 bg-[#0d1117] border border-gray-700 rounded px-2 text-xs text-white"
                value={pointScreenId || ''}
                onChange={(e) => setPointScreenId(e.target.value || null)}
              >
                <option value="">{t('tutorialEditor.noScreenDash')}</option>
                {screens.map(s => (
                  <option key={s.id} value={s.id}>{s.name}{s.tab ? ` · ${s.tab}` : ''}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="point-landmark"
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-amber-600 focus:ring-amber-500"
                checked={pointLandmark}
                onChange={(e) => setPointLandmark(e.target.checked)}
              />
              <Label htmlFor="point-landmark" className="text-xs text-gray-400">{t('tutorialEditor.landmarkLabel')}</Label>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-gray-400">Tut relacionados</Label>
              <span className="text-[10px] text-gray-500">{selectedTutorialIds.length} seleccionado{selectedTutorialIds.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-2 max-h-40 overflow-y-auto thin-scrollbar space-y-1">
              {tutorials.length === 0 ? (
                <p className="text-xs text-gray-500 px-1">{t('tutorialEditor.noTutorialsShort')}</p>
              ) : (
                tutorials.map(t => {
                  const checked = selectedTutorialIds.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm transition-colors",
                        checked ? "bg-blue-500/20 text-blue-300" : "text-gray-300 hover:bg-gray-800"
                      )}
                    >
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedTutorialIds(prev => [...prev, t.id]);
                          } else {
                            setSelectedTutorialIds(prev => prev.filter(id => id !== t.id));
                          }
                        }}
                      />
                      <span className="truncate">{t.title}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <Input
            autoFocus
            id="zeus-point-name-input"
            placeholder={t('tutorialEditor.targetExamplePlaceholder')}
            className="bg-[#0d1117] border-gray-700"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const button = document.getElementById('zeus-point-save-btn') as HTMLButtonElement;
                button?.click();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => {
              setPendingPoint(null);
              setEditingPoint(null);
              setSelectedTutorialIds([]);
              setPointScreenId(currentScreenId);
              setPointLandmark(false);
            }} size="sm">Cancelar</Button>
            <Button
              id="zeus-point-save-btn"
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-500"
              onClick={async () => {
                const input = document.getElementById('zeus-point-name-input') as HTMLInputElement;
                const name = input?.value.trim();
                if (!name) return;
                if (editingPoint) {
                  try {
                    if (!Number.isFinite(editPointX) || !Number.isFinite(editPointY) || !Number.isFinite(editPointerX) || !Number.isFinite(editPointerY)) {
                      toast({ title: t('tutorialEditor.invalidCoords'), description: t('tutorialEditor.xyMustBeNumbers'), variant: 'destructive' });
                      return;
                    }
                    const updatePayload: { name: string; x?: number; y?: number; pointerX?: number; pointerY?: number; moveMouse?: boolean; tutorialIds: string[]; clic?: boolean; screenId?: string | null; landmark?: boolean } = {
                      name,
                      tutorialIds: selectedTutorialIds,
                      clic: pointClic,
                      moveMouse: pointMoveMouse,
                      screenId: pointScreenId,
                      landmark: pointLandmark,
                    };
                    // Siempre enviar x/y para evitar validación required en control_points_real
                    updatePayload.x = editPointX;
                    updatePayload.y = editPointY;
                    updatePayload.pointerX = editPointerX;
                    updatePayload.pointerY = editPointerY;
                    // Solo ratón real: editingPoint.id es el ID del punto en control_points_real
                    const saved: any = await Api.api_control_points_real_update(editingPoint.id, updatePayload);
                    const updatedPoint = { name: saved.name, x: saved.x ?? editingPoint.x, y: saved.y ?? editingPoint.y, pointerX: saved.pointerX ?? editPointerX, pointerY: saved.pointerY ?? editPointerY, moveMouse: saved.moveMouse ?? pointMoveMouse, tutorialIds: saved.tutorialIds || [], clic: saved.clic ?? true, screenId: saved.screenId ?? pointScreenId, landmark: saved.landmark ?? pointLandmark };
                    const nextReal = controlPointsReal.map(p => p.id === editingPoint.id ? { ...p, ...updatedPoint } : p);
                    setControlPointsReal(nextReal);
                    setEditingPoint(null);
                    setSelectedTutorialIds([]);
                    toast({ title: 'Punto actualizado', description: saved.name });
                  } catch {
                    toast({ title: 'Error al actualizar punto', variant: 'destructive' });
                  }
                } else if (pendingPoint) {
                  try {
                    // Solo ratón real: guardar únicamente en control_points_real
                    const savedReal = await Api.api_control_points_real_create(
                      name,
                      editPointX,
                      editPointY,
                      recordingArea,
                      appPath || 'Zeus Desktop',
                      [],
                      selectedTutorialIds,
                      pointClic,
                      editPointerX,
                      editPointerY,
                      pointMoveMouse,
                      pointScreenId,
                      pointLandmark,
                    );
                    const nextReal = [...controlPointsReal, { id: savedReal.id, name: savedReal.name, x: savedReal.x, y: savedReal.y, pointerX: savedReal.pointerX ?? editPointerX, pointerY: savedReal.pointerY ?? editPointerY, moveMouse: savedReal.moveMouse ?? pointMoveMouse, tutorialIds: savedReal.tutorialIds || [], clic: savedReal.clic ?? true, screenId: savedReal.screenId ?? pointScreenId, landmark: savedReal.landmark ?? pointLandmark }];
                    setControlPointsReal(nextReal);
                    setPendingPoint(null);
                    setSelectedTutorialIds([]);
                    toast({ title: 'Punto guardado', description: savedReal.name });
                  } catch {
                    toast({ title: 'Error al guardar punto', variant: 'destructive' });
                  }
                }
              }}
            >
              {editingPoint ? t('tutorialEditor.saveChanges') : t('tutorialEditor.save')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Configuration Modals */}
      <Modal
        isOpen={isDocumentationModalOpen}
        onClose={() => setIsDocumentationModalOpen(false)}
        title={t('tutorialEditor.docsManagementTitle')}
        size="lg"
      >
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('tutorialEditor.title')}</Label>
              <Input
                value={newDocumentation.title}
                onChange={e => setNewDocumentation({ ...newDocumentation, title: e.target.value })}
                placeholder="Ej: Manual de Zeus Desktop"
                className="bg-[#0d1117] border-gray-700"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('tutorialEditor.description')}</Label>
              <Input
                value={newDocumentation.description}
                onChange={e => setNewDocumentation({ ...newDocumentation, description: e.target.value })}
                placeholder={t('tutorialEditor.docsDescPlaceholder')}
                className="bg-[#0d1117] border-gray-700"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('tutorialEditor.filePdfMdDocx')}</Label>
              <Input
                type="file"
                accept=".pdf,.md,.txt,.doc,.docx"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) setNewDocumentation({ ...newDocumentation, file });
                }}
                className="bg-[#0d1117] border-gray-700"
              />
              {newDocumentation.file && (
                <p className="text-sm text-gray-400">{newDocumentation.file.name}</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => setIsDocumentationModalOpen(false)}>Cancelar</Button>
            <Button className="bg-blue-600 hover:bg-blue-500" onClick={handleSaveDocumentation}>{t('tutorialEditor.saveDocumentation')}</Button>
          </div>

          <div className="border-t border-gray-700 pt-4">
            <h3 className="text-lg font-semibold mb-3">{t('tutorialEditor.existingDocumentation')}</h3>
            <div className="space-y-2">
              {documentationList.map(doc => (
                <div key={doc.id} className="flex items-center justify-between bg-[#0d1117] border border-gray-700 rounded-lg p-3">
                  <div>
                    <p className="font-medium">{doc.title}</p>
                    {doc.description && <p className="text-sm text-gray-400">{doc.description}</p>}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteDocumentation(doc.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {documentationList.length === 0 && (
                <p className="text-gray-400 text-center py-4">{t('tutorialEditor.noDocumentation')}</p>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isSettingsModalOpen}
        onClose={() => {
          setIsSettingsModalOpen(false);
          // Limpiar preview de audio al cerrar
          if (tutorialMusicPreviewUrl && !currentTutorial?.settings?.backgroundMusicFile) {
            URL.revokeObjectURL(tutorialMusicPreviewUrl);
            setTutorialMusicPreviewUrl(null);
          }
          setIsTutorialMusicPlaying(false);
          if (tutorialAudioRef.current) {
            tutorialAudioRef.current.pause();
            tutorialAudioRef.current = null;
          }
          // Limpiar preview del vídeo base (modo manual) al cerrar.
          if (tutorialRawVideoPreviewUrl) {
            URL.revokeObjectURL(tutorialRawVideoPreviewUrl);
            setTutorialRawVideoPreviewUrl(null);
          }
          setTutorialRawVideo(null);
          setSettingsEditingId(null);
        }}
        title={t('tutorialEditor.tutorialConfigTitle')}
        size="md"
      >
        <div className="space-y-6">
          {/* Selección del tutorial a editar. Si hay uno seleccionado en el
              editor, se carga automáticamente al abrir el modal; aquí el
              usuario puede cambiar a otro tutorial existente para
              ACTUALIZARLO, o elegir "— Nuevo tutorial —" para CREAR uno. */}
          <div className="space-y-2">
            <Label>{t('tutorialEditor.tutorial')}</Label>
            <select
              className="w-full bg-[#0d1117] border border-gray-700 rounded-lg p-2 text-white"
              value={settingsEditingId || ''}
              onChange={e => {
                const id = e.target.value;
                if (!id) {
                  loadTutorialIntoModal(null);
                } else {
                  const t = tutorials.find(tt => tt.id === id);
                  if (t) loadTutorialIntoModal(t);
                }
              }}
            >
              <option value="">— {t('tutorialEditor.newTutorialCreate')} —</option>
              {tutorials.map(tut => (
                <option key={tut.id} value={tut.id}>
                  {tut.title || t('tutorialEditor.noTitle')}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-gray-500 leading-tight">
              {settingsEditingId
                ? t('tutorialEditor.editingExisting')
                : 'Estás creando un tutorial nuevo.'}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{t('tutorialEditor.tutorialTitle')}</Label>
            <Input
              value={tutorialTitle}
              onChange={e => setTutorialTitle(e.target.value)}
              placeholder={t('tutorialEditor.tutorialTitlePlaceholder')}
              className="bg-[#0d1117] border-gray-700"
            />
          </div>

          {/* Modo manual: el usuario sube su propio vídeo base (sin sonido) y
              rellena las tarjetas a mano. {t('tutorialEditor.exportMp4')} usará ese vídeo en
              lugar de la grabación automática. */}
          <div className="space-y-3 bg-[#0d1117] border border-gray-700 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>{t('tutorialEditor.manualMode')}</Label>
                <p className="text-[10px] text-gray-500 leading-tight">
                  {t('tutorialEditor.manualModeHint')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!!tutorialSettings.manualMode}
                onClick={() => setTutorialSettings((prev) => ({ ...prev, manualMode: !prev.manualMode }))}
                className={cn(
                  'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors',
                  tutorialSettings.manualMode ? 'bg-emerald-600' : 'bg-gray-600'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                    tutorialSettings.manualMode ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </button>
            </div>

            {tutorialSettings.manualMode && (
              <div className="space-y-2 pt-1">
                <Label className="text-[11px] text-gray-400">{t('tutorialEditor.baseVideo')}</Label>
                <Input
                  type="file"
                  accept="video/*"
                  onChange={e => {
                    const file = e.target.files?.[0] || null;
                    setTutorialRawVideo(file);
                    if (tutorialRawVideoPreviewUrl) URL.revokeObjectURL(tutorialRawVideoPreviewUrl);
                    setTutorialRawVideoPreviewUrl(file ? URL.createObjectURL(file) : null);
                  }}
                  className="bg-[#0d1117] border-gray-700 text-sm"
                />
                <p className="text-[10px] text-gray-500 leading-tight">
                  {t('tutorialEditor.copiedToProject')}
                </p>
                {(() => {
                  const editing = settingsEditingId
                    ? tutorials.find(tt => tt.id === settingsEditingId)
                    : null;
                  const existingRaw = editing?.metadata?.rawVideoPath;
                  if (existingRaw && !tutorialRawVideo) {
                    return (
                      <span className="text-[11px] text-emerald-400/80 truncate block">
                        {t('tutorialEditor.currentBaseVideo', { name: existingRaw.split(/[\\/]/).pop() ?? '' })}
                      </span>
                    );
                  }
                  return null;
                })()}
                {tutorialRawVideo && (
                  <span className="text-xs text-gray-400 truncate block">
                    {t('tutorialEditor.newBaseVideo', { name: tutorialRawVideo.name })}
                  </span>
                )}
                {tutorialRawVideoPreviewUrl && (
                  <video
                    src={tutorialRawVideoPreviewUrl}
                    className="w-full max-h-40 rounded border border-gray-700 bg-black"
                    controls
                    muted
                  />
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <Label>{t('tutorialEditor.bgMusicCap')}</Label>
            <div className="space-y-3 bg-[#0d1117] border border-gray-700 rounded-lg p-3">
              <Input
                type="file"
                accept="audio/*"
                onChange={e => {
                  const file = e.target.files?.[0] || null;
                  setTutorialBackgroundMusic(file);
                  if (file) {
                    if (tutorialMusicPreviewUrl) URL.revokeObjectURL(tutorialMusicPreviewUrl);
                    setTutorialMusicPreviewUrl(URL.createObjectURL(file));
                    setTutorialSettings((prev: any) => ({
                      ...prev,
                      backgroundMusic: true,
                      backgroundMusicFileName: file.name,
                    }));
                  } else {
                    setTutorialMusicPreviewUrl(null);
                    setTutorialSettings((prev: any) => ({
                      ...prev,
                      backgroundMusic: false,
                      backgroundMusicFileName: undefined,
                    }));
                  }
                  setIsTutorialMusicPlaying(false);
                  if (tutorialAudioRef.current) {
                    tutorialAudioRef.current.pause();
                    tutorialAudioRef.current = null;
                  }
                }}
                className="bg-[#0d1117] border-gray-700 text-sm"
              />
              {(tutorialMusicPreviewUrl || currentTutorial?.settings?.backgroundMusicFile) && (
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-600 bg-gray-800 hover:bg-gray-700 text-white"
                    onClick={() => {
                      const url = tutorialMusicPreviewUrl || currentTutorial?.settings?.backgroundMusicFile;
                      if (!url) return;
                      if (!tutorialAudioRef.current) {
                        tutorialAudioRef.current = new Audio(url);
                        tutorialAudioRef.current.volume = tutorialSettings.musicVolume;
                        tutorialAudioRef.current.loop = true;
                        tutorialAudioRef.current.onended = () => setIsTutorialMusicPlaying(false);
                      }
                      if (isTutorialMusicPlaying) {
                        tutorialAudioRef.current.pause();
                        setIsTutorialMusicPlaying(false);
                      } else {
                        tutorialAudioRef.current.play().catch((err) => {
                          console.warn('Error reproduciendo audio:', err);
                          toast({ title: 'No se pudo reproducir el audio', variant: 'destructive' });
                        });
                        setIsTutorialMusicPlaying(true);
                      }
                    }}
                  >
                    {isTutorialMusicPlaying ? (
                      <><Pause className="h-4 w-4 mr-1" />{t('tutorialEditor.pause')}</>
                    ) : (
                      <><Play className="h-4 w-4 mr-1" /> Escuchar</>
                    )}
                  </Button>
                  {tutorialBackgroundMusic && (
                    <span className="text-xs text-gray-400 truncate">{tutorialBackgroundMusic.name}</span>
                  )}
                  {!tutorialBackgroundMusic && currentTutorial?.settings?.backgroundMusicFileName && (
                    <span className="text-xs text-gray-400 truncate">{currentTutorial.settings.backgroundMusicFileName}</span>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>{t('tutorialEditor.musicVolume')}</span>
                  <span>{Math.round(tutorialSettings.musicVolume * 100)}%</span>
                </div>
                <Slider
                  value={[tutorialSettings.musicVolume * 100]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={value => {
                    const newVol = value[0] / 100;
                    setTutorialSettings((prev: any) => ({ ...prev, musicVolume: newVol }));
                    if (tutorialAudioRef.current) {
                      tutorialAudioRef.current.volume = newVol;
                    }
                  }}
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>Inicio del audio (segundos)</span>
                  <span>{musicStartTime}s</span>
                </div>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={musicStartTime}
                  onChange={e => setMusicStartTime(Math.max(0, parseInt(e.target.value || '0', 10)))}
                  className="h-8 bg-gray-900 border-gray-600 text-xs"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>Fade-in al empezar (segundos)</span>
                  <span>{musicFadeInDuration}s</span>
                </div>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={musicFadeInDuration}
                  onChange={e => setMusicFadeInDuration(Math.max(0, parseFloat(e.target.value || '0')))}
                  className="h-8 bg-gray-900 border-gray-600 text-xs"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>Fade-out al terminar (segundos)</span>
                  <span>{musicFadeOutDuration}s</span>
                </div>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={musicFadeOutDuration}
                  onChange={e => setMusicFadeOutDuration(Math.max(0, parseFloat(e.target.value || '0')))}
                  className="h-8 bg-gray-900 border-gray-600 text-xs"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('tutorialEditor.voiceover')}</Label>
            <div className="space-y-3 bg-[#0d1117] border border-gray-700 rounded-lg p-3">
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>{t('tutorialEditor.voiceVolume')}</span>
                  <span>{Math.round((tutorialSettings.voiceoverVolume ?? 0.8) * 100)}%</span>
                </div>
                <Slider
                  value={[(tutorialSettings.voiceoverVolume ?? 0.8) * 100]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={value => {
                    const newVol = value[0] / 100;
                    setTutorialSettings((prev: any) => ({ ...prev, voiceoverVolume: newVol }));
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-gray-500">{t('tutorialEditor.edgeTtsVoice')}</Label>
                <select
                  className="w-full bg-[#0d1117] border border-gray-700 rounded-lg p-2 text-white text-xs"
                  value={tutorialSettings.voice ?? ''}
                  onChange={e => setTutorialSettings((prev: any) => ({ ...prev, voice: e.target.value }))}
                >
                  <option value="">{t('tutorialEditor.autoLang')}</option>
                  <optgroup label="Femeninas">
                    <option value="es-ES-ElviraNeural">{t('tutorialEditor.voiceElvira')}</option>
                    <option value="es-ES-XimenaNeural">{t('tutorialEditor.voiceXimena')}</option>
                    <option value="es-MX-DaliaNeural">{t('tutorialEditor.voiceDalia')}</option>
                    <option value="es-AR-ElenaNeural">{t('tutorialEditor.voiceElena')}</option>
                    <option value="es-CO-SalomeNeural">{t('tutorialEditor.voiceSalome')}</option>
                    <option value="es-CL-CatalinaNeural">{t('tutorialEditor.voiceCatalina')}</option>
                    <option value="en-US-AriaNeural">{t('tutorialEditor.voiceAria')}</option>
                    <option value="en-US-AvaNeural">{t('tutorialEditor.voiceAva')}</option>
                    <option value="en-GB-SoniaNeural">{t('tutorialEditor.voiceSonia')}</option>
                  </optgroup>
                  <optgroup label="Masculinas">
                    <option value="es-ES-AlvaroNeural">{t('tutorialEditor.voiceAlvaro')}</option>
                    <option value="es-MX-JorgeNeural">{t('tutorialEditor.voiceJorge')}</option>
                    <option value="es-AR-TomasNeural">{t('tutorialEditor.voiceTomas')}</option>
                    <option value="es-CO-GonzaloNeural">{t('tutorialEditor.voiceGonzalo')}</option>
                    <option value="es-CL-LorenzoNeural">{t('tutorialEditor.voiceLorenzo')}</option>
                    <option value="en-US-ChristopherNeural">{t('tutorialEditor.voiceChristopher')}</option>
                    <option value="en-US-AndrewNeural">{t('tutorialEditor.voiceAndrew')}</option>
                    <option value="en-GB-RyanNeural">{t('tutorialEditor.voiceRyan')}</option>
                  </optgroup>
                </select>
                <div className="flex gap-2 pt-1">
                  <Input
                    value={ttsPreviewText}
                    onChange={e => setTtsPreviewText(e.target.value)}
                    placeholder="Frase de muestra..."
                    className="h-8 flex-1 bg-[#0d1117] border-gray-700 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-2 text-[11px] border-gray-700 text-blue-300 hover:text-blue-200 hover:bg-blue-900/30"
                    disabled={ttsPreviewLoading}
                    onClick={async () => {
                      try {
                        // Detener cualquier reproducción previa.
                        if (ttsPreviewAudioRef.current) {
                          try { ttsPreviewAudioRef.current.pause(); } catch {}
                          ttsPreviewAudioRef.current = null;
                        }
                        setTtsPreviewLoading(true);
                        const blob = await Api.api_tts_preview(
                          ttsPreviewText || 'Hola, esta es una muestra de la voz en off del tutorial.',
                          tutorialSettings.voice ?? '',
                          tutorialSettings.subtitleLanguage || 'es'
                        );
                        const url = URL.createObjectURL(blob);
                        const audio = new Audio(url);
                        ttsPreviewAudioRef.current = audio;
                        audio.onended = () => { URL.revokeObjectURL(url); ttsPreviewAudioRef.current = null; };
                        await audio.play();
                      } catch {
                        toast({ title: 'No se pudo reproducir la muestra', description: t('tutorialEditor.checkInternetTts'), variant: 'destructive' });
                      } finally {
                        setTtsPreviewLoading(false);
                      }
                    }}
                  >
                    {ttsPreviewLoading ? 'Generando...' : 'Reproducir muestra'}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <Label>{t('tutorialEditor.subVoiceLang')}</Label>
            <select
              className="w-full bg-[#0d1117] border border-gray-700 rounded-lg p-2 text-white"
              value={tutorialSettings.subtitleLanguage}
              onChange={e => setTutorialSettings({ ...tutorialSettings, subtitleLanguage: e.target.value })}
            >
              <option value="es">{t('tutorialEditor.spanishSpain')}</option>
              <option value="en">English (US)</option>
              <option value="fr">Français</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label>{t('tutorialEditor.videoQuality')}</Label>
            <select
              className="w-full bg-[#0d1117] border border-gray-700 rounded-lg p-2 text-white"
              value={tutorialSettings.quality}
              onChange={e => setTutorialSettings({ ...tutorialSettings, quality: e.target.value as TutorialSettings['quality'] })}
            >
              <option value="low">{t('tutorialEditor.lowQuality')}</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
              <option value="ultra">{t('tutorialEditor.ultraQuality')}</option>
            </select>
            <p className="text-[10px] text-gray-500 leading-tight">
              {t('tutorialEditor.crfHint')}
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => setIsSettingsModalOpen(false)}>Cancelar</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-500" onClick={handleApplyTutorialSettings}>
              {settingsEditingId ? t('tutorialEditor.saveChanges') : t('tutorialEditor.applyChanges')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* t('tutorialEditor.servicesTab') de la aplicación (BD/API/servidor) — arrancan con el preview */}
      <Modal
        isOpen={isServicesModalOpen}
        onClose={() => setIsServicesModalOpen(false)}
        title={t('tutorialEditor.appServicesTitle')}
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-400">
            {t('tutorialEditor.servicesTab')} auxiliares (base de datos, API, servidor…) que se arrancan junto al preview. El <span className="text-gray-300 font-mono">{'{port}'}</span>{t('tutorialEditor.portHelp1')}<span className="text-gray-300 font-mono">PORT</span>{t('tutorialEditor.portHelp2')}</p>

          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {services.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-6">{t('tutorialEditor.noServices')}</p>
            )}
            {services.map((s) => (
              <div key={s.id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-900/60 border border-gray-700">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => setServices(prev => prev.map(x => x.id === s.id ? { ...x, enabled: e.target.checked } : x))}
                  className="w-4 h-4 bg-gray-800 border-gray-700 rounded shrink-0"
                  title="Activar para arrancar con el preview"
                />
                <input
                  type="text"
                  value={s.name}
                  onChange={(e) => setServices(prev => prev.map(x => x.id === s.id ? { ...x, name: e.target.value } : x))}
                  placeholder="Nombre"
                  className="w-32 shrink-0 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
                />
                <input
                  type="number"
                  value={s.port === 0 ? '' : s.port}
                  onChange={(e) => setServices(prev => prev.map(x => x.id === s.id ? { ...x, port: parseInt(e.target.value) || 0 } : x))}
                  placeholder="Puerto"
                  className="w-20 shrink-0 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
                />
                <input
                  type="text"
                  value={s.command}
                  onChange={(e) => setServices(prev => prev.map(x => x.id === s.id ? { ...x, command: e.target.value } : x))}
                  placeholder="Comando (usa {port})"
                  className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white font-mono"
                />
                <button
                  onClick={() => setServices(prev => prev.filter(x => x.id !== s.id))}
                  className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded shrink-0"
                  title="Eliminar servicio"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-700">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setServices(prev => [...prev, { id: `srv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: '', port: 0, command: '', enabled: true }])}
                className="border-gray-700 bg-gray-800/50 hover:bg-gray-700"
              >
                <Plus className="h-4 w-4 mr-1" />{t('tutorialEditor.addService')}</Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setServices(DEFAULT_TUTORIAL_SERVICES.map(s => ({ ...s, id: `${s.id}-${Date.now()}` })))}
                className="text-gray-400 hover:text-white"
                title={t('tutorialEditor.resetServicesTitle')}
              >
                {t('tutorialEditor.resetZeusDefaults')}
              </Button>
            </div>
            <Button variant="ghost" onClick={() => setIsServicesModalOpen(false)}>{t('tutorialEditor.close')}</Button>
          </div>
        </div>
      </Modal>

      {/* Delete Tutorial Confirmation Modal */}
      <Modal
        isOpen={tutorialToDelete !== null}
        onClose={() => setTutorialToDelete(null)}
        title={t('tutorialEditor.deleteTutorialTitle')}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-gray-300">
            {t('tutorialEditor.deleteTutorialConfirm', { title: tutorialToDelete?.title ?? '' })}
          </p>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => setTutorialToDelete(null)}>{t('tutorialEditor.cancel')}</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!tutorialToDelete) return;
                try {
                  await fetch(`/api/tutorials/${tutorialToDelete.id}`, {
                    method: 'DELETE',
                  });
                  setTutorials(tutorials.filter(t => t.id !== tutorialToDelete.id));
                  if (currentTutorial?.id === tutorialToDelete.id) {
                    setCurrentTutorial(null);
                    setPlayingMp4(null);
                  }
                  setTutorialToDelete(null);
                  toast({ title: 'Tutorial eliminado', description: 'El tutorial ha sido eliminado correctamente.' });
                } catch (error) {
                  console.error('Error deleting tutorial:', error);
                  toast({ title: 'Error al eliminar', description: 'No se pudo eliminar el tutorial.', variant: 'destructive' });
                }
              }}
            >{t('tutorialEditor.delete')}</Button>
          </div>
        </div>
      </Modal>

      {/* Export/Import de pestañas (selección de qué pestañas exportar/importar) */}
      <Modal
        isOpen={transferOpen}
        onClose={() => setTransferOpen(false)}
        title={transferMode === 'export' ? t('tutorialEditor.exportTabsBtn') : t('tutorialEditor.importTabsBtn')}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            {transferMode === 'export'
              ? t('tutorialEditor.exportTabsHint')
              : t('tutorialEditor.importTabsHint')}
          </p>
          {transferMode === 'import' && transferImported?.project && (
            <p className="text-xs text-gray-500">{t('tutorialEditor.projectFile')}<span className="text-gray-300">{transferImported.project.title || transferImported.project.id || '(sin nombre)'}</span>
            </p>
          )}
          <div className="space-y-2">
            {TRANSFER_TABS.map(tab => {
              // En import, deshabilitar las pestañas no presentes en el archivo.
              const present = transferMode !== 'import' || !!(transferImported?.tabs?.[tab.key]);
              const checked = transferSelected[tab.key];
              return (
                <label
                  key={tab.key}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors',
                    present ? 'border-gray-700 hover:bg-gray-800/50' : 'border-gray-800 opacity-40 cursor-not-allowed',
                    checked && present && 'border-sky-600 bg-sky-900/20'
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-sky-500"
                    disabled={!present}
                    checked={checked}
                    onChange={(e) => setTransferSelected(prev => ({ ...prev, [tab.key]: e.target.checked }))}
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-white">{tab.label}</span>
                    <span className="text-[11px] text-gray-400">
                      {present ? tab.desc : t('tutorialEditor.notInFile')}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setTransferOpen(false)}>Cancelar</Button>
            <Button
              className="bg-sky-600 hover:bg-sky-500"
              onClick={transferMode === 'export' ? doExportTransfer : doImportTransfer}
            >
              {transferMode === 'export' ? 'Exportar' : 'Importar'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Global Recording Area Calibration Overlay (Relative to Window) */}
      {isCalibrating && (
        <div
          className="fixed inset-0 z-[100] bg-black/20"
          onMouseMove={(e) => {
            if (isDragging) {
              const dx = e.clientX - dragStart.x;
              const dy = e.clientY - dragStart.y;
              setRecordingArea(prev => ({
                ...prev,
                x: Math.max(0, prev.x + dx),
                y: Math.max(0, prev.y + dy)
              }));
              setDragStart({ x: e.clientX, y: e.clientY });
            } else if (resizeHandle) {
              const dx = e.clientX - dragStart.x;
              const dy = e.clientY - dragStart.y;
              setRecordingArea(prev => {
                const newArea = { ...prev };
                if (resizeHandle.includes('e')) newArea.width = Math.max(100, prev.width + dx);
                if (resizeHandle.includes('s')) newArea.height = Math.max(100, prev.height + dy);
                if (resizeHandle.includes('w')) {
                  const newWidth = Math.max(100, prev.width - dx);
                  if (newWidth !== prev.width) {
                    newArea.x = prev.x + (prev.width - newWidth);
                    newArea.width = newWidth;
                  }
                }
                if (resizeHandle.includes('n')) {
                  const newHeight = Math.max(100, prev.height - dy);
                  if (newHeight !== prev.height) {
                    newArea.y = prev.y + (prev.height - newHeight);
                    newArea.height = newHeight;
                  }
                }
                return newArea;
              });
              setDragStart({ x: e.clientX, y: e.clientY });
            }
          }}
          onMouseUp={() => {
            setIsDragging(false);
            setResizeHandle(null);
          }}
        >
          <div
            className={cn(
              "absolute border-2 border-dashed border-red-500 bg-red-500/10 pointer-events-auto cursor-move shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]",
              isDragging && "border-solid bg-red-500/20"
            )}
            style={{
              left: recordingArea.x,
              top: recordingArea.y,
              width: recordingArea.width,
              height: recordingArea.height,
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              setIsDragging(true);
              setDragStart({ x: e.clientX, y: e.clientY });
            }}
          >
            <div className="absolute -top-6 left-0 bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded font-mono whitespace-nowrap pointer-events-none">
              {Math.round(recordingArea.width)}×{Math.round(recordingArea.height)} | x:{Math.round(recordingArea.x)} y:{Math.round(recordingArea.y)}
            </div>

            {/* Resize Handles */}
            <div className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize hover:bg-red-500/50" onMouseDown={(e) => { e.stopPropagation(); setResizeHandle('nw'); setDragStart({ x: e.clientX, y: e.clientY }); }} />
            <div className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize hover:bg-red-500/50" onMouseDown={(e) => { e.stopPropagation(); setResizeHandle('ne'); setDragStart({ x: e.clientX, y: e.clientY }); }} />
            <div className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize hover:bg-red-500/50" onMouseDown={(e) => { e.stopPropagation(); setResizeHandle('sw'); setDragStart({ x: e.clientX, y: e.clientY }); }} />
            <div className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize hover:bg-red-500/50" onMouseDown={(e) => { e.stopPropagation(); setResizeHandle('se'); setDragStart({ x: e.clientX, y: e.clientY }); }} />
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1 cursor-n-resize" onMouseDown={(e) => { e.stopPropagation(); setResizeHandle('n'); setDragStart({ x: e.clientX, y: e.clientY }); }} />
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full h-1 cursor-s-resize" onMouseDown={(e) => { e.stopPropagation(); setResizeHandle('s'); setDragStart({ x: e.clientX, y: e.clientY }); }} />
            <div className="absolute left-0 top-1/2 -translate-y-1/2 h-full w-1 cursor-w-resize" onMouseDown={(e) => { e.stopPropagation(); setResizeHandle('w'); setDragStart({ x: e.clientX, y: e.clientY }); }} />
            <div className="absolute right-0 top-1/2 -translate-y-1/2 h-full w-1 cursor-e-resize" onMouseDown={(e) => { e.stopPropagation(); setResizeHandle('e'); setDragStart({ x: e.clientX, y: e.clientY }); }} />
          </div>

          {/* Calibration Controls */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[101] flex items-center gap-2 bg-black/90 backdrop-blur-md border border-red-500/50 rounded-2xl p-4 flex-wrap pointer-events-auto shadow-2xl">
            <div className="flex flex-col gap-1 mr-4">
              <span className="text-[10px] text-red-400 uppercase font-bold">{t('tutorialEditor.calibrationMode')}</span>
              <span className="text-[9px] text-gray-400">Punto (0,0) en esquina de la ventana</span>
            </div>

            <div className="flex gap-1">
              <button
                className="w-8 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-white rounded-lg border border-gray-600 transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const interval = setInterval(() => {
                    setRecordingArea(prev => ({ ...prev, x: Math.max(0, prev.x - calibrationStep) }));
                  }, 50);
                  const up = () => { clearInterval(interval); window.removeEventListener('mouseup', up); };
                  window.addEventListener('mouseup', up);
                }}
              >◀</button>
              <button
                className="w-8 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-white rounded-lg border border-gray-600 transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const interval = setInterval(() => {
                    setRecordingArea(prev => ({ ...prev, x: prev.x + calibrationStep }));
                  }, 50);
                  const up = () => { clearInterval(interval); window.removeEventListener('mouseup', up); };
                  window.addEventListener('mouseup', up);
                }}
              >▶</button>
              <button
                className="w-8 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-white rounded-lg border border-gray-600 transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const interval = setInterval(() => {
                    setRecordingArea(prev => ({ ...prev, y: Math.max(0, prev.y - calibrationStep) }));
                  }, 50);
                  const up = () => { clearInterval(interval); window.removeEventListener('mouseup', up); };
                  window.addEventListener('mouseup', up);
                }}
              >▲</button>
              <button
                className="w-8 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-white rounded-lg border border-gray-600 transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const interval = setInterval(() => {
                    setRecordingArea(prev => ({ ...prev, y: prev.y + calibrationStep }));
                  }, 50);
                  const up = () => { clearInterval(interval); window.removeEventListener('mouseup', up); };
                  window.addEventListener('mouseup', up);
                }}
              >▼</button>
            </div>

            <div className="w-px h-8 bg-gray-700 mx-2"></div>

            <div className="flex gap-1">
              <button
                className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-[11px] text-white rounded-lg border border-gray-600 transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const interval = setInterval(() => {
                    setRecordingArea(prev => ({ ...prev, width: Math.max(100, prev.width - calibrationStep) }));
                  }, 50);
                  const up = () => { clearInterval(interval); window.removeEventListener('mouseup', up); };
                  window.addEventListener('mouseup', up);
                }}
              >-W</button>
              <button
                className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-[11px] text-white rounded-lg border border-gray-600 transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const interval = setInterval(() => {
                    setRecordingArea(prev => ({ ...prev, width: prev.width + calibrationStep }));
                  }, 50);
                  const up = () => { clearInterval(interval); window.removeEventListener('mouseup', up); };
                  window.addEventListener('mouseup', up);
                }}
              >+W</button>
              <button
                className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-[11px] text-white rounded-lg border border-gray-600 transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const interval = setInterval(() => {
                    setRecordingArea(prev => ({ ...prev, height: Math.max(100, prev.height - calibrationStep) }));
                  }, 50);
                  const up = () => { clearInterval(interval); window.removeEventListener('mouseup', up); };
                  window.addEventListener('mouseup', up);
                }}
              >-H</button>
              <button
                className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-[11px] text-white rounded-lg border border-gray-600 transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const interval = setInterval(() => {
                    setRecordingArea(prev => ({ ...prev, height: prev.height + calibrationStep }));
                  }, 50);
                  const up = () => { clearInterval(interval); window.removeEventListener('mouseup', up); };
                  window.addEventListener('mouseup', up);
                }}
              >+H</button>
            </div>

            <div className="w-px h-8 bg-gray-700 mx-2"></div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={500}
                value={calibrationStep}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 1) {
                    setCalibrationStep(val);
                    if (typeof window !== 'undefined') {
                      localStorage.setItem('zeus-calibration-step', String(val));
                    }
                  }
                }}
                className="w-16 h-8 bg-gray-900 border border-gray-600 rounded-lg text-xs text-white text-center focus:border-red-500 outline-none"
              />
              <span className="text-[10px] text-gray-500 font-mono">px</span>
            </div>

            <Button
              className="ml-4 bg-red-600 hover:bg-red-500 text-white rounded-lg px-6 h-9 transition-all active:scale-95"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  localStorage.setItem('zeus-recording-area', JSON.stringify(recordingArea));
                  localStorage.setItem('zeus-calibration-step', String(calibrationStep));
                }
                setIsCalibrating(false);
                toast({ title: t('tutorialEditor.configSaved'), description: `Área establecida en (${recordingArea.x}, ${recordingArea.y})` });
              }}
            >
              <Save className="h-4 w-4 mr-2" /> {t('tutorialEditor.save')}
            </Button>
          </div>
        </div>
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor de t('tutorialEditor.timelineTab'): ajusta textos y tiempos de subtítulos / voz en off
// de un tutorial desktop y re-genera el MP4 sobre la grabación raw existente.
// ─────────────────────────────────────────────────────────────────────────────
interface EditedStep {
  id?: string;
  order?: number;
  action?: string;
  subtitle: string;
  voiceover: string;
  subtitleStart: number;
  subtitleEnd: number;
  voiceStart: number;
  duration: number;
}

// Tiempo en segundos → timecode m:ss.cc (igual que el reproductor nativo, que
// muestra m:ss, pero añadiendo centésimas para el control fino). Ej.: 6 → "0:06.00".
function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalCs = Math.round(seconds * 100);
  const m = Math.floor(totalCs / 6000);
  const remCs = totalCs - m * 6000;
  const wholeS = Math.floor(remCs / 100);
  const cs = remCs % 100;
  return `${m}:${String(wholeS).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// Timecode o segundos sueltos → segundos. Acepta:
//  - "m:ss" / "m:ss.cc" / "h:mm:ss" / "h:mm:ss.cc" (formato del reproductor)
//  - "6" / "6.5" / "6,5" (segundos sueltos, para valores < 1 min o precisión)
function parseTimecode(input: string): number {
  let raw = (input || '').trim().replace(',', '.');
  if (raw.includes(':')) {
    const parts = raw.split(':').map(p => Number(p) || 0);
    let h = 0, m = 0, s = 0;
    if (parts.length >= 3) { h = parts[0]; m = parts[1]; s = parts[2]; }
    else if (parts.length === 2) { m = parts[0]; s = parts[1]; }
    else { s = parts[0]; }
    return h * 3600 + m * 60 + s;
  }
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

// Input de tiempo en formato m:ss.cc, igual que lo muestra el reproductor de
// vídeo (así "0:06" del vídeo = 6 s en la tarjeta, no 0,06 s). Usa type="text"
// porque los <input type="number"> no formatean timecodes. Mantiene un búfer
// local mientras se escribe para no re-formatear a mitad de edición; al perder
// el foco vuelve al timecode canónico.
const TimeInput: React.FC<{
  value: number;
  onChange: (n: number) => void;
  min?: number;
}> = ({ value, onChange, min }) => {
  const [text, setText] = React.useState(() => formatTimecode(value));
  const lastEmitted = React.useRef(value);

  // Solo sincroniza desde fuera cuando el valor cambia por algo distinto a la
  // propia edición (reset, añadir tarjeta, o duration que recalcula subtitleEnd).
  React.useEffect(() => {
    if (Math.abs(lastEmitted.current - value) > 1e-6) {
      setText(formatTimecode(value));
      lastEmitted.current = value;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);
    const n = parseTimecode(raw);
    const finalN = min != null ? Math.max(min, n) : n;
    lastEmitted.current = finalN;
    onChange(finalN);
  };

  const handleBlur = () => {
    const finalN = min != null ? Math.max(min, parseTimecode(text)) : parseTimecode(text);
    setText(formatTimecode(finalN));
    lastEmitted.current = finalN;
    if (Math.abs(finalN - value) > 1e-6) onChange(finalN);
  };

  return (
    <Input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
      className="bg-[#161b22] border-gray-700 text-white text-xs h-8 font-mono"
    />
  );
};

function buildEditedSteps(tutorial: Tutorial): { steps: EditedStep[]; total: number } {
  const steps: EditedStep[] = [];
  let cursor = 0;
  for (let i = 0; i < (tutorial.steps?.length || 0); i++) {
    const s = tutorial.steps[i];
    const dur = Number(s.duration) > 0 ? Number(s.duration) : 3;
    const start = s.subtitleStart != null ? Number(s.subtitleStart) : cursor;
    const end = s.subtitleEnd != null ? Number(s.subtitleEnd) : start + dur;
    const voice = s.voiceStart != null ? Number(s.voiceStart) : start;
    steps.push({
      id: s.id,
      order: s.order ?? i + 1,
      action: s.action,
      subtitle: s.subtitle || s.description || '',
      voiceover: s.voiceover || s.description || '',
      subtitleStart: start,
      subtitleEnd: end,
      voiceStart: voice,
      duration: dur,
    });
    cursor = end;
  }
  const total = tutorial.metadata?.rawDuration
    ? Number(tutorial.metadata.rawDuration)
    : steps.reduce((m, s) => Math.max(m, s.subtitleEnd, s.voiceStart + s.duration), 0) || 1;
  return { steps, total };
}

const TimelineEditorPanel: React.FC<{
  tutorial: Tutorial;
  editedSteps: EditedStep[];
  setEditedSteps: React.Dispatch<React.SetStateAction<EditedStep[]>>;
}> = ({ tutorial, editedSteps, setEditedSteps }) => {
  const { t } = useI18n();
  const initial = React.useMemo(() => buildEditedSteps(tutorial), [tutorial.id]);
  const total = initial.total;
  const [activeStep, setActiveStep] = useState(0);

  const rawAvailable = !!tutorial.metadata?.rawVideoPath;
  const stripRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ idx: number; field: 'subtitle' | 'voice'; startX: number; origStart: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Restablecer a los tiempos por defecto acumulados.
  const resetStep = (idx: number) => {
    setEditedSteps((prev: EditedStep[]) => {
      const next = [...prev];
      let cursor = 0;
      for (let i = 0; i < next.length; i++) {
        if (i < idx) { cursor = next[i].subtitleEnd; continue; }
        if (i === idx) {
          const dur = next[i].duration;
          next[i] = { ...next[i], subtitleStart: cursor, subtitleEnd: cursor + dur, voiceStart: cursor };
        }
      }
      return next;
    });
  };

  const updateStep = (idx: number, patch: Partial<EditedStep>) => {
    setEditedSteps((prev: EditedStep[]) => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  // Drag de clips en la tira horizontal.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d || !stripRef.current) return;
      const rect = stripRef.current.getBoundingClientRect();
      const deltaSec = ((e.clientX - d.startX) / rect.width) * total;
      setEditedSteps((prev: EditedStep[]) => prev.map((s, i) => {
        if (i !== d.idx) return s;
        if (d.field === 'subtitle') {
          const len = Math.max(0.2, s.subtitleEnd - s.subtitleStart);
          const ns = Math.max(0, Math.min(total - len, d.origStart + deltaSec));
          return { ...s, subtitleStart: Math.round(ns * 10) / 10, subtitleEnd: Math.round((ns + len) * 10) / 10 };
        } else {
          const nv = Math.max(0, Math.min(total - 0.2, d.origStart + deltaSec));
          return { ...s, voiceStart: Math.round(nv * 10) / 10 };
        }
      }));
    };
    const onUp = () => { dragRef.current = null; setDragging(false); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, total]);

  const startDrag = (e: React.MouseEvent, idx: number, field: 'subtitle' | 'voice') => {
    e.preventDefault();
    e.stopPropagation();
    const s = editedSteps[idx];
    dragRef.current = { idx, field, startX: e.clientX, origStart: field === 'subtitle' ? s.subtitleStart : s.voiceStart };
    setDragging(true);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className="flex flex-col h-full space-y-4 w-full">
      <div className="flex items-center justify-between text-xs text-gray-400 flex-shrink-0">
        <span>{t('tutorialEditor.recordingDuration')}<span className="text-white font-medium">{fmt(total)}</span></span>
        {!rawAvailable && (
          <span className="text-amber-400">{t('tutorialEditor.noRawRecording')}</span>
        )}
      </div>

      {/* Tira visual de timeline */}
      <div ref={stripRef} className="relative h-20 bg-[#0d1117] border border-gray-700 rounded-lg overflow-hidden select-none flex-shrink-0">
        {/* Marcas de tiempo cada ~10% */}
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="absolute top-0 bottom-0 border-l border-gray-800" style={{ left: `${(i + 1) * 10}%` }}>
            <span className="absolute top-0.5 left-1 text-[9px] text-gray-600">{fmt((total * (i + 1)) / 10)}</span>
          </div>
        ))}
        {editedSteps.map((s, idx) => {
          const sLeft = (s.subtitleStart / total) * 100;
          const sWidth = Math.max(1, ((s.subtitleEnd - s.subtitleStart) / total) * 100);
          const vLeft = (s.voiceStart / total) * 100;
          const vWidth = Math.max(1, (Math.min(s.duration, total - s.voiceStart) / total) * 100);
          return (
            <div key={idx}>
              {/* Clip subtítulo (azul) */}
              <div
                onMouseDown={(e) => startDrag(e, idx, 'subtitle')}
                className={cn(
                  "absolute top-2 h-6 rounded text-[9px] text-white flex items-center px-1 cursor-grab active:cursor-grabbing overflow-hidden whitespace-nowrap",
                  activeStep === idx ? "ring-2 ring-blue-300 z-10" : "z-0"
                )}
                style={{ left: `${sLeft}%`, width: `${sWidth}%`, backgroundColor: 'rgba(59,130,246,0.75)' }}
                title={t('tutorialEditor.subtitleN', { n: idx + 1, start: fmt(s.subtitleStart), end: fmt(s.subtitleEnd) })}
                onClick={() => setActiveStep(idx)}
              >
                S{idx + 1}
              </div>
              {/* Clip voz (verde) */}
              <div
                onMouseDown={(e) => startDrag(e, idx, 'voice')}
                className={cn(
                  "absolute top-10 h-6 rounded text-[9px] text-white flex items-center px-1 cursor-grab active:cursor-grabbing overflow-hidden whitespace-nowrap",
                  activeStep === idx ? "ring-2 ring-emerald-300 z-10" : "z-0"
                )}
                style={{ left: `${vLeft}%`, width: `${vWidth}%`, backgroundColor: 'rgba(16,185,129,0.75)' }}
                title={`Voz ${idx + 1}: ${fmt(s.voiceStart)}`}
                onClick={() => setActiveStep(idx)}
              >
                V{idx + 1}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 text-[10px] text-gray-400 flex-shrink-0">
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500 align-middle mr-1" />{t('tutorialEditor.subtitle')}</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500 align-middle mr-1" />{t('tutorialEditor.voiceover')}</span>
        <span className="ml-auto text-gray-500">{t('tutorialEditor.dragClipsHint')}</span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Recortador de MP4 (VideoTrimmerPanel): muestra la línea de tiempo del vídeo
// real seleccionado en el sidebar MP4. Permite cortar por delante (manejador
// izquierdo), por detrás (manejador derecho) y extraer un fragmento del medio
// (dos manejadores rojos que marcan el trozo a eliminar). Al exportar se envían
// los rangos a conservar al backend, que corta/concatena con ffmpeg.
// ─────────────────────────────────────────────────────────────────────────────
const VideoTrimmerPanel: React.FC<{
  videoSrc: string;
  onExport: (segments: Array<{ start: number; end: number; speed?: number }>) => void;
  rebuilding: boolean;
  progress: number;
  message: string;
}> = ({ videoSrc, onExport, rebuilding, progress, message }) => {
  const { t } = useI18n();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [midCut, setMidCut] = useState<{ enabled: boolean; start: number; end: number }>({ enabled: false, start: 0, end: 0 });
  // Región de cambio de velocidad: una porción del vídeo a la que se le aplica
  // un multiplicador de velocidad (0.5x = más lenta, 2x = más ligera).
  const [speedRegion, setSpeedRegion] = useState<{ enabled: boolean; start: number; end: number; speed: number }>({ enabled: false, start: 0, end: 0, speed: 1 });

  // Estado del arrastre: qué manejador se mueve y su X inicial + valor original.
  const dragRef = React.useRef<{ handle: 'start' | 'end' | 'midStart' | 'midEnd' | 'speedStart' | 'speedEnd'; startX: number; orig: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Al cargar metadatos del vídeo: fijamos duración y reseteamos los manejadores.
  const onLoadedMeta = () => {
    const v = videoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    setDuration(d);
    setTrimStart(0);
    setTrimEnd(d);
    setMidCut({ enabled: false, start: Math.round(d * 0.4 * 10) / 10, end: Math.round(d * 0.6 * 10) / 10 });
    setSpeedRegion({ enabled: false, start: Math.round(d * 0.3 * 10) / 10, end: Math.round(d * 0.5 * 10) / 10, speed: 1 });
    setCurrent(0);
  };

  // Reproducción: al terminar, volver al inicio del recorte.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setCurrent(v.currentTime);
      // Si pasamos el trimEnd (o estamos en el tramo eliminado del medio), pausar.
      if (midCut.enabled && v.currentTime >= midCut.start && v.currentTime < midCut.end) {
        v.currentTime = midCut.end;
      }
      if (v.currentTime >= trimEnd) {
        v.pause();
        v.currentTime = trimStart;
        setIsPlaying(false);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [trimStart, trimEnd, midCut]);

  // Arrastre de manejadores.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      const strip = stripRef.current;
      if (!d || !strip || !duration) return;
      const rect = strip.getBoundingClientRect();
      const deltaSec = ((e.clientX - d.startX) / rect.width) * duration;
      const round = (n: number) => Math.round(n * 10) / 10;
      if (d.handle === 'start') {
        const ns = Math.max(0, Math.min(trimEnd - 0.2, d.orig + deltaSec));
        setTrimStart(round(ns));
      } else if (d.handle === 'end') {
        const ne = Math.max(trimStart + 0.2, Math.min(duration, d.orig + deltaSec));
        setTrimEnd(round(ne));
      } else if (d.handle === 'midStart') {
        const ns = Math.max(trimStart + 0.1, Math.min(midCut.end - 0.1, d.orig + deltaSec));
        setMidCut(m => ({ ...m, start: round(ns) }));
      } else if (d.handle === 'midEnd') {
        const ne = Math.max(midCut.start + 0.1, Math.min(trimEnd - 0.1, d.orig + deltaSec));
        setMidCut(m => ({ ...m, end: round(ne) }));
      } else if (d.handle === 'speedStart') {
        const ns = Math.max(trimStart + 0.1, Math.min(speedRegion.end - 0.1, d.orig + deltaSec));
        setSpeedRegion(m => ({ ...m, start: round(ns) }));
      } else if (d.handle === 'speedEnd') {
        const ne = Math.max(speedRegion.start + 0.1, Math.min(trimEnd - 0.1, d.orig + deltaSec));
        setSpeedRegion(m => ({ ...m, end: round(ne) }));
      }
    };
    const onUp = () => { dragRef.current = null; setDragging(false); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, duration, trimStart, trimEnd, midCut, speedRegion]);

  const startHandleDrag = (e: React.MouseEvent, handle: 'start' | 'end' | 'midStart' | 'midEnd' | 'speedStart' | 'speedEnd') => {
    e.preventDefault();
    e.stopPropagation();
    const orig =
      handle === 'start' ? trimStart :
      handle === 'end' ? trimEnd :
      handle === 'midStart' ? midCut.start :
      handle === 'midEnd' ? midCut.end :
      handle === 'speedStart' ? speedRegion.start : speedRegion.end;
    dragRef.current = { handle, startX: e.clientX, orig };
    setDragging(true);
  };

  // Click en la tira → seek.
  const onStripClick = (e: React.MouseEvent) => {
    if (dragging) return;
    const v = videoRef.current;
    const strip = stripRef.current;
    if (!v || !strip || !duration) return;
    const rect = strip.getBoundingClientRect();
    const t = Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration));
    v.currentTime = t;
    setCurrent(t);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < trimStart || v.currentTime >= trimEnd) v.currentTime = trimStart;
      v.play();
    } else {
      v.pause();
    }
  };

  const resetTrim = () => {
    setTrimStart(0);
    setTrimEnd(duration);
    setMidCut(m => ({ ...m, enabled: false, start: Math.round(duration * 0.4 * 10) / 10, end: Math.round(duration * 0.6 * 10) / 10 }));
    setSpeedRegion(m => ({ ...m, enabled: false, start: Math.round(duration * 0.3 * 10) / 10, end: Math.round(duration * 0.5 * 10) / 10, speed: 1 }));
    const v = videoRef.current;
    if (v) { v.currentTime = 0; setCurrent(0); }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // Construye la lista de segmentos a conservar (con su velocidad) combinando
  // el recorte frontal/trasero, el corte medio (eliminado) y la región de
  // velocidad. El resultado es una lista ordenada de {start, end, speed} que
  // el backend corta y concatena con ffmpeg.
  const buildSegments = (): Array<{ start: number; end: number; speed: number }> => {
    // 1) Rangos base a conservar tras quitar el corte medio.
    let ranges: Array<{ start: number; end: number }> =
      midCut.enabled && midCut.end > midCut.start
        ? [{ start: trimStart, end: midCut.start }, { start: midCut.end, end: trimEnd }]
        : [{ start: trimStart, end: trimEnd }];
    ranges = ranges.filter(r => r.end > r.start + 0.05);

    // 2) Si no hay región de velocidad útil, todo a 1x.
    const speedOn = speedRegion.enabled && speedRegion.end > speedRegion.start && speedRegion.speed > 0 && speedRegion.speed !== 1;
    if (!speedOn) return ranges.map(r => ({ ...r, speed: 1 }));

    // 3) Partir cada rango base según el solape con la región de velocidad.
    const out: Array<{ start: number; end: number; speed: number }> = [];
    for (const r of ranges) {
      const cs = Math.max(r.start, speedRegion.start);
      const ce = Math.min(r.end, speedRegion.end);
      if (cs > r.start) out.push({ start: r.start, end: cs, speed: 1 });
      if (ce > cs) out.push({ start: cs, end: ce, speed: speedRegion.speed });
      if (r.end > ce) out.push({ start: ce, end: r.end, speed: 1 });
    }
    return out.filter(s => s.end > s.start + 0.05);
  };

  const doExport = () => {
    if (!duration) return;
    const segs = buildSegments();
    if (segs.length === 0) return;
    onExport(segs);
  };

  // Duración resultante estimada: Σ (end-start)/speed.
  const resultDuration = () => {
    return buildSegments().reduce((acc, s) => acc + (s.end - s.start) / (s.speed || 1), 0);
  };

  if (!duration) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <video ref={videoRef} src={videoSrc} className="hidden" onLoadedMetadata={onLoadedMeta} />
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <RefreshCw className="h-8 w-8 animate-spin opacity-70" />
          <span className="text-sm">{t('tutorialEditor.loadingVideoTrim')}</span>
        </div>
      </div>
    );
  }

  const pct = (t: number) => `${(t / duration) * 100}%`;
  const playPct = (current / duration) * 100;

  return (
    <div className="absolute inset-0 flex flex-col gap-3 overflow-hidden">
      {/* Vídeo oculto (se reproduce por control propio) + vista miniatura */}
      <video ref={videoRef} src={videoSrc} className="hidden" onLoadedMetadata={onLoadedMeta} />

      {/* Tira de timeline con manejadores */}
      <div ref={stripRef} className="relative h-24 bg-[#0d1117] border border-gray-700 rounded-lg overflow-hidden select-none cursor-pointer flex-shrink-0" onClick={onStripClick}>
        {/* Marcas cada 10% */}
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="absolute top-0 bottom-0 border-l border-gray-800 pointer-events-none" style={{ left: `${(i + 1) * 10}%` }}>
            <span className="absolute top-0.5 left-1 text-[9px] text-gray-600">{fmt((duration * (i + 1)) / 10)}</span>
          </div>
        ))}

        {/* Región a conservar (verde) */}
        <div className="absolute top-0 bottom-0 bg-emerald-500/15 border-x border-emerald-500/40 pointer-events-none" style={{ left: pct(trimStart), width: `calc(${pct(trimEnd)} - ${pct(trimStart)})` }} />

        {/* Tramo a eliminar del medio (rojo) */}
        {midCut.enabled && (
          <div className="absolute top-0 bottom-0 bg-red-500/25 border-x border-red-500/60 pointer-events-none flex items-center justify-center" style={{ left: pct(midCut.start), width: `calc(${pct(midCut.end)} - ${pct(midCut.start)})` }}>
            <Scissors className="h-4 w-4 text-red-300" />
          </div>
        )}

        {/* Región de cambio de velocidad (ámbar) */}
        {speedRegion.enabled && (
          <div className="absolute top-0 bottom-0 bg-amber-500/20 border-x border-amber-500/60 pointer-events-none flex items-center justify-center" style={{ left: pct(speedRegion.start), width: `calc(${pct(speedRegion.end)} - ${pct(speedRegion.start)})` }}>
            <span className="text-[10px] text-amber-300 font-semibold">x{speedRegion.speed}</span>
          </div>
        )}

        {/* Playhead */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-white/80 pointer-events-none z-20" style={{ left: `${playPct}%` }} />

        {/* Manejador inicio (corta por delante) */}
        <div
          onMouseDown={(e) => startHandleDrag(e, 'start')}
          className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize bg-emerald-400 hover:bg-emerald-300 z-30 flex items-center justify-center rounded-l"
          style={{ left: pct(trimStart) }}
          title={`Inicio: ${fmt(trimStart)}`}
        >
          <div className="w-0.5 h-6 bg-emerald-950" />
        </div>
        {/* Manejador fin (corta por detrás) */}
        <div
          onMouseDown={(e) => startHandleDrag(e, 'end')}
          className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize bg-emerald-400 hover:bg-emerald-300 z-30 flex items-center justify-center rounded-r"
          style={{ left: pct(trimEnd) }}
          title={`Fin: ${fmt(trimEnd)}`}
        >
          <div className="w-0.5 h-6 bg-emerald-950" />
        </div>
        {/* Manejadores del corte central */}
        {midCut.enabled && (
          <>
            <div
              onMouseDown={(e) => startHandleDrag(e, 'midStart')}
              className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize bg-red-500 hover:bg-red-400 z-30 flex items-center justify-center"
              style={{ left: pct(midCut.start) }}
              title={`Corte medio inicio: ${fmt(midCut.start)}`}
            >
              <div className="w-0.5 h-6 bg-red-950" />
            </div>
            <div
              onMouseDown={(e) => startHandleDrag(e, 'midEnd')}
              className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize bg-red-500 hover:bg-red-400 z-30 flex items-center justify-center"
              style={{ left: pct(midCut.end) }}
              title={`Corte medio fin: ${fmt(midCut.end)}`}
            >
              <div className="w-0.5 h-6 bg-red-950" />
            </div>
          </>
        )}
        {/* Manejadores de la región de velocidad (ámbar) */}
        {speedRegion.enabled && (
          <>
            <div
              onMouseDown={(e) => startHandleDrag(e, 'speedStart')}
              className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize bg-amber-400 hover:bg-amber-300 z-30 flex items-center justify-center"
              style={{ left: pct(speedRegion.start) }}
              title={`Velocidad inicio: ${fmt(speedRegion.start)}`}
            >
              <div className="w-0.5 h-6 bg-amber-950" />
            </div>
            <div
              onMouseDown={(e) => startHandleDrag(e, 'speedEnd')}
              className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize bg-amber-400 hover:bg-amber-300 z-30 flex items-center justify-center"
              style={{ left: pct(speedRegion.end) }}
              title={`Velocidad fin: ${fmt(speedRegion.end)}`}
            >
              <div className="w-0.5 h-6 bg-amber-950" />
            </div>
          </>
        )}
      </div>

      {/* Controles y tiempos */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button size="sm" variant="ghost" onClick={togglePlay} className="h-8 px-2 text-white hover:bg-gray-800">
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <span className="text-gray-500">Recorte:</span>
          <TimeInput value={trimStart} onChange={(n) => setTrimStart(Math.min(n, trimEnd - 0.2))} min={0} />
          <span className="text-gray-600">→</span>
          <TimeInput value={trimEnd} onChange={(n) => setTrimEnd(Math.max(n, trimStart + 0.2))} min={0} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={resetTrim} className="h-8 px-2 text-gray-300 hover:bg-gray-800" title="Reiniciar recorte">
            <RotateCcw className="h-4 w-4 mr-1" /> Reiniciar
          </Button>
          <Button
            size="sm"
            variant={midCut.enabled ? 'destructive' : 'ghost'}
            onClick={() => setMidCut(m => ({ ...m, enabled: !m.enabled }))}
            className="h-8 px-2"
            title="Marcar un fragmento del medio para eliminar"
          >
            <Scissors className="h-4 w-4 mr-1" /> {midCut.enabled ? 'Corte medio ON' : 'Cortar fragmento medio'}
          </Button>
          {midCut.enabled && (
            <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
              <TimeInput value={midCut.start} onChange={(n) => setMidCut(m => ({ ...m, start: Math.min(n, m.end - 0.1) }))} min={0} />
              <span className="text-gray-600">→</span>
              <TimeInput value={midCut.end} onChange={(n) => setMidCut(m => ({ ...m, end: Math.max(n, m.start + 0.1) }))} min={0} />
            </div>
          )}
          <Button
            size="sm"
            variant={speedRegion.enabled ? 'default' : 'ghost'}
            onClick={() => setSpeedRegion(m => ({ ...m, enabled: !m.enabled }))}
            className={cn("h-8 px-2", !speedRegion.enabled && "text-amber-300 hover:bg-gray-800")}
            style={speedRegion.enabled ? { backgroundColor: '#f59e0b', color: '#1c1917' } : undefined}
            title={t('tutorialEditor.speedPortionTitle')}
          >
            <Zap className="h-4 w-4 mr-1" /> {speedRegion.enabled ? t('tutorialEditor.speedOn') : t('tutorialEditor.changeSpeed')}
          </Button>
          <Button
            size="sm"
            onClick={doExport}
            disabled={rebuilding || !duration}
            className="h-8 px-3 bg-emerald-600 hover:bg-emerald-500"
            style={{ color: '#022c22' }}
          >
            <Scissors className={cn("h-4 w-4 mr-2", rebuilding && "animate-spin")} />
            {rebuilding ? t('tutorialEditor.trimming') : t('tutorialEditor.exportTrim')}
          </Button>
        </div>
      </div>

      {/* Controles de la región de velocidad */}
      {speedRegion.enabled && (
        <div className="flex items-center gap-2 flex-shrink-0 text-[11px] text-gray-400">
          <span className="text-amber-300 font-medium">{t('tutorialEditor.speedLabel')}:</span>
          <TimeInput value={speedRegion.start} onChange={(n) => setSpeedRegion(m => ({ ...m, start: Math.max(trimStart + 0.1, Math.min(n, m.end - 0.1)) }))} min={0} />
          <span className="text-gray-600">→</span>
          <TimeInput value={speedRegion.end} onChange={(n) => setSpeedRegion(m => ({ ...m, end: Math.min(trimEnd - 0.1, Math.max(n, m.start + 0.1)) }))} min={0} />
          <div className="flex items-center gap-2 ml-2">
            <span className="text-gray-500">x{speedRegion.speed.toFixed(2)}</span>
            <Slider
              value={[Math.round(speedRegion.speed * 100)]}
              min={50}
              max={200}
              step={5}
              onValueChange={([v]) => setSpeedRegion(m => ({ ...m, speed: v / 100 }))}
              className="w-40"
            />
            <div className="flex gap-1">
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map(sp => (
                <button
                  key={sp}
                  onClick={() => setSpeedRegion(m => ({ ...m, speed: sp }))}
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] border",
                    speedRegion.speed === sp ? "bg-amber-500 text-amber-950 border-amber-400" : "bg-[#161b22] text-gray-300 border-gray-700 hover:border-gray-500"
                  )}
                >
                  {sp}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Barra de progreso del recorte */}
      {rebuilding && (
        <div className="flex-shrink-0">
          <div className="flex justify-between text-[11px] text-gray-400 mb-0.5">
            <span className="truncate">{message}</span>
            <span className="ml-2 flex-shrink-0">{progress}%</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Resumen de duración resultante */}
      <div className="flex items-center gap-3 text-[11px] text-gray-400 flex-shrink-0">
        <span>{t('tutorialEditor.totalDuration')}<span className="text-white font-medium">{fmt(duration)}</span></span>
        <span>{t('tutorialEditor.resultLabel')} <span className="text-emerald-400 font-medium">{fmt(Math.max(0, resultDuration()))}</span></span>
        {speedRegion.enabled && speedRegion.speed !== 1 && (
          <span className="text-amber-400">{t('tutorialEditor.speedOnIn', { speed: speedRegion.speed.toFixed(2), dur: fmt(speedRegion.end - speedRegion.start) })}</span>
        )}
        <span className="text-gray-500">{t('tutorialEditor.dragHandlersHint')}</span>
      </div>
    </div>
  );
};

const TimelineCardsPanel: React.FC<{
  tutorial: Tutorial;
  onRebuilt: (t: Tutorial) => void;
  toast: (opts: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;
  onExport?: (exportFn: () => void) => void;
  isRebuilding?: boolean;
  progress?: number;
  message?: string;
  videoBrightness: number;
  videoContrast: number;
  videoIntensity: number;
  videoTimeOffset: number;
  voiceoverVolume: number;
  musicVolume: number;
  editedSteps: EditedStep[];
  setEditedSteps: React.Dispatch<React.SetStateAction<EditedStep[]>>;
  onExportTabs?: () => void;
  onImportTabs?: () => void;
}> = ({ tutorial, onRebuilt, toast, onExport, isRebuilding: externalIsRebuilding, progress: externalProgress, message: externalMessage, videoBrightness, videoContrast, videoIntensity, videoTimeOffset, voiceoverVolume, musicVolume, editedSteps, setEditedSteps, onExportTabs, onImportTabs }) => {
  const { t } = useI18n();
  const initial = React.useMemo(() => buildEditedSteps(tutorial), [tutorial.id]);
  const total = initial.total;
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');

  const rawAvailable = !!tutorial.metadata?.rawVideoPath;

  // Ref al contenedor de tarjetas para autodesplazar a la última creada.
  const cardsScrollRef = React.useRef<HTMLDivElement>(null);
  const prevStepsCountRef = React.useRef<number>(editedSteps.length);

  // Cuando se añade una tarjeta, desplazar el scroll horizontal al final para
  // que la nueva tarjeta sea visible (se añaden a la derecha).
  React.useEffect(() => {
    if (editedSteps.length > prevStepsCountRef.current) {
      const el = cardsScrollRef.current;
      if (el) {
        // rAF para esperar a que la nueva tarjeta esté en el DOM.
        requestAnimationFrame(() => {
          if (cardsScrollRef.current) {
            cardsScrollRef.current.scrollTo({
              left: cardsScrollRef.current.scrollWidth,
              behavior: 'smooth',
            });
          }
        });
      }
    }
    prevStepsCountRef.current = editedSteps.length;
  }, [editedSteps.length]);

  const resetStep = (idx: number) => {
    setEditedSteps((prev: EditedStep[]) => {
      const next = [...prev];
      let cursor = 0;
      for (let i = 0; i < next.length; i++) {
        if (i < idx) { cursor = next[i].subtitleEnd; continue; }
        if (i === idx) {
          const dur = next[i].duration;
          next[i] = { ...next[i], subtitleStart: cursor, subtitleEnd: cursor + dur, voiceStart: cursor };
        }
      }
      return next;
    });
  };

  const updateStep = (idx: number, patch: Partial<EditedStep>) => {
    setEditedSteps((prev: EditedStep[]) => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  // Crear una tarjeta manual nueva. Continúa desde el final de la última
  // tarjeta (o desde 0 si no hay ninguna). El id debe ser único y estable para
  // que runTutorialRebuild lo encuentre al hacer merge por id.
  const addStep = () => {
    setEditedSteps((prev: EditedStep[]) => {
      const last = prev.length > 0 ? prev[prev.length - 1] : null;
      const start = last ? last.subtitleEnd : 0;
      const duration = 3;
      const newId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const newStep: EditedStep = {
        id: newId,
        order: (last?.order ?? prev.length) + 1,
        action: `Tarjeta ${prev.length + 1}`,
        subtitle: '',
        voiceover: '',
        subtitleStart: start,
        subtitleEnd: start + duration,
        voiceStart: start,
        duration,
      };
      return [...prev, newStep];
    });
  };

  const deleteStep = (idx: number) => {
    setEditedSteps((prev: EditedStep[]) => prev.filter((_, i) => i !== idx));
  };

  // Mover una tarjeta una posición a la izquierda o derecha. La tarjeta "salta"
  // a su vecina y se reordenan los números (Paso N), que se calculan por índice.
  const moveStep = (idx: number, dir: -1 | 1) => {
    setEditedSteps((prev: EditedStep[]) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  // Nombre de archivo seguro a partir del título del tutorial.
  const cardsFileName = () => {
    const base = (tutorial?.title || tutorial?.id || 'tarjetas')
      .replace(/[\\/:*?"<>|]+/g, '_').trim() || 'tarjetas';
    return `${base}.json`;
  };

  // Exportar todas las tarjetas del proyecto a un archivo JSON. En escritorio
  // (Electron) se guarda vía diálogo en la carpeta de la app; en web se descarga.
  const exportCards = async () => {
    if (editedSteps.length === 0) {
      toast({ title: 'No hay tarjetas', description: 'Crea alguna tarjeta antes de exportar.', variant: 'destructive' });
      return;
    }
    const payload = {
      app: 'Editor Tutoriales Zeus IA',
      version: 1,
      exportedAt: new Date().toISOString(),
      project: { id: tutorial?.id, title: tutorial?.title },
      cards: editedSteps.map((s, i) => ({
        order: i + 1,
        id: s.id,
        action: s.action,
        subtitle: s.subtitle,
        voiceover: s.voiceover,
        subtitleStart: s.subtitleStart,
        subtitleEnd: s.subtitleEnd,
        voiceStart: s.voiceStart,
        duration: s.duration,
      })),
    };
    const json = JSON.stringify(payload, null, 2);
    const name = cardsFileName();

    try {
      const ea: any = (typeof window !== 'undefined' ? (window as any).electronAPI : undefined);
      if (ea?.exportCardsJson) {
        const saved = await ea.exportCardsJson(json, name);
        if (saved) {
          toast({ title: 'Tarjetas exportadas', description: `Guardado en: ${saved}` });
        }
        return;
      }
      // Fallback web: descargar el archivo.
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: 'Tarjetas exportadas', description: `Archivo ${name} descargado.` });
    } catch (err: any) {
      console.error('Error exportando tarjetas:', err);
      toast({ title: 'Error al exportar', description: err?.message || 'No se pudo exportar el JSON.', variant: 'destructive' });
    }
  };

  // Importar tarjetas desde un JSON exportado previamente. Reemplaza las
  // tarjetas actuales (regenera ids para evitar colisiones entre proyectos).
  const importCards = async () => {
    const applyImport = (text: string) => {
      try {
        const data = JSON.parse(text);
        const list: any[] = Array.isArray(data) ? data : (Array.isArray(data?.cards) ? data.cards : null);
        if (!list) {
          toast({ title: t('tutorialEditor.invalidJson'), description: t('tutorialEditor.noCardsList'), variant: 'destructive' });
          return;
        }
        const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
          ? crypto.randomUUID()
          : `imp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const imported: EditedStep[] = list.map((s: any, i: number) => ({
          id: newId(),
          order: i + 1,
          action: s.action ?? `Tarjeta ${i + 1}`,
          subtitle: String(s.subtitle ?? ''),
          voiceover: String(s.voiceover ?? ''),
          subtitleStart: Number(s.subtitleStart ?? 0),
          subtitleEnd: Number(s.subtitleEnd ?? 0),
          voiceStart: Number(s.voiceStart ?? 0),
          duration: Number(s.duration ?? 0),
        }));
        setEditedSteps(imported);
        toast({ title: 'Tarjetas importadas', description: `${imported.length} tarjeta(s) cargada(s).` });
      } catch (err: any) {
        console.error('Error importando tarjetas:', err);
        toast({ title: 'Error al importar', description: err?.message || 'No se pudo leer el JSON.', variant: 'destructive' });
      }
    };

    try {
      const ea: any = (typeof window !== 'undefined' ? (window as any).electronAPI : undefined);
      if (ea?.importCardsJson) {
        const text = await ea.importCardsJson();
        if (typeof text === 'string') applyImport(text);
        return;
      }
      // Fallback web: selector de archivo.
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => applyImport(String(reader.result ?? ''));
        reader.readAsText(f);
      };
      input.click();
    } catch (err: any) {
      console.error(t('tutorialEditor.errOpeningImporter'), err);
      toast({ title: 'Error al importar', description: err?.message || 'No se pudo abrir el archivo.', variant: 'destructive' });
    }
  };

  const handleExport = async () => {
    if (!rawAvailable) return;
    try {
      setIsRebuilding(true);
      setProgress(0);
      setMessage(t('tutorialEditor.preparingRegen'));

      // Si editedSteps está vacío, caemos a los pasos del tutorial para no
      // enviar un steps[] vacío (el backend lo rechaza).
      const sourceSteps = editedSteps.length > 0
        ? editedSteps
        : buildEditedSteps(tutorial).steps;

      const payload = {
        steps: sourceSteps.map(s => ({
          id: s.id,
          subtitle: s.subtitle,
          voiceover: s.voiceover,
          subtitleStart: s.subtitleStart,
          subtitleEnd: s.subtitleEnd,
          voiceStart: s.voiceStart,
          duration: s.duration,
        })),
        settings: {
          ...tutorial.settings,
          voiceoverVolume: voiceoverVolume ?? 0.8,
          musicVolume: musicVolume ?? 0.3,
        },
        backgroundMusicUrl: tutorial.backgroundMusicUrl,
        videoSettings: {
          brillo: videoBrightness,
          contraste: videoContrast,
          intensidad: videoIntensity,
          tiempo_inicio: videoTimeOffset,
        },
      };

      // Persistir las tarjetas (steps) y los volúmenes ANTES del rebuild.
      // Crítico para el modo manual: las tarjetas nuevas solo existen en
      // editedSteps; si no se persisten aquí, runTutorialRebuild las pierde.
      try {
        await Api.api_tutorials_update(tutorial.id, {
          steps: payload.steps,
          settings: payload.settings,
        });
      } catch (persistErr) {
        console.warn('No se pudieron persistir las tarjetas antes del rebuild:', persistErr);
      }

      const resp = await Api.api_tutorials_rebuild(tutorial.id, payload);
      const jobId = resp.id;

      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(async () => {
          try {
            const status = await Api.api_tutorials_generation_status(jobId);
            setProgress(status.progress || 0);
            setMessage(status.message || '');
            if (status.status === 'completed') {
              clearInterval(interval);
              if (status.tutorial) {
                onRebuilt(status.tutorial as Tutorial);
                toast({ title: '¡MP4 re-generado!', description: t('tutorialEditor.subsVoiceUpdated') });
              }
              resolve();
            } else if (status.status === 'failed') {
              clearInterval(interval);
              reject(new Error(status.error || status.message || t('tutorialEditor.errRegeneration')));
            }
          } catch (pollErr) {
            console.warn('Rebuild poll error:', pollErr);
          }
        }, 2000);
      });
    } catch (error: any) {
      console.error('Rebuild error:', error);
      toast({ title: 'Error al re-generar', description: error?.message || 'Hubo un problema.', variant: 'destructive' });
    } finally {
      setIsRebuilding(false);
      setProgress(0);
      setMessage('');
    }
  };

  // Exponer la función de exportación si se pasa el prop onExport
  React.useEffect(() => {
    if (onExport) {
      onExport(handleExport);
    }
  }, [steps, onExport]);

  // Sincronizar estado interno con estado externo cuando se pasan props
  React.useEffect(() => {
    if (externalIsRebuilding !== undefined) {
      setIsRebuilding(externalIsRebuilding);
    }
  }, [externalIsRebuilding]);

  React.useEffect(() => {
    if (externalProgress !== undefined) {
      setProgress(externalProgress);
    }
  }, [externalProgress]);

  React.useEffect(() => {
    if (externalMessage !== undefined) {
      setMessage(externalMessage);
    }
  }, [externalMessage]);

  const handleSaveSteps = async () => {
    try {
      const updatedSteps = editedSteps.map(s => ({
        id: s.id,
        subtitle: s.subtitle,
        voiceover: s.voiceover,
        subtitleStart: s.subtitleStart,
        subtitleEnd: s.subtitleEnd,
        voiceStart: s.voiceStart,
        duration: s.duration,
      }));
      
      const updated = await Api.api_tutorials_update(tutorial.id, { steps: updatedSteps });
      onRebuilt(updated);
      toast({ title: t('tutorialEditor.changesSaved'), description: t('tutorialEditor.stepsUpdated') });
    } catch (error) {
      toast({ title: 'Error al guardar', description: 'No se pudieron guardar los cambios.', variant: 'destructive' });
    }
  };

  return (
    <div className="flex flex-col h-full w-full space-y-4">
      <div className="flex items-center justify-between text-xs text-gray-400 flex-shrink-0">
        <span>{t('tutorialEditor.recordingDuration')}<span className="text-white font-medium">{Math.floor(total / 60)}:{String(Math.floor(total % 60)).padStart(2, '0')}</span> · <span className="text-gray-500">{t('tutorialEditor.timesHint')}</span></span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={addStep}
            className="border-emerald-700 bg-emerald-900/30 hover:bg-emerald-800/40 text-emerald-300 text-xs h-7"
          >
            <Plus className="h-3 w-3 mr-1.5" />{t('tutorialEditor.addCard')}</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onExportTabs ? onExportTabs : exportCards}
            title={t('tutorialEditor.exportTabsTitle')}
            className="border-sky-700 bg-sky-900/30 hover:bg-sky-800/40 text-sky-300 text-xs h-7"
          >
            <Download className="h-3 w-3 mr-1.5" />{t('tutorialEditor.exportBtn')}</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onImportTabs ? onImportTabs : importCards}
            title={t('tutorialEditor.importTabsTitle')}
            className="border-amber-700 bg-amber-900/30 hover:bg-amber-800/40 text-amber-300 text-xs h-7"
          >
            <Upload className="h-3 w-3 mr-1.5" />{t('tutorialEditor.importBtn')}</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSaveSteps}
            className="border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-xs h-7"
          >
            <Save className="h-3 w-3 mr-1.5" />{t('tutorialEditor.saveChanges')}</Button>
          {!rawAvailable && (
            <span className="text-amber-400">{t('tutorialEditor.noRawUploadHint')}</span>
          )}
        </div>
      </div>

      {/* Tarjetas de edición en scroll horizontal. El área rellena el contenedor
          (600px) y desplaza horizontalmente; las tarjetas conservan su altura
          natural (items-start) para verse completas sin aplastarse. */}
      <div className="relative w-full min-h-0 flex-1 overflow-hidden">
        <div ref={cardsScrollRef} className="absolute inset-0 overflow-x-auto overflow-y-auto pb-1 timeline-scrollbar custom-scrollbar">
          <div className="flex gap-4 items-start" style={{ width: 'max-content' }}>
            {editedSteps.map((s, idx) => (
              <div key={idx} className="flex-shrink-0 w-97 border-t-2 border-gray-700 rounded-lg p-4 bg-[#0d1117]">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-white">{t('tutorialEditor.stepN', { n: idx + 1, action: s.action || '' })}</span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => moveStep(idx, -1)}
                      disabled={idx === 0}
                      title="Mover a la izquierda (salta la tarjeta de su izquierda)"
                      className="text-[14px] text-gray-300 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed leading-none"
                    >
                      ◀
                    </button>
                    <button
                      onClick={() => moveStep(idx, 1)}
                      disabled={idx === editedSteps.length - 1}
                      title="Mover a la derecha (salta la tarjeta de su derecha)"
                      className="text-[14px] text-gray-300 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed leading-none"
                    >
                      ▶
                    </button>
                    <button onClick={() => resetStep(idx)} className="text-[10px] text-gray-400 hover:text-white underline">{t('tutorialEditor.reset')}</button>
                    <button
                      onClick={() => deleteStep(idx)}
                      title="Eliminar tarjeta"
                      className="text-[10px] text-red-400 hover:text-red-300 underline"
                    >{t('tutorialEditor.delete')}</button>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-gray-400">{t('tutorialEditor.subtitle')}</Label>
                      <textarea
                        value={s.subtitle}
                        onChange={e => updateStep(idx, { subtitle: e.target.value })}
                        rows={3}
                        className="w-full text-xs bg-[#161b22] border border-gray-700 rounded px-2 py-1 text-white resize-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-gray-400">{t('tutorialEditor.voiceoverTts')}</Label>
                      <textarea
                        value={s.voiceover}
                        onChange={e => updateStep(idx, { voiceover: e.target.value })}
                        rows={3}
                        className="w-full text-xs bg-[#161b22] border border-gray-700 rounded px-2 py-1 text-white resize-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-400">{t('tutorialEditor.subStart')}</Label>
                      <TimeInput min={0} value={s.subtitleStart}
                        onChange={n => updateStep(idx, { subtitleStart: n })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-400">{t('tutorialEditor.subEnd')}</Label>
                      <TimeInput min={0} value={s.subtitleEnd}
                        onChange={n => updateStep(idx, { subtitleEnd: n })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-400">{t('tutorialEditor.voiceStart')}</Label>
                      <TimeInput min={0} value={s.voiceStart}
                        onChange={n => updateStep(idx, { voiceStart: n })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-400">{t('tutorialEditor.duration')}</Label>
                      <TimeInput min={0} value={s.duration}
                        onChange={d => updateStep(idx, { duration: d, subtitleEnd: s.subtitleStart + d })} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Atlas: panel de mapas de pantalla (pantallas + transiciones) ──
const AtlasPanel: React.FC<{
  screens: Api.Screen[];
  setScreens: React.Dispatch<React.SetStateAction<Api.Screen[]>>;
  transitions: Api.ScreenTransition[];
  setTransitions: React.Dispatch<React.SetStateAction<Api.ScreenTransition[]>>;
  controlPointsReal: Api.ControlPointReal[];
  setControlPointsReal: React.Dispatch<React.SetStateAction<Api.ControlPointReal[]>>;
  currentScreenId: string | null;
  setCurrentScreenId: (id: string | null) => void;
  defaultTargetApp: string;
  toast: (opts: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;
  onProbarLandmarks?: (screenId: string) => void;
}> = ({ screens, setScreens, transitions, setTransitions, controlPointsReal, setControlPointsReal, currentScreenId, setCurrentScreenId, defaultTargetApp, toast, onProbarLandmarks }) => {
  const { t } = useI18n();
  const [sub, setSub] = useState<'screens' | 'transitions'>('screens');
  // Formulario de pantalla (crear/editar).
  const [screenForm, setScreenForm] = useState({ name: '', targetApp: '', tab: 'Explorador', matchHint: '', layoutHint: '', order: 0 });
  const [editingScreenId, setEditingScreenId] = useState<string | null>(null);
  // Formulario de transición (crear/editar).
  const [trnForm, setTrnForm] = useState<{ fromScreenId: string; toScreenId: string; viaPointId: string; triggerType: string; estimatedDurationSec: number; order: number }>({ fromScreenId: '', toScreenId: '', viaPointId: '', triggerType: 'click', estimatedDurationSec: 1, order: 0 });
  const [editingTrnId, setEditingTrnId] = useState<string | null>(null);

  const screenName = (id: string | null | undefined) => screens.find(s => s.id === id)?.name || '—';
  const pointsOf = (sid: string) => controlPointsReal.filter(p => p.screenId === sid);
  const landmarksOf = (sid: string) => controlPointsReal.filter(p => p.screenId === sid && p.landmark);

  const resetScreenForm = () => { setScreenForm({ name: '', targetApp: defaultTargetApp, tab: 'Explorador', matchHint: '', layoutHint: '', order: screens.length }); setEditingScreenId(null); };
  const resetTrnForm = () => { setTrnForm({ fromScreenId: '', toScreenId: '', viaPointId: '', triggerType: 'click', estimatedDurationSec: 1, order: transitions.length }); setEditingTrnId(null); };

  const saveScreen = async () => {
    if (!screenForm.name.trim()) { toast({ title: 'Nombre requerido', description: 'Pon un nombre a la pantalla.', variant: 'destructive' }); return; }
    try {
      if (editingScreenId) {
        const updated = await Api.api_screens_update(editingScreenId, { name: screenForm.name, targetApp: screenForm.targetApp, tab: screenForm.tab, matchHint: screenForm.matchHint, layoutHint: screenForm.layoutHint, order: screenForm.order });
        setScreens(prev => prev.map(s => s.id === editingScreenId ? updated : s));
        toast({ title: 'Pantalla actualizada' });
      } else {
        const created = await Api.api_screens_create(screenForm.name, screenForm.targetApp, screenForm.tab, screenForm.matchHint, screenForm.layoutHint, screenForm.order);
        setScreens(prev => [...prev, created]);
        toast({ title: 'Pantalla creada', description: created.name });
      }
      resetScreenForm();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'No se pudo guardar la pantalla.', variant: 'destructive' });
    }
  };

  const editScreen = (s: Api.Screen) => {
    setEditingScreenId(s.id);
    setScreenForm({ name: s.name, targetApp: s.targetApp || '', tab: s.tab || '', matchHint: s.matchHint || '', layoutHint: s.layoutHint || '', order: s.order ?? 0 });
  };

  const deleteScreen = async (s: Api.Screen) => {
    if (!confirm(`¿Eliminar la pantalla "${s.name}"? Los puntos que la usan quedarán sin pantalla asignada.`)) return;
    try {
      await Api.api_screens_delete(s.id);
      // Limpiar screenId de los puntos que la usaban (cascadeDelete=false).
      const affected = controlPointsReal.filter(p => p.screenId === s.id);
      for (const p of affected) {
        try { await Api.api_control_points_real_update(p.id, { screenId: null }); } catch { /* ignore */ }
      }
      setControlPointsReal(prev => prev.map(p => p.screenId === s.id ? { ...p, screenId: null } : p));
      setScreens(prev => prev.filter(x => x.id !== s.id));
      setTransitions(prev => prev.filter(t => t.fromScreenId !== s.id && t.toScreenId !== s.id));
      if (currentScreenId === s.id) setCurrentScreenId(null);
      toast({ title: 'Pantalla eliminada' });
    } catch (err: any) {
      toast({ title: t('tutorialEditor.errToast'), description: err?.message || t('tutorialEditor.errDeleteTransition'), variant: 'destructive' });
    }
  };

  const saveTransition = async () => {
    if (!trnForm.fromScreenId || !trnForm.toScreenId) { toast({ title: t('tutorialEditor.missingScreens'), description: t('tutorialEditor.screenOriginDest'), variant: 'destructive' }); return; }
    try {
      const via = trnForm.viaPointId || null;
      if (editingTrnId) {
        const updated = await Api.api_screen_transitions_update(editingTrnId, { fromScreenId: trnForm.fromScreenId, toScreenId: trnForm.toScreenId, viaPointId: via, triggerType: trnForm.triggerType, estimatedDurationSec: trnForm.estimatedDurationSec, order: trnForm.order });
        setTransitions(prev => prev.map(t => t.id === editingTrnId ? updated : t));
        toast({ title: t('tutorialEditor.transitionUpdated') });
      } else {
        const created = await Api.api_screen_transitions_create(trnForm.fromScreenId, trnForm.toScreenId, via, trnForm.triggerType, trnForm.estimatedDurationSec, trnForm.order);
        setTransitions(prev => [...prev, created]);
        toast({ title: t('tutorialEditor.transitionCreated') });
      }
      resetTrnForm();
    } catch (err: any) {
      toast({ title: t('tutorialEditor.errToast'), description: err?.message || t('tutorialEditor.errSaveTransition'), variant: 'destructive' });
    }
  };

  const editTransition = (t: Api.ScreenTransition) => {
    setEditingTrnId(t.id);
    setTrnForm({ fromScreenId: t.fromScreenId || '', toScreenId: t.toScreenId || '', viaPointId: t.viaPointId || '', triggerType: t.triggerType || 'click', estimatedDurationSec: t.estimatedDurationSec ?? 1, order: t.order ?? 0 });
  };

  const deleteTransition = async (trn: Api.ScreenTransition) => {
    if (!confirm(t('tutorialEditor.deleteTransition'))) return;
    try {
      await Api.api_screen_transitions_delete(trn.id);
      setTransitions(prev => prev.filter(x => x.id !== trn.id));
      toast({ title: t('tutorialEditor.transitionDeleted') });
    } catch (err: any) {
      toast({ title: t('tutorialEditor.errToast'), description: err?.message || t('tutorialEditor.errDeleteTransition'), variant: 'destructive' });
    }
  };

  const viaPointOptions = trnForm.fromScreenId ? pointsOf(trnForm.fromScreenId) : [];

  const inputCls = "w-full bg-[#0d1117] border border-gray-700 rounded px-2 py-1.5 text-white text-xs outline-none focus:border-purple-500";

  return (
    <div className="flex-1 p-4 space-y-4 overflow-y-auto custom-scrollbar min-h-0">
      <div className="flex items-center gap-2">
        <button onClick={() => setSub('screens')} className={cn('px-3 py-1.5 text-xs rounded', sub === 'screens' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700')}>{t('tutorialEditor.screensTab', { n: screens.length })}</button>
        <button onClick={() => setSub('transitions')} className={cn('px-3 py-1.5 text-xs rounded', sub === 'transitions' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700')}>{t('tutorialEditor.transitionsTab', { n: transitions.length })}</button>
      </div>

      {sub === 'screens' && (
        <div className="space-y-4">
          {/* Formulario crear/editar pantalla */}
          <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-3 space-y-2">
            <div className="text-xs text-purple-300 font-medium">{editingScreenId ? t('tutorialEditor.editScreen') : t('tutorialEditor.newScreen')}</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-[10px] text-gray-400">{t('tutorialEditor.name')}</Label><input className={inputCls} value={screenForm.name} onChange={e => setScreenForm(f => ({ ...f, name: e.target.value }))} placeholder={t('tutorialEditor.targetTabPlaceholder')} /></div>
              <div className="space-y-1"><Label className="text-[10px] text-gray-400">{t('tutorialEditor.targetTab')}</Label><input className={inputCls} value={screenForm.tab} onChange={e => setScreenForm(f => ({ ...f, tab: e.target.value }))} placeholder="Explorador" /></div>
              <div className="space-y-1"><Label className="text-[10px] text-gray-400">{t('tutorialEditor.targetAppLabel')}</Label><input className={inputCls} value={screenForm.targetApp} onChange={e => setScreenForm(f => ({ ...f, targetApp: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-[10px] text-gray-400">{t('tutorialEditor.order')}</Label><input type="number" className={inputCls} value={screenForm.order} onChange={e => setScreenForm(f => ({ ...f, order: Number(e.target.value) }))} /></div>
            </div>
            <div className="space-y-1"><Label className="text-[10px] text-gray-400">{t('tutorialEditor.matchHint')}</Label><input className={inputCls} value={screenForm.matchHint} onChange={e => setScreenForm(f => ({ ...f, matchHint: e.target.value }))} placeholder={t('tutorialEditor.matchHintPlaceholder')} /></div>
            <div className="space-y-1"><Label className="text-[10px] text-gray-400">{t('tutorialEditor.layoutHint')}</Label><input className={inputCls} value={screenForm.layoutHint} onChange={e => setScreenForm(f => ({ ...f, layoutHint: e.target.value }))} placeholder={t('tutorialEditor.layoutHintPlaceholder')} /></div>
            <div className="flex gap-2">
              <Button size="sm" className="bg-purple-600 hover:bg-purple-500 h-7 text-xs" onClick={saveScreen}>{editingScreenId ? t('tutorialEditor.save') : t('tutorialEditor.createScreen')}</Button>
              {editingScreenId && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={resetScreenForm}>Cancelar</Button>}
            </div>
          </div>

          {/* Lista de pantallas */}
          <div className="space-y-2">
            {screens.length === 0 && <p className="text-xs text-gray-500">{t('tutorialEditor.noScreens')}</p>}
            {screens.map(s => {
              const pts = pointsOf(s.id).length;
              const lms = landmarksOf(s.id).length;
              const isCurrent = currentScreenId === s.id;
              return (
                <div key={s.id} className={cn('bg-[#0d1117] border rounded-lg p-3', isCurrent ? 'border-purple-500' : 'border-gray-700')}>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{s.name} {isCurrent && <span className="text-[10px] text-purple-300">(actual)</span>}</p>
                      <p className="text-[10px] text-gray-400">{s.tab || '—'} · {s.targetApp || '—'} · {pts} pts · {lms} landmarks</p>
                      {s.matchHint && <p className="text-[10px] text-gray-500 truncate">Pista: {s.matchHint}</p>}
                      {s.layoutHint && <p className="text-[10px] text-amber-500/80 truncate">Layout: {s.layoutHint}</p>}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2" disabled={isCurrent} onClick={() => setCurrentScreenId(s.id)}>Usar</Button>
                      {onProbarLandmarks && <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2" disabled={lms < 2} title={lms < 2 ? t('tutorialEditor.needLandmarks') : t('tutorialEditor.moveToLandmarks')} onClick={() => onProbarLandmarks(s.id)}>{t('tutorialEditor.test')}</Button>}
                      <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2" onClick={() => editScreen(s)}>{t('tutorialEditor.edit')}</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2 text-red-400 hover:text-red-300" onClick={() => deleteScreen(s)}>{t('tutorialEditor.deleteShort')}</Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sub === 'transitions' && (
        <div className="space-y-4">
          <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-3 space-y-2">
            <div className="text-xs text-purple-300 font-medium">{editingTrnId ? t('tutorialEditor.editTransitionTitle') : t('tutorialEditor.newTransitionTitle')}</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-[10px] text-gray-400">Desde (pantalla)</Label>
                <select className={inputCls} value={trnForm.fromScreenId} onChange={e => setTrnForm(f => ({ ...f, fromScreenId: e.target.value, viaPointId: '' }))}>
                  <option value="">—</option>{screens.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label className="text-[10px] text-gray-400">Hacia (pantalla)</Label>
                <select className={inputCls} value={trnForm.toScreenId} onChange={e => setTrnForm(f => ({ ...f, toScreenId: e.target.value }))}>
                  <option value="">—</option>{screens.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label className="text-[10px] text-gray-400">{t('tutorialEditor.viaPoint')}</Label>
                <select className={inputCls} value={trnForm.viaPointId} onChange={e => setTrnForm(f => ({ ...f, viaPointId: e.target.value }))} disabled={!trnForm.fromScreenId}>
                  <option value="">— (sin punto) —</option>{viaPointOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label className="text-[10px] text-gray-400">Disparador</Label>
                <select className={inputCls} value={trnForm.triggerType} onChange={e => setTrnForm(f => ({ ...f, triggerType: e.target.value }))}>
                  <option value="click">click</option><option value="navigate">navigate</option><option value="wait">wait</option>
                </select>
              </div>
              <div className="space-y-1"><Label className="text-[10px] text-gray-400">{t('tutorialEditor.estimatedDuration')}</Label><input type="number" step="0.1" className={inputCls} value={trnForm.estimatedDurationSec} onChange={e => setTrnForm(f => ({ ...f, estimatedDurationSec: Number(e.target.value) }))} /></div>
              <div className="space-y-1"><Label className="text-[10px] text-gray-400">{t('tutorialEditor.order')}</Label><input type="number" className={inputCls} value={trnForm.order} onChange={e => setTrnForm(f => ({ ...f, order: Number(e.target.value) }))} /></div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="bg-purple-600 hover:bg-purple-500 h-7 text-xs" onClick={saveTransition}>{editingTrnId ? 'Guardar' : t('tutorialEditor.createTransition')}</Button>
              {editingTrnId && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={resetTrnForm}>Cancelar</Button>}
            </div>
          </div>

          <div className="space-y-2">
            {transitions.length === 0 && <p className="text-xs text-gray-500">{t('tutorialEditor.noTransitions')}</p>}
            {transitions.map(trn => (
              <div key={trn.id} className="bg-[#0d1117] border border-gray-700 rounded-lg p-2.5 flex items-center justify-between">
                <div className="text-xs text-white truncate">
                  <span className="text-gray-300">{screenName(trn.fromScreenId)}</span>
                  <span className="text-purple-400 mx-1.5">→</span>
                  <span className="text-gray-300">{screenName(trn.toScreenId)}</span>
                  <span className="text-gray-500 ml-2">· t('tutorialEditor.viaLabel') {trn.viaPointId ? controlPointsReal.find(p => p.id === trn.viaPointId)?.name || '—' : '—'} · {trn.triggerType || '—'} · ~{trn.estimatedDurationSec ?? 0}s</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2" onClick={() => editTransition(trn)}>{t('tutorialEditor.edit')}</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2 text-red-400 hover:text-red-300" onClick={() => deleteTransition(trn)}>{t('tutorialEditor.deleteShort')}</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};