'use client';

import { useEffect, useRef, useState } from 'react';
import { Music, Play, Pause, SkipBack, SkipForward, Circle, Square as SquareIcon } from 'lucide-react';
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
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * 30);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };
  const resolvedContext = audioContext || (audioSource ? (audioSource.context as AudioContext) : undefined);
  const canvasRef = useRef < HTMLCanvasElement > (null);
  const animationRef = useRef < number | null > (null);
  const analyserRef = useRef < AnalyserNode | null > (null);
  const dataArrayRef = useRef < Uint8Array < ArrayBuffer > | null > (null);
  const [visualizerType, setVisualizerType] = useState < 'bars' | 'wave' | 'circle' | 'particles' > (defaultType);
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

  // Initialize audio analyzer
  useEffect(() => {
    if (!resolvedContext || !audioSource || !canvasRef.current) return;

    const analyser = resolvedContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = smoothing;
    audioSource.connect(analyser);

    analyserRef.current = analyser;
    const bufferLength = analyser.frequencyBinCount;
    // Use an ArrayBuffer-backed typed array to satisfy getByteFrequencyData signature
    dataArrayRef.current = new Uint8Array(new ArrayBuffer(bufferLength)) as Uint8Array<ArrayBuffer>;

    return () => {
      if (analyserRef.current) {
        analyserRef.current.disconnect();
      }
    };
  }, [resolvedContext, audioSource, smoothing]);

  // Draw visualizer
  useEffect(() => {
    if (!canvasRef.current || !analyserRef.current || !dataArrayRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;
    const width = canvas.width;
    const height = canvas.height;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      if (visualizerType !== 'particles') {
        ctx.clearRect(0, 0, width, height);
      }

      if (!minimal) {
        // Draw background gradient
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, 'rgba(17, 24, 39, 0.8)');
        gradient.addColorStop(1, 'rgba(17, 24, 39, 0.4)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // Draw grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;

        // Vertical lines
        for (let i = 0; i < width; i += 50) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, height);
          ctx.stroke();
        }

        // Horizontal lines
        for (let i = 0; i < height; i += 50) {
          ctx.beginPath();
          ctx.moveTo(0, i);
          ctx.lineTo(width, i);
          ctx.stroke();
        }
      }

      // Draw visualizer based on type
      switch (visualizerType) {
        case 'bars':
          drawBars(ctx, dataArray, width, height, intensity);
          break;
        case 'wave':
          drawWave(ctx, dataArray, width, height, intensity);
          break;
        case 'circle':
          drawCircle(ctx, dataArray, width, height, intensity);
          break;
        case 'particles':
          drawParticles(ctx, dataArray, width, height, intensity);
          break;
      }

      if (!minimal) {
        // Draw progress bar if duration is available
        if (duration > 0) {
          const progress = currentTime / duration;
          ctx.fillStyle = 'rgba(34, 197, 94, 0.5)';
          ctx.fillRect(0, height - 4, width * progress, 4);

          // Draw current time indicator
          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.arc(width * progress, height - 2, 6, 0, Math.PI * 2);
          ctx.fill();
        }

        // Draw waveform if available
        if (showWaveform && waveform.length > 0) {
          drawWaveform(ctx, waveform, width, height);
        }
      }
    };

    const shouldAnimate = isPlaying || (showLiveInput && !isBypassed);
    if (shouldAnimate) {
      draw();
    } else {
      // Draw static visualization when paused
      ctx.clearRect(0, 0, width, height);

      // Draw idle state
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, 'rgba(17, 24, 39, 0.8)');
      gradient.addColorStop(1, 'rgba(17, 24, 39, 0.4)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Draw idle message
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('▶ PLAY TRACK TO ACTIVATE VISUALIZER', width / 2, height / 2);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, showLiveInput, isBypassed, visualizerType, intensity, currentTime, duration, waveform, showWaveform, smoothing, color]);

  // Drawing functions
  const drawBars = (
    ctx: CanvasRenderingContext2D,
    dataArray: Uint8Array,
    width: number,
    height: number,
    intensity: number
  ) => {
    const barWidth = (width / dataArray.length) * 2.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
      barHeight = (dataArray[i] / 255) * height * intensity;

      const gradient = ctx.createLinearGradient(x, height - barHeight, x, height);
      gradient.addColorStop(0, '#22c55e');
      gradient.addColorStop(0.5, '#eab308');
      gradient.addColorStop(1, '#84cc16');

      ctx.fillStyle = gradient;
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);

      x += barWidth + 1;
    }
  };

  const calculateAverageFrequency = (data: Uint8Array | Uint8Array<ArrayBuffer>) => {
    if (!data.length) return 0;
    const total = data.reduce((sum, value) => sum + value, 0);
    return total / data.length;
  };

  const findPeakFrequency = (data: Uint8Array | Uint8Array<ArrayBuffer>) => {
    if (!data.length) return 0;
    return data.reduce((max, value) => Math.max(max, value), 0);
  };

  const calculateRMS = (data: Uint8Array | Uint8Array<ArrayBuffer>) => {
    if (!data.length) return 0;
    const squaredSum = data.reduce((sum, value) => sum + value * value, 0);
    return Math.sqrt(squaredSum / data.length) / 255;
  };

  const drawWave = (
    ctx: CanvasRenderingContext2D,
    dataArray: Uint8Array,
    width: number,
    height: number,
    intensity: number
  ) => {
    ctx.beginPath();
    ctx.lineWidth = 2;

    const sliceWidth = width / dataArray.length;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
      const v = dataArray[i] / 255;
      const y = (v * height * intensity) / 2 + height / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#22c55e');
    gradient.addColorStop(0.5, '#eab308');
    gradient.addColorStop(1, '#84cc16');

    ctx.strokeStyle = gradient;
    ctx.stroke();
  };

  const drawCircle = (
    ctx: CanvasRenderingContext2D,
    dataArray: Uint8Array,
    width: number,
    height: number,
    intensity: number
  ) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.3;

    ctx.beginPath();
    ctx.lineWidth = 2;

    for (let i = 0; i < dataArray.length; i++) {
      const angle = (i * Math.PI * 2) / dataArray.length;
      const dataValue = dataArray[i] / 255;
      const pointRadius = radius + dataValue * radius * intensity;

      const x = centerX + Math.cos(angle) * pointRadius;
      const y = centerY + Math.sin(angle) * pointRadius;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.closePath();

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
    
    // Clear with semi-transparent black for trail effect
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, 0, width, height);

    // Resolve color
    let primaryColor = color;
    if (color.includes('gradient')) {
      // Extract first hex from gradient or use emerald as fallback
      const hexMatch = color.match(/#[a-fA-F0-9]{6}/);
      primaryColor = hexMatch ? hexMatch[0] : '#10b981';
    }

    for (let i = 0; i < particleCount; i++) {
      const dataIndex = i * step;
      const dataValue = dataArray[dataIndex] / 255;
      
      const x = (i / particleCount) * width;
      const targetY = height - (dataValue * height * intensity);
      const size = 1 + dataValue * 4;

      // Glow effect
      const glow = ctx.createRadialGradient(x, targetY, 0, x, targetY, size * 4);
      if (color.includes('gradient')) {
        // Multi-color glow for gradients
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

      // Core particle
      ctx.beginPath();
      ctx.fillStyle = primaryColor;
      ctx.arc(x, targetY, size, 0, Math.PI * 2);
      ctx.fill();

      // Connecting lines
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

      // Vertical "energy" beams
      if (dataValue > 0.5) {
        ctx.beginPath();
        const beamGradient = ctx.createLinearGradient(x, targetY, x, height);
        if (color.includes('gradient')) {
           beamGradient.addColorStop(0, primaryColor);
        } else {
           beamGradient.addColorStop(0, color);
        }
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

  const drawWaveform = (
    ctx: CanvasRenderingContext2D,
    waveform: number[],
    width: number,
    height: number
  ) => {
    if (waveform.length === 0) return;

    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';

    const sliceWidth = width / waveform.length;
    let x = 0;

    for (let i = 0; i < waveform.length; i++) {
      const v = waveform[i];
      const y = (1 - v) * height;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.stroke();
  };

  const audioData = dataArrayRef.current
    ? { frequencyData: dataArrayRef.current, waveform }
    : null;

  if (minimal) {
    return (
      <div className="w-full h-full relative overflow-hidden bg-transparent">
        <canvas
          ref={canvasRef}
          width={1920}
          height={height}
          style={{ height: '100%', width: '100%' }}
          className="w-full h-full"
        />
      </div>
    );
  }
return (
  <div className="w-full bg-gray-900/50 backdrop-blur-sm rounded-xl border border-gray-700 overflow-hidden">
    {/* Header with controls and track info */}
    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center p-4 border-b border-gray-700 gap-6">
      {/* Left: Component Title */}
      <div className="shrink-0">
        <h3 className="text-lg font-black text-white uppercase tracking-tighter italic">Audio Visualizer</h3>
        <p className="text-[10px] text-yellow-500 font-bold uppercase tracking-widest leading-none">Studio Precision</p>
      </div>

      {/* Center: Track Info + Transport */}
      <div className="flex-1 flex justify-center items-center overflow-hidden w-full gap-4 min-w-0">
        <div className="flex items-center gap-4 max-w-md xl:max-w-xl w-full bg-black/30 px-6 py-2 rounded-2xl border border-gray-800/50 shadow-inner min-w-0 shrink-0">
          <div className={`p-1.5 rounded-full shrink-0 ${isPlaying ? 'bg-green-500/20 text-green-400 animate-pulse' : 'bg-gray-800 text-gray-500'}`}>
            <Music className="w-4 h-4" />
          </div>
          <div className="flex flex-col overflow-hidden min-w-0 flex-1">
            <div className="relative h-7 overflow-hidden flex items-center">
              <div 
                className={`whitespace-nowrap text-xl font-black tracking-tighter ${isPlaying ? 'animate-marquee' : ''}`}
                style={{ 
                  color: isBypassed ? '#4b5563' : (color.includes('gradient') ? '#10b981' : color),
                  textShadow: isBypassed ? 'none' : `0 0 15px ${color.includes('gradient') ? 'rgba(16,185,129,0.4)' : color + '66'}`
                }}
              >
                {trackTitle || 'No Track Loaded'}
                {isPlaying && <span className="mx-12">{trackTitle || 'No Track Loaded'}</span>}
              </div>
            </div>
          </div>
        </div>
        {showTransport && (onPlayPause || onPrevTrack || onNextTrack) && (
          <div className="flex items-center gap-2 shrink-0 ml-20">
            {onPrevTrack && (
              <button type="button" onClick={onPrevTrack} className="h-9 w-9 rounded-full flex items-center justify-center text-amber-400 hover:bg-amber-500/20 transition-colors" title="{t('app.prevSong')}">
                <SkipBack className="w-4 h-4 fill-current" />
              </button>
            )}
            {onPlayPause && (
              <button type="button" onClick={() => onPlayPause(!isPlaying)} disabled={isBypassed} className={`h-10 w-10 rounded-full flex items-center justify-center border border-white/10 transition-all ${isBypassed ? 'bg-gray-800 text-gray-600' : isPlaying ? 'bg-red-500/20 text-red-500' : 'bg-emerald-500/20 text-emerald-500'}`} title={isPlaying ? 'Pausar' : 'Reproducir'}>
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
              </button>
            )}
            {onNextTrack && (
              <button type="button" onClick={onNextTrack} className="h-9 w-9 rounded-full flex items-center justify-center text-amber-400 hover:bg-amber-500/20 transition-colors" title="{t('app.nextSong')}">
                <SkipForward className="w-4 h-4 fill-current" />
              </button>
            )}

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

            <div className="flex flex-col ml-1">
              <span className={`text-[10px] uppercase font-black tracking-[0.2em] ${isBypassed ? 'text-gray-600' : 'text-yellow-400'}`}>{t('app.positionDuration')}</span>
              <div className={`text-lg font-mono font-black leading-none ${isBypassed ? 'text-gray-600' : 'text-white'}`}>
                {formatTime(currentTime)} <span className="text-base font-bold text-gray-500">/ {formatTime(duration)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right: Controls */}
      <div className="flex flex-wrap gap-3 shrink-0 w-full lg:w-auto justify-end">
        <div className="flex items-center gap-2 bg-gray-800/50 p-1 rounded-lg border border-gray-700">
          <select
            value={visualizerType}
            onChange={(e) => setVisualizerType(e.target.value as any)}
            className="px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-md text-xs font-bold text-gray-300 focus:outline-none focus:ring-1 focus:ring-green-500 uppercase"
          >
            <option value="bars">Bars</option>
            <option value="wave">Wave</option>
            <option value="circle">Circle</option>
            <option value="particles">Particles</option>
          </select>
        </div>

        <div className="flex items-center gap-3 bg-gray-800/50 px-3 py-1.5 rounded-lg border border-gray-700">
          <span className="text-[10px] font-black text-yellow-400 uppercase tracking-widest">Intensity</span>
          <Slider
            min={0.1}
            max={1.5}
            step={0.1}
            value={[intensity]}
            onValueChange={([v]) => setIntensity(v)}
            className="w-20"
            rangeClassName="!bg-gray-700"
            thumbClassName="slider-thumb-rect-striped-green"
          />
        </div>
      </div>
    </div>

      {/* Canvas container */}
      <div className="relative p-4">
        <canvas
          ref={canvasRef}
          width={1920}
          height={height}
          style={{ height: `${height}px` }}
          className="w-full rounded-lg bg-gradient-to-b from-gray-900 to-black"
        />

        {/* Overlay info */}
        <div className="absolute bottom-4 left-4 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full transition-all duration-500 ${isBypassed ? 'bg-gray-600 shadow-none' : 'bg-gradient-to-r from-green-500 to-yellow-500 animate-pulse'}`}></div>
            <span className="text-sm text-gray-300">
              {audioData ? `${audioData.frequencyData.length} bins` : t('audioEditor.noAudio')}
            </span>
          </div>

          {audioData?.waveform && (
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full transition-all duration-500 ${isBypassed ? 'bg-gray-600 shadow-none' : 'bg-gradient-to-r from-green-500 to-yellow-500'}`}></div>
              <span className="text-sm text-gray-300">Waveform</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full transition-all duration-500 ${isBypassed ? 'bg-red-900' : (deckAActive ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-600 shadow-[0_0_4px_rgba(220,38,38,0.4)]')}`}
            ></div>
            <span className="text-sm text-gray-300">{t('audioEditor.midiKeyboard')} {deckAActive ? t('audioEditor.active') : t('audioEditor.inactive')}</span>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full transition-all duration-500 ${isBypassed ? 'bg-red-900' : (deckBActive ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-600 shadow-[0_0_4px_rgba(220,38,38,0.4)]')}`}
            ></div>
            <span className="text-sm text-gray-300">Pistas {deckBActive ? 'activo' : 'inactivo'}</span>
          </div>

          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full transition-all duration-500 ${isBypassed ? 'bg-gray-600' : 'bg-yellow-400'}`}></div>
            <span className="text-sm text-gray-300">{t('audioEditor.masterLabel', { n: Math.round(masterVolume * 100) })}</span>
          </div>
        </div>
      </div>

      {/* Frequency spectrum info */}
      {showInfo && audioData && (
        <div className={`px-5 pb-5 border-t border-gray-700 pt-5 bg-gray-900/90 transition-all duration-500 ${isBypassed ? 'opacity-40 grayscale' : 'opacity-100'}`}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="space-y-2">
              <div className="flex flex-col">
                <p className={`text-[10px] font-black uppercase tracking-[0.15em] transition-colors duration-500 ${isBypassed ? 'text-gray-600' : 'text-gray-500'}`}>Avg Frequency</p>
                <p className={`text-xl font-mono font-black tracking-tighter transition-colors duration-500 ${isBypassed ? 'text-gray-700' : 'text-blue-400'}`}>
                  {calculateAverageFrequency(audioData.frequencyData).toFixed(1)} <span className="text-[10px] opacity-50">Hz</span>
                </p>
              </div>
              <div className="h-1 w-full bg-gray-800 rounded-full overflow-hidden">
                <div 
                  className="h-full transition-all duration-500" 
                  style={{ 
                    width: `${Math.min(100, (calculateAverageFrequency(audioData.frequencyData) / 128) * 100)}%`,
                    background: isBypassed ? '#374151' : (color.includes('gradient') ? '#3b82f6' : color),
                    boxShadow: isBypassed ? 'none' : `0 0 8px ${color.includes('gradient') ? 'rgba(59,130,246,0.4)' : color + '66'}`
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-col">
                <p className={`text-[10px] font-black uppercase tracking-[0.15em] transition-colors duration-500 ${isBypassed ? 'text-gray-600' : 'text-gray-500'}`}>Peak</p>
                <p className={`text-xl font-mono font-black tracking-tighter transition-colors duration-500 ${isBypassed ? 'text-gray-700' : 'text-red-500'}`}>
                  {findPeakFrequency(audioData.frequencyData).toFixed(1)} <span className="text-[10px] opacity-50">Hz</span>
                </p>
              </div>
              <div className="h-1 w-full bg-gray-800 rounded-full overflow-hidden">
                <div 
                  className="h-full transition-all duration-500" 
                  style={{ 
                    width: `${Math.min(100, (findPeakFrequency(audioData.frequencyData) / 255) * 100)}%`,
                    background: isBypassed ? '#374151' : (color.includes('gradient') ? '#ef4444' : color),
                    boxShadow: isBypassed ? 'none' : `0 0 8px ${color.includes('gradient') ? 'rgba(239,68,68,0.4)' : color + '66'}`
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-col">
                <p className={`text-[10px] font-black uppercase tracking-[0.15em] transition-colors duration-500 ${isBypassed ? 'text-gray-600' : 'text-gray-500'}`}>RMS Level</p>
                <p className={`text-xl font-mono font-black tracking-tighter transition-colors duration-500 ${isBypassed ? 'text-gray-700' : 'text-yellow-400'}`}>
                  {calculateRMS(audioData.frequencyData).toFixed(3)}
                </p>
              </div>
              <div className="h-1 w-full bg-gray-800 rounded-full overflow-hidden">
                <div 
                  className="h-full transition-all duration-500" 
                  style={{ 
                    width: `${Math.min(100, calculateRMS(audioData.frequencyData) * 100 * 2.5)}%`,
                    background: isBypassed ? '#374151' : (color.includes('gradient') ? '#eab308' : color),
                    boxShadow: isBypassed ? 'none' : `0 0 8px ${color.includes('gradient') ? 'rgba(234,179,8,0.4)' : color + '66'}`
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-col">
                <p className={`text-[10px] font-black uppercase tracking-[0.15em] transition-colors duration-500 ${isBypassed ? 'text-gray-600' : 'text-gray-500'}`}>Visual Mode</p>
                <p className={`text-xl font-mono font-black capitalize tracking-tighter transition-colors duration-500 ${isBypassed ? 'text-gray-700' : 'text-emerald-400'}`}>
                  {visualizerType}
                </p>
              </div>
              <div className="flex gap-1 h-1">
                {['bars', 'wave', 'circle', 'particles'].map(t => (
                  <div 
                    key={t} 
                    className="flex-1 rounded-full transition-all duration-500" 
                    style={{ 
                      background: visualizerType === t ? (isBypassed ? '#4b5563' : (color.includes('gradient') ? '#10b981' : color)) : '#1f2937',
                      boxShadow: (visualizerType === t && !isBypassed) ? `0 0 5px ${color.includes('gradient') ? 'rgba(16,185,129,0.5)' : color + '66'}` : 'none'
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};