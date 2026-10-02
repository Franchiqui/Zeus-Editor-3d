'use client';

import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Volume2, Radio, Zap, Waves, Music, Settings, Plus, Drum } from 'lucide-react';
import { updateRhythmConfig } from '@/lib/rhythm-config-manager';

export type EffectType = 'reverb' | 'delay' | 'chorus' | 'distortion' | 'filter' | 'compressor';

export interface Effect {
  id: string;
  type: EffectType;
  name: string;
  enabled: boolean;
  parameters: Record<string, number>;
}

export interface EffectsRackProps {
  onEffectsChange?: (effects: Effect[]) => void;
  effects?: Effect[];
  initialEffects?: Effect[];
  onResetAll?: () => void;
  rhythms?: { id: string; name: string }[];
  selectedRhythmId?: string;
  onSelectRhythm?: (id: string) => void;
  rhythmEnabled?: boolean;
  onRhythmEnabledChange?: (value: boolean) => void;
  velocity?: number;
  onVelocityChange?: (value: number) => void;
  volume?: number;
  onVolumeChange?: (value: number) => void;
}

export const DEFAULT_EFFECTS: Effect[] = [
  {
    id: 'reverb-1',
    type: 'reverb',
    name: 'audioEditor.effectHallReverb',
    enabled: false,
    parameters: {
      decay: 2.5,
      wet: 0.3,
      dry: 0.7,
      preDelay: 0.1,
    },
  },
  {
    id: 'delay-1',
    type: 'delay',
    name: 'audioEditor.effectStereoDelay',
    enabled: false,
    parameters: {
      time: 0.5,
      feedback: 0.4,
      wet: 0.2,
      dry: 0.8,
    },
  },
  {
    id: 'chorus-1',
    type: 'chorus',
    name: 'audioEditor.effectWideChorus',
    enabled: false,
    parameters: {
      rate: 1.5,
      depth: 0.7,
      feedback: 0.2,
      wet: 0.4,
    },
  },
  {
    id: 'distortion-1',
    type: 'distortion',
    name: 'audioEditor.effectWarmDrive',
    enabled: false,
    parameters: {
      gain: 0.3,
      tone: 0.5,
      wet: 0.2,
    },
  },
  {
    id: 'filter-1',
    type: 'filter',
    name: 'audioEditor.effectLowPass',
    enabled: false,
    parameters: {
      frequency: 2000,
      Q: 1,
      type: 0,
      wet: 1,
    },
  },
  {
    id: 'compressor-1',
    type: 'compressor',
    name: 'audioEditor.effectMasterComp',
    enabled: false,
    parameters: {
      threshold: -20,
      ratio: 4,
      attack: 0.003,
      release: 0.25,
    },
  },
];

