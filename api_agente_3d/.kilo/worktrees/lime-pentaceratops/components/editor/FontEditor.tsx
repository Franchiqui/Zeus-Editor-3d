import React, { useRef, useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bold, Italic, Underline, Type, Layers, Copy, Square, Wand2, Save, Check, Trash2, PenTool, Eraser, RefreshCw, Settings2 } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { useLocalFonts } from '@/lib/useLocalFonts';
import PencilTool from './PencilTool';

const FONTS = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Courier New',
  'Impact',
  'Comic Sans MS',
  'Trebuchet MS',
  'Palatino',
  'Inter',
  'Roboto',
  'Open Sans',
  'Montserrat',
];

export interface FontStyle {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  borderColor: string;
  borderWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffset: number;
  backgroundColor: string;
  backgroundOpacity: number;
  backgroundBlur: number;
  borderRadius: number;
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
}

export interface SavedTextPreset {
  id: string;
  name: string;
  style: FontStyle;
}

interface FontEditorProps {
  style: FontStyle;
  onChange: (style: Partial<FontStyle>) => void;
  savedTexts?: SavedTextPreset[];
  onSaveText?: () => void;
  onUseCurrentText?: () => void;
  onUseSavedText?: (presetId: string) => void;
  onDeleteSavedText?: (presetId: string) => void;
}

