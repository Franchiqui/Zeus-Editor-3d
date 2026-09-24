'use client';

import { useState, useEffect, useMemo, useRef, ReactNode } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  Music,
  Sparkles,
  Loader2,
  Clock,
  Layers,
  Activity,
  Piano,
  Zap,
  Drum,
  CircleDot,
  AudioLines,
  Wind,
  Play,
  Square,
  Plus,
  Download,
} from 'lucide-react';
import {
  generateMusic,
  MusicGeneratorConfig,
  MusicStyle,
  ProgressionComplexity,
  GenerateMusicResult,
  LOOP_CATALOG,
  LoopCatalogItem,
  LoopCategory,
  GenerateLoopResult,
  generateLoop,
  revokeMusicUrl,
} from '@/lib/procedural-music';
import { startComfyUI, startFluxBridge, isElectron, getLocalPaths, listDirectory, getMediaUrl } from '@/lib/electron-fs';
import { useI18n } from '@/lib/i18n';

interface GenerateMusicModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (result: GenerateMusicResult, config: MusicGeneratorConfig) => void;
  onLoopSelected?: (result: GenerateLoopResult, item: LoopCatalogItem) => void;
  /** Modo teclado MIDI: cuando se añade un archivo, se pasa al callback en lugar de cerrar */
  keyboardMode?: boolean;
  /** Callback cuando se selecciona un archivo en modo teclado MIDI */
  onFileSelectedForKeyboard?: (file: any) => void;
}

const STYLE_LABELS: Record<MusicStyle, string> = {
  ambient: 'music.genreAmbient',
  electronic: 'music.genreElectronic',
  cinematic: 'music.genreCinematic',
  lofi: 'Lo-Fi',
  epic: 'music.epic',
  relax: 'music.genreRelaxation',
  suspense: 'music.suspense',
  happy: 'music.happy',
  sad: 'music.genreMelancholic',
};

const KEY_OPTIONS = [
  'C', 'G', 'D', 'A', 'E', 'B', 'F#',
  'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb',
  'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm',
];

const CATEGORY_LABELS: Record<LoopCategory, string> = {
  drums: 'music.catRhythms',
  bass: 'music.bass',
  pads: 'music.pads',
  percussion: 'music.catPercussion',
};

const CATEGORY_ICONS: Record<LoopCategory, ReactNode> = {
  drums: <Drum className="w-4 h-4" />,
  bass: <AudioLines className="w-4 h-4" />,
  pads: <Wind className="w-4 h-4" />,
  percussion: <CircleDot className="w-4 h-4" />,
};

// Nuevas categorías de ritmos locales
type RhythmCategory = 'audio_electronica' | 'audio_cuerda' | 'audio_percusion' | 'audio_viento';

const RHYTHM_LABELS: Record<RhythmCategory, string> = {
  audio_electronica: 'music.catElectronic',
  audio_cuerda: 'music.strings',
  audio_percusion: 'music.catPercussion',
  audio_viento: 'music.wind',
};

const RHYTHM_ICONS: Record<RhythmCategory, ReactNode> = {
  audio_electronica: <Music className="w-4 h-4 text-cyan-400" />,
  audio_cuerda: <Music className="w-4 h-4 text-blue-400" />,
  audio_percusion: <Music className="w-4 h-4 text-yellow-400" />,
  audio_viento: <Music className="w-4 h-4 text-pink-400" />,
};

