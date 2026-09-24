'use client';

import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { GifOptions, TextOverlay } from '@/lib/gif-utils';
import { useI18n } from '@/lib/i18n';
import { useLocalFonts } from '@/lib/useLocalFonts';

interface AnimationControlsProps {
  options: GifOptions & { textOverlay?: TextOverlay };
  onOptionsChange: (options: GifOptions & { textOverlay?: TextOverlay }) => void;
  defaultDuration: number;
  onDefaultDurationChange: (duration: number) => void;
  onAddText?: (text: TextOverlay) => void;
}

const presetSizes = [
  { label: 'Small (320x240)', width: 320, height: 240 },
  { label: 'Medium (480x360)', width: 480, height: 360 },
  { label: 'Large (640x480)', width: 640, height: 480 },
  { label: 'HD (1280x720)', width: 1280, height: 720 },
  { label: 'Full HD (1920x1080)', width: 1920, height: 1080 },
  { label: '4K (3840x2160)', width: 3840, height: 2160 },
  { label: 'Custom', width: 0, height: 0 },
];

export function AnimationControls({
  options,
  onOptionsChange,
  defaultDuration,
  onDefaultDurationChange,
  onAddText,
}: AnimationControlsProps) {
  const { t } = useI18n();
  // --- Fuentes locales (carpeta «Fuentes» configurada en la pestaña Archivo) ---
  const { localFonts, localFontsLoading, loadLocalFonts, ensureLocalFontFace } = useLocalFonts();
  const handleTextOverlayChange = (key: keyof TextOverlay, value: string | number) => {
    onOptionsChange({
      ...options,
      textOverlay: {
        text: options.textOverlay?.text || '',
        x: options.textOverlay?.x || 50,
        y: options.textOverlay?.y || 50,
        fontSize: options.textOverlay?.fontSize || 32,
        fontFamily: options.textOverlay?.fontFamily || 'Arial',
        color: options.textOverlay?.color || '#ffffff',
        ...options.textOverlay,
        [key]: value,
      },
    });
  };

  const selectedPreset = presetSizes.find(
    (p) => p.width === options.width && p.height === options.height
  );

  return (
    <div className="space-y-6 pb-12">
      <Card className="bg-gray-900 border-gray-800 text-white shadow-2xl">
        <CardHeader>
          <CardTitle className="text-white">{t('gifEditor.ctrlDimensions')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3 block">{t('gifEditor.ctrlPresetSize')}</Label>
            <Select
              value={selectedPreset?.label || t('gifEditor.ctrlCustom')}
              onValueChange={(value) => {
                const preset = presetSizes.find((p) => p.label === value);
                if (preset && preset.width > 0) {
                  onOptionsChange({ ...options, width: preset.width, height: preset.height });
                }
              }}
            >
              <SelectTrigger className="bg-gray-800 border-gray-700 text-white focus:ring-green-500/50 rounded-xl h-12 transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-800 text-white">
                {presetSizes.map((preset) => (
                  <SelectItem key={preset.label} value={preset.label} className="hover:bg-green-600 focus:bg-green-600 transition-colors cursor-pointer">
                    {preset.label === 'Small (320x240)' ? t('gifEditor.ctrlPresetSmall') :
                     preset.label === 'Medium (480x360)' ? t('gifEditor.ctrlPresetMedium') :
                     preset.label === 'Large (640x480)' ? t('gifEditor.ctrlPresetLarge') :
                     preset.label === 'Custom' ? t('gifEditor.ctrlCustom') : preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3 block">{t('gifEditor.ctrlWidth')}</Label>
              <Input
                type="number"
                value={options.width}
                onChange={(e) =>
                  onOptionsChange({ ...options, width: parseInt(e.target.value) || 480 })
                }
                min={100}
                max={1920}
                className="bg-gray-800 border-gray-700 text-white rounded-xl h-12 focus:ring-green-500 transition-all shadow-inner"
              />
            </div>
            <div>
              <Label className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3 block">{t('gifEditor.ctrlHeight')}</Label>
              <Input
                type="number"
                value={options.height}
                onChange={(e) =>
                  onOptionsChange({ ...options, height: parseInt(e.target.value) || 360 })
                }
                min={100}
                max={1080}
                className="bg-gray-800 border-gray-700 text-white rounded-xl h-12 focus:ring-green-500 transition-all shadow-inner"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gray-900 border-gray-800 text-white shadow-2xl">
        <CardHeader>
          <CardTitle className="text-white">{t('gifEditor.ctrlAnimSettings')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-4">
              <Label className="text-xs font-black uppercase tracking-widest text-gray-500">{t('gifEditor.ctrlFrameDuration')}</Label>
              <span className="text-sm font-black text-green-400">{defaultDuration}ms</span>
            </div>
            <Slider
              value={[defaultDuration]}
              onValueChange={(values) => onDefaultDurationChange(values[0])}
              min={50}
              max={25000}
              step={50}
              className="[&>span:first-child]:bg-gray-800 [&>span:first-child>span]:bg-gradient-to-r [&>span:first-child>span]:from-green-400 [&>span:first-child>span]:to-yellow-400"
            />
          </div>

          <div>
            <Label className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3 block">{t('gifEditor.ctrlLoop')}</Label>
            <Select
              value={options.loop.toString()}
              onValueChange={(value) =>
                onOptionsChange({ ...options, loop: Number(value) })
              }
            >
              <SelectTrigger className="bg-gray-800 border-gray-700 text-white h-12 rounded-xl transition-all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-800 text-white">
                <SelectItem value="0" className="hover:bg-green-600 focus:bg-green-600 transition-colors cursor-pointer">{t('gifEditor.ctrlLoopInfinite')}</SelectItem>
                <SelectItem value="1" className="hover:bg-green-600 focus:bg-green-600 transition-colors cursor-pointer">{t('gifEditor.ctrlLoopOnce')}</SelectItem>
                <SelectItem value="2" className="hover:bg-green-600 focus:bg-green-600 transition-colors cursor-pointer">{t('gifEditor.ctrlLoopTwice')}</SelectItem>
                <SelectItem value="3" className="hover:bg-green-600 focus:bg-green-600 transition-colors cursor-pointer">{t('gifEditor.ctrlLoopTimes', { n: 3 })}</SelectItem>
                <SelectItem value="5" className="hover:bg-green-600 focus:bg-green-600 transition-colors cursor-pointer">{t('gifEditor.ctrlLoopTimes', { n: 5 })}</SelectItem>
                <SelectItem value="10" className="hover:bg-green-600 focus:bg-green-600 transition-colors cursor-pointer">{t('gifEditor.ctrlLoopTimes', { n: 10 })}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <Label className="text-xs font-black uppercase tracking-widest text-gray-500">{t('gifEditor.ctrlQuality')}</Label>
              <span className="text-sm font-black text-green-400">{options.quality}</span>
            </div>
            <Slider
              value={[options.quality]}
              onValueChange={(values) => onOptionsChange({ ...options, quality: values[0] })}
              min={1}
              max={30}
              step={1}
              className="[&>span:first-child]:bg-gray-800 [&>span:first-child>span]:bg-gradient-to-r [&>span:first-child>span]:from-green-400 [&>span:first-child>span]:to-yellow-400"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gray-900 border-gray-800 text-white shadow-2xl">
        <CardHeader>
          <CardTitle className="text-white">{t('gifEditor.ctrlTextOverlay')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label className="text-xs font-black uppercase tracking-widest text-gray-500 block">{t('gifEditor.ctrlTextContent')}</Label>
            <div className="flex gap-2">
              <Input
                value={options.textOverlay?.text || ''}
                onChange={(e) => handleTextOverlayChange('text', e.target.value)}
                placeholder={t('gifEditor.ctrlTextPlaceholder')}
                className="bg-gray-800 border-gray-700 text-white rounded-xl h-12 focus:ring-green-500 transition-all shadow-inner flex-1"
              />
              {options.textOverlay?.text && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleTextOverlayChange('text', '')}
                  className="h-12 w-12 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all"
                  title={t('gifEditor.ctrlClearTextTitle')}
                >
                  <Trash2 className="w-5 h-5" />
                </Button>
              )}
            </div>
            <p className="text-[10px] text-gray-600 italic font-medium">
              {t('gifEditor.ctrlTextGlobalNote')}
            </p>
          </div>

          {options.textOverlay?.text && (
            <>
              <div className="grid grid-cols-1 gap-6">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <Label className="text-xs font-black uppercase tracking-widest text-gray-500">{t('gifEditor.ctrlPosX')}</Label>
                    <span className="text-sm font-black text-green-400">{options.textOverlay.x}%</span>
                  </div>
                  <Slider
                    value={[options.textOverlay.x]}
                    onValueChange={(values) => handleTextOverlayChange('x', values[0])}
                    min={0}
                    max={100}
                    className="[&>span:first-child]:bg-gray-800 [&>span:first-child>span]:bg-gradient-to-r [&>span:first-child>span]:from-green-400 [&>span:first-child>span]:to-yellow-400"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <Label className="text-xs font-black uppercase tracking-widest text-gray-500">{t('gifEditor.ctrlPosY')}</Label>
                    <span className="text-sm font-black text-green-400">{options.textOverlay.y}%</span>
                  </div>
                  <Slider
                    value={[options.textOverlay.y]}
                    onValueChange={(values) => handleTextOverlayChange('y', values[0])}
                    min={0}
                    max={100}
                    className="[&>span:first-child]:bg-gray-800 [&>span:first-child>span]:bg-gradient-to-r [&>span:first-child>span]:from-green-400 [&>span:first-child>span]:to-yellow-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3 block">{t('gifEditor.ctrlFontSize')}</Label>
                  <Input
                    type="number"
                    value={options.textOverlay.fontSize}
                    onChange={(e) =>
                      handleTextOverlayChange('fontSize', parseInt(e.target.value) || 32)
                    }
                    min={12}
                    max={100}
                    className="bg-gray-800 border-gray-700 text-white rounded-xl h-12 shadow-inner"
                  />
                </div>
                <div>
                  <Label className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3 block">{t('gifEditor.ctrlColor')}</Label>
                  <div className="relative h-12 w-full">
                    <input
                      type="color"
                      value={options.textOverlay.color}
                      onChange={(e) => handleTextOverlayChange('color', e.target.value)}
                      className="absolute inset-0 w-full h-full rounded-xl border-none cursor-pointer p-0 overflow-hidden bg-transparent"
                    />
                    <div className="absolute inset-0 pointer-events-none rounded-xl border border-gray-700" />
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3 block">{t('gifEditor.ctrlFontFamily')}</Label>
                  <button
                    type="button"
                    onClick={loadLocalFonts}
                    title={t('editorHTML.text.refreshLocalFonts')}
                    className="mb-3 text-gray-500 hover:text-green-400 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${localFontsLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <Select
                  value={options.textOverlay.fontFamily}
                  onValueChange={async (value) => {
                    const lf = localFonts.find((f) => f.family === value);
                    if (lf) await ensureLocalFontFace(lf);
                    handleTextOverlayChange('fontFamily', value);
                  }}
                >
                  <SelectTrigger className="bg-gray-800 border-gray-700 h-12 rounded-xl transition-all">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-800 text-white">
                    <SelectItem value="Arial" className="hover:bg-green-600 transition-colors cursor-pointer">Arial</SelectItem>
                    <SelectItem value="Helvetica" className="hover:bg-green-600 transition-colors cursor-pointer">Helvetica</SelectItem>
                    <SelectItem value="Times New Roman" className="hover:bg-green-600 transition-colors cursor-pointer">Times New Roman</SelectItem>
                    <SelectItem value="Courier New" className="hover:bg-green-600 transition-colors cursor-pointer">Courier New</SelectItem>
                    <SelectItem value="Georgia" className="hover:bg-green-600 transition-colors cursor-pointer">Georgia</SelectItem>
                    <SelectItem value="Impact" className="hover:bg-green-600 transition-colors cursor-pointer">Impact</SelectItem>
                    <SelectItem value="Comic Sans MS" className="hover:bg-green-600 transition-colors cursor-pointer">Comic Sans MS</SelectItem>
                    {localFonts.length > 0 && (
                      <>
                        <SelectItem value="__local_fonts_sep__" disabled className="text-gray-400 text-[11px] uppercase font-bold">
                          {t('editorHTML.text.localFonts')}
                        </SelectItem>
                        {localFonts.map((f) => (
                          <SelectItem key={f.family} value={f.family} style={{ fontFamily: f.family }} className="hover:bg-green-600 transition-colors cursor-pointer">
                            {f.name}
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* CONTROLES DE BORDE (STROKE) */}
              <div className="space-y-4 pt-4 border-t border-gray-800">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-blue-400">{t('gifEditor.ctrlTextStroke')}</Label>
                  <Switch 
                    checked={!!options.textOverlay?.strokeColor} 
                    onCheckedChange={(checked) => {
                      const currentOverlay = options.textOverlay || {
                        text: '', x: 50, y: 50, fontSize: 32, fontFamily: 'Arial', color: '#ffffff'
                      };
                      onOptionsChange({
                        ...options,
                        textOverlay: {
                          ...currentOverlay,
                          strokeColor: checked ? '#000000' : '',
                          strokeWidth: checked ? 2 : currentOverlay.strokeWidth
                        }
                      });
                    }} 
                  />
                </div>
                {options.textOverlay?.strokeColor !== undefined && options.textOverlay?.strokeColor !== '' && (
                  <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                    <div>
                      <Label className="text-[10px] font-bold text-gray-500 uppercase">{t('gifEditor.ctrlStrokeColor')}</Label>
                      <div className="relative h-10 w-full mt-1">
                        <input
                          type="color"
                          value={options.textOverlay?.strokeColor}
                          onChange={(e) => handleTextOverlayChange('strokeColor', e.target.value)}
                          className="absolute inset-0 w-full h-full rounded-lg border-none cursor-pointer p-0 bg-transparent"
                        />
                        <div className="absolute inset-0 pointer-events-none rounded-lg border border-gray-700" />
                      </div>
                    </div>
                    <div>
                      <Label className="text-[10px] font-bold text-gray-500 uppercase">{t('gifEditor.ctrlStrokeWidth', { n: options.textOverlay?.strokeWidth || 2 })}</Label>
                      <Slider
                        value={[options.textOverlay?.strokeWidth || 2]}
                        onValueChange={(values) => handleTextOverlayChange('strokeWidth', values[0])}
                        min={1}
                        max={15}
                        step={1}
                        className="mt-3"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* CONTROLES DE SOMBRA (SHADOW) */}
              <div className="space-y-4 pt-4 border-t border-gray-800">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-yellow-400">{t('gifEditor.ctrlTextShadow')}</Label>
                  <Switch 
                    checked={!!options.textOverlay?.shadowColor} 
                    onCheckedChange={(checked) => {
                      const currentOverlay = options.textOverlay || {
                        text: '', x: 50, y: 50, fontSize: 32, fontFamily: 'Arial', color: '#ffffff'
                      };
                      onOptionsChange({
                        ...options,
                        textOverlay: {
                          ...currentOverlay,
                          shadowColor: checked ? '#000000' : '',
                          shadowBlur: checked ? 5 : currentOverlay.shadowBlur,
                          shadowOffsetX: checked ? 2 : currentOverlay.shadowOffsetX,
                          shadowOffsetY: checked ? 2 : currentOverlay.shadowOffsetY
                        }
                      });
                    }} 
                  />
                </div>
                {options.textOverlay?.shadowColor !== undefined && options.textOverlay?.shadowColor !== '' && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-[10px] font-bold text-gray-500 uppercase">{t('gifEditor.ctrlShadowColor')}</Label>
                        <div className="relative h-10 w-full mt-1">
                          <input
                            type="color"
                            value={options.textOverlay?.shadowColor?.startsWith('rgba') ? '#000000' : options.textOverlay?.shadowColor}
                            onChange={(e) => handleTextOverlayChange('shadowColor', e.target.value)}
                            className="absolute inset-0 w-full h-full rounded-lg border-none cursor-pointer p-0 bg-transparent"
                          />
                          <div className="absolute inset-0 pointer-events-none rounded-lg border border-gray-700" />
                        </div>
                      </div>
                      <div>
                        <Label className="text-[10px] font-bold text-gray-500 uppercase">{t('gifEditor.ctrlShadowBlur', { n: options.textOverlay?.shadowBlur || 5 })}</Label>
                        <Slider
                          value={[options.textOverlay?.shadowBlur || 5]}
                          onValueChange={(values) => handleTextOverlayChange('shadowBlur', values[0])}
                          min={0}
                          max={20}
                          step={1}
                          className="mt-3"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-[10px] font-bold text-gray-500 uppercase">{t('gifEditor.ctrlShadowOffsetX', { n: options.textOverlay?.shadowOffsetX || 2 })}</Label>
                        <Slider
                          value={[options.textOverlay?.shadowOffsetX || 2]}
                          onValueChange={(values) => handleTextOverlayChange('shadowOffsetX', values[0])}
                          min={-20}
                          max={20}
                          step={1}
                          className="mt-3"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] font-bold text-gray-500 uppercase">{t('gifEditor.ctrlShadowOffsetY', { n: options.textOverlay?.shadowOffsetY || 2 })}</Label>
                        <Slider
                          value={[options.textOverlay?.shadowOffsetY || 2]}
                          onValueChange={(values) => handleTextOverlayChange('shadowOffsetY', values[0])}
                          min={-20}
                          max={20}
                          step={1}
                          className="mt-3"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <Button
                onClick={() => onAddText?.(options.textOverlay!)}
                disabled={!options.textOverlay?.text}
                className="w-full bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-bold rounded-xl h-12 transition-all shadow-lg"
              >
                <Plus className="w-4 h-4 mr-2" />
                {t('gifEditor.ctrlAddToCurrentFrame')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