const EFFECT_CONFIGS: Record<EffectType, { label?: string; labelKey?: string; icon: React.ReactNode; parameters: Array<{ id: string; label?: string; labelKey?: string; min: number; max: number; step: number; unit?: string }> }> = {
  reverb: {
    labelKey: 'audioEditor.effectReverb',
    icon: <Radio className="h-4 w-4" />,
    parameters: [
      { id: 'decay', labelKey: 'audioEditor.paramDecay', min: 0.1, max: 10, step: 0.1, unit: 's' },
      { id: 'wet', labelKey: 'audioEditor.paramWet', min: 0, max: 1, step: 0.01 },
      { id: 'dry', labelKey: 'audioEditor.paramDry', min: 0, max: 1, step: 0.01 },
      { id: 'preDelay', labelKey: 'audioEditor.paramPreDelay', min: 0, max: 0.5, step: 0.01, unit: 's' },
    ],
  },
  delay: {
    labelKey: 'audioEditor.effectDelay',
    icon: <Music className="h-4 w-4" />,
    parameters: [
      { id: 'time', label: 'Time', min: 0.1, max: 2, step: 0.1, unit: 's' },
      { id: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.01 },
      { id: 'wet', labelKey: 'audioEditor.paramWet', min: 0, max: 1, step: 0.01 },
      { id: 'dry', labelKey: 'audioEditor.paramDry', min: 0, max: 1, step: 0.01 },
    ],
  },
  chorus: {
    labelKey: 'audioEditor.effectChorus',
    icon: <Waves className="h-4 w-4" />,
    parameters: [
      { id: 'rate', label: 'Rate', min: 0.1, max: 10, step: 0.1, unit: 'Hz' },
      { id: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01 },
      { id: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.01 },
      { id: 'wet', labelKey: 'audioEditor.paramWet', min: 0, max: 1, step: 0.01 },
    ],
  },
  distortion: {
    labelKey: 'audioEditor.effectDistortion',
    icon: <Zap className="h-4 w-4" />,
    parameters: [
      { id: 'gain', label: 'Gain', min: 0, max: 1, step: 0.01 },
      { id: 'tone', label: 'Tone', min: 0, max: 1, step: 0.01 },
      { id: 'wet', labelKey: 'audioEditor.paramWet', min: 0, max: 1, step: 0.01 },
    ],
  },
  filter: {
    labelKey: 'audioEditor.effectFilter',
    icon: <Settings className="h-4 w-4" />,
    parameters: [
      { id: 'frequency', label: 'Frequency', min: 20, max: 20000, step: 1, unit: 'Hz' },
      { id: 'Q', label: 'Resonance', min: 0.1, max: 10, step: 0.1 },
      { id: 'wet', labelKey: 'audioEditor.paramWet', min: 0, max: 1, step: 0.01 },
    ],
  },
  compressor: {
    labelKey: 'audioEditor.effectCompressor',
    icon: <Volume2 className="h-4 w-4" />,
    parameters: [
      { id: 'threshold', label: 'Threshold', min: -60, max: 0, step: 1, unit: 'dB' },
      { id: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.1 },
      { id: 'attack', label: 'Attack', min: 0.001, max: 1, step: 0.001, unit: 's' },
      { id: 'release', label: 'Release', min: 0.01, max: 2, step: 0.01, unit: 's' },
    ],
  },
};