export default function GenerateMusicModal({
  isOpen,
  onClose,
  onGenerated,
  onLoopSelected,
  keyboardMode = false,
  onFileSelectedForKeyboard,
}: GenerateMusicModalProps) {
  const { t } = useI18n();
  const [style, setStyle] = useState<MusicStyle>('ambient');
  const [duration, setDuration] = useState<number>(30);
  const [bpm, setBpm] = useState<number>(90);
  const [key, setKey] = useState<string>('C');
  const [intensity, setIntensity] = useState<number>(0.5);
  const [progression, setProgression] = useState<ProgressionComplexity>('moderate');
  const [layers, setLayers] = useState({
    pads: true,
    bass: true,
    drums: false,
    melody: true,
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);

  // Tabs
  const [activeTab, setActiveTab] = useState<'generate' | 'ai' | 'loops'>('generate');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDuration, setAiDuration] = useState(30);
  const [aiSeed, setAiSeed] = useState<number | null>(null);
  const [aiFileName, setAiFileName] = useState('');
  const [audioServerStatus, setAudioServerStatus] = useState({ comfyui: false, bridge: false });
  const [isStartingAudioServers, setIsStartingAudioServers] = useState(false);
  const [audioServerMessage, setAudioServerMessage] = useState<string | null>(null);
  const [selectedLoopCategory, setSelectedLoopCategory] = useState<RhythmCategory | 'all'>('all');
  const [loopResults, setLoopResults] = useState<Map<string, GenerateLoopResult>>(new Map());
  const [loopGeneratingIds, setLoopGeneratingIds] = useState<Set<string>>(new Set());
  const [playingLoopId, setPlayingLoopId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [localPaths, setLocalPaths] = useState<Record<string, string>>({});
  const [localAudioFiles, setLocalAudioFiles] = useState<Record<RhythmCategory, any[]>>({
    audio_electronica: [],
    audio_cuerda: [],
    audio_percusion: [],
    audio_viento: [],
  });
  const [loadingAudioFiles, setLoadingAudioFiles] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    // Cuando cambia de estilo, aplicar capas por defecto sugeridas si el usuario no ha tocado nada
    // Por simplicidad, siempre reaplicamos sugerencias al abrir/cambiar estilo.
    loadLocalPaths();
  }, [isOpen]);

  const loadLocalPaths = async () => {
    try {
      const paths = await getLocalPaths();
      setLocalPaths(paths);
      // Cargar archivos de las carpetas de ritmos
      await loadAudioFiles(paths);
    } catch (e) {
      console.error('Error cargando rutas locales:', e);
    }
  };

  const loadAudioFiles = async (paths: Record<string, string>) => {
    setLoadingAudioFiles(true);
    const categories: RhythmCategory[] = ['audio_electronica', 'audio_cuerda', 'audio_percusion', 'audio_viento'];
    const files: Record<RhythmCategory, any[]> = {
      audio_electronica: [],
      audio_cuerda: [],
      audio_percusion: [],
      audio_viento: [],
    };

    for (const cat of categories) {
      const folderPath = paths[cat];
      if (folderPath) {
        try {
          const folderFiles = await listDirectory(folderPath, 'audio');
          files[cat] = folderFiles.filter((f: any) => 
            f.name && (f.name.endsWith('.mp3') || f.name.endsWith('.wav') || f.name.endsWith('.ogg') || f.name.endsWith('.m4a'))
          ).map((f: any) => ({
            ...f,
            fullPath: `${folderPath}${folderPath.endsWith('/') || folderPath.endsWith('\\') ? '' : '/'}${f.name}`,
            category: cat,
          }));
        } catch (e) {
          console.error(`Error cargando archivos de ${cat}:`, e);
        }
      }
    }
    setLocalAudioFiles(files);
    setLoadingAudioFiles(false);
  };

  // Detener preview al cerrar o al volver a la pestaña de generar
  useEffect(() => {
    if (!isOpen || activeTab === 'generate') {
      stopPreview();
    }
  }, [isOpen, activeTab]);

  const stopPreview = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setPlayingLoopId(null);
  };

  const defaultLayers = useMemo(() => {
    const map: Record<MusicStyle, Partial<typeof layers>> = {
      ambient: { pads: true, bass: true, drums: false, melody: false },
      electronic: { pads: true, bass: true, drums: true, melody: true },
      cinematic: { pads: true, bass: true, drums: true, melody: true },
      lofi: { pads: true, bass: true, drums: true, melody: true },
      epic: { pads: true, bass: true, drums: true, melody: true },
      relax: { pads: true, bass: false, drums: false, melody: false },
      suspense: { pads: true, bass: true, drums: false, melody: true },
      happy: { pads: true, bass: true, drums: true, melody: true },
      sad: { pads: true, bass: true, drums: false, melody: true },
    };
    return map[style];
  }, [style]);

  useEffect(() => {
    setLayers((prev) => ({
      pads: defaultLayers.pads ?? prev.pads,
      bass: defaultLayers.bass ?? prev.bass,
      drums: defaultLayers.drums ?? prev.drums,
      melody: defaultLayers.melody ?? prev.melody,
    }));
  }, [defaultLayers]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setProgress(0);
    try {
      const config: MusicGeneratorConfig = {
        style,
        duration,
        bpm,
        key,
        intensity,
        layers,
        progression,
      };
      const result = await generateMusic(config, (p) => setProgress(p));
      onGenerated(result, config);
      onClose();
    } catch (e) {
      console.error('music.errGenerating', e);
      alert(t('music.errGenerateFail') + ' ' + (e instanceof Error ? e.message : t('music.unknown')));
    } finally {
      setIsGenerating(false);
      setProgress(0);
    }
  };

  const handleStartAudioServers = async () => {
    if (!isElectron()) { setAudioServerMessage('Solo disponible en la app de escritorio'); return; }
    setIsStartingAudioServers(true);
    setAudioServerMessage(null);
    try {
      setAudioServerMessage('Iniciando ComfyUI...');
      const c = await startComfyUI();
      if (!c.success) throw new Error(c.error || 'No se pudo iniciar ComfyUI');
      setAudioServerMessage('ComfyUI listo. Iniciando Flux Bridge...');
      const b = await startFluxBridge();
      if (!b.success) throw new Error(b.error || 'No se pudo iniciar Flux Bridge');
      setAudioServerStatus({ comfyui: true, bridge: true });
      setAudioServerMessage('Servidores listos. Ya puedes generar audio.');
    } catch (e: any) {
      setAudioServerMessage(e.message || 'Error iniciando servidores');
    } finally {
      setIsStartingAudioServers(false);
    }
  };

  const layerToggle = (id: keyof typeof layers) => {
    setLayers((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredLocalFiles = useMemo(() => {
    if (selectedLoopCategory === 'all') {
      const allFiles: any[] = [];
      Object.values(localAudioFiles).forEach(files => allFiles.push(...files));
      return allFiles;
    }
    return localAudioFiles[selectedLoopCategory] || [];
  }, [selectedLoopCategory, localAudioFiles]);

  const handleGenerateLoop = async (item: LoopCatalogItem) => {
    if (loopGeneratingIds.has(item.id)) return;
    setLoopGeneratingIds((prev) => new Set(prev).add(item.id));
    try {
      const result = await generateLoop(item);
      setLoopResults((prev) => {
        const next = new Map(prev);
        const old = next.get(item.id);
        if (old) revokeMusicUrl(old.url);
        next.set(item.id, result);
        return next;
      });
    } catch (e) {
      console.error('Error generando bucle:', e);
      alert('Error al generar el bucle: ' + (e instanceof Error ? e.message : t('music.unknown')));
    } finally {
      setLoopGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const togglePreview = (file: any) => {
    const fileId = file.fullPath;
    if (playingLoopId === fileId && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlayingLoopId(null);
      return;
    }
    stopPreview();
    const audioUrl = getMediaUrl(file.fullPath);
    const audio = new Audio(audioUrl);
    audio.loop = true;
    audio.volume = 0.7;
    audioRef.current = audio;
    setPlayingLoopId(fileId);
    audio.play().catch(() => setPlayingLoopId(null));
  };

  const handleAddLocalFileToTimeline = async (file: any) => {
    try {
      const audioUrl = getMediaUrl(file.fullPath);
      const response = await fetch(audioUrl);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      
      const result: GenerateLoopResult = {
        url: audioUrl,
        buffer: audioBuffer,
        blob: blob,
        duration: audioBuffer.duration,
        preset: {
          id: file.fullPath,
          category: 'drums',
          name: file.name,
          bpm: 120,
          bars: 4,
          style: 'electronic',
        },
      };
      
      const item: LoopCatalogItem = {
        id: file.fullPath,
        name: file.name,
        category: 'drums',
        description: `Archivo local de ${RHYTHM_LABELS[file.category as RhythmCategory].startsWith('music.') ? t(RHYTHM_LABELS[file.category as RhythmCategory]) : RHYTHM_LABELS[file.category as RhythmCategory]}`,
        bpm: 120,
        bars: 4,
        style: 'electronic',
      };
      
      if (onLoopSelected) {
        onLoopSelected(result, item);
        onClose();
      }
    } catch (e) {
      console.error('music.errAddLocal', e);
      alert('music.errAddTimeline');
    }
  };

  const handleDownloadLoop = (item: LoopCatalogItem) => {
    const result = loopResults.get(item.id);
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = `${item.name.replace(/\s+/g, '_').toLowerCase()}_${item.bpm}bpm.wav`;
    a.click();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={!isGenerating ? onClose : () => {}}
      title={
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-500/20 rounded-lg">
            <Sparkles className="w-5 h-5 text-green-400" />
          </div>
          <span>{t('music.generateBgMusic')}</span>
        </div>
      }
      size="xl"
      className="max-w-5xl"
      closeOnOverlayClick={!isGenerating}
      closeOnEsc={!isGenerating}
    >
      <div className="space-y-8 text-white text-base max-h-[80vh] overflow-y-auto custom-scrollbar pr-1">
        {/* Tabs */}
        <div className="flex gap-2 p-1 bg-gray-900 border border-gray-800 rounded-xl">
          <button
            onClick={() => setActiveTab('generate')}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'generate'
                ? 'bg-green-600 text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >{t('music.generateMusic')}</button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'ai'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            IA (ComfyUI)
          </button>
          <button
            onClick={() => setActiveTab('loops')}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'loops'
                ? 'bg-amber-600 text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {t('music.rhythmsBass')}
          </button>
        </div>

        {activeTab === 'generate' ? (
          <>
            {/* Estilo */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-green-400">
                <Music className="w-4 h-4" /> {t('music.styleMood')}
              </Label>
              <div className="grid grid-cols-3 gap-3">
                {(Object.keys(STYLE_LABELS) as MusicStyle[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    className={`px-4 py-3 rounded-xl text-sm font-bold border transition-all ${
                      style === s
                        ? 'bg-green-600 border-green-500 text-white shadow-lg shadow-green-900/30'
                        : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {STYLE_LABELS[s].startsWith('music.') ? t(STYLE_LABELS[s]) : STYLE_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* Duración y BPM */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <Label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-blue-400">
                  <Clock className="w-4 h-4" /> {t('music.durationLabel')} {duration}s
                </Label>
                <Slider
                  min={10}
                  max={180}
                  step={5}
                  value={[duration]}
                  onValueChange={(v) => setDuration(v[0])}
                  rangeClassName="!bg-blue-500"
                />
              </div>
              <div className="space-y-3">
                <Label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-amber-400">
                  <Activity className="w-4 h-4" /> BPM: {bpm}
                </Label>
                <Slider
                  min={50}
                  max={180}
                  step={5}
                  value={[bpm]}
                  onValueChange={(v) => setBpm(v[0])}
                  rangeClassName="!bg-amber-500"
                />
              </div>
            </div>

            {/* Tonalidad e Intensidad */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <Label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-purple-400">
                  <Piano className="w-4 h-4" /> {t('music.keyLabel')}
                </Label>
                <select
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-base text-white outline-none focus:border-purple-500"
                >
                  {KEY_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-3">
                <Label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-red-400">
                  <Zap className="w-4 h-4" /> {t('music.intensityLabel', { pct: Math.round(intensity * 100) })}
                </Label>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={[intensity]}
                  onValueChange={(v) => setIntensity(v[0])}
                  rangeClassName="!bg-red-500"
                />
              </div>
            </div>

            {/* Progresión */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-cyan-400">
                <Layers className="w-4 h-4" />{t('music.harmonicProgression')}</Label>
              <div className="flex gap-2">
                {(['simple', 'moderate', 'complex'] as ProgressionComplexity[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setProgression(p)}
                    className={`flex-1 px-4 py-3 rounded-xl text-sm font-bold border transition-all capitalize ${
                      progression === p
                        ? 'bg-cyan-600 border-cyan-500 text-white shadow-lg shadow-cyan-900/30'
                        : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {p === 'simple' ? t('music.simple') : p === 'moderate' ? t('music.moderate') : t('music.complex')}
                  </button>
                ))}
              </div>
            </div>

            {/* Capas */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                <Layers className="w-4 h-4" /> {t('music.instrumentLayers')}
              </Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { id: 'pads', label: 'music.pads' },
                  { id: 'bass', label: 'music.bass' },
                  { id: 'drums', label: 'music.drums' },
                  { id: 'melody', label: 'music.melody' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => layerToggle(item.id as keyof typeof layers)}
                    className={`px-4 py-3 rounded-xl text-sm font-bold border transition-all ${
                      layers[item.id as keyof typeof layers]
                        ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-900/30'
                        : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {item.label.startsWith('music.') ? t(item.label) : item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Progreso */}
            {isGenerating && (
              <div className="space-y-2 p-4 bg-gray-900/50 border border-gray-800 rounded-2xl">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-300">
                  <Loader2 className="w-5 h-5 animate-spin text-green-400" />
                  Generando pieza musical…
                </div>
                <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 transition-all duration-300"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500">Esto puede tardar unos segundos.</p>
              </div>
            )}
          </>
        ) : activeTab === 'ai' ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-purple-400">
                <Sparkles className="w-4 h-4" /> {t('music.aiGenerateLabel')}
              </Label>
              <p className="text-sm text-gray-400">
                Usa ComfyUI con <span className="text-purple-300">stable-audio-open-1.0.safetensors</span>{t('music.aiGenerateDesc')}</p>
            </div>

            {/* Servidores */}
            <div className="flex items-center gap-2 bg-gray-950/50 p-2 rounded-lg border border-gray-700/50">
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${audioServerStatus.comfyui ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'}`} />
                <span className="text-[9px] text-gray-400">ComfyUI</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${audioServerStatus.bridge ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-red-400'}`} />
                <span className="text-[9px] text-gray-400">Bridge</span>
              </div>
              <button
                onClick={handleStartAudioServers}
                disabled={isStartingAudioServers || (audioServerStatus.comfyui && audioServerStatus.bridge)}
                className="ml-auto text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-emerald-500/30"
              >
                {isStartingAudioServers ? 'Iniciando...' : audioServerStatus.comfyui && audioServerStatus.bridge ? 'Listos' : 'Iniciar Servidores'}
              </button>
            </div>
            {audioServerMessage && (
              <p className={`text-[9px] uppercase tracking-wider ${audioServerMessage.includes('listos') || audioServerMessage.includes('listo') ? 'text-green-400' : audioServerMessage.includes('Error') ? 'text-red-400' : 'text-emerald-300'}`}>
                {audioServerMessage}
              </p>
            )}

            <div className="space-y-3">
              <Label className="text-gray-300 text-sm">Prompt</Label>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder={t('music.aiPromptPlaceholder')}
                className="w-full h-28 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-purple-500 resize-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <Label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-blue-400">
                  <Clock className="w-4 h-4" /> {t('music.durationLabel')} {aiDuration}s
                </Label>
                <Slider
                  min={10}
                  max={180}
                  step={5}
                  value={[aiDuration]}
                  onValueChange={(v) => setAiDuration(v[0])}
                  rangeClassName="!bg-blue-500"
                />
              </div>
              <div className="space-y-3">
                <Label className="text-gray-300 text-sm">{t('music.fileNameOptional')}</Label>
                <input
                  type="text"
                  value={aiFileName}
                  onChange={(e) => setAiFileName(e.target.value)}
                  placeholder="mi_pista_ia"
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-purple-500"
                />
              </div>
            </div>

            {isGenerating && (
              <div className="space-y-2 p-4 bg-gray-900/50 border border-gray-800 rounded-2xl">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-300">
                  <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                  Generando audio con ComfyUI…
                </div>
                <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 transition-all duration-300"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500">{t('music.comfyHint')}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-amber-400">
                <Drum className="w-4 h-4" /> {t('music.loopShowcase')}
              </Label>
              <p className="text-sm text-gray-400">
                {t('music.localGenDesc')}
              </p>
            </div>

            {/* Filtro de categoría */}
            <div className="flex flex-wrap gap-2">
              {(['all', 'audio_electronica', 'audio_cuerda', 'audio_percusion', 'audio_viento'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedLoopCategory(cat)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold border transition-all ${
                    selectedLoopCategory === cat
                      ? 'bg-amber-600 border-amber-500 text-white shadow-lg shadow-amber-900/30'
                      : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  {cat === 'all' ? (
                    <>{t('music.all')}</>
                  ) : (
                    <>
                      {RHYTHM_ICONS[cat]}
                      {RHYTHM_LABELS[cat].startsWith('music.') ? t(RHYTHM_LABELS[cat]) : RHYTHM_LABELS[cat]}
                    </>
                  )}
                </button>
              ))}
            </div>

            {/* Grid de archivos locales */}
            {loadingAudioFiles ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
                <span className="ml-3 text-gray-400">Cargando archivos...</span>
              </div>
            ) : filteredLocalFiles.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Music className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>{t('music.noAudioInCategory')}</p>
                <p className="text-sm mt-1">{t('music.configFoldersHint')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredLocalFiles.map((file) => {
                  const isPlaying = playingLoopId === file.fullPath;
                  return (
                    <div
                      key={file.fullPath}
                      className="p-4 bg-gray-900 border border-gray-800 rounded-2xl flex flex-col gap-3 hover:border-gray-700 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="p-2.5 bg-gray-800 rounded-xl text-amber-400">
                          {RHYTHM_ICONS[file.category as RhythmCategory]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-white text-base truncate">{file.name}</h4>
                          <p className="text-sm text-gray-400 leading-snug">
                            {RHYTHM_LABELS[file.category as RhythmCategory].startsWith('music.') ? t(RHYTHM_LABELS[file.category as RhythmCategory]) : RHYTHM_LABELS[file.category as RhythmCategory]}
                          </p>
                          <p className="text-xs font-mono text-gray-500 mt-1">
                            {file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : ''}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={() => togglePreview(file)}
                          className={`text-sm font-bold px-4 py-2 ${
                            isPlaying
                              ? 'bg-red-600 hover:bg-red-700'
                              : 'bg-blue-600 hover:bg-blue-700'
                          } text-white`}
                        >
                          {isPlaying ? (
                            <><Square className="w-4 h-4 mr-2" /> Detener</>
                          ) : (
                            <><Play className="w-4 h-4 mr-2" /> Escuchar</>
                          )}
                        </Button>
                        {keyboardMode ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              onFileSelectedForKeyboard?.(file);
                              onClose();
                            }}
                            className="bg-green-600 hover:bg-green-700 text-white text-sm font-bold px-4 py-2"
                          >
                            <Plus className="w-4 h-4 mr-2" />{t('music.add')}</Button>
                        ) : onLoopSelected && (
                          <Button
                            size="sm"
                            onClick={() => handleAddLocalFileToTimeline(file)}
                            className="bg-green-600 hover:bg-green-700 text-white text-sm font-bold px-4 py-2"
                          >
                            <Plus className="w-4 h-4 mr-2" />{t('music.add')}</Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Acciones */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-800">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isGenerating}
            className="text-base text-gray-400 hover:text-white px-5 py-3"
          >
            {activeTab === 'loops' ? t('music.close') : t('music.cancel')}
          </Button>
          {activeTab === 'generate' && (
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || Object.values(layers).every((v) => !v)}
              className="bg-green-600 hover:bg-green-700 text-white text-base font-bold px-8 py-3"
            >
              {isGenerating ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Generando…</>
              ) : (
                <><Sparkles className="w-5 h-5 mr-2" />{t('music.generateMusic')}</>
              )}
            </Button>
          )}
          {activeTab === 'ai' && (
            <Button
              onClick={async () => {
                if (!aiPrompt.trim()) { alert('Escribe un prompt para generar audio'); return; }
                setIsGenerating(true);
                setProgress(0);
                try {
                  const payload: any = { prompt: aiPrompt, duration: aiDuration };
                  if (aiSeed !== null) payload.seed = aiSeed;
                  if (aiFileName.trim()) payload.fileName = aiFileName.trim();

                  const createRes = await fetch('/api/audio-generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                  });
                  const createData = await createRes.json();
                  if (!createRes.ok || !createData?.prompt_id) throw new Error(createData?.error || 'Error creando prompt');

                  const promptId = createData.prompt_id as string;
                  setProgress(0.1);

                   for (let i = 0; i < 300; i++) {
                     await new Promise(r => setTimeout(r, 2000));
                     const statusRes = await fetch(`/api/audio-generate?prompt_id=${encodeURIComponent(promptId)}`);
                     if (!statusRes.ok) {
                       console.error('Status request failed:', statusRes.status, statusRes.statusText);
                       continue;
                     }
                     const statusData = await statusRes.json();
                     console.log('Polling status:', statusData.status, statusData.progress, statusData.error);
                     if (statusData.status === 'success') {
                       try {
                         const dataUrl = statusData.url as string;
                         const blob = await (await fetch(dataUrl)).blob();
                         const arrayBuffer = await blob.arrayBuffer();
                         const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                         const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
                         const url = URL.createObjectURL(blob);
                         const fileName = statusData.fileName || `comfyui_audio_${Date.now()}.mp3`;

                         onGenerated(
                           { buffer: audioBuffer, blob, url, duration: aiDuration },
                           {
                             style: 'ambient',
                             duration: aiDuration,
                             bpm: 120,
                             key: 'C',
                             intensity: 0.5,
                             layers: { pads: true, bass: true, drums: false, melody: false },
                             progression: 'moderate',
                           }
                         );
                         alert('music.audioAddedOk');
                       } catch (decodeError) {
                         console.error('Error decodificando audio:', decodeError);
                         alert('music.audioDecodeFail');
                       }
                       onClose();
                       break;
                     }
                     if (statusData.status === 'error') {
                       const errorMsg = statusData.error || 'Error generando audio en ComfyUI.';
                       alert('❌ Error: ' + errorMsg + (statusData.details ? '\nDetalles: ' + statusData.details : ''));
                       setIsGenerating(false);
                       setProgress(0);
                       return;
                     }
                     setProgress(Math.max(0.1, Math.min(0.95, (i / 300) * 0.95)));
                   }
                   if (isGenerating) {
                     alert('music.genSlowHint');
                   }
                 } catch (e) {
                   console.error('Error generando audio con ComfyUI:', e);
                   alert('Error al generar el audio: ' + (e instanceof Error ? e.message : t('music.unknown')));
                 } finally {
                   setIsGenerating(false);
                   setProgress(0);
                 }
               }}
              disabled={isGenerating || !aiPrompt.trim()}
              className="bg-purple-600 hover:bg-purple-700 text-white text-base font-bold px-8 py-3"
            >
              {isGenerating ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Generando…</>
              ) : (
                <><Sparkles className="w-5 h-5 mr-2" /> {t('music.generateWithAI')}</>
              )}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
