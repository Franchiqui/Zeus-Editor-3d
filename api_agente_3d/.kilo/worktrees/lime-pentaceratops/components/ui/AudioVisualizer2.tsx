'use client';

import { useEffect, useRef, useState } from 'react';
import { Music, Play, Pause, SkipBack, SkipForward, Circle, Square as SquareIcon, Download, Loader2 } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { useI18n } from '@/lib/i18n';

interface AudioVisualizerProps {
  audioContext?: AudioContext;
  audioSource?: AudioNode;
  isPlaying?: boolean;
  deckAActive?: boolean;
  deckBActive?: boolean;
  masterVolume?: number;
  trackTitle?: string;
  trackArtist?: string;
  trackBpm?: number;
  trackKey?: string;
  currentTime?: number;
  duration?: number;
  waveform?: number[];
  color?: string;
  height?: number;
  showInfo?: boolean;
  showWaveform?: boolean;
  showFrequency?: boolean;
  showSpectrum?: boolean;
  isBypassed?: boolean;
  /** Mostrar audio en vivo (teclado, mic) aunque no haya reproducción de pista */
  showLiveInput?: boolean;
  minimal?: boolean;
  defaultType?: 'bars' | 'wave' | 'circle' | 'particles';
  /** Controles de transporte a la derecha del nombre: play/pause, anterior/siguiente, posición/duración */
  onPlayPause?: (playing: boolean) => void;
  onPrevTrack?: () => void;
  onNextTrack?: () => void;
  showTransport?: boolean;
  /** Callback cuando finaliza una grabación */
  onRecordingComplete?: (blob: Blob) => void;
}

