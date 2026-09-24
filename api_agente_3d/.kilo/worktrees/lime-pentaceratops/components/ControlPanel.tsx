'use client';

import { useState, useEffect, useCallback } from 'react';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Volume2, VolumeX, Piano, Music, Zap, RotateCcw } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface ControlPanelProps {
  /** Volumen controlado (0-100). Si se proporciona, sincroniza con el teclado. */
  volume?: number;
  /** Octava controlada (-2 a 2). Si se proporciona, sincroniza con el teclado. */
  octave?: number;
  /** Sustain controlado. Si se proporciona, sincroniza con el teclado. */
  sustain?: boolean;
  /** Instrumento seleccionado (controlado desde fuera). */
  instrument?: string;
  onVolumeChange?: (volume: number) => void;
  onOctaveChange?: (octave: number) => void;
  onVelocityChange?: (velocity: number) => void;
  onSustainToggle?: (sustain: boolean) => void;
  onInstrumentChange?: (instrument: string) => void;
  onReset?: () => void;
}

const INSTRUMENTS = [
  { value: 'acoustic_grand_piano', labelKey: 'audioEditor.instrGrandPiano' },
  { value: 'electric_piano', label: 'app.electricPiano' },
  { value: 'organ', label: 'Órgano' },
  { value: 'strings', label: 'Cuerdas' },
  { value: 'synth_lead', labelKey: 'audioEditor.instrSynthLead' },
  { value: 'bass', label: 'Bajo' },
  { value: 'brass', label: 'Metales' },
  { value: 'pad', label: 'Pad' },
];

const OCTAVES = [-2, -1, 0, 1, 2];