export default function EffectsRack({ onEffectsChange, effects: effectsProp, initialEffects = DEFAULT_EFFECTS, onResetAll, rhythms, selectedRhythmId, onSelectRhythm, rhythmEnabled, onRhythmEnabledChange, velocity = 1, onVelocityChange, volume = 0.8, onVolumeChange }: EffectsRackProps) {
  const { t } = useI18n();
  const [internalEffects, setInternalEffects] = useState<Effect[]>(initialEffects);
  const effects = effectsProp !== undefined ? effectsProp : internalEffects;
  const [activeEffectType, setActiveEffectType] = useState<EffectType>('reverb');

  // Manejar cambio de velocidad y guardar en JSON
  const handleVelocityChange = useCallback((value: number) => {
    onVelocityChange?.(value);
    if (selectedRhythmId) {
      updateRhythmConfig(selectedRhythmId, { velocity: value });
    }
  }, [onVelocityChange, selectedRhythmId]);

  // Manejar cambio de volumen y guardar en JSON
  const handleVolumeChange = useCallback((value: number) => {
    onVolumeChange?.(value);
    if (selectedRhythmId) {
      updateRhythmConfig(selectedRhythmId, { volume: value });
    }
  }, [onVolumeChange, selectedRhythmId]);

  const applyEffectsChange = useCallback((newEffects: Effect[]) => {
    onEffectsChange?.(newEffects);
    if (effectsProp === undefined) setInternalEffects(newEffects);
  }, [onEffectsChange, effectsProp]);

  const resetEffects = useCallback(() => {
    if (onResetAll) {
      onResetAll();
      return;
    }
    const freshDefaults = DEFAULT_EFFECTS.map((e) => ({
      ...e,
      enabled: false,
      parameters: { ...e.parameters },
    }));
    applyEffectsChange(freshDefaults);
  }, [onResetAll, applyEffectsChange]);

  const updateEffect = useCallback((effectId: string, updates: Partial<Effect>) => {
    const newEffects = effects.map(effect =>
      effect.id === effectId ? { ...effect, ...updates } : effect
    );
    applyEffectsChange(newEffects);
  }, [effects, applyEffectsChange]);

  const updateEffectParameter = useCallback((effectId: string, parameterId: string, value: number) => {
    const newEffects = effects.map(effect => {
      if (effect.id === effectId) {
        return {
          ...effect,
          parameters: {
            ...effect.parameters,
            [parameterId]: value,
          },
        };
      }
      return effect;
    });
    applyEffectsChange(newEffects);
  }, [effects, applyEffectsChange]);

  const toggleEffect = useCallback((effectId: string) => {
    const newEffects = effects.map(effect =>
      effect.id === effectId ? { ...effect, enabled: !effect.enabled } : effect
    );
    applyEffectsChange(newEffects);
  }, [effects, applyEffectsChange]);

  const addEffect = useCallback(() => {
    const newEffect: Effect = {
      id: `new-effect-${Date.now()}`,
      type: 'reverb',
      name: 'audioEditor.newEffect',
      enabled: true,
      parameters: {
        decay: 2.5,
        wet: 0.3,
        dry: 0.7,
        preDelay: 0.1,
      },
    };
    const newEffects = [...effects, newEffect];
    applyEffectsChange(newEffects);
  }, [effects, applyEffectsChange]);

  const activeEffects = effects.filter(effect => effect.type === activeEffectType);
  const config = EFFECT_CONFIGS[activeEffectType];
  const enabledEffectsCount = effects.filter(effect => effect.enabled).length;

  return (
    <Card className="bg-gray-800 border-gray-700 h-full flex flex-col min-h-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-2xl font-bold text-white">{t('audioEditor.effectsRack')}</CardTitle>
            <CardDescription className="text-gray-400">
              {t('audioEditor.eqTagline')}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={resetEffects}
            className="border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700"
          >
            {t('audioEditor.resetAll')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-y-auto flex-1 min-h-0 scrollbar-thin-transparent">
        <div className="space-y-6">
          <div className="p-4 bg-gray-900 rounded-xl border border-gray-700 space-y-4">
            <div className="flex items-center gap-3">
              <Drum className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-bold text-gray-300">{t('audioEditor.rhythm')}</span>
              <div className="flex-1" />
              <Select
                value={selectedRhythmId || ''}
                onValueChange={(value) => onSelectRhythm?.(value)}
              >
                <SelectTrigger className="w-[120px] h-8 text-xs bg-gray-950 border-gray-700 text-gray-200">
                  <SelectValue placeholder="Ritmo..." />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700">
                  {(rhythms || []).map((opt) => (
                    <SelectItem key={opt.id} value={opt.id} className="text-xs text-white focus:bg-emerald-600 focus:text-white">
                      {opt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => onRhythmEnabledChange?.(!rhythmEnabled)}
                className="h-8 text-xs font-bold border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              >
                {rhythmEnabled ? t('audioEditor.bypass') : t('audioEditor.activate')}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-gray-300 text-xs">{t('audioEditor.velocity')}</Label>
                  <span className="text-xs text-gray-400">{((velocity || 1) * 100).toFixed(0)}%</span>
                </div>
                <Slider
                  value={[velocity || 1]}
                  min={0.25}
                  max={2}
                  step={0.05}
                  onValueChange={([v]) => handleVelocityChange(v)}
                  className="flex-1"
                  thumbClassName="slider-thumb-rect-striped"
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-gray-300 text-xs">{t('audioEditor.volume')}</Label>
                  <span className="text-xs text-gray-400">{Math.round((volume || 0) * 100)}%</span>
                </div>
                <Slider
                  value={[volume || 0]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={([v]) => handleVolumeChange(v)}
                  className="flex-1"
                  thumbClassName="slider-thumb-rect-striped"
                />
              </div>
            </div>
          </div>

          <Tabs
            value={activeEffectType}
            onValueChange={(value) => setActiveEffectType(value as EffectType)}
            className="w-full"
          >
            <TabsList className="grid grid-cols-3 lg:grid-cols-6 mb-6 bg-gray-900">
              {Object.entries(EFFECT_CONFIGS).map(([type, config]) => (
                <TabsTrigger
                  key={type}
                  value={type}
                  className="bg-gray-800 text-gray-300 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                >
                  <div className="flex flex-col items-center gap-1">
                    {config.icon}
                    <span className="text-xs">{config.labelKey ? t(config.labelKey) : config.label}</span>
                  </div>
                </TabsTrigger>
              ))}
            </TabsList>

            {activeEffects.map((effect) => (
              <TabsContent key={effect.id} value={activeEffectType} className="space-y-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={effect.enabled}
                        onCheckedChange={() => toggleEffect(effect.id)}
                        className="data-[state=checked]:bg-blue-600"
                      />
                      <Label className="text-sm font-semibold text-yellow-400">{effect.name.startsWith('audioEditor.') ? t(effect.name) : effect.name}</Label>
                    </div>
                  </div>
                  <div className="text-sm text-gray-400">
                    {effect.enabled ? (
                      <span className="flex items-center gap-1 text-green-400">
                        <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                        Active
                      </span>
                    ) : (
                      <span className="text-gray-500">{t('audioEditor.bypassed')}</span>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  {config.parameters.map((param) => {
                    const value = effect.parameters[param.id] ?? param.min;
                    return (
                      <div key={param.id} className="space-y-3">
                        <div className="flex justify-between items-center">
                          <Label className="text-gray-300">{param.labelKey ? t(param.labelKey) : param.label}</Label>
                          <span className="text-sm text-gray-400">
                            {value.toFixed(param.id === 'frequency' ? 0 : 2)}
                            {param.unit && ` ${param.unit}`}
                          </span>
                        </div>
                        <Slider
                          value={[value]}
                          min={param.min}
                          max={param.max}
                          step={param.step}
                          onValueChange={([newValue]) =>
                            updateEffectParameter(effect.id, param.id, newValue)
                          }
                          className="[&>span]:bg-blue-600"
                          thumbClassName="slider-thumb-rect-striped"
                        />
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>{param.min}{param.unit && ` ${param.unit}`}</span>
                          <span>{param.max}{param.unit && ` ${param.unit}`}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-4 border-t border-gray-700">
                  <div className="grid grid-cols-2 gap-4">
                    <Button
                      variant="outline"
                      style={{
                        borderWidth: 2,
                        borderColor: 'rgb(34 197 94)',
                        background: 'linear-gradient(to bottom, rgba(255,255,255,0.15), transparent)',
                      }}
                      className="text-gray-200 hover:opacity-90 [&:hover]:border-green-400"
                      onClick={() => {
                        const resetParams = config.parameters.reduce((acc, param) => ({
                          ...acc,
                          [param.id]: param.min,
                        }), {});
                        updateEffect(effect.id, { parameters: resetParams });
                      }}
                    >
                      {t('audioEditor.resetParams')}
                    </Button>
                    <Button
                      variant="outline"
                      style={{
                        borderWidth: 2,
                        borderColor: 'rgb(34 197 94)',
                        background: 'linear-gradient(to bottom, rgba(255,255,255,0.15), transparent)',
                      }}
                      className="text-gray-200 hover:opacity-90 [&:hover]:border-green-400"
                      onClick={() => updateEffect(effect.id, { enabled: !effect.enabled })}
                    >
                      {effect.enabled ? t('audioEditor.bypass') : t('audioEditor.activate')}
                    </Button>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>

          <div className="flex justify-between items-center pt-6 border-t border-gray-700">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                onClick={addEffect}
                className="border-blue-500 text-blue-400 hover:bg-blue-500/10"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('audioEditor.addEffect')}
              </Button>
            </div>
            <div className="text-sm text-gray-400">
              {enabledEffectsCount} of {effects.length} effects active
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