export default function AudioVisualizer({
  audioContext,
  audioSource,
  isPlaying = false,
  deckAActive = false,
  deckBActive = false,
  masterVolume = 1,
  trackTitle = 'No Track Loaded',
  trackArtist = '',
  trackBpm = 0,
  trackKey = '',
  currentTime = 0,
  duration = 0,
  waveform = [],
  color = 'linear-gradient(90deg, #22c55e, #eab308)',
  height = 200,
  showInfo = true,
  showWaveform = true,
  showFrequency = true,
  showSpectrum = true,
  isBypassed = false,
  showLiveInput = false,
  minimal = false,
  defaultType = 'bars',
  onPlayPause,
  onPrevTrack,
  onNextTrack,
  showTransport = false,
  onRecordingComplete,
}: AudioVisualizerProps) {
  const { t } = useI18n();
  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  const resolvedContext = audioContext || (audioSource ? (audioSource.context as AudioContext) : undefined);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const [visualizerType, setVisualizerType] = useState<'bars' | 'wave' | 'circle' | 'particles'>(defaultType);
  const [intensity, setIntensity] = useState(0.7);
  const [smoothing, setSmoothing] = useState(0.8);

  // Estados para grabación
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const startRecording = () => {
    if (!resolvedContext || !audioSource) {
      console.warn("Cannot start recording: No audio context or source");
      return;
    }
    
    try {
      if (!recordingDestRef.current) {
        recordingDestRef.current = resolvedContext.createMediaStreamDestination();
      }
      
      audioSource.connect(recordingDestRef.current);
      
      const stream = recordingDestRef.current.stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/wav' });
        onRecordingComplete?.(blob);
        if (recordingDestRef.current && audioSource) {
          try { audioSource.disconnect(recordingDestRef.current); } catch(e) {}
        }
      };
      
      recorder.start();
      setIsRecording(true);

      // Iniciar línea de tiempo si está pausada
      if (!isPlaying && onPlayPause) {
        onPlayPause(true);
      }
    } catch (err) {
      console.error("Error starting MediaRecorder:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      // Pausar línea de tiempo al terminar de grabar
      if (isPlaying && onPlayPause) {
        onPlayPause(false);
      }
    }
  };

  // Sync visualizerType if defaultType changes
  useEffect(() => {
    setVisualizerType(defaultType);
  }, [defaultType]);

  // Ensure audio context is running when playback is requested
  useEffect(() => {
    const resumeContext = async () => {
      if (resolvedContext && resolvedContext.state === 'suspended' && isPlaying) {
        try {
          await resolvedContext.resume();
        } catch (err) {
          console.error('Failed to resume AudioContext', err);
        }
      }
    };
    resumeContext();
  }, [resolvedContext, isPlaying]);

  useEffect(() => {
    if (!resolvedContext || !audioSource || isBypassed) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const analyser = resolvedContext.createAnalyser();
    analyser.fftSize = 1024; // Precision vs Performance
    analyser.smoothingTimeConstant = smoothing;
    analyserRef.current = analyser;

    // Connect source to analyser
    audioSource.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    dataArrayRef.current = dataArray;

    const renderFrame = () => {
      if (!canvasRef.current || !analyserRef.current) return;
      
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      analyserRef.current.getByteFrequencyData(dataArray);

      // Animation logic
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      switch (visualizerType) {
        case 'bars':
          drawBars(ctx, dataArray, canvas.width, canvas.height, intensity);
          break;
        case 'wave':
          drawWave(ctx, dataArray, canvas.width, canvas.height, intensity);
          break;
        case 'circle':
          drawCircle(ctx, dataArray, canvas.width, canvas.height, intensity);
          break;
        case 'particles':
          drawParticles(ctx, dataArray, canvas.width, canvas.height, intensity);
          break;
      }

      animationRef.current = requestAnimationFrame(renderFrame);
    };

    renderFrame();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      try {
        audioSource.disconnect(analyser);
      } catch (e) {}
    };
  }, [resolvedContext, audioSource, visualizerType, intensity, smoothing, color, isBypassed]);

  // Visualizer Drawing Functions
  const drawBars = (ctx: CanvasRenderingContext2D, dataArray: Uint8Array, width: number, height: number, intensity: number) => {
    const barWidth = (width / dataArray.length) * 2.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
      barHeight = (dataArray[i] / 255) * height * intensity;

      const grad = ctx.createLinearGradient(0, height, 0, height - barHeight);
      if (color.includes('gradient')) {
        grad.addColorStop(0, '#22c55e');
        grad.addColorStop(0.5, '#eab308');
        grad.addColorStop(1, '#ef4444');
      } else {
        grad.addColorStop(0, color);
        grad.addColorStop(1, color);
      }

      ctx.fillStyle = grad;
      ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);

      x += barWidth;
    }
  };

  const drawWave = (ctx: CanvasRenderingContext2D, dataArray: Uint8Array, width: number, height: number, intensity: number) => {
    ctx.lineWidth = 3;
    ctx.strokeStyle = color.includes('gradient') ? '#22c55e' : color;
    ctx.beginPath();

    const sliceWidth = width / dataArray.length;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
      const v = (dataArray[i] / 128.0) * intensity;
      const y = (v * height) / 2;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);

      x += sliceWidth;
    }

    ctx.lineTo(width, height / 2);
    ctx.stroke();
  };

  const drawCircle = (ctx: CanvasRenderingContext2D, dataArray: Uint8Array, width: number, height: number, intensity: number) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = (Math.min(width, height) / 4) * intensity;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    
    const avg = Array.from(dataArray).reduce((a, b) => a + b, 0) / dataArray.length;
    const pulseRadius = radius + (avg / 255) * 50;

    const gradient = ctx.createRadialGradient(centerX, centerY, radius, centerX, centerY, radius * 2);
    gradient.addColorStop(0, 'rgba(34, 197, 94, 0.8)');
    gradient.addColorStop(1, 'rgba(234, 179, 8, 0.4)');

    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = '#22c55e';
    ctx.stroke();
  };

  const drawParticles = (
    ctx: CanvasRenderingContext2D,
    dataArray: Uint8Array,
    width: number,
    height: number,
    intensity: number
  ) => {
    const particleCount = 100;
    const step = Math.floor(dataArray.length / particleCount);
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, 0, width, height);

    let primaryColor = color;
    if (color.includes('gradient')) {
      const hexMatch = color.match(/#[a-fA-F0-9]{6}/);
      primaryColor = hexMatch ? hexMatch[0] : '#10b981';
    }

    for (let i = 0; i < particleCount; i++) {
      const dataIndex = i * step;
      const dataValue = dataArray[dataIndex] / 255;
      
      const x = (i / particleCount) * width;
      const targetY = height - (dataValue * height * intensity);
      const size = 1 + dataValue * 4;

      const glow = ctx.createRadialGradient(x, targetY, 0, x, targetY, size * 4);
      if (color.includes('gradient')) {
        glow.addColorStop(0, primaryColor.replace(')', ', 0.8)'));
        glow.addColorStop(1, 'transparent');
      } else {
        glow.addColorStop(0, `${color}${Math.floor(dataValue * 255).toString(16).padStart(2, '0')}`);
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      }

      ctx.beginPath();
      ctx.fillStyle = glow;
      ctx.arc(x, targetY, size * 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = primaryColor;
      ctx.arc(x, targetY, size, 0, Math.PI * 2);
      ctx.fill();

      if (i > 0) {
        const prevX = ((i - 1) / particleCount) * width;
        const prevDataValue = dataArray[(i - 1) * step] / 255;
        const prevY = height - (prevDataValue * height * intensity);
        
        ctx.beginPath();
        ctx.strokeStyle = color.includes('gradient') ? primaryColor : color;
        ctx.globalAlpha = 0.2 * dataValue;
        ctx.lineWidth = 1;
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, targetY);
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

      if (dataValue > 0.5) {
        ctx.beginPath();
        const beamGradient = ctx.createLinearGradient(x, targetY, x, height);
        beamGradient.addColorStop(0, color.includes('gradient') ? primaryColor : color);
        beamGradient.addColorStop(1, 'transparent');
        ctx.strokeStyle = beamGradient;
        ctx.globalAlpha = dataValue * 0.3;
        ctx.lineWidth = size / 2;
        ctx.moveTo(x, targetY);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }
    }
  };

  const calculateAverageFrequency = (data: Uint8Array) => {
    if (!data.length) return 0;
    const sum = data.reduce((a, b) => a + b, 0);
    return sum / data.length;
  };

  const audioData = dataArrayRef.current ? {
    frequencyData: dataArrayRef.current,
    waveform: waveform.length > 0 ? waveform : undefined
  } : null;

  return (
    <div className={`flex flex-col bg-gray-950/40 backdrop-blur-md rounded-3xl border border-white/5 overflow-hidden shadow-2xl transition-all duration-700 ${isBypassed ? 'grayscale opacity-60' : 'opacity-100'}`}>
      
    {/* Header with controls and track info */}
    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center p-4 border-b border-gray-800/50 gap-6 bg-gray-900/20">
      {/* Left: Component Title */}
      <div className="shrink-0">
        <h3 className="text-lg font-black text-white uppercase tracking-tighter italic">Audio Visualizer</h3>
        <p className="text-[10px] text-green-500 font-bold uppercase tracking-widest leading-none">Studio Precision</p>
      </div>

      {/* Center: Track Info + Transport */}
      <div className="flex-1 flex justify-center items-center overflow-hidden w-full gap-6 min-w-0">
        <div className="flex items-center gap-4 max-w-md xl:max-w-xl w-full bg-black/40 px-6 py-2 rounded-2xl border border-gray-800 shadow-inner min-w-0 shrink-0">
          <div className={`p-1.5 rounded-full shrink-0 ${isPlaying ? 'bg-green-500/20 text-green-400 animate-pulse' : 'bg-gray-800 text-gray-500'}`}>
            <Music className="w-4 h-4" />
          </div>
          <div className="flex flex-col overflow-hidden min-w-0 flex-1">
            <div className="relative h-7 overflow-hidden flex items-center">
              <div 
                className={`whitespace-nowrap text-xl font-black tracking-tighter ${isPlaying ? 'animate-marquee' : ''}`}
                style={{ 
                  color: isBypassed ? '#4b5563' : '#10b981',
                  textShadow: isBypassed ? 'none' : '0 0 15px rgba(16,185,129,0.4)'
                }}
              >
                {trackTitle || 'No Track Loaded'}
                {isPlaying && <span className="mx-12">{trackTitle || 'No Track Loaded'}</span>}
              </div>
            </div>
          </div>
        </div>

        {showTransport && (onPlayPause || onPrevTrack || onNextTrack) && (
          <div className="flex items-center gap-6 shrink-0">
            <div className="flex items-center gap-2">
              {onPrevTrack && (
                <button type="button" onClick={onPrevTrack} className="h-9 w-9 rounded-full flex items-center justify-center text-amber-400 hover:bg-amber-500/20 transition-colors" title="{t('app.prevSong')}">
                  <SkipBack className="w-4 h-4 fill-current" />
                </button>
              )}
              {onPlayPause && (
                <button type="button" onClick={() => onPlayPause(!isPlaying)} disabled={isBypassed} className={`h-10 w-10 rounded-full flex items-center justify-center border border-white/10 transition-all ${isBypassed ? 'bg-gray-800 text-gray-600' : isPlaying ? 'bg-red-500/20 text-red-500 border-red-500/30' : 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30'}`} title={isPlaying ? 'Pausar' : 'Reproducir'}>
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
                </button>
              )}
              {onNextTrack && (
                <button type="button" onClick={onNextTrack} className="h-9 w-9 rounded-full flex items-center justify-center text-amber-400 hover:bg-amber-500/20 transition-colors" title="{t('app.nextSong')}">
                  <SkipForward className="w-4 h-4 fill-current" />
                </button>
              )}
            </div>

            {/* Botón REC - Grande y profesional */}
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`flex items-center gap-2.5 px-5 py-2.5 rounded-2xl border-2 transition-all shadow-xl ${
                isRecording 
                  ? 'bg-red-600/30 text-red-500 border-red-500 animate-pulse shadow-red-900/20 scale-105' 
                  : 'bg-gray-900/80 text-gray-400 border-gray-700 hover:text-red-500 hover:border-red-500/50 hover:bg-gray-800'
              }`}
              title={isRecording ? "{t('app.stopRecording')}" : "Grabar audio de salida"}
            >
              {isRecording ? <SquareIcon className="w-4 h-4 fill-current" /> : <Circle className="w-4 h-4 fill-current text-red-600 shadow-[0_0_8px_rgba(220,38,38,0.6)]" />}
              <span className="font-black uppercase tracking-widest text-[11px]">{isRecording ? 'STOP' : 'REC'}</span>
            </button>

            <div className="flex flex-col ml-1 relative">
              <div className="flex items-center gap-3">
                <span className={`text-[10px] uppercase font-black tracking-[0.2em] ${isBypassed ? 'text-gray-600' : 'text-yellow-400'}`}>{t('app.positionDuration')}</span>
              </div>
              <div className={`text-lg font-mono font-black leading-none ${isBypassed ? 'text-gray-600' : 'text-white'}`}>
                {formatTime(currentTime)} <span className="text-base font-bold text-gray-500">/ {formatTime(duration)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right: Type Selection */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 bg-black/40 p-1 rounded-xl border border-gray-800">
          {(['bars', 'wave', 'circle', 'particles'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setVisualizerType(type)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${visualizerType === type ? 'bg-green-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>
    </div>

      {/* Canvas container - Restaurado fondo original */}
      <div className="relative p-6 bg-gray-950">
        <canvas
          ref={canvasRef}
          width={1920}
          height={height}
          style={{ height: `${height}px` }}
          className="w-full rounded-2xl bg-black/60 shadow-[inset_0_0_40px_rgba(0,0,0,0.8)]"
        />

        {/* Overlay info - Pilotos inferiores */}
        <div className="absolute bottom-10 left-10 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full transition-all duration-500 ${isBypassed ? 'bg-gray-600' : 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]'}`}></div>
            <span className="text-xs font-black uppercase tracking-widest text-gray-400">
              {audioData ? `${audioData.frequencyData.length} BINS` : 'OFFLINE'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full transition-all duration-500 ${isBypassed ? 'bg-red-900' : (deckAActive ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-600 shadow-[0_0_4px_rgba(220,38,38,0.4)]')}`}
            ></div>
            <span className="text-xs font-black uppercase tracking-widest text-gray-400">{t('audioEditor.midiKeyboard').toUpperCase()} {deckAActive ? t('audioEditor.active').toUpperCase() : t('audioEditor.inactive').toUpperCase()}</span>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full transition-all duration-500 ${isBypassed ? 'bg-red-900' : (deckBActive ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-600 shadow-[0_0_4px_rgba(220,38,38,0.4)]')}`}
            ></div>
            <span className="text-xs font-black uppercase tracking-widest text-gray-400">PISTAS {deckBActive ? 'ACTIVO' : 'INACTIVO'}</span>
          </div>

          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full transition-all duration-500 ${isBypassed ? 'bg-gray-600' : 'bg-yellow-400 shadow-[0_0_8px_rgba(234,179,8,0.5)]'}`}></div>
            <span className="text-xs font-black uppercase tracking-widest text-gray-400">MASTER {Math.round(masterVolume * 100)}%</span>
          </div>
        </div>
      </div>

      {/* Frequency spectrum info - Restaurado con las líneas de animación */}
      {showInfo && audioData && (
        <div className={`px-8 pb-8 pt-2 bg-gray-950 transition-all duration-500 ${isBypassed ? 'opacity-40 grayscale' : 'opacity-100'}`}>
          <div className="flex items-end gap-1 h-12 mb-6">
            {/* Animación de líneas inferior */}
            {Array.from(audioData.frequencyData.slice(0, 60)).map((val, i) => (
              <div 
                key={i} 
                className="flex-1 bg-gradient-to-t from-green-500 via-emerald-500 to-transparent rounded-t-sm opacity-40"
                style={{ height: `${(val / 255) * 100}%`, transition: 'height 0.1s ease-out' }}
              />
            ))}
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
            <div className="space-y-3">
              <div className="flex flex-col">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Peak Frequency</p>
                <p className="text-2xl font-mono font-black tracking-tighter text-emerald-400">
                  {calculateAverageFrequency(audioData.frequencyData).toFixed(1)} <span className="text-xs opacity-50">Hz</span>
                </p>
              </div>
              <div className="h-1.5 w-full bg-gray-900 rounded-full overflow-hidden border border-white/5">
                <div 
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-300" 
                  style={{ width: `${Math.min(100, (calculateAverageFrequency(audioData.frequencyData) / 128) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}