export default function FontEditor({
  style,
  onChange,
  savedTexts = [],
  onSaveText,
  onUseCurrentText,
  onUseSavedText,
  onDeleteSavedText,
}: FontEditorProps) {
  const { t } = useI18n();
  
  // --- Fuentes locales (carpeta «Fuentes» configurada en la pestaña Archivo) ---
  const { localFonts, localFontsLoading, loadLocalFonts, ensureLocalFontFace } = useLocalFonts();
  
  // Pencil tool state
  const [pencilActive, setPencilActive] = useState(false);
  const [pencilSettings, setPencilSettings] = useState({
    brushSize: 4,
    brushShape: 'round' as 'round' | 'square',
    cementWidth: 2,
    magnetism: true,
    color: '#000000',
    opacity: 100,
    smoothness: 5,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);

  // Canvas initialization
  useEffect(() => {
    if (pencilActive && containerRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const resizeCanvas = () => {
        canvas.width = containerRef.current?.offsetWidth ?? 0;
        canvas.height = containerRef.current?.offsetHeight ?? 0;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      };

      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);
      return () => window.removeEventListener('resize', resizeCanvas);
    }
  }, [pencilActive]);

  const getMousePos = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    const pos = getMousePos(e);
    setLastPoint(pos);
    
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.strokeStyle = pencilSettings.color;
      ctx.lineWidth = pencilSettings.brushSize;
      ctx.lineCap = pencilSettings.brushShape === 'round' ? 'round' : 'square';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = pencilSettings.opacity / 100;
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !lastPoint || !canvasRef.current) return;
    e.preventDefault();

    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    const currentPos = getMousePos(e);
    const settings = pencilSettings;

    // Magnetism effect
    const magnetStrength = 10;
    let drawX = currentPos.x;
    let drawY = currentPos.y;

    if (settings.magnetism && lastPoint) {
      const dx = currentPos.x - lastPoint.x;
      const dy = currentPos.y - lastPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < magnetStrength) {
        const angle = Math.atan2(dy, dx);
        drawX = lastPoint.x + Math.cos(angle) * magnetStrength;
        drawY = lastPoint.y + Math.sin(angle) * magnetStrength;
      }
    }

    // Cement effect
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = settings.color;
    ctx.lineWidth = settings.brushSize + settings.cementWidth * 2;
    ctx.lineCap = settings.brushShape === 'round' ? 'round' : 'square';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = settings.opacity / 100;

    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(drawX, drawY);
    ctx.stroke();

    // Cement lines
    const cementOffset = settings.cementWidth;
    const angle = Math.atan2(currentPos.y - lastPoint.y, currentPos.x - lastPoint.x);
    
    if (settings.brushShape === 'round') {
      ctx.beginPath();
      ctx.strokeStyle = settings.color;
      ctx.lineWidth = settings.brushSize;
      ctx.globalAlpha = settings.opacity / 100;
      
      ctx.moveTo(lastPoint.x - cementOffset, lastPoint.y);
      ctx.lineTo(drawX - cementOffset, drawY);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.moveTo(lastPoint.x + cementOffset, lastPoint.y);
      ctx.lineTo(drawX + cementOffset, drawY);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.strokeStyle = settings.color;
      ctx.lineWidth = settings.brushSize;
      ctx.globalAlpha = settings.opacity / 100;
      
      ctx.moveTo(lastPoint.x - cementOffset, lastPoint.y - cementOffset);
      ctx.lineTo(drawX - cementOffset, drawY - cementOffset);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.moveTo(lastPoint.x + cementOffset, lastPoint.y - cementOffset);
      ctx.lineTo(drawX + cementOffset, drawY - cementOffset);
      ctx.stroke();
    }

    ctx.restore();

    setLastPoint({ x: drawX, y: drawY });
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.globalAlpha = 1;
    }
  };

  const clearCanvas = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const resetCanvas = () => {
    clearCanvas();
    setLastPoint(null);
  };

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? 
      `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : 
      '0, 0, 0';
  };

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    display: 'inline-block',
    padding: '20px',
    textAlign: 'center',
    maxWidth: '100%',
    wordBreak: 'break-word',
    zIndex: 1,
  };

  const backgroundLayerStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: `rgba(${hexToRgb(style.backgroundColor)}, ${style.backgroundOpacity / 100})`,
    borderRadius: `${style.borderRadius}px`,
    filter: style.backgroundBlur > 0 ? `blur(${style.backgroundBlur}px)` : 'none',
    transform: `scale(${1 + (style.backgroundBlur * 0.02)})`,
    zIndex: -1,
    transition: 'all 0.2s ease',
  };

  const textStyle: React.CSSProperties = {
    fontFamily: style.fontFamily,
    fontSize: `${style.fontSize}px`,
    color: style.color,
    fontWeight: style.isBold ? 'bold' : 'normal',
    fontStyle: style.isItalic ? 'italic' : 'normal',
    textDecoration: style.isUnderline ? 'underline' : 'none',
    WebkitTextStroke: style.borderWidth > 0 ? `${style.borderWidth}px ${style.borderColor}` : 'none',
    textShadow: style.shadowBlur > 0 || style.shadowOffset > 0 ? `${style.shadowOffset}px ${style.shadowOffset}px ${style.shadowBlur}px ${style.shadowColor}` : 'none',
    position: 'relative',
    zIndex: 2,
  };

  return (
    <div className="flex flex-col space-y-6 p-4 bg-gray-900/50 rounded-xl border border-gray-800">
      {/* Preview Section */}
      <div className="flex flex-col items-center justify-center min-h-[180px] bg-black/40 rounded-lg border border-dashed border-gray-700 p-8 overflow-hidden relative">
        <div style={containerStyle}>
          <div style={backgroundLayerStyle} />
          <div style={textStyle}>
            {style.text || t('videoEditor.style.writeSomething')}
          </div>
        </div>
      </div>

      {/* Pencil Tool Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <PenTool className="w-3 h-3" /> {t('pencil.tool')}
          </Label>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant={pencilActive ? "default" : "outline"}
              onClick={() => setPencilActive(!pencilActive)}
              className="gap-2"
            >
              <PenTool className="w-4 h-4" />
              {pencilActive ? t('pencil.active') : t('pencil.inactive')}
            </Button>
            <PencilTool
              isActive={pencilActive}
              onToggle={() => setPencilActive(!pencilActive)}
              onSettingsChange={setPencilSettings}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onSaveText}
          className="!bg-emerald-600 hover:!bg-emerald-500 !text-white border border-emerald-400/40 gap-2"
        >
          <Save className="w-4 h-4" />
          {t('videoEditor.style.saveText')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onUseCurrentText}
          className="border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 gap-2"
        >
          <Check className="w-4 h-4" />
          {t('videoEditor.style.useText')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Basic Text Controls */}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Type className="w-3 h-3" /> {t('videoEditor.style.exampleTextLabel')}
              </Label>
              <Input 
                value={style.text} 
                onChange={(e) => onChange({ text: e.target.value })}
                className="bg-gray-950 border-gray-800 text-white focus:ring-emerald-500"
                placeholder={t('videoEditor.style.textPlaceholder')}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('videoEditor.style.font')}</Label>
                  <button
                    type="button"
                    onClick={loadLocalFonts}
                    title={t('editorHTML.text.refreshLocalFonts')}
                    className="text-gray-400 hover:text-emerald-400 transition-colors"
                  >
                    <RefreshCw className={`h-3 w-3 ${localFontsLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <Select value={style.fontFamily} onValueChange={async (v) => {
                  const lf = localFonts.find((f) => f.family === v);
                  if (lf) await ensureLocalFontFace(lf);
                  onChange({ fontFamily: v });
                }}>
                  <SelectTrigger className="bg-gray-950 border-gray-800 text-white">
                    <SelectValue placeholder={t('videoEditor.style.selectFont')} />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-800 text-white">
                    {FONTS.map(font => (
                      <SelectItem key={font} value={font} style={{ fontFamily: font }}>
                        {font}
                      </SelectItem>
                    ))}
                    {localFonts.length > 0 && (
                      <>
                        <SelectItem value="__local_fonts_sep__" disabled className="text-gray-400 text-[11px] uppercase font-bold">
                          {t('editorHTML.text.localFonts')}
                        </SelectItem>
                        {localFonts.map((f) => (
                          <SelectItem key={f.family} value={f.family} style={{ fontFamily: f.family }}>
                            {f.name}
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('videoEditor.style.sizeLabel', { size: style.fontSize })}</Label>
                <Slider 
                  value={[style.fontSize]} 
                  onValueChange={([v]) => onChange({ fontSize: v })} 
                  min={12} max={120} step={1}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Toggle 
                pressed={style.isBold} 
                onPressedChange={(v) => onChange({ isBold: v })}
                className="bg-gray-950 border-gray-800 data-[state=on]:bg-emerald-600 data-[state=on]:text-white"
              >
                <Bold className="w-4 h-4" />
              </Toggle>
              <Toggle 
                pressed={style.isItalic} 
                onPressedChange={(v) => onChange({ isItalic: v })}
                className="bg-gray-950 border-gray-800 data-[state=on]:bg-emerald-600 data-[state=on]:text-white"
              >
                <Italic className="w-4 h-4" />
              </Toggle>
              <Toggle 
                pressed={style.isUnderline} 
                onPressedChange={(v) => onChange({ isUnderline: v })}
                className="bg-gray-950 border-gray-800 data-[state=on]:bg-emerald-600 data-[state=on]:text-white"
              >
                <Underline className="w-4 h-4" />
              </Toggle>
              <div className="flex-1" />
              <div className="flex items-center gap-2 bg-gray-950 p-1 rounded-md border border-gray-800">
                <Input 
                  type="color" 
                  value={style.color} 
                  onChange={(e) => onChange({ color: e.target.value })}
                  className="w-8 h-8 p-0 border-none bg-transparent cursor-pointer"
                />
                <span className="text-xs font-mono text-gray-400 pr-2">{style.color.toUpperCase()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Border and Shadow */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <Label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-3 h-3" /> {t('videoEditor.style.border')}
            </Label>
            <div className="space-y-4 p-4 bg-gray-950/50 rounded-lg border border-gray-800">
              <div className="flex items-center gap-3">
                <Input 
                  type="color" 
                  value={style.borderColor} 
                  onChange={(e) => onChange({ borderColor: e.target.value })}
                  className="w-8 h-8 p-0 border-none bg-transparent cursor-pointer"
                />
                <span className="text-xs font-mono text-gray-400">{style.borderColor.toUpperCase()}</span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] text-gray-500 font-bold uppercase">
                  <span>{t('videoEditor.style.borderWidth')}</span>
                  <span className="text-emerald-500">{style.borderWidth}px</span>
                </div>
                <Slider 
                  value={[style.borderWidth]} 
                  onValueChange={([v]) => onChange({ borderWidth: v })} 
                  min={0} max={10} step={0.1}
                  className="py-4"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <Label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Copy className="w-3 h-3" /> {t('videoEditor.style.shadow')}
            </Label>
            <div className="space-y-4 p-4 bg-gray-950/50 rounded-lg border border-gray-800">
              <div className="flex items-center gap-3">
                <Input 
                  type="color" 
                  value={style.shadowColor} 
                  onChange={(e) => onChange({ shadowColor: e.target.value })}
                  className="w-8 h-8 p-0 border-none bg-transparent cursor-pointer"
                />
                <span className="text-xs font-mono text-gray-400">{style.shadowColor.toUpperCase()}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] text-gray-500 font-bold uppercase">
                    <span>{t('videoEditor.style.dist')}</span>
                    <span>{style.shadowOffset}px</span>
                  </div>
                  <Slider 
                    value={[style.shadowOffset]} 
                    onValueChange={([v]) => onChange({ shadowOffset: v })} 
                    min={0} max={20} step={1}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] text-gray-500 font-bold uppercase">
                    <span>{t('videoEditor.style.blurShort')}</span>
                    <span>{style.shadowBlur}px</span>
                  </div>
                  <Slider 
                    value={[style.shadowBlur]} 
                    onValueChange={([v]) => onChange({ shadowBlur: v })} 
                    min={0} max={20} step={1}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Background - Full Width Sliders */}
        <div className="space-y-4">
          <Label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <Square className="w-3 h-3" /> {t('videoEditor.style.textBg')}
          </Label>
          <div className="space-y-6 p-5 bg-gray-950/50 rounded-lg border border-gray-800">
            <div className="flex items-center gap-3">
              <Input 
                type="color" 
                value={style.backgroundColor} 
                onChange={(e) => onChange({ backgroundColor: e.target.value })}
                className="w-10 h-10 p-0 border-none bg-transparent cursor-pointer"
              />
              <div>
                <Label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">{t('videoEditor.style.bgColor')}</Label>
                <span className="text-xs font-mono text-gray-400">{style.backgroundColor.toUpperCase()}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <Label className="text-[10px] text-gray-500 font-bold uppercase">{t('videoEditor.style.bgOpacity')}</Label>
                  <span className="text-sm font-mono text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded">{style.backgroundOpacity}%</span>
                </div>
                <Slider 
                  value={[style.backgroundOpacity]} 
                  onValueChange={([v]) => onChange({ backgroundOpacity: v })} 
                  min={0} max={100} step={1}
                  className="py-2"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <Label className="text-[10px] text-gray-500 font-bold uppercase">{t('videoEditor.style.cornerRadius')}</Label>
                    <span className="text-sm font-mono text-gray-400">{style.borderRadius}px</span>
                  </div>
                  <Slider 
                    value={[style.borderRadius]} 
                    onValueChange={([v]) => onChange({ borderRadius: v })} 
                    min={0} max={100} step={1}
                  />
                </div>
                
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <Label className="text-[10px] font-bold text-emerald-500 uppercase flex items-center gap-1">
                      <Wand2 className="w-3 h-3" /> {t('videoEditor.style.feather')}
                    </Label>
                    <span className="text-sm font-mono text-emerald-500">{style.backgroundBlur}px</span>
                  </div>
                  <Slider 
                    value={[style.backgroundBlur]} 
                    onValueChange={([v]) => onChange({ backgroundBlur: v })} 
                    min={0} max={60} step={1}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <Label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
          {t('videoEditor.style.savedTexts')}
        </Label>
        <div className="space-y-3">
          {savedTexts.map((preset) => {
            const previewBackgroundStyle: React.CSSProperties = {
              position: 'absolute',
              inset: 0,
              backgroundColor: `rgba(${hexToRgb(preset.style.backgroundColor)}, ${preset.style.backgroundOpacity / 100})`,
              borderRadius: `${preset.style.borderRadius}px`,
              filter: preset.style.backgroundBlur > 0 ? `blur(${preset.style.backgroundBlur}px)` : 'none',
              transform: `scale(${1 + (preset.style.backgroundBlur * 0.02)})`,
              zIndex: -1,
            };

            const previewTextStyle: React.CSSProperties = {
              fontFamily: preset.style.fontFamily,
              fontSize: `${Math.max(14, Math.min(28, preset.style.fontSize * 0.45))}px`,
              color: preset.style.color,
              fontWeight: preset.style.isBold ? 'bold' : 'normal',
              fontStyle: preset.style.isItalic ? 'italic' : 'normal',
              textDecoration: preset.style.isUnderline ? 'underline' : 'none',
              WebkitTextStroke: preset.style.borderWidth > 0
                ? `${Math.max(0.5, preset.style.borderWidth * 0.45)}px ${preset.style.borderColor}`
                : 'none',
              textShadow: preset.style.shadowBlur > 0 || preset.style.shadowOffset > 0
                ? `${Math.max(0.5, preset.style.shadowOffset * 0.45)}px ${Math.max(0.5, preset.style.shadowOffset * 0.45)}px ${Math.max(1, preset.style.shadowBlur * 0.45)}px ${preset.style.shadowColor}`
                : 'none',
              position: 'relative',
              zIndex: 1,
              wordBreak: 'break-word',
              textAlign: 'center',
            };

            return (
              <div
                key={preset.id}
                className="rounded-lg border border-gray-800 bg-gray-950/60 p-3"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{preset.name}</div>
                    <div className="text-xs text-gray-400 truncate">{preset.style.text || t('videoEditor.style.noText')}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onUseSavedText?.(preset.id)}
                      className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                    >
                      {t('videoEditor.style.useText')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onDeleteSavedText?.(preset.id)}
                      className="text-gray-400 hover:text-red-400 hover:bg-red-500/10 px-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="min-h-[84px] rounded-lg border border-dashed border-gray-700 bg-black/30 p-4 flex items-center justify-center overflow-hidden">
                  <div style={{ position: 'relative', display: 'inline-block', padding: '10px 16px', maxWidth: '100%' }}>
                    <div style={previewBackgroundStyle} />
                    <div style={previewTextStyle}>
                      {preset.style.text || t('videoEditor.style.exampleText')}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {savedTexts.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-800 bg-gray-950/40 p-4 text-sm text-gray-500 text-center">
              {t('videoEditor.style.noSavedTexts')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
