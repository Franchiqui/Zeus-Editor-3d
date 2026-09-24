'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useI18n } from '@/lib/i18n';
import { motion } from 'framer-motion';
import { 
  Volume2, 
  Music, 
  Zap, 
  Lock, 
  Unlock,
  Settings,
  Headphones,
  Radio
} from 'lucide-react';
import AudioVisualizer from '@/components/ui/AudioVisualizer';
import { Slider } from '@/components/ui/slider';

// --- TIPOS ---
type FrequencyBand = {
  id: string;
  label: string;
  frequency: string;
  value: number;
  min: number;
  max: number;
  color: string;
};

type Preset = {
  id: string;
  name: string;
  icon: React.ReactNode;
  values: number[];
};

// --- CONSTANTES ---
const initialBands: FrequencyBand[] = [
  { id: 'sub', label: 'SUB', frequency: '32Hz', value: 0, min: -24, max: 12, color: '#9d4edd' },
  { id: 'bass', label: 'BASS', frequency: '64Hz', value: 0, min: -24, max: 12, color: '#7b2cbf' },
  { id: 'low-mid', label: 'LOW MID', frequency: '250Hz', value: 0, min: -24, max: 12, color: '#5a189a' },
  { id: 'mid', label: 'MID', frequency: '1kHz', value: 0, min: -24, max: 12, color: '#3c096c' },
  { id: 'high-mid', label: 'HIGH MID', frequency: '4kHz', value: 0, min: -24, max: 12, color: '#240046' },
  { id: 'presence', label: 'PRESENCE', frequency: '8kHz', value: 0, min: -24, max: 12, color: '#10002b' },
  {
    id: 'brilliance', label: 'BRILLIANCE', frequency: '16kHz', min: -24, max: 12, color: '#00eeff',
    value: 0
  },
];

const presets: Preset[] = [
  { id: 'flat', name: 'Flat', icon: <Radio className="w-4 h-4" />, values: [0, 0, 0, 0, 0, 0, 0] },
  { id: 'rock', name: 'Rock', icon: <Music className="w-4 h-4" />, values: [4, 6, 2, -1, 2, 3, 2] },
  { id: 'pop', name: 'Pop', icon: <Headphones className="w-4 h-4" />, values: [2, 4, -1, 1, 3, 4, 3] },
  { id: 'bass-boost', name: 'Bass Boost', icon: <Zap className="w-4 h-4" />, values: [8, 6, 2, -2, -1, 0, -1] },
];

/**
 * ZeusEQ Component - Versión Standalone
 */