export default function ControlPanel({
  volume: controlledVolume,
  octave: controlledOctave,
  sustain: controlledSustain,
  instrument: controlledInstrument,
  onVolumeChange,
  onOctaveChange,
  onVelocityChange,
  onSustainToggle,
  onInstrumentChange,
  onReset,
}: ControlPanelProps) {
  const { t } = useI18n();
  const [volume, setVolume] = useState(controlledVolume ?? 80);
  const [octave, setOctave] = useState(controlledOctave ?? 0);
  const [velocity, setVelocity] = useState(100);
  const [sustain, setSustain] = useState(controlledSustain ?? false);
  const [instrument, setInstrument] = useState(controlledInstrument ?? 'acoustic_grand_piano');
  const [isMuted, setIsMuted] = useState(false);

  const handleVolumeChange = useCallback((value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    onVolumeChange?.(newVolume);
  }, [onVolumeChange]);

  const handleOctaveChange = useCallback((value: number) => {
    setOctave(value);
    onOctaveChange?.(value);
  }, [onOctaveChange]);

  const handleVelocityChange = useCallback((value: number[]) => {
    const newVelocity = value[0];
    setVelocity(newVelocity);
    onVelocityChange?.(newVelocity);
  }, [onVelocityChange]);

  const handleSustainToggle = useCallback((value: boolean) => {
    setSustain(value);
    onSustainToggle?.(value);
  }, [onSustainToggle]);

  const handleInstrumentChange = useCallback((value: string) => {
    setInstrument(value);
    onInstrumentChange?.(value);
  }, [onInstrumentChange]);

  const handleMuteToggle = useCallback(() => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    onVolumeChange?.(newMutedState ? 0 : volume);
  }, [isMuted, volume, onVolumeChange]);

  const handleReset = useCallback(() => {
    setVolume(80);
    setOctave(0);
    setVelocity(100);
    setSustain(false);
    setInstrument('acoustic_grand_piano');
    setIsMuted(false);
    
    onVolumeChange?.(80);
    onOctaveChange?.(0);
    onVelocityChange?.(100);
    onSustainToggle?.(false);
    onInstrumentChange?.('acoustic_grand_piano');
    onReset?.();
  }, [onVolumeChange, onOctaveChange, onVelocityChange, onSustainToggle, onInstrumentChange, onReset]);

  // Sincronizar con valores controlados externamente
  useEffect(() => {
    if (controlledVolume !== undefined) setVolume(controlledVolume);
  }, [controlledVolume]);
  useEffect(() => {
    if (controlledOctave !== undefined) setOctave(controlledOctave);
  }, [controlledOctave]);
  useEffect(() => {
    if (controlledSustain !== undefined) setSustain(controlledSustain);
  }, [controlledSustain]);
  useEffect(() => {
    if (controlledInstrument !== undefined) setInstrument(controlledInstrument);
  }, [controlledInstrument]);

  // Efecto para sincronizar el mute con el volumen
  useEffect(() => {
    if (isMuted && volume > 0) {
      onVolumeChange?.(0);
    } else if (!isMuted && volume === 0) {
      setVolume(80);
      onVolumeChange?.(80);
    }
  }, [isMuted, volume, onVolumeChange]);

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-gray-100">
          <Zap className="h-5 w-5 text-blue-400" />
          {t('audioEditor.controlPanel')}
        </CardTitle>
        <CardDescription className="text-gray-400">
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Volumen y Mute */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-gray-300 flex items-center gap-2">
              <Volume2 className="h-4 w-4" />
              {t('audioEditor.volume')}
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400 w-10 text-right">{volume}%</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleMuteToggle}
                className={`h-8 w-8 p-0 ${isMuted ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
              >
                {isMuted ? (
                  <VolumeX className="h-4 w-4 text-red-400" />
                ) : (
                  <Volume2 className="h-4 w-4 text-gray-300" />
                )}
              </Button>
            </div>
          </div>
          <Slider
            value={[isMuted ? 0 : volume]}
            onValueChange={handleVolumeChange}
            max={100}
            step={1}
            className="w-full"
            thumbClassName="slider-thumb-rect-striped"
            disabled={isMuted}
          />
        </div>

        {/* Octava */}
        <div className="space-y-3">
          <Label className="text-gray-300 flex items-center gap-2">
            <Music className="h-4 w-4" />
            {t('audioEditor.octave')}
          </Label>
          <div className="flex gap-2">
            {OCTAVES.map((oct) => (
              <Button
                key={oct}
                variant="outline"
                size="sm"
                onClick={() => handleOctaveChange(oct)}
                className={`flex-1 ${octave === oct ? 'bg-blue-600 border-blue-500 hover:bg-blue-700 text-white' : 'border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
              >
                {oct === 0 ? `0 (${t('audioEditor.central')})` : oct > 0 ? `+${oct}` : oct}
              </Button>
            ))}
          </div>
        </div>

        {/* Velocidad */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-gray-300 flex items-center gap-2">
              <Piano className="h-4 w-4" />
              {t('audioEditor.velocity')}
            </Label>
            <span className="text-sm text-gray-400">{velocity}%</span>
          </div>
          <Slider
            value={[velocity]}
            onValueChange={handleVelocityChange}
            max={127}
            step={1}
            className="w-full"
            thumbClassName="slider-thumb-rect-striped"
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>{t('audioEditor.soft')}</span>
            <span>{t('audioEditor.medium')}</span>
            <span>{t('audioEditor.hard')}</span>
          </div>
        </div>

        {/* Instrumento y Sustain */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <Label className="text-gray-300">{t('audioEditor.instrument')}</Label>
            <Select value={instrument} onValueChange={handleInstrumentChange}>
              <SelectTrigger className="border-gray-600 bg-gray-900 text-gray-300">
                <SelectValue placeholder="Seleccionar instrumento" />
              </SelectTrigger>
              <SelectContent className="border-gray-700 bg-gray-800">
                {INSTRUMENTS.map((inst) => (
                  <SelectItem
                    key={inst.value}
                    value={inst.value}
                    className="text-gray-300 hover:bg-gray-700 focus:bg-gray-700"
                  >
                    {inst.labelKey ? t(inst.labelKey) : inst.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label className="text-gray-300">{t('audioEditor.sustain')}</Label>
            <Toggle
              pressed={sustain}
              onPressedChange={handleSustainToggle}
              className={`w-full h-10 ${sustain ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-900 hover:bg-gray-700 border-gray-600'}`}
            >
              {sustain ? t('audioEditor.enabled') : t('audioEditor.disabled')}
            </Toggle>
          </div>
        </div>

        {/* Botón de Reset */}
        <Button
          onClick={handleReset}
          variant="outline"
          style={{
            borderWidth: 2,
            borderColor: 'rgb(34 197 94)',
            background: 'linear-gradient(to bottom, rgba(255,255,255,0.15), transparent)',
          }}
          className="w-full text-gray-200 hover:opacity-90 [&:hover]:border-green-400"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          {t('audioEditor.resetValues')}
        </Button>
      </CardContent>
    </Card>
  );
}