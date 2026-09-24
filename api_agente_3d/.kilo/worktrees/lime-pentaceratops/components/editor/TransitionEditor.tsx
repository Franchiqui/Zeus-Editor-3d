import React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { TimelineClip, TransitionType } from '@/types';
import { useI18n } from '@/lib/i18n';
import { Layers, Clock, Zap } from 'lucide-react';

interface TransitionEditorProps {
  selectedClip: TimelineClip | null;
  onUpdateClip: (clipId: string, updates: Partial<TimelineClip>) => void;
}

const TRANSITION_TYPES: { value: TransitionType; label: string }[] = [
  { value: 'none', label: 'Ninguna' },
  { value: 'fade', label: 'Fundido (Fade)' },
  { value: 'dissolve', label: 'Disolvencia' },
  { value: 'slide-left', label: 'Deslizar Izquierda' },
  { value: 'slide-right', label: 'Deslizar Derecha' },
  { value: 'slide-up', label: 'Deslizar Arriba' },
  { value: 'slide-down', label: 'Deslizar Abajo' },
  { value: 'zoom-in', label: 'Zoom Acercar' },
  { value: 'zoom-out', label: 'Zoom Alejar' },
  { value: 'blur', label: 'Desenfoque' },
];

export default function TransitionEditor({ selectedClip, onUpdateClip }: TransitionEditorProps) {
  const { t } = useI18n();
  if (!selectedClip) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500 space-y-4">
        <Layers className="w-12 h-12 opacity-20" />
        <p className="text-sm text-center px-8">{t('videoEditor.transition.selectClipFirst')}</p>
      </div>
    );
  }

  const handleTransitionChange = (side: 'In' | 'Out', type: TransitionType) => {
    const key = side === 'In' ? 'transitionIn' : 'transitionOut';
    const current = selectedClip[key] || { duration: 0.5 };
    
    onUpdateClip(selectedClip.id, {
      [key]: { ...current, type }
    });
  };

  const handleDurationChange = (side: 'In' | 'Out', duration: number) => {
    const key = side === 'In' ? 'transitionIn' : 'transitionOut';
    const current = selectedClip[key] || { type: 'none' };
    
    onUpdateClip(selectedClip.id, {
      [key]: { ...current, duration }
    });
  };

  return (
    <div className="space-y-8 p-2">
      <div className="bg-gray-900/40 p-4 rounded-xl border border-white/5 space-y-6">
        <div className="flex items-center gap-2 text-emerald-400">
          <Zap className="w-4 h-4" />
          <h3 className="text-sm font-bold uppercase tracking-wider">{t('videoEditor.transition.inTransition')}</h3>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-[10px] text-gray-500 uppercase font-black">{t('videoEditor.transition.typeLabel')}</Label>
            <Select 
              value={selectedClip.transitionIn?.type || 'none'} 
              onValueChange={(value: TransitionType) => handleTransitionChange('In', value)}
            >
              <SelectTrigger className="bg-gray-950 border-gray-700 text-white h-10">
                <SelectValue placeholder={t('videoEditor.transition.selectTransition')} />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                {TRANSITION_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label className="text-[10px] text-gray-500 uppercase font-black">{t('videoEditor.transition.duration')}</Label>
              <span className="text-[11px] font-mono text-emerald-500">{(selectedClip.transitionIn?.duration || 0.5).toFixed(1)}s</span>
            </div>
            <Slider
              value={[selectedClip.transitionIn?.duration || 0.5]}
              onValueChange={([val]) => handleDurationChange('In', val)}
              min={0.1}
              max={selectedClip.duration / 2}
              step={0.1}
              className="py-2"
            />
          </div>
        </div>
      </div>

      <div className="bg-gray-900/40 p-4 rounded-xl border border-white/5 space-y-6">
        <div className="flex items-center gap-2 text-emerald-400">
          <Zap className="w-4 h-4 shadow-emerald-500/20" />
          <h3 className="text-sm font-bold uppercase tracking-wider">{t('videoEditor.transition.outTransition')}</h3>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-[10px] text-gray-500 uppercase font-black">{t('videoEditor.transition.typeLabel')}</Label>
            <Select 
              value={selectedClip.transitionOut?.type || 'none'} 
              onValueChange={(value: TransitionType) => handleTransitionChange('Out', value)}
            >
              <SelectTrigger className="bg-gray-950 border-gray-700 text-white h-10">
                <SelectValue placeholder={t('videoEditor.transition.selectTransition')} />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                {TRANSITION_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label className="text-[10px] text-gray-500 uppercase font-black">{t('videoEditor.transition.duration')}</Label>
              <span className="text-[11px] font-mono text-emerald-500">{(selectedClip.transitionOut?.duration || 0.5).toFixed(1)}s</span>
            </div>
            <Slider
              value={[selectedClip.transitionOut?.duration || 0.5]}
              onValueChange={([val]) => handleDurationChange('Out', val)}
              min={0.1}
              max={selectedClip.duration / 2}
              step={0.1}
              className="py-2"
            />
          </div>
        </div>
      </div>

      <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/20">
        <p className="text-[10px] text-emerald-400/70 text-center leading-relaxed italic">
          {t('videoEditor.transition.tipFade')}
        </p>
      </div>
    </div>
  );
}