export default function ZeusEQ({ 
  masterGain = 0, 
  onMasterGainChange,
  isBypassed = false,
  onBypassChange,
  isPlaying = false,
  bands: externalBands,
  onBandChange,
  audioContext,
  audioSource,
  vizColor = '#22c55e',
  onColorChange,
  showLiveInput = false,
}: { 
  masterGain?: number; 
  onMasterGainChange?: (value: number) => void;
  isBypassed?: boolean;
  onBypassChange?: (bypassed: boolean) => void;
  isPlaying?: boolean;
  /** Mostrar audio en vivo (teclado, mic) aunque no haya reproducción de pista */
  showLiveInput?: boolean;
  bands?: FrequencyBand[];
  onBandChange?: (id: string, value: number) => void;
  audioContext?: AudioContext;
  audioSource?: AudioNode;
  vizColor?: string;
  onColorChange?: (color: string) => void;
}) {
  const { t } = useI18n();
  const [internalBands, setInternalBands] = useState<FrequencyBand[]>(initialBands);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [activePreset, setActivePreset] = useState<string>('flat');
  
  const bands = externalBands || internalBands;
  const bandsRef = useRef(bands);
  const spectrumRef = useRef<HTMLDivElement>(null);

  // Sincronizar referencia para la animación sin disparar re-renders
  useEffect(() => {
    bandsRef.current = bands;
  }, [bands]);
  
  const handleBandChange = useCallback((id: string, value: number) => {
    if (isLocked) return;
    if (onBandChange) {
      onBandChange(id, value);
    } else {
      setInternalBands(prev => prev.map(band => 
        band.id === id ? { ...band, value } : band
      ));
    }
  }, [isLocked, onBandChange]);
  
  const handlePresetSelect = useCallback((presetId: string) => {
    if (isLocked) return;
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      setActivePreset(presetId);
      const newValues = preset.values;
      if (onBandChange) {
        initialBands.forEach((band, index) => {
          onBandChange(band.id, newValues[index] ?? 0);
        });
      } else {
        setInternalBands(prev => prev.map((band, index) => ({
          ...band,
          value: newValues[index] ?? 0
        })));
      }
    }
  }, [isLocked, onBandChange]);
  
  useEffect(() => {
    const updateSpectrum = () => {
      if (!spectrumRef.current || isBypassed || !isPlaying) return;
      const bars = spectrumRef.current.querySelectorAll('.spectrum-bar');
      bars.forEach((bar, index) => {
        const bandValue = bandsRef.current[index]?.value ?? 0;
        const normalizedValue = (bandValue + 24) / 36;
        const height = 10 + (normalizedValue * 80) + (Math.random() * 10);
        if (bar instanceof HTMLElement) {
          bar.style.height = `${height}%`;
        }
      });
    };
    const interval = setInterval(updateSpectrum, 80);
    return () => clearInterval(interval);
  }, [isBypassed, isPlaying]);
  
  return (
    <div className="w-full">
      {/* CONSOLA MAESTRA UNIFICADA */}
      <div className={`bg-gray-900 p-8 flex flex-row gap-4 items-stretch border-b border-gray-800 w-full h-[450px] text-white font-sans overflow-hidden transition-opacity duration-500 ${isBypassed ? 'opacity-80' : 'opacity-100'}`}>
        
        {/* COLUMNA 1: TÍTULO + PRESETS */}
        <div className="flex flex-col justify-between w-64 shrink-0">
          <div className="pt-1">
            <h1 className={`text-4xl font-black bg-clip-text text-transparent uppercase tracking-tighter leading-none transition-all duration-500 ${isBypassed ? 'bg-gray-600' : 'bg-gradient-to-r from-green-400 to-emerald-600'}`}>
              ZeusEQ
            </h1>
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-[0.2em] mt-2">
              {t('audioEditor.eqAudioPrecision')}
            </p>
          </div>

          <section className={`bg-gray-950 rounded-[24px] border border-gray-800 p-4 shadow-xl transition-all duration-500 ${isBypassed ? 'opacity-40 grayscale' : 'opacity-100'}`}>
            <h2 className={`text-[9px] font-black uppercase tracking-widest mb-3 px-1 transition-colors duration-500 ${isBypassed ? 'text-gray-700' : 'text-gray-400'}`}>{t('audioEditor.eqVisualColor')}</h2>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { id: 'green', color: '#22c55e', label: 'Neon' },
                { id: 'blue', color: '#3b82f6', label: 'Ocean' },
                { id: 'purple', color: '#a855f7', label: 'Void' },
                { id: 'gold', color: '#eab308', label: 'Gold' },
                { id: 'fire', color: 'linear-gradient(to top, #f97316, #ef4444)', label: 'Fire' },
                { id: 'cyber', color: 'linear-gradient(to top, #06b6d4, #8b5cf6)', label: 'Cyber' },
              ].map((c) => (
                <button
                  key={c.id}
                  onClick={() => !isBypassed && onColorChange?.(c.color)}
                  disabled={isBypassed}
                  className={`h-8 rounded-lg border transition-all flex items-center justify-center group ${vizColor === c.color ? (isBypassed ? 'border-gray-800' : 'border-white scale-105 shadow-[0_0_10px_rgba(255,255,255,0.1)]') : 'border-gray-800 hover:border-gray-600'} ${isBypassed ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  style={{ background: c.color.includes('gradient') ? (isBypassed ? '#1f2937' : c.color) : 'transparent' }}
                  title={c.label}
                >
                  {!c.color.includes('gradient') && (
                    <div className="w-3 h-3 rounded-full transition-colors duration-500" style={{ backgroundColor: isBypassed ? '#374151' : c.color }} />
                  )}
                  {c.color.includes('gradient') && (
                     <div className="w-full h-full rounded-lg opacity-80 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex justify-between items-center mb-4 px-1 border-t border-gray-800 pt-4">
              <h2 className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{t('audioEditor.eqPresets')}</h2>
               <button onClick={() => setIsLocked(!isLocked)} className={`transition-colors ${isLocked ? 'text-red-500' : 'text-gray-600 hover:text-white'}`}>
                  {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
               </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handlePresetSelect(preset.id)}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${activePreset === preset.id ? (isBypassed ? 'bg-gray-800 border-gray-700 text-gray-500' : 'bg-green-500/10 border-green-500/50 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.1)]') : 'bg-gray-900 border-gray-800 text-gray-500 hover:border-gray-700'}`}
                >
                  <div className={`mb-1.5 transition-colors duration-500 ${activePreset === preset.id && !isBypassed ? 'text-green-400' : 'text-gray-500'}`}>{preset.icon}</div>
                  <span className="text-[9px] font-bold uppercase tracking-tighter">{preset.name}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* COLUMNA 2: SPECTRUM MONITOR */}
        <section className="flex flex-col justify-between flex-1 bg-gray-950 rounded-[32px] border border-gray-800 p-8 shadow-2xl shrink-0">
          <h2 className="text-[9px] font-black text-gray-400 uppercase tracking-widest text-center pt-1">{t('audioEditor.eqSpectrumMonitor')}</h2>
          
          <div className="flex flex-col h-full">
              <div className="flex-1 bg-black/40 rounded-[24px] border border-gray-800 relative overflow-hidden">
                  <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
                  
                  {((!isPlaying && !showLiveInput) || isBypassed) ? (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-950/40 backdrop-blur-[2px]">
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex gap-1">
                          <div className="w-1 h-4 bg-gray-700 rounded-full animate-pulse" />
                          <div className="w-1 h-8 bg-gray-600 rounded-full animate-pulse delay-75" />
                          <div className="w-1 h-5 bg-gray-700 rounded-full animate-pulse delay-150" />
                        </div>
                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">{t('audioEditor.eqPlayToActivate')}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 z-10">
                      <AudioVisualizer 
                        audioContext={audioContext}
                        audioSource={audioSource}
                        isPlaying={isPlaying}
                        isBypassed={isBypassed}
                        showLiveInput={showLiveInput}
                        minimal={true}
                        defaultType="particles"
                        height={250}
                        color={vizColor}
                      />
                    </div>
                  )}
              </div>
              <div className="flex justify-between mt-4 text-[8px] font-bold text-gray-500 uppercase tracking-widest px-3">
                  {bands.map((band) => <span key={band.id} className={`transition-colors duration-500 ${isBypassed ? 'text-gray-700' : ''}`}>{band.frequency}</span>)}
              </div>
          </div>
        </section>

        {/* COLUMNA 3: EQUALIZER CONSOLE */}
        <section className="flex flex-col justify-between flex-1 bg-gray-950 rounded-[32px] border border-gray-800 p-8 shadow-2xl shrink-0">
          <h2 className="text-[9px] font-black text-gray-400 uppercase tracking-widest text-center pt-1">{t('audioEditor.eqPrecisionConsole')}</h2>
          
          <div className="flex flex-row justify-between items-stretch h-[250px] px-1">
            {bands.map((band) => (
              <div key={band.id} className="flex flex-col items-center w-10">
                <div className="text-center mb-6 h-8 flex flex-col justify-center">
                  <div className={`text-[10px] font-black uppercase leading-none mb-1 transition-colors duration-500 ${isBypassed ? 'text-gray-600' : 'text-white'}`}>{band.label}</div>
                  <div className={`text-[9px] font-mono font-bold transition-colors duration-500 ${isBypassed ? 'text-gray-700' : 'text-green-500'}`}>{band.frequency}</div>
                </div>
                
                <div className="relative flex-1 w-8 flex justify-center bg-gray-900 rounded-full border border-gray-800 py-4">
                  <div className="absolute inset-y-4 w-[1.5px] bg-gray-800 rounded-full" />
                  <div 
                    className={`absolute bottom-4 w-[1.5px] transition-all duration-500 rounded-full ${isBypassed ? 'bg-gray-700 h-[10%]' : 'bg-green-400 shadow-[0_0_10px_rgba(34,197,94,0.5)]'}`}
                    style={{ height: isBypassed ? '10%' : `${(((band.value ?? 0) - band.min) / (band.max - band.min)) * 88}%` }}
                  />

                  <input
                    type="range" min={band.min} max={band.max} step={0.1} value={band.value ?? 0}
                    onChange={(e) => handleBandChange(band.id, parseFloat(e.target.value))}
                    disabled={isLocked || isBypassed}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-ns-resize z-30"
                    style={{ WebkitAppearance: 'slider-vertical' } as any}
                  />

                  <motion.div
                    className={`absolute w-7 h-10 border-2 rounded-sm shadow-xl z-10 pointer-events-none flex flex-col items-center justify-center gap-1.5 transition-all duration-500 ${isBypassed ? 'bg-gray-900 border-gray-800' : 'bg-gray-800 border-gray-700'}`}
                    animate={{ bottom: isBypassed ? '10%' : `calc(${(((band.value ?? 0) - band.min) / (band.max - band.min)) * 88}% + 4px)` }}
                  >
                    <div className="w-4 h-[1px] bg-gray-700" />
                    <div className={`w-4 h-[2px] transition-all duration-500 ${isBypassed ? 'bg-gray-600 shadow-none' : 'shadow-[0_0_8px_rgba(34,197,94,0.5)]'}`} style={{ backgroundColor: isBypassed ? '#4b5563' : band.color }} />
                    <div className="w-4 h-[1px] bg-gray-700" />
                  </motion.div>
                </div>

                <div className={`mt-6 text-[10px] font-mono font-bold bg-gray-900 px-1.5 py-1 rounded border border-gray-800 transition-colors duration-500 ${isBypassed ? 'text-gray-700' : 'text-gray-400'}`}>
                  {(band.value ?? 0) >= 0 ? '+' : ''}{(band.value ?? 0).toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* COLUMNA 4: MASTER OUTPUT */}
        <section className="flex flex-col justify-between w-64 bg-gray-950 rounded-[32px] border border-gray-800 p-8 shadow-2xl shrink-0 items-center">
          <h2 className="text-[9px] font-black text-gray-400 uppercase tracking-widest text-center pt-1">{t('audioEditor.eqMasterOutput')}</h2>
          
          <div className="flex flex-col items-center w-full">
              <div className="relative w-32 h-32 flex items-center justify-center mb-8">
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="8" />
                  <circle cx="50" cy="50" r="44" fill="none" className="transition-all duration-500" stroke={isBypassed ? "#333" : "#22c55e"} strokeWidth="8" strokeDasharray={`${(masterGain + 24) * (276.4 / 36)} 276.4`} strokeLinecap="round" />
                </svg>
                <div className="z-10 flex flex-col items-center">
                  <Volume2 className={`w-8 h-8 mb-1.5 transition-colors duration-500 ${isBypassed ? 'text-gray-700' : 'text-green-400'}`} />
                  <span className={`text-2xl font-black font-mono tracking-tighter transition-colors duration-500 ${isBypassed ? 'text-gray-700' : 'text-white'}`}>{masterGain >= 0 ? '+' : ''}{masterGain}</span>
                </div>
              </div>
              
              <div className="w-full space-y-6">
                  <Slider
                    min={-24}
                    max={12}
                    step={1}
                    value={[masterGain]}
                    onValueChange={([v]) => onMasterGainChange?.(Math.round(v))}
                    disabled={isLocked || isBypassed}
                    className={`w-full transition-all duration-500 ${isBypassed ? 'opacity-50' : ''}`}
                    rangeClassName="!bg-gray-700"
                    thumbClassName={isBypassed ? 'slider-thumb-rect-striped' : 'slider-thumb-rect-striped-green'}
                  />
                  <button onClick={() => !isLocked && onBypassChange?.(!isBypassed)} className={`w-full py-4 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all duration-500 border-2 ${isBypassed ? 'border-red-500/20 bg-red-500/5 text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.1)]' : 'border-green-500/20 bg-green-500/5 text-green-500 shadow-[0_0_20px_rgba(34,197,94,0.1)]'}`}>
                    {isBypassed ? 'Bypass On' : 'Engine Active'}
                  </button>
              </div>
          </div>
        </section>

      </div>
    </div>
  );
}
